import { ttsComparable } from '../tts/anchors';
import type { ViewerScene } from './scenes';

/**
 * The reader's place carried from one reading of a reply to the next: a stream's tick, its end, the reply read
 * again. Not by where the line stood in the text: a stream holds what the saved reply no longer does (an image
 * block's JSON, baked to a short token; lines the bot's regex hides), so the same offset was a later line there.
 *
 * By what was read: the line itself, its same occurrence (a short "그래." comes more than once). Gone or rewritten,
 * the line right after the nearest earlier one still there: lines hidden in between are passed over, never
 * skipped to. A picture is the same picture by its number. -1 when nothing of the reply is left to go by.
 */
const keyOf = (scene: ViewerScene): string => scene.kind === 'cg' ? 'cg' : `${scene.kind}\n${scene.speaker}\n${ttsComparable(scene.text)}`;

function occurrences(scenes: readonly ViewerScene[]): { nth: number[]; keys: string[]; where: Map<string, number[]> } {
  const where = new Map<string, number[]>(), keys: string[] = [], nth: number[] = [];
  scenes.forEach((scene, i) => {
    const key = keyOf(scene), seen = where.get(key) ?? [];
    keys.push(key); nth.push(seen.length); seen.push(i); where.set(key, seen);
  });
  return { nth, keys, where };
}

export function keptPlace(before: readonly ViewerScene[], at: number, after: readonly ViewerScene[]): number {
  if (!before[at] || !after.length) return -1;
  const old = occurrences(before), now = occurrences(after).where;
  const found = (i: number): number => now.get(old.keys[i]!)?.[old.nth[i]!] ?? -1;
  const self = found(at);
  if (self >= 0) return self;
  for (let i = at - 1; i >= 0; i--) { const j = found(i); if (j >= 0) return Math.min(j + 1, after.length - 1); }
  // Nothing before it stayed: the line just before the nearest later one that did.
  for (let i = at + 1; i < before.length; i++) { const j = found(i); if (j >= 0) return Math.max(j - 1, 0); }
  return -1;
}
