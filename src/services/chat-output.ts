import { dbg } from '../core/debug';
import { risuHost } from '../core/host';
import { noteChatOutput } from './tts-context';

/**
 * One listener for Risu's chat output, shared by everyone here who wants to hear that a reply was saved.
 *
 * Risu hands each listener the whole bot (every chat it has) and the chat, copied across the bridge once per
 * listener, and waits for each to answer before it finishes the reply. Three of ours (the frozen UI's, the TTS
 * host's, 옴니 뷰어's) were three copies of the bot per reply, and the reply was not over for Risu (its stop button,
 * the next message) until the slowest had answered: with 답장 자동 읽기 on, the TTS host answered only once the
 * reply's first line was being read.
 *
 * Risu now has one listener, and it answers at once. Ours are then told, in the order they asked, each on its own:
 * one that fails or takes long holds up neither Risu nor the others.
 */
type Listener = (arg: ChatOutputListenerArg) => void | Promise<void>;
const listeners = new Set<Listener>();
let registered: Promise<void> | null = null, delivered: Promise<unknown> = Promise.resolve();

const report = (error: unknown): void => { dbg('chat-output.listener', { message: String((error as Error)?.message || error) }, 'warn'); };

function deliver(arg: ChatOutputListenerArg): void {
  // Before anyone reads the chat again: the reply is saved, and the bot Risu just handed over is the open one.
  try { noteChatOutput(arg); } catch (error) { report(error); }
  const told = [...listeners].map(fn => { try { return Promise.resolve(fn(arg)).catch(report); } catch (error) { report(error); return Promise.resolve(); } });
  delivered = Promise.all(told);
}

/** Hears every reply saved from now on. Resolves once Risu has been asked (it says nothing when it refuses). */
export function addChatOutputListener(fn: Listener): Promise<void> {
  publish();
  listeners.add(fn);
  const host = risuHost();
  if (typeof host?.addRisuChatListener !== 'function') return Promise.resolve();
  return registered ??= Promise.resolve(host.addRisuChatListener('output', deliver)).catch(error => { registered = null; throw error; });
}

export async function removeChatOutputListener(fn: Listener): Promise<void> {
  if (!listeners.delete(fn) || listeners.size || !registered) return;
  const asked = registered; registered = null;
  await asked.catch(() => {});
  // Someone asked again meanwhile: Risu's listener stays.
  if (listeners.size) { registered ??= asked; return; }
  await Promise.resolve(risuHost()?.removeRisuChatListener?.('output', deliver)).catch(() => {});
}

/** Everyone told of the last reply has finished with it (tests wait on this; Risu does not). */
export function chatOutputSettled(): Promise<void> { return delivered.then(() => undefined); }

/** For the frozen UI, which cannot import: its own output listener goes through here too. */
export function publish(): void {
  if (Reflect.get(globalThis, '__OMNI_CHAT_OUTPUT__')) return;
  Reflect.set(globalThis, '__OMNI_CHAT_OUTPUT__', { add: addChatOutputListener, remove: removeChatOutputListener, settled: chatOutputSettled });
}
export const installChatOutputHub = publish;
