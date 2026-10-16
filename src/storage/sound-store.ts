import type { SfxRule, SfxTerm, SoundData, SoundItem, SoundKind, SoundSettings } from '../core/sound-types';
import { soundDefaults } from '../config/sound-defaults';
import { sampleSoundData } from '../config/sound-samples';
import { psGet, psSet } from './device-store';
import { soundTags } from '../domain/sound/tags';
import { sfxMarksFromPattern, sfxMarksProblem } from '../domain/sound/audio';

/** BGM and effect lists, glossary and settings. Files live in the two sound modules. */
export const SOUND_DATA_KEY = 'omnisound.data';
let state: SoundData | undefined;
let loading: Promise<SoundData> | undefined;
let saveTail: Promise<void> = Promise.resolve();
const subscribers = new Set<() => void>();
export function subscribeSound(callback: () => void): () => void { subscribers.add(callback); return () => subscribers.delete(callback); }
/** False until the stored data has been read; callers that run early check it first. */
export const soundReady = (): boolean => !!state;
export function soundData(): SoundData {
  if (!state) throw new Error('BGM·효과음 설정을 아직 불러오지 않았습니다.');
  return state;
}

const text = (v: unknown, max = 500) => typeof v === 'string' ? v.slice(0, max) : '';
const clamp = (n: unknown, min: number, max: number, fallback: number) => Number.isFinite(Number(n)) ? Math.max(min, Math.min(max, Number(n))) : fallback;
const MATCHERS = ['auto', 'tag', 'embedding', 'jev', 'llm'] as const;

