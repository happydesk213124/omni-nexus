/**
 * What a card row keeps when it is stored. Cast, prompt, content hash and
 * assistant preview are deliberately not persisted: there is no gallery, no
 * explorer, no character chips and no legacy stream rebind to read them.
 * Live values stay in memory for this session (unlink sidecars, bake, job
 * responses); only the stored row is stripped. Real pixels are Risu assets.
 */
const STRIPPED_META_KEYS = new Set([
  'characters',
  'main_prompt',
  'content_hash',
  'assistant_preview',
]);

export function stripStoredCardMeta(meta: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (!meta || typeof meta !== 'object') return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta)) {
    if (STRIPPED_META_KEYS.has(key)) continue;
    out[key] = value;
  }
  return out;
}
