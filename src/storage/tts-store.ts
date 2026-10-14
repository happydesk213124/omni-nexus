import type { TtsData, TtsSettings, TtsVoice } from '../core/tts-types';
import { ttsDefaults, TTS_DEFAULT_EXCLUDES } from '../config/tts-defaults';
import { parseVoiceImport } from '../domain/tts/library';
import { ensureTtsRoleCards } from '../domain/tts/identity';
import { psGet, psSet } from './device-store';
import presets from '../config/tts-presets.json';
import { ttsExcludeTerms } from '../domain/tts/filter';
import { readBotTtsCharacters, writeBotTtsCharacters, ttsBotScope, validTtsCharacter } from './tts-roster';

export const TTS_DATA_KEY = 'omnitts.data';
let state: TtsData | undefined;
let loading: Promise<TtsData> | undefined;
let saveTail: Promise<void> = Promise.resolve();
const subscribers = new Set<() => void>();
export function subscribeTts(callback: () => void): () => void { subscribers.add(callback); return () => subscribers.delete(callback); }
export function ttsData(): TtsData {
  if (!state) throw new Error('TTS 설정을 아직 불러오지 않았습니다.');
  return state;
}
export function normalizeTtsSettings(raw: Partial<TtsSettings>): TtsSettings {
  const defaults = ttsDefaults();
  const result = { ...defaults, ...raw, fish: { ...defaults.fish, ...raw.fish }, llm: { ...defaults.llm, ...raw.llm },
    translation: { ...defaults.translation, ...raw.translation, llm: { ...defaults.translation.llm, ...raw.translation?.llm } },
    jev: { ...defaults.jev, ...raw.jev } };
  for (const field of Object.keys(defaults) as (keyof TtsSettings)[]) if (typeof defaults[field] === 'boolean' && typeof result[field] !== 'boolean') Object.assign(result, { [field]: defaults[field] });
  if (typeof result.excludeText !== 'string') result.excludeText = '';
  // An empty list is intentional; only older saves inherit the bracket setting.
  if (typeof raw.omitCharacters !== 'string') result.omitCharacters = raw.stripBrackets === false ? '' : defaults.omitCharacters;
  // Older saves predate the default terms. Merge them once; later edits win.
  if (raw.excludeSeed !== 1) {
    const missing = TTS_DEFAULT_EXCLUDES.filter(term => !ttsExcludeTerms(result.excludeText).includes(term));
    if (missing.length) result.excludeText = [result.excludeText.trim(), missing.join(', ')].filter(Boolean).join(', ');
    result.excludeSeed = 1;
  }
  if (typeof result.translation.narrationLanguage !== 'string') result.translation.narrationLanguage = '';
  const clamp = (n: number, min: number, max: number, fallback: number) => Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
  result.rate = clamp(result.rate, .25, 4, 1);
  result.skipChars = Math.floor(clamp(result.skipChars, 0, 8000, 1));
  result.volume = clamp(result.volume, 0, 1, .8);
  result.concurrency = Math.floor(clamp(result.concurrency, 1, 5, 5));
  result.background = Math.floor(clamp(result.background, 1, result.concurrency, 5));
  result.prefetch = Math.floor(clamp(result.prefetch, 0, 50, 50));
  result.cacheMb = clamp(result.cacheMb, 1, 2000, 100);
  result.rates = Array.isArray(result.rates) ? [...new Set(result.rates.filter(v => Number.isFinite(v) && v >= .25 && v <= 4))].sort((a, b) => a - b).slice(0, 32) : defaults.rates;
  if (!result.rates.length) result.rates = defaults.rates;
  if (!['all', 'chat', 'global'].includes(result.characterFilter)) result.characterFilter = 'all';
  if (typeof result.characterFolder !== 'string') result.characterFolder = '*';
  if (result.viewerAnchor && (!Number.isFinite(result.viewerAnchor.right) || !Number.isFinite(result.viewerAnchor.top))) result.viewerAnchor = null;
  return result;
}
/** Voices the assignment engines may pick from: the folder chosen in the character tab (all voices if it is empty). */
export function ttsCandidateVoices(): TtsVoice[] {
  const { voices, settings } = ttsData(), folder = settings.characterFolder;
  const pool = folder === '*' ? voices : voices.filter(v => v.folder === folder);
  return pool.length ? pool : voices;
}
export function loadTtsData(): Promise<TtsData> {
  if (state) return Promise.resolve(state);
  if (loading) return loading;
  loading = (async () => {
    const raw: unknown = await psGet(TTS_DATA_KEY);
    if (raw == null || raw === '') {
      state = { version: 1, settings: ttsDefaults(), voices: parseVoiceImport(presets), folders: [], characters: [] };
    } else {
      const value = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Partial<TtsData>;
      if (value.version !== 1 || !value.settings || !Array.isArray(value.voices) || !Array.isArray(value.characters) || !Array.isArray(value.folders)) throw new Error('TTS 저장 데이터 형식을 확인할 수 없습니다. 원본은 변경하지 않았습니다.');
      const strings = (v: unknown): boolean => Array.isArray(v) && v.every(s => typeof s === 'string');
      if (!value.voices.every(v => v && typeof v.key === 'string' && typeof v.name === 'string' && typeof v.fishId === 'string' && strings(v.tags) && ['female','male','unknown'].includes(v.gender) && typeof v.folder === 'string') ||
          !value.characters.every(validTtsCharacter) || !strings(value.folders)) throw new Error('TTS 목록 데이터가 손상되어 읽을 수 없습니다. 원본은 변경하지 않았습니다.');
      // 1.2.0 scoped characters to one chat. They now belong to the bot and
      // move into its lorebook the first time that bot is opened.
      const characters = value.characters.map(c => { const bot = legacyChatBot(c.scope); return bot ? { ...c, scope: ttsBotScope(bot) } : c; });
      const voices = value.voices.map(voice => {
        const error = voice.error;
        if (!error || Number.isInteger(error.count) && error.count > 0 && Number.isFinite(error.lastAt) && error.lastAt >= 0 && Number.isInteger(error.status) && error.status >= 400 && error.status <= 599) return voice;
        const clean = { ...voice }; delete clean.error; return clean;
      });
      state = { version: 1, settings: normalizeTtsSettings(value.settings), voices, characters, folders: value.folders };
    }
    state.characters = ensureTtsRoleCards(state.characters, 'global', state.voices, state.settings.narrationVoice, state.settings.translation.narrationLanguage);
    return state;
  })().finally(() => { loading = undefined; });
  return loading;
}
function legacyChatBot(scope: string): string {
  if (!scope.startsWith('[')) return '';
  try { const ids: unknown = JSON.parse(scope); return Array.isArray(ids) && typeof ids[0] === 'string' ? ids[0] : ''; } catch { return ''; }
}
// Bots whose lorebook was read: their rows are written there, not to plugin storage.
const loadedBots = new Map<string, string>(), botLoads = new Map<string, Promise<void>>();
export function ensureBotTtsCharacters(characterId: string): Promise<void> {
  if (!characterId) return Promise.resolve();
  const running = botLoads.get(characterId); if (running) return running;
  const task = (async () => {
    const data = await loadTtsData(), scope = ttsBotScope(characterId);
    const stored = await readBotTtsCharacters(characterId);
    if (!stored) { botLoads.delete(characterId); return; }
    const legacy = data.characters.filter(c => c.scope === scope && !stored.some(row => row.id === c.id));
    data.characters = [...data.characters.filter(c => c.scope !== scope), ...stored, ...legacy];
    loadedBots.set(characterId, JSON.stringify(stored));
    await saveTtsData();
  })();
  botLoads.set(characterId, task);
  task.catch(() => { if (botLoads.get(characterId) === task) botLoads.delete(characterId); });
  return task;
}
export function saveTtsData(): Promise<void> {
  const snapshot = JSON.parse(JSON.stringify(ttsData())) as TtsData;
  snapshot.characters = snapshot.characters.filter(c => !(String(c.scope).startsWith('bot:') && loadedBots.has(String(c.scope).slice(4))));
  for (const subscriber of subscribers) subscriber();
  const result = saveTail.catch(() => {}).then(async () => {
    // Lorebooks first: a bot's legacy rows leave plugin storage only after its
    // lorebook holds them.
    for (const [id, written] of loadedBots) {
      const rows = ttsData().characters.filter(c => c.scope === ttsBotScope(id)), json = JSON.stringify(rows);
      if (json === written) continue;
      await writeBotTtsCharacters(id, rows); loadedBots.set(id, json);
    }
    if (!await psSet(TTS_DATA_KEY, snapshot)) throw new Error('TTS 설정 저장에 실패했습니다.');
  });
  saveTail = result;
  return result;
}
export function updateTtsSettings(patch: Partial<TtsSettings>): Promise<void> {
  ttsData().settings = normalizeTtsSettings({ ...ttsData().settings, ...patch });
  return saveTtsData();
}
