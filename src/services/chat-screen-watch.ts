import { risuHost } from '../core/host';
import { onViewerUncovered, viewerCovering } from './viewer-presence';

/**
 * Whether Risu's chat screen is on the page, and where: one check a second for everyone who needs it (the TTS
 * window, the 플로팅 태그, the floating viewer), where each looked it up on its own (two calls each time, the TTS
 * window even with TTS off). The screen is kept between checks, so a check is one call (its box); it is looked up
 * again only once that box is gone.
 *
 * Risu draws its settings, its character grid and its other pages in place of the chat screen (App.svelte: one or
 * the other), so the chat screen gone is how they are told. The floating viewer polled Risu's settings on its own
 * for that (every 3.2 s, every 0.4 s after a tap); it listens here instead. A click asks for a check 0.3 s later
 * (`soon`): Risu's settings open with one.
 *
 * Behind 옴니 뷰어 nothing is asked: all three are out of sight there, and the page under it cannot be left for
 * another. One check as it closes catches up (viewer-presence.ts).
 *
 * The check is a call to Risu each time, and it went on once a second for as long as a chat was open, the reader
 * doing nothing but read. Ten checks in a row that find nothing changed (ten seconds) and it slows to one every
 * five; a tap, a change, or the viewer closing brings the second back. What changes the screen without a tap (a
 * turned phone) is caught at the slower pace. With Risu's page out of sight (another tab, the phone's home screen)
 * nothing is asked at all, and one check is made as it comes back.
 */
/** `drawn` counts the times the screen was drawn anew (another bot's chat, say): one kept is no longer on the page. */
export interface ChatScreen { present: boolean; left: number; top: number; width: number; height: number; drawn: number }
type Listener = (screen: ChatScreen) => void;

const CHECK_MS = 1000, IDLE_CHECK_MS = 5000, QUIET_CHECKS = 10, SOON_MS = 300;
const listeners = new Set<Listener>();
let doc: SafeDocument | null = null, screen: SafeElement | null = null, drawn = 0;
let last: ChatScreen | null = null, timer: ReturnType<typeof setTimeout> | undefined, soonTimer: ReturnType<typeof setTimeout> | undefined;
let checking: Promise<void> | null = null, stopUncovered: (() => void) | undefined, stopVisible: (() => void) | undefined;
// Checks in a row that found the screen as it was.
let quiet = 0;
const pageHidden = (): boolean => typeof document !== 'undefined' && document.hidden === true;
/** The next check: a second on while things change or the reader taps, five once ten in a row found nothing new. */
function schedule(): void {
  clearTimeout(timer);
  if (!listeners.size) { timer = undefined; return; }
  timer = setTimeout(() => { timer = undefined; void checkChatScreen().finally(schedule); }, quiet < QUIET_CHECKS ? CHECK_MS : IDLE_CHECK_MS);
  // Node hosts (smoke, audit) end when nothing is left to run.
  (timer as unknown as { unref?: () => void }).unref?.();
}
/** Something happened (a tap, the viewer closed, the page came back): the quick pace again. */
function wake(): void {
  if (quiet >= QUIET_CHECKS) { quiet = 0; schedule(); } else quiet = 0;
}

const release = async (value: unknown): Promise<void> => {
  const r = value && typeof value === 'object' ? Reflect.get(value, 'release') : null;
  if (typeof r === 'function') { try { await r.call(value); } catch { /* gone with the page */ } }
};
const box = async (node: SafeElement | null) => (node ? await node.getBoundingClientRect().catch(() => null) : null);
const shown = (r: { width: number; height: number } | null) => !!r && r.width > 0 && r.height > 0;

async function lookAtChatScreen(): Promise<void> {
  const host = risuHost();
  if (!doc) doc = (await host?.getRootDocument?.()) ?? null;
  if (!doc) return;
  let r = await box(screen);
  if (!shown(r)) {
    const old = screen; screen = null; await release(old);
    screen = await doc.querySelector('.default-chat-screen');
    r = await box(screen);
    // The one kept is gone and another is up: what was put on the old one (a watcher, a marker) went with it.
    if (old && shown(r)) drawn++;
  }
  const next: ChatScreen = shown(r)
    ? { present: true, left: Math.round(r!.left), top: Math.round(r!.top), width: Math.round(r!.width), height: Math.round(r!.height), drawn }
    : { present: false, left: 0, top: 0, width: 0, height: 0, drawn };
  if (last && last.present === next.present && last.left === next.left && last.top === next.top && last.width === next.width && last.height === next.height && last.drawn === next.drawn) { quiet++; return; }
  last = next; quiet = 0;
  for (const fn of [...listeners]) { try { fn(next); } catch { /* one listener never stops the others */ } }
}

/** One check now (one at a time: a check under way is shared), unless 옴니 뷰어 is over the chat. */
function checkChatScreen(): Promise<void> {
  if (viewerCovering() || pageHidden()) return Promise.resolve();
  if (checking) return checking;
  checking = lookAtChatScreen().catch(() => {}).finally(() => { checking = null; });
  return checking;
}

/**
 * Listens while it is subscribed; told once a check knows (never with a guess first), then on every change. Never
 * told during the call itself: a listener that subscribes or lets go in turn (the floating viewer's does) finds its
 * own subscription already in hand.
 */
export function watchChatScreen(fn: Listener): () => void {
  listeners.add(fn);
  if (last) queueMicrotask(() => { if (listeners.has(fn) && last) fn(last); });
  if (!stopUncovered) {
    quiet = 0;
    stopUncovered = onViewerUncovered(() => { wake(); void checkChatScreen(); });
    if (typeof document !== 'undefined') {
      const visible = () => { if (!document.hidden) { wake(); void checkChatScreen(); } };
      document.addEventListener('visibilitychange', visible);
      stopVisible = () => document.removeEventListener('visibilitychange', visible);
    }
    void checkChatScreen().finally(schedule);
  }
  return () => {
    if (!listeners.delete(fn) || listeners.size) return;
    // Nobody left: nothing is asked, and nothing is kept to be told as news later.
    clearTimeout(timer); timer = undefined;
    clearTimeout(soonTimer); soonTimer = undefined;
    stopUncovered?.(); stopUncovered = undefined;
    stopVisible?.(); stopVisible = undefined;
    last = null;
    const held = screen; screen = null; void release(held);
  };
}

/** A tap happened: a check 0.3 s later (Risu's settings open with a tap, and close with one). */
export function checkChatScreenSoon(): void {
  if (!listeners.size) return;
  wake();
  if (soonTimer) return;
  soonTimer = setTimeout(() => { soonTimer = undefined; void checkChatScreen(); }, SOON_MS);
}
