import type { TtsVoice } from '../core/tts-types';
import { matchesVoiceSearch } from '../domain/tts/library';
import { addElevenVoice, ensureElevenVoiceList, loadElevenVoiceList, removeElevenVoice } from '../services/eleven-voices';
import { ttsData, updateTtsSettings } from '../storage/tts-store';
import { el, esc, genderLabel, input, listenButton, on, set, text, val } from './common';

/**
 * ElevenLabs's voices: a tab standing where 음성 목록 (Fish's library) does while ElevenLabs is the engine. 목록
 * 불러오기 reads the voices of the account the key belongs to (its own, cloned and designed ones, and those added from
 * ElevenLabs's voice library); one not in it is added by its id. A card picks one here (캐릭터 › 목록에서 선택), and the
 * one chosen as 기본 목소리 speaks for cards with none and for narration. Voices are made and deleted at ElevenLabs,
 * not here. Plain markup for the page (sound-ui/markup.ts builds it before any script binds).
 */
export const ELEVEN_VOICES_TAB = 'tts-eleven-voices';
const CSS = '#tts-eleven-voices .ev-bar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:8px}'
  + '#tts-eleven-voices .ev-bar input{flex:1 1 160px;min-width:0}#tts-eleven-voices .ev-bar select{flex:0 0 auto;width:auto;min-width:0}'
  + '#tts-eleven-voices .ev-bar .actions{padding:0;flex-wrap:wrap}#tts-eleven-voices .ev-note{margin:0 0 12px;font-size:12px;line-height:1.5;color:var(--muted)}'
  // The list and its tiles are 음성 목록's (sound-ui/style.ts copies its rules over).
  + '#tts-eleven-voices .ev-row{cursor:pointer}#tts-eleven-voices .ev-row strong{overflow-wrap:anywhere}'
  + '#tts-eleven-voices .ev-empty{grid-column:1/-1;padding:28px 12px;text-align:center;font-size:13px;color:var(--muted)}#tts-eleven-voices .voice-selection-bar{margin-bottom:8px}';
const TAB = `<button role="tab" id="tab-eleven-voices" aria-controls="${ELEVEN_VOICES_TAB}" aria-selected="false" tabindex="-1" data-tts-tab="${ELEVEN_VOICES_TAB}" hidden>ElevenLabs 목소리</button>`;
const PANEL = `<section class="panel" id="${ELEVEN_VOICES_TAB}" role="tabpanel" aria-labelledby="tab-eleven-voices" hidden><style>${CSS}</style>`
  + '<div class="ev-bar"><input id="ev-search" placeholder="이름·특징·ID 검색" aria-label="ElevenLabs 목소리 검색" maxlength="200">'
  + '<select id="ev-gender-filter" aria-label="성별 필터"><option value="all">전체 성별</option><option value="female">여성</option><option value="male">남성</option><option value="unknown">미지정</option></select>'
  + '<span id="ev-count"></span>'
  + '<div class="actions"><button type="button" id="ev-load" title="이 API 키의 계정에 있는 목소리를 ElevenLabs에서 불러옵니다">목록 불러오기</button>'
  + '<input id="ev-id" placeholder="voice ID로 추가" aria-label="추가할 목소리의 voice ID" maxlength="120" style="flex:0 1 170px">'
  + '<button type="button" id="ev-add" title="목록에 없는 목소리를 voice ID로 추가합니다">추가</button></div></div>'
  + '<p class="ev-note">ElevenLabs 계정에 있는 목소리로 말합니다. ElevenLabs 사이트의 Voice Library에서 「Add to my voices」로 담은 목소리, 직접 만든 목소리가 여기 목록에 들어옵니다. 캐릭터 탭에서 캐릭터마다 고르고, 고르지 않은 캐릭터와 나레이션은 기본 목소리로 읽습니다.</p>'
  + '<p id="ev-status" class="ev-note" role="status"></p>'
  + '<div class="voice-selection-bar"><button type="button" id="ev-apply-picked" hidden disabled>이 목소리 선택</button><button type="button" id="ev-cancel-picked" hidden>선택 취소</button><span id="ev-selected" role="status"></span>'
  + '<button type="button" id="ev-default" disabled title="선택한 목소리를 기본 목소리로 씁니다">기본 목소리로</button><button type="button" id="ev-remove" class="danger" disabled title="이 목록에서만 뺍니다. ElevenLabs 계정의 목소리는 그대로입니다">목록에서 빼기</button></div>'
  + '<div id="ev-list" class="voice-list ev-list" role="listbox" aria-label="ElevenLabs 목소리"></div></section>';

