import type { AuthorNotePreset } from '../domain/tagging/author-note-presets';

interface Listing { ok?: boolean; items?: AuthorNotePreset[]; custom?: string; selected?: string }
interface Actions { request: (path: string, body?: Record<string, unknown>) => Promise<Listing> }

const ROUTE = '/v1/author-note-presets';
const CUSTOM = 'custom';
const same = (a: string, b: string) => a.replace(/\r\n/g, '\n').trim() === b.replace(/\r\n/g, '\n').trim();

/**
 * 직접 입력 · 내 프리셋 · 예제 over the main tagger's author's note, in the prompts tab.
 * 직접 입력 is the user's own note, kept on its own: picking a preset only shows that
 * text in the note, and picking 직접 입력 again brings the writing back as it was.
 * Typing while 직접 입력 is picked is what changes it.
 */
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
  let rows: AuthorNotePreset[] = [], custom = '', loaded = false, busy = false, writing = false, timer = 0;
  const current = () => rows.find(row => row.id === select.value);
  const report = (text: string) => { if (status) { status.textContent = text; status.hidden = !text; } };
  // The settings collector listens on the shell; picking a preset is not a settings edit.
  for (const type of ['input', 'change']) root.addEventListener(type, event => event.stopPropagation());
  const paint = () => {
    const row = current();
    for (const node of [select, name, save]) node.disabled = busy || !loaded;
    remove.disabled = busy || !row || !!row.builtin;
    if (row && !same(note.value, row.text)) report('고친 상태 · 이름을 적고 저장하면 내 프리셋으로 저장돼요. 직접 입력은 그대로예요.');
    else report('');
  };
  const render = (selected: string) => {
    select.replaceChildren(new Option('직접 입력', CUSTOM));
    for (const [label, builtin] of [['내 프리셋', false], ['예제', true]] as const) {
      const group = document.createElement('optgroup'); group.label = label;
      for (const row of rows.filter(item => !!item.builtin === builtin)) group.append(new Option(row.name, row.id));
      if (group.childElementCount) select.append(group);
    }
    select.value = rows.some(row => row.id === selected) ? selected : CUSTOM;
    name.value = current() && !current()!.builtin ? current()!.name : '';
    paint();
  };
  const write = (text: string) => {
    writing = true;
    try {
      note.value = text;
      // The prompt writer listens for input on the shell; this is what persists it.
      note.dispatchEvent(new Event('input', { bubbles: true }));
    } finally { writing = false; }
  };
  const send = (body: Record<string, unknown>) => actions.request(ROUTE, body).then(result => {
    if (result?.ok === false) throw new Error('저장 요청 실패');
    return result;
  });
  const flushCustom = () => {
    if (!timer) return Promise.resolve();
    clearTimeout(timer); timer = 0;
    return send({ custom }).then(() => undefined);
  };
  const run = async (failure: string, work: () => Promise<string | void>) => {
    if (busy) return;
    busy = true; paint();
    let message = '';
    try { message = await work() || ''; } catch (error) { message = failure + ' · ' + String((error as Error)?.message || error); }
    busy = false; paint();
    if (message) report(message);
  };

  select.addEventListener('change', () => {
    const picked = select.value;
    const row = current();
    write(row ? row.text : custom);
    name.value = row && !row.builtin ? row.name : '';
    paint();
    void flushCustom().then(() => send({ selected: picked })).catch(error => report('선택 저장 실패 · ' + String((error as Error)?.message || error)));
  });
  note.addEventListener('input', () => {
    if (writing) return;
    // Only 직접 입력 follows the typing; an edited preset stays a preset until saved by name.
    if (select.value === CUSTOM && loaded) {
      custom = note.value;
      clearTimeout(timer);
      timer = window.setTimeout(() => { timer = 0; void send({ custom }).catch(error => report('직접 입력 저장 실패 · ' + String((error as Error)?.message || error))); }, 800);
    }
    paint();
  });
  name.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); save.click(); } });
  save.addEventListener('click', () => {
    const label = name.value.replace(/\s+/g, ' ').trim();
    if (!label) { report('프리셋 이름을 입력하세요.'); name.focus(); return; }
    void run('프리셋 저장 실패', async () => {
      const latest = await actions.request(ROUTE);
      const saved = (latest?.items || []).filter(row => !row.builtin);
      // The same name overwrites that preset; a new name makes a new one. 직접 입력 is left alone.
      const existing = saved.find(row => row.name === label);
      const id = existing?.id || globalThis.crypto?.randomUUID?.() || `note-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const row = { id, name: label, text: note.value };
      const next = existing ? saved.map(item => item.id === id ? row : item) : [...saved, row];
      await flushCustom();
      const result = await send({ items: next.map(({ id, name, text }) => ({ id, name, text })), selected: id });
      rows = result.items || []; render(id);
      return existing ? `「${label}」에 덮어썼어요.` : `「${label}」로 저장했어요.`;
    });
  });
  remove.addEventListener('click', () => {
    const picked = current();
    if (!picked || picked.builtin || !window.confirm(`「${picked.name}」 프리셋을 삭제할까요? 직접 입력은 그대로이고, 노트는 직접 입력으로 돌아갑니다.`)) return;
    void run('프리셋 삭제 실패', async () => {
      const latest = await actions.request(ROUTE);
      const result = await send({ items: (latest?.items || []).filter(row => !row.builtin && row.id !== picked.id).map(({ id, name, text }) => ({ id, name, text })), selected: CUSTOM });
      // The deleted one was on screen: 직접 입력 comes back in its place.
      rows = result.items || []; render(CUSTOM); write(custom);
      return '삭제됨';
    });
  });
  void run('프리셋 목록을 불러오지 못했습니다', async () => {
    const result = await actions.request(ROUTE);
    rows = result?.items || [];
    custom = typeof result?.custom === 'string' ? result.custom : '';
    loaded = true;
    render(String(result?.selected || CUSTOM));
  });
}
