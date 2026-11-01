import type { ApiResult } from '../core/types';
import { SETTINGS_PRESETS_KEY, VERSION } from '../core/constants';
import { deepcopy, deepMerge } from '../core/util/object';
import { isCredentialField, retainLocalCredentials, sanitizeForExport } from '../core/util/export-secrets';
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
import { exportAuthorNotePresets } from './author-note-presets';
import { afterAuthorNoteImport } from './settings-transfer';

/**
 * 디버그 → 백업: every setting of this device in one file, API keys included,
 * so moving to another device needs no key typed again. Every other export
 * strips credentials because those files are meant to be shared; this one is
 * not, and says so inside the file too. 키 제외 makes the same file without them,
 * for showing someone a setup. Lists and images (gallery, characters, voices,
 * BGM/effects, glossary) are data, not settings, and keep their own exports.
 */
export const FULL_BACKUP_TYPE = 'omni-nexus-full-backup';
export const FULL_BACKUP_WARNING = 'API 키·토큰이 그대로 들어 있습니다. 이 파일은 다른 사람과 공유하지 마세요.';
export const FULL_BACKUP_KEYLESS_WARNING = 'API 키·토큰은 빠져 있습니다. 불러와도 그 기기에 넣어 둔 키는 그대로 둡니다.';

const object = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

/**
 * A key in the TTS and sound settings. Besides the fields every export strips, these name some of theirs
 * plainly (`fish.key`, `routerKey`, `jev.key`, `translation.deeplKey`, `elevenKey`, `embed.key`), which the
 * shared rule cannot tell from any other field called key: there, every field whose name ends in key is one.
 */
const isVoiceKey = (name: string): boolean => isCredentialField(name) || /key$/i.test(name);
/** TTS/sound settings without their keys; the values taken go to `taken`, so one pasted into free text goes too. */
function withoutVoiceKeys(value: unknown, taken: string[]): unknown {
  if (Array.isArray(value)) return value.map(child => withoutVoiceKeys(child, taken));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).flatMap(([name, child]) => {
    if (!isVoiceKey(name)) return [[name, withoutVoiceKeys(child, taken)]];
    if (typeof child === 'string' && child) taken.push(child);
    return [];
  }));
}

/** `keys: false` (모든 설정 내보내기 · 키 제외): the same parts with every key and token taken out. */
export async function exportFullBackup(options: { keys?: boolean } = {}): Promise<string> {
  const keys = options.keys !== false, taken: string[] = [];
  await Promise.all([loadTtsData(), loadSoundData()]);
  const presets = await listCommandPresets() as { items?: unknown };
  const voice = (settings: unknown): unknown => keys ? deepcopy(settings) : withoutVoiceKeys(settings, taken);
  const doc = {
    type: FULL_BACKUP_TYPE, version: 1, plugin: VERSION, exported_at: new Date().toISOString(),
    ...(keys ? {} : { keys: false }), warning: keys ? FULL_BACKUP_WARNING : FULL_BACKUP_KEYLESS_WARNING,
    settings: migrateSettings(deepcopy(getConfig())),
    prompts: (await exportPromptsPack()).prompts,
    settings_presets: (await psGet(SETTINGS_PRESETS_KEY)) ?? null,
    command_presets: Array.isArray(presets.items) ? presets.items : [],
    author_note_presets: await exportAuthorNotePresets(),
    tts: voice(ttsData().settings),
    sound: voice(soundData().settings),
  };
  // With keys, the one export that is not sanitized. Without, it is, as every shared file: a key pasted into a
  // prompt or a note goes too.
  return JSON.stringify(keys ? doc : sanitizeForExport(doc, { settings: getConfig(), api_keys: taken }), null, 2);
}

/**
 * Restores every part the file carries, keys included; parts it lacks stay as they are. A file made without keys
 * leaves this device's own where they are (taken as the file's, they would be wiped).
 */
export async function importFullBackup(json: string): Promise<ApiResult> {
  let doc: Record<string, unknown> | null = null;
  try { doc = object(JSON.parse(String(json ?? ''))); } catch { /* reported below */ }
  if (!doc || doc.type !== FULL_BACKUP_TYPE) {
    return { ok: false, error: { code: 'bad_file', message: '「모든 설정 내보내기」로 만든 백업 파일이 아닙니다.' } };
  }
  const restored: string[] = [], keyless = doc.keys === false;
  const settings = object(doc.settings);
  if (settings) {
    // Prompts never ride inside the live config; the pack restores them below.
    const imported = importSettings(JSON.stringify(splitSettingsDocPrompts(settings).settings));
    const previous = deepcopy(getConfig());
    await idbPut('meta', { key: 'settings_backup', value: previous, updated_at: Date.now() / 1000 });
    const next = deepMerge(DEFAULT_CONFIG, imported);
    if (keyless) retainLocalCredentials(next, previous);
    setConfig(next);
    await saveConfig({ flush: true });
    restored.push('삽화 설정');
  }
  const prompts = object(doc.prompts);
  if (prompts) { await importPromptsPack({ prompts }); restored.push('프롬프트'); }
  if (object(doc.author_note_presets) || prompts && Object.prototype.hasOwnProperty.call(prompts, 'author_note')) {
    await afterAuthorNoteImport(doc.author_note_presets, true); restored.push('작가의 노트 프리셋');
  }
  if (object(doc.settings_presets)) { await psSet(SETTINGS_PRESETS_KEY, doc.settings_presets); restored.push('설정 프리셋'); }
  if (Array.isArray(doc.command_presets)) { await saveCommandPresets(doc.command_presets); restored.push('명령 프리셋'); }
  const tts = object(doc.tts);
  if (tts) {
    await loadTtsData();
    if (keyless) retainLocalCredentials(tts, ttsData().settings, isVoiceKey);
    await updateTtsSettings(tts as Partial<TtsSettings>); restored.push('TTS');
  }
  const sound = object(doc.sound);
  if (sound) {
    await loadSoundData();
    if (keyless) retainLocalCredentials(sound, soundData().settings, isVoiceKey);
    await updateSoundSettings(sound as Partial<SoundSettings>); restored.push('BGM·효과음');
  }
  return { ok: true, restored, settings: publicSettings() };
}
