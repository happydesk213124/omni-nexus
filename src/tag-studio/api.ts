/**
 * Studio calls go through `__INLAY_NATIVE__.fetch` (same path as the frozen UI).
 * Do not import `bridge/native` here — native imports this folder.
 */

type NativeBridge = {
  fetch: (path: string, options?: Record<string, unknown>, timeoutMs?: number) => Promise<unknown>;
};

function native(): NativeBridge {
  const n = (globalThis as { __INLAY_NATIVE__?: NativeBridge }).__INLAY_NATIVE__;
  if (!n?.fetch) throw new Error('Inlay Nexus backend unavailable');
  return n;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export async function studioGet(path: string): Promise<Record<string, unknown>> {
  return asRecord(await native().fetch(path, { method: 'GET' }));
}

export async function studioPost(path: string, body: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  return asRecord(await native().fetch(path, { method: 'POST', body }));
}

export async function loadSettings(): Promise<Record<string, unknown>> {
  const res = await studioGet('/v1/settings');
  return asRecord(res.settings);
}

export async function saveSettings(patch: Record<string, unknown>): Promise<Record<string, unknown>> {
  return studioPost('/v1/settings', patch);
}

export async function loadNaiPrompt(cardId: string): Promise<Record<string, unknown>> {
  return studioGet(`/v1/cards/${encodeURIComponent(cardId)}/nai-prompt`);
}

export async function loadNaiFromImage(imageDataUrl: string): Promise<Record<string, unknown>> {
  return studioPost('/v1/cards/nai-from-image', { image_data_url: imageDataUrl });
}

export async function loadNaiQuota(): Promise<Record<string, unknown>> {
  return studioGet('/v1/nai/quota');
}

export async function loadRoster(sessionId: string, characterId: string): Promise<Record<string, unknown>> {
  const q = new URLSearchParams();
  if (sessionId) q.set('session_id', sessionId);
  if (characterId) q.set('character_id', characterId);
  const suffix = q.toString() ? `?${q}` : '';
  return studioGet(`/v1/characters${suffix}`);
}

export async function saveCharacter(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  return studioPost('/v1/characters', body);
}

export async function studioGenerate(cardId: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  return studioPost(`/v1/cards/${encodeURIComponent(cardId)}/studio-generate`, body);
}

export async function studioCommit(cardId: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  return studioPost(`/v1/cards/${encodeURIComponent(cardId)}/studio-commit`, body);
}

export async function updateCardTags(cardId: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  return studioPost(`/v1/cards/${encodeURIComponent(cardId)}/tags`, body);
}

export async function rerollCard(cardId: string, overrides: Record<string, unknown>): Promise<Record<string, unknown>> {
  return studioPost(`/v1/cards/${encodeURIComponent(cardId)}/reroll`, { mode: 'nai', overrides });
}

export async function commandRewrite(cardId: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  return studioPost(`/v1/cards/${encodeURIComponent(cardId)}/command-rewrite`, body);
}
