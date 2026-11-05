import { risuHost } from '../core/host';
import { CHAT_LIST } from './chat-screen';
import { release } from './safe-dom';

/**
 * The chat behind the viewer, watched for a message come or gone that the viewer was not told of: a bot's Lua or a
 * module writing the reader's message when a panel's button is pressed, a reply sent with no stream, a delete. The
 * viewer reads the chat when it opens, when a stream ends, on 최신 and when a picture is baked; anything else left its
 * 요소 on the chat as it was until it was opened again.
 *
 * Risu tells of a container added to its list or taken from it (its own observer: nothing is read meanwhile, and a
 * message's text changing tells nothing). Then two small reads ask whether the message after the last one known is
 * drawn now, or the last one known is gone; only then is the chat read again (the whole character over the bridge:
 * dear, so only then). Older messages loaded at the list's top change neither.
 */
export interface ChatWatchHost {
  doc: () => SafeDocument | null;
  /** How many messages the viewer knows of (the chat as it read it). */
  known: () => number;
  /** Nothing to do now: a stream on (its own end reads the chat), the viewer stepped away or not reading yet. */
  idle: () => boolean;
  /** A message came or went: the chat read again, and what hangs on it. */
  changed: () => Promise<void>;
}
let host: ChatWatchHost | null = null, observer: SafeMutationObserver | null = null;
let timer: ReturnType<typeof setTimeout> | undefined, checking = false;
/** A burst of changes (a message and its picture drawn) asks once, a moment after the last. */
const SETTLE_MS = 600;

export async function chatWatchStart(h: ChatWatchHost): Promise<void> {
  host = h;
  const risu = risuHost(), doc = h.doc();
  if (!doc || typeof risu?.createMutationObserver !== 'function') return;
  const list = await doc.querySelector(CHAT_LIST);
  if (!list) return;
  try {
    const made = await risu.createMutationObserver(records => { releaseAll(records); onChange(); });
    await made.observe(list, { childList: true });
    if (host === h) observer = made; else disconnect(made);
  } catch { /* a Risu without it: the viewer reads the chat when it did before */ } finally { await release(list); }
}
export function chatWatchStop(): void {
  clearTimeout(timer); timer = undefined;
  const o = observer;
  observer = null; host = null;
  if (o) disconnect(o);
}
function disconnect(o: SafeMutationObserver): void {
  const off = Reflect.get(o, 'disconnect');
  if (typeof off === 'function') void Promise.resolve(off.call(o)).catch(() => {});
}
/** What the observer hands over is the bridge's: let go at once (nothing in it is read). */
function releaseAll(records: unknown): void {
  const list = Array.isArray(records) ? records : [records];
  for (const r of list) { const free = r && typeof r === 'object' ? Reflect.get(r, 'release') : null; if (typeof free === 'function') { try { void Promise.resolve(free.call(r)).catch(() => {}); } catch { /* gone */ } } }
}
function onChange(): void {
  if (!host || host.idle()) return;
  clearTimeout(timer);
  timer = setTimeout(() => { timer = undefined; void check().catch(() => {}); }, SETTLE_MS);
}
async function check(): Promise<void> {
  const h = host, doc = h?.doc();
  if (!h || !doc || h.idle() || checking) return;
  checking = true;
  try {
    const n = h.known();
    const [next, last] = await Promise.all([doc.querySelector(`.risu-chat[data-chat-index="${n}"]`), n > 0 ? doc.querySelector(`.risu-chat[data-chat-index="${n - 1}"]`) : Promise.resolve(null)]);
    const came = !!next, went = n > 0 && !last;
    await release(next); await release(last);
    if ((came || went) && h === host && !h.idle()) await h.changed();
  } finally { checking = false; }
}
