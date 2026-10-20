import { previewHelp, previewPanes } from './tab-html';

/**
 * 🔍 설정 검색, left of ? in the header. Typing lists the settings whose name,
 * group or help mentions the words; picking one opens its tab, scrolls to it and
 * makes it blink. "LLM한테 물어보기" sends the question with every setting as a
 * number and short name, plus the help of the few the local search ranked
 * highest; the reply's numbers become the same buttons.
 */

export interface SettingEntry { n: number; id: string; tab: string; tabLabel: string; title: string; group: string; body: string; hay: string }
interface AskReply { ok?: boolean; answer?: string; picks?: number[]; error?: { message?: string } }
interface Actions { request: (path: string, body?: Record<string, unknown>, timeout?: number) => Promise<AskReply> }

// The tabs whose markup is the settings themselves. TTS and sound pages are drawn
// by their own modules; explorer, changelog and debug hold no settings.
const TABS: ReadonlyArray<readonly [string, string]> = [
  ['dashboard', '대시보드'], ['gen_options', '생성 옵션'], ['comic_gen', '만화 생성'], ['style_presets', '스타일 프리셋'],
  ['characters', '캐릭터'], ['models', '모델 설정'], ['prompts', '프롬프트'],
];
const DETAILS = 10, SHOWN = 30, ASK_TIMEOUT_MS = 90_000;
const squash = (value: string) => value.toLowerCase().replace(/\s+/g, '');
const text = (node: Element | null | undefined) => (node?.textContent || '').replace(/\s+/g, ' ').trim();

let entries: SettingEntry[] | null = null;

function labelFor(control: Element, doc: Document): string {
  const id = control.id;
  const forLabel = id ? doc.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
  if (forLabel) return text(forLabel.querySelector('b') || forLabel);
  const row = control.closest('.row');
  const bold = row?.querySelector('b');
  if (bold) return text(bold);
  const field = control.closest('.block, .field');
  const span = field ? [...field.children].find(child => child.tagName === 'SPAN') : null;
  return text(span);
}

/** Every setting on the indexed tabs, numbered from 1, each named once per tab. */
export function settingEntries(): SettingEntry[] {
  if (entries) return entries;
  const out: SettingEntry[] = [], seen = new Set<string>();
  const panes = previewPanes();
  for (const [tab, tabLabel] of TABS) {
    const doc = new DOMParser().parseFromString(panes[tab] || '', 'text/html');
    for (const control of doc.querySelectorAll('input[id], select[id], textarea[id]')) {
      if (control instanceof HTMLInputElement && (control.type === 'hidden' || control.type === 'file')) continue;
      const help = previewHelp(control.id);
      const title = (help?.title || labelFor(control, doc)).slice(0, 40);
      if (!title || seen.has(tab + '\n' + title)) continue;
      seen.add(tab + '\n' + title);
      const group = text(control.closest('.group')?.querySelector('h3'));
      const muted = text(control.closest('.block, .field, .row')?.querySelector('.muted, small'));
      const body = (help?.body || muted).slice(0, 400);
      out.push({ n: out.length + 1, id: control.id, tab, tabLabel, title, group, body, hay: squash([title, group, tabLabel, body].join(' ')) });
    }
  }
  return entries = out;
}

/**
 * Ranked by where the words are: the name counts most, then group and tab, then
 * help. Two-letter pieces of each word also count a little, so a sentence such
 * as "스크롤이 튀어요" still finds 스크롤 붙잡기.
 */
export function searchSettings(query: string, list = settingEntries()): SettingEntry[] {
  const words = query.toLowerCase().split(/\s+/).map(squash).filter(Boolean);
  if (!words.length) return [];
  const whole = squash(query);
  const scored = list.map(entry => {
    const title = squash(entry.title), side = squash(entry.group + entry.tabLabel);
    let score = whole.length > 1 && title.includes(whole) ? 12 : 0;
    for (const word of words) {
      if (title.includes(word)) score += 6;
      else if (side.includes(word)) score += 3;
      else if (entry.hay.includes(word)) score += 2;
      else for (let i = 0; i + 2 <= word.length; i++) if (entry.hay.includes(word.slice(i, i + 2))) score += title.includes(word.slice(i, i + 2)) ? 1 : 0.4;
    }
    return { entry, score };
  });
  return scored.filter(row => row.score >= 1).sort((a, b) => b.score - a.score || a.entry.n - b.entry.n).map(row => row.entry);
}

/** What the LLM gets: all names by tab, help for the top few. Short names gain their group. */
export function settingsAskBody(question: string, list = settingEntries()): Record<string, unknown> {
  const name = (entry: SettingEntry) => entry.title.length <= 6 && entry.group ? `${entry.group} ${entry.title}` : entry.title;
  const tabs = TABS.map(([, label]) => ({ tab: label, items: list.filter(entry => entry.tabLabel === label).map(entry => ({ n: entry.n, title: name(entry) })) }))
    .filter(tab => tab.items.length);
  const details = searchSettings(question, list).filter(entry => entry.body).slice(0, DETAILS).map(entry => ({ n: entry.n, text: entry.body }));
  return { question, tabs, details };
}

