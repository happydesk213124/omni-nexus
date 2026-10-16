import type { SoundItem, SoundKind } from '../core/sound-types';
import { soundData, saveSoundData, normalizeSoundData } from '../storage/sound-store';
import { omniSound } from '../services/sound-runtime';
import { soundTags } from '../domain/sound/tags';
import { matchesSoundSearch } from '../domain/sound/find';
import { el, input, val, set, text, esc, dialog, run, notify, download, readJson } from '../tts-ui/common';
import { uuid } from '../core/util/text';
import { setWordsFor, wordsFor } from './glossary';

const LABEL: Record<SoundKind, string> = { bgm: 'BGM', sfx: '효과음' };
const sizeOf = (item: SoundItem) => !item.bytes ? '' : item.bytes < 1048576 ? `${Math.max(1, Math.round(item.bytes / 1024))}KB` : `${(item.bytes / 1048576).toFixed(1)}MB`;

/** One tile list (BGM or effects) that behaves like the TTS voice list. */
export class SoundLibrary {
  private selected = new Set<string>();
  private folder = '*';
  private multi = false;
  private anchor = '';
  private editing?: SoundItem;
  /** Keys being dragged onto a folder: the selection when the tile is part of it. */
  private dragging: string[] = [];
  constructor(readonly kind: SoundKind) {}
  private id(part: string): string { return `snd-${this.kind}-${part}`; }
  private items(): SoundItem[] { return omniSound.list(this.kind); }
  private visible(): SoundItem[] {
    const filter = val(this.id('filter')) || 'all', sort = val(this.id('sort')) || 'added';
    const rows = this.items().filter(item => (this.folder === '*' || item.folder === this.folder) && (filter === 'all' || item.source === filter) && matchesSoundSearch(item, val(this.id('search'))));
    if (sort === 'name') rows.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    if (sort === 'size') rows.sort((a, b) => (b.bytes || 0) - (a.bytes || 0));
    return rows;
  }
  render(): void {
    const list = el(this.id('list')); if (!list) return;
    const items = this.items(), visible = this.visible(), playing = omniSound.player.bgmPlaying ? omniSound.player.bgmKey : '';
    this.selected = new Set([...this.selected].filter(key => items.some(item => item.key === key)));
    el(this.id('search-clear')).hidden = !val(this.id('search'));
    text(this.id('count'), `${visible.length}개 표시 / 전체 ${items.length}개`); text(this.id('total'), String(items.length));
    list.replaceChildren();
    if (!visible.length) { const empty = document.createElement('p'); empty.className = 'char-empty'; empty.style.gridColumn = '1/-1'; empty.textContent = items.length ? '검색·폴더에 맞는 항목이 없습니다.' : `등록된 ${LABEL[this.kind]}이 없습니다. + ${LABEL[this.kind]}로 추가하세요.`; list.append(empty); }
    visible.forEach(item => {
      const on = this.selected.has(item.key), live = this.kind === 'bgm' && playing === item.key;
      const tile = document.createElement('div'); tile.className = 'voice-row snd-row' + (on ? ' selected' : '') + (live ? ' playing' : ''); tile.tabIndex = 0;
      tile.setAttribute('role', 'option'); tile.setAttribute('aria-selected', String(on)); tile.draggable = true;
      // Effects show the glossary words that call them: the list and the glossary describe one thing.
      const words = this.kind === 'sfx' ? wordsFor(item.key) : [];
      tile.innerHTML = `<div class="voice-top"><input type="checkbox" aria-label="${esc(item.name)} 선택" ${on ? 'checked' : ''}><strong title="${esc(item.name)}">${esc(item.name)}</strong></div>`
        + `<p class="voice-tags">${esc(item.tags.join(', ') || '태그 없음')}</p>`
        + (this.kind === 'sfx' ? `<p class="snd-row-words${words.length ? '' : ' none'}" title="이 말이 나오면 이 효과음 (용어집)${words.length ? ': ' + esc(words.join(', ')) : ''}">${words.length ? '용어 · ' + esc(words.slice(0, 6).join(', ')) + (words.length > 6 ? ` 외 ${words.length - 6}` : '') : '용어 없음'}</p>` : '')
        + `<small class="snd-row-meta">▱ ${esc(item.folder || '미분류')} · ${item.source === 'asset' ? '파일' : '주소'}${sizeOf(item) ? ' · ' + sizeOf(item) : ''}</small>`;
      const play = document.createElement('button'); play.type = 'button'; play.className = 'tile-audition tts-listen';
      play.textContent = live ? '⏸' : this.kind === 'bgm' ? '♪' : '▶'; play.title = live ? '정지' : '미리 듣기';
      play.setAttribute('aria-label', `${item.name} ${live ? '정지' : '미리 듣기'}`);
      play.addEventListener('click', event => { event.stopPropagation(); run(async () => {
        if (live) omniSound.player.stopBgm(); else await omniSound.play(item);
        setTimeout(() => this.render(), 50);
      }); });
      tile.append(play);
      const select = (event: MouseEvent | KeyboardEvent) => {
        if (event.target instanceof Element && event.target.closest('.tile-audition')) return;
        if (event.shiftKey && this.anchor) {
          const a = visible.findIndex(v => v.key === this.anchor), b = visible.indexOf(item);
          if (a >= 0) visible.slice(Math.min(a, b), Math.max(a, b) + 1).forEach(v => this.selected.add(v.key));
        } else if (this.multi || event.ctrlKey || event.metaKey || event.target instanceof HTMLInputElement) {
          if (on) this.selected.delete(item.key); else this.selected.add(item.key);
        } else if (on && this.selected.size === 1) { this.edit(item); return; }
        else { this.selected.clear(); this.selected.add(item.key); }
        this.anchor = item.key; this.render();
      };
      tile.addEventListener('click', select);
      tile.addEventListener('dblclick', () => this.edit(item));
      tile.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(event); } });
      tile.addEventListener('dragstart', event => {
        this.dragging = on ? [...this.selected] : [item.key];
        event.dataTransfer?.setData('text/plain', item.name); if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
        tile.classList.add('dragging'); el(this.id('folders'))?.closest('.voice-folders')?.classList.add('drop-ready');
      });
      tile.addEventListener('dragend', () => { this.dragging = []; tile.classList.remove('dragging'); el(this.id('folders'))?.closest('.voice-folders')?.classList.remove('drop-ready'); });
      list.append(tile);
    });
    const count = this.selected.size;
    text(this.id('selected-count'), count ? `선택 ${count}개` : '선택 없음');
    input(this.id('edit')).disabled = count !== 1;
    for (const part of ['delete', 'move', 'clear']) input(this.id(part)).disabled = !count;
    el(this.id('multi')).setAttribute('aria-pressed', String(this.multi));
    const folders = el(this.id('folders')); folders.replaceChildren();
    for (const [key, label] of [['*', `전체 ${LABEL[this.kind]}`], ['', '미분류'], ...soundData().folders[this.kind].map(name => [name, name])] as [string, string][]) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'folder-item' + (key === this.folder ? ' active' : '');
      b.setAttribute('aria-current', String(key === this.folder));
      b.innerHTML = `<span>${esc(label)}</span><span>${items.filter(item => key === '*' || item.folder === key).length}</span>`;
      b.addEventListener('click', () => { this.folder = key; this.selected.clear(); this.render(); });
      // Dropping tiles on a folder moves them there (「전체」 is not a folder).
      if (key !== '*') {
        b.title = '여기로 끌어 놓으면 이 폴더로 옮깁니다';
        b.addEventListener('dragover', event => { if (!this.dragging.length) return; event.preventDefault(); b.classList.add('drop'); });
        b.addEventListener('dragleave', () => b.classList.remove('drop'));
        b.addEventListener('drop', event => { event.preventDefault(); b.classList.remove('drop'); const keys = new Set(this.dragging); this.dragging = []; if (keys.size) run(() => this.moveKeys(keys, key)); });
      }
      folders.append(b);
    }
    input(this.id('folder-edit')).disabled = !this.folder || this.folder === '*';
    // On a phone the folder list is folded: its button names the open folder.
    text(this.id('folder-toggle'), `${this.folder === '*' ? '폴더' : this.folder || '미분류'} ▾`);
  }
  private openDialog(item?: SoundItem): void {
    this.editing = item;
    text('snd-item-title', item ? `${LABEL[this.kind]} 수정` : `${LABEL[this.kind]} 추가`);
    text('snd-item-save', item ? '저장' : '추가');
    set('snd-item-name', item?.name || ''); set('snd-item-tags', item?.tags.join(', ') || '');
    el('snd-item-terms-wrap').hidden = this.kind !== 'sfx'; set('snd-item-terms', item && this.kind === 'sfx' ? wordsFor(item.key).join(', ') : '');
    const folder = el<HTMLSelectElement>('snd-item-folder');
    folder.innerHTML = ['', ...soundData().folders[this.kind]].map(name => `<option value="${esc(name)}">${esc(name || '미분류')}</option>`).join('');
    folder.value = item?.folder ?? (this.folder === '*' ? '' : this.folder);
    // A registered file or address cannot be swapped in place; editing changes the label only.
    for (const id of ['snd-item-source', 'snd-item-url', 'snd-item-file']) input(id).disabled = !!item;
    // ElevenLabs makes both: a sound effect, or instrumental music for BGM.
    const bgm = this.kind === 'bgm';
    text('snd-item-prompt-label', bgm ? '만들 BGM 설명 · 영어가 가장 정확합니다 (가사 없는 연주곡)' : '만들 효과음 설명 · 영어가 가장 정확합니다');
    input('snd-item-prompt').placeholder = bgm ? 'calm lo-fi piano for a rainy cafe, slow, loopable' : 'heavy wooden door slamming shut';
    input('snd-item-duration').max = bgm ? '600' : '30';
    set('snd-item-source', item?.source === 'asset' ? 'file' : 'url'); set('snd-item-prompt', ''); set('snd-item-duration', 0); set('snd-item-url', item?.url || ''); input('snd-item-file').value = '';
    this.syncSource(); text('snd-item-status', '');
    el('snd-item-dialog').dataset.kind = this.kind;
    dialog('snd-item-dialog');
  }
  syncSource(): void {
    const source = val('snd-item-source');
    el('snd-item-url-wrap').hidden = source !== 'url'; el('snd-item-file-wrap').hidden = source !== 'file'; el('snd-item-prompt-wrap').hidden = source !== 'eleven';
  }
  edit(item: SoundItem): void { this.openDialog(item); }
  async save(): Promise<void> {
    const name = val('snd-item-name'), tags = val('snd-item-tags'), folder = val('snd-item-folder'), words = soundTags(val('snd-item-terms'));
    if (this.editing) {
      Object.assign(this.editing, { name: name.trim() || this.editing.name, tags: soundTags(tags), folder });
      if (this.kind === 'sfx') setWordsFor(this.editing.key, words);
      await saveSoundData(); dialog('snd-item-dialog', false); this.render(); return;
    }
    text('snd-item-status', '확인하는 중…');
    const file = input('snd-item-file').files?.[0];
    try {
      if (val('snd-item-source') === 'file' && !file) throw new Error('파일을 골라 주세요.');
      if (val('snd-item-source') === 'eleven') text('snd-item-status', 'ElevenLabs에서 만드는 중…');
      const item = val('snd-item-source') === 'eleven'
        ? await omniSound.addFromEleven(this.kind, { name, tags, folder, prompt: val('snd-item-prompt'), duration: Number(val('snd-item-duration')) || 0 })
        : val('snd-item-source') === 'file'
        ? await omniSound.addFromFile(this.kind, { name, tags, folder, file: file! })
        : await omniSound.addFromUrl(this.kind, { name: name || decodeURIComponent(val('snd-item-url').split('/').pop() || '').replace(/\.[^.]+$/, ''), tags, folder, url: val('snd-item-url') });
      if (this.kind === 'sfx' && words.length) { setWordsFor(item.key, words); await saveSoundData(); }
      dialog('snd-item-dialog', false); this.render(); notify(`${LABEL[this.kind]} 추가: ${item.name}`);
    } catch (error) { text('snd-item-status', String((error as Error).message || error)); }
  }
  private on(part: string, action: () => void | Promise<unknown>, type = 'click'): void { el(this.id(part))?.addEventListener(type, () => run(action)); }
  bind(): void {
    this.on('search', () => this.render(), 'input');
    this.on('search-clear', () => { set(this.id('search'), ''); this.render(); });
    this.on('filter', () => this.render(), 'change'); this.on('sort', () => this.render(), 'change');
    this.on('add', () => this.openDialog());
    this.on('multi', () => { this.multi = !this.multi; this.render(); });
    this.on('select-all', () => { this.visible().forEach(item => this.selected.add(item.key)); this.render(); });
    this.on('clear', () => { this.selected.clear(); this.render(); });
    this.on('edit', () => { const item = this.items().find(i => this.selected.has(i.key)); if (item) this.edit(item); });
    this.on('delete', async () => {
      if (!this.selected.size || !confirm(`선택한 ${LABEL[this.kind]} ${this.selected.size}개를 삭제할까요? 모듈 파일 연결도 함께 지웁니다.`)) return;
      await omniSound.remove(this.kind, this.selected); this.selected.clear(); this.render();
    });
    this.on('move', () => {
      el<HTMLSelectElement>('snd-move-target').innerHTML = ['', ...soundData().folders[this.kind]].map(name => `<option value="${esc(name)}">${esc(name || '미분류')}</option>`).join('');
      el('snd-move-dialog').dataset.kind = this.kind; dialog('snd-move-dialog');
    });
    this.on('folder-toggle', () => { const box = el(this.id('folders')).closest('.voice-folders'); box?.classList.toggle('folders-open'); el(this.id('folder-toggle')).setAttribute('aria-expanded', String(!!box?.classList.contains('folders-open'))); });
    this.on('folder-add', async () => {
      const name = prompt('새 폴더 이름')?.trim(); if (!name) return;
      const folders = soundData().folders[this.kind]; if (!folders.includes(name)) folders.push(name);
      this.folder = name; await saveSoundData(); this.render();
    });
    this.on('folder-edit', async () => {
      const old = this.folder; if (!old || old === '*') return;
      const next = prompt(`폴더 이름 바꾸기 (비우면 폴더 삭제 · 항목은 미분류로)`, old);
      if (next == null) return;
      const name = next.trim(), folders = soundData().folders[this.kind];
      if (name && name !== old && folders.includes(name)) throw new Error('같은 이름의 폴더가 있습니다.');
      soundData().folders[this.kind] = name ? folders.map(f => f === old ? name : f) : folders.filter(f => f !== old);
      for (const item of this.items()) if (item.folder === old) item.folder = name;
      this.folder = name || '*'; await saveSoundData(); this.render();
    });
    this.on('export', () => download({ kind: this.kind, items: this.items(), folders: soundData().folders[this.kind] }, `omni-${this.kind}.json`));
    this.on('import', () => input(this.id('file')).click());
    this.on('file', async () => {
      const file = input(this.id('file')).files?.[0]; if (!file) return;
      const raw = await readJson(file) as { items?: unknown; folders?: unknown };
      // Same normalisation as stored data; links and files already in this Risu are kept, duplicates skipped.
      const parsed = normalizeSoundData({ [this.kind]: raw.items, folders: { [this.kind]: raw.folders } });
      const list = this.items(), seen = new Set(list.map(item => item.url || item.assetPath));
      const fresh = parsed[this.kind].filter(item => !seen.has(item.url || item.assetPath)).map(item => ({ ...item, key: uuid() }));
      list.push(...fresh);
      for (const name of parsed.folders[this.kind]) if (!soundData().folders[this.kind].includes(name)) soundData().folders[this.kind].push(name);
      input(this.id('file')).value = ''; await saveSoundData(); this.render(); notify(`${LABEL[this.kind]} ${fresh.length}개를 가져왔습니다.`);
    }, 'change');
    this.render();
  }
  async moveSelected(target: string): Promise<void> { await this.moveKeys(this.selected, target); }
  private async moveKeys(keys: ReadonlySet<string>, target: string): Promise<void> {
    let moved = 0;
    for (const item of this.items()) if (keys.has(item.key) && item.folder !== target) { item.folder = target; moved++; }
    if (!moved) return;
    await saveSoundData(); this.render(); notify(`${moved}개를 「${target || '미분류'}」로 옮겼습니다.`);
  }
}
