type Actions = { save: (patch: { nai: { effort_v5: string } }) => Promise<unknown> };

/**
 * 생성 옵션 › Effort: the same `nai.effort_v5` as 모델 설정. It saves by itself because 생성 옵션's own save writes only
 * the card; 모델 설정 paints the saved value when opened, so the two cannot disagree.
 */
export function bindGenEffort(): void {
  const select = document.querySelector<HTMLSelectElement>('#nx-gen-effort-v5');
  if (!select || select.dataset.nxEffortBound) return;
  select.dataset.nxEffortBound = '1';
  let saved = select.value;
  select.addEventListener('change', () => {
    const actions = Reflect.get(globalThis, '__OMNI_SETTINGS_ACTIONS__') as Actions | undefined;
    const next = select.value === 'medium' ? 'medium' : 'high';
    // A failed save goes back to the old value: the box must not show what was not saved.
    void actions?.save({ nai: { effort_v5: next } }).then(() => { saved = next; }, () => { select.value = saved; });
  });
}
