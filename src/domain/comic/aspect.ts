/**
 * Comic-tab canvas: llm copies the first tagger; landscape/portrait/square lock it.
 * Illustration shots are left alone (card.auto_aspect).
 */
import { resolveShotAspect, type ShotAspect } from '../nai-meta/aspect.ts';
import { normalizeShotKind } from './kind.ts';
import { cleanText } from '../../core/util/text.ts';

export type ComicAspectMode = 'llm' | 'landscape' | 'portrait' | 'square';

export function normalizeComicAspect(raw: unknown): ComicAspectMode {
  const s = cleanText(raw, 40).toLowerCase().replace(/\s+/g, '');
  if (
    s === 'landscape'
    || s === 'horizontal'
    || s === 'wide'
    || s === '가로'
    || s === '4:3'
    || s === '3:2'
  ) {
    return 'landscape';
  }
  if (
    s === 'portrait'
    || s === 'vertical'
    || s === 'tall'
    || s === '세로'
    || s === '3:4'
    || s === '2:3'
  ) {
    return 'portrait';
  }
  if (s === 'square' || s === '1:1' || s === '1x1' || s === '정사각' || s === '정사각형') {
    return 'square';
  }
  return 'llm';
}

function forcedAspect(mode: ComicAspectMode): ShotAspect | null {
  if (mode === 'landscape' || mode === 'portrait' || mode === 'square') return mode;
  return null;
}

export function applyComicAspect<T extends { kind?: unknown; aspect?: unknown }>(
  shots: readonly T[],
  mode: unknown,
): T[] {
  const normalized = normalizeComicAspect(mode);
  const force = forcedAspect(normalized);
  return shots.map((shot) => {
    if (normalizeShotKind(shot.kind) !== 'comic') return shot;
    const aspect = force || resolveShotAspect(shot.aspect);
    return { ...shot, aspect };
  });
}
