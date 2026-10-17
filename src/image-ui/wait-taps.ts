import { dbg } from '../core/debug';
import { risuHost } from '../core/host';
import { generateInlineWait } from '../services/inline-waits';
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
let synchronize: () => Promise<void> = async () => {};

/** Called once the chat is known with streaming tags on; boot itself reads nothing. */
export function syncWaitTaps(): Promise<void> { return synchronize(); }

export function installWaitTaps(): void {
  if (installed) return;
  installed = true;
  Reflect.set(globalThis, '__OMNI_WAIT_TAPS__', { sync: () => { void syncWaitTaps().catch(error => dbg('wait.taps.sync', { message: String(error) }, 'warn')); } });
  let doc: SafeDocument | null = null, listener = '', busy = false, syncing: Promise<void> | null = null;

  const slotAt = async (event: HostPoint): Promise<{ id: string; index: number } | null> => {
    const nodes = await safeArray(await doc!.querySelectorAll('[data-inray-wait]'));
    const owned: unknown[] = [...nodes];
    try {
      let hit: SafeElement | undefined;
      for (const node of nodes) if (await hitHost(node, event)) { hit = node; break; }
      if (!hit) return null;
      const id = /\bdata-inray-wait="([a-zA-Z0-9_-]{1,64})"/.exec(String(await hit.getOuterHTML()).split('>')[0] || '')?.[1];
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

  // A double tap on one slot makes it; a single tap (scrolling, a stray touch) never spends a request.
  let last = { key: '', at: 0 };
  const tap = async (event: HostPoint) => {
    if (busy) return;
    const slot = await slotAt(event);
    if (!slot) return;
    const key = `${slot.index}:${slot.id}`, now = Date.now();
    if (last.key !== key || now - last.at > DOUBLE_TAP_MS) { last = { key, at: now }; return; }
    last = { key: '', at: 0 };
    busy = true;
    try {
      const host = risuHost()!;
      const [context, charIndex, chatIndex] = await Promise.all([currentTtsContext(), host.getCurrentCharacterIndex?.(), host.getCurrentChatIndex?.()]);
      const message = context.messages[slot.index] as Record<string, unknown> | undefined;
      if (!message) return;
      const result = await generateInlineWait({
        wait_id: slot.id, session_id: context.sessionId, character_id: context.characterId, chat_id: context.chatId,
        char_index: charIndex, chat_index: chatIndex, host_message_id: String(message.chatId || message.id || ''), message_index: slot.index,
      });
      const row = result as { ok?: boolean; job_id?: unknown; error?: { message?: unknown } };
      if (!row.ok || !row.job_id) { dbg('wait.tap.refused', { message: String(row.error?.message || '') }, 'warn'); return; }
      // The frozen UI owns the progress toast; it follows this job like any other.
      const track = Reflect.get(globalThis, '__OMNI_TRACK_JOB__');
      if (typeof track === 'function') track(context.sessionId, String(row.job_id));
    } finally { busy = false; }
  };

  synchronize = () => syncing ??= (async () => {
    const host = risuHost();
    if (!host?.getRootDocument) return;
    const waiting = getConfig().card?.stream_inline_tags === true || await inlineWaitCount() > 0;
    if (waiting && !listener) {
      doc ||= await host.getRootDocument();
      if (doc) listener = await doc.addEventListener('click', (event: HostPoint) => { void tap(event).catch(error => dbg('wait.tap', { message: String(error) }, 'warn')); });
    } else if (!waiting && listener && doc) {
      await doc.removeEventListener('click', listener);
      listener = '';
    }
  })().finally(() => { syncing = null; });
  subscribeInlineWaits(() => { void synchronize().catch(error => dbg('wait.taps.sync', { message: String(error) }, 'warn')); });
}
