/**
 * The reply a place in the chat stands for: a reply itself; a message of the reader's (or one past the end), the reply
 * after it, else the one before. -1 when the chat has no reply.
 */
export function replyAt(roles: readonly unknown[], index: number): number {
  if (roles[index] === 'char') return index;
  for (let i = Math.max(0, index + 1); i < roles.length; i++) if (roles[i] === 'char') return i;
  for (let i = Math.min(index - 1, roles.length - 1); i >= 0; i--) if (roles[i] === 'char') return i;
  return -1;
}

/**
 * The reply the 🟪 플로팅 태그 acts on, from how the chat is shown: at its bottom (the newest message's foot in sight)
 * the newest reply, the one just arrived; scrolled up, the reply in the middle of the screen, the one being read.
 */
export function readingReply(roles: readonly unknown[], view: { center: number; atBottom: boolean }): number {
  return view.atBottom || view.center < 0 ? replyAt(roles, roles.length) : replyAt(roles, view.center);
}
