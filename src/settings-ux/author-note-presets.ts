import type { AuthorNotePreset } from '../domain/tagging/author-note-presets';

interface Actions { request: (path: string, body?: Record<string, unknown>) => Promise<{ ok?: boolean; items?: AuthorNotePreset[] }> }

const ROUTE = '/v1/author-note-presets';
const same = (a: string, b: string) => a.replace(/\r\n/g, '\n').trim() === b.replace(/\r\n/g, '\n').trim();

/** 고르기 · 저장 · 삭제 over the main tagger's author's note, in the prompts tab. */
export function bindAuthorNotePresets(): void {
  const root = document.getElementById('nx-author-note-presets');
  const note = document.getElementById('nx-prompt-author_note') as HTMLTextAreaElement | null;
  const actions = Reflect.get(globalThis, '__OMNI_SETTINGS_ACTIONS__') as Actions | undefined;
  if (!root || !note || root.dataset.bound || !actions?.request) return;
  root.dataset.bound = '1';
  const select = root.querySelector<HTMLSelectElement>('#nx-anp-select')!;
  const name = root.querySelector<HTMLInputElement>('#nx-anp-name')!;
  const save = root.querySelector<HTMLButtonElement>('#nx-anp-save')!;
  const remove = root.querySelector<HTMLButtonElement>('#nx-anp-delete')!;
  const status = document.getElementById('nx-anp-status');
  let rows: AuthorNotePreset[] = [], busy = false;
  const current = () => rows.find(row => row.id === select.value);
  const report = (text: string) => { if (status) { status.textContent = text; status.hidden = !text; } };
  // The settings collector listens on the shell; picking a preset is not a settings edit.
  for (const type of ['input', 'change']) root.addEventListener(type, event => event.stopPropagation());
  const paint = () => {
    const row = current();
    for (const node of [select, name, save]) node.disabled = busy;
    remove.disabled = busy || !row || !!row.builtin;
    if (row && !same(note.value, row.text)) report(row.builtin ? '예제를 고친 상태 · 이름을 적고 저장하면 내 프리셋이 됩니다.' : '고친 상태 · 저장하면 이 프리셋에 덮어씁니다.');
    else report('');
  };
  const render = (preferred: string) => {
    select.replaceChildren(new Option('프리셋 선택', ''));
    for (const [label, builtin] of [['내 프리셋', false], ['예제', true]] as const) {
      const group = document.createElement('optgroup'); group.label = label;
      for (const row of rows.filter(item => !!item.builtin === builtin)) group.append(new Option(row.name, row.id));
      if (group.childElementCount) select.append(group);
    }
    // With nothing preferred, show whichever preset the note already is.
    select.value = rows.find(row => row.id === preferred)?.id || rows.find(row => same(note.value, row.text))?.id || '';
    name.value = current()?.builtin ? '' : current()?.name || '';
    paint();
  };
  const write = (text: string) => {
    note.value = text;
    // The prompt writer listens for input on the shell; this is what persists it.
    note.dispatchEvent(new Event('input', { bubbles: true }));
  };
  // The message is shown after the repaint, which would otherwise clear it.
  const run = async (failure: string, work: () => Promise<string | void>) => {
    if (busy) return;
    busy = true; paint();
    let message = '';
    try { message = await work() || ''; } catch (error) { message = failure + ' · ' + String((error as Error)?.message || error); }
    busy = false; paint();
    if (message) report(message);
  };
  const store = async (next: AuthorNotePreset[], preferred: string) => {
    const result = await actions.request(ROUTE, { items: next.filter(row => !row.builtin).map(({ id, name, text }) => ({ id, name, text })) });
    if (result?.ok === false || !Array.isArray(result?.items)) throw new Error('저장 요청 실패');
    rows = result.items; render(preferred);
  };

  select.addEventListener('change', () => {
    const row = current();
    if (!row) { name.value = ''; paint(); return; }
    const kept = !note.value.trim() || same(note.value, row.text) || rows.some(item => same(note.value, item.text));
    if (!kept && !window.confirm('지금 노트는 프리셋에 저장되어 있지 않아요. 바꾸면 사라집니다. 바꿀까요?')) {
      select.value = rows.find(item => same(note.value, item.text))?.id || ''; paint(); return;
    }
    write(row.text);
    name.value = row.builtin ? '' : row.name;
    paint();
  });
  note.addEventListener('input', paint);
  name.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); save.click(); } });
  save.addEventListener('click', () => {
    const label = name.value.replace(/\s+/g, ' ').trim();
    if (!label) { report('프리셋 이름을 입력하세요.'); name.focus(); return; }
    void run('프리셋 저장 실패', async () => {
      const latest = await actions.request(ROUTE);
      const saved = (latest?.items || []).filter(row => !row.builtin);
      const picked = current();
      // A saved preset is overwritten in place; an example or a fresh note becomes a new one.
      const id = picked && !picked.builtin ? picked.id : globalThis.crypto?.randomUUID?.() || `note-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const row = { id, name: label, text: note.value };
      const next = saved.some(item => item.id === id) ? saved.map(item => item.id === id ? row : item) : [...saved, row];
      await store(next, id);
      return '저장됨';
    });
  });
  remove.addEventListener('click', () => {
    const picked = current();
    if (!picked || picked.builtin || !window.confirm(`「${picked.name}」 프리셋을 삭제할까요? 지금 노트 내용은 그대로 둡니다.`)) return;
    void run('프리셋 삭제 실패', async () => {
      const latest = await actions.request(ROUTE);
      await store((latest?.items || []).filter(row => !row.builtin && row.id !== picked.id), '');
      return '삭제됨';
    });
  });
  void run('프리셋 목록을 불러오지 못했습니다', async () => {
    const result = await actions.request(ROUTE);
    rows = result?.items || [];
    render('');
  });
}
