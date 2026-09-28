import { SETTINGS_PRESETS_KEY } from '../core/constants';
import type { Settings } from '../core/types';
import { deepcopy } from '../core/util/object';
import { uuid } from '../core/util/text';
import { DEFAULT_CONFIG } from '../config/defaults';
import { migrateSettings } from '../config/schema';
import { settingsPresetExamples } from '../config/settings-preset-examples';
import { applyPresetSettings, normalizeSettingsPreset, record, settingsPresetJson, type SettingsPreset } from '../domain/settings-preset';
import { psGet, psSet } from '../storage/device-store';
import { getConfig, setConfig } from './context';
import { exportPromptsPack, importPromptsPack, publicSettings, resetPromptsToDefaults, saveConfig } from './settings';

interface Registry { items: SettingsPreset[]; hidden: string[]; appliedId: string }
let pending: Promise<unknown> = Promise.resolve();
function serial<T>(operation: () => Promise<T>): Promise<T> {
  const next = pending.catch(() => {}).then(operation); pending = next; return next;
}
async function readRegistry(): Promise<Registry> {
  const raw = record(await psGet(SETTINGS_PRESETS_KEY));
  const items = (Array.isArray(raw.items) ? raw.items : []).map(item => normalizeSettingsPreset(item, DEFAULT_CONFIG));
  return { items, hidden: Array.isArray(raw.hidden) ? raw.hidden.filter((id): id is string => typeof id === 'string') : [], appliedId: String(raw.appliedId || '') };
}
async function writeRegistry(registry: Registry): Promise<void> {
  if (!await psSet(SETTINGS_PRESETS_KEY, registry)) throw new Error('프리셋을 저장하지 못했습니다. 다시 시도하세요.');
}
function catalog(registry: Registry): SettingsPreset[] {
  const rows = new Map(settingsPresetExamples().filter(row => !registry.hidden.includes(row.id)).map(row => [row.id, row]));
  for (const row of registry.items) rows.set(row.id, row);
  return [...rows.values()];
}
function find(registry: Registry, id: unknown): SettingsPreset {
  const preset = catalog(registry).find(row => row.id === id);
  if (!preset) throw new Error('설정 프리셋을 찾을 수 없습니다.');
  return preset;
}
export async function listSettingsPresets() {
  await pending.catch(() => {});
  const registry = await readRegistry();
  return { ok: true, items: catalog(registry), appliedId: registry.appliedId };
}
export function saveSettingsPreset(body: Record<string, unknown>) {
  return serial(async () => {
    const registry = await readRegistry();
    const previous = body.id ? find(registry, body.id) : null;
    const source = previous || (body.copy_from ? find(registry, body.copy_from) : null);
    const snapshot = !source || (!body.copy_from && body.capture !== false)
      ? { settings: getConfig(), prompts: (await exportPromptsPack()).prompts }
      : source;
    const preset = normalizeSettingsPreset({ ...snapshot, name: body.name, description: body.description, ...(body.prompts ? { prompts: body.prompts } : {}) }, DEFAULT_CONFIG);
    if (typeof body.comic_author_note === 'string') preset.settings.card.comic_author_note = body.comic_author_note;
    preset.id = previous?.id || `saved-${uuid()}`;
    if (!previous && registry.items.length >= 100) throw new Error('설정 프리셋은 최대 100개까지 저장할 수 있습니다.');
    registry.items = [...registry.items.filter(row => row.id !== preset.id), preset];
    await writeRegistry(registry);
    return { ok: true, preset };
  });
}
export function importSettingsPreset(body: Record<string, unknown>) {
  return serial(async () => {
    const json = String(body.json || '');
    if (json.length > 2_000_000) throw new Error('JSON은 2MB 이하만 불러올 수 있습니다.');
    const preset = normalizeSettingsPreset(JSON.parse(json), DEFAULT_CONFIG, String(body.name || '불러온 설정'));
    preset.id = `saved-${uuid()}`;
    const registry = await readRegistry();
    if (registry.items.length >= 100) throw new Error('설정 프리셋은 최대 100개까지 저장할 수 있습니다.');
    registry.items.push(preset); await writeRegistry(registry);
    return { ok: true, preset };
  });
}
export async function exportSettingsPreset(id: unknown) {
  await pending.catch(() => {});
  const preset = find(await readRegistry(), id);
  return { ok: true, json: settingsPresetJson(preset), name: preset.name };
}
export function deleteSettingsPreset(body: Record<string, unknown>) {
  return serial(async () => {
    const registry = await readRegistry(), preset = find(registry, body.id);
    registry.items = registry.items.filter(row => row.id !== preset.id);
    if (preset.id.startsWith('example-') && !registry.hidden.includes(preset.id)) registry.hidden.push(preset.id);
    if (registry.appliedId === preset.id) registry.appliedId = '';
    await writeRegistry(registry); return { ok: true };
  });
}
export function applySettingsPreset(body: Record<string, unknown>) {
  return serial(async () => {
    const registry = await readRegistry(), preset = find(registry, body.id);
    const previous = deepcopy(getConfig()), prompts = await exportPromptsPack();
    try {
      const next = migrateSettings(applyPresetSettings(previous, DEFAULT_CONFIG, preset)) as unknown as Settings;
      // Migration normalizes style rows too; restore them byte-for-byte from the live config.
      next.card.presets = deepcopy(previous.card.presets);
      next.card.active_preset_id = previous.card.active_preset_id;
      next.card.secondary_preset_id = previous.card.secondary_preset_id;
      setConfig(next);
      await resetPromptsToDefaults({ keep_author_note: false });
      await importPromptsPack({ prompts: preset.prompts });
      await saveConfig({ flush: true });
      await writeRegistry({ ...registry, appliedId: preset.id });
      return { ok: true, settings: publicSettings(), appliedId: preset.id };
    } catch (error) {
      setConfig(previous);
      await importPromptsPack(prompts);
      await saveConfig({ flush: true });
      throw error;
    }
  });
}
