/**
 * The tagging LLM call: our own HTTP lane (OpenAI-compatible / Anthropic / Vertex)
 * and the delegating lane that reuses Risu's configured main / aux model.
 *
 * Provider helpers are imported directly here. 1.x reached for them on
 * `globalThis.__INLAY_LLM__` and duplicated a fallback copy for when the concat
 * build had not published them yet.
 */
import { dbg, dbgSpan } from '../../core/debug.ts';
import { risuHost } from '../../core/host.ts';
import type { LlmSettings } from '../../core/types.ts';
import { cleanText } from '../../core/util/text.ts';
import { networkFetch, type FetchLikeResponse } from '../nai/http.ts';
import { googleAccessTokenFromServiceAccount } from './google-auth.ts';
import { applyReasoningToBody, ensureLlmRequestUrl, normalizeLlmProvider } from './providers.ts';
import { prepareAutotagImage } from '../../core/util/image.ts';
import { base64ToBytes, bytesToBase64Async } from '../../core/util/bytes.ts';
import {
  extractAnthropicText,
  extractChatCompletionText,
  llmIsRisuSource,
  llmResponseToText,
  normalizeLlmSource,
  openaiMessagesToAnthropic,
  openaiMessagesToRisu,
  risuModeForSource,
  readStreamToText,
  type AnthropicMessage,
  type AnthropicPayload,
  type ChatCompletionPayload,
  type LlmContentPart,
  type LlmMessage,
  type StreamReadOptions,
} from './transform.ts';

/**
 * Gap after which a stream that has already delivered text is treated as finished.
 *
 * Long enough that a model pausing under load is not cut mid-reply; short enough
 * that a refusal whose stream never closes (the observed Risu provider-plugin
 * behaviour) fails the job in seconds rather than holding the tagging lock until
 * the user presses stop. Only counts once some text has arrived, so a slow first
 * token is governed by the call timeout, not by this.
 */
const LLM_STREAM_IDLE_MS = 15_000;

/** Bounded-read options for one call: idle gap plus the call's own wall-clock deadline. */
function streamReadOptions(deadlineAt: number, lane: string): StreamReadOptions {
  return {
    idleMs: LLM_STREAM_IDLE_MS,
    deadlineAt,
    note: (stage, detail) => dbg(stage, { ...detail, lane }, 'warn'),
  };
}

/** Rejects at `deadlineAt`; raced against steps whose own cancellation cannot be trusted. */
function deadlinePromise(deadlineAt: number, label: string): { promise: Promise<never>; clear: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const promise = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(label)),
      Math.max(0, deadlineAt - Date.now()),
    );
  });
  // A deadline that wins the race is consumed there; one that loses must not
  // surface later as an unhandled rejection.
  promise.catch(() => {});
  return { promise, clear: () => { if (timer !== undefined) clearTimeout(timer); } };
}

interface AnthropicRequestBody {
  model: string;
  max_tokens: number;
  temperature: number;
  messages: AnthropicMessage[];
  system?: string;
}

interface RisuLlmHost {
  runLLMModel(options: {
    messages: LlmMessage[];
    staticModel?: string;
    mode: string;
    allowPlugins?: boolean;
  }): Promise<unknown>;
}

export interface CallLlmOptions {
  signal?: AbortSignal;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const err = new Error('Aborted');
    err.name = 'AbortError';
    throw err;
  }
}

/** Also stop waiting when a host proxy ignores transport cancellation. */
function abortPromise(signal?: AbortSignal): { promise: Promise<never>; clear: () => void } {
  let fail: () => void = () => {};
  const promise = new Promise<never>((_, reject) => {
    fail = () => {
      const error = new Error('Aborted');
      error.name = 'AbortError';
      reject(error);
    };
    if (signal?.aborted) fail();
    else signal?.addEventListener('abort', fail, { once: true });
  });
  promise.catch(() => {});
  return { promise, clear: () => signal?.removeEventListener('abort', fail) };
}

async function rewriteVisionImagesPng(messages: LlmMessage[]): Promise<LlmMessage[]> {
  const out: LlmMessage[] = [];
  for (const msg of messages || []) {
    if (!Array.isArray(msg.content)) {
      out.push(msg);
      continue;
    }
    const parts: Array<LlmContentPart | string> = [];
    for (const part of msg.content) {
      if (!part || typeof part !== 'object') {
        parts.push(part);
        continue;
      }
      const image = part.image_url;
      const url = (typeof image === 'object' && image ? image.url : '')
        || (typeof image === 'string' ? image : '');
      const m = String(url).match(/^data:([^;]+);base64,([\s\S]+)$/i);
      const mime = (m?.[1] || '').toLowerCase();
      if ((part.type === 'image_url' || url) && m && mime && mime !== 'image/png' && mime !== 'image/jpeg') {
        try {
          const prepared = await prepareAutotagImage(base64ToBytes(m[2].replace(/\s+/g, '')));
          const b64 = await bytesToBase64Async(prepared.bytes);
          parts.push({
            ...part,
            type: 'image_url',
            image_url: { url: `data:${prepared.mime || 'image/png'};base64,${b64}` },
          });
          continue;
        } catch {
          /* keep the original part */
        }
      }
      parts.push(part);
    }
    out.push({ ...msg, content: parts });
  }
  return out;
}

