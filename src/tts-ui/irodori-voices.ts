import type { TtsVoice } from '../core/tts-types';
import { uuid } from '../core/util/text';
import { ttsData } from '../storage/tts-store';
import { omniTts } from '../services/tts-runtime';
import { matchesVoiceSearch } from '../domain/tts/library';
import { missingIrodoriStarters } from '../domain/tts/irodori-starter';
import { newIrodoriPresets } from '../domain/tts/irodori-presets';
import { ttsNameKey } from '../domain/tts/identity';
import { writeIrodoriVoice } from '../services/irodori-voice-writer';
import { blankTtsCharacter } from '../services/tts-characters';
import { currentTtsContext, type TtsChatContext } from '../services/tts-context';
import { LLM_MODEL_CHOICES, llmForChoice } from './llm-actions';
import { translateTts } from '../providers/tts/translation';
import { IRODORI_VOICES_TAB } from './irodori-markup';
import { designIrodoriVoice, irodoriDefaultVoice, irodoriNoRef, irodoriVoiceSlug, listIrodoriVoices, uploadIrodoriVoice } from '../providers/tts/irodori';
import { el, input, val, set, text, list, gender, genderLabel, esc, on, onForm, dialog, persist, listenButton, auditionButton, notify, checked, download, readJson } from './common';

/** The open bot itself, where it has no TTS card of its own to name. */
const BOT = '@bot';

/**
 * Irodori's voice presets. A preset is a name, a gender and tags (what the assignment engines choose by) over one
 * voice kept on the user's server. That voice is one already there, a recording sent up from here, or one designed
 * from a description: a designed voice differs every time it is made, so the one liked is sent back to the server
 * as a recording and the preset names that.
 */
export class IrodoriVoices {
  private editing = '';
  /** The designed voice last heard, until it is kept or the sheet is opened for another preset. */
  private sample?: ArrayBuffer;
  private plays = 0;
  /** The starter set is being made; `halt`: asked to stop after the voice in hand. */
  private making = false;
  private halt = false;
  /** The open chat, as read when the sheet was opened: whose description and lorebook a voice is written from. */
  private context: TtsChatContext | null = null;
  /** Chosen presets, as in 음성 목록: a click picks one, Ctrl/⌘ or 다중선택 adds, Shift takes the run between. */
  private selected = new Set<string>();
  private multi = false;
  private anchor = '';
  /** A card is choosing its voice here (캐릭터 › 목록에서 선택), as 음성 목록 is chosen from under Fish. */
  private picking?: { done: (voice: TtsVoice) => void; cancel: () => void };
  constructor(private tab: (name: string) => void = () => undefined) {}
  pickVoice(done: (voice: TtsVoice) => void, cancel: () => void): void {
    this.picking = { done, cancel }; this.selected.clear(); text('tab-irodori-voices', 'Irodori 목소리 (선택 중)');
    this.tab(IRODORI_VOICES_TAB); this.render();
  }
  private endPick(): { done: (voice: TtsVoice) => void; cancel: () => void } | undefined {
    const picking = this.picking; this.picking = undefined; text('tab-irodori-voices', 'Irodori 목소리'); return picking;
  }
  private applyPick(): void {
    const voice = ttsData().irodoriVoices.find(v => this.selected.has(v.key));
    if (voice && this.picking) { this.endPick()!.done(voice); this.selected.clear(); this.render(); }
  }

