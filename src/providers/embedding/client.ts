/**
 * Embedding HTTP client (OpenAI / Voyage / OpenAI-compat / LM Studio / Ollama).
 * Uses networkFetch — never bare browser fetch (CORS).
 */
import { cleanText } from '../../core/util/text';
import { networkFetch } from '../nai/http';

export type EmbeddingProvider =
  | 'openai'
  | 'voyage'
  | 'openrouter'
  | 'openai_compat'
  | 'lmstudio'
  | 'ollama'
  | 'custom';

export interface EmbeddingProviderOption {
  value: EmbeddingProvider;
  label: string;
}

export interface EmbeddingSettings {
  provider: EmbeddingProvider | string;
  model: string;
  endpoint: string;
  api_key: string;
}

export interface EmbedBatchResult {
  vectors: number[][];
  model: string;
}

export const EMBEDDING_PROVIDERS: readonly EmbeddingProviderOption[] = Object.freeze([
  { value: 'openai', label: 'OpenAI' },
  { value: 'voyage', label: 'Voyage' },
  { value: 'openrouter', label: 'OpenRouter' },
  { value: 'openai_compat', label: 'OpenAI-compat' },
  { value: 'lmstudio', label: 'LM Studio (로컬)' },
  { value: 'ollama', label: 'Ollama (로컬)' },
  { value: 'custom', label: 'Custom endpoint' },
]);

const PROVIDERS: EmbeddingProvider[] = EMBEDDING_PROVIDERS.map((p) => p.value);

export function normalizeEmbeddingProvider(value: unknown): EmbeddingProvider {
  const v = cleanText(value, 40).toLowerCase().replace(/[ -]+/g, '_');
  if (v === 'openai_compatible' || v === 'compat') return 'openai_compat';
  if ((PROVIDERS as string[]).includes(v)) return v as EmbeddingProvider;
  return 'openai';
}

export function defaultEndpointForEmbedding(provider: unknown): string {
  switch (normalizeEmbeddingProvider(provider)) {
    case 'openai':
      return 'https://api.openai.com/v1/embeddings';
    case 'voyage':
      return 'https://api.voyageai.com/v1/embeddings';
    case 'openrouter':
      return 'https://openrouter.ai/api/v1/embeddings';
    case 'lmstudio':
      return 'http://127.0.0.1:1234/v1/embeddings';
    case 'ollama':
      return 'http://127.0.0.1:11434/api/embeddings';
    case 'openai_compat':
    case 'custom':
    default:
      return 'https://api.openai.com/v1/embeddings';
  }
}

export function defaultModelForEmbedding(provider: unknown): string {
  switch (normalizeEmbeddingProvider(provider)) {
    case 'voyage':
      return 'voyage-3-lite';
    case 'ollama':
      return 'nomic-embed-text';
    case 'openrouter':
      return 'openai/text-embedding-3-small';
    case 'lmstudio':
      return 'text-embedding-nomic-embed-text-v1.5';
    default:
      return 'text-embedding-3-small';
  }
}

/** Alias used by the frozen UI (mirrors `__INLAY_LLM__.llmModelPlaceholder`). */
export function embeddingModelPlaceholder(provider: unknown): string {
  return defaultModelForEmbedding(provider);
}

/** Every shipped embedding endpoint spelling, so presets can be told from user edits. */
export function knownEmbeddingEndpoints(): Set<string> {
  const out = new Set<string>();
  for (const p of PROVIDERS) {
    const ep = defaultEndpointForEmbedding(p).replace(/\/+$/, '');
    out.add(ep);
    out.add(ep.replace(/\/embeddings$/i, ''));
    out.add(ep.replace(/\/api\/embeddings$/i, ''));
    out.add(ep.replace(/\/v1$/i, ''));
  }
  return out;
}

export function shouldAutoReplaceEmbeddingEndpoint(current: unknown): boolean {
  const v = cleanText(current, 500);
  if (!v) return true;
  const norm = v.replace(/\/+$/, '');
  return knownEmbeddingEndpoints().has(norm);
}

/** True when the model field still looks like a shipped default (safe to overwrite on provider change). */
export function shouldAutoReplaceEmbeddingModel(current: unknown): boolean {
  const v = cleanText(current, 200);
  if (!v) return true;
  const defaults = new Set(PROVIDERS.map((p) => defaultModelForEmbedding(p)));
  return defaults.has(v);
}

