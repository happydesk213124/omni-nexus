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
