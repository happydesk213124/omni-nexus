/**
 * Comic-tab NAI overrides. Empty → same path as illustration (NAI tab + preset).
 */
import type { CardSettings, NaiSettings, StylePreset } from '../../core/types.ts';
import { cleanText } from '../../core/util/text.ts';
import { naiSamplerForFamily, naiStepsForFamily, optionalNaiSampler } from '../nai/samplers.ts';
import {
  resolveGenerationCfgParams,
  type GenerationCfgParams,
} from '../style-preset-overrides.ts';

function optionalFinite(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function resolveComicNaiParams(
  card: Pick<
    CardSettings,
    'comic_steps' | 'comic_sampler' | 'comic_cfg_scale' | 'comic_cfg_rescale'
  > & Record<string, unknown>,
  nai: NaiSettings,
  preset: StylePreset | null | undefined,
): GenerationCfgParams {
  const base = resolveGenerationCfgParams(
    {
      ...nai,
      steps: naiStepsForFamily(nai, 'v5'),
      sampler: naiSamplerForFamily(nai, 'v5'),
    },
    preset,
  );
  const steps = optionalFinite(card.comic_steps);
  const cfg = optionalFinite(card.comic_cfg_scale);
  const rescale = optionalFinite(card.comic_cfg_rescale);
  const sampler = optionalNaiSampler(card.comic_sampler);
  return {
    cfg_scale: cfg != null ? cfg : base.cfg_scale,
    cfg_rescale: rescale != null ? rescale : base.cfg_rescale,
    steps: steps != null ? Math.max(1, Math.min(150, Math.floor(steps))) : base.steps,
    sampler: sampler || base.sampler,
    scheduler: base.scheduler,
  };
}

export function normalizeComicLlmBatch(raw: unknown): 'once' | 'per_shot' | 'with_main' {
  const s = cleanText(raw, 40).toLowerCase().replace(/[\s-]+/g, '_');
  if (s === 'per_shot' || s === 'each') return 'per_shot';
  if (s === 'with_main' || s === 'main' || s === 'inline') return 'with_main';
  return 'once';
}

export function comicLlmWithMain(raw: unknown): boolean {
  return normalizeComicLlmBatch(raw) === 'with_main';
}

export function normalizeComicSchedule(raw: unknown): 'overlap' | 'wait_taggers' {
  const s = cleanText(raw, 40).toLowerCase().replace(/[\s-]+/g, '_');
  return s === 'wait' || s === 'wait_taggers' || s === 'serial' ? 'wait_taggers' : 'overlap';
}

export function normalizeComicMaxPages(raw: unknown): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n)) return 2;
  return Math.max(0, Math.min(12, n));
}

/** 0–100. Missing / NaN → 50. */
export function normalizeComicGenRatio(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 50;
  return Math.max(0, Math.min(100, Math.round(n)));
}
