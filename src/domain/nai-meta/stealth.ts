/**
 * NovelAI stealth_pngcomp / stealth_pnginfo LSB extractor (alpha channel).
 * Requires decoded RGBA pixels — callers decode PNG/WebP via canvas/ImageBitmap.
 *
 * Bit order matches NovelAI/novelai-image-metadata: alpha is read column-major
 * (`alpha.T.reshape(-1)` in numpy), then LSB-packed MSB-first (`np.packbits`).
 */
import { asU8 } from '../../core/util/bytes.ts';
import { inflateZlib } from './png-text.ts';

/** Walk alpha samples in NovelAI order: column-major, then take LSB of each. */
export function iterAlphaLsbColumnMajor(
  rgba: Uint8Array,
  width: number,
  height: number,
): number[] {
  const bits: number[] = [];
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) {
      const i = y * width + x;
      bits.push(rgba[i * 4 + 3]! & 1);
    }
  }
  return bits;
}

/**
 * Pack alpha LSBs the way NovelAI does: column-major flatten, then 8 LSBs → 1 byte
 * with the first sample as the MSB (`np.packbits` default).
 */
function packBitsMsbFirst(bits: readonly number[]): Uint8Array {
  const usable = Math.floor(bits.length / 8) * 8;
  const out = new Uint8Array(usable / 8);
  for (let i = 0; i < usable; i += 8) {
    let byte = 0;
    for (let b = 0; b < 8; b += 1) {
      byte |= bits[i + b]! << (7 - b);
    }
    out[i / 8] = byte;
  }
  return out;
}

export function packAlphaLsbColumnMajor(rgba: Uint8Array, width: number, height: number): Uint8Array {
  return packBitsMsbFirst(iterAlphaLsbColumnMajor(rgba, width, height));
}

export function packAlphaLsbRowMajor(rgba: Uint8Array, width: number, height: number): Uint8Array {
  const bits: number[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      bits.push(rgba[(y * width + x) * 4 + 3]! & 1);
    }
  }
  return packBitsMsbFirst(bits);
}

/** RGB LSBs, column-major, R then G then B per pixel (A1111-style stealth_rgb*). */
export function packRgbLsbColumnMajor(rgba: Uint8Array, width: number, height: number): Uint8Array {
  const bits: number[] = [];
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) {
      const i = (y * width + x) * 4;
      bits.push(rgba[i]! & 1, rgba[i + 1]! & 1, rgba[i + 2]! & 1);
    }
  }
  return packBitsMsbFirst(bits);
}

/** Test helper: write payload bits into alpha LSBs (column-major). */
export function writeStealthAlphaLsb(
  rgba: Uint8Array,
  width: number,
  height: number,
  payload: Uint8Array,
): void {
  const bits: number[] = [];
  for (const byte of payload) {
    for (let b = 7; b >= 0; b -= 1) bits.push((byte >> b) & 1);
  }
  let bi = 0;
  for (let x = 0; x < width && bi < bits.length; x += 1) {
    for (let y = 0; y < height && bi < bits.length; y += 1) {
      const i = (y * width + x) * 4 + 3;
      rgba[i] = (rgba[i]! & 0xfe) | bits[bi]!;
      bi += 1;
    }
  }
}

