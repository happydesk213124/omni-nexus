/**
 * 옴니 뷰어's line box, fitted to its line without a call to measure it: the box grows up with a
 * long line (its text ran on below the box, out of sight), and the viewer knows where the box's
 * top, the speaker's name on it, is without reading it back.
 *
 * Rows are counted as the box wraps them (keep-all: at spaces, a word too long for a row anywhere,
 * a new row at each newline) from rough letter widths in ems. A row is reckoned a little narrower
 * than it is, so a line is given a row too many rather than one too few (one too few hid its end).
 */
const WIDE = /[\u1100-\u11ff\u2e80-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uffef]/u;
// Dashes, ellipses and curly quotes are as wide as a Hangul letter in the box's Korean type.
const FULL = /[\u2010-\u206f]/u;
const em = (ch: string): number => WIDE.test(ch) || FULL.test(ch) ? 1 : ch === ' ' ? 0.28 : /[A-Z]/.test(ch) ? 0.72 : /[a-z0-9]/.test(ch) ? 0.58 : 0.42;

/** How many rows a line takes at this width and type size (px). */
export function textRows(text: string, width: number, size: number): number {
  const room = Math.max(1, width * 0.94);
  let rows = 0;
  for (const paragraph of text.split('\n')) {
    rows++;
    let used = 0;
    for (const word of paragraph.match(/[^ ]+ */g) ?? []) {
      const body = word.trimEnd(), wide = [...body].reduce((sum, ch) => sum + em(ch) * size, 0);
      if (used > 0 && used + wide > room) { rows++; used = 0; }
      if (wide > room) { rows += Math.floor(wide / room); used = wide % room; } else used += wide;
      used += (word.length - body.length) * em(' ') * size;
    }
  }
  return Math.max(1, rows);
}

export interface BoxGeometry {
  /** The viewer's frame (the box's containing block) and the box's own width, px. */
  frameHeight: number;
  boxWidth: number;
  /** Its padding and border, across and down; its type size and line height, px. */
  across: number;
  down: number;
  size: number;
  lineHeight: number;
  /** The box's own least height (look.ts min-height), px. */
  least: number;
}
/** The box's least height in look.ts: a share of the frame, within bounds (a wide screen's box is centered and lower). */
export const boxLeast = (frameHeight: number, wide: boolean): number => wide
  ? Math.min(200, Math.max(150, frameHeight * 0.24))
  : Math.min(200, Math.max(136, frameHeight * 0.26));
/** Most of the stage, at most (look.ts max-height): past that the line scrolls in its box. */
export const BOX_MOST = 0.58;
/** The box's height for a line, px: its rows and padding, never under its least, never over most of the frame. */
export function fitBoxHeight(text: string, g: BoxGeometry): number {
  const rows = textRows(text, g.boxWidth - g.across, g.size);
  return Math.round(Math.min(Math.max(g.least, rows * g.lineHeight + g.down), g.frameHeight * BOX_MOST));
}
