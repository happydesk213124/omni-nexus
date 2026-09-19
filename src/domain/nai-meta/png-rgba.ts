/**
 * Decode PNG IDAT to RGBA without canvas — canvas getImageData mangles alpha LSBs
 * that NovelAI stealth_pngcomp lives in.
 */
import { asU8, isPngBytes, type BytesLike } from '../../core/util/bytes.ts';
import { inflateZlib } from './png-text.ts';

const PNG_SIG = 8;

function readLatin1(u8: Uint8Array, start: number, end: number): string {
  let s = '';
  for (let i = start; i < end; i += 1) s += String.fromCharCode(u8[i]!);
  return s;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function unfilter(
  filter: number,
  row: Uint8Array,
  dest: Uint8Array,
  prev: Uint8Array | null,
  bpp: number,
): boolean {
  if (dest.length !== row.length) return false;
  for (let i = 0; i < row.length; i += 1) {
    const raw = row[i]!;
    const left = i >= bpp ? dest[i - bpp]! : 0;
    const up = prev ? prev[i]! : 0;
    const upLeft = prev && i >= bpp ? prev[i - bpp]! : 0;
    let v = raw;
    if (filter === 1) v = (raw + left) & 255;
    else if (filter === 2) v = (raw + up) & 255;
    else if (filter === 3) v = (raw + ((left + up) >> 1)) & 255;
    else if (filter === 4) v = (raw + paeth(left, up, upLeft)) & 255;
    else if (filter !== 0) return false;
    dest[i] = v;
  }
  return true;
}

export interface PngRgba {
  rgba: Uint8Array;
  width: number;
  height: number;
  colorType: number;
}

/** 8-bit non-interlaced PNG → RGBA. Types 2 (RGB), 4 (gray+A), 6 (RGBA). */
export async function decodePngToRgba(bytes: BytesLike): Promise<PngRgba | null> {
  const u8 = asU8(bytes);
  if (!isPngBytes(u8) || u8.length < 33) return null;

  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let offset = PNG_SIG;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = -1;
  const idat: Uint8Array[] = [];

  while (offset + 12 <= u8.length) {
    const length = view.getUint32(offset);
    const type = readLatin1(u8, offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > u8.length) return null;
    const data = u8.subarray(dataStart, dataEnd);

    if (type === 'IHDR' && length >= 13) {
      width = view.getUint32(dataStart);
      height = view.getUint32(dataStart + 4);
      bitDepth = u8[dataStart + 8] ?? 0;
      colorType = u8[dataStart + 9] ?? -1;
      const compression = u8[dataStart + 10] ?? 1;
      const filter = u8[dataStart + 11] ?? 1;
      const interlace = u8[dataStart + 12] ?? 1;
      if (compression !== 0 || filter !== 0 || interlace !== 0) return null;
    } else if (type === 'IDAT' && length > 0) {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset = dataEnd + 4;
  }

  if (width < 1 || height < 1 || bitDepth !== 8) return null;
  const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 4 ? 2 : 0;
  if (!bpp) return null;

  let idatLen = 0;
  for (const part of idat) idatLen += part.length;
  if (!idatLen) return null;
  const packed = new Uint8Array(idatLen);
  let w = 0;
  for (const part of idat) {
    packed.set(part, w);
    w += part.length;
  }

  const inflated = await inflateZlib(packed);
  const stride = width * bpp;
  const need = height * (1 + stride);
  if (!inflated || inflated.length < need) return null;

  const raw = new Uint8Array(height * stride);
  let src = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[src] ?? 255;
    src += 1;
    const row = inflated.subarray(src, src + stride);
    src += stride;
    const dest = raw.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? raw.subarray((y - 1) * stride, y * stride) : null;
    if (!unfilter(filter, row, dest, prev, bpp)) return null;
  }

  if (colorType === 6) return { rgba: raw, width, height, colorType };

  const rgba = new Uint8Array(width * height * 4);
  if (colorType === 2) {
    for (let i = 0, o = 0; i < raw.length; i += 3, o += 4) {
      rgba[o] = raw[i]!;
      rgba[o + 1] = raw[i + 1]!;
      rgba[o + 2] = raw[i + 2]!;
      rgba[o + 3] = 255;
    }
  } else {
    for (let i = 0, o = 0; i < raw.length; i += 2, o += 4) {
      const g = raw[i]!;
      rgba[o] = g;
      rgba[o + 1] = g;
      rgba[o + 2] = g;
      rgba[o + 3] = raw[i + 1]!;
    }
  }
  return { rgba, width, height, colorType };
}