/** Runs one tagging request, routing to Risu's own model when the source is main/aux. */
export async function callLlm(
  llm: LlmSettings,
  messages: LlmMessage[],
  opts: CallLlmOptions = {},
): Promise<string> {
  throwIfAborted(opts.signal);
  const visionMessages = await rewriteVisionImagesPng(messages);
  throwIfAborted(opts.signal);
  const source = normalizeLlmSource(llm.source);
  if (llmIsRisuSource(source)) {
    // Do NOT pass the custom Model field as staticModel — that overrides Risu's
    // configured main/aux model with a leftover OpenRouter/etc id and skips the real request.
    return callLlmViaRisu(llm, visionMessages, source, '', opts.signal);
  }
  const provider = normalizeLlmProvider(llm.provider);
  const modelId = cleanText(llm.model);
  // Vertex's OpenAI-compatible API requires a publisher; AI Studio does not.
  const model = provider === 'vertex' && /^gemini-/i.test(modelId) ? `google/${modelId}` : modelId;
  const region = cleanText(llm.vertex_region) || 'us-central1';
  let apiKey = cleanText(llm.api_key);
  let projectId = '';
  if (provider === 'vertex' && cleanText(llm.service_account_json)) {
    const tok = await googleAccessTokenFromServiceAccount(llm.service_account_json);
    apiKey = tok.accessToken;
    projectId = tok.projectId;
  }
  throwIfAborted(opts.signal);
  if (!model || !apiKey) {
    dbg('llm.config', { message: 'missing model/api_key', provider }, 'error');
    throw new Error(
      provider === 'vertex'
        ? 'Vertex AI: Model + Service Account JSON(또는 access token)이 필요합니다.'
        : '태깅 LLM이 설정되지 않았습니다. 모델 설정에서 Provider·Model·API key를 넣으세요. (NovelAI 키와 별개)',
    );
  }
  const endpoint = ensureLlmRequestUrl(cleanText(llm.endpoint), provider, { region, projectId });
  if (provider === 'vertex' && !/\/chat\/completions$/i.test(endpoint)) {
    throw new Error('Vertex AI: project_id가 있는 Service Account JSON이 필요합니다. (OpenAI-compatible endpoint 구성용)');
  }
  const timeoutMs = Number(llm.timeout_seconds ?? 180) * 1000;
  const deadlineAt = Date.now() + timeoutMs;
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const onUserAbort = () => controller?.abort?.();
  opts.signal?.addEventListener('abort', onUserAbort, { once: true });
  if (opts.signal?.aborted) onUserAbort();
  const aborted = abortPromise(opts.signal);
  const timer = setTimeout(() => {
    dbg('llm.abort', { message: `timeout ${timeoutMs}ms`, model, provider }, 'warn');
    controller?.abort?.();
  }, timeoutMs);
  // The abort above only reaches a real `Response`. Through Risu's `nativeFetch`
  // the response is proxied and `.json()` can outlive the signal, so every await
  // below is also raced against the same wall clock.
  const deadline = deadlinePromise(deadlineAt, `LLM 응답 시간 초과 (${Math.round(timeoutMs / 1000)}s)`);
  const span = dbgSpan('llm.call');
  dbg('llm.call.start', {
    message: model,
    msgs: messages?.length || 0,
    timeout_ms: timeoutMs,
    source,
    provider,
    reasoning: cleanText(llm.reasoning_effort) || 'default',
  });
  try {
    throwIfAborted(opts.signal);
    let resp: FetchLikeResponse;
    if (provider === 'anthropic_compatible') {
      const converted = openaiMessagesToAnthropic(visionMessages);
      const body: AnthropicRequestBody = {
        model,
        max_tokens: Number(llm.max_tokens ?? 8000),
        temperature: Math.min(1, Number(llm.temperature ?? 0.4)),
        messages: converted.messages,
      };
      if (converted.system) body.system = converted.system;
      resp = await Promise.race([networkFetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': cleanText(llm.anthropic_version) || '2023-06-01',
        },
        body: JSON.stringify(body),
        signal: controller?.signal,
      }), deadline.promise, aborted.promise]);
    } else {
      const body = applyReasoningToBody({
        model,
        messages: visionMessages,
        temperature: Number(llm.temperature ?? 0.4),
        max_tokens: Number(llm.max_tokens ?? 8000),
      }, llm.reasoning_effort);
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      };
      if (provider === 'openrouter') {
        headers['HTTP-Referer'] = 'https://risuai.xyz';
        headers['X-Title'] = 'Omni Nexus';
      }
      resp = await Promise.race([networkFetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller?.signal,
      }), deadline.promise, aborted.promise]);
    }
    const status = Number(resp?.status || 0);
    const payload = await Promise.race([
      readJsonBody(resp, deadline.promise, streamReadOptions(deadlineAt, `${provider}:${model}`)),
      aborted.promise,
    ]);
    if (status >= 400) {
      span.fail(new Error(`HTTP ${status}`), { status, body: JSON.stringify(payload).slice(0, 200), provider });
      throw new Error(`LLM HTTP ${status}: ${JSON.stringify(payload).slice(0, 500)}`);
    }
    const text = provider === 'anthropic_compatible'
      ? extractAnthropicText(payload as AnthropicPayload)
      : extractChatCompletionText(payload as ChatCompletionPayload);
    span.end({ message: model, status, bytes: text.length, provider });
    return text;
  } catch (err) {
    span.fail(err, { model, provider });
    throw err;
  } finally {
    opts.signal?.removeEventListener('abort', onUserAbort);
    clearTimeout(timer);
    deadline.clear();
    aborted.clear();
  }
}

