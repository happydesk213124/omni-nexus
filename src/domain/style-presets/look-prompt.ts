/** Fixed framing belongs to the generated sample, never the saved preset. */
export const PRESET_LOOK_TAIL = '4::1girl, solo::';
export const EXAMPLE_SHOT_TAIL = '4::solo, portrait, white background::';
export function joinCharacterPreviewPrompt(pos: unknown): string {
  return String(pos ?? '').replace(/\s+/g, ' ').trim();
}
function appendOnce(pos: unknown, tail: string): string {
  const base = joinCharacterPreviewPrompt(pos);
  if (!base) return tail;
  if (base.toLowerCase().includes(tail.toLowerCase())) return base;
  return base.replace(/,\s*$/, '') + ', ' + tail;
}
export function joinExampleShotPrompt(pos: unknown): string { return appendOnce(pos, EXAMPLE_SHOT_TAIL); }
export function joinPresetLookPrompt(pos: unknown): string { return appendOnce(pos, PRESET_LOOK_TAIL); }
