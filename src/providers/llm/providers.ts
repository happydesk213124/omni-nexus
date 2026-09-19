/**
 * LLM provider presets / reasoning helpers (pure, testable).
 *
 * This module is also published to the frozen UI as `globalThis.__INLAY_LLM__`,
 * so every export name here is part of the UI contract and must not be renamed.
 */

export type LlmProvider =
  | 'openrouter'
  | 'openai'
  | 'google_ai'
  | 'vertex'
  | 'anthropic_compatible'
  | 'lmstudio'
  | 'ollama'
  | 'custom';

export type ReasoningEffort =
  | 'default'
  | 'none'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
  | 'max';

/** Preset keys are provider ids except `anthropic`, which backs `anthropic_compatible`. */
export interface LlmEndpointPresets {
  openai: string;
  openrouter: string;
  google_ai: string;
  lmstudio: string;
  ollama: string;
  anthropic: string;
  vertex: string;
  [key: string]: string;
}

export interface LlmProviderOption {
  value: LlmProvider;
  label: string;
}

/** Extra context the vertex lane needs to build a full request URL. */
export interface EndpointOptions {
  region?: string;
  projectId?: string;
}

export interface ReasoningBody {
  reasoning?: { effort: ReasoningEffort };
  [key: string]: unknown;
}

export const LLM_ENDPOINT_PRESETS: Readonly<LlmEndpointPresets> = Object.freeze<LlmEndpointPresets>({
  openai: 'https://api.openai.com/v1/chat/completions',
  openrouter: 'https://openrouter.ai/api/v1/chat/completions',
  google_ai: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
  lmstudio: 'http://127.0.0.1:1234/v1/chat/completions',
  ollama: 'http://127.0.0.1:11434/v1/chat/completions',
  anthropic: 'https://api.anthropic.com/v1/messages',
  vertex: 'https://us-central1-aiplatform.googleapis.com',
});

