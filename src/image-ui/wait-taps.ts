import { dbg } from '../core/debug';
import { risuHost } from '../core/host';
import { generateAllInlineWaits, generateInlineWait, type BulkWaitProgress } from '../services/inline-waits';
import { currentTtsContext } from '../services/tts-context';
import { getConfig } from '../services/context';
import { inlineWaitCount, subscribeInlineWaits } from '../storage/inline-wait-store';
import { hitHost, releaseHost, safeArray, type HostPoint } from '../tts-ui/host-utils';

/**
 * Pink waiting slots (streaming tags): a double tap generates that slot. Chat clicks are
 * watched while streaming tags are on (a waiting block lives in the message, from
 * this session or an earlier one) or an older stored slot waits, so a chat without
 * them pays nothing. The frozen UI's pointer pipeline is not touched.
 */
let installed = false;
/** Two taps on the same slot within this long count as one double tap. */
export const DOUBLE_TAP_MS = 450;
/** A press held this long on a pink slot makes every pink slot of its message. */
export const LONG_PRESS_MS = 1500;
/**
 * Only a finger still down this long is looked at. Looking on every touch measured each
 * pink slot through the bridge, on taps and scroll starts alike, and held up other
 * gestures (the double tap that opens an image full screen) on a phone.
 */
export const PRESS_LOOK_MS = 300;
/** A reply still arriving: its slots cannot be made yet, so a press shows nothing. */
const replyStreaming = (): boolean => { const live = Reflect.get(globalThis, '__OMNI_REPLY_STREAMING__'); return typeof live === 'function' && !!live(); };
let synchronize: () => Promise<void> = async () => {};

/** Called once the chat is known with streaming tags on; boot itself reads nothing. */
export function syncWaitTaps(): Promise<void> { return synchronize(); }