async function waitFor(find: () => HTMLElement | null, ms = 3000): Promise<HTMLElement | null> {
  for (const end = Date.now() + ms; Date.now() < end;) {
    const node = find();
    if (node && node.getClientRects().length) return node;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  return null;
}

/** Opens the setting's tab, brings it to the middle of the window and makes it blink. */
export async function goToSetting(entry: SettingEntry): Promise<boolean> {
  const current = document.querySelector('#nx-tabs [data-nx-tab].active, #nx-tabs [data-nx-tab][aria-current="page"]')?.getAttribute('data-nx-tab');
  if (current !== entry.tab) document.querySelector<HTMLElement>(`#nx-tabs [data-nx-tab="${entry.tab}"]`)?.click();
  const node = await waitFor(() => document.querySelector<HTMLElement>(`#nx-main #${CSS.escape(entry.id)}`));
  if (!node) return false;
  const target = node.closest<HTMLElement>('.row, .block, .field, .toggle-row') || node;
  target.scrollIntoView({ block: 'center', behavior: 'smooth' });
  target.classList.remove('nx-found');
  void target.offsetWidth;
  target.classList.add('nx-found');
  setTimeout(() => target.classList.remove('nx-found'), 2600);
  return true;
}

const PANEL = `<div class="nx-search-bar"><input id="nx-search-input" type="search" autocomplete="off" placeholder="설정 검색 · 또는 궁금한 걸 문장으로">`
  + `<button type="button" class="icon-btn" id="nx-search-close" aria-label="검색 닫기">✕</button></div>`
  + `<div class="nx-search-ask"><button type="button" id="nx-search-ask">🤖 LLM한테 물어보기</button>`
  + `<small class="muted">메인 LLM 1회 · 관련 설정을 버튼으로 보여 줍니다</small></div>`
  + `<div class="nx-search-answer" id="nx-search-answer" hidden></div>`
  + `<div class="nx-search-list" id="nx-search-list" role="listbox"></div>`;

function hitButton(entry: SettingEntry): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'nx-search-hit';
  button.dataset.settingN = String(entry.n);
  const title = document.createElement('b'), where = document.createElement('small');
  title.textContent = entry.title;
  where.textContent = [entry.tabLabel, entry.group].filter(Boolean).join(' · ');
  button.append(title, where);
  return button;
}

export function bindSettingsSearch(): void {
  const toggle = document.getElementById('nx-search-toggle');
  const shell = document.getElementById('nx-shell');
  if (!toggle || !shell || toggle.dataset.nxSearch === '1') return;
  toggle.dataset.nxSearch = '1';
  let panel = document.getElementById('nx-search') as HTMLElement | null;
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'nx-search';
    panel.className = 'nx-search';
    panel.hidden = true;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', '설정 검색');
    panel.innerHTML = PANEL;
    shell.append(panel);
  }
  const input = panel.querySelector<HTMLInputElement>('#nx-search-input')!;
  const list = panel.querySelector<HTMLElement>('#nx-search-list')!;
  const answer = panel.querySelector<HTMLElement>('#nx-search-answer')!;
  const ask = panel.querySelector<HTMLButtonElement>('#nx-search-ask')!;
  const show = (on: boolean) => {
    panel!.hidden = !on;
    toggle.setAttribute('aria-expanded', on ? 'true' : 'false');
    if (on) { input.focus(); input.select(); }
  };
  const render = () => {
    const hits = searchSettings(input.value).slice(0, SHOWN);
    list.replaceChildren(...hits.map(hitButton));
    if (input.value.trim() && !hits.length) list.textContent = '맞는 설정이 없어요. 문장으로 적고 LLM한테 물어보세요.';
  };
  const pick = (event: Event) => {
    const n = Number((event.target as Element).closest<HTMLElement>('.nx-search-hit')?.dataset.settingN);
    const entry = settingEntries().find(row => row.n === n);
    if (!entry) return;
    show(false);
    void goToSetting(entry);
  };
  toggle.addEventListener('click', () => show(panel!.hidden));
  panel.querySelector('#nx-search-close')!.addEventListener('click', () => show(false));
  input.addEventListener('input', render);
  input.addEventListener('keydown', event => {
    if (event.key === 'Escape') show(false);
    if (event.key === 'Enter') panel!.querySelector<HTMLButtonElement>('.nx-search-hit')?.click();
  });
  list.addEventListener('click', pick);
  answer.addEventListener('click', pick);
  ask.addEventListener('click', async () => {
    const question = input.value.trim();
    answer.hidden = false;
    if (!question) { answer.textContent = '먼저 궁금한 걸 적어 주세요.'; return; }
    const actions = Reflect.get(globalThis, '__OMNI_SETTINGS_ACTIONS__') as Actions | undefined;
    if (!actions?.request) { answer.textContent = '설정창이 아직 준비되지 않았어요.'; return; }
    ask.disabled = true;
    answer.textContent = 'LLM한테 물어보는 중…';
    try {
      const reply = await actions.request('/v1/settings/ask', settingsAskBody(question), ASK_TIMEOUT_MS);
      if (!reply?.ok) throw new Error(reply?.error?.message || '답을 받지 못했어요.');
      const all = settingEntries();
      const picks = (reply.picks || []).map(n => all.find(entry => entry.n === n)).filter((entry): entry is SettingEntry => !!entry);
      const said = document.createElement('p');
      said.textContent = reply.answer || '관련 설정이에요.';
      answer.replaceChildren(said, ...picks.map(hitButton));
    } catch (error) {
      answer.textContent = String((error as Error)?.message || error);
    } finally {
      ask.disabled = false;
    }
  });
}
