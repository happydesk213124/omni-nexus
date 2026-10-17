import type { ApiResult } from '../core/types';
import { SETTINGS_PRESETS_KEY, VERSION } from '../core/constants';
import { deepcopy, deepMerge } from '../core/util/object';
import { DEFAULT_CONFIG } from '../config/defaults';
import { importSettings, migrateSettings, splitSettingsDocPrompts } from '../config/schema';
import { psGet, psSet } from '../storage/device-store';
import { idbPut } from '../storage/stores';
import { loadTtsData, ttsData, updateTtsSettings } from '../storage/tts-store';
import { loadSoundData, soundData, updateSoundSettings } from '../storage/sound-store';
import type { TtsSettings } from '../core/tts-types';
import type { SoundSettings } from '../core/sound-types';
import { getConfig, setConfig } from './context';
import { exportPromptsPack, importPromptsPack, publicSettings, saveConfig } from './settings';
import { listCommandPresets, saveCommandPresets } from './char-command-presets';

/**
 * 디버그 → 백업: every setting of this device in one file, API keys included,
 * so moving to another device needs no key typed again. Every other export
 * strips credentials because those files are meant to be shared; this one is
 * not, and says so inside the file too. Lists and images (gallery, characters,
 * voices, BGM/effects, glossary) are data, not settings, and keep their own exports.
 */
export const FULL_BACKUP_TYPE = 'omni-nexus-full-backup';
export const FULL_BACKUP_WARNING = 'API 키·토큰이 그대로 들어 있습니다. 이 파일은 다른 사람과 공유하지 마세요.';

const object = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

export async function exportFullBackup(): Promise<string> {
  await Promise.all([loadTtsData(), loadSoundData()]);
  const presets = await listCommandPresets() as { items?: unknown };
  return JSON.stringify({
    type: FULL_BACKUP_TYPE, version: 1, plugin: VERSION, exported_at: new Date().toISOString(), warning: FULL_BACKUP_WARNING,
    // Keys stay: this is the one export that is not sanitized.
    settings: migrateSettings(deepcopy(getConfig())),
    prompts: (await exportPromptsPack()).prompts,
    settings_presets: (await psGet(SETTINGS_PRESETS_KEY)) ?? null,
    command_presets: Array.isArray(presets.items) ? presets.items : [],
    tts: deepcopy(ttsData().settings),
    sound: deepcopy(soundData().settings),
  }, null, 2);
}

/** Restores every part the file carries, keys included; parts it lacks stay as they are. */
export async function importFullBackup(json: string): Promise<ApiResult> {
  let doc: Record<string, unknown> | null = null;
  try { doc = object(JSON.parse(String(json ?? ''))); } catch { /* reported below */ }
  if (!doc || doc.type !== FULL_BACKUP_TYPE) {
    return { ok: false, error: { code: 'bad_file', message: '「모든 설정 내보내기」로 만든 백업 파일이 아닙니다.' } };
  }
  const restored: string[] = [];
  const settings = object(doc.settings);
  if (settings) {
    // Prompts never ride inside the live config; the pack restores them below.
    const imported = importSettings(JSON.stringify(splitSettingsDocPrompts(settings).settings));
    const previous = deepcopy(getConfig());
    await idbPut('meta', { key: 'settings_backup', value: previous, updated_at: Date.now() / 1000 });
    setConfig(deepMerge(DEFAULT_CONFIG, imported));
    await saveConfig({ flush: true });
    restored.push('삽화 설정');
  }
  const prompts = object(doc.prompts);
  if (prompts) { await importPromptsPack({ prompts }); restored.push('프롬프트'); }
  if (object(doc.settings_presets)) { await psSet(SETTINGS_PRESETS_KEY, doc.settings_presets); restored.push('설정 프리셋'); }
  if (Array.isArray(doc.command_presets)) { await saveCommandPresets(doc.command_presets); restored.push('명령 프리셋'); }
  const tts = object(doc.tts);
  if (tts) { await loadTtsData(); await updateTtsSettings(tts as Partial<TtsSettings>); restored.push('TTS'); }
  const sound = object(doc.sound);
  if (sound) { await loadSoundData(); await updateSoundSettings(sound as Partial<SoundSettings>); restored.push('BGM·효과음'); }
  return { ok: true, restored, settings: publicSettings() };
}
