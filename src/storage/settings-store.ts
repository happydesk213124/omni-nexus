/**
 * Settings persistence — save-file `pluginStorage` only.
 *
 * Images stay in the shot module. A silent failure here looks like "the plugin
 * forgot my API key", so an explicit flush can still re-read to confirm.
 */

import { SETTINGS_KEY, LEGACY_SETTINGS_KEY } from '../core/constants';
import type { Settings } from '../core/types';
import { deepcopy, deepMerge } from '../core/util/object';
import { migrateSettings, stripEphemeralPreviewUrls } from '../config/schema';
import { DEFAULT_CONFIG } from '../config/defaults';
import { psGet, psSet } from './device-store';

// This module is the sole writer of the settings row. Keep the last successful
// value, not the optimistic config, so a failed write is always retryable.
let persistedJson: string | undefined;

function sameStoredValue(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const a = left as Record<string, unknown>, b = right as Record<string, unknown>;
  const keys = Object.keys(a).filter(key => a[key] !== undefined);
  return keys.length === Object.keys(b).filter(key => b[key] !== undefined).length
    && keys.every(key => Object.prototype.hasOwnProperty.call(b, key) && sameStoredValue(a[key], b[key]));
}

function parseSettingsRaw(raw: unknown): unknown | null {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }
  return typeof raw === 'object' ? raw : null;
}

export async function loadSettingsFromStorage(): Promise<Settings> {
  persistedJson = undefined;
  try {
    const raw = await psGet(SETTINGS_KEY, LEGACY_SETTINGS_KEY);
    const parsed = parseSettingsRaw(raw);
    persistedJson = JSON.stringify(parsed);
    if (!parsed) return deepcopy(DEFAULT_CONFIG);
    const migrated = migrateSettings(parsed);
    const config = deepMerge(DEFAULT_CONFIG, migrated) as Settings;
    if (JSON.stringify(parsed) !== JSON.stringify(migrated)) await saveSettingsToStorage(config, { verify: true });
    return config;
  } catch (err) {
    console.warn('[Omni Nexus] settings load failed', (err as Error)?.message || err);
  }
  return deepcopy(DEFAULT_CONFIG);
}

export async function saveSettingsToStorage(
  config: Settings,
  opts: { verify?: boolean } = {},
): Promise<void> {
  const copy = deepcopy(config);
  stripEphemeralPreviewUrls(copy);
  const serialized = JSON.stringify(copy);
  try {
    if (persistedJson === undefined) persistedJson = JSON.stringify(parseSettingsRaw(await psGet(SETTINGS_KEY)));
    if (persistedJson !== serialized) await psSet(SETTINGS_KEY, copy);
  } catch (err) {
    persistedJson = undefined;
    const msg = String((err as Error)?.message || err);
    if (/setItem\s*Error/i.test(msg)) {
      throw new Error(
        '설정 저장 실패(setItem Error): 저장소 쓰기 한도를 넘겼을 수 있습니다. 고정 프롬프트·스타일 프리셋 길이를 줄인 뒤 다시 저장하세요.',
      );
    }
    throw err instanceof Error ? err : new Error(msg);
  }
  if (opts.verify === false) {
    persistedJson = serialized;
    return;
  }
  // A failed readback must not leave a cache entry claiming success.
  persistedJson = undefined;
  const check = await psGet(SETTINGS_KEY);
  if (check == null) {
    throw new Error('설정 저장 실패: 세이브 저장소(pluginStorage)에 기록되지 않았습니다.');
  }
  // Some hosts resolve setItem without replacing an existing row. Existence
  // alone cannot confirm a credential replacement or deletion actually stuck.
  const stored = parseSettingsRaw(check) as Partial<Settings> | null;
  const roles = Object.keys(copy.llm_roles || {}) as Array<keyof NonNullable<Settings['llm_roles']>>;
  if ((stored?.llm?.service_account_json || '') !== (copy.llm?.service_account_json || '')
    || roles.some(id => (stored?.llm_roles?.[id]?.service_account_json || '') !== (copy.llm_roles?.[id]?.service_account_json || ''))) {
    throw new Error('설정 저장 실패: Service Account JSON 기록을 확인할 수 없습니다.');
  }
  if (!sameStoredValue(stored, copy)) throw new Error('설정 저장 실패: 저장소에 변경 내용이 반영되지 않았습니다. 다시 저장해 주세요.');
  persistedJson = JSON.stringify(stored);
}
