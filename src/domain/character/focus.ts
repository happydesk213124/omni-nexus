/** Optional per-shot focus cast → out-of-frame on everyone else. Pure. */

import type { ShotCharacter } from '../../core/types.ts';
import { joinTags } from '../../core/util/text.ts';
import type { CharacterInput } from './identity.ts';
import { resolveCharacter } from './roster.ts';
import { resolveCharacterGender } from './tags.ts';

/** @deprecated Prefer focusOutOfFrameTag(weight); kept for older call sites/tests. */
export const FOCUS_OUT_OF_FRAME_TAG = '2::out of frame::';

/** Clamp focus weight to 0–5, one decimal (missing/NaN → 2). Mirrors schema.normalizeFocusWeight. */
export function clampFocusWeight(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 2;
  return Math.max(0, Math.min(5, Math.round(n * 10) / 10));
}

/**
 * Tag for non-focus captions.
 * weight ≤ 1 → bare `out of frame`; weight > 1 → `N::out of frame::` (N clamped 2–5).
 */
export function focusOutOfFrameTag(weight: unknown = 2): string {
  const w = clampFocusWeight(weight);
  if (w <= 1) return 'out of frame';
  return `${w}::out of frame::`;
}

/**
 * Manual focus: keep cast indexes matching preferred gender (female→f, male→m).
 * Non-matching / unknown gender are out of frame. Empty when nobody matches
 * or everyone matches (avoid framing nobody / no-op).
 */
export function manualFocusIndexesByGender(
  chars: ShotCharacter[],
  roster: CharacterInput[],
  prefer: 'female' | 'male',
): number[] {
  const want = prefer === 'female' ? 'f' : 'm';
  const keep: number[] = [];
  for (let i = 0; i < chars.length; i++) {
    const char = chars[i]!;
    const name = String(char.name || '').trim();
    const stored = name ? resolveCharacter(name, roster) : null;
    if (resolveCharacterGender(char, stored) === want) keep.push(i);
  }
  if (!keep.length || keep.length >= chars.length) return [];
  return keep;
}

/**
 * Parse one focus token into a 0-based cast index, or null if invalid.
 * Accepts `1`/`2`… or `char1`/`char2`… (case-insensitive).
 */
export function parseFocusToken(token: unknown, castLen: number): number | null {
  if (castLen <= 0) return null;
  if (typeof token === 'number' && Number.isFinite(token)) {
    const n = Math.trunc(token);
    return n >= 1 && n <= castLen ? n - 1 : null;
  }
  const raw = String(token ?? '').trim().toLowerCase();
  if (!raw) return null;
  const charM = /^char(\d+)$/.exec(raw);
  if (charM) {
    const n = Number(charM[1]);
    return n >= 1 && n <= castLen ? n - 1 : null;
  }
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 && n <= castLen ? n - 1 : null;
}

/**
 * Resolve shot `focus` to sorted unique 0-based indexes.
 * Accepts a number, `"1"`, `"char2"`, `"1,2"`, `[1, 2]`, `["char1","char3"]`, etc.
 * Empty / all-invalid → `[]` (no focus).
 */
export function parseFocusIndexes(focus: unknown, castLen: number): number[] {
  if (castLen <= 0 || focus == null || focus === '') return [];
  const tokens: unknown[] = [];
  if (Array.isArray(focus)) {
    tokens.push(...focus);
  } else if (typeof focus === 'string') {
    const parts = focus.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
    if (parts.length) tokens.push(...parts);
    else tokens.push(focus);
  } else {
    tokens.push(focus);
  }
  const out = new Set<number>();
  for (const tok of tokens) {
    const idx = parseFocusToken(tok, castLen);
    if (idx != null) out.add(idx);
  }
  return [...out].sort((a, b) => a - b);
}

/** Append out-of-frame to captions whose index is not in `focusIndexes`. No-op if focus empty. */
export function applyFocusOutOfFrame<T extends { prompt: string }>(
  captions: T[],
  focusIndexes: number[],
  weight: unknown = 2,
): T[] {
  if (!focusIndexes.length || !captions.length) return captions;
  const tag = focusOutOfFrameTag(weight);
  const focus = new Set(focusIndexes);
  return captions.map((cap, i) => {
    if (focus.has(i)) return cap;
    if (/\bout of frame\b/i.test(cap.prompt)) return cap;
    return { ...cap, prompt: joinTags(cap.prompt, tag) || tag };
  });
}

/** 1-based indexes for card meta / LLM-shaped focus (from 0-based keep list). */
export function focusIndexesToMeta(focusIndexes: number[]): number[] {
  return focusIndexes.map((i) => i + 1);
}
