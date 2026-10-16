import type { SfxTerm } from '../core/sound-types';
import { soundData, saveSoundData } from '../storage/sound-store';
import { soundTags } from '../domain/sound/tags';
import { omniSound } from '../services/sound-runtime';
import { suggestSfx } from '../domain/sound/find';
import { el, val, esc, run, notify } from '../tts-ui/common';
import { uuid } from '../core/util/text';
import { pickSfx } from './picker';

const effectName = (key: string) => soundData().sfx.find(item => item.key === key)?.name || '';

/** One word means one effect: a word given to a row leaves every other row and the unknown list. */
export function giveWords(row: SfxTerm, words: readonly string[]): void {
  const data = soundData(), keys = new Set(words.map(word => word.toLowerCase()));
  for (const other of data.glossary) if (other !== row) other.terms = other.terms.filter(term => !keys.has(term.toLowerCase()));
  row.terms = soundTags([...row.terms, ...words]);
  data.unknownTerms = data.unknownTerms.filter(word => !keys.has(word.toLowerCase()));
}
/** Every glossary word that plays this effect, across its tiles. */
export function wordsFor(sfxKey: string): string[] {
  return soundTags(soundData().glossary.filter(row => row.sfxKey === sfxKey).flatMap(row => row.terms));
}
/** The effect's words become exactly `words`: dropped ones leave, new ones move here from any other tile. */
export function setWordsFor(sfxKey: string, words: readonly string[]): void {
  const data = soundData(), keep = new Set(words.map(word => word.toLowerCase()));
  const rows = data.glossary.filter(row => row.sfxKey === sfxKey);
  for (const row of rows) row.terms = row.terms.filter(term => keep.has(term.toLowerCase()));
  if (!words.length) return;
  let row = rows[0];
  if (!row) { row = { id: uuid(), terms: [], sfxKey, enabled: true }; data.glossary.push(row); }
  giveWords(row, words);
}
/** An unknown word joins the tile of the effect picked for it (a new tile when it has none). */
function connect(word: string, sfxKey: string): void {
  const data = soundData(), target = data.glossary.find(row => row.sfxKey === sfxKey);
  if (target) giveWords(target, [word]);
  else { const row: SfxTerm = { id: uuid(), terms: [], sfxKey, enabled: true }; data.glossary.push(row); giveWords(row, [word]); }
}
/** Words and the unknown list are two tabs of the glossary. */
let tab: 'terms' | 'unknown' = 'terms';
/**
 * 다중선택: a checkbox on every tile, and one delete for the ticked ones. Each tab
 * keeps its own ticks (tile ids, unknown words); leaving the mode clears them.
 */
let picking = false;
const picked = { terms: new Set<string>(), unknown: new Set<string>() };
function syncPicking(): void {
  const set = picked[tab], n = set.size;
  el('snd-gloss-multi')?.setAttribute('aria-pressed', String(picking));
  for (const id of ['snd-gloss-all', 'snd-gloss-none', 'snd-gloss-delete']) { const node = el(id); if (node) node.hidden = !picking; }
  const remove = el<HTMLButtonElement>('snd-gloss-delete'); if (remove) { remove.disabled = !n; remove.textContent = n ? `${n}개 삭제` : '선택 삭제'; }
  const status = el('snd-gloss-picked'); if (status) status.textContent = picking ? (n ? `선택 ${n}개` : '선택 없음') : '';
}
/** A tile in 다중선택: its checkbox, and a click on its empty area, tick it. */
function pickable(tile: HTMLElement, set: Set<string>, key: string): void {
  if (!picking) return;
  tile.classList.add('picking'); tile.classList.toggle('picked', set.has(key));
  const box = document.createElement('input'); box.type = 'checkbox'; box.className = 'snd-pick'; box.checked = set.has(key); box.setAttribute('aria-label', '선택');
  const flip = () => { if (set.has(key)) set.delete(key); else set.add(key); box.checked = set.has(key); tile.classList.toggle('picked', set.has(key)); syncPicking(); };
  box.addEventListener('change', () => { if (box.checked !== set.has(key)) flip(); });
  tile.addEventListener('click', event => { if (event.target === tile || (event.target as Element).matches?.('.snd-term-chips,.snd-term-head,b')) flip(); });
  tile.prepend(box);
}
function showTab(next: typeof tab): void {
  tab = next;
  syncPicking();
  for (const [name, panel, button] of [['terms', 'snd-gloss-terms', 'snd-gloss-tab-terms'], ['unknown', 'snd-gloss-unknown', 'snd-gloss-tab-unknown']] as const) {
    const on = tab === name; const node = el(panel); if (node) node.hidden = !on; el(button)?.setAttribute('aria-selected', String(on));
  }
  el('snd-term-add')?.toggleAttribute('hidden', tab !== 'terms');
}
const save = (focusRow?: string) => run(async () => { await saveSoundData(); renderGlossary(focusRow); });

