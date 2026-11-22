import { uuid } from '../core/util/text';
import { FOLDER_LOOK_FIELDS, folderOf, moveToFolder, type FolderLookField, type LookFolder } from '../domain/character/folders';
import { bindTileDrag } from './tile-drag';
import { bindMenu } from './menu';

/**
 * 폴더 over a grid of tiles (캐릭터, 스타일 프리셋), as in a file window: folders stand first in the grid and open on a
 * tap, a path bar leads back to 전체, and a tile is filed by dragging it onto a folder (or onto 전체, out of one).
 * With no folder made, nothing of this shows: the grid is as it always was.
 */
export interface FolderViewOptions {
  /** Which list this is: the folder left open is remembered by it across repaints. */
  key: string;
  list: HTMLElement;
  /** The path bar's own element, above the list. */
  path: HTMLElement;
  tiles: () => HTMLElement[];
  idOf: (tile: HTMLElement) => string;
  nameOf: (tile: HTMLElement) => string;
  load: () => Promise<LookFolder[]>;
  save: (folders: LookFolder[]) => Promise<LookFolder[]>;
  /** A character folder: its sheet has the looks its members share. */
  looks: boolean;
  /** A search is on: it looks through every folder, and the folders step aside. */
  searching: () => boolean;
  /** The tiles drag natively already (to reorder): only the drop on a folder is taken. */
  nativeDrag?: boolean;
  /** Tiles picked in 선택 mode: dragging one of them moves them all. */
  picked?: () => string[];
  /** After every paint: what is shown changed (a folder opened, a tile filed). */
  painted?: () => void;
  noun: string;
}
export interface FolderView {
  refresh(): Promise<void>;
  paint(): void;
  folders(): LookFolder[];
  current(): string;
  open(id: string): void;
  move(ids: readonly string[], folderId: string): Promise<void>;
  create(): Promise<void>;
  /** Ask which folder (or 폴더 밖) and move there. */
  choose(ids: readonly string[]): Promise<void>;
  dispose(): void;
}
const opened = new Map<string, string>();
const LOOK_LABELS: Record<FolderLookField, string> = { appearance: '외형 태그', hair_color: '머리', hair_style: '스타일', eye_color: '눈색·눈 형태', height: '키', age: '나이', attire: '상의', bottoms: '하의', accessories: '무기·기타' };
const esc = (value: string): string => value.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

