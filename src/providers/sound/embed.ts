import type { SoundItem, SoundSettings } from '../../core/sound-types';
import type { TtsSettings } from '../../core/tts-types';
import { embedTexts, embeddingProviderNeedsApiKey, normalizeEmbeddingProvider, type EmbeddingSettings } from '../embedding/client';

/**
 * The embedding step of matching: the item whose description (name, tags and
 * glossary words) lies nearest to the word or scene. Vectors are kept in memory
 * for the session — a few hundred short texts are one cheap request, while
 * storing them would put megabytes into the save.
 */
const vectors = new Map<string, number[]>();
const LIMIT = 2000;
/** Below this the nearest item is still a stranger: matching goes on to the free guess. */
export const EMBED_MIN_SCORE = 0.25;

/** The embedding connection, or null when none is set up. An empty OpenRouter key borrows the JEV key. */
export function soundEmbedSettings(sound: Pick<SoundSettings, 'embed'>, tts: Pick<TtsSettings, 'jev'>): EmbeddingSettings | null {
  const provider = normalizeEmbeddingProvider(sound.embed.provider);
  const jevKey = /openrouter\.ai/i.test(tts.jev.url) ? tts.jev.key.trim() : '';
  const key = sound.embed.key.trim() || (provider === 'openrouter' ? jevKey : '');
  if (embeddingProviderNeedsApiKey(provider) && !key) return null;
  return { provider, model: sound.embed.model, endpoint: sound.embed.endpoint, api_key: key };
}

function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) { dot += a[i]! * b[i]!; na += a[i]! * a[i]!; nb += b[i]! * b[i]!; }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

async function vectorsFor(settings: EmbeddingSettings, texts: readonly string[]): Promise<number[][]> {
  const id = (text: string) => `${settings.provider}\n${settings.model}\n${text}`;
  const missing = [...new Set(texts.filter(text => !vectors.has(id(text))))];
  for (let i = 0; i < missing.length; i += 256) {
    const batch = missing.slice(i, i + 256), { vectors: out } = await embedTexts(settings, batch);
    batch.forEach((text, k) => vectors.set(id(text), out[k]!));
  }
  while (vectors.size > LIMIT) vectors.delete(vectors.keys().next().value!);
  return texts.map(text => vectors.get(id(text)) ?? []);
}

/** The tracks nearest one query, best first, as many as `limit` that pass the minimum score. */
export async function embedRank(query: string, items: readonly SoundItem[], describe: (item: SoundItem) => string, settings: EmbeddingSettings, limit: number): Promise<SoundItem[]> {
  if (!items.length || !query.trim()) return [];
  const all = await vectorsFor(settings, [query, ...items.map(describe)]);
  return all.slice(1).map((row, i) => ({ item: items[i]!, score: cosine(all[0]!, row) }))
    .filter(row => row.score >= EMBED_MIN_SCORE).sort((a, b) => b.score - a.score).slice(0, limit).map(row => row.item);
}

/** The texts nearest one query (their places in `texts`), best first, as many as `limit` that pass the minimum score. */
/** `minScore`: below it a text is no match at all (a ranking that must always pick one passes -1). */
export async function embedNearestTexts(query: string, texts: readonly string[], settings: EmbeddingSettings, limit = 1, minScore = EMBED_MIN_SCORE): Promise<number[]> {
  if (!texts.length || !query.trim()) return [];
  const all = await vectorsFor(settings, [query, ...texts]);
  return all.slice(1).map((row, i) => ({ i, score: cosine(all[0]!, row) })).filter(row => row.score >= minScore)
    .sort((a, b) => b.score - a.score).slice(0, limit).map(row => row.i);
}

/** How near each text lies to the query (cosine, -1…1), in the texts' order. One request for whatever is new. */
export async function embedScores(query: string, texts: readonly string[], settings: EmbeddingSettings): Promise<number[]> {
  if (!texts.length || !query.trim()) return texts.map(() => 0);
  const all = await vectorsFor(settings, [query, ...texts]);
  return all.slice(1).map(row => cosine(all[0]!, row));
}

/** An effect word with the story around it: the paragraph before, its own line, the paragraph after. */
export interface SfxQuery { word: string; context: string }
/** How much the sound word decides against the story around it. The word is what is heard; the story says which of
 * the effects that sound alike fits (쾅 of a door, of a gun, of thunder). */
export const SFX_WORD_WEIGHT = 0.65;
/** A word spelled exactly as one of the effect's own tags: a strong hint the vectors may miss for a short Korean word. */
export const SFX_TAG_BONUS = 0.08;
/**
 * The nearest effect for each word, scored on the word and on the story around it apart, so a long passage does not
 * drown a two-letter sound: score = word·0.65 + story·0.35 (+0.08 when a tag is the word itself). With no story the
 * word alone. Every word, story and effect text that is new goes in one request.
 */
export async function embedPickSfx(queries: readonly SfxQuery[], items: readonly SoundItem[], describe: (item: SoundItem) => string, settings: EmbeddingSettings, exact: (word: string, item: SoundItem) => boolean = () => false, limit = 1): Promise<Array<Array<{ item: SoundItem; score: number }>>> {
  if (!items.length) return queries.map(() => []);
  const words = queries.map(q => `효과음 의성어: ${q.word.trim()}`), stories = queries.map(q => q.context.trim() ? `장면: ${q.context.trim()}` : '');
  const texts = items.map(describe), all = await vectorsFor(settings, [...words, ...stories.filter(Boolean), ...texts]);
  const vector = new Map<string, number[]>();
  [...words, ...stories.filter(Boolean), ...texts].forEach((text, i) => vector.set(text, all[i]!));
  return queries.map((query, k) => {
    if (!query.word.trim()) return [];
    const w = vector.get(words[k]!)!, story = stories[k] ? vector.get(stories[k]!)! : null;
    return items.map((item, i) => {
      const row = vector.get(texts[i]!)!, byWord = cosine(w, row);
      const score = (story ? byWord * SFX_WORD_WEIGHT + cosine(story, row) * (1 - SFX_WORD_WEIGHT) : byWord) + (exact(query.word, item) ? SFX_TAG_BONUS : 0);
      return { item, score };
    }).filter(row => row.score >= EMBED_MIN_SCORE).sort((a, b) => b.score - a.score).slice(0, limit);
  });
}

/** Test seam. */
export function clearSoundEmbeddings(): void { vectors.clear(); }
