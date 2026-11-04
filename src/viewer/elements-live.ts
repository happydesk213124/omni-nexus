import { CHAT_LIST } from './chat-screen';

/**
 * 요소's 작동: the chat's own element shown in the middle of the viewer, its buttons Risu's. Risu takes a button's
 * click on the message itself (Chat.svelte: `.risu-chat`'s onclickcapture finds `[risu-trigger],[risu-btn]`), so the
 * element stays where Risu drew it: the chat behind the viewer is scrolled until it stands in the middle, and it is
 * seen through a hole cut in the viewer (clip-path) where it is.
 *
 * It is never lifted out of its place (position:fixed): any box of Risu's page around it that holds fixed boxes (a
 * transform, a filter, containment, a newer Tailwind's translate) moved a lifted one away from the middle, and those
 * cannot all be known or undone. Scrolled, it is where the chat puts it, as the chat shows it.
 *
 * Behind the viewer only the newest messages are drawn, and a reply's panel is often its last line: the list has room
 * made above and below it while the popup is open, so any of them can be scrolled to the middle. The chat's bar under
 * the viewer is left out of the middle (a scroll margin as tall).
 *
 * Nothing is written on the chat's nodes (SafeDOM writes x- attributes only, and Risu draws a message anew after a
 * button, its nodes new): the sheet names the element by its message and its kind. Pure: the sheet's text.
 */
export interface Box { left: number; top: number; width: number; height: number }
export interface LiveEntry {
  /** One selector per window (a kind the message holds more than once: each its own, by its place among siblings). */
  targets: string[];
  scale: number;
  /** How tall the chat's bar under the viewer is: left out of the middle the scroll brings it to. */
  below: number;
  /** Where each window is (the holes), read after the scroll; null, none. */
  rects: Array<Box | null>;
}

const round = (n: number) => Math.round(n * 10) / 10;

/** The selectors of a kind's windows in a message: the kind itself, or, held more than once, each by its place. */
export function liveTargets(index: number, selector: string, count: number): string[] {
  const base = `.risu-chat[data-chat-index="${index}"] .chattext ${selector}`;
  const n = Math.min(6, Math.max(1, count));
  return n === 1 ? [base] : Array.from({ length: n }, (_, k) => `${base}:nth-child(${k + 1} of ${selector})`);
}

/** The sheet: room in the list to scroll any element to the middle, each element's margin and size, the holes. */
export function liveCss(entries: readonly LiveEntry[], frame: Box): string {
  if (!entries.length) return '';
  const out = [`${CHAT_LIST}{padding-block:50vh!important}`], holes: string[] = [];
  for (const e of entries) {
    // Its 크기 in place, about its middle: the chat's layout stays as it was.
    const size = e.scale !== 1 ? `;transform:scale(${e.scale})!important;transform-origin:50% 50%!important` : '';
    out.push(`:is(${e.targets.join(',')}){scroll-margin-bottom:${round(e.below)}px!important${size}}`);
    for (const r of e.rects) {
      if (!r || r.width <= 0 || r.height <= 0) continue;
      const x = round(r.left - frame.left), y = round(r.top - frame.top), w = round(r.width), h = round(r.height);
      holes.push(`M${x} ${y}h${w}v${h}h${-w}Z`);
    }
  }
  // The viewer with a hole where each window is (even-odd: the frame, then each hole cut out of it).
  if (holes.length) out.push(`[x-omni-vn]{clip-path:path(evenodd,"M0 0H${round(frame.width)}V${round(frame.height)}H0Z${holes.join('')}")!important}`);
  return out.join('\n');
}
