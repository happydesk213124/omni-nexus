import type { TtsVoice } from '../core/tts-types';
import { uuid } from '../core/util/text';
import { ttsData, updateTtsSettings } from '../storage/tts-store';
import { fishVoiceId, matchesVoiceSearch, parseVoiceImport } from '../domain/tts/library';
import { fetchFishVoice as fishVoiceMetadata } from '../providers/tts/fish';
import { numberedVoices } from '../providers/tts/selection';
import { el, input, val, set, text, list, gender, genderLabel, esc, on, onForm, dialog, button, persist, listenButton, auditionButton, openExternal, download, readJson, notify } from './common';

export class TtsLibrary {
  selected = new Set<string>();
  folder = '*';
  private multi = false;
  private anchor = '';
  private editing = '';
  private pick?: (voice: TtsVoice) => void;
  private pendingImport?: unknown;
  constructor(private tab: (name: string) => void) {}
  visible(): TtsVoice[] { return ttsData().voices.filter(v => (this.folder === '*' || v.folder === this.folder) && (val('gender-filter') === 'all' || v.gender === gender(val('gender-filter'))) && matchesVoiceSearch(v, val('voice-search'))).sort((a,b) => val('voice-sort') === 'name' ? a.name.localeCompare(b.name) : 0); }
  pickVoice(callback: (voice: TtsVoice) => void): void { this.pick = callback; this.selected.clear(); text('tab-voices', '음성 목록 (선택 중)'); this.tab('tts-voices'); this.render(); }
  private applyPick(): void { const voice = ttsData().voices.find(v => this.selected.has(v.key)); if (voice && this.pick) { const callback = this.pick; this.pick = undefined; text('tab-voices', '음성 목록'); callback(voice); this.render(); } }
  render(): void {
    const data = ttsData(), visible = this.visible(), numbers = new Map(numberedVoices(data.voices).map(v => [v.voice.key, v.number]));
    this.selected = new Set([...this.selected].filter(key => data.voices.some(v => v.key === key)));
    const root = el('voice-list'); if (!root) return;
    el('clear-voice-search').hidden = !val('voice-search');
    root.replaceChildren(); text('voice-count', `${visible.length}개 표시 / 전체 ${data.voices.length}개`); text('voice-total', `${data.voices.length}`);
    for (const voice of visible) {
      const tile = document.createElement('div'); tile.className = 'voice-row' + (this.selected.has(voice.key) ? ' selected' : ''); tile.tabIndex = 0; tile.setAttribute('role', 'option'); tile.setAttribute('aria-selected', String(this.selected.has(voice.key)));
      tile.innerHTML = `<div class="voice-top"><input type="checkbox" aria-label="${esc(voice.name)} 선택" ${this.selected.has(voice.key) ? 'checked' : ''}><small>${numbers.get(voice.key)}</small>${data.settings.narrationVoice === voice.key ? '<small class="voice-narrator-badge">나레이션</small>' : ''}</div><strong>${esc(voice.name)}</strong><p class="voice-tags">${esc(voice.tags.join(', '))}</p><small class="voice-folder-label">▱ ${esc(voice.folder || '미분류')}</small>`;
      const listen = listenButton(() => ({ fishId: voice.fishId })); listen.classList.add('tile-audition'); tile.append(listen);
      const select = (event: MouseEvent | KeyboardEvent) => {
        if (!ttsData().settings.enabled) return;
        if (event.target instanceof Element && event.target.closest('.tile-audition')) return;
        if (this.pick && this.selected.has(voice.key) && !event.shiftKey) { this.applyPick(); return; }
        if (event.shiftKey && this.anchor) { const a = visible.findIndex(v => v.key === this.anchor), b = visible.indexOf(voice); if (a >= 0) visible.slice(Math.min(a,b), Math.max(a,b)+1).forEach(v => this.selected.add(v.key)); }
        else if (this.multi || event.ctrlKey || event.metaKey || event.target instanceof HTMLInputElement) { if (this.selected.has(voice.key)) this.selected.delete(voice.key); else this.selected.add(voice.key); }
        else if (!this.pick && this.selected.has(voice.key)) { this.edit(voice); return; }
        else { this.selected.clear(); this.selected.add(voice.key); }
        this.anchor = voice.key; this.render();
      };
      tile.addEventListener('click', select); tile.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(event); } }); tile.addEventListener('dblclick', () => { if (ttsData().settings.enabled) this.pick ? this.applyPick() : this.edit(voice); }); root.append(tile);
    }
    const count = this.selected.size;
    text('voice-selected-count', `선택 ${count}개`); input('edit-selected-voice').disabled = count !== 1; input('selected-narrator').disabled = count !== 1;
    for (const id of ['delete-selected-voices', 'move-selected-voices', 'clear-voice-selection']) input(id).disabled = !count;
    input('apply-picked-voice').disabled = count !== 1; el('apply-picked-voice').hidden = !this.pick; el('cancel-picked-voice').hidden = !this.pick;
    el('voice-multiselect').setAttribute('aria-pressed', String(this.multi));
    const folders = el('voice-folder-list'); folders.replaceChildren();
    for (const [key, label] of [['*','전체 음성'], ['', '미분류'], ...data.folders.map(f => [f,f])]) { const b = button(`${label} ${data.voices.filter(v => key === '*' || v.folder === key).length}`, () => { this.folder = key; this.selected.clear(); this.render(); }); b.className = 'folder-item' + (key === this.folder ? ' active' : ''); folders.append(b); }
    input('edit-voice-folder').disabled = !this.folder || this.folder === '*';
  }
  private edit(voice?: TtsVoice): void { this.editing = voice?.key || '';text('voice-dialog-title',voice?'음성 수정':'음성 추가');text('voice-submit',voice?'저장':'추가'); set('v-name', voice?.name); set('v-id', voice?.fishId); set('v-tags', voice?.tags.join(', ')); set('v-gender', genderLabel(voice?.gender || 'unknown')); dialog('voice-dialog'); }
  bind(): void {
    for (const id of ['voice-search', 'gender-filter', 'voice-sort']) on(id, () => this.render(), id === 'voice-search' ? 'input' : 'change');
    on('clear-voice-search', () => { set('voice-search',''); this.render(); });
    on('voice-multiselect', () => { this.multi = !this.multi; this.render(); });
    on('select-visible-voices', () => { this.visible().forEach(v => this.selected.add(v.key)); this.render(); });
    on('clear-voice-selection', () => { this.selected.clear(); this.render(); });
    on('apply-picked-voice', () => this.applyPick());
    on('cancel-picked-voice', () => { this.pick = undefined; text('tab-voices','음성 목록'); this.tab('tts-characters'); dialog('character-dialog'); this.render(); });
    on('add-voice', () => this.edit()); on('edit-selected-voice', () => this.edit(ttsData().voices.find(v => this.selected.has(v.key))));
    on('selected-narrator', async () => { await updateTtsSettings({ narrationVoice: [...this.selected][0] }); this.render(); });
    auditionButton(el<HTMLButtonElement>('test-voice-editor'), () => ({ fishId: fishVoiceId(val('v-id')) }));
    el('voice-form').querySelector<HTMLButtonElement>('button[type="submit"]')?.setAttribute('id','voice-submit');
    const fishLink = el('tts-voices')?.querySelector<HTMLAnchorElement>('a[href*="fish.audio"]');
    if (fishLink) openExternal(fishLink, notify);
    on('v-fetch', async () => { const metadata = await fishVoiceMetadata(val('v-id'), ttsData().settings); set('v-id', metadata.fishId); set('v-name', metadata.name); set('v-tags', metadata.tags.join(', ')); set('v-gender', genderLabel(metadata.gender)); });
    onForm('voice-form', async () => {
      const fishId = fishVoiceId(val('v-id')), name = val('v-name').trim(); if (!fishId || !name) throw new Error('이름과 올바른 Fish ID 또는 링크를 입력해 주세요.');
      const old = ttsData().voices.find(v => v.key === this.editing);
      const voice: TtsVoice = { key: old?.key || uuid(), name, fishId, tags: list(val('v-tags')), gender: gender(val('v-gender')), folder: old?.folder || (this.folder === '*' ? '' : this.folder) };
      if (old) Object.assign(old, voice); else ttsData().voices.push(voice);
      await persist(); dialog('voice-dialog', false); this.render();
    });
    on('delete-selected-voices', () => { text('voice-delete-message', `선택한 음성 ${this.selected.size}개를 삭제할까요? 캐릭터의 직접 Fish ID는 유지됩니다.`); text('voice-delete-names', ttsData().voices.filter(v => this.selected.has(v.key)).map(v => v.name).join(', ')); dialog('voice-delete-dialog'); });
    on('confirm-voice-delete', async () => { ttsData().voices = ttsData().voices.filter(v => !this.selected.has(v.key)); if (this.selected.has(ttsData().settings.narrationVoice)) ttsData().settings.narrationVoice = ''; await persist(); dialog('voice-delete-dialog',false); this.render(); });
    const folderOptions = () => ['', ...ttsData().folders].map(f => `<option value="${esc(f)}">${esc(f || '미분류')}</option>`).join('');
    on('move-selected-voices', () => { el('voice-move-target').innerHTML = folderOptions(); text('voice-move-count',`${this.selected.size}개 이동`); dialog('voice-move-dialog'); });
    on('confirm-voice-move', async () => { ttsData().voices.filter(v => this.selected.has(v.key)).forEach(v => v.folder = val('voice-move-target')); await persist(); dialog('voice-move-dialog',false); this.render(); });
    let oldFolder = '';
    on('new-voice-folder', () => { oldFolder = ''; set('voice-folder-name',''); el('remove-voice-folder').hidden = true; dialog('voice-folder-dialog'); });
    on('edit-voice-folder', () => { oldFolder = this.folder; set('voice-folder-name', oldFolder); el('remove-voice-folder').hidden = false; dialog('voice-folder-dialog'); });
    onForm('voice-folder-form', async () => { const name = val('voice-folder-name').trim(); if (!name || (name !== oldFolder && ttsData().folders.includes(name))) throw new Error('중복되지 않는 폴더 이름을 입력해 주세요.'); if (oldFolder) { ttsData().folders = ttsData().folders.map(f => f === oldFolder ? name : f); ttsData().voices.filter(v => v.folder === oldFolder).forEach(v => v.folder = name); } else ttsData().folders.push(name); this.folder = name; await persist(); dialog('voice-folder-dialog',false); this.render(); });
    on('remove-voice-folder', async () => { if (!confirm('폴더를 삭제하고 안의 음성은 미분류로 옮길까요?')) return; ttsData().voices.filter(v => v.folder === oldFolder).forEach(v => v.folder = ''); ttsData().folders = ttsData().folders.filter(f => f !== oldFolder); this.folder = '*'; await persist(); dialog('voice-folder-dialog',false); this.render(); });
    on('export-voice', () => download({ voices: ttsData().voices }, 'omnitts-voices.json'));
    on('export-voice-folder', () => download({ name: this.folder === '*' ? '전체 음성' : this.folder || '미분류', voices: ttsData().voices.filter(v => this.folder === '*' || v.folder === this.folder) }, 'omnitts-folder.json'));
    on('import-voice', () => input('voice-file').click()); on('import-voice-folder', () => input('voice-folder-file').click());
    on('voice-file', async () => { const file = input('voice-file').files?.[0]; if (!file) return; const rows = parseVoiceImport(await readJson(file), this.folder === '*' ? '' : this.folder); ttsData().voices.push(...rows); await persist(); input('voice-file').value = ''; this.render(); }, 'change');
    on('voice-folder-file', async () => { const file = input('voice-folder-file').files?.[0]; if (!file) return; this.pendingImport = await readJson(file); parseVoiceImport(this.pendingImport); set('folder-import-name', file.name.replace(/\.json$/i,'')); dialog('folder-import-dialog'); input('voice-folder-file').value = ''; }, 'change');
    onForm('folder-import-form', async () => { const name = val('folder-import-name').trim(); if (!name || ttsData().folders.includes(name)) throw new Error('새 폴더 이름을 입력해 주세요.'); const voices = parseVoiceImport(this.pendingImport, name); ttsData().folders.push(name); ttsData().voices.push(...voices); this.folder = name; await persist(); dialog('folder-import-dialog',false); this.render(); });
    on('voice-folder-toggle', () => { el('voice-folder-list').closest('.voice-folders')?.classList.toggle('folders-open'); });
    this.render();
  }
}
