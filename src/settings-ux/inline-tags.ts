/**
 * 생성 옵션 → "Risu 메인 모델 메시지 스트리밍 중에 태그 생성". While it is on,
 * stream keywords and line batches are not used, so their switches are greyed
 * (their saved values stay); "이미지 바로 생성" only means something under it.
 */
const STREAM_IDS = ['nx-stream-keywords-on', 'nx-stream-keywords', 'nx-stream-lines-on', 'nx-stream-lines-count', 'nx-stream-lines-image-min', 'nx-stream-lines-image-max'];
const NOTE_ID = 'nx-stream-inline-note';

type Status = { registered: 'yes' | 'no' | 'pending'; lastAt: number; last: string };
/** Whether Risu called the request hook, and with what result: shown while the switch is on. */
export function inlineTagStatusText(status: Status | undefined): string {
  if (!status) return '';
  if (status.registered === 'no') return '요청 연결: 이 Risu에서는 쓸 수 없습니다.';
  if (status.registered === 'pending') return '요청 연결 중…';
  if (!status.lastAt) return '요청 연결됨 · 아직 메인 모델 요청이 없습니다. 메시지를 보낸 뒤에도 그대로면 Risu가 이 플러그인의 replacer 권한을 막은 것입니다.';
  const at = new Date(status.lastAt).toLocaleTimeString('ko-KR', { hour12: false });
  const what = status.last.startsWith('inserted') ? '규칙을 넣었습니다'
    : status.last.startsWith('off · power') ? 'Omni 전원(Power)이 꺼져 있어 넣지 않았습니다'
    : status.last.startsWith('off') ? `이 토글이 꺼진 것으로 읽혔습니다 (${status.last.replace(/^off · switch /, '')}) · 켠 직후 보낸 요청이면 한 번 더 보내 보세요`
    : status.last.startsWith('already') ? '이미 들어 있었습니다'
    : `건너뜀 (${status.last.replace(/^skipped · /, '')})`;
  return `마지막 메인 모델 요청 ${at} · ${what}`;
}

export function bindInlineTagToggles(): void {
  const on = document.querySelector<HTMLInputElement>('#nx-stream-inline-on');
  if (!on || on.dataset.nxInline) return;
  on.dataset.nxInline = '1';
  const status = document.createElement('small');
  status.id = 'nx-stream-inline-status';
  on.closest('[data-nx-help-id="nx-stream-inline"]')?.append(status);
  const paintStatus = () => {
    const read = (Reflect.get(globalThis, '__OMNI_INLINE_TAGS__') as { status?: () => Status } | undefined)?.status;
    status.textContent = on.checked ? inlineTagStatusText(read?.()) : '';
    status.hidden = !status.textContent;
  };
  // Live while the tab is open: the next chat request updates the line by itself.
  const timer = setInterval(() => { if (!status.isConnected) clearInterval(timer); else paintStatus(); }, 1500);
  on.addEventListener('change', paintStatus);
  paintStatus();
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
