import { guardrailSettings, normalizeGuardrailPreset } from '../domain/llm/guardrail-preset';
import { normalizeReverseBarMode } from '../config/schema';

export function bindGuardrailPreset(): void {
  const select = document.querySelector<HTMLSelectElement>('#nx-llm-guardrail-preset');
  const reverse = document.querySelector<HTMLSelectElement>('#nx-llm-reverse-bar');
  const tag = document.querySelector<HTMLInputElement>('#nx-llm-tag-cal');
  if (!select || !reverse || !tag || select.dataset.bound) return;
  select.dataset.bound = '1';
  const paint = () => {
    const preset = normalizeGuardrailPreset(select.value);
    if (preset !== 'auto') {
      const next = guardrailSettings(preset, '', normalizeReverseBarMode(reverse.value), tag.checked);
      reverse.value = next.mode;
      tag.checked = next.tagCal;
    }
    reverse.disabled = preset !== 'auto';
    tag.disabled = preset === 'deepseek' || preset === 'glm';
  };
  select.addEventListener('change', () => {
    paint();
    // The event continues to the existing coalesced settings-save handler.
  });
  paint();
}