export function mountFolderView(o: FolderViewOptions): FolderView {
  let folders: LookFolder[] = [], disposed = false;
  const current = () => opened.get(o.key) || '';
  const open = (id: string) => { opened.set(o.key, id); paint(); };
  const persist = async (next: LookFolder[]) => { folders = await o.save(next); paint(); };

  function paint(): void {
    if (disposed) return;
    for (const old of o.list.querySelectorAll('[data-ux-folder]')) old.remove();
    const tiles = o.tiles(), here = folders.find(f => f.id === current());
    if (current() && !here) opened.set(o.key, '');
    const searching = o.searching(), ids = new Set(tiles.map(o.idOf));
    for (const tile of tiles) {
      const home = folderOf(folders, o.idOf(tile));
      tile.classList.toggle('nx-folder-out', !searching && (here ? home?.id !== here.id : !!home));
    }
    if (!here && !searching) {
      const first = o.list.firstChild;
      for (const f of folders) {
        const tile = document.createElement('button');
        tile.type = 'button'; tile.className = 'preset-tile nx-folder-tile'; tile.dataset.uxFolder = f.id;
        const count = f.members.filter(member => ids.has(member)).length;
        tile.title = `${f.name} · ${count}개`;
        tile.innerHTML = `<i aria-hidden="true">📁</i><span data-folder-name>${esc(f.name)}</span><small>${count}개</small>`;
        o.list.insertBefore(tile, first);
      }
    }
    // No folder at all: the bar is not there, and the tab looks as it did before folders.
    o.path.hidden = !folders.length;
    o.path.innerHTML = searching
      ? '<span class="nx-folder-crumbs"><b>검색 결과</b><small>모든 폴더에서 찾습니다</small></span>'
      : `<span class="nx-folder-crumbs"><button type="button" data-folder-crumb="" ${here ? '' : 'aria-current="true"'}>📁 전체</button>${here ? `<i aria-hidden="true">›</i><b data-folder-current>${esc(here.name)}</b>` : ''}</span>`
        + (here ? `<span class="nx-folder-actions"><button type="button" class="btn-ghost" data-folder-edit>폴더 수정</button><button type="button" class="btn-ghost" data-folder-delete>폴더 삭제</button></span>` : '<small class="nx-folder-tip">끌어서 폴더에 넣기 · 폴더를 길게 누르면 수정 · 삭제</small>')
        + (here && !here.members.some(member => ids.has(member)) ? `<small class="nx-folder-tip nx-folder-empty">빈 폴더입니다. 📁 전체에서 ${esc(o.noun)}를 끌어다 놓으세요.</small>` : '');
    o.painted?.();
  }
  async function refresh(): Promise<void> { folders = await o.load().catch(() => []); paint(); }
  async function move(ids: readonly string[], folderId: string): Promise<void> {
    if (ids.length) await persist(moveToFolder(folders, ids, folderId));
  }
  const blank = (): LookFolder => ({ id: `f_${uuid()}`, name: '', members: [] });
  const countIn = (f: LookFolder): number => { const ids = new Set(o.tiles().map(o.idOf)); return f.members.filter(member => ids.has(member)).length; };
  async function create(): Promise<void> {
    const made = await folderDialog(blank(), { looks: o.looks, fresh: true, noun: o.noun, count: 0 });
    if (made && made !== 'delete') await persist([...folders, made]);
  }
  async function remove(f: LookFolder): Promise<void> {
    if (!window.confirm(`「${f.name}」 폴더를 지울까요?\n안에 있던 ${o.noun}는 지워지지 않고 📁 전체로 나옵니다.`)) return;
    if (current() === f.id) opened.set(o.key, '');
    await persist(folders.filter(row => row.id !== f.id));
  }
  async function edit(f: LookFolder): Promise<void> {
    const next = await folderDialog(f, { looks: o.looks, fresh: false, noun: o.noun, count: countIn(f) });
    if (next === 'delete') await remove(f);
    else if (next) await persist(folders.map(row => row.id === next.id ? next : row));
  }
  async function choose(ids: readonly string[]): Promise<void> {
    if (!ids.length) return;
    const target = await folderPicker(folders, o.noun);
    if (target === null) return;
    if (target === NEW_FOLDER) { const made = await folderDialog(blank(), { looks: o.looks, fresh: true, noun: o.noun, count: ids.length }); if (made && made !== 'delete') await persist(moveToFolder([...folders, made], ids, made.id)); return; }
    await move(ids, target);
  }

  // A folder's own menu (열기 · 폴더 수정 · 폴더 삭제): a right-click, or a finger held on it.
  const menu = document.createElement('div');
  menu.className = 'nx-menu nx-folder-menu'; menu.hidden = true; menu.setAttribute('role', 'menu');
  menu.innerHTML = '<small class="nx-menu-title" data-fm-title></small><button type="button" role="menuitem" data-fm="open">열기</button><button type="button" role="menuitem" data-fm="edit">폴더 수정</button><hr><button type="button" role="menuitem" class="danger" data-fm="delete">폴더 삭제</button>';
  document.body.append(menu);
  const folderMenu = bindMenu(menu);
  let menuFor = '', held = 0, heldOpen = false;
  const openMenu = (id: string, x: number, y: number) => {
    const f = folders.find(row => row.id === id);
    if (!f) return;
    menuFor = id; menu.querySelector('[data-fm-title]')!.textContent = `📁 ${f.name}`;
    folderMenu.openAt(x, y);
  };
  menu.addEventListener('click', event => {
    const action = (event.target as Element).closest<HTMLElement>('[data-fm]')?.dataset.fm, f = folders.find(row => row.id === menuFor);
    if (!action || !f) return;
    if (action === 'open') open(f.id); else if (action === 'edit') void edit(f); else void remove(f);
  });
  const context = (event: Event) => {
    const folderTile = (event.target as Element).closest<HTMLElement>('[data-ux-folder]');
    if (!folderTile) return;
    event.preventDefault(); event.stopPropagation();
    // A held finger has opened it already where the browser also sends this (Android).
    if (!folderMenu.open) openMenu(folderTile.dataset.uxFolder || '', (event as MouseEvent).clientX, (event as MouseEvent).clientY);
  };
  // Not every phone sends a contextmenu for a held finger (iOS sends none): the hold is timed here.
  const touchStart = (event: Event) => {
    const e = event as TouchEvent, folderTile = (e.target as Element).closest<HTMLElement>('[data-ux-folder]'), t = e.touches[0];
    window.clearTimeout(held); heldOpen = false;
    if (!folderTile || !t || e.touches.length !== 1) return;
    const x = t.clientX, y = t.clientY;
    folderTile.classList.add('nx-press');
    held = window.setTimeout(() => { folderTile.classList.remove('nx-press'); heldOpen = true; try { navigator.vibrate?.(12); } catch { /* no haptics */ }
      openMenu(folderTile.dataset.uxFolder || '', x, y);
      // The finger is still down where the menu opened: its release must not choose the item under it.
      menu.style.pointerEvents = 'none'; window.setTimeout(() => { menu.style.pointerEvents = ''; }, 400);
    }, 450);
  };
  const touchStop = () => { window.clearTimeout(held); for (const pressed of o.list.querySelectorAll('[data-ux-folder].nx-press')) pressed.classList.remove('nx-press'); };
  const click = (event: Event) => {
    const target = event.target as Element;
    const folderTile = target.closest<HTMLElement>('[data-ux-folder]');
    if (!folderTile) return;
    event.stopPropagation();
    // The tap that ends a hold opened the menu: it does not also open the folder.
    if (heldOpen) { heldOpen = false; event.preventDefault(); return; }
    open(folderTile.dataset.uxFolder || '');
  };
  const pathClick = (event: Event) => {
    const target = event.target as Element, here = folders.find(f => f.id === current());
    if (target.closest('[data-folder-crumb]')) open('');
    else if (here && target.closest('[data-folder-edit]')) void edit(here);
    else if (here && target.closest('[data-folder-delete]')) void remove(here);
  };
  o.list.addEventListener('click', click, true);
  o.list.addEventListener('contextmenu', context);
  o.list.addEventListener('touchstart', touchStart, { passive: true });
  for (const type of ['touchmove', 'touchend', 'touchcancel']) o.list.addEventListener(type, touchStop, { passive: true });
  o.path.addEventListener('click', pathClick);
  const stopDrag = bindTileDrag({
    list: o.list, mouse: !o.nativeDrag,
    source: target => { const tile = target.closest<HTMLElement>('button, [draggable]'); return tile && o.tiles().includes(tile) ? tile : null; },
    target: at => at.closest<HTMLElement>('[data-ux-folder], [data-folder-crumb]'),
    count: tile => { const picked = o.picked?.() || []; return picked.includes(o.idOf(tile)) ? picked.length : 1; },
    drop: (tile, to) => {
      const id = o.idOf(tile), picked = o.picked?.() || [];
      void move(picked.includes(id) ? picked : [id], to.dataset.uxFolder ?? '');
    },
  });
  return {
    refresh, paint, folders: () => folders, current, open, move, create, choose,
    dispose() {
      disposed = true; stopDrag(); folderMenu.close(); menu.remove(); window.clearTimeout(held);
      o.list.removeEventListener('click', click, true); o.list.removeEventListener('contextmenu', context); o.list.removeEventListener('touchstart', touchStart);
      for (const type of ['touchmove', 'touchend', 'touchcancel']) o.list.removeEventListener(type, touchStop);
      o.path.removeEventListener('click', pathClick);
    },
  };
}

