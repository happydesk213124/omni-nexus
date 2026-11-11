/**
 * ⚡ 빠른 설정: a few answers, turned into the settings they mean. Pure, so the mapping is tested on its
 * own: the sheet reads the current settings into answers, asks, and writes what this returns. Anything
 * not asked about stays as it was (a feature left off is switched off and nothing else of it is touched).
 */
export type QuickFeature = 'image' | 'comic' | 'tts' | 'bgm' | 'sfx' | 'viewer';
export const QUICK_FEATURES: readonly QuickFeature[] = ['image', 'comic', 'tts', 'bgm', 'sfx', 'viewer'];
export type QuickKey = 'naiKey' | 'routerKey' | 'fishKey';
export interface QuickAnswers {
  features: QuickFeature[];
  /** Keys typed in: '' leaves the saved one. One OpenRouter key serves the helper model, JEV and embedding. */
  naiKey: string;
  fishKey: string;
  routerKey: string;
  /** stream: the chat model writes the image tags as it replies (as 그림삽화·아르곤 삽화모듈 do); tagger: the helper model reads the reply after. */
  tagMode: 'stream' | 'tagger';
  /** The model Omni asks for its own work: Risu's helper (보조) model, its main model, or one of its own on OpenRouter. */
  helper: 'aux' | 'main' | 'custom';
  helperModel: string;
  /** What picks voices, places and music for a scene: JEV, embedding, or the helper model and free guesses. */
  picker: 'jev' | 'embedding' | 'off';
  /** Images per reply: one, one to two, two to three, three to four. */
  images: 1 | 2 | 3 | 4;
  /** Beside illustrations: this share of the images are comics. Comics without illustrations are always all of them. */
  comicShare: 25 | 50 | 75 | 100;
  /** Comic pages carry the lines in speech bubbles. */
  speech: boolean;
  /** The 퀄리티 향상 author's note for the main tagger. */
  quality: boolean;
  /** TTS: a new reply is read at once (else only when ▶ is pressed). */
  ttsAuto: boolean;
  /** TTS: narration is read too (else the spoken lines alone). */
  narration: boolean;
  /** How an effect word finds its sound: the glossary and then the models, the embedding with the scene alone, or free word matching. */
  sfxMatcher: 'auto' | 'embedding-only' | 'tag';
}
export interface QuickPlan {
  settings: { card: Record<string, unknown>; nai?: { api_key: string }; llm?: Record<string, unknown> };
  tts: { enabled: boolean; selector: 'llm' | 'jev' | 'embedding'; autoReply?: boolean; narration?: boolean; fishKey?: string; jevKey?: string };
  sound: { bgmEnabled: boolean; sfxEnabled: boolean; sfxMatcher?: QuickAnswers['sfxMatcher']; embedKey?: string };
  emotion: { enabled: boolean };
  viewer: { bgPick: 'auto' | 'jev' | 'embedding' };
  quality: boolean;
}

/** JEV through OpenRouter, as the TTS model settings fill it in. */
export const JEV_OPENROUTER = { url: 'https://openrouter.ai/api/alpha/decisions', model: 'typesafe/jev-1.13', format: 'openrouter' } as const;
/** The 퀄리티 향상 example's id among the author's note presets. */
export const QUALITY_PRESET_ID = 'example-quality';

export const QUICK_IMAGES: Record<QuickAnswers['images'], readonly [number, number]> = { 1: [1, 1], 2: [1, 2], 3: [2, 3], 4: [3, 4] };
/** The images-per-reply answer a saved minimum and maximum read as. */
export function quickImagesOf(min: number, max: number): QuickAnswers['images'] {
  const top = Number(max) || 3, low = Number(min) || top;
  return top <= 1 ? 1 : top === 2 ? 2 : top === 3 ? (low <= 1 ? 2 : 3) : 4;
}
/** The comic share nearest a saved ratio. */
export function quickComicShareOf(ratio: number): QuickAnswers['comicShare'] {
  const r = Number(ratio);
  return !Number.isFinite(r) || r <= 0 ? 50 : r >= 88 ? 100 : r >= 63 ? 75 : r >= 38 ? 50 : 25;
}

const has = (a: QuickAnswers, feature: QuickFeature) => a.features.includes(feature);
export const quickDraws = (a: QuickAnswers): boolean => has(a, 'image') || has(a, 'comic');
export const quickSounds = (a: QuickAnswers): boolean => has(a, 'tts') || has(a, 'bgm') || has(a, 'sfx');
/** Something is picked for a scene on its own (a voice, a place, a track): only then does the picker matter. */
export const quickPicks = (a: QuickAnswers): boolean => quickSounds(a) || has(a, 'viewer');

/** The sheet's steps in order; one with nothing to ask (no pictures, no sound) is passed over. */
export type QuickStep = 'features' | 'draw' | 'sound' | 'models' | 'keys' | 'review';
export const QUICK_STEPS: readonly QuickStep[] = ['features', 'draw', 'sound', 'models', 'keys', 'review'];
export function quickStepSkipped(step: QuickStep, a: QuickAnswers): boolean {
  return step === 'draw' ? !quickDraws(a) : step === 'sound' ? !quickSounds(a) : false;
}

