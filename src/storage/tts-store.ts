import { geminiPrebuiltVoices } from '../domain/tts/gemini-voices';
import type { TtsCharacter, TtsData, TtsSettings, TtsVoice } from '../core/tts-types';
import { ownVoiceEngine, ownVoices } from '../domain/tts/engine-voice';
import { irodoriPresetRows } from '../domain/tts/irodori-presets';
import { ttsDefaults, TTS_DEFAULT_EXCLUDES } from '../config/tts-defaults';
import { parseVoiceImport } from '../domain/tts/library';
import { ensureTtsRoleCards } from '../domain/tts/identity';
import { psGet, psSet } from './device-store';
import { presetVoiceRows, upgradedPresetTags } from '../domain/tts/voice-words';
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
  const result = { ...defaults, ...raw, fish: { ...defaults.fish, ...raw.fish }, irodori: { ...defaults.irodori, ...raw.irodori }, llm: { ...defaults.llm, ...raw.llm },
    translation: { ...defaults.translation, ...raw.translation, llm: { ...defaults.translation.llm, ...raw.translation?.llm } },
    jev: { ...defaults.jev, ...raw.jev } };
  for (const field of Object.keys(defaults) as (keyof TtsSettings)[]) if (typeof defaults[field] === 'boolean' && typeof result[field] !== 'boolean') Object.assign(result, { [field]: defaults[field] });
  if (typeof result.excludeText !== 'string') result.excludeText = '';
  if (typeof result.jevNote !== 'string') result.jevNote = '';
  // 화자 이름 숨기기 once hid the emoji before the name as well: a save from then keeps its screen as it was.
  if (typeof raw.hideEmoji !== 'boolean') result.hideEmoji = result.hideName;
  // An empty list is intentional; only older saves inherit the bracket setting.
  if (typeof raw.omitCharacters !== 'string') result.omitCharacters = raw.stripBrackets === false ? '' : defaults.omitCharacters;
  // Older saves predate the default terms. Merge them once; later edits win.
  if (raw.excludeSeed !== 1) {
    const missing = TTS_DEFAULT_EXCLUDES.filter(term => !ttsExcludeTerms(result.excludeText).includes(term));
    if (missing.length) result.excludeText = [result.excludeText.trim(), missing.join(', ')].filter(Boolean).join(', ');
    result.excludeSeed = 1;
  }
  if (typeof result.tone !== 'string') result.tone = '';
  // Older saves read (작게) to Fish as a delivery tag. Add ( and ) once, and only them; a list
  // emptied on purpose stays empty, and removing them later sticks.
  if (raw.omitSeed !== 1) {
    const missing = result.omitCharacters.trim() ? ['(', ')'].filter(term => !ttsExcludeTerms(result.omitCharacters).includes(term)) : [];
    if (missing.length) result.omitCharacters = [result.omitCharacters.trim(), missing.join(', ')].filter(Boolean).join(', ');
    result.omitSeed = 1;
  }
  if (typeof result.translation.narrationLanguage !== 'string') result.translation.narrationLanguage = '';
  // Google and DeepL once shared one key: switched away and back, the other's empty field wrote over it.
  const translation = result.translation;
  // Read off the save itself: the defaults fill both fields in, which would hide an older save's one key.
  if (typeof raw.translation?.googleKey !== 'string') translation.googleKey = translation.provider === 'google' ? translation.key : '';
  if (typeof raw.translation?.deeplKey !== 'string') translation.deeplKey = translation.provider === 'deepl' ? translation.key : '';
  if (!['llm', 'jev', 'embedding'].includes(result.selector)) result.selector = defaults.selector;
  const clamp = (n: number, min: number, max: number, fallback: number) => Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
  result.rate = clamp(result.rate, .25, 4, 1);
  result.skipChars = Math.floor(clamp(result.skipChars, 0, 8000, 1));
  result.volume = clamp(result.volume, 0, 1, .8);
  // Until it is set, narration is as loud as the voice (older saves have none).
  result.narrationVolume = typeof result.narrationVolume === 'number' && Number.isFinite(result.narrationVolume) ? clamp(result.narrationVolume, 0, 1, result.volume) : null;
  if (!['off', 'light', 'medium', 'strong'].includes(result.thoughtEcho)) result.thoughtEcho = 'off';
  result.concurrency = Math.floor(clamp(result.concurrency, 1, 5, 5));
  result.background = Math.floor(clamp(result.background, 1, result.concurrency, 5));
  result.prefetch = Math.floor(clamp(result.prefetch, 0, 50, 50));
  result.cacheMb = clamp(result.cacheMb, 1, 2000, 100);
  result.rates = Array.isArray(result.rates) ? [...new Set(result.rates.filter(v => Number.isFinite(v) && v >= .25 && v <= 4))].sort((a, b) => a - b).slice(0, 32) : defaults.rates;
  if (!result.rates.length) result.rates = defaults.rates;
  if (!['all', 'chat', 'global'].includes(result.characterFilter)) result.characterFilter = 'all';
  if (typeof result.characterFolder !== 'string') result.characterFolder = '*';
  // The preview name was never a real model id; Fish documents it as drama-3.
  if (result.fish.model === 'drama-3-preview') result.fish.model = 'drama-3';
  result.fish = { ...defaults.fish, ...result.fish };
  if (result.fish.via !== 'openrouter') result.fish.via = 'fish';
  if (typeof result.fish.routerKey !== 'string') result.fish.routerKey = '';
  if (result.engine !== 'irodori' && result.engine !== 'gemini' && result.engine !== 'elevenlabs') result.engine = 'fish';
  result.eleven = { ...defaults.eleven, ...result.eleven };
  for (const field of ['key', 'model', 'voice'] as const) if (typeof result.eleven[field] !== 'string') result.eleven[field] = defaults.eleven[field];
  if (!result.eleven.model.trim()) result.eleven.model = defaults.eleven.model;
  result.eleven.listed = result.eleven.listed === true; result.eleven.concurrency = Math.floor(clamp(result.eleven.concurrency, 1, 5, 3));
  result.gemini = { ...defaults.gemini, ...result.gemini };
  for (const field of ['key', 'serviceAccountJson', 'location', 'model', 'voice'] as const) if (typeof result.gemini[field] !== 'string') result.gemini[field] = defaults.gemini[field];
  if (result.gemini.via !== 'vertex') result.gemini.via = 'studio';
  result.gemini.persona = result.gemini.persona !== false; result.gemini.assign = result.gemini.assign === 'list' || result.gemini.assign === 'embedding' ? result.gemini.assign : 'design'; result.gemini.listed = result.gemini.listed === true;
  result.gemini.concurrency = Math.floor(clamp(result.gemini.concurrency, 1, 5, 3));
  for (const field of ['url', 'key', 'model', 'voice'] as const) if (typeof result.irodori[field] !== 'string') result.irodori[field] = defaults.irodori[field];
  if (result.irodori.format !== 'wav') result.irodori.format = 'mp3';
  result.irodori.concurrency = Math.floor(clamp(result.irodori.concurrency, 1, 5, 1));
  if (result.viewerAnchor && (!Number.isFinite(result.viewerAnchor.right) || !Number.isFinite(result.viewerAnchor.top))) result.viewerAnchor = null;
  return result;
}
/** The engine in use; Fish until the data is read (the settings markup is built before the mount reads it). */
export function ttsEngine(): TtsSettings['engine'] { const engine = state?.settings.engine; return engine === 'irodori' || engine === 'gemini' || engine === 'elevenlabs' ? engine : 'fish'; }
/** The voice presets of the engine in use: Fish's library, or Irodori's own. */
export function ttsEngineVoices(): TtsVoice[] { const data = ttsData(); return ownVoiceEngine(data.settings.engine) ? ownVoices(data, data.settings.engine) : data.voices; }
/**
 * Voices the assignment engines may pick from: the folder chosen in the character tab (all voices if it is empty);
 * with Irodori, its presets (they have no folders).
 */
