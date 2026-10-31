import { bytesToBase64, sniffImageMime } from '../core/util/bytes';

/**
 * A sprite or a background goes to Risu's screen as a data URL (a blob URL the plugin
 * makes is its own, and Risu's sanitizer strips it), so every byte crosses the bridge
 * and is checked and decoded there: a 2 MB PNG per face made each new face a stall.
 * It goes at the size it is seen at, as WebP with its alpha (a tenth of the bytes or
 * less); where WebP cannot be written (Safari), a smaller PNG; never larger than the
 * original. Kept per file for the session.
 */
const made = new Map<string, string>();
const KEEP = 60;
export async function screenImage(path: string, bytes: Uint8Array, box: { width: number; height: number; quality: number }): Promise<string> {
  const hit = made.get(path);
  if (hit) return hit;
  let url = '';
  try {
    if (typeof createImageBitmap === 'function' && typeof OffscreenCanvas === 'function') {
      const bitmap = await createImageBitmap(new Blob([bytes.slice()]));
      const scale = Math.min(1, box.width / bitmap.width, box.height / bitmap.height);
      const width = Math.max(1, Math.round(bitmap.width * scale)), height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = new OffscreenCanvas(width, height), context = canvas.getContext('2d');
      if (context) {
        context.drawImage(bitmap, 0, 0, width, height);
        const blob = await canvas.convertToBlob({ type: 'image/webp', quality: box.quality });
        if (blob.size < bytes.byteLength) url = `data:${blob.type || 'image/png'};base64,${bytesToBase64(new Uint8Array(await blob.arrayBuffer()))}`;
      }
      bitmap.close();
    }
  } catch { url = ''; }
  if (!url) url = `data:${sniffImageMime(bytes) || 'image/png'};base64,${bytesToBase64(bytes)}`;
  made.set(path, url);
  while (made.size > KEEP) made.delete(made.keys().next().value!);
  return url;
}
/** A standing figure fills at most the stage's height: this much is enough on a phone's dense screen. */
export const SPRITE_BOX = { width: 700, height: 1000, quality: 0.86 };
/** A background is blurred behind the cast: small and lighter still. */
export const BACKGROUND_BOX = { width: 960, height: 660, quality: 0.7 };
