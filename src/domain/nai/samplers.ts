/** Recommended NovelAI samplers (Models tab). Unknown ids fall back to Euler Ancestral. */
import type { NaiSettings } from '../../core/types.ts';
import type { NaiFamily } from './routing.ts';

export const NAI_SAMPLER_DEFAULT = 'k_euler_ancestral';

export const NAI_SAMPLERS = [
  ['k_euler_ancestral', 'Euler Ancestral'],
  ['k_euler', 'Euler'],
  ['k_dpmpp_2s_ancestral', 'DPM++ 2S Ancestral'],
  ['k_dpmpp_2m_sde', 'DPM++ 2M SDE'],
  ['k_dpmpp_2m', 'DPM++ 2M'],
  ['k_dpmpp_sde', 'DPM++ SDE'],
] as const;

const NAI_SAMPLER_IDS = new Set<string>(NAI_SAMPLERS.map(([id]) => id));

export function normalizeNaiSampler(raw: unknown): string {
  return optionalNaiSampler(raw) || NAI_SAMPLER_DEFAULT;
}

/** Empty / unknown → null so a style preset can mean "use the Models tab". */
export function optionalNaiSampler(raw: unknown): string | null {
  const id = String(raw || '').trim();
  return NAI_SAMPLER_IDS.has(id) ? id : null;
}

export function naiSamplerForFamily(
  nai: Record<string, unknown> | Pick<NaiSettings, 'sampler'> | null | undefined,
  family: NaiFamily,
): string {
  const row = (nai || {}) as Record<string, unknown>;
  const key = family === 'v5' ? 'sampler_v5' : 'sampler_v4';
  return normalizeNaiSampler(row[key] || row.sampler);
}

export function naiStepsForFamily(
  nai: Record<string, unknown> | Pick<NaiSettings, 'steps'> | null | undefined,
  family: NaiFamily,
): number {
  const row = (nai || {}) as Record<string, unknown>;
  const key = family === 'v5' ? 'steps_v5' : 'steps_v4';
  const n = Number(row[key] ?? row.steps ?? 28);
  if (!Number.isFinite(n) || n < 1) return 28;
  return Math.min(150, Math.floor(n));
}
