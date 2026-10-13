import { asU8, isPngBytes, isWebpBytes, type BytesLike } from '../../core/util/bytes';

/** Current V4/V5 presets in novelai.net/image (checked 2026-10-12). */
export const NAI_SIZE_PRESETS = {
  Normal: [[1216, 832], [832, 1216], [1024, 1024]],
  Large: [[1536, 1024], [1024, 1536], [1472, 1472]],
  Wallpaper: [[1920, 1088], [1088, 1920]],
  Small: [[768, 512], [512, 768], [640, 640]],
} as const;

export function webpQualityPercent(value: unknown): number {
  const n = value == null || String(value).trim() === '' ? 90 : Number(value);
  return Number.isFinite(n) ? Math.min(100, Math.max(1, Math.round(n))) : 90;
}

/** Official standalone upscaler pricing, distinct from Enhance generation. */
export function upscaleAnlas(width: number, height: number): number {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) return 0;
  const pixels = width * height;
  return pixels <= 1048576 ? 1 : pixels <= 1747627 ? 2 : pixels <= 2446678 ? 3 : pixels <= 3145728 ? 4 : 0;
}

/** Header-only dimensions: no pixel decoding just to discover the canvas. */
export function imageDimensions(bytes: BytesLike): { width: number; height: number } | null {
  const u = asU8(bytes), v = new DataView(u.buffer, u.byteOffset, u.byteLength);
  if (isPngBytes(u) && u.length >= 24) return { width: v.getUint32(16), height: v.getUint32(20) };
  if (!isWebpBytes(u)) return null;
  for (let p = 12; p + 8 <= u.length;) {
    const name = String.fromCharCode(...u.subarray(p, p + 4));
    const size = v.getUint32(p + 4, true), d = p + 8;
    if (d + size > u.length) return null;
    if (name === 'VP8X' && size >= 10) return {
      width: 1 + u[d + 4]! + (u[d + 5]! << 8) + (u[d + 6]! << 16),
      height: 1 + u[d + 7]! + (u[d + 8]! << 8) + (u[d + 9]! << 16),
    };
    if (name === 'VP8 ' && size >= 10) return { width: v.getUint16(d + 6, true) & 16383, height: v.getUint16(d + 8, true) & 16383 };
    if (name === 'VP8L' && size >= 5) { const n = v.getUint32(d + 1, true); return { width: (n & 16383) + 1, height: ((n >>> 14) & 16383) + 1 }; }
    p = d + size + (size & 1);
  }
  return null;
}
