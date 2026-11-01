/**
 * A message's pictures written into it (박제): who wants to know is told once the write is done. 옴니 뷰어 reads
 * the reply on its stage again then, once: the pictures its stream showed as previews are the chat's own now, and
 * 🎲 리롤 and 🔮 샷 태그 work on them without the viewer opened again.
 */
export interface BakedMessage { charIndex: number; chatIndex: number; messageIndex: number }
const listeners = new Set<(baked: BakedMessage) => void>();

/** Called after each bake; returns how to stop being called. */
export function onMessageBaked(listener: (baked: BakedMessage) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function messageBaked(baked: BakedMessage): void {
  for (const listener of [...listeners]) {
    try { listener(baked); } catch { /* one listener failing never stops the others, nor the bake */ }
  }
}
