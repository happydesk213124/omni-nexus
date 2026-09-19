/**
 * WebP EXIF UserComment / ImageDescription readers for NovelAI file metadata.
 */
import { asU8, isWebpBytes, type BytesLike } from '../../core/util/bytes.ts';

function readAscii(u8: Uint8Array, start: number, end: number): string {
  let s = '';
  for (let i = start; i < end; i += 1) s += String.fromCharCode(u8[i]!);
  return s;
}

function readUtf16Be(u8: Uint8Array, start: number, end: number): string {
  const chars: number[] = [];
  for (let i = start; i + 1 < end; i += 2) {
    chars.push((u8[i]! << 8) | u8[i + 1]!);
  }
  return String.fromCharCode(...chars);
}

function readUtf16Le(u8: Uint8Array, start: number, end: number): string {
  const chars: number[] = [];
  for (let i = start; i + 1 < end; i += 2) {
    chars.push(u8[i]! | (u8[i + 1]! << 8));
  }
  return String.fromCharCode(...chars);
}

/** Decode EXIF UserComment payload (ASCII / UNICODE / JIS prefixes). */
export function decodeExifUserComment(data: Uint8Array): string {
  if (data.length < 8) return '';
  const prefix = readAscii(data, 0, 8).replace(/\0+$/g, '');
  const body = data.subarray(8);
  if (/^ASCII/i.test(prefix)) {
    return new TextDecoder('utf-8', { fatal: false }).decode(body).replace(/\0+$/g, '');
  }
  if (/^UNICODE/i.test(prefix)) {
    // NovelAI typically writes UTF-16 BE for UNICODE UserComment.
    if (body.length >= 2 && body[0] === 0xff && body[1] === 0xfe) {
      return readUtf16Le(body, 2, body.length).replace(/\0+$/g, '');
    }
    if (body.length >= 2 && body[0] === 0xfe && body[1] === 0xff) {
      return readUtf16Be(body, 2, body.length).replace(/\0+$/g, '');
    }
    return readUtf16Be(body, 0, body.length).replace(/\0+$/g, '');
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(data).replace(/\0+$/g, '');
}

/**
 * Minimal TIFF/EXIF IFD walk for ImageDescription (0x010E) and UserComment (0x9286).
 */
export function parseExifTags(exif: Uint8Array): Record<string, string> {
  const out: Record<string, string> = {};
  if (exif.length < 8) return out;

  // Skip "Exif\0\0" header when present.
  let start = 0;
  if (
    exif.length >= 6
    && exif[0] === 0x45
    && exif[1] === 0x78
    && exif[2] === 0x69
    && exif[3] === 0x66
  ) {
    start = 6;
  }
  const tiff = exif.subarray(start);
  if (tiff.length < 8) return out;

  const le = tiff[0] === 0x49 && tiff[1] === 0x49;
  const be = tiff[0] === 0x4d && tiff[1] === 0x4d;
  if (!le && !be) return out;

  const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
  const u16 = (o: number): number => (le ? view.getUint16(o, true) : view.getUint16(o, false));
  const u32 = (o: number): number => (le ? view.getUint32(o, true) : view.getUint32(o, false));

  const ifd0 = u32(4);
  const readIfd = (offset: number): void => {
    if (offset + 2 > tiff.length) return;
    const count = u16(offset);
    for (let i = 0; i < count; i += 1) {
      const entry = offset + 2 + i * 12;
      if (entry + 12 > tiff.length) break;
      const tag = u16(entry);
      const type = u16(entry + 2);
      const num = u32(entry + 4);
      let valueOffset = entry + 8;
      const typeSize = type === 2 ? 1 : type === 7 ? 1 : type === 3 ? 2 : type === 4 ? 4 : 1;
      const byteLen = num * typeSize;
      if (byteLen > 4) {
        const ptr = u32(entry + 8);
        valueOffset = ptr;
      }
      if (valueOffset + byteLen > tiff.length) continue;
      const slice = tiff.subarray(valueOffset, valueOffset + byteLen);
      if (tag === 0x010e && type === 2) {
        // ImageDescription
        out.ImageDescription = new TextDecoder('utf-8', { fatal: false })
          .decode(slice)
          .replace(/\0+$/g, '');
      } else if (tag === 0x9286) {
        out.UserComment = decodeExifUserComment(slice);
      }
    }
  };

  readIfd(ifd0);
  return out;
}

/** Extract EXIF payload from a WebP RIFF container. */
export function readWebpExif(bytes: BytesLike): Uint8Array | null {
  const u8 = asU8(bytes);
  if (!isWebpBytes(u8) || u8.length < 12) return null;
  let offset = 12;
  while (offset + 8 <= u8.length) {
    const fourcc = readAscii(u8, offset, offset + 4);
    const size = u8[offset + 4]!
      | (u8[offset + 5]! << 8)
      | (u8[offset + 6]! << 16)
      | (u8[offset + 7]! << 24);
    const dataStart = offset + 8;
    const dataEnd = dataStart + size;
    if (dataEnd > u8.length) break;
    if (fourcc === 'EXIF') {
      return u8.subarray(dataStart, dataEnd);
    }
    offset = dataEnd + (size & 1); // pad to even
  }
  return null;
}

export function webpExifTextMap(bytes: BytesLike): Record<string, string> {
  const exif = readWebpExif(bytes);
  if (!exif) return {};
  return parseExifTags(exif);
}
