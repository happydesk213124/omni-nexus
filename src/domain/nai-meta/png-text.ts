/**
 * PNG tEXt / iTXt / zTXt keyword readers (NovelAI Comment / Description / Source).
 */
import { asU8, isPngBytes, type BytesLike } from '../../core/util/bytes.ts';

const PNG_SIG = 8;

function readLatin1(u8: Uint8Array, start: number, end: number): string {
  let s = '';
  for (let i = start; i < end; i += 1) s += String.fromCharCode(u8[i]!);
  return s;
}

function readUtf8(u8: Uint8Array, start: number, end: number): string {
  try {
    return new TextDecoder('utf-8', { fatal: false }).decode(u8.subarray(start, end));
  } catch {
    return readLatin1(u8, start, end);
  }
}

export async function inflateZlib(data: Uint8Array): Promise<Uint8Array | null> {
  if (typeof DecompressionStream !== 'function') return null;
  try {
    // PNG zTXt / iTXt compressed uses zlib wrapper.
    const ds = new DecompressionStream('deflate');
    const ab = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
    const stream = new Blob([ab]).stream().pipeThrough(ds);
    const buf = await new Response(stream).arrayBuffer();
    return new Uint8Array(buf);
  } catch {
    try {
      const ds = new DecompressionStream('deflate-raw');
      const ab = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
      const stream = new Blob([ab]).stream().pipeThrough(ds);
      const buf = await new Response(stream).arrayBuffer();
      return new Uint8Array(buf);
    } catch {
      return null;
    }
  }
}

export type PngTextMap = Record<string, string>;

/** Walk PNG chunks and collect text keywords. */
export async function readPngTextChunks(bytes: BytesLike): Promise<PngTextMap> {
  const u8 = asU8(bytes);
  const out: PngTextMap = {};
  if (!isPngBytes(u8) || u8.length < 8) return out;

  let offset = PNG_SIG;
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);

  while (offset + 12 <= u8.length) {
    const length = view.getUint32(offset);
    const type = readLatin1(u8, offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > u8.length) break;
    const data = u8.subarray(dataStart, dataEnd);

    if (type === 'tEXt') {
      const nul = data.indexOf(0);
      if (nul > 0) {
        const key = readLatin1(data, 0, nul);
        const value = readLatin1(data, nul + 1, data.length);
        if (key && !(key in out)) out[key] = value;
      }
    } else if (type === 'iTXt') {
      let p = 0;
      const keyEnd = data.indexOf(0);
      if (keyEnd > 0) {
        const key = readUtf8(data, 0, keyEnd);
        p = keyEnd + 1;
        const compressionFlag = data[p] ?? 0;
        p += 1;
        p += 1; // compression method
        const langEnd = data.indexOf(0, p);
        if (langEnd >= p) {
          p = langEnd + 1;
          const transEnd = data.indexOf(0, p);
          if (transEnd >= p) {
            p = transEnd + 1;
            let textBytes = data.subarray(p);
            if (compressionFlag === 1) {
              const inflated = await inflateZlib(textBytes);
              if (inflated) textBytes = inflated;
            }
            const value = readUtf8(textBytes, 0, textBytes.length);
            if (key && !(key in out)) out[key] = value;
          }
        }
      }
    } else if (type === 'zTXt') {
      const nul = data.indexOf(0);
      if (nul > 0 && nul + 2 <= data.length) {
        const key = readLatin1(data, 0, nul);
        const compressed = data.subarray(nul + 2);
        const inflated = await inflateZlib(compressed);
        if (inflated && key && !(key in out)) {
          out[key] = readLatin1(inflated, 0, inflated.length);
        }
      }
    }

    if (type === 'IEND') break;
    offset = dataEnd + 4; // CRC
  }
  return out;
}
