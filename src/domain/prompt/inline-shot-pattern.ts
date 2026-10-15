/** `[[inxN]]{shot JSON}[[/inxN]]`. Kept apart so message-body and inline-shots share it without a cycle. */
export const INLINE_SHOT_CLOSED_SOURCE = String.raw`\[\[inx(\d{1,3})\]\]([\s\S]{0,12000}?)\[\[\/inx\1\]\]`;
/** Closed blocks, or an opening still streaming (it runs to the end of the text). */
export const INLINE_SHOT_MASK_SOURCE = String.raw`${INLINE_SHOT_CLOSED_SOURCE}|\[\[inx\d{1,3}\]\][\s\S]*$`;
