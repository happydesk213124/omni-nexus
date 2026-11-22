import { uuid } from '../core/util/text';
import { FOLDER_LOOK_FIELDS, folderOf, moveToFolder, type FolderLookField, type LookFolder } from '../domain/character/folders';
import { bindTileDrag } from './tile-drag';

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
        + (here ? `<span class="nx-folder-actions"><button type="button" class="btn-ghost" data-folder-edit>폴더 수정</button><button type="button" class="btn-ghost" data-folder-delete>폴더 삭제</button></span>` : '<small class="nx-folder-tip">끌어서 폴더에 넣기</small>')
        + (here && !here.members.some(member => ids.has(member)) ? `<small class="nx-folder-tip nx-folder-empty">빈 폴더입니다. 📁 전체에서 ${esc(o.noun)}를 끌어다 놓으세요.</small>` : '');
    o.painted?.();
  }
  async function refresh(): Promise<void> { folders = await o.load().catch(() => []); paint(); }
  async function move(ids: readonly string[], folderId: string): Promise<void> {
    if (ids.length) await persist(moveToFolder(folders, ids, folderId));
  }
  async function create(): Promise<void> {
    const made = await folderDialog({ id: `f_${uuid()}`, name: '', members: [] }, o.looks, true);
    if (made) await persist([...folders, made]);
  }
  async function choose(ids: readonly string[]): Promise<void> {
    if (!ids.length) return;
    const target = await folderPicker(folders, o.noun);
    if (target === null) return;
    if (target === NEW_FOLDER) { const made = await folderDialog({ id: `f_${uuid()}`, name: '', members: [] }, o.looks, true); if (made) await persist(moveToFolder([...folders, made], ids, made.id)); return; }
    await move(ids, target);
  }

  const click = (event: Event) => {
    const target = event.target as Element;
    const folderTile = target.closest<HTMLElement>('[data-ux-folder]');
    if (folderTile) { event.stopPropagation(); open(folderTile.dataset.uxFolder || ''); }
  };
  const pathClick = (event: Event) => {
    const target = event.target as Element, here = folders.find(f => f.id === current());
    if (target.closest('[data-folder-crumb]')) open('');
    else if (here && target.closest('[data-folder-edit]')) void folderDialog(here, o.looks, false).then(next => next && persist(folders.map(f => f.id === next.id ? next : f)));
    else if (here && target.closest('[data-folder-delete]') && window.confirm(`「${here.name}」 폴더를 지울까요?\n안에 있던 ${o.noun}는 지워지지 않고 📁 전체로 나옵니다.`)) { opened.set(o.key, ''); void persist(folders.filter(f => f.id !== here.id)); }
  };
  o.list.addEventListener('click', click, true);
  o.path.addEventListener('click', pathClick);
  const stopDrag = bindTileDrag({
    list: o.list, mouse: !o.nativeDrag,
    source: target => { const tile = target.closest<HTMLElement>('button, [draggable]'); return tile && o.tiles().includes(tile) ? tile : null; },
    target: at => at.closest<HTMLElement>('[data-ux-folder], [data-folder-crumb]'),
    label: tile => { const picked = o.picked?.() || []; return picked.length > 1 && picked.includes(o.idOf(tile)) ? `${picked.length}개` : o.nameOf(tile); },
    drop: (tile, to) => {
      const id = o.idOf(tile), picked = o.picked?.() || [];
      void move(picked.includes(id) ? picked : [id], to.dataset.uxFolder ?? '');
    },
  });
  return {
    refresh, paint, folders: () => folders, current, open, move, create, choose,
    dispose() { disposed = true; stopDrag(); o.list.removeEventListener('click', click, true); o.path.removeEventListener('click', pathClick); },
  };
}

