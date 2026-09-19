/**
 * First-tagger comic kind + prose range. Neighbor shot lines are never used
 * to invent a range — only `line` + `comic_line_end`.
 */
import { cleanText } from '../../core/util/text.ts';
import { normalizeComicGenRatio } from './params.ts';

export type ShotKind = 'illustration' | 'comic';

export function comicGenOn(card: { comic_gen?: unknown } | null | undefined): boolean {
  const raw = card?.comic_gen;
  if (raw == null || raw === '') return false;
  const s = String(raw).toLowerCase().trim();
  return raw === true || s === 'on' || s === 'true' || s === '1';
}

export function normalizeShotKind(raw: unknown): ShotKind {
  const s = cleanText(raw, 40).toLowerCase();
  if (s === 'comic' || s === 'manga' || s === 'koma') return 'comic';
  return 'illustration';
}

/** Clamp inclusive 1-based [start, end] into the message line count. */
export function comicLineRange(
  line: unknown,
  comicLineEnd: unknown,
  lineCount: number,
): [number, number] {
  const max = Math.max(1, Math.floor(Number(lineCount) || 1));
  let start = Math.floor(Number(line));
  if (!Number.isFinite(start) || start < 1) start = 1;
  start = Math.min(max, start);
  let end = Math.floor(Number(comicLineEnd));
  if (!Number.isFinite(end) || end < 1) end = start;
  end = Math.min(max, Math.max(start, end));
  return [start, end];
}

export function comicCapFromRatio(shotCount: number, ratioPct: unknown): number {
  const n = Math.max(0, Math.floor(Number(shotCount) || 0));
  const pct = normalizeComicGenRatio(ratioPct);
  if (!n || !pct) return 0;
  return Math.max(0, Math.min(n, Math.round((n * pct) / 100)));
}

/** Extra comic shots become illustration so image_max still fills. */
export function clampComicPages<T extends { kind?: unknown; comic_line_end?: unknown }>(
  shots: readonly T[],
  maxPages: unknown,
): T[] {
  let max = Math.floor(Number(maxPages));
  if (!Number.isFinite(max) || max < 0) max = 0;
  let kept = 0;
  return shots.map((shot) => {
    if (normalizeShotKind(shot.kind) !== 'comic') return shot;
    if (kept < max) {
      kept += 1;
      return shot;
    }
    const next = { ...shot, kind: 'illustration' as const };
    delete next.comic_line_end;
    return next;
  });
}

export function clampComicByRatio<T extends { kind?: unknown; comic_line_end?: unknown }>(
  shots: readonly T[],
  ratioPct: unknown,
): T[] {
  return clampComicPages(shots, comicCapFromRatio(shots.length, ratioPct));
}

export function applyComicKindGuard<T extends { kind?: unknown; comic_line_end?: unknown }>(
  shots: T[],
  enabled: boolean,
): T[] {
  if (enabled) {
    for (const shot of shots) {
      shot.kind = normalizeShotKind(shot.kind);
      if (shot.kind !== 'comic') delete shot.comic_line_end;
    }
    return shots;
  }
  for (const shot of shots) {
    delete shot.kind;
    delete shot.comic_line_end;
  }
  return shots;
}
