import { stepImageCount } from '../domain/image-count';

/**
 * 생성 옵션 › 생성 장수: − + beside the two numbers, one row (the floating viewer's 🔢). A press moves the number as the
 * chat's 🔢 would; the settings save it with the rest of the form, and a 🔢 pressed elsewhere writes into these same
 * inputs (omni-repairs.mjs), so the row always shows what is saved.
 */
export function bindCountSteppers(): void {
  const group = document.querySelector<HTMLElement>('.nx-count');
  if (!group || group.dataset.nxCountBound) return;
  group.dataset.nxCountBound = '1';
  group.addEventListener('click', event => {
    const step = (event.target as Element | null)?.closest<HTMLElement>('[data-nx-count]')?.dataset.nxCount || '';
    const min = document.getElementById('nx-min') as HTMLInputElement | null, max = document.getElementById('nx-max') as HTMLInputElement | null;
    const next = min && max ? stepImageCount(step, min.value, max.value) : null;
    if (!next || !min || !max) return;
    min.value = String(next.min); max.value = String(next.max);
    (step.startsWith('min') ? min : max).dispatchEvent(new Event('input', { bubbles: true }));
  });
}
