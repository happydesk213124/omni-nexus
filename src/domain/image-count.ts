export type ImageCountStep = 'min-down' | 'min-up' | 'max-down' | 'max-up';
export const IMAGE_COUNT_STEPS: readonly ImageCountStep[] = ['min-down', 'min-up', 'max-down', 'max-up'];

/**
 * 생성 장수 a step, by the rule the chat's 🔢 keeps (tools/vendor-patches/message-runtime.js, omniWriteCount): at least
 * one, the least never above the most. null when the step goes nowhere, so nothing is written.
 */
export function stepImageCount(step: string, min: unknown, max: unknown): { min: number; max: number } | null {
  const low = Math.max(1, Math.floor(Number(min)) || 1), high = Math.max(low, Math.floor(Number(max)) || low);
  const next = { min: low, max: high };
  if (step === 'min-down') next.min = low - 1;
  else if (step === 'min-up') next.min = low + 1;
  else if (step === 'max-down') next.max = high - 1;
  else if (step === 'max-up') next.max = high + 1;
  else return null;
  return next.min < 1 || next.min > next.max ? null : next;
}
