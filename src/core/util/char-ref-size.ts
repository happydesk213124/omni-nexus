/** Max stored width for a character reference (aspect kept). */
export const CHAR_REF_STORE_MAX_WIDTH = 400;
/** Forced webp quality for the module store. */
export const CHAR_REF_STORE_WEBP_QUALITY = 0.8;
/** Style-preset look shots (등록 / 생성 / from-image). */
export const PRESET_LOOK_WEBP_QUALITY = 0.9;

export function charRefStoreSize(
  width: number,
  height: number,
  maxWidth = CHAR_REF_STORE_MAX_WIDTH,
): { w: number; h: number } {
  const srcW = Math.max(1, Math.round(Number(width) || 1));
  const srcH = Math.max(1, Math.round(Number(height) || 1));
  const cap = Math.max(1, Math.round(Number(maxWidth) || CHAR_REF_STORE_MAX_WIDTH));
  if (srcW <= cap) return { w: srcW, h: srcH };
  const scale = cap / srcW;
  return { w: cap, h: Math.max(1, Math.round(srcH * scale)) };
}