/**
 * The JSON body of an LLM HTTP response, read in a way that always ends.
 *
 * A body stream is drained with the idle gap and deadline so a connection the
 * upstream leaves open cannot park the job; `.json()` is the fallback for
 * response shapes without a readable body, raced against the same deadline. An
 * unparseable body becomes `{}` exactly as before — the caller reports "no
 * choices" / HTTP status, which is the message users already know.
 */
export async function readJsonBody(
  resp: FetchLikeResponse,
  deadline: Promise<never>,
  read: StreamReadOptions,
): Promise<unknown> {
  const body = resp?.body as { getReader?: unknown } | null | undefined;
  if (body && typeof body.getReader === 'function') {
    let text = '';
    try {
      text = await readStreamToText(body, read);
    } catch (err) {
      // Deadline with nothing received: surface it. Anything else falls back to `{}`.
      if (/시간 초과/.test(String((err as Error)?.message || ''))) throw err;
      return {};
    }
    try {
      return JSON.parse(text);
    } catch {
      return {};
    }
  }
  const json = (resp as { json?: () => Promise<unknown> })?.json;
  if (typeof json !== 'function') return {};
  try {
    return await Promise.race([json.call(resp), deadline]);
  } catch (err) {
    if (/시간 초과/.test(String((err as Error)?.message || ''))) throw err;
    return {};
  }
}

/** Delegates the request to Risu's configured main (`model`) or aux (`otherAx`) model. */
export async function callLlmViaRisu(
  llm: LlmSettings,
  messages: LlmMessage[],
  source: string,
  staticModel = '',
  signal?: AbortSignal,
): Promise<string> {
  const api = risuHost() as RisuLlmHost | undefined;
  if (!api || typeof api.runLLMModel !== 'function') {
    throw new Error('RisuAI runLLMModel API를 사용할 수 없습니다. Risu를 최신으로 업데이트하세요.');
  }
  // Risu ModelModeExtended: 'model' | 'submodel' | 'memory' | 'emotion' | 'otherAx' | 'translate'
  // "main" is NOT valid — anything other than "model" falls through to db.subModel.
  const mode = risuModeForSource(source);
  const timeoutMs = Math.max(5000, Number(llm.timeout_seconds ?? 180) * 1000);
  // Only honor an explicit override; never the custom-endpoint Model text box.
  const staticOverride = cleanText(staticModel) || '';
  const span = dbgSpan('llm.call');
  dbg('llm.call.start', {
    message: `risu:${mode}`,
    msgs: messages?.length || 0,
    timeout_ms: timeoutMs,
    source,
    static_model: staticOverride,
  });
  // Not `withTimeout()`: the timeout message is part of what the parity harness diffs.
  throwIfAborted(signal);
  const deadlineAt = Date.now() + timeoutMs;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Risu LLM timeout ${timeoutMs}ms (${mode})`)), timeoutMs);
  });
  // Consumed by whichever race it wins; must not surface if it loses both.
  timeout.catch(() => {});
  const aborted = abortPromise(signal);
  try {
    const response = await Promise.race([
      api.runLLMModel({
        mode,
        ...(staticOverride ? { staticModel: staticOverride } : {}),
        allowPlugins: true,
        messages: openaiMessagesToRisu(messages),
      }),
      timeout,
      aborted.promise,
    ]);
    // `runLLMModel` resolves the moment a provider plugin hands Risu a stream, so
    // the race above has not yet covered the reply itself. Reading stays under the
    // same deadline, and a stream that stops closing ends on the idle gap.
    const text = cleanText(await Promise.race([
      llmResponseToText(response, streamReadOptions(deadlineAt, `risu:${mode}`)),
      timeout,
      aborted.promise,
    ]));
    if (!text) throw new Error(`Risu LLM(${mode}) 응답이 비어 있습니다.`);
    span.end({ message: `risu:${mode}`, bytes: text.length });
    return text;
  } catch (err) {
    span.fail(err, { mode });
    throw err;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    aborted.clear();
  }
}
