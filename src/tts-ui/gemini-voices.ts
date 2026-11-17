import type { TtsVoice } from '../core/tts-types';
import { geminiPrebuiltVoices } from '../domain/tts/gemini-voices';
import { matchesVoiceSearch } from '../domain/tts/library';
import { cardsWithoutOwnVoice, designVoice, designVoiceFor, ensureGeminiVoiceList, loadGeminiVoiceList, removeGeminiVoice } from '../services/gemini-voices';
import { currentTtsContext } from '../services/tts-context';
import { saveTtsData, ttsData } from '../storage/tts-store';
import { el, esc, genderLabel, hearNewVoice, input, listenButton, on, text, val } from './common';

/**
 * Gemini's voice presets: a tab standing where 음성 목록 (Fish's library) does while Gemini is the engine. The 30
 * prebuilt voices are there from the start; 목록 불러오기 reads the voices this key or Vertex account can speak with
 * (Google's catalog, and voices designed or replicated), + 목소리 만들기 designs one from a description, 캐릭터마다 새
 * 목소리 designs one for every card that has none of its own, and a card picks one here (캐릭터 › 목록에서 선택).
 * Plain markup for the page (sound-ui/markup.ts builds it before any script binds).
 */
export const GEMINI_VOICES_TAB = 'tts-gemini-voices';
const CSS = '#tts-gemini-voices .gv-bar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:8px}'
  + '#tts-gemini-voices .gv-bar input{flex:1 1 160px;min-width:0}#tts-gemini-voices .gv-bar select{flex:0 0 auto;width:auto;min-width:0}'
  + '#tts-gemini-voices .gv-bar .actions{padding:0;flex-wrap:wrap}#tts-gemini-voices .gv-note{margin:0 0 12px;font-size:12px;line-height:1.5;color:var(--muted)}'
  // The list and its tiles are 음성 목록's (sound-ui/style.ts copies its rules over): number, name, tags, the voice's
  // id where the folder is, ▶ 듣기 in the corner; a voice made here has 삭제 in the other.
  + '#tts-gemini-voices .gv-row{cursor:pointer}#tts-gemini-voices .gv-row strong{overflow-wrap:anywhere}'
  + '#tts-gemini-voices .gv-row .gv-drop{position:absolute;top:8px;right:8px;min-height:30px;padding:4px 8px;font-size:11px;z-index:1}'
  + '#tts-gemini-voices .gv-form{display:grid;grid-template-columns:1fr auto;gap:8px;margin:0 0 12px;padding:10px;border:1px solid var(--line);border-radius:10px}#tts-gemini-voices .gv-form textarea,#tts-gemini-voices .gv-form .actions{grid-column:1/-1}#tts-gemini-voices .gv-form .actions{display:flex;gap:6px;padding:0}'
  + '#tts-gemini-voices .gv-empty{grid-column:1/-1;padding:28px 12px;text-align:center;font-size:13px;color:var(--muted)}#tts-gemini-voices .voice-selection-bar{margin-bottom:8px}';
