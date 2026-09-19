/**
 * Pull the positive prompt string(s) from NovelAI metadata objects.
 * Covers legacy `prompt` and V4+ caption / char_captions.
 */
import { cleanText, joinTags } from '../../core/util/text.ts';

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const t = value.trim();
  if (!t || (t[0] !== '{' && t[0] !== '[')) return value;
  try {
    return JSON.parse(t);
  } catch {
    return value;
  }
}

/** Collect caption strings from a V4-style caption object. */
function captionsFromV4(caption: unknown, includeChars = true): string[] {
  const c = asRecord(caption);
  if (!c) return [];
  const out: string[] = [];
  const base = cleanText(c.base_caption ?? c.baseCaption ?? '');
  if (base) out.push(base);
  if (!includeChars) return out;
  const chars = c.char_captions ?? c.charCaptions;
  if (Array.isArray(chars)) {
    for (const row of chars) {
      const r = asRecord(row);
      const text = cleanText(r?.char_caption ?? r?.charCaption ?? r?.caption ?? '');
      if (text) out.push(text);
    }
  }
  return out;
}

/**
 * Normalize a top-level NAI metadata blob (stealth JSON or Comment object)
 * into one comma-joined positive prompt. Skips uc/negative.
 * Style presets pass `{ includeCharCaptions: false }` so only `base_caption`
 * (or legacy `prompt`) is used — character slots stay out.
 */
export function promptFromNaiMetadata(
  meta: unknown,
  opts?: { includeCharCaptions?: boolean },
): string {
  let root = parseMaybeJson(meta);
  const rootObj = asRecord(root);
  if (!rootObj) return cleanText(meta);

  // Stealth often wraps `{ Comment: "{...}", ... }` or Comment already object.
  let comment = rootObj.Comment ?? rootObj.comment;
  comment = parseMaybeJson(comment);
  const commentObj = asRecord(comment);

  const includeChars = opts?.includeCharCaptions !== false;
  const parts: string[] = [];

  const takePrompt = (obj: Record<string, unknown> | null): void => {
    if (!obj) return;
    const p = cleanText(obj.prompt ?? obj.Prompt ?? '');
    const v4 = asRecord(obj.v4_prompt ?? obj.v4Prompt);
    const captionSrc = v4 ? (v4.caption ?? v4) : obj.caption;
    const fromCaption = captionsFromV4(captionSrc, includeChars);
    if (includeChars) {
      if (p) parts.push(p);
      parts.push(...fromCaption);
      return;
    }
    // Style preset: only base_caption. Legacy `prompt` if there is no V4 caption object.
    if (fromCaption.length) parts.push(...fromCaption);
    else if (!asRecord(captionSrc) && p) parts.push(p);
  };

  takePrompt(commentObj);
  if (!commentObj && typeof comment === 'string' && comment.trim() && !isNaiSoftwareLabel(comment)) {
    parts.push(cleanText(comment));
  }
  takePrompt(rootObj);

  // Description sometimes holds the prompt when Comment is nested oddly.
  // "NovelAI" / software names are PNG Source/Description labels, not prompts.
  const desc = cleanText(rootObj.Description ?? rootObj.description ?? '');
  if (
    desc &&
    !isNaiSoftwareLabel(desc) &&
    (includeChars || parts.length === 0) &&
    !parts.some((p) => p.includes(desc.slice(0, 40)))
  ) {
    parts.push(desc);
  }

  return joinTags(...parts);
}

const NAI_SOFTWARE_LABEL = /^(novelai|stable diffusion|comfyui|automatic1111|unknown)$/i;

function isNaiSoftwareLabel(value: string): boolean {
  return NAI_SOFTWARE_LABEL.test(value.trim());
}

/** True when the blob has a usable positive prompt (not just Source=NovelAI). */
export function naiMetaHasPrompt(meta: unknown): boolean {
  const prompt = promptFromNaiMetadata(meta).trim();
  return Boolean(prompt) && !isNaiSoftwareLabel(prompt);
}

/** UC / negative from Comment JSON. Description-only exports often omit this. */
export function negativeFromNaiMetadata(meta: unknown): string {
  let root = parseMaybeJson(meta);
  const rootObj = asRecord(root);
  if (!rootObj) return '';
  const comment = parseMaybeJson(rootObj.Comment ?? rootObj.comment);
  const commentObj = asRecord(comment) || rootObj;
  return cleanText(
    commentObj?.uc
    ?? commentObj?.negative_prompt
    ?? commentObj?.negativePrompt
    ?? commentObj?.Negative
    ?? rootObj?.uc
    ?? '',
    20000,
  );
}

export function naiMetaHasNegative(meta: unknown): boolean {
  return Boolean(negativeFromNaiMetadata(meta));
}

/**
 * Prefer the blob that actually has `uc`. Description-only text chunks can
 * look complete (positive fills) while the negative still lives in stealth.
 */
export function pickNaiMeta(textMeta: unknown | null, stealthMeta: unknown | null): unknown | null {
  const textOk = Boolean(textMeta && naiMetaHasPrompt(textMeta));
  const stealthOk = Boolean(stealthMeta && naiMetaHasPrompt(stealthMeta));
  if (textOk && naiMetaHasNegative(textMeta)) return textMeta;
  if (stealthOk && naiMetaHasNegative(stealthMeta)) return stealthMeta;
  if (textOk) return textMeta;
  if (stealthOk) return stealthMeta;
  return null;
}
