import type { TtsVoice } from '../core/tts-types';
import { geminiPrebuiltVoices } from '../domain/tts/gemini-voices';
import { matchesVoiceSearch } from '../domain/tts/library';
import { listGeminiVoices } from '../providers/tts/gemini';
import { saveTtsData, ttsData } from '../storage/tts-store';
import { el, esc, genderLabel, input, listenButton, on, text, val } from './common';

/**
 * Gemini's voice presets: a tab standing where 음성 목록 (Fish's library) does while Gemini is the engine. The 30
 * prebuilt voices are there from the start; 목록 불러오기 reads the voice list this key can speak with (the Extended
 * Voice Library, and voices designed or replicated in AI Studio), and a card picks one here (캐릭터 › 목록에서 선택).
 * Plain markup for the page (sound-ui/markup.ts builds it before any script binds).
 */
export const GEMINI_VOICES_TAB = 'tts-gemini-voices';
const CSS = '#tts-gemini-voices .gv-bar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:8px}'
  + '#tts-gemini-voices .gv-bar input{flex:1 1 160px;min-width:0}#tts-gemini-voices .gv-bar select{flex:0 0 auto;width:auto;min-width:0}'
  + '#tts-gemini-voices .gv-bar .actions{padding:0;flex-wrap:wrap}#tts-gemini-voices .gv-note{margin:0 0 12px;font-size:12px;line-height:1.5;color:var(--muted)}'
  + '#tts-gemini-voices .gv-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px}'
  + '#tts-gemini-voices .gv-row{display:flex;flex-direction:column;gap:4px;min-width:0;padding:11px 12px;border:1px solid var(--line);border-radius:10px;cursor:pointer}'
  + '#tts-gemini-voices .gv-row[aria-selected="true"]{border-color:#7132f5;background:#7132f522}'
  + '#tts-gemini-voices .gv-row strong,#tts-gemini-voices .gv-row small{overflow-wrap:anywhere}#tts-gemini-voices .gv-row small{font-size:11px;color:var(--muted)}'
  + '#tts-gemini-voices .gv-row .actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;padding:0}#tts-gemini-voices .gv-row button{min-height:36px;padding:6px 9px;font-size:12px}'
  + '#tts-gemini-voices .gv-empty{grid-column:1/-1;padding:28px 12px;text-align:center;font-size:13px;color:var(--muted)}#tts-gemini-voices .voice-selection-bar{margin-bottom:8px}';
const TAB = `<button role="tab" id="tab-gemini-voices" aria-controls="${GEMINI_VOICES_TAB}" aria-selected="false" tabindex="-1" data-tts-tab="${GEMINI_VOICES_TAB}" hidden>Gemini 목소리</button>`;
const PANEL = `<section class="panel" id="${GEMINI_VOICES_TAB}" role="tabpanel" aria-labelledby="tab-gemini-voices" hidden><style>${CSS}</style>`
  + '<div class="gv-bar"><input id="gv-search" placeholder="이름·특징·ID 검색" aria-label="Gemini 목소리 검색" maxlength="200">'
  + '<select id="gv-gender-filter" aria-label="성별 필터"><option value="all">전체 성별</option><option value="female">여성</option><option value="male">남성</option><option value="unknown">미지정</option></select>'
  + '<span id="gv-count"></span>'
  + '<div class="actions"><input id="gv-language" placeholder="언어 코드 · 예: ko" aria-label="불러올 목소리의 언어 코드" maxlength="12" style="flex:0 0 110px">'
  + '<button type="button" id="gv-load" title="이 키로 쓸 수 있는 목소리를 Gemini에서 불러옵니다(AI Studio 키)">목록 불러오기</button>'
  + '<button type="button" id="gv-reset" title="불러온 목소리를 지우고 기본 목소리 30개로 되돌립니다">기본 30개로</button></div></div>'
  + '<p class="gv-note">Gemini는 고른 목소리로 말하고, 대사의 억양을 말투 지시로 함께 보냅니다. 캐릭터 탭에서 캐릭터마다 목소리를 고르거나 자동 배정에 맡깁니다. 고르지 않은 캐릭터와 나레이션은 모델 설정의 기본 목소리로 읽습니다. AI Studio에서 설명이나 녹음으로 만든 목소리(voice_…)도 「목록 불러오기」로 들어옵니다.</p>'
  + '<p id="gv-status" class="gv-note" role="status"></p>'
  + '<div class="voice-selection-bar"><button type="button" id="gv-apply-picked" hidden disabled>이 목소리 선택</button><button type="button" id="gv-cancel-picked" hidden>선택 취소</button><span id="gv-selected" role="status"></span></div>'
  + '<div id="gv-list" class="voice-list gv-list" role="listbox" aria-label="Gemini 목소리"></div></section>';

/** Adds the tab button (after Irodori's, else 음성 목록's) and its panel. Idempotent. */
export function addGeminiVoicesStructure(root: ParentNode): void {
  if (root.querySelector(`#${GEMINI_VOICES_TAB}`)) return;
  (root.querySelector('#tab-irodori-voices') ?? root.querySelector('#tab-voices'))?.insertAdjacentHTML('afterend', TAB);
  (root.querySelector('#tts-irodori-voices') ?? root.querySelector('#tts-voices'))?.insertAdjacentHTML('afterend', PANEL);
}

