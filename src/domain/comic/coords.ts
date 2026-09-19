/**
 * Comic use_coords: tab mode + optional per-page LLM pick.
 * Broken / missing / stacked centers → AI choice. No invented offsets.
 */
import { isValidNaiCoord, type CoordPair } from '../nai/coords.ts';
import { cleanText } from '../../core/util/text.ts';

export type ComicCoordsMode = 'ai_choice' | 'llm' | 'position';
export type ComicPageCoords = 'position' | 'ai_choice';

export function normalizeComicCoordsMode(raw: unknown): ComicCoordsMode {
  const s = cleanText(raw, 40).toLowerCase().replace(/[\s-]+/g, '_');
  if (s === 'ai' || s === 'aichoice' || s === 'ai_choice' || s === 'off' || s === 'none') {
    return 'ai_choice';
  }
  if (s === 'position' || s === 'coords' || s === 'coord' || s === 'use_coords') return 'position';
  return 'llm';
}

export function normalizeComicPageCoords(raw: unknown): ComicPageCoords | '' {
  const s = cleanText(raw, 40).toLowerCase().replace(/[\s-]+/g, '_');
  if (s === 'position' || s === 'coords' || s === 'coord') return 'position';
  if (s === 'ai' || s === 'aichoice' || s === 'ai_choice' || s === 'off') return 'ai_choice';
  return '';
}

function sameCoord(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.01;
}

function anyPairStacked(pairs: CoordPair[]): boolean {
  for (let i = 0; i < pairs.length; i += 1) {
    for (let j = i + 1; j < pairs.length; j += 1) {
      const a = pairs[i]!;
      const b = pairs[j]!;
      if (sameCoord(a.x, b.x) && sameCoord(a.y, b.y)) return true;
    }
  }
  return false;
}

export function comicPairsUsable(pairs: Array<CoordPair | null | undefined>): boolean {
  if (!pairs.length) return false;
  if (!pairs.every((p) => p != null && isValidNaiCoord(p.x) && isValidNaiCoord(p.y))) return false;
  if (pairs.length >= 2 && anyPairStacked(pairs as CoordPair[])) return false;
  return true;
}

export function resolveComicUseCoords(
  tabMode: unknown,
  pageCoords: unknown,
  pairs: Array<CoordPair | null | undefined>,
): boolean {
  const mode = normalizeComicCoordsMode(tabMode);
  if (mode === 'ai_choice') return false;
  let wantPosition = mode === 'position';
  if (mode === 'llm') {
    const page = normalizeComicPageCoords(pageCoords);
    if (page !== 'position') return false;
    wantPosition = true;
  }
  if (!wantPosition) return false;
  return comicPairsUsable(pairs);
}
