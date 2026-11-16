/**
 * Whether 옴니 뷰어 covers the chat. Behind it the chat's TTS buttons and the TTS window
 * are out of sight, so they stop reading the chat and painting while it is up: their
 * host calls would queue in front of the viewer's own, a whole chat scan (and a read of
 * the whole character) after every tap. They catch up once, when it closes.
 */
let covering = false;
const uncovered = new Set<() => void>();

export const viewerCovering = (): boolean => covering;

export function setViewerCovering(on: boolean): void {
  if (covering === on) return;
  covering = on;
  // The vendor's scroll holds (tools/vendor-patches/scroll-runtime.js) cannot import this: they ask the global.
  Reflect.set(globalThis, '__OMNI_VIEWER_COVERING__', viewerCovering);
  if (on) return;
  for (const fn of [...uncovered]) {
    try { fn(); } catch { /* one catching up never stops the others */ }
  }
}

/** Called each time the viewer stops covering the chat; returns how to stop being called. */
export function onViewerUncovered(fn: () => void): () => void {
  uncovered.add(fn);
  return () => { uncovered.delete(fn); };
}

/**
 * Omni's own controls floating over the chat (the 🟪 플로팅 태그): a press on one is no press on the chat beneath,
 * as one on 옴니 뷰어 is not. The viewer's __OMNI_VIEWER_COVERS__ asks these too, so the frozen UI's message gestures,
 * the TTS line buttons and the pink slots all leave the press alone. Each answers from rectangles it already has.
 */
const covers = new Set<(x: number, y: number) => boolean>();
export function addChatCover(fn: (x: number, y: number) => boolean): () => void {
  covers.add(fn);
  return () => { covers.delete(fn); };
}
export function chatCovered(x: number, y: number): boolean {
  for (const fn of covers) if (fn(x, y)) return true;
  return false;
}

/**
 * Whether a tap focuses the button it lands on here. A press arrives as a point only (no target), and the point is
 * true of whatever lies beneath it too: a button under a panel, a menu or another button answered a press on those.
 * The focused button is the one the browser itself gave the press to, so where taps focus, the focused one is asked
 * first and nothing else counts. WebKit (every iPhone browser) never focuses a tapped <button>: there the point is
 * all there is. Learned from the first of our buttons found focused; shared with the frozen UI's patches by global.
 */
export const FOCUS_TAPS_KEY = '__OMNI_FOCUS_TAPS__';
export const focusTaps = (): boolean => Reflect.get(globalThis, FOCUS_TAPS_KEY) === true;
export function noteFocusTap(): void { Reflect.set(globalThis, FOCUS_TAPS_KEY, true); }
/** Omni's own windows over the chat (its settings, the inspect sheet, a modal it raised): no tap reaches the chat. */
export function omniWindowUp(): boolean { const blocked = Reflect.get(globalThis, '__OMNI_TTS_HOST_BLOCKED__'); return typeof blocked === 'function' && !!blocked(); }
