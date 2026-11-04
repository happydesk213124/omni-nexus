/**
 * 요소's 작동: the chat's own element opened in the middle of the stage, its buttons Risu's. Risu takes a button's
 * click on the message itself (Chat.svelte: `.risu-chat`'s onclickcapture finds `[risu-trigger],[risu-btn]`), so the
 * element must stay in its message: it is lifted in place by one style sheet (position:fixed, centred on the stage's
 * middle by its own size, so its height need not be read first), and seen through a hole cut in the viewer
 * (clip-path), the viewer standing over the chat as it always does.
 *
 * Why a hole and not a z-index over the viewer: whatever in Risu's page around the chat makes a stacking context
 * (a fixed or a positioned and z-indexed box, an opacity) would keep the element under the viewer, and those cannot
 * be undone without moving Risu's page. Only what keeps a fixed element from the screen is undone, around it:
 * transforms, filters, containment, and the like.
 *
 * Nothing is written on the chat's nodes (SafeDOM writes x- attributes only, and Risu draws a message anew after a
 * button, its nodes new): the sheet names the element by its message and its kind, so a message drawn anew in the
 * same shape is lifted again by itself. Pure: the sheet's text from where each window is.
 */
export interface Box { left: number; top: number; width: number; height: number }
export interface LiveEntry {
  /** The message the element is in, and the kind's selector there. */
  index: number;
  selector: string;
  /** One selector per window (a kind the message holds more than once: each its own, by its place among siblings). */
  targets: string[];
  /** Where the first window's middle is on the screen (the rest step down and right from it), its width and its tallest. */
  cx: number;
  cy: number;
  width: number;
  maxHeight: number;
  scale: number;
  /** Where each window is (the holes): read where it went, or before that where it will stand; null, none. */
  rects: Array<Box | null>;
}

/** Each further window of a kind, this much further down and right. */
export const LIVE_STEP = 18;
/** What keeps a fixed element from the screen, or from being drawn: undone on the element's way up. */
const FREE = 'transform:none!important;perspective:none!important;filter:none!important;backdrop-filter:none!important;'
  + 'contain:none!important;will-change:auto!important;container-type:normal!important;content-visibility:visible!important;'
  + 'clip-path:none!important;mask:none!important;-webkit-mask:none!important;opacity:1!important';
const round = (n: number) => Math.round(n * 10) / 10;

/** The selectors of a kind's windows in a message: the kind itself, or, held more than once, each by its place. */
export function liveTargets(index: number, selector: string, count: number): string[] {
  const base = `.risu-chat[data-chat-index="${index}"] .chattext ${selector}`;
  const n = Math.min(6, Math.max(1, count));
  return n === 1 ? [base] : Array.from({ length: n }, (_, k) => `${base}:nth-child(${k + 1} of ${selector})`);
}

/** The sheet: each element lifted to its window, what is around it freed, and the holes in the viewer. */
export function liveCss(entries: readonly LiveEntry[], frame: Box): string {
  if (!entries.length) return '';
  const out: string[] = [], around = new Set<string>(['body', 'body :has(.default-chat-screen)', '.default-chat-screen']), within = new Set<string>(), holes: string[] = [];
  for (const e of entries) {
    const message = `.risu-chat[data-chat-index="${e.index}"]`;
    for (const s of [`.default-chat-screen :has(${message})`, message, `${message} :has(${e.selector})`]) { around.add(s); within.add(s); }
    e.targets.forEach((target, k) => {
      const left = e.cx + k * LIVE_STEP, top = e.cy + k * LIVE_STEP;
      out.push(`${target}{position:fixed!important;left:${round(left)}px!important;top:${round(top)}px!important;right:auto!important;bottom:auto!important;`
        // A scroll inside it stays its own: at its end it does not go on into the chat behind.
        + `width:${round(e.width)}px!important;max-width:none!important;max-height:${round(e.maxHeight)}px!important;overflow:auto!important;overscroll-behavior:contain!important;margin:0!important;`
        + `box-sizing:border-box!important;z-index:2147483000!important;transform:translate(-50%,-50%) scale(${e.scale})!important;transform-origin:50% 50%!important;`
        + 'visibility:visible!important;pointer-events:auto!important}');
      const r = e.rects[k];
      if (r && r.width > 0 && r.height > 0) {
        const x = round(r.left - frame.left), y = round(r.top - frame.top), w = round(r.width), h = round(r.height);
        holes.push(`M${x} ${y}h${w}v${h}h${-w}Z`);
      }
    });
    // An element with no background of its own would show the chat behind it through the hole: Risu's own colour,
    // under any the bot gives it (:where weighs nothing, so the bot's rule wins).
    out.push(`:where(${e.targets.join(',')}){background-color:var(--risu-theme-bgcolor,#282a36)}`);
  }
  // Inside the chat the lifted element stands over its neighbours: no box on its way up keeps it among them.
  out.unshift(`:is(${[...within].join(',')}){z-index:auto!important;isolation:auto!important}`);
  out.unshift(`:is(${[...around].join(',')}){${FREE}}`);
  // The viewer with a hole where each window is (even-odd: the frame, then each hole cut out of it).
  if (holes.length) out.push(`[x-omni-vn]{clip-path:path(evenodd,"M0 0H${round(frame.width)}V${round(frame.height)}H0Z${holes.join('')}")!important}`);
  return out.join('\n');
}
