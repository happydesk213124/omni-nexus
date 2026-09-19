/**
 * Request/response shape translation for the LLM lanes.
 *
 * Everything here is pure: OpenAI-shaped messages in, Anthropic-shaped messages
 * or plain text out. The response readers are deliberately forgiving because the
 * same call site handles OpenAI, Anthropic and Risu's `runLLMModel`, and Risu can
 * hand back a string, a typed envelope or a stream.
 */
import type { LlmSettings, LlmSource } from '../../core/types.ts';
import { cleanText } from '../../core/util/text.ts';
import { normalizeLlmProvider } from './providers.ts';

/** One OpenAI-style content part: text, or an image for vision requests. */
export interface LlmContentPart {
  type?: string;
  text?: string;
  /** Either `{ url }` or a bare URL string — both spellings appear in the wild. */
  image_url?: { url?: string } | string;
  [key: string]: unknown;
}

/** An OpenAI-style chat message; `content` is an array only for vision requests. */
export interface LlmMessage {
  role: string;
  content: string | Array<LlmContentPart | string>;
  [key: string]: unknown;
}

export interface AnthropicTextBlock {
  type: 'text';
  text: string;
}

export interface AnthropicImageBlock {
  type: 'image';
  source: { type: 'base64'; media_type: string; data: string };
}

export type AnthropicContentBlock = AnthropicTextBlock | AnthropicImageBlock;

export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

/** Anthropic splits the system prompt out of the message list. */
export interface AnthropicRequest {
  system: string;
  messages: AnthropicMessage[];
}

export interface ChatCompletionPayload {
  choices?: Array<{
    message?: { content?: unknown };
    text?: unknown;
    delta?: { content?: unknown };
  }>;
  [key: string]: unknown;
}

export interface AnthropicPayload {
  content?: unknown;
  completion?: unknown;
  [key: string]: unknown;
}

/** Anything with `getReader()` — a DOM stream or Risu's stream proxy. */
interface StreamLike {
  getReader(): { read(): Promise<{ done?: boolean; value?: unknown }> };
}

const isStreamLike = (value: unknown): value is StreamLike =>
  Boolean(value) && typeof (value as StreamLike).getReader === 'function';

/** `{ text }` blocks stringify to their text; anything else to itself. */
const partText = (part: unknown): unknown =>
  (typeof part === 'object' ? (part as { text?: unknown } | null)?.text || '' : String(part || ''));

/** custom | main (Risu) | aux / otherAx / memory / translate / emotion */
export function normalizeLlmSource(value: unknown): LlmSource {
  const s = String(value || '').trim().toLowerCase();
  if (s === 'main' || s === 'risu_main' || s === 'risu-main') return 'main';
  if (s === 'memory' || s === 'risu_memory' || s === 'longterm' || s === 'long_term') return 'memory';
  if (s === 'translate' || s === 'translation' || s === 'risu_translate') return 'translate';
  if (s === 'emotion' || s === 'risu_emotion') return 'emotion';
  if (s === 'other' || s === 'otherax' || s === 'other_ax' || s === 'risu_other') return 'other';
  if (s === 'aux' || s === 'risu_aux' || s === 'risu-aux' || s === 'sub' || s === 'submodel' || s === 'secondary') return 'aux';
  return 'custom';
}

/** Risu `runLLMModel` mode for a normalised source. custom is unused. */
export function risuModeForSource(value: unknown): string {
  const s = normalizeLlmSource(value);
  if (s === 'main') return 'model';
  if (s === 'memory') return 'memory';
  if (s === 'translate') return 'translate';
  if (s === 'emotion') return 'emotion';
  return 'otherAx';
}

/** True when the request should be delegated to Risu's own model instead of our HTTP lane. */
export function llmIsRisuSource(value: unknown): boolean {
  return normalizeLlmSource(value) !== 'custom';
}

export interface RisuMultiModal {
  type: 'image' | 'video' | 'audio' | 'signature';
  base64: string;
  width?: number;
  height?: number;
}

/** Message shape `runLLMModel` actually forwards (`content` must be a string). */
export interface RisuChatMessage {
  role: string;
  content: string;
  multimodals?: RisuMultiModal[];
  [key: string]: unknown;
}

function imageUrlFromPart(part: LlmContentPart): string {
  const image = part.image_url;
  if (typeof image === 'string') return image;
  if (image && typeof image === 'object') return String(image.url || '');
  return '';
}