const NEW_FOLDER = '\u0000new';
function popup(html: string, onDismiss: () => void): { box: HTMLElement; close: () => void } {
  const bg = document.createElement('div'); bg.className = 'pop-bg on nx-folder-bg';
  const box = document.createElement('div'); box.className = 'pop on nx-folder-pop'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true');
  box.innerHTML = html;
  document.body.append(bg, box);
  const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); onDismiss(); } };
  document.addEventListener('keydown', key, true);
  bg.addEventListener('click', onDismiss);
  return { box, close: () => { document.removeEventListener('keydown', key, true); bg.remove(); box.remove(); } };
}
/** Which folder to move to: a folder's id, '' for out of every folder, NEW_FOLDER, or null when closed. */
function folderPicker(folders: readonly LookFolder[], noun: string): Promise<string | null> {
  return new Promise(resolve => {
    const dismiss = () => { close(); resolve(null); };
    const { box, close } = popup(`<div class="nx-sheet-head"><b>어느 폴더로 옮길까요?</b><button type="button" class="nx-sheet-x" data-folder-cancel aria-label="닫기">✕</button></div>`
      + `<div class="nx-sheet-body nx-folder-choices">`
      + `<button type="button" data-folder-choice=""><i aria-hidden="true">↩</i><span>📁 전체 (폴더 밖)</span></button>`
      + folders.map(f => `<button type="button" data-folder-choice="${esc(f.id)}"><i aria-hidden="true">📁</i><span>${esc(f.name)}</span></button>`).join('')
      + `<button type="button" data-folder-choice-new><i aria-hidden="true">＋</i><span>새 폴더를 만들어 넣기</span></button></div>`, dismiss);
    box.id = 'nx-folder-pick'; box.setAttribute('aria-label', `${noun} 폴더 고르기`);
    box.addEventListener('click', event => {
      const target = event.target as Element, choice = target.closest<HTMLElement>('[data-folder-choice]');
      if (choice) { close(); resolve(choice.dataset.folderChoice ?? ''); }
      else if (target.closest('[data-folder-choice-new]')) { close(); resolve(NEW_FOLDER); }
      else if (target.closest('[data-folder-cancel]')) dismiss();
    });
  });
}
const LOOK_HINTS: Record<FolderLookField, string> = { appearance: '예: slim, friendly look', hair_color: 'brown hair', hair_style: 'low ponytail', eye_color: 'brown eyes', height: '170', age: '20s', attire: '예: black nail salon apron', bottoms: '예: black pants', accessories: '예: surgical mask' };
/**
 * A folder's sheet: its name, and for a character folder the looks its members share, grouped as the character
 * editor groups them. Resolves the folder to save, 'delete' (폴더 삭제, when editing), or null when closed.
 */
