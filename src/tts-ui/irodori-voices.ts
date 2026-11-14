import type { TtsVoice } from '../core/tts-types';
import { uuid } from '../core/util/text';
import { ttsData } from '../storage/tts-store';
import { omniTts } from '../services/tts-runtime';
import { matchesVoiceSearch } from '../domain/tts/library';
import { missingIrodoriStarters } from '../domain/tts/irodori-starter';
import { designIrodoriVoice, irodoriDefaultVoice, irodoriNoRef, irodoriVoiceSlug, listIrodoriVoices, uploadIrodoriVoice } from '../providers/tts/irodori';
import { el, input, val, set, text, list, gender, genderLabel, esc, on, onForm, dialog, button, persist, listenButton, auditionButton, notify } from './common';

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
    this.status(''); dialog('irodori-voice-dialog');
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
    on('iv-design', async () => {
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
    });
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
      await persist(); dialog('irodori-voice-dialog', false); this.render();
    });
    this.render();
  }
}