/**
 * Word → effect tiles: the effect, its words as chips (× drops one), a field to
 * add words, ▶ to hear it, on/off and delete, all on the tile itself. The effect
 * is picked from a searchable list with ▶. Unknown words are small tiles with the
 * effects they sound like as one-tap choices.
 */
export function renderGlossary(focusRow?: string): void {
  const host = el('snd-terms'); if (!host) return;
  const query = val('snd-term-search').trim().toLowerCase();
  host.replaceChildren(); host.classList.add('snd-tile-grid');
  for (const id of [...picked.terms]) if (!soundData().glossary.some(row => row.id === id)) picked.terms.delete(id);
  for (const word of [...picked.unknown]) if (!soundData().unknownTerms.includes(word)) picked.unknown.delete(word);
  const rows = soundData().glossary.filter(row => !query || row.terms.some(term => term.toLowerCase().includes(query)) || effectName(row.sfxKey).toLowerCase().includes(query));
  if (!rows.length) host.innerHTML = `<p class="char-empty" style="grid-column:1/-1">${query ? '검색에 맞는 용어가 없습니다.' : '등록된 용어가 없습니다. + 묶음으로 만들거나, 아래 미등록 용어에서 효과음을 고르세요.'}</p>`;
  for (const row of rows) {
    const tile = document.createElement('div'); tile.className = 'snd-term-tile' + (row.enabled ? '' : ' off'); tile.dataset.row = row.id;
    tile.innerHTML = `<div class="snd-term-head"><label class="switch" title="사용"><input type="checkbox" ${row.enabled ? 'checked' : ''} aria-label="이 묶음 사용"></label>`
      + `<button type="button" class="snd-term-effect${row.sfxKey && effectName(row.sfxKey) ? '' : ' empty'}" data-key="${esc(row.sfxKey)}" aria-label="연결할 효과음 · 눌러서 바꾸기" title="눌러서 효과음 바꾸기">${esc(effectName(row.sfxKey) || '효과음 고르기')}<span aria-hidden="true">▾</span></button>`
      + `<button type="button" class="snd-term-play" title="들어보기" aria-label="효과음 들어보기" ${row.sfxKey ? '' : 'disabled'}>▶</button>`
      + `<button type="button" class="danger snd-term-delete" title="묶음 삭제" aria-label="묶음 삭제">✕</button></div>`
      + `<div class="snd-term-chips">${row.terms.map((term, i) => `<span class="snd-chip">${esc(term)}<button type="button" data-term="${i}" aria-label="${esc(term)} 빼기">×</button></span>`).join('')}`
      + `<input class="snd-term-new" placeholder="+ 용어 추가" title="Enter로 추가 · 쉼표로 여러 개" aria-label="용어 추가 (쉼표로 여러 개)"></div>`;
    const on = tile.querySelector<HTMLInputElement>('input[type=checkbox]')!, effect = tile.querySelector<HTMLButtonElement>('.snd-term-effect')!, add = tile.querySelector<HTMLInputElement>('.snd-term-new')!;
    on.addEventListener('change', () => { row.enabled = on.checked; tile.classList.toggle('off', !row.enabled); void save(); });
    effect.addEventListener('click', () => pickSfx({ current: row.sfxKey, title: row.terms.length ? `「${row.terms.slice(0, 3).join(', ')}」의 효과음` : '이 묶음의 효과음' }, item => { row.sfxKey = item.key; void save(row.id); }));
    tile.querySelector('.snd-term-play')!.addEventListener('click', () => run(async () => { const item = soundData().sfx.find(sfx => sfx.key === row.sfxKey); if (item) await omniSound.play(item); }));
    tile.querySelector('.snd-term-delete')!.addEventListener('click', () => {
      if (row.terms.length && !confirm(`이 묶음(${row.terms.slice(0, 4).join(', ')}${row.terms.length > 4 ? ' …' : ''})을 지울까요?`)) return;
      soundData().glossary = soundData().glossary.filter(r => r !== row); void save();
    });
    for (const button of tile.querySelectorAll<HTMLButtonElement>('[data-term]')) button.addEventListener('click', () => { row.terms = row.terms.filter((_, i) => i !== Number(button.dataset.term)); void save(row.id); });
    const commit = () => { const words = soundTags(add.value); if (!words.length) return; giveWords(row, words); void save(row.id); };
    add.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); commit(); } });
    add.addEventListener('change', commit);
    pickable(tile, picked.terms, row.id);
    host.append(tile);
    if (focusRow === row.id) add.focus();
  }
  const unknown = el('snd-unknown'); unknown.replaceChildren(); unknown.classList.add('snd-tile-grid', 'compact');
  const words = soundData().unknownTerms.filter(word => !query || word.toLowerCase().includes(query));
  const count = (id: string, n: number) => { const node = el(id); if (node) node.textContent = String(n); };
  count('snd-terms-count', soundData().glossary.length); count('snd-unknown-count', soundData().unknownTerms.length);
  showTab(tab);
  if (!words.length) unknown.innerHTML = `<p class="char-empty" style="grid-column:1/-1">${query && soundData().unknownTerms.length ? '검색에 맞는 말이 없습니다.' : '아직 모인 말이 없습니다.'}</p>`;
  for (const word of words) {
    const tile = document.createElement('div'); tile.className = 'snd-unknown-tile';
    // Only close spellings become one-tap chips; the picker shows looser guesses too.
    const hints = suggestSfx(word, soundData().glossary, soundData().sfx, 2, 0.55);
    tile.innerHTML = `<b>${esc(word)}</b>`
      + (hints.length ? `<div class="snd-unknown-hints">${hints.map(item => `<button type="button" class="snd-hint" data-key="${esc(item.key)}" title="「${esc(word)}」→ ${esc(item.name)}에 연결">→ ${esc(item.name)}</button>`).join('')}</div>` : '')
      + `<div class="snd-unknown-row"><button type="button" class="snd-unknown-pick" title="검색해서 효과음 고르기">직접 고르기</button><button type="button" class="snd-unknown-ignore" title="무시" aria-label="${esc(word)} 무시">무시</button></div>`;
    for (const hint of tile.querySelectorAll<HTMLButtonElement>('.snd-hint')) hint.addEventListener('click', () => { connect(word, hint.dataset.key || ''); void save(); });
    tile.querySelector('.snd-unknown-pick')!.addEventListener('click', () => pickSfx({ word }, item => { connect(word, item.key); void save(); }));
    tile.querySelector('.snd-unknown-ignore')!.addEventListener('click', () => { soundData().unknownTerms = soundData().unknownTerms.filter(w => w !== word); void save(); });
    pickable(tile, picked.unknown, word);
    unknown.append(tile);
  }
}
export function bindGlossary(): void {
  el('snd-term-search')?.addEventListener('input', () => renderGlossary());
  el('snd-gloss-tab-terms')?.addEventListener('click', () => showTab('terms'));
  el('snd-gloss-tab-unknown')?.addEventListener('click', () => showTab('unknown'));
  el('snd-unknown-auto')?.addEventListener('click', () => run(async () => {
    const button = el<HTMLButtonElement>('snd-unknown-auto'); if (button.disabled) return;
    if (!soundData().unknownTerms.length) { notify('등록할 미등록 용어가 없습니다.'); return; }
    button.disabled = true; button.textContent = '⚡ 고르는 중…';
    try { const result = await omniSound.learnUnknown(); notify(`${result.learned}개를 용어집에 넣었습니다${result.left ? ` · ${result.left}개는 맞는 효과음이 없어 남겨 두었습니다` : ''}.`); }
    finally { button.disabled = false; button.textContent = '⚡ 자동 등록'; renderGlossary(); }
  }));
  el('snd-term-add')?.addEventListener('click', () => {
    const row: SfxTerm = { id: uuid(), terms: [], sfxKey: '', enabled: true };
    soundData().glossary.unshift(row); el<HTMLInputElement>('snd-term-search').value = ''; showTab('terms'); void save(row.id);
  });
  el('snd-gloss-multi')?.addEventListener('click', () => { picking = !picking; if (!picking) { picked.terms.clear(); picked.unknown.clear(); } renderGlossary(); });
  // 전체 선택: what this tab shows now (a search narrows it).
  el('snd-gloss-all')?.addEventListener('click', () => {
    const query = val('snd-term-search').trim().toLowerCase();
    if (tab === 'terms') for (const row of soundData().glossary) { if (!query || row.terms.some(t => t.toLowerCase().includes(query)) || effectName(row.sfxKey).toLowerCase().includes(query)) picked.terms.add(row.id); }
    else for (const word of soundData().unknownTerms) { if (!query || word.toLowerCase().includes(query)) picked.unknown.add(word); }
    renderGlossary();
  });
  el('snd-gloss-none')?.addEventListener('click', () => { picked[tab].clear(); renderGlossary(); });
  el('snd-gloss-delete')?.addEventListener('click', () => {
    const set = picked[tab]; if (!set.size) return;
    if (tab === 'terms') {
      const rows = soundData().glossary.filter(row => set.has(row.id)), words = rows.reduce((n, row) => n + row.terms.length, 0);
      if (words && !confirm(`선택한 묶음 ${rows.length}개(용어 ${words}개)를 지울까요?`)) return;
      soundData().glossary = soundData().glossary.filter(row => !set.has(row.id));
    } else {
      if (!confirm(`선택한 미등록 용어 ${set.size}개를 지울까요?`)) return;
      soundData().unknownTerms = soundData().unknownTerms.filter(word => !set.has(word));
    }
    set.clear(); void save();
  });
  el('snd-unknown-clear')?.addEventListener('click', () => { if (!soundData().unknownTerms.length || !confirm('미등록 용어를 모두 지울까요?')) return; soundData().unknownTerms = []; void save(); });
  renderGlossary();
}