export class GeminiVoices {
  private selected = '';
  private picking?: { done: (voice: TtsVoice) => void; cancel: () => void };
  constructor(private tab: (name: string) => void = () => undefined) {}
  pickVoice(done: (voice: TtsVoice) => void, cancel: () => void): void {
    this.picking = { done, cancel }; this.selected = ''; text('tab-gemini-voices', 'Gemini 목소리 (선택 중)');
    this.tab(GEMINI_VOICES_TAB); this.render();
  }
  private endPick() { const picking = this.picking; this.picking = undefined; text('tab-gemini-voices', 'Gemini 목소리'); return picking; }
  private applyPick(): void {
    const voice = ttsData().geminiVoices.find(v => v.key === this.selected);
    if (voice && this.picking) { this.endPick()!.done(voice); this.selected = ''; this.render(); }
  }
  private visible(): TtsVoice[] {
    const wanted = val('gv-gender-filter') || 'all';
    return ttsData().geminiVoices.filter(v => (wanted === 'all' || v.gender === wanted) && matchesVoiceSearch(v, val('gv-search')));
  }
  render(): void {
    const root = el('gv-list'); if (!root) return;
    const all = ttsData().geminiVoices, visible = this.visible();
    text('gv-count', `${visible.length}개 표시 / 전체 ${all.length}개`);
    el('gv-apply-picked').hidden = !this.picking; el('gv-cancel-picked').hidden = !this.picking; input('gv-apply-picked').disabled = !this.selected;
    text('gv-selected', this.picking ? (this.selected ? `선택: ${all.find(v => v.key === this.selected)?.name || ''}` : '캐릭터에 줄 목소리를 고르세요') : '');
    root.replaceChildren();
    if (!visible.length) { const empty = document.createElement('p'); empty.className = 'gv-empty'; empty.textContent = all.length ? '검색에 맞는 목소리가 없습니다.' : '목소리가 없습니다. 「기본 30개로」를 눌러 주세요.'; root.append(empty); return; }
    // A long list (a voice library read) is drawn a page at a time: the first few hundred, the search narrows the rest.
    for (const voice of visible.slice(0, 400)) {
      const users = ttsData().characters.filter(c => c.geminiKey === voice.key).length;
      const row = document.createElement('div'); row.className = 'voice-row gv-row'; row.tabIndex = 0; row.dataset.key = voice.key;
      row.setAttribute('role', 'option'); row.setAttribute('aria-selected', String(this.selected === voice.key));
      row.innerHTML = `<strong>${esc(voice.name)}</strong><small>${esc([genderLabel(voice.gender), ...voice.tags].join(', '))}</small><small>ID ${esc(voice.fishId)}${voice.languages?.length ? ` · ${esc(voice.languages.join(', '))}` : ''}${users ? ` · 캐릭터 ${users}명` : ''}</small><div class="actions"></div>`;
      const listen = listenButton(() => ({ fishId: voice.fishId, engine: 'gemini' }));
      listen.addEventListener('click', event => event.stopPropagation());
      row.querySelector('.actions')!.append(listen);
      row.addEventListener('click', () => { if (this.picking && this.selected === voice.key) { this.applyPick(); return; } this.selected = voice.key; this.render(); });
      row.addEventListener('keydown', event => { if (event.target === row && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); this.selected = voice.key; if (this.picking) this.applyPick(); else this.render(); } });
      row.addEventListener('dblclick', () => { if (this.picking) { this.selected = voice.key; this.applyPick(); } });
      root.append(row);
    }
    if (visible.length > 400) { const more = document.createElement('p'); more.className = 'gv-empty'; more.textContent = `${visible.length - 400}개 더 있습니다. 검색으로 좁혀 주세요.`; root.append(more); }
  }
  bind(): void {
    if (!el('gv-list')) return;
    for (const id of ['gv-search', 'gv-gender-filter']) el(id)?.addEventListener('input', () => this.render());
    el('gv-gender-filter')?.addEventListener('change', () => this.render());
    on('gv-apply-picked', () => this.applyPick());
    on('gv-cancel-picked', () => { const picking = this.endPick(); this.render(); picking?.cancel(); });
    on('gv-load', async () => {
      const button = input('gv-load'); button.disabled = true; text('gv-status', '목소리 목록을 불러오는 중…');
      try {
        const listed = await listGeminiVoices({ gemini: ttsData().settings.gemini }, val('gv-language').trim());
        // The prebuilt ones stay first (cards speak with them); the list adds the rest, each once by its id.
        const keep = geminiPrebuiltVoices(), have = new Set(keep.map(v => v.fishId));
        ttsData().geminiVoices = [...keep, ...listed.filter(v => !have.has(v.fishId))];
        await saveTtsData();
        text('gv-status', `목소리 ${listed.length}개를 불러왔습니다. 지금 ${ttsData().geminiVoices.length}개입니다.`);
        this.render();
      } catch (error) { text('gv-status', String((error as Error)?.message || error)); }
      finally { button.disabled = false; }
    });
    on('gv-reset', async () => {
      if (!confirm('불러온 목소리를 지우고 기본 목소리 30개로 되돌릴까요? 지운 목소리를 쓰던 캐릭터는 기본 목소리로 읽습니다.')) return;
      ttsData().geminiVoices = geminiPrebuiltVoices(); await saveTtsData();
      text('gv-status', '기본 목소리 30개로 되돌렸습니다.'); this.render();
    });
    this.render();
  }
}
