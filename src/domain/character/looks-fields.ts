/**
 * Roster look slots that used to live only inside `appearance`.
 * Caption still joins them into one NAI line; storage keeps them separate.
 */
import { cleanText, joinTags, splitTagTokens } from '../../core/util/text.ts';

export const PENIS_SIZES = ['small penis', 'penis', 'huge penis', 'gigantic penis'] as const;
export type PenisSize = (typeof PENIS_SIZES)[number];

const PENIS_SET = new Set<string>(PENIS_SIZES);

/** Four Danbooru size tags only. Anything else → "". */
export function normalizePenisSize(raw: unknown): PenisSize | '' {
  const t = cleanText(raw, 40).toLowerCase().replace(/_/g, ' ').trim();
  if (!t) return '';
  if (PENIS_SET.has(t)) return t as PenisSize;
  if (t === 'small' || t === 'tiny') return 'small penis';
  if (t === 'normal' || t === 'average' || t === '보통') return 'penis';
  if (t === 'huge' || t === 'large' || t === '대물') return 'huge penis';
  if (t === 'gigantic' || t === 'giant') return 'gigantic penis';
  return '';
}

/** Integer years. Non-finite / out of 1–120 → null. */
export function parseAgeYears(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/[^\d.-]/g, ''));
  if (!Number.isFinite(n)) return null;
  const years = Math.round(n);
  if (years < 1 || years > 120) return null;
  return years;
}

export function formatAgeCaption(raw: unknown): string {
  const years = parseAgeYears(raw);
  return years == null ? '' : `${years} years old`;
}

export interface ParsedHeight {
  cm: number | null;
  cue: 'petite' | 'short' | 'tall' | '';
}

/** cm first. Optional tall/short/petite. */
export function parseHeight(raw: unknown): ParsedHeight {
  const text = cleanText(raw, 80).toLowerCase();
  let cue: ParsedHeight['cue'] = '';
  if (/\bpetite\b/.test(text) || text.includes('아담')) cue = 'petite';
  else if (/\btall\b/.test(text) || text.includes('큰키') || text.includes('키큰')) cue = 'tall';
  else if (/\bshort\b/.test(text) || text.includes('작은키')) cue = 'short';
  const num = text.match(/(\d+(?:\.\d+)?)\s*cm|\b(\d{2,3})\b/);
  const cmRaw = num ? Number(num[1] || num[2]) : NaN;
  const cm = Number.isFinite(cmRaw) && cmRaw >= 80 && cmRaw <= 250 ? Math.round(cmRaw) : null;
  return { cm, cue };
}

/**
 * Caption: `170cm, tall`. Missing cm → cue only.
 * <150 → petite; girl ≥170 / boy ≥180 → tall when cue is empty.
 */
export function formatHeightCaption(
  raw: unknown,
  gender: 'girl' | 'boy' | 'other' | '' = '',
): string {
  const { cm, cue } = parseHeight(raw);
  let resolved = cue;
  if (!resolved && cm != null) {
    if (cm < 150) resolved = 'petite';
    else if (gender === 'girl' && cm >= 170) resolved = 'tall';
    else if (gender === 'boy' && cm >= 180) resolved = 'tall';
  }
  const parts: string[] = [];
  if (cm != null) parts.push(`${cm}cm`);
  if (resolved) parts.push(resolved);
  return parts.join(', ');
}

export function cleanLookSlot(raw: unknown, max = 400): string {
  return cleanText(raw, max);
}

const COLOR_MOD = new Set(['light', 'dark', 'pale', 'bright', 'deep', 'hot', 'soft', 'dull', 'neon']);
const COLOR_WORDS = new Set([
  'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'brown', 'black', 'white',
  'gray', 'grey', 'blonde', 'blond', 'silver', 'gold', 'golden', 'auburn', 'crimson', 'scarlet',
  'violet', 'indigo', 'teal', 'cyan', 'aqua', 'navy', 'maroon', 'beige', 'cream', 'ivory',
  'hazel', 'amber', 'bronze', 'copper', 'platinum', 'rainbow', 'multicolored', 'multicolour',
  'lavender', 'lilac', 'mint', 'peach', 'coral', 'turquoise', 'magenta', 'burgundy',
]);

function isColorPhrase(text: string): boolean {
  const words = cleanText(text, 80).toLowerCase().replace(/[_-]+/g, ' ').split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 3) return false;
  return words.every((w) => COLOR_MOD.has(w) || COLOR_WORDS.has(w));
}

function expandColorTokens(raw: unknown, kind: 'hair' | 'eyes', max: number): string {
  const suffix = kind === 'hair' ? 'hair' : 'eyes';
  const already = kind === 'hair' ? /\bhair\b/i : /\beyes?\b|\beyed\b/i;
  const out: string[] = [];
  for (const token of splitTagTokens(cleanText(raw, max))) {
    const t = token.trim().replace(/_/g, ' ').replace(/\s+/g, ' ');
    if (!t) continue;
    if (already.test(t) || !isColorPhrase(t)) out.push(t);
    else out.push(`${t} ${suffix}`);
  }
  return joinTags(...out);
}

/** Tab/save: `blue` → `blue hair`. Already `blue hair` stays. */
export function normalizeHairColorSlot(raw: unknown, max = 120): string {
  return expandColorTokens(raw, 'hair', max);
}

/** Tab/save: `white` → `white eyes`. Already `white eyes` stays. */
export function normalizeEyeColorSlot(raw: unknown, max = 120): string {
  return expandColorTokens(raw, 'eyes', max);
}

function lookTagKey(value: unknown): string {
  return cleanText(value, 200).toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ');
}

function unwrapEmphasisParts(token: string): string[] {
  const t = cleanText(token);
  const m = t.match(/^-?\d+(?:\.\d+)?::((?:(?!::).)*?)::$/);
  return m ? splitTagTokens(m[1]) : [t];
}

/** True when appearance already has this tag, including `2::blue hair::`. */
export function appearanceHasLookTag(appearance: unknown, tag: unknown): boolean {
  const needle = lookTagKey(tag);
  if (!needle) return false;
  for (const token of splitTagTokens(appearance)) {
    for (const part of unwrapEmphasisParts(token)) {
      if (lookTagKey(part) === needle) return true;
    }
  }
  return false;
}

/** Drop look-slot tags that are already in appearance (weighted groups count). */
export function lookSlotMissingFromAppearance(slot: unknown, appearance: unknown, max = 400): string {
  const text = cleanLookSlot(slot, max);
  if (!text) return '';
  return joinTags(...splitTagTokens(text).filter((t) => !appearanceHasLookTag(appearance, t)));
}
