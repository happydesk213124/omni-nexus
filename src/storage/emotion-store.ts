import { baseExpression, EMOTION_EXCLUDE_DEFAULT, NUDE_COSTUME } from '../domain/emotion/emotions';
import { psGet, psSet } from './device-store';

/**
 * TTS · 감정 에셋: settings, the faces each TTS character has shown, and the
 * sprites Omni made. The images themselves are the bot's character assets.
 */
export const EMOTION_DATA_KEY = 'omniemotion.data';
export type EmotionFamily = 'v5' | 'v4';
export interface EmotionSettings {
  /** Sprites are looked up and shown (the viewer); off, nothing is read or made. */
  enabled: boolean;
  /** Images already in the bot (its assets, emotion images, enabled modules) come first. */
  useExisting: boolean;
  /** A face the viewer needs and nobody has is made in the background. */
  autoGenerate: boolean;
  /** The place each reply opens in becomes a background with nobody in it (the viewer's stage). */
  placeBackgrounds: boolean;
  family: EmotionFamily;
  /** NAI V5 effort for faces: the illustration settings', or its own (medium: faster, uses less). */
  effort: 'follow' | 'high' | 'medium';
  width: number;
  height: number;
  prefix: string;
  suffix: string;
  /** 이 태그가 들어가면 빼기: taken out of the preset and the looks, never out of `prefix` and `suffix`. Empty: nothing is. */
  excludeTags: string;
  /** 무기/기타 태그 빼기: the roster's accessories stay out of a standing portrait. */
  dropAccessories: boolean;
  pose: string;
  /** V5 only: a transparent background instead of a white one. */
  transparent: boolean;
  /**
   * 코스튬별 에셋: a cue naming a costume (`이름_2`) shows that costume's faces, and the writer is asked to name
   * it. Only with streaming tags and costumes on (the writer sees the costume list then).
   */
  costumes: boolean;
  /**
   * 기본 nude: everyone has a nude costume besides theirs (`이름_nude`, the default one's looks with the clothes and the
   * 무기/기타 left out), and the writer is asked to name it while they are naked. Only with streaming tags (the writer
   * sees the rule then). Whoever is written as under 18 (underage.ts) is never drawn in it (nudeForbidden).
   */
  nude: boolean;
  /** 천박모드: every face shown is the nude one, whatever costume a line names, and no other costume's is drawn. Nobody under 18 likewise. */
  nudeAll: boolean;
  /** Base face → its tags, where the user changed them. */
  faceTags: Record<string, string>;
  /** More words → a base face (`pouting` → `sad`). */
  words: Record<string, string>;
}
/** A sprite Omni saved. `registered`: it is in the bot's asset list (writes wait for a reply to end). `costume`: not the default one's. */
export interface EmotionMade { bot: string; person: string; face: string; name: string; path: string; registered: boolean; at: number; costume?: number }
export interface EmotionData { settings: EmotionSettings; seen: Record<string, string[]>; made: EmotionMade[] }

export const emotionDefaults = (): EmotionSettings => ({
  enabled: true, useExisting: true, autoGenerate: true, placeBackgrounds: true, family: 'v5', effort: 'follow', width: 832, height: 1216,
  prefix: '', suffix: '', excludeTags: EMOTION_EXCLUDE_DEFAULT, dropAccessories: false, pose: '', transparent: true, costumes: false, nude: false, nudeAll: false, faceTags: {}, words: {},
});

let state: EmotionData | undefined;
let loading: Promise<EmotionData> | undefined;
let saveTail: Promise<void> = Promise.resolve();
const subscribers = new Set<() => void>();
export function subscribeEmotion(callback: () => void): () => void { subscribers.add(callback); return () => subscribers.delete(callback); }
export const emotionReady = (): boolean => !!state;
export function emotionData(): EmotionData {
  if (!state) throw new Error('감정 에셋 설정을 아직 불러오지 않았습니다.');
  return state;
}

