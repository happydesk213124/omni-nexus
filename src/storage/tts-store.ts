import type { TtsData, TtsSettings } from '../core/tts-types';
import { ttsDefaults } from '../config/tts-defaults';
import { parseVoiceImport } from '../domain/tts/library';
import { psGet, psSet } from './device-store';
import presets from '../config/tts-presets.json';

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
  const clamp = (n: number, min: number, max: number, fallback: number) => Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
  result.rate = clamp(result.rate, .25, 4, 1);
  result.volume = clamp(result.volume, 0, 1, .8);
  result.concurrency = Math.floor(clamp(result.concurrency, 1, 5, 5));
  result.background = Math.floor(clamp(result.background, 1, result.concurrency, 5));
  result.prefetch = Math.floor(clamp(result.prefetch, 0, 50, 50));
  result.cacheMb = clamp(result.cacheMb, 1, 2000, 100);
  result.rates = Array.isArray(result.rates) ? [...new Set(result.rates.filter(v => Number.isFinite(v) && v >= .25 && v <= 4))].sort((a, b) => a - b).slice(0, 32) : defaults.rates;
  if (!result.rates.length) result.rates = defaults.rates;
  if (result.viewerAnchor && (!Number.isFinite(result.viewerAnchor.right) || !Number.isFinite(result.viewerAnchor.top))) result.viewerAnchor = null;
  return result;
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
          !value.characters.every(c => c && ['id','scope','name','surname','givenName','voiceKey','fishId'].every(k => typeof (c as unknown as Record<string,unknown>)[k] === 'string') && strings(c.triggers) && strings(c.tags) && strings(c.surnameAliases) && strings(c.givenAliases) && ['female','male','unknown'].includes(c.gender) && typeof c.fixed === 'boolean' && Number.isFinite(c.gain)) || !strings(value.folders)) throw new Error('TTS 목록 데이터가 손상되어 읽을 수 없습니다. 원본은 변경하지 않았습니다.');
      state = { version: 1, settings: normalizeTtsSettings(value.settings), voices: value.voices, characters: value.characters, folders: value.folders };
    }
    return state;
  })().finally(() => { loading = undefined; });
  return loading;
}
export function saveTtsData(): Promise<void> {
  const snapshot = JSON.parse(JSON.stringify(ttsData())) as TtsData;
  for (const subscriber of subscribers) subscriber();
  const result = saveTail.catch(() => {}).then(async () => {
    if (!await psSet(TTS_DATA_KEY, snapshot)) throw new Error('TTS 설정 저장에 실패했습니다.');
  });
  saveTail = result;
  return result;
}
export function updateTtsSettings(patch: Partial<TtsSettings>): Promise<void> {
  ttsData().settings = normalizeTtsSettings({ ...ttsData().settings, ...patch });
  return saveTtsData();
}
