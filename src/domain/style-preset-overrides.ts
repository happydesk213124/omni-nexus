/**
 * Per-style-preset CFG overrides (vibe is a separate device-store image).
 *
 * Empty / missing CFG fields mean "use the model-settings NAI defaults".
 */

import type { NaiSettings, StylePreset } from '../core/types.ts';
import { normalizeNaiSampler, optionalNaiSampler } from './nai/samplers.ts';

export interface GenerationCfgParams {
  cfg_scale: number;
  cfg_rescale: number;
  steps: number;
  scheduler: string;
  sampler: string;
}

function optionalFinite(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Resolve CFG / steps / schedule from NAI settings and the active preset. */
export function resolveGenerationCfgParams(
  nai: Pick<NaiSettings, 'cfg_scale' | 'cfg_rescale' | 'steps' | 'scheduler' | 'sampler'>,
  preset: Pick<StylePreset, 'cfg_scale' | 'cfg_rescale' | 'steps' | 'scheduler' | 'sampler'> | null | undefined,
): GenerationCfgParams {
  let cfg_scale = Number(nai.cfg_scale ?? 7);
  let cfg_rescale = Number(nai.cfg_rescale ?? 0.36);
  let steps = Number(nai.steps ?? 28);
  let scheduler = String(nai.scheduler || 'karras');
  let sampler = normalizeNaiSampler(nai.sampler);
  if (!Number.isFinite(cfg_scale)) cfg_scale = 7;
  if (!Number.isFinite(cfg_rescale)) cfg_rescale = 0.36;
  if (!Number.isFinite(steps) || steps < 1) steps = 28;
  if (!scheduler) scheduler = 'karras';

  if (preset) {
    const cfg = optionalFinite(preset.cfg_scale);
    if (cfg != null) cfg_scale = cfg;
    const rescale = optionalFinite(preset.cfg_rescale);
    if (rescale != null) cfg_rescale = rescale;
    const presetSteps = optionalFinite(preset.steps);
    if (presetSteps != null) steps = Math.max(1, Math.min(50, presetSteps));
    const sched = String(preset.scheduler || '').trim();
    if (sched) scheduler = sched;
    const presetSampler = optionalNaiSampler(preset.sampler);
    if (presetSampler) sampler = presetSampler;
  }

  return { cfg_scale, cfg_rescale, steps: Math.min(steps, 28), scheduler, sampler };
}

/** @deprecated Use resolveGenerationCfgParams — vibe is no longer a select mode. */
export function resolveGenerationNaiParams(
  nai: Pick<NaiSettings, 'cfg_scale' | 'cfg_rescale' | 'vibe_transfer' | 'steps' | 'scheduler' | 'sampler'>,
  preset: Pick<StylePreset, 'cfg_scale' | 'cfg_rescale' | 'steps' | 'scheduler' | 'sampler'> | null | undefined,
): GenerationCfgParams & { vibe_transfer: string } {
  const cfg = resolveGenerationCfgParams(nai, preset);
  return { ...cfg, vibe_transfer: String(nai.vibe_transfer || 'none').toLowerCase() || 'none' };
}
