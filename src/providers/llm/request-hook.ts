import { risuHost } from '../../core/host';
import { dbg } from '../../core/debug';
import { applyGuardrailBody, type GuardrailRequest } from '../../domain/llm/guardrail-body';

const requests = new Map<string, GuardrailRequest>();
let installed: Promise<boolean> | undefined;
let serial = 0;

/** The host owns hook removal on unload. One registration serves concurrent calls. */
async function ensureHook(): Promise<boolean> {
  const host = risuHost();
  if (typeof host?.registerBodyIntercepter !== 'function') return false;
  installed ||= host.registerBodyIntercepter((body: unknown, type: string) => {
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    for (const request of requests.values()) if (text?.includes(request.marker)) return applyGuardrailBody(body, type, request);
    return body;
  }).then(result => Boolean(result?.id)).catch(error => {
    dbg('llm.preset.hook', { message: String(error) }, 'warn');
    return false;
  });
  return installed;
}

export async function beginGuardrailRequest(request: Omit<GuardrailRequest, 'marker'>): Promise<{ request: GuardrailRequest; end: () => void } | null> {
  if (!await ensureHook()) return null;
  const marker = `<!--omni-preset-${Date.now()}-${++serial}-->`;
  const tracked = { ...request, marker };
  requests.set(marker, tracked);
  return { request: tracked, end: () => requests.delete(marker) };
}