/** Local providers that usually need no cloud API key. */
export function embeddingProviderNeedsApiKey(provider: unknown): boolean {
  const p = normalizeEmbeddingProvider(provider);
  return p !== 'lmstudio' && p !== 'ollama';
}

function resolveUrl(settings: EmbeddingSettings): string {
  const provider = normalizeEmbeddingProvider(settings.provider);
  const ep = cleanText(settings.endpoint, 500) || defaultEndpointForEmbedding(provider);
  if (provider === 'ollama') return ep.replace(/\/$/, '');
  // Accept base like https://api.openai.com/v1 → append /embeddings
  if (/\/embeddings\/?$/i.test(ep)) return ep.replace(/\/$/, '');
  if (/\/v1\/?$/i.test(ep)) return `${ep.replace(/\/$/, '')}/embeddings`;
  return ep;
}

function parseOpenAiStyle(json: unknown): number[][] {
  const root = json && typeof json === 'object' ? (json as Record<string, unknown>) : {};
  const data = Array.isArray(root.data) ? root.data : [];
  const vectors: number[][] = [];
  for (const row of data) {
    const emb = row && typeof row === 'object' ? (row as Record<string, unknown>).embedding : null;
    if (Array.isArray(emb) && emb.every((n) => typeof n === 'number')) {
      vectors.push(emb as number[]);
    } else {
      throw new Error('임베딩 응답에 숫자 벡터가 없습니다.');
    }
  }
  return vectors;
}

async function readJson(res: Response | { ok?: boolean; status?: number; json?: () => Promise<unknown>; text?: () => Promise<string> }): Promise<unknown> {
  const ok = res.ok !== false && (res.status === undefined || (res.status >= 200 && res.status < 300));
  if (typeof (res as Response).json === 'function') {
    try {
      const json = await (res as Response).json();
      if (!ok) {
        const msg = typeof json === 'object' && json ? JSON.stringify(json).slice(0, 400) : String(json);
        throw new Error(`임베딩 HTTP ${res.status ?? '?'}: ${msg}`);
      }
      return json;
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('임베딩 HTTP')) throw err;
    }
  }
  if (typeof (res as Response).text === 'function') {
    const text = await (res as Response).text();
    if (!ok) throw new Error(`임베딩 HTTP ${res.status ?? '?'}: ${text.slice(0, 400)}`);
    return text ? JSON.parse(text) : {};
  }
  throw new Error('임베딩 응답을 읽을 수 없습니다.');
}

/** Embed one or more texts. Returns vectors in the same order. */
export async function embedTexts(
  settings: EmbeddingSettings,
  texts: string[],
  opts?: { signal?: AbortSignal },
): Promise<EmbedBatchResult> {
  if (!texts.length) return { vectors: [], model: cleanText(settings.model) };
  const provider = normalizeEmbeddingProvider(settings.provider);
  const model = cleanText(settings.model, 200) || defaultModelForEmbedding(provider);
  const url = resolveUrl({ ...settings, provider, model });
  const apiKey = cleanText(settings.api_key, 4000);

  if (provider === 'ollama') {
    // Ollama: one text per request typically
    const vectors: number[][] = [];
    for (const text of texts) {
      const res = await networkFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, prompt: text }),
        signal: opts?.signal,
      });
      const json = (await readJson(res)) as Record<string, unknown>;
      const emb = json.embedding;
      if (!Array.isArray(emb) || !emb.every((n) => typeof n === 'number')) {
        throw new Error('Ollama 임베딩 응답이 올바르지 않습니다.');
      }
      vectors.push(emb as number[]);
    }
    return { vectors, model };
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const body =
    provider === 'voyage'
      ? { model, input: texts, input_type: 'document' }
      : { model, input: texts };

  const res = await networkFetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: opts?.signal,
  });
  const json = await readJson(res);
  const vectors = parseOpenAiStyle(json);
  if (vectors.length !== texts.length) {
    throw new Error(`임베딩 개수 불일치: got ${vectors.length}, want ${texts.length}`);
  }
  return { vectors, model };
}

/** Smoke-test: embed a short string. */
export async function testEmbedding(settings: EmbeddingSettings): Promise<{ ok: true; dims: number; model: string }> {
  const { vectors, model } = await embedTexts(settings, ['embedding ping']);
  const dims = vectors[0]?.length || 0;
  if (!dims) throw new Error('임베딩 차원이 0입니다.');
  return { ok: true, dims, model };
}
