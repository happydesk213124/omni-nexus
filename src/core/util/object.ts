/** Object cloning and merging. */
import { cleanText } from './text.ts';

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/**
 * Structural clone.
 *
 * Uses `structuredClone` when available (an order of magnitude cheaper than the
 * JSON round trip the 1.x code used everywhere) and falls back to JSON so the
 * behaviour is unchanged on hosts that lack it.
 */
export function deepcopy<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch {
      // Non-cloneable members (functions, DOM nodes) — fall through to JSON,
      // which drops them exactly as the 1.x implementation did.
    }
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Recursive merge: plain objects merge, everything else is replaced. */
export function deepMerge<T extends Record<string, unknown>>(base: T, overlay: Record<string, unknown>): T {
  const out = deepcopy(base ?? ({} as T)) as Record<string, unknown>;
  for (const [key, value] of Object.entries(overlay ?? {})) {
    const current = out[key];
    out[key] = isPlainObject(value) && isPlainObject(current)
      ? deepMerge(current, value)
      : value;
  }
  return out as T;
}

/**
 * Parses LLM output that may be fenced, prefixed, or padded with prose.
 *
 * Runs `cleanText` first, matching 1.x. That collapses whitespace *inside* JSON
 * string values too, which is load-bearing: tag strings are expected to come back
 * space-normalised, and callers downstream rely on it.
 */
export function parseJsonLoose(text: unknown): unknown {
  const raw = cleanText(text).replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const preview = raw.slice(0, 180).replace(/\s+/g, ' ');
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error(`태거 JSON 파싱 실패${preview ? ` · 응답: ${preview}` : ' · 응답이 비어 있거나 JSON이 아님'}`);
    }
    try {
      return JSON.parse(match[0]);
    } catch (err) {
      throw new Error(`태거 JSON 파싱 실패 · ${String((err as Error)?.message ?? err).slice(0, 120)} · 응답: ${preview}`);
    }
  }
}

/** Second tagger parse after llm_json_retry. Same miss → a short terminal error. */
export const TAGGER_JSON_RETRY_FAIL_MESSAGE = 'JSON 오류 · 생성실패';

export function parseTaggerJsonAfterRetry(text: unknown): unknown {
  try {
    return parseJsonLoose(text);
  } catch {
    throw new Error(TAGGER_JSON_RETRY_FAIL_MESSAGE);
  }
}
