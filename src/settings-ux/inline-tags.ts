/**
 * 생성 옵션 → "Risu 메인 모델 메시지 스트리밍 중에 태그 생성". While it is on,
 * stream keywords and line batches are not used, so their switches are greyed
 * (their saved values stay); "이미지 바로 생성" only means something under it.
 */
const STREAM_IDS = ['nx-stream-keywords-on', 'nx-stream-keywords', 'nx-stream-lines-on', 'nx-stream-lines-count', 'nx-stream-lines-image-min', 'nx-stream-lines-image-max'];
const NOTE_ID = 'nx-stream-inline-note';

export function bindInlineTagToggles(): void {
  const on = document.querySelector<HTMLInputElement>('#nx-stream-inline-on');
  if (!on || on.dataset.nxInline) return;
  on.dataset.nxInline = '1';
  const sync = () => {
    for (const id of STREAM_IDS) {
      const field = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | null;
      if (field) field.disabled = on.checked;
    }
    const auto = document.querySelector<HTMLInputElement>('#nx-stream-inline-autogen');
    if (auto) auto.disabled = !on.checked;
    let note = document.getElementById(NOTE_ID);
    if (on.checked && !note) {
      note = document.createElement('small');
      note.id = NOTE_ID;
      note.textContent = '켜져 있는 동안 스트리밍 키워드·줄 단위 선행생성은 쓰지 않습니다.';
      on.closest('[data-nx-help-id="nx-stream-inline"]')?.append(note);
    }
    if (note) note.hidden = !on.checked;
  };
  on.addEventListener('change', sync);
  sync();
}

/** 대시보드: with streaming tags on, "응답 후 자동 생성" only covers replies without blocks. */
export function markAutoGenForInlineTags(inline: boolean): void {
  const row = document.querySelector('#nx-auto-gen-reply')?.closest('.row');
  if (!row) return;
  let note = row.parentElement?.querySelector<HTMLElement>('[data-nx-inline-autogen-note]');
  if (inline && !note) {
    note = document.createElement('small');
    note.dataset.nxInlineAutogenNote = '1';
    note.textContent = '스트리밍 태그 생성 중: 블록이 없는 답장에만 씁니다.';
    row.after(note);
  }
  if (note) note.hidden = !inline;
}