export function installWaitTaps(): void {
  if (installed) return;
  installed = true;
  Reflect.set(globalThis, '__OMNI_WAIT_TAPS__', { sync: () => { void syncWaitTaps().catch(error => dbg('wait.taps.sync', { message: String(error) }, 'warn')); } });
  let doc: SafeDocument | null = null, busy = false, syncing: Promise<void> | null = null;
  let listeners: Array<[string, string]> = [];

  const slotAt = async (event: HostPoint, selector = '[data-inray-wait],[data-inray-spinner]'): Promise<{ id: string; index: number } | null> => {
    // A spinner whose job ended without it (kept shot) is tapped like a pink slot.
    const nodes = await safeArray(await doc!.querySelectorAll(selector));
    const owned: unknown[] = [...nodes];
    try {
      let hit: SafeElement | undefined;
      for (const node of nodes) if (await hitHost(node, event)) { hit = node; break; }
      if (!hit) return null;
      const id = /\bdata-inray-(?:wait|spinner)="([a-zA-Z0-9_-]{1,64})"/.exec(String(await hit.getOuterHTML()).split('>')[0] || '')?.[1];
      if (!id) return null;
      // The slot's message: only the matching wrapper's opening tag is read.
      let parent = await hit.getParent();
      for (let depth = 0; parent && depth < 16; depth++) {
        owned.push(parent);
        if (await parent.matches('.risu-chat')) {
          const html = await parent.getOuterHTML();
          const index = Number(/\bdata-chat-index="(\d+)"/.exec(html.slice(0, html.indexOf('>') + 1))?.[1] ?? NaN);
          return Number.isInteger(index) ? { id, index } : null;
        }
        parent = await parent.getParent();
      }
      return null;
    } finally { for (const item of owned) await releaseHost(item); }
  };

  /** What a slot's job needs to find its message, read when the slot is acted on. */
  const slotTarget = async (slot: { id: string; index: number }) => {
    const host = risuHost()!;
    const [context, charIndex, chatIndex] = await Promise.all([currentTtsContext(), host.getCurrentCharacterIndex?.(), host.getCurrentChatIndex?.()]);
    const message = context.messages[slot.index] as Record<string, unknown> | undefined;
    if (!message) return null;
    return { session_id: context.sessionId, character_id: context.characterId, chat_id: context.chatId,
      char_index: charIndex, chat_index: chatIndex, host_message_id: String(message.chatId || message.id || ''), message_index: slot.index };
  };
  // The frozen UI owns the progress toast; it follows a slot's job like any other.
  const track = (sessionId: string, jobId: string) => {
    const follow = Reflect.get(globalThis, '__OMNI_TRACK_JOB__');
    if (typeof follow === 'function') follow(sessionId, jobId);
  };

  // A short notice at the top of the page while a press is held and while its slots are made.
  let toast: SafeElement | null = null, toastTimer: ReturnType<typeof setTimeout> | undefined, toastTail: Promise<void> = Promise.resolve();
  const say = (text: string, holdMs = 0): Promise<void> => toastTail = toastTail.catch(() => {}).then(async () => {
    clearTimeout(toastTimer);
    if (!doc) return;
    if (!toast) {
      const node = await doc.createElement('div'), body = await doc.querySelector('body');
      await node.setAttribute('x-omni-wait-toast', '1');
      await node.setStyleAttribute('position:fixed;left:50%;top:18px;transform:translateX(-50%);z-index:2147483200;width:max-content;max-width:calc(100vw - 32px);box-sizing:border-box;padding:10px 14px;border:1px solid #f472b688;border-radius:12px;color:#fde7f3;background:rgba(60,18,44,.95);font:13px/18px sans-serif;text-align:center;pointer-events:none');
      if (body) await body.appendChild(node);
      await releaseHost(body);
      toast = node;
    }
    await toast.setTextContent(text);
    if (holdMs) toastTimer = setTimeout(() => { void hush(); }, holdMs);
  });
  const hush = (): Promise<void> => toastTail = toastTail.catch(() => {}).then(async () => {
    clearTimeout(toastTimer);
    const node = toast; toast = null;
    if (!node) return;
    try { await node.remove(); } catch { /* gone with the page */ }
    await releaseHost(node);
  });

  // A double tap on one slot makes it; a single tap (scrolling, a stray touch) never spends a request.
  let last = { key: '', at: 0 }, ignoreClickUntil = 0;
  const tap = async (event: HostPoint) => {
    if (busy || Date.now() < ignoreClickUntil) return;
    const slot = await slotAt(event);
    if (!slot) return;
    const key = `${slot.index}:${slot.id}`, now = Date.now();
    if (last.key !== key || now - last.at > DOUBLE_TAP_MS) { last = { key, at: now }; return; }
    last = { key: '', at: 0 };
    busy = true;
    try {
      const target = await slotTarget(slot);
      if (!target) return;
      const result = await generateInlineWait({ ...target, wait_id: slot.id });
      const row = result as { ok?: boolean; job_id?: unknown; error?: { message?: unknown } };
      if (!row.ok || !row.job_id) { dbg('wait.tap.refused', { message: String(row.error?.message || '') }, 'warn'); return; }
      track(target.session_id, String(row.job_id));
    } finally { busy = false; }
  };

  /**
   * 꾹 누르기: a press held on a pink slot for 1.5 s makes every pink slot of that message,
   * from the pressed one down, then from the top. A notice shows while it is held; a lift
   * or a scroll (the pointer is cancelled) before then is an ordinary tap.
   */
  let press: { timer?: ReturnType<typeof setTimeout>; fired: boolean; shown: boolean } | null = null;
  const down = (event: HostPoint) => {
    if (busy || (event.button ?? 0) !== 0 || replyStreaming()) return;
    const at = Date.now();
    const held: { timer?: ReturnType<typeof setTimeout>; fired: boolean; shown: boolean } = { fired: false, shown: false };
    press = held;
    // Nothing is asked of the page until the finger has stayed: a tap or a scroll is gone by then.
    held.timer = setTimeout(() => { void (async () => {
      if (press !== held || replyStreaming()) return;
      const slot = await slotAt(event, '[data-inray-wait]');
      if (press !== held) return;
      if (!slot) { press = null; return; }
      held.shown = true;
      void say('꾹 누르는 중… 1.5초 누르면 이 메시지의 분홍 칸을 모두 만듭니다');
      held.timer = setTimeout(() => {
        if (press !== held) return;
        held.fired = true; ignoreClickUntil = Date.now() + 1000;
        void makeAll(slot).catch(error => { void say(String((error as Error)?.message || error), 4000); });
      }, Math.max(0, LONG_PRESS_MS - (Date.now() - at)));
    })().catch(error => dbg('wait.press', { message: String(error) }, 'warn')); }, PRESS_LOOK_MS);
  };
  const lift = () => {
    const held = press; press = null;
    if (held && !held.fired) { clearTimeout(held.timer); if (held.shown) void hush(); }
  };
  const makeAll = async (slot: { id: string; index: number }) => {
    const target = await slotTarget(slot);
    if (!target) { await hush(); return; }
    const tracked = new Set<string>();
    const shown = (state: BulkWaitProgress) => {
      if (state.jobId && !tracked.has(state.jobId)) { tracked.add(state.jobId); track(target.session_id, state.jobId); }
      if (state.finished) void say(state.stopped ? `분홍 칸 만들기 멈춤 · ${state.stopped}` : `분홍 칸 ${state.made}/${state.total}개 만들기 끝`, 4000);
      else void say(`분홍 칸 만드는 중 ${Math.min(state.done + 1, state.total)}/${state.total}`);
    };
    const result = await generateAllInlineWaits({ ...target, wait_id: slot.id }, shown) as { ok?: boolean; total?: unknown; error?: { message?: unknown } };
    if (!result.ok) await say(String(result.error?.message || '분홍 칸을 만들지 못했습니다.'), 4000);
    else await say(`분홍 칸 ${Number(result.total)}개를 누른 칸부터 차례로 만듭니다`);
  };

  const listen = async (type: string, fn: (event: HostPoint) => void) => { listeners.push([type, await doc!.addEventListener(type, fn)]); };
  synchronize = () => syncing ??= (async () => {
    const host = risuHost();
    if (!host?.getRootDocument) return;
    const waiting = getConfig().card?.stream_inline_tags === true || await inlineWaitCount() > 0;
    if (waiting && !listeners.length) {
      doc ||= await host.getRootDocument();
      if (!doc) return;
      const report = (name: string) => (error: unknown) => dbg(name, { message: String(error) }, 'warn');
      await listen('click', event => { void tap(event).catch(report('wait.tap')); });
      await listen('pointerdown', down);
      await listen('pointerup', lift);
      await listen('pointercancel', lift);
    } else if (!waiting && listeners.length && doc) {
      for (const [type, id] of listeners.splice(0)) await doc.removeEventListener(type, id);
    }
  })().finally(() => { syncing = null; });
  subscribeInlineWaits(() => { void synchronize().catch(error => dbg('wait.taps.sync', { message: String(error) }, 'warn')); });
}
