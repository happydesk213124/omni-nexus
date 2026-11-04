import { nearestRow, release, unwrap } from './safe-dom';
import { openingTag } from '../tts-ui/host-utils';

/** Risu's chat list: newest message first in the page, drawn bottom up. */
export const CHAT_LIST = '.default-chat-screen > .flex-col-reverse';

/** The chat screen less Risu's input bar under its messages: what 옴니 뷰어 covers. */
export async function chatArea(screen: SafeElement): Promise<{ left: number; top: number; width: number; height: number }> {
  const s = await screen.getBoundingClientRect();
  let below = 0;
  const others = await screen.querySelectorAll(':scope > :not(.absolute):not(.fixed):has(~ .flex-col-reverse)');
  for (const node of await unwrap(others)) { const r = await node.getBoundingClientRect(); below += r.height; await release(node); }
  return { left: Math.round(s.left), top: Math.round(s.top), width: Math.round(s.width), height: Math.max(160, Math.round(s.height - below)) };
}

// Risu lets a plugin read only its own x- attributes: a message's number is read off its row's own tag, from a
// shallow copy (the row's HTML carries every picture in it as base64).
async function chatIndexOf(row: SafeElement): Promise<number> {
  const html = await openingTag(row);
  return Number(/\bdata-chat-index="(\d+)"/.exec(html.slice(0, html.indexOf('>') + 1))?.[1] ?? -1);
}

/**
 * The chat as Risu shows it now: the message in the middle of the chat screen (a binary search over the messages
 * drawn, a few calls whatever the chat's length) and whether the newest message's foot is in sight, the reader at
 * the bottom. null without a chat screen; center -1 with no message drawn.
 */
export async function chatView(d: SafeDocument): Promise<{ center: number; atBottom: boolean } | null> {
  const screen = await d.querySelector('.default-chat-screen');
  if (!screen) return null;
  let area: Awaited<ReturnType<typeof chatArea>>;
  try { area = await chatArea(screen); } finally { await release(screen); }
  const rows = `${CHAT_LIST} .risu-chat[data-chat-index]`;
  const middle = await nearestRow(d, rows, area.top + area.height / 2, true);
  let center = -1;
  if (middle) try { center = await chatIndexOf(middle); } finally { await release(middle); }
  const newest = await d.querySelector(rows);
  let atBottom = false;
  if (newest) try { const r = await newest.getBoundingClientRect(); atBottom = r.height > 0 && r.bottom <= area.top + area.height + 2; } finally { await release(newest); }
  return { center, atBottom };
}

/**
 * The chat message in the middle of the chat screen. Read before 옴니 뷰어 folds the chat, which moves it. -1 for none.
 */
export async function messageAtCenter(d: SafeDocument): Promise<number> {
  const screen = await d.querySelector('.default-chat-screen');
  if (!screen) return -1;
  let area: Awaited<ReturnType<typeof chatArea>>;
  try { area = await chatArea(screen); } finally { await release(screen); }
  const row = await nearestRow(d, `${CHAT_LIST} .risu-chat[data-chat-index]`, area.top + area.height / 2, true);
  if (!row) return -1;
  try { return await chatIndexOf(row); } finally { await release(row); }
}
