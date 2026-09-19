import { asU8, isPngBytes, isWebpBytes, u8ToArrayBuffer, type BytesLike } from '../../core/util/bytes.ts';
import { pngChunks, PNG_GENERATION_CHUNK, writePngGenerationChunk } from './png-generation-chunk.ts';
import { safeGenerationRecipe } from './safe-recipe.ts';

/** Array position corresponds to the generation recipe's character slot. */
export interface GenerationCharacterAssociation { scope: string; id: string; name: string }
export interface GenerationImageData {
  version: 1;
  recipe: unknown;
  characters: GenerationCharacterAssociation[];
  /** Unix milliseconds supplied by the generation caller, not the encode time. */
  generatedAt: number | null;
}
const tag = 'onxD';
const maxPayload = 16 * 1024 * 1024;
const decoder = new TextDecoder('utf-8', { fatal: true });
const encoder = new TextEncoder();

function chunks(bytes: Uint8Array): Array<{ name: string; start: number; end: number; data: Uint8Array }> {
  if (!isWebpBytes(bytes) || bytes.length < 12) throw new Error('Expected WebP RIFF');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(4, true) + 8 !== bytes.length) throw new Error('Invalid RIFF size');
  const result = [];
  let start = 12;
  while (start < bytes.length) {
    if (start + 8 > bytes.length) throw new Error('Truncated RIFF header');
    const size = view.getUint32(start + 4, true);
    const end = start + 8 + size + (size & 1);
    if (end > bytes.length) throw new Error('Truncated RIFF chunk');
    result.push({ name: String.fromCharCode(...bytes.subarray(start, start + 4)), start, end,
      data: bytes.subarray(start + 8, start + 8 + size) });
    start = end;
  }
  return result;
}

function validate(raw: unknown): GenerationImageData {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid generation metadata');
  const v = raw as GenerationImageData;
  if (v.version !== 1 || !Object.prototype.hasOwnProperty.call(v, 'recipe') || !Array.isArray(v.characters)
    || !(v.generatedAt === null || (Number.isFinite(v.generatedAt) && v.generatedAt >= 0))
    || v.characters.some(c => !c || typeof c.scope !== 'string' || typeof c.id !== 'string' || typeof c.name !== 'string')) {
    throw new Error('Invalid generation metadata schema');
  }
  return v;
}

/** Strict reader: malformed/unsupported owned chunks must not silently disappear. */
export function readGenerationImageData(bytes: BytesLike): GenerationImageData | null {
  const src = asU8(bytes);
  if (!isWebpBytes(src) && !isPngBytes(src)) return null;
  const found = isPngBytes(src) ? pngChunks(src).filter(c => c.name === PNG_GENERATION_CHUNK) : chunks(src).filter(c => c.name === tag);
  if (!found.length) return null;
  if (found.length !== 1 || found[0]!.data.length > maxPayload) throw new Error('Invalid generation chunk');
  return validate(JSON.parse(decoder.decode(found[0]!.data)));
}

/** WebP allows unknown RIFF chunks; image/EXIF/XMP chunks remain byte-identical.
 * https://developers.google.com/speed/webp/docs/riff_container#unknown_chunks
 */
export function writeGenerationImageData(bytes: BytesLike, metadata: GenerationImageData): ArrayBuffer {
  validate(metadata);
  const src = asU8(bytes);
  // Reject a future version instead of replacing data we do not understand.
  readGenerationImageData(src);
  metadata = { version: 1, recipe: safeGenerationRecipe(metadata.recipe),
    characters: metadata.characters.map(({ scope, id, name }) => ({ scope, id, name })), generatedAt: metadata.generatedAt };
  const body = encoder.encode(JSON.stringify(metadata));
  if (body.length > maxPayload) throw new Error('Generation metadata too large');
  if (isPngBytes(src)) {
    const out = writePngGenerationChunk(src, body);
    if (JSON.stringify(readGenerationImageData(out)) !== JSON.stringify(metadata)) throw new Error('Metadata round-trip failed');
    return u8ToArrayBuffer(out);
  }
  const parsed = chunks(src);
  const keep = parsed.filter(c => c.name !== tag);
  const length = 12 + keep.reduce((n, c) => n + c.end - c.start, 0) + 8 + body.length + (body.length & 1);
  if (length > 0xfffffffe) throw new Error('WebP too large');
  const out = new Uint8Array(length);
  out.set(src.subarray(0, 12));
  const view = new DataView(out.buffer);
  view.setUint32(4, length - 8, true);
  let offset = 12;
  for (const c of keep) { out.set(src.subarray(c.start, c.end), offset); offset += c.end - c.start; }
  out.set(encoder.encode(tag), offset);
  view.setUint32(offset + 4, body.length, true);
  out.set(body, offset + 8);
  const verified = readGenerationImageData(out);
  if (JSON.stringify(verified) !== JSON.stringify(metadata)) throw new Error('Metadata round-trip failed');
  return u8ToArrayBuffer(out);
}