function folderDialog(f: LookFolder, o: { looks: boolean; fresh: boolean; noun: string; count: number }): Promise<LookFolder | 'delete' | null> {
  return new Promise(resolve => {
    const input = (name: FolderLookField) => `<label class="nx-folder-field"><span>${LOOK_LABELS[name]}</span><input data-folder-field="${name}" value="${esc(f[name] || '')}" placeholder="${LOOK_HINTS[name]}" autocomplete="off" autocapitalize="off" spellcheck="false"></label>`;
    const area = (name: FolderLookField) => `<label class="nx-folder-field wide"><span>${LOOK_LABELS[name]}</span><textarea rows="2" data-folder-field="${name}" placeholder="${LOOK_HINTS[name]}" autocapitalize="off" spellcheck="false">${esc(f[name] || '')}</textarea></label>`;
    const dismiss = () => { close(); resolve(null); };
    const { box, close } = popup(
      `<div class="nx-sheet-head"><i aria-hidden="true">📁</i><b>${o.fresh ? '새 폴더' : '폴더 수정'}</b>${o.fresh ? '' : `<small>${esc(o.noun)} ${o.count}개</small>`}<button type="button" class="nx-sheet-x" data-folder-cancel aria-label="닫기">✕</button></div>`
      + `<div class="nx-sheet-body">`
      + `<label class="nx-folder-field name"><span>폴더 이름</span><input data-folder-field="name" maxlength="80" value="${esc(f.name)}" placeholder="예: 네일샵 직원" autocomplete="off"></label>`
      + (o.looks ? `<section class="nx-folder-looks"><header><b>폴더 공통 태그</b><small>샷을 만들 때 이 폴더의 캐릭터에게 함께 들어갑니다. 캐릭터에 저장되지는 않습니다.</small></header>`
        + `<div class="nx-folder-group"><h4>외형 <small>캐릭터의 외형 태그와 합쳐집니다</small></h4>${area('appearance')}</div>`
        + `<div class="nx-folder-group"><h4>머리 · 눈 · 키 · 나이 <small>캐릭터의 그 칸이 비어 있을 때만 쓰입니다</small></h4><div class="nx-folder-grid">${(['hair_color', 'hair_style', 'eye_color', 'height', 'age'] as const).map(input).join('')}</div></div>`
        + `<div class="nx-folder-group"><h4>옷 · 소지품 <small>캐릭터의 그 칸이 비어 있을 때만 쓰입니다</small></h4>${(['attire', 'bottoms', 'accessories'] as const).map(area).join('')}</div></section>` : '')
      + `</div><div class="nx-sheet-foot">${o.fresh ? '' : '<button type="button" class="btn-ghost danger" data-folder-remove>폴더 삭제</button>'}<span></span><button type="button" class="btn-ghost" data-folder-cancel>취소</button><button type="button" class="btn" data-folder-save>${o.fresh ? '만들기' : '저장'}</button></div>`, dismiss);
    box.id = 'nx-folder-pop';
    const read = (name: string) => box.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[data-folder-field="${name}"]`)?.value.replace(/\s+/g, ' ').trim() || '';
    const nameInput = box.querySelector<HTMLInputElement>('[data-folder-field="name"]')!;
    const done = () => {
      const name = read('name');
      if (!name) { nameInput.focus(); nameInput.classList.add('nx-invalid'); return; }
      const next: LookFolder = { id: f.id, name, members: f.members };
      if (o.looks) for (const key of FOLDER_LOOK_FIELDS) { const value = read(key); if (value) next[key] = value; }
      close(); resolve(next);
    };
    box.addEventListener('click', event => {
      const target = event.target as Element;
      if (target.closest('[data-folder-save]')) done();
      else if (target.closest('[data-folder-remove]')) { close(); resolve('delete'); }
      else if (target.closest('[data-folder-cancel]')) dismiss();
    });
    nameInput.addEventListener('input', () => nameInput.classList.remove('nx-invalid'));
    nameInput.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); done(); } });
    // A new folder starts at its name; an old one opens without the keyboard jumping up on a phone.
    if (o.fresh) nameInput.focus();
  });
}
