import type { ReverseBarMode } from '../../core/types';

export type GuardrailPreset = 'auto' | 'gemini' | 'deepseek' | 'glm';
export function normalizeGuardrailPreset(value: unknown): GuardrailPreset {
  return value === 'gemini' || value === 'deepseek' || value === 'glm' ? value : 'auto';
}

/** Unknown models keep the user's settings; never guess a provider from an endpoint. */
export function guardrailSettings(preset: unknown, model: string, reverseBar: ReverseBarMode, tagCal: boolean): { mode: ReverseBarMode; tagCal: boolean } {
  const pick = normalizeGuardrailPreset(preset);
  const family = pick === 'auto'
    ? (/gemini/i.test(model) ? 'gemini' : /deepseek/i.test(model) ? 'deepseek' : /glm/i.test(model) ? 'glm' : '')
    : pick;
  if (family === 'gemini') return { mode: 'memo', tagCal };
  if (family === 'deepseek') return { mode: 'off', tagCal: false };
  if (family === 'glm') return { mode: 'authority', tagCal: false };
  return { mode: reverseBar, tagCal };
}
