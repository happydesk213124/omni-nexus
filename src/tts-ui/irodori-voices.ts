import type { TtsVoice } from '../core/tts-types';
import { uuid } from '../core/util/text';
import { ttsData } from '../storage/tts-store';
import { omniTts } from '../services/tts-runtime';
import { matchesVoiceSearch } from '../domain/tts/library';
import { missingIrodoriStarters } from '../domain/tts/irodori-starter';
import { newIrodoriPresets } from '../domain/tts/irodori-presets';
import { ttsNameKey } from '../domain/tts/identity';
import { writeIrodoriVoice } from '../services/irodori-voice-writer';
import { currentTtsContext, type TtsChatContext } from '../services/tts-context';
import { LLM_MODEL_CHOICES, llmForChoice } from './llm-actions';
import { designIrodoriVoice, irodoriDefaultVoice, irodoriNoRef, irodoriVoiceSlug, listIrodoriVoices, uploadIrodoriVoice } from '../providers/tts/irodori';
import { el, input, val, set, text, list, gender, genderLabel, esc, on, onForm, dialog, button, persist, listenButton, auditionButton, notify, checked, download, readJson } from './common';

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

  private visible(): TtsVoice[] { return ttsData().irodoriVoices.filter(v => matchesVoiceSearch(v, val('iv-search'))); }
  render(): void {
    const root = el('iv-list'); if (!root) return;
    const all = ttsData().irodoriVoices, visible = this.visible(), fallback = irodoriDefaultVoice(this.settings());
    text('iv-count', `${visible.length}개 표시 / 전체 ${all.length}개`);
    root.replaceChildren();
    if (!visible.length) {
      const empty = document.createElement('p'); empty.className = 'iv-empty';
      empty.textContent = all.length ? '검색에 맞는 목소리가 없습니다.' : `아직 프리셋이 없습니다. 지금은 모든 대사를 기본 목소리(${fallback})로 읽습니다. 기본 세트 만들기를 누르면 성별·나이·성격별 목소리가 채워지고, + 목소리로 하나씩 만들 수도 있습니다.`;
      root.append(empty); return;
    }
    for (const voice of visible) {
      const row = document.createElement('div'); row.className = 'iv-row'; row.setAttribute('role', 'listitem'); row.dataset.key = voice.key;
      const users = ttsData().characters.filter(c => c.irodoriKey === voice.key).length;
      row.innerHTML = `<strong>${esc(voice.name)}</strong><small>${esc([genderLabel(voice.gender), ...voice.tags].join(', '))}</small><small>ID ${esc(voice.fishId || '없음')}${users ? ` · 캐릭터 ${users}명` : ''}</small><div class="actions"></div>`;
      const actions = row.querySelector('.actions')!;
      const edit = button('수정', () => this.edit(voice)), remove = button('삭제', () => this.remove(voice)); remove.className = 'danger';
      actions.append(listenButton(() => ({ fishId: voice.fishId, engine: 'irodori' })), edit, remove);
      root.append(row);
    }
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
  private showBind(): void { el('iv-bind-wrap').hidden = !this.card(); }
  /** The model writes the sheet (name if empty, gender, tags, description), and the voice is made and heard at once. */
  private async write(): Promise<void> {
    const card = this.card(), who = card ? [card.name, ...card.triggers] : val('iv-who') === BOT ? [String(this.context?.character.name || '')] : [];
    this.status('LLM이 목소리 설명을 쓰는 중…');
    const draft = await writeIrodoriVoice(this.context, who, val('iv-request'), llmForChoice(val('iv-model')));
    if (!val('iv-name').trim()) set('iv-name', draft.name || card?.name || '');
    set('iv-gender', genderLabel(draft.gender)); set('iv-tags', draft.tags.join(', ')); set('iv-caption', draft.caption);
    await this.design();
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
  private async remove(voice: TtsVoice): Promise<void> {
    const users = ttsData().characters.filter(c => c.irodoriKey === voice.key).length;
    if (!confirm(`「${voice.name}」 프리셋을 삭제할까요?${users ? `\n이 목소리를 쓰던 캐릭터 ${users}명은 기본 목소리로 읽습니다.` : ''}\n서버에 있는 음성 파일은 지우지 않습니다.`)) return;
    ttsData().irodoriVoices = ttsData().irodoriVoices.filter(v => v.key !== voice.key);
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
  /** Sends a recording up as a server voice named after the preset, and points the sheet at it. */
  private async register(audio: ArrayBuffer, fileName: string): Promise<void> {
    this.status('서버에 등록하는 중…');
    const id = await uploadIrodoriVoice(audio, fileName, irodoriVoiceSlug(val('iv-id').trim() || val('iv-name')), this.settings());
    set('iv-id', id); this.status(`서버에 「${id}」로 등록했습니다. 적용을 누르면 프리셋에 저장됩니다.`);
  }
  bind(): void {
    if (!el('iv-list')) return;
    on('iv-search', () => this.render(), 'input');
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
      const name = val('iv-name').trim(), id = val('iv-id').trim();
      if (!name) throw new Error('목소리 이름을 입력해 주세요.');
      if (!id) throw new Error('서버의 목소리 ID가 비어 있습니다. 목록에서 고르거나, 파일을 올리거나, 만든 소리를 「이 소리로 등록」해 주세요.');
      const old = ttsData().irodoriVoices.find(v => v.key === this.editing), caption = val('iv-caption').trim();
      const voice: TtsVoice = { key: old?.key || uuid(), name, fishId: id, tags: list(val('iv-tags')), gender: gender(val('iv-gender')), folder: '', ...(caption ? { caption } : {}) };
      if (old) { delete old.caption; Object.assign(old, voice); } else ttsData().irodoriVoices.push(voice);
      // Written for a card: that card speaks with it from now on.
      const card = this.card(); if (card && checked('iv-bind')) card.irodoriKey = voice.key;
      await persist(); dialog('irodori-voice-dialog', false); this.render();
    });
    this.render();
  }
}