const GEMINI_CANDIDATES = 240;
/** A long preset list as a model is asked it: the least used first, a couple of hundred in all. */
function leastUsed(all: TtsVoice[], keyOf: (c: TtsCharacter) => string | undefined): TtsVoice[] {
  if (all.length <= GEMINI_CANDIDATES) return all;
  const uses = new Map<string, number>();
  for (const c of ttsData().characters) { const key = keyOf(c); if (key) uses.set(key, (uses.get(key) ?? 0) + 1); }
  return all.map((voice, i) => ({ voice, i, used: uses.get(voice.key) ?? 0 })).sort((a, b) => a.used - b.used || a.i - b.i).slice(0, GEMINI_CANDIDATES).map(row => row.voice);
}
export function ttsCandidateVoices(): TtsVoice[] {
  if (ttsData().settings.engine === 'irodori') return ttsData().irodoriVoices;
  // ElevenLabs: the account's voices, a few dozen to a few hundred; the same cut as Gemini's when it is long.
  if (ttsData().settings.engine === 'elevenlabs') return leastUsed(ttsData().elevenVoices, c => c.elevenKey);
  // Gemini's list can be hundreds long: a model is asked among the designed ones, then the least used, a couple of
  // hundred in all (the whole list in one prompt is more than it reads well).
  if (ttsData().settings.engine === 'gemini') return leastUsed(ttsData().geminiVoices, c => c.geminiKey);
  const { voices, settings } = ttsData(), folder = settings.characterFolder;
  const pool = folder === '*' ? voices : voices.filter(v => v.folder === folder);
  return pool.length ? pool : voices;
}
/**
 * Gemini's presets as saved; none saved (an older save, or every one removed), the prebuilt ones: Gemini speaks with
 * them whatever a list holds.
 */
