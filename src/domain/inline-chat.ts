/** Where the inline spinner/photo frame sits relative to the matched line text. */
export type InlineChatTextSide = 'before' | 'after';

export function normalizeInlineChatTextSide(value: unknown): InlineChatTextSide {
  const v = String(value ?? '').toLowerCase().trim();
  if (v === 'after' || v === 'end' || v === 'back' || v === 'behind' || v === 'rear') return 'after';
  return 'before';
}