const text = (v: unknown, max: number): string => typeof v === 'string' ? v.slice(0, max) : '';
const record = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const size = (v: unknown, fallback: number): number => {
  const n = Math.round(Number(v) / 64) * 64;
  return Number.isFinite(n) && n >= 512 && n <= 1600 ? n : fallback;
};
export function normalizeEmotionSettings(raw: unknown): EmotionSettings {
  const d = emotionDefaults(), r = record(raw);
  const strings = (v: unknown, keep: (key: string, value: string) => boolean) => Object.fromEntries(Object.entries(record(v))
    .map(([k, value]) => [k.normalize('NFKC').toLowerCase().trim().slice(0, 40), text(value, 400).trim()] as const)
    .filter(([k, value]) => k && value && keep(k, value)).slice(0, 200));
  return {
    enabled: r.enabled !== false, useExisting: r.useExisting !== false, autoGenerate: r.autoGenerate !== false, placeBackgrounds: r.placeBackgrounds !== false,
    family: r.family === 'v4' ? 'v4' : 'v5', effort: r.effort === 'high' || r.effort === 'medium' ? r.effort : 'follow', width: size(r.width, d.width), height: size(r.height, d.height),
    prefix: text(r.prefix, 2000), suffix: text(r.suffix, 2000), excludeTags: typeof r.excludeTags === 'string' ? text(r.excludeTags, 2000) : d.excludeTags, dropAccessories: r.dropAccessories === true, pose: text(r.pose, 600), transparent: r.transparent !== false, costumes: r.costumes === true,
    nude: r.nude === true, nudeAll: r.nudeAll === true,
    faceTags: strings(r.faceTags, () => true), words: strings(r.words, (_k, value) => !!baseExpression(value)),
  };
}
export function normalizeEmotionData(raw: unknown): EmotionData {
  const r = record(raw);
  const seen = Object.fromEntries(Object.entries(record(r.seen)).map(([id, faces]) => [id.slice(0, 120),
    [...new Set((Array.isArray(faces) ? faces : []).map(f => text(f, 40)).filter(Boolean))].slice(0, 60)] as const).filter(([id, faces]) => id && faces.length).slice(0, 500));
  const made = (Array.isArray(r.made) ? r.made : []).map(record).map(m => ({
    // A background's face is its place tags, far past a face's 40: cut there, it never matched again after a reload.
    bot: text(m.bot, 200), person: text(m.person, 120), face: text(m.face, 400), name: text(m.name, 200), path: text(m.path, 800),
    registered: m.registered === true, at: Number(m.at) || 0,
    ...(Number.isInteger(m.costume) && Number(m.costume) > 0 && (Number(m.costume) < 100 || m.costume === NUDE_COSTUME) ? { costume: Number(m.costume) } : {}),
  })).filter(m => m.bot && m.name && m.path).slice(-2000);
  return { settings: normalizeEmotionSettings(r.settings), seen, made };
}

export function loadEmotionData(): Promise<EmotionData> {
  if (state) return Promise.resolve(state);
  loading ??= (async () => { state = normalizeEmotionData(await psGet(EMOTION_DATA_KEY)); return state; })().finally(() => { loading = undefined; });
  return loading;
}
export function saveEmotionData(): Promise<void> {
  const snapshot = JSON.parse(JSON.stringify(emotionData())) as EmotionData;
  const result = saveTail.catch(() => {}).then(async () => {
    if (!await psSet(EMOTION_DATA_KEY, snapshot)) throw new Error('감정 에셋 설정 저장에 실패했습니다.');
  });
  saveTail = result;
  for (const callback of subscribers) callback();
  return result;
}
export async function updateEmotionSettings(patch: Partial<EmotionSettings>): Promise<void> {
  const data = await loadEmotionData();
  data.settings = normalizeEmotionSettings({ ...data.settings, ...patch });
  await saveEmotionData();
}
/** Faces a TTS character has shown. Returns true when one was new (the caller saves when it suits). */
export function noteSeenFaces(ttsCharacterId: string, faces: readonly string[]): boolean {
  const data = emotionData(), id = ttsCharacterId.slice(0, 120);
  if (!id || !faces.length) return false;
  const known = new Set(data.seen[id] || []), before = known.size;
  for (const face of faces) if (face) known.add(face.slice(0, 40));
  if (known.size === before) return false;
  data.seen[id] = [...known].slice(-60);
  return true;
}
export function resetEmotionStore(): void { state = undefined; loading = undefined; saveTail = Promise.resolve(); }
