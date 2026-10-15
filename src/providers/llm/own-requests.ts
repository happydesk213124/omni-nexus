/**
 * Requests this plugin sends through Risu's own model (`runLLMModel`). Risu runs
 * every plugin's `beforeRequest` replacer on them too, so streaming tag
 * generation must recognise its own tagger calls and leave them alone.
 *
 * Identified by the opening of the first message: Risu hands the replacer a
 * copy of what we passed, so the text is the same even when roles are merged.
 */
const live = new Map<string, number>();

function fingerprint(messages: readonly { content?: unknown }[]): string {
  const first = messages.find(row => typeof row?.content === 'string' && row.content.trim());
  return first ? String(first.content).trim().slice(0, 160) : '';
}

export function markOwnLlmRequest(messages: readonly { content?: unknown }[]): () => void {
  const key = fingerprint(messages);
  if (!key) return () => {};
  live.set(key, (live.get(key) || 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const count = (live.get(key) || 1) - 1;
    if (count > 0) live.set(key, count); else live.delete(key);
  };
}

export function isOwnLlmRequest(messages: readonly { content?: unknown }[]): boolean {
  if (!live.size) return false;
  const texts = messages.map(row => typeof row?.content === 'string' ? row.content.trim() : '').filter(Boolean);
  for (const key of live.keys()) if (texts.some(text => text.startsWith(key))) return true;
  return false;
}