const TAB = `<button role="tab" id="tab-gemini-voices" aria-controls="${GEMINI_VOICES_TAB}" aria-selected="false" tabindex="-1" data-tts-tab="${GEMINI_VOICES_TAB}" hidden>Gemini 목소리</button>`;
const PANEL = `<section class="panel" id="${GEMINI_VOICES_TAB}" role="tabpanel" aria-labelledby="tab-gemini-voices" hidden><style>${CSS}</style>`
  + '<div class="gv-bar"><input id="gv-search" placeholder="이름·특징·ID 검색" aria-label="Gemini 목소리 검색" maxlength="200">'
  + '<select id="gv-gender-filter" aria-label="성별 필터"><option value="all">전체 성별</option><option value="female">여성</option><option value="male">남성</option><option value="unknown">미지정</option></select>'
  + '<span id="gv-count"></span>'
  + '<div class="actions"><input id="gv-language" placeholder="언어 코드 · 예: ko" aria-label="불러올 목소리의 언어 코드" maxlength="12" style="flex:0 0 110px">'
  + '<button type="button" id="gv-load" title="이 키(또는 Vertex 계정)로 쓸 수 있는 목소리를 Google에서 불러옵니다">목록 불러오기</button>'
  + '<button type="button" id="gv-new" title="설명을 적어 새 목소리를 만듭니다">+ 목소리 만들기</button>'
  + '<button type="button" id="gv-each" title="자기만의 목소리가 없는 캐릭터마다 새 목소리를 만들어 줍니다">캐릭터마다 새 목소리</button>'
  + '<button type="button" id="gv-reset" title="불러온 목소리를 지우고 기본 목소리 30개로 되돌립니다(만든 목소리는 남습니다)">기본 30개로</button></div></div>'
  + '<p class="gv-note">기본 목소리는 30개뿐이라 캐릭터가 많으면 같은 목소리가 겹칩니다. 「목록 불러오기」로 Google의 목소리를 더 가져오거나, 「캐릭터마다 새 목소리」로 캐릭터의 성별·특징 태그에 맞춘 목소리를 만들 수 있습니다(특징 조합이 같으면 같은 목소리를 쓰고, 만든 목소리는 Google 프로젝트에 저장, 200개까지). 고르지 않은 캐릭터와 나레이션은 모델 설정의 기본 목소리로 읽습니다.</p>'
  + '<div id="gv-form" class="gv-form" hidden><input id="gv-new-name" maxlength="80" placeholder="목소리 이름" aria-label="목소리 이름"><select id="gv-new-gender" aria-label="성별"><option value="">성별 미지정</option><option value="female">여성</option><option value="male">남성</option></select>'
  + '<textarea id="gv-new-about" rows="2" maxlength="2000" placeholder="어떤 목소리인지 · 예: 낮고 나른한 20대 여성, 말끝을 흐리는" aria-label="목소리 설명"></textarea>'
  + '<div class="actions"><button type="button" id="gv-new-make">만들어 듣기</button><button type="button" id="gv-new-close">닫기</button></div></div>'
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
    const numbers = new Map(all.map((v, i) => [v.key, i + 1]));
    for (const voice of visible.slice(0, 400)) {
      const users = ttsData().characters.filter(c => c.geminiKey === voice.key).length;
      const mine = /^voice(key)?_/.test(voice.fishId);
      const row = document.createElement('div'); row.className = 'voice-row gv-row'; row.tabIndex = 0; row.dataset.key = voice.key; if (mine) row.dataset.own = '1';
      row.setAttribute('role', 'option'); row.setAttribute('aria-selected', String(this.selected === voice.key));
      // 음성 목록's tile: the voice's id (and who speaks with it) stands where a Fish voice's folder does.
      row.innerHTML = `<div class="voice-top"><small>${numbers.get(voice.key)}</small></div><strong>${esc(voice.name)}</strong><p class="voice-tags">${esc([genderLabel(voice.gender), ...voice.tags].join(', '))}</p><small class="voice-folder-label">${mine ? '만든 목소리 · ' : ''}ID ${esc(voice.fishId)}${voice.languages?.length ? ` · ${esc(voice.languages.join(', '))}` : ''}${users ? ` · 캐릭터 ${users}명` : ''}</small>`;
      const listen = listenButton(() => ({ fishId: voice.fishId, engine: 'gemini' })); listen.classList.add('tile-audition');
      listen.addEventListener('click', event => event.stopPropagation());
      row.append(listen);
      if (mine) {
        const drop = document.createElement('button'); drop.type = 'button'; drop.className = 'danger gv-drop'; drop.textContent = '삭제';
        drop.addEventListener('click', event => {
          event.stopPropagation();
          if (!confirm(`「${voice.name}」 목소리를 지울까요? Google에 저장된 목소리도 지워지고, 이 목소리를 쓰던 캐릭터는 기본 목소리로 읽습니다.`)) return;
          drop.disabled = true;
          void removeGeminiVoice(voice.key).then(() => { text('gv-status', '목소리를 지웠습니다.'); this.render(); }, error => { text('gv-status', String((error as Error)?.message || error)); drop.disabled = false; });
        });
        row.append(drop);
      }
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
        // The prebuilt ones stay first, the designed ones and those cards speak with are kept; the list adds the rest.
        const added = await loadGeminiVoiceList(val('gv-language').trim());
        text('gv-status', added ? `새 목소리 ${added}개를 불러왔습니다. 지금 ${ttsData().geminiVoices.length}개입니다.` : `목록에 새 목소리가 없습니다(지금 ${ttsData().geminiVoices.length}개). 「+ 목소리 만들기」나 「캐릭터마다 새 목소리」로 늘릴 수 있습니다.`);
        this.render();
      } catch (error) { text('gv-status', String((error as Error)?.message || error)); }
      finally { button.disabled = false; }
    });
    on('gv-reset', async () => {
      if (!confirm('불러온 목소리를 지우고 기본 목소리 30개로 되돌릴까요? 지운 목소리를 쓰던 캐릭터는 기본 목소리로 읽습니다.')) return;
      // Voices designed here are stored at Google: they stay until taken off one by one (삭제).
      ttsData().geminiVoices = [...geminiPrebuiltVoices(), ...ttsData().geminiVoices.filter(v => /^voice(key)?_/.test(v.fishId))]; await saveTtsData();
      text('gv-status', '기본 목소리 30개로 되돌렸습니다.'); this.render();
    });
    // + 목소리 만들기: a description in words, heard as soon as it is made.
    on('gv-new', () => { el('gv-form').hidden = !el('gv-form').hidden; });
    on('gv-new-close', () => { el('gv-form').hidden = true; });
    on('gv-new-make', async () => {
      const button = input('gv-new-make'), about = val('gv-new-about').trim(), gender = val('gv-new-gender');
      if (!about) { text('gv-status', '어떤 목소리인지 설명을 적어 주세요.'); return; }
      button.disabled = true; text('gv-status', '목소리 만드는 중…');
      try {
        const made = await designVoice({ name: val('gv-new-name').trim() || about.slice(0, 24), description: about, ...(gender === 'female' || gender === 'male' ? { gender } : {}) });
        text('gv-status', `「${made.voice.name}」 목소리를 만들었습니다.`); this.render();
        await hearNewVoice(made);
      } catch (error) { text('gv-status', String((error as Error)?.message || error)); }
      finally { button.disabled = false; }
    });
    // 캐릭터마다 새 목소리: every card of the open bot (and the shared ones) with no voice of its own gets one designed
    // from its gender and traits, one after another; one that fails is told, the rest go on.
    on('gv-each', async () => {
      const button = input('gv-each');
      const context = await currentTtsContext().catch(() => null), cards = cardsWithoutOwnVoice(context?.rosterScope || 'global');
      if (!cards.length) { text('gv-status', '모든 캐릭터가 이미 자기 특징에 맞춘 목소리를 쓰고 있습니다.'); return; }
      if (!confirm(`캐릭터 ${cards.length}명에게 성별·특징 태그에 맞춘 목소리를 줄까요?\n처음 나온 특징 조합은 새로 만들고, 이미 만든 조합은 그 목소리를 같이 씁니다. 만든 목소리는 Google 프로젝트에 저장됩니다(200개까지).`)) return;
      button.disabled = true;
      let made = 0, shared = 0; const failed: string[] = [];
      for (const [i, card] of cards.entries()) {
        text('gv-status', `목소리 맞추는 중 ${i + 1}/${cards.length} · ${card.name}`);
        try { if ((await designVoiceFor(card)).reused) shared++; else made++; }
        catch (error) { failed.push(`${card.name}: ${String((error as Error)?.message || error).slice(0, 200)}`); if (failed.length >= 3 && !made && !shared) break; }
      }
      button.disabled = false;
      text('gv-status', `새 목소리 ${made}개를 만들어 캐릭터에 지정했습니다.${shared ? ` 같은 특징이라 이미 만든 목소리를 쓴 캐릭터 ${shared}명.` : ''}${failed.length ? ` 실패 ${failed.length}명 · ${failed[0]}` : ''}`);
      document.dispatchEvent(new Event('omnitts-library')); this.render();
    });
    // The catalog, once by itself (the thirty prebuilt ones are all there is until then).
    void ensureGeminiVoiceList().then(() => this.render());
    this.render();
  }
}
