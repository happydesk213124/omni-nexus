/**
 * Map tagger `aspect` to NovelAI canvas sizes (NovelAI size_id 1/2/5 trio).
 */
import type { NaiSettings } from '../../core/types.ts';

export type ShotAspect = 'portrait' | 'square' | 'landscape';

export const ASPECT_SIZES: Record<ShotAspect, { width: number; height: number }> = {
  portrait: { width: 832, height: 1216 },
  square: { width: 1024, height: 1024 },
  landscape: { width: 1216, height: 832 },
};

/** Normalize LLM aspect strings to the three supported values, or null. */
export function normalizeShotAspect(value: unknown): ShotAspect | null {
  const raw = String(value ?? '').trim().toLowerCase().replace(/\s+/g, '');
  if (!raw) return null;
  if (
    raw === 'portrait'
    || raw === 'vertical'
    || raw === 'tall'
    || raw === '832x1216'
    || raw === '3:4'
    || raw === '2:3'
  ) {
    return 'portrait';
  }
  if (
    raw === 'square'
    || raw === '1:1'
    || raw === '1x1'
    || raw === '1024x1024'
  ) {
    return 'square';
  }
  if (
    raw === 'landscape'
    || raw === 'horizontal'
    || raw === 'wide'
    || raw === '1216x832'
    || raw === '4:3'
    || raw === '3:2'
  ) {
    return 'landscape';
  }
  return null;
}

/** First-tagger canvas. Missing or unknown JSON falls back to portrait. */
export function resolveShotAspect(value: unknown): ShotAspect {
  return normalizeShotAspect(value) || 'portrait';
}

/** Label the pixels that were actually generated. Trio sizes first, else ratio. */
export function aspectFromCanvas(width: unknown, height: unknown): ShotAspect {
  const w = Math.round(Number(width));
  const h = Math.round(Number(height));
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return 'portrait';
  for (const name of Object.keys(ASPECT_SIZES) as ShotAspect[]) {
    const size = ASPECT_SIZES[name];
    if (size.width === w && size.height === h) return name;
  }
  const ratio = w / h;
  if (ratio >= 0.9 && ratio <= 1.1) return 'square';
  if (ratio > 1) return 'landscape';
  return 'portrait';
}

export function dimsForAspect(
  aspect: unknown,
  nai: Pick<NaiSettings, 'width' | 'height'>,
  autoAspect: boolean,
): { width: number; height: number; aspect: ShotAspect | 'settings' } {
  if (autoAspect) {
    const a = normalizeShotAspect(aspect) || 'portrait';
    return { ...ASPECT_SIZES[a], aspect: a };
  }
  const width = Math.max(64, Math.min(5000, Math.round(Number(nai.width) || 832)));
  const height = Math.max(64, Math.min(5000, Math.round(Number(nai.height) || 1216)));
  return { width, height, aspect: 'settings' };
}

/** Illustration auto-aspect, or comic shots (always use the tagger / comic lock). */
export function generationUsesShotAspect(autoAspect: boolean, useShotAspect: boolean): boolean {
  return Boolean(autoAspect) || Boolean(useShotAspect);
}

/** Same W×H as generateImage when the plan has no explicit size. */
export function canvasDimsForShot(
  aspect: unknown,
  nai: Pick<NaiSettings, 'width' | 'height'>,
  autoAspect: boolean,
  useShotAspect = false,
): { width: number; height: number; aspect: ShotAspect | 'settings' } {
  return dimsForAspect(aspect, nai, generationUsesShotAspect(autoAspect, useShotAspect));
}