function risuImageFromDataUrl(url: string): RisuMultiModal | null {
  const raw = String(url || '').trim();
  if (!raw) return null;
  if (/^data:/i.test(raw)) return { type: 'image', base64: raw };
  return null;
}

/**
 * Risu `OpenAIChat.content` is a string. Vision goes on `multimodals`, the same
 * field chat inlays use. Passing an OpenAI part array stringifies to
 * `[object Object],[object Object]` and the pixels never leave.
 */
export function openaiMessagesToRisu(messages: readonly LlmMessage[] | null | undefined): RisuChatMessage[] {
  const out: RisuChatMessage[] = [];
  for (const row of messages || []) {
    const role = String(row?.role || 'user');
    const content = row?.content;
    const { role: _role, content: _content, ...extra } = row;
    const existing = Array.isArray(row.multimodals)
      ? (row.multimodals as RisuMultiModal[]).filter((m) => m && typeof m === 'object')
      : [];
    if (!Array.isArray(content)) {
      const text = String(content ?? '');
      const next: RisuChatMessage = { ...extra, role, content: text };
      if (existing.length) next.multimodals = existing;
      out.push(next);
      continue;
    }
    const texts: string[] = [];
    const multimodals = [...existing];
    for (const part of content) {
      if (typeof part === 'string') {
        const t = part.trim();
        if (t) texts.push(t);
        continue;
      }
      if (!part || typeof part !== 'object') continue;
      const url = imageUrlFromPart(part);
      if (part.type === 'image_url' || url) {
        const image = risuImageFromDataUrl(url);
        if (image) multimodals.push(image);
        continue;
      }
      const t = String(part.text || '').trim();
      if (t) texts.push(t);
    }
    const next: RisuChatMessage = { ...extra, role, content: texts.join('\n') };
    if (multimodals.length) next.multimodals = multimodals;
    else delete next.multimodals;
    out.push(next);
  }
  return out;
}

/** True when the LLM settings are complete enough to attempt a tagging call. */
export function llmConfigured(llm: Partial<LlmSettings> | null | undefined): boolean {
  const cfg: Partial<LlmSettings> = llm || {};
  if (llmIsRisuSource(cfg.source)) return true;
  const provider = normalizeLlmProvider(cfg.provider);
  if (provider === 'vertex') {
    return Boolean(cleanText(cfg.model) && (cleanText(cfg.api_key) || cleanText(cfg.service_account_json)));
  }
  return Boolean(cleanText(cfg.model) && cleanText(cfg.api_key));
}

/** Rewrites OpenAI messages as an Anthropic `{ system, messages }` pair. */
export function openaiMessagesToAnthropic(messages: readonly LlmMessage[] | null | undefined): AnthropicRequest {
  let system = '';
  const out: AnthropicMessage[] = [];
  for (const row of messages || []) {
    const role = String(row?.role || '');
    const content = row?.content;
    if (role === 'system') {
      const text = typeof content === 'string'
        ? content
        : Array.isArray(content)
          ? content.map((part) => (typeof part === 'object' ? part.text || '' : String(part))).join('')
          : String(content ?? '');
      system = system ? `${system}\n${text}` : text;
      continue;
    }
    if (Array.isArray(content)) {
      const parts: AnthropicContentBlock[] = [];
      for (const part of content) {
        if (!part || typeof part !== 'object') {
          const t = String(part || '').trim();
          if (t) parts.push({ type: 'text', text: t });
          continue;
        }
        const image = part.image_url;
        const url = (typeof image === 'object' && image ? image.url : '')
          || (typeof image === 'string' ? image : '');
        if (part.type === 'image_url' || url) {
          const m = String(url).match(/^data:([^;]+);base64,([\s\S]+)$/i);
          if (m) {
            parts.push({
              type: 'image',
              source: { type: 'base64', media_type: m[1] || 'image/png', data: m[2].replace(/\s+/g, '') },
            });
          }
          continue;
        }
        const t = String(part.text || '').trim();
        if (t) parts.push({ type: 'text', text: t });
      }
      out.push({
        role: role === 'assistant' ? 'assistant' : 'user',
        content: parts.length ? parts : [{ type: 'text', text: '' }],
      });
      continue;
    }
    out.push({
      role: role === 'assistant' ? 'assistant' : 'user',
      content: String(content ?? ''),
    });
  }
  return { system, messages: out };
}

