import type { SoundItem, SoundKind } from '../core/sound-types';
import { soundData, saveSoundData } from '../storage/sound-store';
import { omniSound } from '../services/sound-runtime';
import { soundTags } from '../domain/sound/tags';
import { el, input, val, set, text, esc, dialog, run, notify } from '../tts-ui/common';

const LABEL: Record<SoundKind, string> = { bgm: 'BGM', sfx: '효과음' };

/** One tile list (BGM or effects): search, folders, multi-select, preview, add/edit/delete. */
export class SoundLibrary {
  private selected = new Set<string>();
  private folder = '*';
  constructor(readonly kind: SoundKind) {}
  private id(part: string): string { return `snd-${this.kind}-${part}`; }
  private items(): SoundItem[] { return omniSound.list(this.kind); }
  private visible(): SoundItem[] {
    const terms = val(this.id('search')).toLowerCase().split(/\s+/).filter(Boolean);
    return this.items().filter(item => (this.folder === '*' || item.folder === this.folder)
      && terms.every(term => [item.name, ...item.tags].some(word => word.toLowerCase().includes(term))));
  }
  render(): void {
    const list = el(this.id('list')); if (!list) return;
    const items = this.items(), visible = this.visible();
    this.selected = new Set([...this.selected].filter(key => items.some(item => item.key === key)));
    text(this.id('count'), `${visible.length}개 표시 / 전체 ${items.length}개`);
    list.replaceChildren();
    if (!visible.length) { const empty = document.createElement('p'); empty.className = 'char-empty'; empty.textContent = items.length ? '검색·폴더에 맞는 항목이 없습니다.' : `등록된 ${LABEL[this.kind]}이 없습니다. + ${LABEL[this.kind]}로 추가하세요.`; list.append(empty); }
    for (const item of visible) {
      const on = this.selected.has(item.key);
      const tile = document.createElement('div'); tile.className = 'voice-row' + (on ? ' selected' : ''); tile.tabIndex = 0; tile.setAttribute('role', 'option'); tile.setAttribute('aria-selected', String(on));
      const where = item.source === 'asset' ? `파일 · ${((item.bytes || 0) / 1048576).toFixed(1)}MB` : '주소';
      tile.innerHTML = `<div class="voice-top"><input type="checkbox" aria-label="${esc(item.name)} 선택" ${on ? 'checked' : ''}><small>${esc(where)}</small></div><strong>${esc(item.name)}</strong><span>${esc(item.tags.join(', ') || '태그 없음')}</span>`;
      const play = document.createElement('button'); play.type = 'button'; play.className = 'tile-audition'; play.textContent = this.kind === 'bgm' ? '♪' : '▶';
      play.title = '미리 듣기'; play.setAttribute('aria-label', `${item.name} 미리 듣기`);
      play.addEventListener('click', event => { event.stopPropagation(); run(async () => {
        if (this.kind === 'bgm' && omniSound.player.bgmKey === item.key && omniSound.player.bgmPlaying) { omniSound.player.stopBgm(); return; }
        await omniSound.play(item);
      }); });
      tile.append(play);
      tile.addEventListener('click', event => { if (event.target instanceof Element && event.target.closest('.tile-audition')) return; if (on) this.selected.delete(item.key); else this.selected.add(item.key); this.render(); });
      tile.addEventListener('dblclick', () => this.edit(item));
      tile.addEventListener('keydown', event => { if (event.key === 'Enter') this.edit(item); if (event.key === ' ') { event.preventDefault(); tile.click(); } });
      list.append(tile);
    }
    input(this.id('delete')).disabled = !this.selected.size;
    const folders = el(this.id('folders')); folders.replaceChildren();
    const names = soundData().folders[this.kind];
    for (const [key, label] of [['*', '전체'], ['', '미분류'], ...names.map(name => [name, name])] as [string, string][]) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'folder-item' + (key === this.folder ? ' active' : '');
      b.textContent = `${label} ${items.filter(item => key === '*' || item.folder === key).length}`;
      b.addEventListener('click', () => { this.folder = key; this.selected.clear(); this.render(); });
      folders.append(b);
    }
  }
  private editing?: SoundItem;
  private openDialog(item?: SoundItem): void {
    this.editing = item;
    text('snd-item-title', item ? `${LABEL[this.kind]} 수정` : `${LABEL[this.kind]} 추가`);
    text('snd-item-save', item ? '저장' : '추가');
    set('snd-item-name', item?.name || ''); set('snd-item-tags', item?.tags.join(', ') || '');
    const folder = el<HTMLSelectElement>('snd-item-folder');
    folder.innerHTML = ['', ...soundData().folders[this.kind]].map(name => `<option value="${esc(name)}">${esc(name || '미분류')}</option>`).join('');
    folder.value = item?.folder ?? (this.folder === '*' ? '' : this.folder);
    // A registered file or address cannot be swapped in place; editing changes the label only.
    for (const id of ['snd-item-source', 'snd-item-url', 'snd-item-file']) input(id).disabled = !!item;
    set('snd-item-source', item?.source === 'asset' ? 'file' : 'url'); set('snd-item-url', item?.url || ''); input('snd-item-file').value = '';
    this.syncSource(); text('snd-item-status', item?.source === 'url' ? item.url || '' : '');
    el('snd-item-dialog').dataset.kind = this.kind;
    dialog('snd-item-dialog');
  }
  syncSource(): void { const file = val('snd-item-source') === 'file'; el('snd-item-url-wrap').hidden = file; el('snd-item-file-wrap').hidden = !file; }
  edit(item: SoundItem): void { this.openDialog(item); }
  add(): void { this.openDialog(); }
  async save(): Promise<void> {
    const name = val('snd-item-name'), tags = val('snd-item-tags'), folder = val('snd-item-folder');
    if (this.editing) {
      Object.assign(this.editing, { name: name.trim() || this.editing.name, tags: soundTags(tags), folder });
      await saveSoundData(); dialog('snd-item-dialog', false); this.render(); return;
    }
    text('snd-item-status', '확인하는 중…');
    const file = input('snd-item-file').files?.[0];
    try {
      const item = val('snd-item-source') === 'file'
        ? (file ? await omniSound.addFromFile(this.kind, { name, tags, folder, file }) : (() => { throw new Error('파일을 골라 주세요.'); })())
        : await omniSound.addFromUrl(this.kind, { name: name || val('snd-item-url').split('/').pop()?.replace(/\.[^.]+$/, '') || '', tags, folder, url: val('snd-item-url') });
      dialog('snd-item-dialog', false); this.render(); notify(`${LABEL[this.kind]} 추가: ${item.name}`);
    } catch (error) { text('snd-item-status', String((error as Error).message || error)); }
  }
  bind(): void {
    el(this.id('search'))?.addEventListener('input', () => this.render());
    el(this.id('add'))?.addEventListener('click', () => this.add());
    el(this.id('delete'))?.addEventListener('click', () => run(async () => {
      if (!this.selected.size || !confirm(`선택한 ${LABEL[this.kind]} ${this.selected.size}개를 삭제할까요?`)) return;
      await omniSound.remove(this.kind, this.selected); this.selected.clear(); this.render();
    }));
    el(this.id('folder-add'))?.addEventListener('click', () => run(async () => {
      const name = prompt('새 폴더 이름')?.trim(); if (!name) return;
      const folders = soundData().folders[this.kind]; if (!folders.includes(name)) folders.push(name);
      await saveSoundData(); this.render();
    }));
    this.render();
  }
}