const NEW_FOLDER = '\u0000new';
function popup(html: string): { box: HTMLElement; close: () => void } {
  const bg = document.createElement('div'); bg.className = 'pop-bg on nx-folder-bg';
  const box = document.createElement('div'); box.className = 'pop on nx-folder-pop'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true');
  box.innerHTML = html;
  document.body.append(bg, box);
  return { box, close: () => { bg.remove(); box.remove(); } };
}
/** Which folder to move to: a folder's id, '' for out of every folder, NEW_FOLDER, or null when closed. */
function folderPicker(folders: readonly LookFolder[], noun: string): Promise<string | null> {
  return new Promise(resolve => {
    const { box, close } = popup(`<h3>어느 폴더로 옮길까요?</h3><div class="nx-folder-choices">`
      + `<button type="button" class="btn-ghost" data-folder-choice="">📁 전체 (폴더 밖)</button>`
      + folders.map(f => `<button type="button" class="btn-ghost" data-folder-choice="${esc(f.id)}">📁 ${esc(f.name)}</button>`).join('')
      + `<button type="button" class="btn-ghost" data-folder-choice-new>＋ 새 폴더를 만들어 넣기</button></div>`
      + `<div class="pop-actions"><button type="button" class="btn-ghost" data-folder-cancel>취소</button></div>`);
    box.id = 'nx-folder-pick'; box.setAttribute('aria-label', `${noun} 폴더 고르기`);
    box.addEventListener('click', event => {
      const target = event.target as Element, choice = target.closest<HTMLElement>('[data-folder-choice]');
      if (choice) { close(); resolve(choice.dataset.folderChoice ?? ''); }
      else if (target.closest('[data-folder-choice-new]')) { close(); resolve(NEW_FOLDER); }
      else if (target.closest('[data-folder-cancel]')) { close(); resolve(null); }
    });
  });
}
/** A folder's sheet: its name, and for a character folder the looks its members share. Null when cancelled. */
function folderDialog(f: LookFolder, looks: boolean, fresh: boolean): Promise<LookFolder | null> {
  return new Promise(resolve => {
    const field = (name: FolderLookField, wide: boolean) => `<label class="nx-folder-field${wide ? ' wide' : ''}"><span>${LOOK_LABELS[name]}</span>`
      + (wide ? `<textarea rows="2" data-folder-field="${name}">${esc(f[name] || '')}</textarea>` : `<input data-folder-field="${name}" value="${esc(f[name] || '')}">`) + '</label>';
    const { box, close } = popup(`<h3>${fresh ? '새 폴더' : '폴더 수정'}</h3>`
      + `<label class="nx-folder-field wide"><span>폴더 이름</span><input data-folder-field="name" maxlength="80" value="${esc(f.name)}" placeholder="예: 네일샵 직원"></label>`
      + (looks ? `<p class="nx-folder-note"><b>폴더 공통 태그</b> · 이 폴더에 든 캐릭터의 샷을 만들 때 함께 들어갑니다. 캐릭터에 저장되지는 않습니다.<br>외형 태그는 캐릭터의 태그와 합쳐지고, 나머지 칸은 캐릭터의 그 칸이 비어 있을 때만 쓰입니다.</p>`
        + `<div class="nx-folder-grid">${field('appearance', true)}${(['hair_color', 'hair_style', 'eye_color', 'height', 'age'] as const).map(name => field(name, false)).join('')}${(['attire', 'bottoms', 'accessories'] as const).map(name => field(name, true)).join('')}</div>` : '')
      + `<div class="pop-actions"><button type="button" class="btn-ghost" data-folder-cancel>취소</button><button type="button" class="btn-primary" data-folder-save>${fresh ? '만들기' : '저장'}</button></div>`);
    box.id = 'nx-folder-pop';
    const read = (name: string) => box.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[data-folder-field="${name}"]`)?.value.replace(/\s+/g, ' ').trim() || '';
    const nameInput = box.querySelector<HTMLInputElement>('[data-folder-field="name"]')!;
    const done = () => {
      const name = read('name');
      if (!name) { nameInput.focus(); nameInput.classList.add('nx-invalid'); return; }
      const next: LookFolder = { id: f.id, name, members: f.members };
      if (looks) for (const key of FOLDER_LOOK_FIELDS) { const value = read(key); if (value) next[key] = value; }
      close(); resolve(next);
    };
    box.addEventListener('click', event => {
      const target = event.target as Element;
      if (target.closest('[data-folder-save]')) done();
      else if (target.closest('[data-folder-cancel]')) { close(); resolve(null); }
    });
    nameInput.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); done(); } });
    nameInput.focus();
  });
}