/** Pulls the assistant text out of an OpenAI-compatible chat completion. */
export function extractChatCompletionText(payload: ChatCompletionPayload | null | undefined): string {
  const choices = payload?.choices || [];
  if (!choices.length) throw new Error('LLM returned no choices.');
  const message: { content?: unknown } = choices[0].message || {};
  let content = message.content;
  if (Array.isArray(content)) {
    content = content.map(partText).join('');
  }
  // Some reasoning models put final text in content; keep content only (ignore reasoning fields).
  return cleanText(content);
}

/** Joins an Anthropic `content` block list into text, rejecting an empty result. */
export function extractAnthropicText(payload: AnthropicPayload | null | undefined): string {
  const raw = payload?.content;
  const blocks: unknown[] = Array.isArray(raw) ? raw : [];
  const text = blocks.map(partText).join('');
  const out = cleanText(text || payload?.completion || '');
  if (!out) throw new Error('Anthropic 응답이 비어 있습니다.');
  return out;
}

/** How a bounded stream read ended; `done` is the only one the stream itself signalled. */
type StreamEnd = 'done' | 'idle' | 'deadline';

export interface StreamReadOptions {
  /**
   * Once some text has arrived, a gap this long with no further chunk ends the
   * read with what we have. Off when unset.
   */
  idleMs?: number;
  /** Absolute wall-clock deadline; a read still pending at this point throws. Off when unset. */
  deadlineAt?: number;
  /** Diagnostics sink for the non-`done` endings; keeps this module free of the debug ring. */
  note?: (stage: string, detail: Record<string, unknown>) => void;
}

interface ReadOutcome {
  end: StreamEnd;
  packet?: { done?: boolean; value?: unknown };
}

/**
 * One `reader.read()` raced against the idle gap and the deadline.
 *
 * Both timers are cleared however the race settles, and a `read()` that loses
 * the race is left to settle on its own — the stream is cancelled right after,
 * so its eventual rejection is expected and swallowed.
 */
function readOnce(
  reader: { read(): Promise<{ done?: boolean; value?: unknown }> },
  idleMs: number,
  deadlineAt: number,
): Promise<ReadOutcome> {
  return new Promise<ReadOutcome>((resolve, reject) => {
    let settled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const finish = (out: ReadOutcome | null, err?: unknown): void => {
      if (settled) return;
      settled = true;
      for (const t of timers) clearTimeout(t);
      if (err) reject(err);
      else resolve(out as ReadOutcome);
    };
    if (idleMs > 0) timers.push(setTimeout(() => finish({ end: 'idle' }), idleMs));
    if (deadlineAt > 0) {
      const left = deadlineAt - Date.now();
      if (left <= 0) {
        finish({ end: 'deadline' });
        return;
      }
      timers.push(setTimeout(() => finish({ end: 'deadline' }), left));
    }
    reader.read().then(
      (packet) => finish({ end: 'done', packet }),
      (err: unknown) => (settled ? undefined : finish(null, err)),
    );
  });
}

/**
 * Drains a text/byte/chunk-object stream into one string.
 *
 * Risu hands `runLLMModel` output back as a stream whenever the configured model
 * is a provider plugin, and that stream is proxied across the plugin sandbox.
 * When the upstream refuses or errors mid-reply the text arrives but the close
 * never does — so a plain `read()` loop waits forever, and the job above it stays
 * in `tagging` with no error for the UI to unlock on. The idle gap ends such a
 * read with the text received; the deadline bounds a stream that never says
 * anything at all.
 */
