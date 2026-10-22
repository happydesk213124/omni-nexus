import { exampleShotActions } from '../char-command/example-shot';
import { uuid } from '../core/util/text';
import { openRosterCommand, type RosterCommandActions } from './roster-command';
import { bindCharacterPaste, selectPasteCharacter } from './character-paste';
import type { CharacterRecord } from '../core/types';
import { mutateCharacterRoster } from '../storage/character-roster';
import { pickCharacterAsset } from './asset-picker';
import { bindCostumeEditor } from './costume-editor';
import { loadCharacterPreviews } from './character-preview-loading';
import { connectCharacterImages, paintReferenceProgress, syncCharacterTilePreviews } from './reference-progress';
import { listCharacters, upsertCharacter, deleteCharacter } from '../services/characters';
import { resetCharacterPreviewIndex, registerCharacterPreview, unregisterCharacterPreview, characterCardForTile } from './character-preview-index';
type Field = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
const isField = (element: Element): element is Field => element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement;
let selectedId = '';
let selectedScope = 'session';

/** Keep vendor cards intact so oe(), costume handlers and unified saves retain their context. */
export function bindCharacterSheet(): void {
  const sheet = document.getElementById('nx-char-edit-body');
  const bar = document.getElementById('nx-char-scope-bar');
  if (!sheet || !bar || sheet.dataset.nxBound) return;
  sheet.dataset.nxBound = '1';
  resetCharacterPreviewIndex();
  const previews = loadCharacterPreviews(sheet);
  bindCharacterPaste();
  // oe(scope) treats EVERY data-char-scope node as a record, including navigation buttons.
  bar.querySelectorAll<HTMLElement>('[data-char-scope]').forEach(button => {
    button.dataset.uxScope = button.getAttribute('data-char-scope') || '';
    button.removeAttribute('data-char-scope');
  });
  document.getElementById('nx-char-from-asset')?.addEventListener('click',()=>{if(current)void pickCharacterAsset(current).catch(error=>window.alert(String(error)));});
  const assetButton = document.getElementById('nx-char-from-asset');
  if (assetButton && !document.getElementById('nx-char-from-module')) {
    const moduleButton = document.createElement('button'); moduleButton.type = 'button';
    moduleButton.id = 'nx-char-from-module'; moduleButton.className = assetButton.className; moduleButton.textContent = '모듈에서';
    moduleButton.onclick = () => { if (current) void pickCharacterAsset(current, 'module').catch(error => window.alert(String(error))); };
    assetButton.after(moduleButton);
    if (assetButton.parentElement) { assetButton.parentElement.style.flexWrap = 'wrap'; assetButton.parentElement.style.minWidth = '0'; }
  }
  for (const field of sheet.querySelectorAll<HTMLElement>('[data-char-priority]')) field.closest('label')?.setAttribute('hidden','');
  for (const field of sheet.querySelectorAll<HTMLElement>('[data-char-eye-color]')) {
    const label = field.closest('label')?.querySelector('span'); if (label) label.textContent = '눈색·눈 형태';
  }
  let cards = [...document.querySelectorAll<HTMLElement>('.char-card[data-char-id]')];
  cards.forEach(bindCostumeEditor);
  sheet.querySelector<HTMLInputElement>('[data-char-age]')?.setAttribute('type', 'text');
  const penis = sheet.querySelector<HTMLSelectElement>('[data-char-penis-size]');
  if (penis && ![...penis.options].some(o => o.value === '[base]')) penis.add(new Option('[base]', '[base]'));
  let current: HTMLElement | undefined;
  // Filled in below, once tiles and deletion exist; tile clicks only read it.
  const selection = { on: false, toggle: (_card: HTMLElement, _tile: HTMLElement) => {}, clear: () => {} };
  const mirrors =[...sheet.querySelectorAll<HTMLElement>('*')].flatMap(element => {
    const attr = element.getAttributeNames().find(name => name.startsWith('data-char-'));
    return attr ? [{ element, selector: `[${attr}]` }] : [];
  });
  const refresh = () => {
    for (const { element, selector } of mirrors) {
      const source = current?.querySelector<HTMLElement>(selector);
      if (isField(element)) {
        element.disabled = !source;
        element.value = source && isField(source) ? source.value : '';
        if (element instanceof HTMLSelectElement && source instanceof HTMLSelectElement) {
          if (element.innerHTML !== source.innerHTML) element.innerHTML = source.innerHTML;
          element.value = source.value;
        }
        if (element instanceof HTMLInputElement && element.type === 'checkbox') element.checked = source instanceof HTMLInputElement && source.checked;
      } else if (element instanceof HTMLButtonElement) element.disabled = !source;
      else if (element.innerHTML !== (source?.innerHTML || '')) element.innerHTML = source?.innerHTML || '';
    }
    const name = current?.querySelector<HTMLInputElement>('[data-char-name]')?.value || '캐릭터 없음';
    for (const id of ['nx-char-current', 'nx-char-edit-title']) {
      const el = document.getElementById(id);
      if (el) el.textContent = name;
    }
    const warning = document.getElementById('nx-char-edit-empty');
    if (warning) warning.hidden = !!current?.querySelector<HTMLTextAreaElement>('[data-char-appearance]')?.value.trim();
  };
  for (const { element, selector } of mirrors) {
    for (const type of isField(element) ? ['input', 'change'] : ['click', 'dblclick']) {
      element.addEventListener(type, event => {
        event.stopImmediatePropagation();
        if (event instanceof InputEvent && event.isComposing) return;
        const source = current?.querySelector<HTMLElement>(selector);
        if (!source) return;
        if (selector === '[data-char-delete]') { void removeCharacters(current ? [current] : []); return; }
        if (isField(element) && isField(source)) {
          source.value = element.value;
          if (source instanceof HTMLInputElement && element instanceof HTMLInputElement) source.checked = element.checked;
        }
        source.dispatchEvent(type === 'click' || type === 'dblclick'
          ? new MouseEvent(type, { bubbles: true, cancelable: true }) : new Event(type, { bubbles: true }));
        // Costume selection updates other fields synchronously in the vendor handler.
        if (type === 'change' || type === 'click') refresh();
        if (selector === '[data-char-autotag]') {
          const status = sheet.querySelector<HTMLElement>('[data-autotag-status]');
          if (status) { status.textContent = '이미지 붙여넣기 대기 중'; status.style.cssText = 'padding:8px;border:1px solid #7132f5;border-radius:12px;color:var(--text)'; }
        }
      }, true);
    }
    if(isField(element)){
      element.addEventListener('compositionend',()=>element.dispatchEvent(new Event('input',{bubbles:true})));
    }
    if (element.matches('[data-char-costume-slot-save]')) element.hidden = true;
  }
  const choose = (card: HTMLElement | undefined) => {
    current = card;
    if (card) previews.request(card);
    selectPasteCharacter(card);
    sheet.dataset.selectedId = card?.dataset.charId || '';
    selectedId = card?.dataset.charId || '';
    document.querySelectorAll<HTMLElement>('[data-ux-character-tile]').forEach(tile => {
      const on = tile.dataset.uxCharacterTile === selectedId && tile.dataset.uxCharacterScope === selectedScope;
      tile.classList.toggle('on', on);
      tile.setAttribute('aria-pressed', String(on));
    });
    refresh();
  };
  const selectScope = (scope: string) => {
    if (scope !== selectedScope) selection.clear();
    selectedScope = scope;
    bar.dataset.uxSelectedScope = scope;
    bar.querySelectorAll<HTMLElement>('[data-ux-scope]').forEach(button => button.classList.toggle('on', button.dataset.uxScope === scope));
    for (const kind of ['session', 'global']) {
      const list = document.getElementById(`nx-char-${kind}-list`);
      if (list) list.hidden = kind !== scope;
      for (const id of [`nx-char-add-${kind}`, `nx-export-${kind}-chars`, `nx-import-${kind}-chars`]) {
        const el = document.getElementById(id);
        if (el) el.hidden = kind !== scope;
      }
    }
    const move = document.getElementById('nx-char-to-global');
    if (move) move.hidden = scope !== 'session';
    choose(cards.find(card => card.dataset.charScope === scope && card.dataset.charId === selectedId)
      || cards.find(card => card.dataset.charScope === scope));
    document.getElementById('nx-char-search')?.dispatchEvent(new Event('input', { bubbles: true }));
    bar.dispatchEvent(new Event('omni-roster-scope'));
  };
  const registerCard = (card: HTMLElement) => {
    bindCostumeEditor(card);
    const observer = new MutationObserver(() => { if (current === card) refresh(); });
    const status = card.querySelector('[data-autotag-status]');
    if (status) observer.observe(status, {childList:true,characterData:true,subtree:true});
    const changed=()=>{if(current===card)refresh(); paintName(); syncCharacterTilePreviews(card);};
    card.addEventListener('omni-autotag',changed);
    card.addEventListener('omni-character-refresh',changed);
    card.hidden = true;
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'preset-tile';
    tile.dataset.uxCharacterTile = card.dataset.charId || '';
    tile.dataset.uxCharacterScope = card.dataset.charScope || '';
    const label=document.createElement('span');label.dataset.characterLabel='1';
    tile.append(label);
    const nameField = card.querySelector<HTMLInputElement>('[data-char-name]');
    const paintName = () => {
      const name = nameField?.value || '(이름 없음)';
      label.textContent = name;
      tile.title = name;
      tile.setAttribute('aria-label', name);
      if (current === card) {
        for (const id of ['nx-char-current', 'nx-char-edit-title']) {
          const title = document.getElementById(id);
          if (title) title.textContent = name;
        }
      }
    };
    nameField?.addEventListener('input', paintName);
    nameField?.addEventListener('change', paintName);
    paintName();
    tile.addEventListener('click', () => {
      // Selection mode: a tap picks or unpicks, it never opens the editor.
      if (selection.on) { selection.toggle(card, tile); return; }
      const again = current === card;
      choose(card);
      if (again && !document.getElementById('nx-char-sheet')?.classList.contains('open')) document.getElementById('nx-char-edit-btn')?.click();
    });
    card.before(tile);
    registerCharacterPreview(card, tile);
    previews.request(card);
  };
  cards.forEach(registerCard);
  syncCharacterTilePreviews();
  bar.addEventListener('click', event => {
    const button = (event.target as Element).closest<HTMLElement>('[data-ux-scope]');
    if (button) selectScope(button.dataset.uxScope || 'session');
  });
  for (const [id, selector] of Object.entries({
    'nx-char-del': '[data-char-delete]',
    'nx-char-look-act': '[data-char-ex-upload]', 'nx-char-look-gen': '[data-char-ex-gen]',
    'nx-char-head-look-gen': '[data-char-ex-gen]', 'nx-char-look-vibe': '[data-char-ex-vibe]',
  })) document.getElementById(id)?.addEventListener('click', event => {
    event.stopImmediatePropagation();
    if (selector === '[data-char-delete]') void removeCharacters(current ? [current] : []);
    else current?.querySelector<HTMLElement>(selector)?.click();
  }, true);
  document.getElementById('nx-char-dup')?.addEventListener('click', () => {
    if (!current) return;
    const copy = current.cloneNode(true) as HTMLElement;
    copy.dataset.charId = `new_${uuid()}`;
    copy.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
    const sourceFields = [...current.querySelectorAll('input,textarea,select')].filter(isField);
    [...copy.querySelectorAll('input,textarea,select')].filter(isField).forEach((field, i) => {
      field.value = sourceFields[i].value;
      if (field instanceof HTMLInputElement && sourceFields[i] instanceof HTMLInputElement) field.checked = sourceFields[i].checked;
    });
    const name = copy.querySelector<HTMLInputElement>('[data-char-name]');
    if (name) name.value += ' 복사';
    current.after(copy);
    selectedId = copy.dataset.charId;
    document.getElementById(selectedScope === 'global' ? 'nx-save-global-chars' : 'nx-save-chars')?.click();
  });
  for (const kind of ['session', 'global']) {
    document.getElementById(`nx-char-add-${kind}`)?.addEventListener('click', event => {
      event.preventDefault(); event.stopImmediatePropagation();
      const bridge = globalThis as typeof globalThis & {
        __OMNI_QUEUE_CHARACTER_WRITE__?: (work: () => Promise<unknown>) => Promise<unknown>;
        __OMNI_BIND_NEW_CHARACTER_CARD__?: (card: HTMLElement) => void;
        __OMNI_RENDER_CHARACTER_CARD__?: (row: Record<string, unknown>, scope: string) => string;
        __OMNI_CHARACTER_SCOPE__?: () => string;
        __OMNI_RESTORE_CHARACTER_CACHE__?: (scope: string, rows: CharacterRecord[], target: string) => void;
      };
      const target = kind === 'global' ? '__global__' : bridge.__OMNI_CHARACTER_SCOPE__?.() || '';
      if (!target || !bridge.__OMNI_RENDER_CHARACTER_CARD__) return;
      const names = new Set(cards.map(c => c.querySelector<HTMLInputElement>('[data-char-name]')?.value));
      let nameIndex = 1;
      while (names.has(nameIndex === 1 ? 'New Character' : `New Character ${nameIndex}`)) nameIndex++;
      const row = { id: `new_${uuid()}`, name: nameIndex === 1 ? 'New Character' : `New Character ${nameIndex}`, aliases: [], appearance: '', attire: '', bottoms: '', accessories: '' };
      const template = document.createElement('template'); template.innerHTML = bridge.__OMNI_RENDER_CHARACTER_CARD__(row, kind);
      const card = template.content.querySelector<HTMLElement>('.char-card[data-char-id]');
      const list = document.getElementById(`nx-char-${kind}-list`);
      if (!card || !list) return;
      card.dataset.charRefScope = target;
      list.append(card); cards.push(card); registerCard(card);
      bridge.__OMNI_BIND_NEW_CHARACTER_CARD__?.(card);
      bridge.__OMNI_RESTORE_CHARACTER_CACHE__?.(kind, [row as unknown as CharacterRecord], target);
      selectScope(kind); choose(card);
      if (!document.getElementById('nx-char-sheet')?.classList.contains('open')) document.getElementById('nx-char-edit-btn')?.click();
      const name = sheet.querySelector<HTMLInputElement>('[data-char-name]'); name?.focus(); name?.select();
      const state = document.createElement('button'); state.type = 'button'; state.className = 'btn-ghost';
      state.textContent = '저장 중'; state.hidden = true;
      const tile = card.previousElementSibling; tile?.after(state);
      const persist = async () => {
        state.disabled = true;
        try {
          // Save only this record. Do not replace the UI with a stale response.
          const write = () => upsertCharacter(target, { id: row.id, name: card.querySelector<HTMLInputElement>('[data-char-name]')?.value || row.name });
          if (bridge.__OMNI_QUEUE_CHARACTER_WRITE__) await bridge.__OMNI_QUEUE_CHARACTER_WRITE__(write);
          else await write();
          state.remove();
        } catch (error) {
          state.hidden = false; state.textContent = '저장 실패 · 재시도'; state.title = String(error);
        } finally { state.disabled = false; }
      };
      state.onclick = () => { void persist(); }; void persist();
      document.getElementById('nx-char-search')?.dispatchEvent(new Event('input', {bubbles:true}));
    }, true);
  }
  const deleting = new Set<HTMLElement>();
  const removeCharacters = async (targets: HTMLElement[]) => {
    targets=targets.filter(card=>!deleting.has(card));
    if (!targets.length) return;
    const scope = targets[0]!.dataset.charScope || selectedScope;
    const scoped = cards.filter(card => card.dataset.charScope === scope);
    const index = Math.max(0, scoped.indexOf(current!));
    const ids = targets.map(card => card.dataset.charId || '');
    const remaining = scoped.filter(card => !targets.includes(card));
    const next = remaining[Math.min(index, remaining.length - 1)];
    const bridge = globalThis as typeof globalThis & {
      __OMNI_FLUSH_CHARACTERS__?:()=>Promise<void>;
      __OMNI_CHARACTER_SCOPE__?:()=>string;
      __OMNI_REMOVE_CHARACTER_CACHE__?:(scope:string, ids:string[], target:string)=>CharacterRecord[];
      __OMNI_FINISH_CHARACTER_DELETE__?:(target:string,ids:string[])=>void;
      __OMNI_RESTORE_CHARACTER_CACHE__?:(scope:string, rows:CharacterRecord[], target:string)=>void;
      __OMNI_REFRESH_CHARACTER_SCOPE__?:(target:string)=>Promise<void>;
    };
    const target = scope === 'global' ? '__global__' : targets[0]!.dataset.charRefScope || bridge.__OMNI_CHARACTER_SCOPE__?.() || '';
    if (!target || !bridge.__OMNI_REMOVE_CHARACTER_CACHE__) { window.alert('삭제 저장 연결을 찾을 수 없습니다.'); return; }
    targets.forEach(card=>deleting.add(card));
    const before = current;
    const restore = targets.map(card => ({card, parent:card.parentNode!, next:card.nextSibling,
      tile:[...document.querySelectorAll<HTMLElement>('[data-ux-character-tile]')].find(tile=>tile.dataset.uxCharacterScope===scope && tile.dataset.uxCharacterTile===card.dataset.charId)}));
    const flushing = bridge.__OMNI_FLUSH_CHARACTERS__?.();
    const removed = bridge.__OMNI_REMOVE_CHARACTER_CACHE__(scope, ids, target);
    for(const {card,tile} of restore){tile?.remove();card.remove();}
    cards = cards.filter(card=>!targets.includes(card));
    if(selectedScope===scope){choose(next);if(!next)document.getElementById('nx-char-sheet-close')?.click();}
    document.getElementById('nx-char-search')?.dispatchEvent(new Event('input', {bubbles:true}));
    try {
      await flushing;
      await mutateCharacterRoster(target, rows => rows.filter(row => !ids.includes(row.id)));
      targets.forEach(unregisterCharacterPreview);
      bridge.__OMNI_FINISH_CHARACTER_DELETE__?.(target,ids);
    } catch (error) {
      bridge.__OMNI_RESTORE_CHARACTER_CACHE__?.(scope, removed || [], target);
      if(sheet.isConnected) {
        for(const saved of restore.slice().reverse()) {
          saved.parent.insertBefore(saved.card, saved.next?.parentNode===saved.parent?saved.next:null);
          if(saved.tile)saved.card.before(saved.tile);
        }
        cards=[...document.querySelectorAll<HTMLElement>('.char-card[data-char-id]')];
        // Roll back only this deletion, never a later selection/edit or another bot.
        if(current===next && selectedScope===scope)choose(before);
        document.getElementById('nx-char-search')?.dispatchEvent(new Event('input', {bubbles:true}));
      } else await bridge.__OMNI_REFRESH_CHARACTER_SCOPE__?.(target);
      window.alert(String(error));
    } finally { targets.forEach(card=>deleting.delete(card)); }
  };
  // 전체삭제 is 선택 → 전체 선택 → 삭제 now.
  const empty = document.getElementById('nx-char-empty');
  if (empty) empty.hidden = cards.length > 0;
  selectScope(selectedScope);
  connectCharacterImages();
  paintReferenceProgress();
  bar.hidden = true;
  if (bar.parentElement?.id === 'nx-char-scope-slot') bar.parentElement.hidden = true;
  document.getElementById('nx-char-search')?.addEventListener('input', event=> {
    // Commas list several people, as in the session note's 옷 상태 search: any one matches.
    const terms=(event.target as HTMLInputElement).value.toLocaleLowerCase().split(/[,，]/).map(term=>term.trim()).filter(Boolean);
    let visible = 0;
    for(const tile of document.querySelectorAll<HTMLElement>('[data-ux-character-tile]')) {
      const card=characterCardForTile(tile);
      const text=terms.length ? [...(card?.querySelectorAll('input,textarea')||[])].filter(isField).map(f=>f.value).join(' ').toLocaleLowerCase() : '';
      tile.hidden=terms.length>0 && !terms.some(term=>text.includes(term));
      if (!tile.hidden && tile.dataset.uxCharacterScope === selectedScope) visible++;
    }
    if (empty) { empty.hidden = visible > 0; empty.classList.toggle('show', visible === 0); }
  });
  document.getElementById('nx-char-to-global')?.addEventListener('click',async()=> {
    if(!current || selectedScope==='global')return;
    const button=document.getElementById('nx-char-to-global') as HTMLButtonElement;
    button.disabled=true;
    try {
      await (globalThis as typeof globalThis & {__OMNI_FLUSH_CHARACTERS__?:()=>Promise<void>}).__OMNI_FLUSH_CHARACTERS__?.();
      const scope=current.dataset.charRefScope || '';
      const row=(await listCharacters(scope)).find(r=>r.id===selectedId);
      if(!row)throw new Error('저장된 캐릭터를 찾을 수 없습니다.');
      await upsertCharacter('__global__',row);
      await deleteCharacter(scope,row.id);
      document.getElementById('nx-refresh-chars')?.click();
    } catch(error) {window.alert(String(error));} finally {button.disabled=false;}
  });
  if(empty) empty.textContent='등록된 캐릭터가 없습니다.';
  bindSelection({ cards: () => cards, scope: () => selectedScope, removeCharacters, selection });
  document.getElementById('nx-char-search')?.dispatchEvent(new Event('input', {bubbles:true}));
}