export const REASONING_EFFORTS: readonly ReasoningEffort[] = Object.freeze([
  'default',
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const);

export const LLM_PROVIDERS: readonly LlmProviderOption[] = Object.freeze([
  { value: 'openrouter', label: 'OpenRouter' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'google_ai', label: 'Google AI Studio' },
  { value: 'vertex', label: 'Vertex AI (Google Cloud)' },
  { value: 'anthropic_compatible', label: 'Anthropic-compatible' },
  { value: 'lmstudio', label: 'LM Studio (로컬)' },
  { value: 'ollama', label: 'Ollama (로컬)' },
  { value: 'custom', label: 'Custom endpoint' },
] as const);

/** Maps any stored/legacy provider spelling onto one of the eight canonical lanes. */
export function normalizeLlmProvider(raw: unknown): LlmProvider {
  const p = String(raw || '')
    .toLowerCase()
    .replace(/[ -]+/g, '_')
    .trim();
  if (['openrouter'].includes(p)) return 'openrouter';
  if (['openai'].includes(p)) return 'openai';
  if (['google', 'google_ai', 'google_ai_studio', 'gemini'].includes(p)) return 'google_ai';
  if (['vertex', 'vertex_ai', 'google_vertex'].includes(p)) return 'vertex';
  if (['anthropic', 'anthropic_compat', 'anthropic_compatible', 'claude'].includes(p)) {
    return 'anthropic_compatible';
  }
  if (['lmstudio', 'lm_studio'].includes(p)) return 'lmstudio';
  if (['ollama'].includes(p)) return 'ollama';
  if (['custom'].includes(p)) return 'custom';
  // Legacy Inlay value — keep as openai-compatible custom lane.
  if (['openai_compatible', 'openai_compat'].includes(p)) return 'openrouter';
  return 'custom';
}

/** Clamps a reasoning-effort value to the supported set, falling back to `default`. */
export function normalizeReasoningEffort(value: unknown): ReasoningEffort {
  const v = String(value ?? 'default')
    .toLowerCase()
    .trim();
  if (!v || v === 'auto' || v === 'default') return 'default';
  return (REASONING_EFFORTS as readonly string[]).includes(v) ? (v as ReasoningEffort) : 'default';
}

/** The endpoint a provider should start from when the user has not typed one. */
export function defaultEndpointForProvider(provider: unknown, opts: EndpointOptions = {}): string {
  const p = normalizeLlmProvider(provider);
  if (p === 'vertex') {
    const region = String(opts.region || 'us-central1')
      .trim()
      .replace(/[^a-z0-9-]/gi, '') || 'us-central1';
    return region === 'global' ? 'https://aiplatform.googleapis.com' : `https://${region}-aiplatform.googleapis.com`;
  }
  if (p === 'anthropic_compatible') return LLM_ENDPOINT_PRESETS.anthropic;
  if (p === 'custom') return LLM_ENDPOINT_PRESETS.openai;
  return LLM_ENDPOINT_PRESETS[p] || LLM_ENDPOINT_PRESETS.openai;
}

/** Every endpoint spelling we shipped, so a preset can be told apart from a user edit. */
export function knownLlmEndpoints(): Set<string> {
  const out = new Set<string>();
  for (const value of Object.values(LLM_ENDPOINT_PRESETS)) {
    const base = String(value || '').replace(/\/+$/, '');
    if (!base) continue;
    out.add(base);
    out.add(base.replace(/\/chat\/completions$/i, ''));
    out.add(base.replace(/\/v1\/messages$/i, ''));
    out.add(base.replace(/\/v1$/i, ''));
  }
  // Common region hosts for Vertex.
  out.add('https://us-central1-aiplatform.googleapis.com');
  out.add('https://europe-west1-aiplatform.googleapis.com');
  out.add('https://asia-northeast1-aiplatform.googleapis.com');
  out.add('https://aiplatform.googleapis.com');
  // Recognize the old generated global host so changing regions repairs saved forms.
  out.add('https://global-aiplatform.googleapis.com');
  return out;
}

/** True when the current endpoint is untouched preset text and may be swapped silently. */
export function shouldAutoReplaceEndpoint(current: unknown): boolean {
  const cur = String(current || '')
    .trim()
    .replace(/\/+$/, '');
  if (!cur) return true;
  return knownLlmEndpoints().has(cur);
}

/** Completes a base URL into the full chat/messages request URL for the provider. */
export function ensureLlmRequestUrl(endpoint: unknown, provider: unknown, opts: EndpointOptions = {}): string {
  const p = normalizeLlmProvider(provider);
  let url = String(endpoint || '')
    .trim()
    .replace(/\/+$/, '');
  if (!url) url = defaultEndpointForProvider(p, opts).replace(/\/+$/, '');

  if (p === 'anthropic_compatible') {
    if (/\/v1\/messages$/i.test(url)) return url;
    if (/\/messages$/i.test(url)) return url;
    if (/\/v1$/i.test(url)) return `${url}/messages`;
    return `${url}/v1/messages`;
  }

  if (p === 'vertex') {
    const region = String(opts.region || 'us-central1')
      .trim()
      .replace(/[^a-z0-9-]/gi, '') || 'us-central1';
    const project = String(opts.projectId || '').trim();
    if (project) {
      return `${defaultEndpointForProvider(p, { region })}/v1/projects/${encodeURIComponent(project)}/locations/${encodeURIComponent(region)}/endpoints/openapi/chat/completions`;
    }
    // Host-only until project is known — caller should fill project from SA JSON.
    if (/aiplatform\.googleapis\.com/i.test(url) && !/\/chat\/completions$/i.test(url)) return url;
  }

  if (/\/chat\/completions$/i.test(url)) return url;
  if (/\/openai$/i.test(url)) return `${url}/chat/completions`;
  if (/\/v1beta$/i.test(url)) return `${url}/openai/chat/completions`;
  if (/\/v1$/i.test(url)) return `${url}/chat/completions`;
  return url;
}

/** Copies a request body with the OpenRouter-style `reasoning.effort` field applied. */
export function applyReasoningToBody(body: unknown, effort: unknown): ReasoningBody {
  const next: ReasoningBody = {};
  if (body && typeof body === 'object') Object.assign(next, body);
  const e = normalizeReasoningEffort(effort);
  if (e === 'default') return next;
  next.reasoning = { effort: e };
  return next;
}

/** Example model id shown in the Model field for a provider. */
export function llmModelPlaceholder(provider: unknown): string {
  const p = normalizeLlmProvider(provider);
  const map: Record<LlmProvider, string> = {
    openrouter: 'openai/gpt-4o-mini',
    openai: 'gpt-4o-mini',
    google_ai: 'gemini-2.5-flash',
    vertex: 'google/gemini-2.5-flash',
    anthropic_compatible: 'claude-sonnet-4',
    lmstudio: 'local-model',
    ollama: 'llama3.2',
    custom: 'model-id',
  };
  return map[p] || map.custom;
}

/** Which preset an endpoint string corresponds to, or `"custom"` when it matches none. */
export function endpointPresetKeyFor(value: unknown): string {
  const endpoint = String(value || '')
    .trim()
    .replace(/\/+$/, '');
  for (const [key, preset] of Object.entries(LLM_ENDPOINT_PRESETS)) {
    const base = preset.replace(/\/+$/, '');
    if (endpoint === base || endpoint === base.replace(/\/chat\/completions$/i, '') || endpoint === base.replace(/\/v1\/messages$/i, '')) {
      return key;
    }
  }
  return 'custom';
}