export async function readStreamToText(stream: unknown, opts: StreamReadOptions = {}): Promise<string> {
  if (!isStreamLike(stream)) return '';
  const reader = stream.getReader() as {
    read(): Promise<{ done?: boolean; value?: unknown }>;
    cancel?(): Promise<unknown> | unknown;
  };
  const decoder = typeof TextDecoder !== 'undefined' ? new TextDecoder() : null;
  const idleMs = Number(opts.idleMs) > 0 ? Number(opts.idleMs) : 0;
  const deadlineAt = Number(opts.deadlineAt) > 0 ? Number(opts.deadlineAt) : 0;
  const startedAt = Date.now();
  let lastObjText = '';
  let byteText = '';
  const cancelQuietly = (): void => {
    try {
      const p = reader.cancel?.();
      if (p && typeof (p as Promise<unknown>).catch === 'function') (p as Promise<unknown>).catch(() => {});
    } catch { /* already closed */ }
  };
  for (;;) {
    const haveText = Boolean(lastObjText || byteText);
    const outcome = await readOnce(reader, haveText ? idleMs : 0, deadlineAt);
    if (outcome.end === 'idle') {
      cancelQuietly();
      opts.note?.('llm.stream.idle', {
        message: `${idleMs}ms idle, no close — using text so far`,
        ms: Date.now() - startedAt,
        bytes: (lastObjText || byteText).length,
      });
      break;
    }
    if (outcome.end === 'deadline') {
      cancelQuietly();
      const got = (lastObjText || byteText).length;
      opts.note?.('llm.stream.deadline', { message: `deadline · ${got} chars received`, ms: Date.now() - startedAt, bytes: got });
      throw new Error(`LLM 스트림 응답 시간 초과 (${Math.round((Date.now() - startedAt) / 1000)}s, 수신 ${got}자)`);
    }
    const { done, value } = outcome.packet || {};
    if (done) break;
    if (typeof value === 'string') {
      lastObjText = value;
      byteText += value;
    } else if (value instanceof Uint8Array) {
      byteText += decoder ? decoder.decode(value, { stream: true }) : '';
    } else if (value && typeof value === 'object') {
      // Risu StreamResponseChunk: { "0": cumulativeFullText }
      const chunk = value as { 0?: unknown; content?: unknown; text?: unknown };
      const cumulative = chunk[0];
      if (typeof cumulative === 'string') lastObjText = cumulative;
      else if (typeof chunk.content === 'string') lastObjText = chunk.content;
      else if (typeof chunk.text === 'string') lastObjText = chunk.text;
    }
  }
  if (decoder) byteText += decoder.decode();
  return lastObjText || byteText;
}

interface LlmResponseLike {
  type?: unknown;
  result?: unknown;
  data?: unknown;
  stream?: unknown;
  message?: unknown;
  error?: unknown;
  choices?: Array<{ message?: { content?: unknown }; text?: unknown; delta?: { content?: unknown } }>;
  content?: unknown;
  text?: unknown;
  response?: unknown;
  output?: unknown;
  [key: string]: unknown;
}

/**
 * Normalize Risu runLLMModel / OpenAI-like responses to plain text.
 * Risu returns { type: 'success'|'fail'|'streaming', result } — not raw chat completion.
 */
export async function llmResponseToText(response: unknown, read: StreamReadOptions = {}): Promise<string> {
  if (typeof response === 'string') return response;
  if (isStreamLike(response)) {
    return readStreamToText(response, read);
  }
  if (response == null) return '';
  if (typeof response === 'number' || typeof response === 'boolean') return String(response);
  if (typeof response === 'object') {
    const res = response as LlmResponseLike;
    const risuType = cleanText(res.type, 40).toLowerCase();
    if (risuType === 'fail' || risuType === 'error') {
      const errMsg = cleanText(res.result || res.message || res.error || 'Risu LLM 실패', 800);
      throw new Error(`Risu LLM 실패: ${errMsg}`);
    }
    if (risuType === 'streaming' || risuType === 'stream') {
      const stream = res.result ?? res.data ?? res.stream;
      const streamed = await readStreamToText(stream, read);
      if (streamed.trim()) return streamed;
    }
    if (risuType === 'success' || risuType === 'ok') {
      const ok = res.result ?? res.data ?? res.content;
      if (typeof ok === 'string') return ok;
      if (isStreamLike(ok)) return readStreamToText(ok, read);
    }

    const preferred: unknown[] = [
      res.choices?.[0]?.message?.content,
      res.choices?.[0]?.text,
      res.choices?.[0]?.delta?.content,
      (res.message as { content?: unknown } | undefined)?.content,
      res.content,
      res.text,
      res.response,
      // Prefer unwrapping only after typed Risu handling above.
      risuType ? null : res.result,
      res.output,
    ];
    for (const part of preferred) {
      if (typeof part === 'string' && part.trim()) return part;
      if (Array.isArray(part)) {
        const joined = part.map(partText).join('');
        if (joined.trim()) return joined;
      }
      if (isStreamLike(part)) {
        const streamed = await readStreamToText(part, read);
        if (streamed.trim()) return streamed;
      }
    }
    try {
      return JSON.stringify(response);
    } catch {
      return String(response);
    }
  }
  return String(response || '');
}
