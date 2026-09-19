/**
 * Build a style-preset positive from a NovelAI main prompt:
 * keep artist:* (with emphasis), quality / illustration / collaboration / bad anatomy
 * tokens (with emphasis), drop everything else. Negative is kept separately as-is.
 */
import { stripPersonCountTags } from '../character/tags.ts';
import { joinTags } from '../../core/util/text.ts';
import { negativeFromNaiMetadata } from './from-metadata.ts';
import { expandTokenPlains, splitNaiPromptTokens } from './prompt-tags.ts';

/** Exact plains kept for style presets (lowercase). */
const KEEP_STYLE_PLAINS = new Set([
  'best quality',
  'amazing quality',
  'very aesthetic',
  'highres',
  'incredibly absurdres',
  'best illustration',
  'artist collaboration',
  'bad anatomy',
]);

function tokenKeepable(token: string): boolean {
  if (/artist\s*:/i.test(token)) return true;
  for (const { plain } of expandTokenPlains(token)) {
    if (KEEP_STYLE_PLAINS.has(plain.toLowerCase())) return true;
  }
  return false;
}

/** Filter main/prompt tags down to artist + quality-style tokens, preserving emphasis. */
export function filterStylePresetPositive(prompt: unknown): string {
  const kept: string[] = [];
  const seen = new Set<string>();
  for (const token of splitNaiPromptTokens(prompt)) {
    if (!tokenKeepable(token)) continue;
    const key = token.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(token.trim());
  }
  return joinTags(...kept);
}

export interface StylePresetFromMeta {
  positive: string;
  negative: string;
  cfg_scale: number | null;
  cfg_rescale: number | null;
}

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

function numOrNull(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Pull uc/negative + CFG fields from a NAI metadata object.
 *  `positivePrompt` should already be base_caption-only (style import). */
export function styleFieldsFromNaiMetadata(
  meta: unknown,
  positivePrompt: string,
  opts?: { filterTags?: boolean },
): StylePresetFromMeta {
  let root = parseMaybeJson(meta);
  const rootObj = asRecord(root);
  let comment = rootObj ? parseMaybeJson(rootObj.Comment ?? rootObj.comment) : null;
  const commentObj = asRecord(comment) || rootObj;

  const neg = negativeFromNaiMetadata(meta);

  // NovelAI Comment uses `scale` for Prompt Guidance; also accept cfg_scale.
  const cfg_scale = numOrNull(
    commentObj?.scale ?? commentObj?.cfg_scale ?? commentObj?.cfgScale ?? rootObj?.scale,
  );
  const cfg_rescale = numOrNull(
    commentObj?.cfg_rescale ?? commentObj?.cfgRescale ?? rootObj?.cfg_rescale,
  );

  const filterTags = opts?.filterTags !== false;
  // Off still strips 1girl/1boy/solo so the card person-tag injector keeps working.
  const positive = filterTags
    ? filterStylePresetPositive(positivePrompt)
    : joinTags(...splitNaiPromptTokens(positivePrompt).map((token) => stripPersonCountTags(token)));
  return {
    positive,
    negative: neg,
    cfg_scale,
    cfg_rescale,
  };
}
