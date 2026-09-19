/** Vendor IIFE installs this after `nxPatchInlinePhotoByCardId` exists. */
export const REPLACE_INLINE_PHOTO_KEY = '__INLAY_REPLACE_INLINE_PHOTO__';

type ReplaceInlinePhoto = (
  cardId: string,
  src: string,
  prevId?: string,
  rootEl?: unknown,
  rootKey?: string,
) => Promise<unknown>;

/**
 * Same-card studio save does not allocate a new id, so reconcile would keep
 * the old photo. Call the vendor swap so the inline slot flips like a reroll.
 */
export async function replaceInlinePhotoAfterSave(
  cardId: string,
  src: string,
  prevId = cardId,
): Promise<boolean> {
  const id = String(cardId || '');
  if (!id) return false;
  const fn = (globalThis as Record<string, unknown>)[REPLACE_INLINE_PHOTO_KEY];
  if (typeof fn !== 'function') return false;
  try {
    return Boolean(await (fn as ReplaceInlinePhoto)(id, String(src || ''), prevId || id));
  } catch {
    return false;
  }
}
