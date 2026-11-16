/**
 * 누끼 on a picture's bytes: decoded once, its plain background taken (domain/emotion/cutout.ts), written back as a PNG
 * with its transparency. A picture with nothing taken comes back as it was (its own bytes, not a copy re-encoded).
 */
import { decodeImage, drawToCanvas, type DrawnCanvas } from '../core/util/image';
import { sniffImageMime } from '../core/util/bytes';
import { cutoutPixels, type CutoutOptions, type CutoutResult } from '../domain/emotion/cutout';

export interface CutoutOutcome { bytes: Uint8Array; result: CutoutResult | 'failed'; color?: 'white' | 'black' }

async function pngOf(drawn: DrawnCanvas): Promise<Uint8Array | null> {
  if (drawn.kind === 'offscreen') {
    const blob = await drawn.canvas.convertToBlob({ type: 'image/png' });
    return blob?.size ? new Uint8Array(await blob.arrayBuffer()) : null;
  }
  const canvas = drawn.canvas;
  const blob = await new Promise<Blob | null>(resolve => { if (typeof canvas.toBlob === 'function') canvas.toBlob(resolve, 'image/png'); else resolve(null); });
  if (blob?.size) return new Uint8Array(await blob.arrayBuffer());
  const url = canvas.toDataURL('image/png'), comma = url.indexOf(',');
  if (comma < 0) return null;
  const raw = atob(url.slice(comma + 1)), out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** The picture with its plain background taken; `failed` when it cannot be read or written here (it comes back as it was). */
export async function cutoutBytes(bytes: Uint8Array, options: CutoutOptions = {}): Promise<CutoutOutcome> {
  let drawn: DrawnCanvas | null = null;
  try {
    const image = await decodeImage(bytes, sniffImageMime(bytes) || 'image/png', true);
    if (!image || !(image.width > 0 && image.height > 0)) return { bytes, result: 'failed' };
    drawn = drawToCanvas(image, image.width, image.height, true);
    image.close();
    if (!drawn) return { bytes, result: 'failed' };
    const ctx = (drawn.canvas as OffscreenCanvas | HTMLCanvasElement).getContext('2d') as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
    if (!ctx) return { bytes, result: 'failed' };
    const { width, height } = drawn.canvas, data = ctx.getImageData(0, 0, width, height);
    const { result, color } = cutoutPixels(data.data, width, height, options);
    if (result !== 'cut') return { bytes, result };
    ctx.putImageData(data, 0, 0);
    const png = await pngOf(drawn);
    return png ? { bytes: png, result, ...(color ? { color } : {}) } : { bytes, result: 'failed' };
  } catch {
    return { bytes, result: 'failed' };
  } finally {
    if (drawn) { drawn.canvas.width = 0; drawn.canvas.height = 0; }
  }
}
