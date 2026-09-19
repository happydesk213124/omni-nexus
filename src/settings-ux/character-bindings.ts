import type { CharacterRecord } from '../core/types';
import { mutateCharacterRoster } from '../storage/character-roster';
import { pickCharacterAsset } from './asset-picker';
import { bindCostumeEditor } from './costume-editor';
import { connectCharacterImages, paintReferenceProgress, syncCharacterTilePreviews } from './reference-progress';
import { listCharacters, upsertCharacter, deleteCharacter } from '../services/characters';
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
  // oe(scope) treats EVERY data-char-scope node as a record, including navigation buttons.
  bar.querySelectorAll<HTMLElement>('[data-char-scope]').forEach(button => {
    button.dataset.uxScope = button.getAttribute('data-char-scope') || '';
    button.removeAttribute('data-char-scope');
  });
  document.getElementById('nx-char-from-asset')?.addEventListener('click',()=>{if(current)void pickCharacterAsset(current).catch(error=>window.alert(String(error)));});
  let cards = [...document.querySelectorAll<HTMLElement>('.char-card[data-char-id]')];
  cards.forEach(bindCostumeEditor);
  sheet.querySelector<HTMLInputElement>('[data-char-age]')?.setAttribute('type', 'text');
  const penis = sheet.querySelector<HTMLSelectElement>('[data-char-penis-size]');
  if (penis && ![...penis.options].some(o => o.value === '[base]')) penis.add(new Option('[base]', '[base]'));
  let current: HTMLElement | undefined;
  const mirrors = [...sheet.querySelectorAll<HTMLElement>('*')].flatMap(element => {
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
          element.innerHTML = source.innerHTML;
          element.value = source.value;
        }
        if (element instanceof HTMLInputElement && element.type === 'checkbox') element.checked = source instanceof HTMLInputElement && source.checked;
      } else if (element instanceof HTMLButtonElement) element.disabled = !source;
      else element.innerHTML = source?.innerHTML || '';
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
      }, true);
    }
    if (element.matches('[data-char-costume-slot-save]')) element.hidden = true;
  }
  const choose = (card: HTMLElement | undefined) => {
    current = card;
    selectedId = card?.dataset.charId || '';
    document.querySelectorAll<HTMLElement>('[data-ux-character-tile]').forEach(tile => {
      const on = tile.dataset.uxCharacterTile === selectedId && tile.dataset.uxCharacterScope === selectedScope;
      tile.classList.toggle('on', on);
      tile.setAttribute('aria-pressed', String(on));
    });
    refresh();
  };
  const selectScope = (scope: string) => {
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
  for (const card of cards) {
    const changed=()=>{if(current===card)refresh(); paintName(); syncCharacterTilePreviews();};
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
      const again = current === card;
      choose(card);
      if (again && !document.getElementById('nx-char-sheet')?.classList.contains('open')) document.getElementById('nx-char-edit-btn')?.click();
    });
    card.before(tile);
  }
  syncCharacterTilePreviews();
  bar.addEventListener('click', event => {
    const button = (event.target as Element).closest<HTMLElement>('[data-ux-scope]');
    if (button) selectScope(button.dataset.uxScope || 'session');
  });
  for (const [id, selector] of Object.entries({
    'nx-char-del': '[data-char-delete]',
    'nx-char-look-act': '[data-char-ex-upload]', 'nx-char-look-gen': '[data-char-ex-gen]',
  })) document.getElementById(id)?.addEventListener('click', event => {
    event.stopImmediatePropagation();
    if (selector === '[data-char-delete]') void removeCharacters(current ? [current] : []);
    else current?.querySelector<HTMLElement>(selector)?.click();
  }, true);
  document.getElementById('nx-char-dup')?.addEventListener('click', () => {
    if (!current) return;
    const copy = current.cloneNode(true) as HTMLElement;
    copy.dataset.charId = `new_${crypto.randomUUID()}`;
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
  document.getElementById('nx-char-del-all')?.addEventListener('click', () => {
    if (!window.confirm('선택한 로스터의 캐릭터를 모두 삭제할까요?')) return;
    void removeCharacters(cards.filter(card => card.dataset.charScope === selectedScope));
  });
  const empty = document.getElementById('nx-char-empty');
  if (empty) empty.hidden = cards.length > 0;
  selectScope(selectedScope);
  connectCharacterImages();
  paintReferenceProgress();
  bar.hidden = true;
  if (bar.parentElement?.id === 'nx-char-scope-slot') bar.parentElement.hidden = true;
  document.getElementById('nx-char-search')?.addEventListener('input', event=> {
    const query=(event.target as HTMLInputElement).value.trim().toLocaleLowerCase();
    let visible = 0;
    for(const tile of document.querySelectorAll<HTMLElement>('[data-ux-character-tile]')) {
      const card=cards.find(c=>c.dataset.charId===tile.dataset.uxCharacterTile && c.dataset.charScope===tile.dataset.uxCharacterScope);
      const text=[...(card?.querySelectorAll('input,textarea')||[])].filter(isField).map(f=>f.value).join(' ').toLocaleLowerCase();
      tile.hidden=!text.includes(query);
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
  document.getElementById('nx-char-search')?.dispatchEvent(new Event('input', {bubbles:true}));
}

/** Open the shared editor by stable identity, never by tile position. */
export function openCharacterEditor(target: {id?: string; name?: string; scope?: string}): boolean {
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