function geminiPresetRows(raw: unknown): TtsVoice[] {
  const rows = listedPresetRows(raw);
  return rows.length ? rows : geminiPrebuiltVoices();
}
/** Presets read from a service's voice list (Gemini's, ElevenLabs's): a preset's fields and the languages it speaks. */
function listedPresetRows(raw: unknown): TtsVoice[] {
  return irodoriPresetRows(raw).map((row, i) => { const langs = (raw as Array<{ languages?: unknown }>)[i]?.languages; return Array.isArray(langs) ? { ...row, languages: langs.filter((l): l is string => typeof l === 'string').slice(0, 8) } : row; });
}
export function loadTtsData(): Promise<TtsData> {
  if (state) return Promise.resolve(state);
  if (loading) return loading;
  loading = (async () => {
    const raw: unknown = await psGet(TTS_DATA_KEY);
    if (raw == null || raw === '') {
      state = { version: 1, settings: ttsDefaults(), voices: parseVoiceImport(presetVoiceRows()), folders: [], characters: [], irodoriVoices: [], geminiVoices: geminiPrebuiltVoices(), elevenVoices: [] };
    } else {
      const value = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Partial<TtsData>;
      if (value.version !== 1 || !value.settings || !Array.isArray(value.voices) || !Array.isArray(value.characters) || !Array.isArray(value.folders)) throw new Error('TTS 저장 데이터 형식을 확인할 수 없습니다. 원본은 변경하지 않았습니다.');
      const strings = (v: unknown): boolean => Array.isArray(v) && v.every(s => typeof s === 'string');
      if (!value.voices.every(v => v && typeof v.key === 'string' && typeof v.name === 'string' && typeof v.fishId === 'string' && strings(v.tags) && ['female','male','unknown'].includes(v.gender) && typeof v.folder === 'string') ||
          !value.characters.every(validTtsCharacter) || !strings(value.folders)) throw new Error('TTS 목록 데이터가 손상되어 읽을 수 없습니다. 원본은 변경하지 않았습니다.');
      // 1.2.0 scoped characters to one chat. They now belong to the bot and
      // move into its lorebook the first time that bot is opened.
      const characters = value.characters.map(c => { const bot = legacyChatBot(c.scope); return bot ? { ...c, scope: ttsBotScope(bot) } : c; });
      // A sample voice still on the tags it first shipped with takes the finer ones (age, pitch, timbre).
      const voices = value.voices.map(row => { const tags = upgradedPresetTags(row); return tags === row.tags ? row : { ...row, tags }; }).map(voice => {
        const error = voice.error;
        if (!error || Number.isInteger(error.count) && error.count > 0 && Number.isFinite(error.lastAt) && error.lastAt >= 0 && Number.isInteger(error.status) && error.status >= 400 && error.status <= 599) return voice;
        const clean = { ...voice }; delete clean.error; return clean;
      });
      state = { version: 1, settings: normalizeTtsSettings(value.settings), voices, characters, folders: value.folders, irodoriVoices: irodoriPresetRows(value.irodoriVoices), geminiVoices: geminiPresetRows(value.geminiVoices), elevenVoices: listedPresetRows(value.elevenVoices) };
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
/** How loud a line of this kind plays: narration at its own level once set, everything else (and it until then) at the voice's. */
export const ttsVolumeOf = (s: Pick<TtsSettings, 'volume' | 'narrationVolume'>, kind?: string): number => kind === 'narration' && s.narrationVolume !== null ? s.narrationVolume : s.volume;
export function updateTtsSettings(patch: Partial<TtsSettings>): Promise<void> {
  ttsData().settings = normalizeTtsSettings({ ...ttsData().settings, ...patch });
  return saveTtsData();
}