async function gunzip(data: Uint8Array): Promise<Uint8Array | null> {
  if (typeof DecompressionStream !== 'function') return null;
  try {
    const ds = new DecompressionStream('gzip');
    const copy = new Uint8Array(data.byteLength);
    copy.set(data);
    const stream = new Blob([copy]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

/**
 * Decode stealth metadata from RGBA pixel buffer (row-major, 4 bytes/pixel).
 * Returns parsed JSON object or null.
 */
async function parseStealthBytes(
  bytes: Uint8Array,
  magicComp: string,
  magicInfo: string,
): Promise<unknown | null> {
  if (bytes.length < 20) return null;
  const head = String.fromCharCode(...bytes.subarray(0, magicComp.length));
  let pos = 0;
  let compressed = false;
  if (head.startsWith(magicComp)) {
    compressed = true;
    pos = magicComp.length;
  } else if (head.startsWith(magicInfo)) {
    compressed = false;
    pos = magicInfo.length;
  } else {
    return null;
  }

  if (pos + 4 > bytes.length) return null;
  const bitLen = ((bytes[pos]! << 24) | (bytes[pos + 1]! << 16) | (bytes[pos + 2]! << 8) | bytes[pos + 3]!) >>> 0;
  pos += 4;
  const byteLen = Math.floor(bitLen / 8);
  if (byteLen < 1 || pos + byteLen > bytes.length) return null;
  let payload = bytes.subarray(pos, pos + byteLen);
  if (compressed) {
    const inflated = (await gunzip(payload)) || (await inflateZlib(payload));
    if (!inflated) return null;
    payload = inflated;
  }
  const text = new TextDecoder('utf-8', { fatal: false }).decode(payload);
  try {
    const json = JSON.parse(text) as unknown;
    if (json && typeof json === 'object' && !Array.isArray(json)) {
      const rec = json as Record<string, unknown>;
      if (typeof rec.Comment === 'string') {
        try {
          rec.Comment = JSON.parse(rec.Comment);
        } catch {
          /* keep string */
        }
      }
    }
    return json;
  } catch {
    return null;
  }
}

export async function extractStealthFromRgba(
  rgba: Uint8Array,
  width: number,
  height: number,
): Promise<unknown | null> {
  if (!rgba.length || width < 1 || height < 1) return null;
  const expected = width * height * 4;
  if (rgba.length < expected) return null;
  const alpha = await parseStealthBytes(
    packAlphaLsbColumnMajor(rgba, width, height),
    'stealth_pngcomp',
    'stealth_pnginfo',
  );
  if (alpha) return alpha;
  const row = await parseStealthBytes(
    packAlphaLsbRowMajor(rgba, width, height),
    'stealth_pngcomp',
    'stealth_pnginfo',
  );
  if (row) return row;
  return parseStealthBytes(
    packRgbLsbColumnMajor(rgba, width, height),
    'stealth_rgbcomp',
    'stealth_rgbinfo',
  );
}

/**
 * Decode image bytes to RGBA via createImageBitmap + canvas.
 * Uses `{ colorSpaceConversion: 'none', premultiplyAlpha: 'none' }` when available
 * so alpha LSBs are less likely to be mangled by browser color management.
 */
export async function decodeImageToRgba(bytes: ArrayBuffer | Uint8Array): Promise<{
  rgba: Uint8Array;
  width: number;
  height: number;
} | null> {
  const u8 = asU8(bytes);
  if (!u8.length) return null;
  if (typeof createImageBitmap !== 'function') return null;

  try {
    const copy = new Uint8Array(u8.byteLength);
    copy.set(u8);
    const blob = new Blob([copy]);
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(blob, {
        colorSpaceConversion: 'none',
        premultiplyAlpha: 'none',
      } as ImageBitmapOptions);
    } catch {
      bitmap = await createImageBitmap(blob);
    }
    const w = bitmap.width;
    const h = bitmap.height;
    const canvas = typeof OffscreenCanvas === 'function'
      ? new OffscreenCanvas(w, h)
      : (() => {
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        return c;
      })();
    const ctx = (canvas as OffscreenCanvas).getContext('2d', { alpha: true, willReadFrequently: true }) as
      | OffscreenCanvasRenderingContext2D
      | null
      ?? (canvas as HTMLCanvasElement).getContext('2d', { alpha: true, willReadFrequently: true });
    if (!ctx) {
      bitmap.close?.();
      return null;
    }
    ctx.drawImage(bitmap, 0, 0);
    const imageData = ctx.getImageData(0, 0, w, h);
    bitmap.close?.();
    return {
      rgba: new Uint8Array(imageData.data.buffer, imageData.data.byteOffset, imageData.data.byteLength),
      width: w,
      height: h,
    };
  } catch {
    return null;
  }
}
