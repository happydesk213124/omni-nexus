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

/** For each query, the nearest item and its score, or null when none comes close enough. One request for all that are new. */
export async function embedPickMany(queries: readonly string[], items: readonly SoundItem[], describe: (item: SoundItem) => string, settings: EmbeddingSettings): Promise<Array<{ item: SoundItem; score: number } | null>> {
  if (!items.length) return queries.map(() => null);
  const texts = items.map(describe), all = await vectorsFor(settings, [...queries, ...texts]);
  const rows = all.slice(queries.length);
  return queries.map((query, k) => {
    if (!query.trim()) return null;
    let best: { item: SoundItem; score: number } | null = null;
    rows.forEach((row, i) => { const score = cosine(all[k]!, row); if (!best || score > best.score) best = { item: items[i]!, score }; });
    return best && (best as { score: number }).score >= EMBED_MIN_SCORE ? best : null;
  });
}

/** Test seam. */
export function clearSoundEmbeddings(): void { vectors.clear(); }
