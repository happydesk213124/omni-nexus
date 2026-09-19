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
  try {
    const raw = await psGet(SETTINGS_KEY, LEGACY_SETTINGS_KEY);
    const parsed = parseSettingsRaw(raw);
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
  try {
    const previous = parseSettingsRaw(await psGet(SETTINGS_KEY));
    if (JSON.stringify(previous) !== JSON.stringify(copy)) await psSet(SETTINGS_KEY, copy);
  } catch (err) {
    const msg = String((err as Error)?.message || err);
    if (/setItem\s*Error/i.test(msg)) {
      throw new Error(
        '설정 저장 실패(setItem Error): 저장소 쓰기 한도를 넘겼을 수 있습니다. 고정 프롬프트·스타일 프리셋 길이를 줄인 뒤 다시 저장하세요.',
      );
    }
    throw err instanceof Error ? err : new Error(msg);
  }
  if (opts.verify === false) return;
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
}