type Bridge = typeof globalThis & {
  __OMNI_FLUSH_CHARACTERS__?: () => Promise<void>;
  __OMNI_CHARACTER_SCOPE__?: () => string;
  __OMNI_SETTINGS_ACTIONS__?: RosterCommandActions;
};
const tileFor = (card: HTMLElement) => [...document.querySelectorAll<HTMLElement>('[data-ux-character-tile]')]
  .find(tile => tile.dataset.uxCharacterScope === card.dataset.charScope && tile.dataset.uxCharacterTile === card.dataset.charId);
/** The roster a card is saved in: the global one, or its bot's. */
const rosterOf = (card: HTMLElement | undefined, scope: string): string => scope === 'global'
  ? '__global__' : card?.dataset.charRefScope || (globalThis as Bridge).__OMNI_CHARACTER_SCOPE__?.() || '';

/** 비활성화 shows on its tile: dimmed, and said in its title. */
async function paintDisabled(cards: HTMLElement[]): Promise<void> {
  for (const scope of ['session', 'global']) {
    const scoped = cards.filter(card => card.dataset.charScope === scope);
    const roster = rosterOf(scoped[0], scope);
    if (!roster) continue;
    const off = new Set((await listCharacters(roster).catch(() => [])).filter(row => row.disabled === true).map(row => row.id));
    for (const card of scoped) {
      const tile = tileFor(card), name = tile?.querySelector('[data-character-label]')?.textContent || '';
      tile?.classList.toggle('nx-off', off.has(card.dataset.charId || ''));
      if (tile) tile.title = off.has(card.dataset.charId || '') ? `${name} · 비활성화 (태깅에서 빠짐)` : name;
    }
  }
}

