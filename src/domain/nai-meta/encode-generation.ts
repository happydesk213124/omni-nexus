import { encodeWebpQuality } from '../../core/util/image.ts';
import { type BytesLike } from '../../core/util/bytes.ts';
import { extractNaiMetadata } from './index.ts';
import { readGenerationImageData, writeGenerationImageData, type GenerationCharacterAssociation, type GenerationImageData } from './generation-data.ts';

export interface GenerationEncodingOptions {
  /** Omit to extract from original PNG text/stealth or WebP EXIF. */
  recipe?: unknown;
  characters?: readonly GenerationCharacterAssociation[];
  /** Unix milliseconds. Omission preserves the embedded value, else null. */
  generatedAt?: number | null;
}

/** Collect metadata before any lossy canvas operation.
 * Callers possessing roster identities must provide them: captions cannot
 * reliably reconstruct scope/id, and duplicate names must remain distinct.
 */
async function generationData(bytes: BytesLike, options: GenerationEncodingOptions): Promise<GenerationImageData> {
  const existing = readGenerationImageData(bytes);
  const recipe = options.recipe !== undefined ? options.recipe : existing?.recipe ?? await extractNaiMetadata(bytes);
  return { version: 1 as const, recipe,
    characters: options.characters ? options.characters.map(c => ({ ...c })) : existing?.characters ?? [],
    generatedAt: options.generatedAt !== undefined ? options.generatedAt : existing?.generatedAt ?? null };
}

/** Attach to an already encoded WebP or PNG. Extracts from original bytes, never the
 * lossy canvas output. Explicit empty characters/null timestamp clear values.
 * Throws on invalid metadata or unsupported output; caller must keep the original.
 */
export async function preserveImageMetadata(
  original: BytesLike,
  encoded: BytesLike,
  context: GenerationEncodingOptions = {},
): Promise<ArrayBuffer> {
  return writeGenerationImageData(encoded, await generationData(original, context));
}

/** Full-resolution WebP 0.9; unavailable encoding returns a metadata-bearing
 * original PNG. Unsupported fallback formats throw instead of losing cast.
 */
export async function encodeGenerationWebp(bytes: BytesLike, options: GenerationEncodingOptions = {}): Promise<ArrayBuffer> {
  const metadata = await generationData(bytes, options);
  const encoded = await encodeWebpQuality(bytes, 0.9, encoded => writeGenerationImageData(encoded, metadata));
  return encoded ?? writeGenerationImageData(bytes, metadata);
}
