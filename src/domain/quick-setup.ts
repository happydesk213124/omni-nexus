/**
 * ⚡ 빠른 설정: a few answers, turned into the settings they mean. Pure, so the mapping is tested on its
 * own: the sheet reads the current settings into answers, asks, and writes what this returns. Anything
 * not asked about stays as it was.
 */
export type QuickFeature = 'image' | 'comic' | 'tts' | 'sound' | 'viewer';
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
  /** Images per reply: one, two to three, three to four. */
  images: 1 | 2 | 3;
  /** Beside illustrations: half of them comics, or all. Comics without illustrations are always all of them. */
  comicShare: 50 | 100;
  /** Comic pages carry the lines in speech bubbles. */
  speech: boolean;
  /** The 퀄리티 향상 author's note for the main tagger. */
  quality: boolean;
}
export interface QuickPlan {
  settings: { card: Record<string, unknown>; nai?: { api_key: string }; llm?: Record<string, unknown> };
  tts: { enabled: boolean; selector: 'llm' | 'jev' | 'embedding'; fishKey?: string; jevKey?: string };
  sound: { bgmEnabled: boolean; sfxEnabled: boolean; embedKey?: string };
  emotion: { enabled: boolean };
  viewer: { bgPick: 'auto' | 'jev' | 'embedding' };
  quality: boolean;
}

/** JEV through OpenRouter, as the TTS model settings fill it in. */
export const JEV_OPENROUTER = { url: 'https://openrouter.ai/api/alpha/decisions', model: 'typesafe/jev-1.13', format: 'openrouter' } as const;
/** The 퀄리티 향상 example's id among the author's note presets. */
export const QUALITY_PRESET_ID = 'example-quality';

const IMAGES: Record<QuickAnswers['images'], [number, number]> = { 1: [1, 1], 2: [2, 3], 3: [3, 4] };

export function planQuickSetup(a: QuickAnswers, helper: { endpoint: string; model: string }): QuickPlan {
  const has = (feature: QuickFeature) => a.features.includes(feature);
  const draws = has('image') || has('comic'), [min, max] = IMAGES[a.images];
  const card: Record<string, unknown> = { power: draws };
  if (draws) {
    Object.assign(card, { image_min: min, image_max: max },
      a.tagMode === 'stream' ? { stream_inline_tags: true, stream_inline_autogen: true } : { stream_inline_tags: false, auto_gen_on_reply: true },
      // Comics alone are every image: at 100% the tagger is told so (any share below leaves most of them illustrations).
      has('comic') ? { comic_gen: 'on', comic_gen_ratio: has('image') ? a.comicShare : 100, comic_llm_batch: 'with_main', nai5_speech: a.speech } : { comic_gen: 'off' });
  }
  const router = a.routerKey.trim();
  const llm = a.helper === 'custom'
    ? { source: 'custom', provider: 'openrouter', endpoint: helper.endpoint, model: a.helperModel.trim() || helper.model, ...(router ? { api_key: router } : {}) }
    : { source: a.helper };
  const picks = a.picker === 'off' ? 'llm' : a.picker;
  return {
    settings: { card, ...(a.naiKey.trim() ? { nai: { api_key: a.naiKey.trim() } } : {}), llm },
    tts: { enabled: has('tts'), selector: picks, ...(a.fishKey.trim() ? { fishKey: a.fishKey.trim() } : {}), ...(a.picker === 'jev' && router ? { jevKey: router } : {}) },
    // Embedding through OpenRouter takes JEV's key when it has none of its own: one key, both.
    sound: { bgmEnabled: has('sound'), sfxEnabled: has('sound'), ...(a.picker === 'embedding' && router ? { embedKey: router } : {}) },
    emotion: { enabled: has('viewer') },
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