/**
 * 선택 모드: tiles are picked by tapping, then one bar acts on all of them:
 * delete, 비활성화/활성화, an LLM command, or a copy/move to the other roster.
 */
function bindSelection(ctx: {
  cards: () => HTMLElement[];
  scope: () => string;
  removeCharacters: (targets: HTMLElement[]) => Promise<void>;
  selection: { on: boolean; toggle: (card: HTMLElement, tile: HTMLElement) => void; clear: () => void };
}): void {
  // In the current character's row: when on, its own buttons give way to the bar, so no line is added.
  const toggleButton = document.getElementById('nx-char-select');
  const row = toggleButton?.parentElement;
  if (!toggleButton || !row || toggleButton.dataset.nxBound) return;
  toggleButton.dataset.nxBound = '1';
  const bar = document.createElement('div');
  bar.id = 'nx-char-select-bar'; bar.hidden = true; bar.setAttribute('role', 'toolbar'); bar.setAttribute('aria-label', '고른 캐릭터');
  toggleButton.after(bar);
  const picked = new Set<HTMLElement>();
  // No 완료: turning 선택 off is how selection ends.
  bar.innerHTML = '<span data-sel-count></span><button type="button" class="dock-btn" data-sel="all">전체 선택</button>'
    + '<button type="button" class="dock-btn" data-sel="off">비활성화</button><button type="button" class="dock-btn" data-sel="on">활성화</button>'
    + '<button type="button" class="dock-btn" data-sel="llm">LLM 명령</button><button type="button" class="dock-btn" data-sel="look-gen">참고컷 생성</button>'
    + '<button type="button" class="dock-btn" data-sel="look-vibe">vibe레퍼로</button><button type="button" class="dock-btn" data-sel="delete">삭제</button>';
  const chosen = () => [...picked].filter(card => card.isConnected && card.dataset.charScope === ctx.scope());
  let note = '';
  const paint = () => {
    const n = chosen().length;
    bar.querySelector('[data-sel-count]')!.textContent = `${n}명 선택${note ? ' · ' + note : ''}`;
    // A run locks every button; this is also what unlocks them, 전체 선택 included.
    for (const button of bar.querySelectorAll<HTMLButtonElement>('[data-sel]')) {
      button.disabled = button.dataset.sel !== 'all' && n === 0;
    }
    toggleButton.classList.toggle('on', ctx.selection.on);
    toggleButton.setAttribute('aria-pressed', String(ctx.selection.on));
  };
  const setTile = (card: HTMLElement, on: boolean) => {
    const tile = tileFor(card);
    tile?.classList.toggle('nx-picked', on);
    tile?.setAttribute('aria-checked', String(on));
  };
  ctx.selection.toggle = (card) => { const on = !picked.has(card); if (on) picked.add(card); else picked.delete(card); setTile(card, on); paint(); };
  ctx.selection.clear = () => { for (const card of picked) setTile(card, false); picked.clear(); paint(); };
  const setMode = (on: boolean) => {
    ctx.selection.on = on; bar.hidden = !on;
    // A class, not hidden: the scope switch owns which of the row's buttons are hidden.
    row.classList.toggle('nx-selecting', on);
    if (!on) ctx.selection.clear();
    paint();
  };
  toggleButton.textContent = '선택';
  toggleButton.addEventListener('click', () => setMode(!ctx.selection.on));
  const run = async (work: (cards: HTMLElement[]) => Promise<void>) => {
    const cards = chosen(); if (!cards.length) return;
    note = '';
    bar.querySelectorAll('button').forEach(button => { button.disabled = true; });
    try { await work(cards); } catch (error) { window.alert(String((error as Error)?.message || error)); }
    finally { paint(); }
  };
  bar.addEventListener('click', event => {
    const action = (event.target as Element).closest<HTMLElement>('[data-sel]')?.dataset.sel;
    if (!action) return;
    if (action === 'all') { for (const card of ctx.cards()) if (card.dataset.charScope === ctx.scope() && !tileFor(card)?.hidden) { picked.add(card); setTile(card, true); } paint(); return; }
    if (action === 'delete') void run(async cards => {
      if (!window.confirm(`고른 ${cards.length}명을 삭제할까요?`)) return;
      await ctx.removeCharacters(cards); for (const card of cards) picked.delete(card);
    });
    if (action === 'off' || action === 'on') void run(async cards => {
      const roster = rosterOf(cards[0], ctx.scope()), ids = new Set(cards.map(card => card.dataset.charId || ''));
      await (globalThis as Bridge).__OMNI_FLUSH_CHARACTERS__?.();
      await mutateCharacterRoster(roster, rows => rows.map(row => !ids.has(row.id) ? row
        : action === 'off' ? { ...row, disabled: true } : Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'disabled')) as CharacterRecord));
      await paintDisabled(ctx.cards());
    });
    if (action === 'llm') void run(async cards => {
      const actions = (globalThis as Bridge).__OMNI_SETTINGS_ACTIONS__;
      if (!actions?.characterTarget || !actions.request) throw new Error('설정 연결을 찾을 수 없습니다.');
      openRosterCommand(actions, rosterOf(cards[0], ctx.scope()), cards.map(card => card.dataset.charId || ''),
        cards.map(card => card.querySelector<HTMLInputElement>('[data-char-name]')?.value || ''));
    });
    // One card after another, in tile order: the next starts only when the last is done.
    if (action === 'look-gen' || action === 'look-vibe') void run(async cards => {
      const label = action === 'look-gen' ? '참고컷' : 'vibe';
      const ordered = ctx.cards().filter(card => cards.includes(card));
      let done = 0;
      for (const [i, card] of ordered.entries()) {
        note = `${label} ${i + 1}/${ordered.length}…`; paint();
        bar.querySelectorAll('button').forEach(button => { button.disabled = true; });
        const shot = exampleShotActions(card);
        if (shot && await (action === 'look-gen' ? shot.generate() : shot.toVibe())) done++;
      }
      note = done === ordered.length ? `${label} ${done}명 완료` : `${label} ${done}/${ordered.length}명 완료`;
    });
  });
  paint();
  void paintDisabled(ctx.cards());
}

/** Open the shared editor by stable identity, never by tile position. */
export function openCharacterEditor(target: {id?: string; name?: string; scope?: string; roster?: {id?: string; name?: string; scope?: string}}): boolean {
  target = { ...target.roster, ...Object.fromEntries(Object.entries(target).filter(([, value]) => value != null && value !== '')) };
  const rows=[...document.querySelectorAll<HTMLElement>('.char-card[data-char-id]')];
  const scope=target.scope === '__global__' || target.scope === 'global' ? 'global' : 'session';
  const row=rows.find(row=>row.dataset.charId===target.id && row.dataset.charScope===scope)
    || rows.find(row=>row.dataset.charScope===scope && row.querySelector<HTMLInputElement>('[data-char-name]')?.value===target.name);
  if (!row) return false;
  document.querySelector<HTMLElement>(`[data-ux-scope="${scope}"]`)?.click();
  document.querySelectorAll<HTMLElement>('[data-ux-character-tile]').forEach(tile=> {
    if (tile.dataset.uxCharacterTile===row.dataset.charId && tile.dataset.uxCharacterScope===scope) tile.click();
  });
  if (!document.getElementById('nx-char-sheet')?.classList.contains('open')) document.getElementById('nx-char-edit-btn')?.click();
  return true;
}