function item(raw: unknown, kind: SoundKind): SoundItem | null {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const key = text(r.key, 80), name = text(r.name, 120).trim();
  const source = r.source === 'asset' ? 'asset' : 'url';
  if (!key || !name) return null;
  if (source === 'url' && !/^https:\/\//i.test(text(r.url, 2000))) return null;
  if (source === 'asset' && (!text(r.assetName) || !text(r.assetPath))) return null;
  return {
    key, kind, name, tags: soundTags(Array.isArray(r.tags) ? r.tags.map(String) : []), folder: text(r.folder, 80), source,
    ...(source === 'url' ? { url: text(r.url, 2000) } : { assetName: text(r.assetName), assetPath: text(r.assetPath) }),
    ...(text(r.mime, 40) ? { mime: text(r.mime, 40) } : {}), ...(Number.isFinite(Number(r.bytes)) ? { bytes: Number(r.bytes) } : {}),
  };
}
function rule(raw: unknown): SfxRule | null {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const id = text(r.id, 80);
  if (!id) return null;
  // A rule saved as a regex (before marks) keeps the marks it was written around.
  const open = typeof r.open === 'string' ? r.open : '', close = typeof r.close === 'string' ? r.close : '';
  const marks = !sfxMarksProblem(open, close) ? { open, close } : sfxMarksFromPattern(typeof r.pattern === 'string' ? r.pattern : '');
  return { id, name: text(r.name, 80) || '규칙', ...marks, enabled: r.enabled !== false };
}
function term(raw: unknown): SfxTerm | null {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const id = text(r.id, 80), terms = soundTags(Array.isArray(r.terms) ? r.terms.map(String) : []);
  return id && terms.length ? { id, terms, sfxKey: text(r.sfxKey, 80), enabled: r.enabled !== false } : null;
}
export function normalizeSoundSettings(raw: Partial<SoundSettings>): SoundSettings {
  const d = soundDefaults(), s = { ...d, ...raw };
  for (const key of ['bgmEnabled', 'sfxEnabled', 'bgmPrompt', 'listBgm', 'listSfx', 'viewerBgm', 'sfxAutoCreate', 'sfxCue', 'sfxFirst', 'sfxTrim', 'sfxNormalize'] as const) if (typeof s[key] !== 'boolean') (s as Record<string, unknown>)[key] = d[key];
  s.sfxMaxSec = Math.round(clamp(s.sfxMaxSec, 0, 60, d.sfxMaxSec));
  s.bgmVolume = clamp(s.bgmVolume, 0, 1, d.bgmVolume); s.sfxVolume = clamp(s.sfxVolume, 0, 1, d.sfxVolume);
  s.duck = clamp(s.duck, 0, 1, d.duck); s.crossfadeMs = Math.round(clamp(s.crossfadeMs, 0, 10_000, d.crossfadeMs));
  s.maxFileMb = clamp(s.maxFileMb, 1, 50, d.maxFileMb);
  s.sfxDuration = clamp(s.sfxDuration, 0, 30, 0);
  s.elevenKey = text(s.elevenKey, 200); s.sfxPrompt = text(s.sfxPrompt, 400) || d.sfxPrompt;
  for (const key of ['bgmMatcher', 'sfxMatcher'] as const) if (!MATCHERS.includes(s[key])) s[key] = d[key];
  if (s.sfxAutoPlay !== 'reply' && s.sfxAutoPlay !== 'button') s.sfxAutoPlay = d.sfxAutoPlay;
  if (!['tags', 'message', 'both'].includes(s.bgmBasis)) s.bgmBasis = d.bgmBasis;
  s.bgmTags = soundTags(Array.isArray(s.bgmTags) ? s.bgmTags : d.bgmTags); if (!s.bgmTags.length) s.bgmTags = d.bgmTags;
  s.sfxRules = Array.isArray(s.sfxRules) ? s.sfxRules.map(rule).filter((r): r is SfxRule => !!r).slice(0, 40) : d.sfxRules;
  return s;
}
export function normalizeSoundData(raw: unknown): SoundData {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const list = (v: unknown, kind: SoundKind) => (Array.isArray(v) ? v : []).map(x => item(x, kind)).filter((x): x is SoundItem => !!x);
  const folders = (r.folders && typeof r.folders === 'object' ? r.folders : {}) as Record<string, unknown>;
  const names = (v: unknown) => [...new Set((Array.isArray(v) ? v : []).map(x => text(x, 80).trim()).filter(Boolean))];
  return {
    version: 1, settings: normalizeSoundSettings((r.settings || {}) as Partial<SoundSettings>),
    bgm: list(r.bgm, 'bgm'), sfx: list(r.sfx, 'sfx'),
    glossary: (Array.isArray(r.glossary) ? r.glossary : []).map(term).filter((x): x is SfxTerm => !!x),
    unknownTerms: names(r.unknownTerms).slice(0, 200), folders: { bgm: names(folders.bgm), sfx: names(folders.sfx) },
  };
}
export function loadSoundData(): Promise<SoundData> {
  if (state) return Promise.resolve(state);
  return loading ||= (async () => {
    const raw = await psGet(SOUND_DATA_KEY);
    // Nothing saved yet is a first run: it starts with the example lists. A save
    // whose lists were emptied is not, so the examples never come back by themselves.
    state = normalizeSoundData(raw == null || raw === '' ? sampleSoundData() : typeof raw === 'string' ? JSON.parse(raw) : raw);
    return state;
  })().finally(() => { loading = undefined; });
}
export function saveSoundData(): Promise<void> {
  const snapshot = JSON.parse(JSON.stringify(soundData())) as SoundData;
  const result = saveTail.catch(() => {}).then(async () => {
    if (!await psSet(SOUND_DATA_KEY, snapshot)) throw new Error('BGM·효과음 설정 저장에 실패했습니다.');
  });
  saveTail = result;
  for (const callback of subscribers) callback();
  return result;
}
export function updateSoundSettings(patch: Partial<SoundSettings>): Promise<void> {
  soundData().settings = normalizeSoundSettings({ ...soundData().settings, ...patch });
  return saveSoundData();
}
/** Test seam: forget the loaded state. */
export function resetSoundStore(): void { state = undefined; loading = undefined; saveTail = Promise.resolve(); }
