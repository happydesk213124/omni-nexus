/** `[[inxN]]{shot JSON}[[/inxN]]`. Kept apart so message-body and inline-shots share it without a cycle. */
// Named backreferences: these sources are joined into larger alternations, where \1 would count another group.
export const INLINE_SHOT_CLOSED_SOURCE = String.raw`\[\[inx(?<inx>\d{1,3})\]\]([\s\S]{0,12000}?)\[\[\/inx\k<inx>\]\]`;
/**
 * A block with no image yet (failed, cancelled, or 「이미지 바로 생성」 off): the same
 * JSON, marked `inxw`. It stays in the message as the slot itself; the chat draws
 * it as a pink spinner, a tap generates it, and requests never carry it.
 */
export const INLINE_WAIT_BLOCK_SOURCE = String.raw`\[\[inxw(?<inxw>\d{1,3})\]\]([\s\S]{0,12000}?)\[\[\/inxw\k<inxw>\]\]`;
/** Closed blocks, or an opening still streaming (it runs to the end of the text). */
export const INLINE_SHOT_MASK_SOURCE = String.raw`${INLINE_SHOT_CLOSED_SOURCE}|\[\[inx\d{1,3}\]\][\s\S]*$`;
/**
 * `[[inxc]]{"new_characters":[…]}[[/inxc]]`: the people a reply introduces, written
 * before its story so they are on the roster before their first line. Never a slot.
 */
export const INLINE_CAST_CLOSED_SOURCE = String.raw`\[\[inxc\]\]([\s\S]{0,12000}?)\[\[\/inxc\]\]`;
// Open (still streaming, or never closed): only its own line, so a model that forgets
// the closing tag cannot take the story below it off the screen.
export const INLINE_CAST_MASK_SOURCE = String.raw`${INLINE_CAST_CLOSED_SOURCE}|\[\[inxc\]\][^\n]*`;
/** `[[place:cafe, indoors, window]]`: a scene's place on a line of its own (see domain/viewer/place). Never read, never a scene. */
export const PLACE_MARKER_SOURCE = String.raw`\[\[place:([^\]\n]{1,300})\]\]`;