  private visible(): TtsVoice[] {
    const all = ttsData().irodoriVoices, sort = val('iv-sort'), wanted = val('iv-gender-filter') || 'all';
    const shown = all.filter(v => (wanted === 'all' || v.gender === gender(wanted)) && matchesVoiceSearch(v, val('iv-search')));
    const order = { female: 0, male: 1, unknown: 2 } as const;
    return sort === 'name' ? shown.sort((a, b) => a.name.localeCompare(b.name, 'ko'))
      : sort === 'gender' ? shown.sort((a, b) => order[a.gender] - order[b.gender] || a.name.localeCompare(b.name, 'ko')) : shown;
  }
  render(): void {
    const root = el('iv-list'); if (!root) return;
    const all = ttsData().irodoriVoices, visible = this.visible(), fallback = irodoriDefaultVoice(this.settings());
    this.selected = new Set([...this.selected].filter(key => all.some(v => v.key === key)));
    text('iv-count', `${visible.length}개 표시 / 전체 ${all.length}개`);
    this.renderSelection();
    root.replaceChildren();
    if (!visible.length) {
      const empty = document.createElement('p'); empty.className = 'iv-empty';
      empty.textContent = all.length ? '검색에 맞는 목소리가 없습니다.' : `아직 프리셋이 없습니다. 지금은 모든 대사를 기본 목소리(${fallback})로 읽습니다. 기본 세트 만들기를 누르면 성별·나이·성격별 목소리가 채워지고, + 목소리로 하나씩 만들 수도 있습니다.`;
      root.append(empty); return;
    }
    const numbers = new Map(all.map((v, i) => [v.key, i + 1]));
    for (const voice of visible) {
      const picked = this.selected.has(voice.key), users = ttsData().characters.filter(c => c.irodoriKey === voice.key).length;
      const row = document.createElement('div'); row.className = 'voice-row iv-row'; row.tabIndex = 0; row.dataset.key = voice.key;
      row.setAttribute('role', 'option'); row.setAttribute('aria-selected', String(picked));
      row.innerHTML = `<div class="voice-top"><input type="checkbox" aria-label="${esc(voice.name)} 선택" ${picked ? 'checked' : ''}><small>${numbers.get(voice.key)}</small></div><strong>${esc(voice.name)}</strong><small>${esc([genderLabel(voice.gender), ...voice.tags].join(', '))}</small><small>ID ${esc(voice.fishId || '없음')}${users ? ` · 캐릭터 ${users}명` : ''}</small><div class="actions"></div>`;
      const listen = listenButton(() => ({ fishId: voice.fishId, engine: 'irodori' }));
      // Hearing a voice is not choosing it.
      listen.addEventListener('click', event => event.stopPropagation()); listen.addEventListener('dblclick', event => event.stopPropagation());
      row.querySelector('.actions')!.append(listen);
      row.addEventListener('click', event => this.pick(voice, visible, event));
      row.addEventListener('keydown', event => { if (event.target === row && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); this.pick(voice, visible, event); } });
      row.addEventListener('dblclick', () => { if (this.picking) { this.selected.clear(); this.selected.add(voice.key); this.applyPick(); } else this.edit(voice); });
      root.append(row);
    }
  }
  private pick(voice: TtsVoice, visible: TtsVoice[], event: MouseEvent | KeyboardEvent): void {
    const toggle = this.multi || event.ctrlKey || event.metaKey || event.target instanceof HTMLInputElement;
    if (event.shiftKey && this.anchor) {
      const a = visible.findIndex(v => v.key === this.anchor), b = visible.indexOf(voice);
      if (a >= 0) visible.slice(Math.min(a, b), Math.max(a, b) + 1).forEach(v => this.selected.add(v.key));
    } else if (toggle) { if (!this.selected.delete(voice.key)) this.selected.add(voice.key); }
    // A second click on the one already chosen opens it, as in 음성 목록.
    else if (this.selected.size === 1 && this.selected.has(voice.key)) { if (this.picking) this.applyPick(); else this.edit(voice); return; }
    else { this.selected.clear(); this.selected.add(voice.key); }
    this.anchor = voice.key; this.render();
  }
  private renderSelection(): void {
    const count = this.selected.size;
    text('iv-selected-count', count ? `선택 ${count}개` : '선택 없음');
    el('iv-multiselect').setAttribute('aria-pressed', String(this.multi));
    input('iv-edit-selected').disabled = count !== 1;
    el('iv-apply-picked').hidden = !this.picking; el('iv-cancel-picked').hidden = !this.picking; input('iv-apply-picked').disabled = count !== 1;
    for (const id of ['iv-clear-selection', 'iv-delete-selected']) input(id).disabled = !count;
  }
  private status(message: string): void { text('iv-status', message); }
  private settings() { return { irodori: ttsData().settings.irodori }; }
  private edit(voice?: TtsVoice): void {
    this.editing = voice?.key || ''; this.sample = undefined; input('iv-keep').disabled = true;
    text('iv-dialog-title', voice ? 'Irodori 목소리 수정' : 'Irodori 목소리 추가');
    set('iv-name', voice?.name); set('iv-gender', genderLabel(voice?.gender || 'unknown')); set('iv-tags', voice?.tags.join(', ')); set('iv-id', voice?.fishId); set('iv-caption', voice?.caption);
    set('iv-request', ''); input('iv-bind').checked = !voice;
    this.status(''); dialog('irodori-voice-dialog');
    void this.fillWho().catch(() => undefined);
  }
  /** Whom a voice can be written for: nobody (the request alone), the open bot, its TTS cards and the shared ones. */
  private async fillWho(): Promise<void> {
    const select = el<HTMLSelectElement>('iv-who');
    select.innerHTML = '<option value="">캐릭터 없이 · 요청만으로</option>'; this.showBind();
    // The bot's name and description are all that is read of it here: no whole read of the bot for a list of names.
    this.context = await currentTtsContext({ chatOnly: true }).catch(() => null);
    const scope = this.context?.rosterScope, bot = String(this.context?.character.name || '').trim();
    const cards = ttsData().characters.filter(c => !c.role && c.name.trim() && (c.scope === scope || c.scope === 'global'));
    const rows: [string, string][] = [...(bot && !cards.some(c => ttsNameKey(c.name) === ttsNameKey(bot)) ? [[BOT, `${bot} · 현재 봇`] as [string, string]] : []), ...cards.map(c => [c.id, c.name] as [string, string])];
    select.insertAdjacentHTML('beforeend', rows.map(([value, label]) => `<option value="${esc(value)}">${esc(label)}</option>`).join(''));
    // With nothing typed, the sheet writes for the bot in front of the reader.
    select.value = rows[0]?.[0] ?? ''; this.showBind();
  }
  /** The card chosen in the sheet, when it is one (not the bot by its title, which has no card). */
  private card() { const id = val('iv-who'); return id && id !== BOT ? ttsData().characters.find(c => c.id === id) : undefined; }
  private botName(): string { return val('iv-who') === BOT ? String(this.context?.character.name || '').trim() : ''; }
  private showBind(): void { el('iv-bind-wrap').hidden = !this.card() && !this.botName(); }
  /**
   * The card a kept voice is given to. The bot with no card of its own gets one now, under its name in this bot's
   * roster: without it the voice was saved and spoken by nobody, and the bot kept whatever voice it was given before.
   */
  private bindTarget() {
    const card = this.card(); if (card) return card;
    const name = this.botName(); if (!name) return undefined;
    const scope = this.context?.rosterScope || 'global';
    const found = ttsData().characters.find(c => !c.role && (c.scope === scope || c.scope === 'global') && ttsNameKey(c.name) === ttsNameKey(name));
    if (found) return found;
    const made = blankTtsCharacter(scope, name); ttsData().characters.push(made); return made;
  }
  /** The model writes the sheet (name if empty, gender, tags, description), and the voice is made and heard at once. */
  private async write(): Promise<void> {
    const card = this.card(), who = card ? [card.name, ...card.triggers] : val('iv-who') === BOT ? [String(this.context?.character.name || '')] : [];
    this.status('LLM이 목소리 설명을 쓰는 중…');
    const draft = await writeIrodoriVoice(this.context, who, val('iv-request'), llmForChoice(val('iv-model')));
    if (!val('iv-name').trim()) set('iv-name', draft.name || card?.name || '');
    set('iv-gender', genderLabel(draft.gender)); set('iv-tags', draft.tags.join(', ')); set('iv-caption', draft.caption);
    await this.design();
  }
  /** The description as typed (Korean, or any language) put into Japanese, the only language the model was taught in. */
  private async translate(): Promise<void> {
    const words = val('iv-caption').trim();
    if (!words) throw new Error('번역할 설명글을 먼저 적어 주세요.');
    const settings = ttsData().settings, via = val('iv-translate-via');
    const own = settings.translation.provider === 'off' ? 'google-free' : settings.translation.provider;
    const provider = via === 'google-free' || via === 'llm' ? via : own;
    this.status('설명글을 일본어로 번역하는 중…');
    const [translated] = await translateTts([{ id: 'caption', text: words, speaker: '', tone: '', kind: 'narration', start: 0, end: words.length }], { ...settings, translation: { ...settings.translation, provider, language: 'ja' } });
    set('iv-caption', String(translated || '').trim().slice(0, 2000));
    this.status('일본어로 바꿨습니다. 「만들어 듣기」로 들어 보세요.');
  }
  private async design(): Promise<void> {
    const design = el<HTMLButtonElement>('iv-design');
    design.disabled = true; this.status('목소리를 만드는 중… 서버에 따라 시간이 걸립니다.');
    try {
      // Heard through the player every other line uses, so ■ stops it and the volume is the reader's own.
      omniTts.stop();
      await omniTts.player.unlock();
      this.sample = await designIrodoriVoice(val('iv-caption'), this.settings());
      input('iv-keep').disabled = false;
      this.status('마음에 들면 「이 소리로 등록」, 아니면 다시 만들어 들어 보세요.');
      if (omniTts.player.ready) await omniTts.playBytes(`irodori-design:${++this.plays}`, this.sample);
    } finally { design.disabled = false; }
  }
  /** Presets a file holds that are not here; the recordings stay on the server, so those it lacks are named. */
  private async importFile(file: File): Promise<void> {
    const fresh = newIrodoriPresets(ttsData().irodoriVoices, await readJson(file));
    if (!fresh.length) { notify('새로 추가할 프리셋이 없습니다. 파일의 목소리가 이미 모두 있거나 Irodori 프리셋 파일이 아닙니다.'); return; }
    ttsData().irodoriVoices.push(...fresh);
    await persist(); this.render();
    const held = await listIrodoriVoices(this.settings()).catch(() => null);
    const gone = held ? fresh.filter(voice => !held.includes(voice.fishId)) : [];
    notify(`프리셋 ${fresh.length}개를 불러왔습니다${gone.length ? ` · 그중 ${gone.length}개는 서버에 소리 파일이 없습니다(${gone.slice(0, 3).map(voice => voice.fishId).join(', ')}${gone.length > 3 ? ' …' : ''}). 서버의 voices 폴더에 파일을 넣어 주세요` : ''}.`);
  }
  private async remove(voices: TtsVoice[]): Promise<void> {
    if (!voices.length) return;
    const keys = new Set(voices.map(v => v.key)), users = ttsData().characters.filter(c => c.irodoriKey && keys.has(c.irodoriKey)).length;
    const what = voices.length === 1 ? `「${voices[0]!.name}」 프리셋을` : `프리셋 ${voices.length}개를`;
    if (!confirm(`${what} 삭제할까요?${users ? `\n이 목소리를 쓰던 캐릭터 ${users}명은 기본 목소리로 읽습니다.` : ''}\n서버에 있는 음성 파일은 지우지 않습니다.`)) return;
    ttsData().irodoriVoices = ttsData().irodoriVoices.filter(v => !keys.has(v.key));
    voices.forEach(v => this.selected.delete(v.key));
    await persist(); this.render();
  }
  private async loadIds(): Promise<string[]> {
    const ids = await listIrodoriVoices(this.settings());
    el('iv-ids').innerHTML = ids.map(id => `<option value="${esc(id)}"></option>`).join('');
    return ids;
  }
  /** One preset per server voice that has none yet, named by its id: gender and tags are filled in afterwards. */
  private async sync(): Promise<void> {
    const ids = await listIrodoriVoices(this.settings()), known = new Set(ttsData().irodoriVoices.map(v => v.fishId));
    // The server lists its own voice with no reference (none) among them: that one is no recording to name.
    const held = ids.filter(id => !irodoriNoRef(id)), fresh = held.filter(id => !known.has(id));
    if (!fresh.length) { notify(held.length ? '서버의 목소리는 모두 프리셋에 있습니다.' : '서버에 등록된 목소리가 없습니다.'); return; }
    ttsData().irodoriVoices.push(...fresh.map(id => ({ key: uuid(), name: id, fishId: id, tags: [], gender: 'unknown' as const, folder: '' })));
    await persist(); this.render();
    notify(`목소리 ${fresh.length}개를 프리셋으로 가져왔습니다 · 성별과 태그를 넣으면 자동 배정이 더 잘 고릅니다.`);
  }
  /**
   * The starter voices no preset stands for yet, made one at a time (the server speaks one line at a time anyway)
   * and saved as each is made: stopped or failed halfway, what was made stays and the next press makes the rest.
   */
  private async starters(): Promise<void> {
    const button = el<HTMLButtonElement>('iv-starter'), progress = el('iv-progress');
    if (this.making) { this.halt = true; button.disabled = true; return; }
    const todo = missingIrodoriStarters(ttsData().irodoriVoices);
    if (!todo.length) { notify('기본 세트 목소리는 이미 모두 있습니다.'); return; }
    if (!confirm(`기본 세트 목소리 ${todo.length}개를 서버에서 만들어 프리셋으로 등록합니다.\n하나에 몇 초에서 수십 초가 걸립니다. 「중지」를 누르면 만든 데까지 남습니다.\n만들 때마다 다른 소리가 나오니, 마음에 안 드는 것은 수정에서 다시 만들어 주세요.`)) return;
    this.making = true; this.halt = false; button.textContent = '중지'; progress.hidden = false;
    let made = 0;
    try {
      for (const starter of todo) {
        if (this.halt) break;
        progress.textContent = `기본 세트 만드는 중 ${made + 1}/${todo.length} · ${starter.name}`;
        const id = await uploadIrodoriVoice(await designIrodoriVoice(starter.caption, this.settings()), 'design.wav', starter.id, this.settings());
        ttsData().irodoriVoices.push({ key: uuid(), name: starter.name, fishId: id, tags: [...starter.tags], gender: starter.gender, folder: '', caption: starter.caption });
        await persist(); this.render(); made++;
      }
    } finally {
      this.making = false; button.textContent = '기본 세트 만들기'; button.disabled = false; progress.hidden = true;
      if (made) notify(`기본 세트 목소리 ${made}개를 만들었습니다${made < todo.length ? ` · 남은 ${todo.length - made}개는 다시 누르면 이어서 만듭니다` : ''}.`);
    }
  }
  /**
   * Sends a recording up as a server voice named after the preset, and points the sheet at it. A name the server
   * already holds gets a short tail instead of being replaced: lines already spoken are kept by voice id, so a voice
   * replaced under its old id would go on playing its old recordings for every line heard before.
   */
  private async register(audio: ArrayBuffer, fileName: string): Promise<void> {
    this.status('서버에 등록하는 중…');
    const slug = irodoriVoiceSlug(val('iv-id').trim() || val('iv-name'));
    const held = await listIrodoriVoices(this.settings()).catch(() => [] as string[]);
    const target = held.includes(slug) ? `${slug.slice(0, 50)}-${Date.now().toString(36).slice(-5)}` : slug;
    const id = await uploadIrodoriVoice(audio, fileName, target, this.settings());
    set('iv-id', id); this.status(`서버에 「${id}」로 등록했습니다. 적용을 누르면 프리셋에 저장됩니다.`);
  }
  bind(): void {
    if (!el('iv-list')) return;
    on('iv-search', () => this.render(), 'input');
    on('iv-gender-filter', () => this.render(), 'change');
    on('iv-sort', () => this.render(), 'change');
    on('iv-multiselect', () => { this.multi = !this.multi; this.render(); });
    on('iv-select-all', () => { this.visible().forEach(v => this.selected.add(v.key)); this.render(); });
    on('iv-clear-selection', () => { this.selected.clear(); this.render(); });
    const chosen = () => ttsData().irodoriVoices.filter(v => this.selected.has(v.key));
    on('iv-edit-selected', () => { const [voice] = chosen(); if (voice) this.edit(voice); });
    on('iv-delete-selected', () => this.remove(chosen()));
    on('iv-add', () => this.edit());
    on('iv-sync', () => this.sync());
    on('iv-starter', () => this.starters());
    on('iv-load', async () => { this.status('서버 목록을 불러오는 중…'); const ids = await this.loadIds(); this.status(ids.length ? `서버 목소리 ${ids.length}개: ${ids.slice(0, 12).join(', ')}${ids.length > 12 ? ' …' : ''}` : '서버에 등록된 목소리가 없습니다.'); });
    on('iv-upload', () => input('iv-file').click());
    on('iv-file', async () => {
      const file = input('iv-file').files?.[0]; input('iv-file').value = '';
      if (!file) return;
      if (!val('iv-name').trim()) set('iv-name', file.name.replace(/\.[^.]+$/, ''));
      await this.register(await file.arrayBuffer(), file.name);
    }, 'change');
    el('iv-model').innerHTML = LLM_MODEL_CHOICES.map(([value, label]) => `<option value="${value}">${label}</option>`).join('');
    on('iv-who', () => this.showBind(), 'change');
    on('iv-write', async () => {
      const write = el<HTMLButtonElement>('iv-write'); write.disabled = true;
      try { await this.write(); } catch (error) { this.status(''); throw error; } finally { write.disabled = false; }
    });
    // No description typed: the model writes one first, for the character chosen above.
    on('iv-design', () => val('iv-caption').trim() ? this.design() : this.write());
    on('iv-translate', async () => {
      const translate = el<HTMLButtonElement>('iv-translate'); translate.disabled = true;
      try { await this.translate(); } catch (error) { this.status(''); throw error; } finally { translate.disabled = false; }
    });
    on('iv-apply-picked', () => this.applyPick());
    on('iv-cancel-picked', () => { const picking = this.endPick(); this.selected.clear(); this.render(); picking?.cancel(); });
    on('iv-export', () => download({ irodoriVoices: ttsData().irodoriVoices }, 'omnitts-irodori-voices.json'));
    on('iv-import', () => input('iv-import-file').click());
    on('iv-import-file', async () => { const file = input('iv-import-file').files?.[0]; input('iv-import-file').value = ''; if (file) await this.importFile(file); }, 'change');
    on('iv-keep', async () => {
      if (!this.sample) return;
      await this.register(this.sample, 'design.wav');
      this.sample = undefined; input('iv-keep').disabled = true;
    });
    auditionButton(el<HTMLButtonElement>('iv-listen'), () => ({ fishId: val('iv-id').trim(), engine: 'irodori' }));
    onForm('irodori-voice-form', async () => {
      const name = val('iv-name').trim();
      if (!name) throw new Error('목소리 이름을 입력해 주세요.');
      // A voice made and heard but not yet kept is what the reader means to apply: keep it first.
      if (this.sample) { await this.register(this.sample, 'design.wav'); this.sample = undefined; input('iv-keep').disabled = true; }
      const id = val('iv-id').trim();
      if (!id) throw new Error('서버의 목소리 ID가 비어 있습니다. 목록에서 고르거나, 파일을 올리거나, 만든 소리를 「이 소리로 등록」해 주세요.');
      const old = ttsData().irodoriVoices.find(v => v.key === this.editing), caption = val('iv-caption').trim();
      const voice: TtsVoice = { key: old?.key || uuid(), name, fishId: id, tags: list(val('iv-tags')), gender: gender(val('iv-gender')), folder: '', ...(caption ? { caption } : {}) };
      if (old) { delete old.caption; Object.assign(old, voice); } else ttsData().irodoriVoices.push(voice);
      // Written for a card (or the bot): that one speaks with it from now on.
      const card = checked('iv-bind') ? this.bindTarget() : undefined; if (card) card.irodoriKey = voice.key;
      await persist(); dialog('irodori-voice-dialog', false); this.render();
    });
    this.render();
  }
}
