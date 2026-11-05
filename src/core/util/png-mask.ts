/**
 * Writes a black-and-white PNG: white inside one pixel rectangle, black elsewhere.
 *
 * Used as a region mask for ComfyUI. It is 1-bit grayscale with stored (not
 * compressed) deflate blocks, so it needs no canvas and no CompressionStream —
 * neither is guaranteed inside Risu — and an 832×1216 mask is still only ~128 KB.
 */
import { crc32Bytes } from './crc32.ts';

export interface PixelBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

function u32be(n: number): number[] {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const body = new Uint8Array(4 + data.length);
  for (let i = 0; i < 4; i += 1) body[i] = type.charCodeAt(i);
  body.set(data, 4);
  const out = new Uint8Array(12 + data.length);
  out.set(u32be(data.length), 0);
  out.set(body, 4);
  out.set(u32be(crc32Bytes(body)), 8 + data.length);
  return out;
}

function adler32(u8: Uint8Array): number {
  let a = 1, b = 0;
  for (let i = 0; i < u8.length; i += 1) {
    a = (a + u8[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/** A zlib stream made only of stored blocks (each at most 65535 bytes). */
function zlibStored(raw: Uint8Array): Uint8Array {
  const blocks = Math.max(1, Math.ceil(raw.length / 65535));
  const out = new Uint8Array(2 + raw.length + blocks * 5 + 4);
  out[0] = 0x78; out[1] = 0x01;
  let o = 2;
  for (let i = 0; i < blocks; i += 1) {
    const start = i * 65535;
    const len = Math.min(65535, raw.length - start);
    out[o++] = i === blocks - 1 ? 1 : 0;
    out[o++] = len & 0xff; out[o++] = len >>> 8;
    out[o++] = ~len & 0xff; out[o++] = (~len >>> 8) & 0xff;
    out.set(raw.subarray(start, start + len), o);
    o += len;
  }
  out.set(u32be(adler32(raw)), o);
  return out;
}

/** `box` null (or empty) gives an all-black mask: a region that covers nothing. */
export function encodeMaskPng(width: number, height: number, box: PixelBox | null): Uint8Array {
  const w = Math.max(1, Math.floor(width)), h = Math.max(1, Math.floor(height));
  const rowBytes = Math.ceil(w / 8);
  const raw = new Uint8Array((rowBytes + 1) * h);
  const x0 = box ? Math.max(0, Math.floor(box.x)) : 0;
  const x1 = box ? Math.min(w, Math.floor(box.x + box.w)) : 0;
  const y0 = box ? Math.max(0, Math.floor(box.y)) : 0;
  const y1 = box ? Math.min(h, Math.floor(box.y + box.h)) : 0;
  if (x1 > x0 && y1 > y0) {
    const row = new Uint8Array(rowBytes);
    for (let x = x0; x < x1; x += 1) row[x >> 3] |= 0x80 >> (x & 7);
    // Each scanline is a filter byte (0, none) followed by the packed pixels.
    for (let y = y0; y < y1; y += 1) raw.set(row, y * (rowBytes + 1) + 1);
  }
  const ihdr = new Uint8Array([...u32be(w), ...u32be(h), 1, 0, 0, 0, 0]);
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlibStored(raw)),
    chunk('IEND', new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