/** Adds the tab button (after the other engines', else 음성 목록's) and its panel. Idempotent. */
export function addElevenVoicesStructure(root: ParentNode): void {
  if (root.querySelector(`#${ELEVEN_VOICES_TAB}`)) return;
  (root.querySelector('#tab-gemini-voices') ?? root.querySelector('#tab-irodori-voices') ?? root.querySelector('#tab-voices'))?.insertAdjacentHTML('afterend', TAB);
  (root.querySelector('#tts-gemini-voices') ?? root.querySelector('#tts-irodori-voices') ?? root.querySelector('#tts-voices'))?.insertAdjacentHTML('afterend', PANEL);
}

export class ElevenVoices {
  private selected = '';
  private picking?: { done: (voice: TtsVoice) => void; cancel: () => void };
  constructor(private tab: (name: string) => void = () => undefined) {}
  pickVoice(done: (voice: TtsVoice) => void, cancel: () => void): void {
    this.picking = { done, cancel }; this.selected = ''; text('tab-eleven-voices', 'ElevenLabs 목소리 (선택 중)');
    this.tab(ELEVEN_VOICES_TAB); this.render();
  }
  private endPick() { const picking = this.picking; this.picking = undefined; text('tab-eleven-voices', 'ElevenLabs 목소리'); return picking; }
  private applyPick(): void {
    const voice = ttsData().elevenVoices.find(v => v.key === this.selected);
    if (voice && this.picking) { this.endPick()!.done(voice); this.selected = ''; this.render(); }
  }
  private visible(): TtsVoice[] {
    const wanted = val('ev-gender-filter') || 'all';
    return ttsData().elevenVoices.filter(v => (wanted === 'all' || v.gender === wanted) && matchesVoiceSearch(v, val('ev-search')));
  }
  render(): void {
    const root = el('ev-list'); if (!root) return;
    const all = ttsData().elevenVoices, visible = this.visible(), fallback = ttsData().settings.eleven.voice.trim();
    const chosen = all.find(v => v.key === this.selected);
    if (!chosen) this.selected = '';
    text('ev-count', `${visible.length}개 표시 / 전체 ${all.length}개`);
    el('ev-apply-picked').hidden = !this.picking; el('ev-cancel-picked').hidden = !this.picking; input('ev-apply-picked').disabled = !chosen;
    el('ev-default').hidden = !!this.picking; el('ev-remove').hidden = !!this.picking;
    input('ev-default').disabled = !chosen || chosen.fishId === fallback; input('ev-remove').disabled = !chosen;
    text('ev-selected', this.picking ? (chosen ? `선택: ${chosen.name}` : '캐릭터에 줄 목소리를 고르세요') : chosen ? `선택: ${chosen.name}` : '');
    root.replaceChildren();
    if (!visible.length) {
      const empty = document.createElement('p'); empty.className = 'ev-empty';
      empty.textContent = all.length ? '검색에 맞는 목소리가 없습니다.' : '목소리가 없습니다. 모델 설정에 ElevenLabs API 키를 넣고 「목록 불러오기」를 눌러 주세요.';
      root.append(empty); return;
    }
    const numbers = new Map(all.map((v, i) => [v.key, i + 1]));
    for (const voice of visible.slice(0, 400)) {
      const users = ttsData().characters.filter(c => c.elevenKey === voice.key).length;
      const row = document.createElement('div'); row.className = 'voice-row ev-row'; row.tabIndex = 0; row.dataset.key = voice.key;
      row.setAttribute('role', 'option'); row.setAttribute('aria-selected', String(this.selected === voice.key));
      // 음성 목록's tile: the voice's id (and who speaks with it) stands where a Fish voice's folder does.
      row.innerHTML = `<div class="voice-top"><small>${numbers.get(voice.key)}</small></div><strong>${esc(voice.name)}</strong><p class="voice-tags">${esc([genderLabel(voice.gender), ...voice.tags].join(', '))}</p><small class="voice-folder-label">${voice.fishId === fallback ? '기본 목소리 · ' : ''}ID ${esc(voice.fishId)}${voice.languages?.length ? ` · ${esc(voice.languages.join(', '))}` : ''}${users ? ` · 캐릭터 ${users}명` : ''}</small>`;
      const listen = listenButton(() => ({ fishId: voice.fishId, engine: 'elevenlabs' })); listen.classList.add('tile-audition');
      listen.addEventListener('click', event => event.stopPropagation());
      row.append(listen);
      row.addEventListener('click', () => { if (this.picking && this.selected === voice.key) { this.applyPick(); return; } this.selected = voice.key; this.render(); });
      row.addEventListener('keydown', event => { if (event.target === row && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); this.selected = voice.key; if (this.picking) this.applyPick(); else this.render(); } });
      row.addEventListener('dblclick', () => { if (this.picking) { this.selected = voice.key; this.applyPick(); } });
      root.append(row);
    }
    if (visible.length > 400) { const more = document.createElement('p'); more.className = 'ev-empty'; more.textContent = `${visible.length - 400}개 더 있습니다. 검색으로 좁혀 주세요.`; root.append(more); }
  }
  bind(): void {
    if (!el('ev-list')) return;
    for (const id of ['ev-search', 'ev-gender-filter']) el(id)?.addEventListener('input', () => this.render());
    el('ev-gender-filter')?.addEventListener('change', () => this.render());
    on('ev-apply-picked', () => this.applyPick());
    on('ev-cancel-picked', () => { const picking = this.endPick(); this.render(); picking?.cancel(); });
    on('ev-load', async () => {
      const button = input('ev-load'); button.disabled = true; text('ev-status', '목소리 목록을 불러오는 중…');
      try {
        const added = await loadElevenVoiceList();
        text('ev-status', added ? `새 목소리 ${added}개를 불러왔습니다. 지금 ${ttsData().elevenVoices.length}개입니다.` : `목록에 새 목소리가 없습니다(지금 ${ttsData().elevenVoices.length}개). ElevenLabs 사이트에서 목소리를 담거나 만든 뒤 다시 불러와 주세요.`);
        document.dispatchEvent(new Event('omnitts-library')); this.render();
      } catch (error) { text('ev-status', String((error as Error)?.message || error)); }
      finally { button.disabled = false; }
    });
    on('ev-add', async () => {
      const button = input('ev-add'); button.disabled = true; text('ev-status', '목소리 정보를 가져오는 중…');
      try {
        const voice = await addElevenVoice(val('ev-id'));
        set('ev-id', ''); this.selected = voice.key;
        text('ev-status', `「${voice.name}」 목소리를 목록에 넣었습니다.`);
        document.dispatchEvent(new Event('omnitts-library')); this.render();
      } catch (error) { text('ev-status', String((error as Error)?.message || error)); }
      finally { button.disabled = false; }
    });
    // 기본 목소리로: what cards with no voice of their own, and narration, speak with (모델 설정's field, set from here).
    on('ev-default', async () => {
      const voice = ttsData().elevenVoices.find(v => v.key === this.selected);
      if (!voice) return;
      await updateTtsSettings({ eleven: { ...ttsData().settings.eleven, voice: voice.fishId } });
      set('tts-eleven-voice', voice.fishId);
      text('ev-status', `「${voice.name}」을(를) 기본 목소리로 정했습니다.`); this.render();
    });
    on('ev-remove', async () => {
      const voice = ttsData().elevenVoices.find(v => v.key === this.selected);
      if (!voice) return;
      const users = ttsData().characters.filter(c => c.elevenKey === voice.key).length;
      if (!confirm(`「${voice.name}」 목소리를 이 목록에서 뺄까요? ElevenLabs 계정의 목소리는 그대로입니다.${users ? ` 이 목소리를 쓰던 캐릭터 ${users}명은 기본 목소리로 읽습니다.` : ''}`)) return;
      await removeElevenVoice(voice.key); this.selected = '';
      text('ev-status', '목록에서 뺐습니다.'); document.dispatchEvent(new Event('omnitts-library')); this.render();
    });
    // The account's voices, once by itself (there is none to pick until then).
    void ensureElevenVoiceList().then(() => this.render());
    this.render();
  }
}