/** Which keys the answers call for, and what each is for. One not called for is left alone. */
export interface QuickKeyNeed { key: QuickKey; needed: boolean; why: string }
export function quickKeyNeeds(a: QuickAnswers): QuickKeyNeed[] {
  const draws = quickDraws(a), nai = [draws && (has(a, 'image') && has(a, 'comic') ? '삽화·만화' : has(a, 'comic') ? '만화' : '삽화'), has(a, 'viewer') && '옴니 뷰어 스탠딩'].filter(Boolean);
  const router = [a.helper === 'custom' && '보조 모델', quickPicks(a) && a.picker === 'jev' && 'JEV', (quickPicks(a) && a.picker === 'embedding' || has(a, 'sfx') && a.sfxMatcher === 'embedding-only') && '임베딩'].filter(Boolean);
  return [
    { key: 'naiKey', needed: nai.length > 0, why: nai.join(' · ') },
    { key: 'routerKey', needed: router.length > 0, why: router.join(' · ') },
    { key: 'fishKey', needed: has(a, 'tts'), why: has(a, 'tts') ? 'TTS 음성' : '' },
  ];
}
/** Whether a typed key looks like that service's keys: a hint under the field, never a refusal (formats change). */
export function quickKeyLooksRight(key: QuickKey, value: string): boolean {
  const v = value.trim();
  if (!v) return true;
  return key === 'naiKey' ? /^pst-[\w-]{20,}$/.test(v) : key === 'routerKey' ? /^sk-or-[\w-]{20,}$/.test(v) : /^[a-f\d]{32}$/i.test(v);
}

/**
 * `opened`: the answers the sheet opened with (the settings as they were, read into answers). Three answers are
 * coarser than the settings behind them (2~3장 for a saved 3~3, 반반 for a saved 40%, 자동 for a saved JEV): one left
 * as it opened is not written, so opening the sheet and applying it untouched changes none of them.
 */
export function planQuickSetup(a: QuickAnswers, helper: { endpoint: string; model: string }, opened?: QuickAnswers): QuickPlan {
  const draws = quickDraws(a), [min, max] = QUICK_IMAGES[a.images];
  const kept = (key: 'images' | 'comicShare' | 'sfxMatcher') => !!opened && opened[key] === a[key];
  const card: Record<string, unknown> = { power: draws };
  if (draws) {
    // Comics alone are every image: at 100% the tagger is told so (any share below leaves most of them illustrations).
    const share = has(a, 'image') ? (kept('comicShare') ? null : a.comicShare) : 100;
    Object.assign(card, kept('images') ? {} : { image_min: min, image_max: max },
      a.tagMode === 'stream' ? { stream_inline_tags: true, stream_inline_autogen: true } : { stream_inline_tags: false, auto_gen_on_reply: true },
      has(a, 'comic') ? { comic_gen: 'on', ...(share === null ? {} : { comic_gen_ratio: share }), comic_llm_batch: 'with_main', nai5_speech: a.speech } : { comic_gen: 'off' });
  }
  const router = a.routerKey.trim();
  const llm = a.helper === 'custom'
    ? { source: 'custom', provider: 'openrouter', endpoint: helper.endpoint, model: a.helperModel.trim() || helper.model, ...(router ? { api_key: router } : {}) }
    : { source: a.helper };
  const picks = a.picker === 'off' ? 'llm' : a.picker;
  const embeds = a.picker === 'embedding' || (has(a, 'sfx') && a.sfxMatcher === 'embedding-only');
  return {
    settings: { card, ...(a.naiKey.trim() ? { nai: { api_key: a.naiKey.trim() } } : {}), llm },
    tts: { enabled: has(a, 'tts'), selector: picks, ...(has(a, 'tts') ? { autoReply: a.ttsAuto, narration: a.narration } : {}),
      ...(a.fishKey.trim() ? { fishKey: a.fishKey.trim() } : {}), ...(a.picker === 'jev' && router ? { jevKey: router } : {}) },
    // Embedding through OpenRouter takes JEV's key when it has none of its own: one key, both.
    sound: { bgmEnabled: has(a, 'bgm'), sfxEnabled: has(a, 'sfx'), ...(has(a, 'sfx') && !kept('sfxMatcher') ? { sfxMatcher: a.sfxMatcher } : {}), ...(embeds && router ? { embedKey: router } : {}) },
    emotion: { enabled: has(a, 'viewer') },
    viewer: { bgPick: a.picker === 'off' ? 'auto' : a.picker },
    quality: a.quality,
  };
}

/**
 * About how many tokens a text costs a model: English runs near four characters a token, Hangul near one a
 * syllable. A label's estimate (「약 N 토큰」), never a count to budget by.
 */
export function estimateTokens(text: string): number {
  let ascii = 0, other = 0;
  for (const ch of text) { if (ch.charCodeAt(0) < 128) ascii++; else if (/\S/.test(ch)) other++; }
  return Math.round(ascii / 4 + other * 0.9);
}
