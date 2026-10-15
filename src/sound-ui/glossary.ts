import type { SfxTerm } from '../core/sound-types';
import { soundData, saveSoundData } from '../storage/sound-store';
import { soundTags } from '../domain/sound/tags';
import { omniSound } from '../services/sound-runtime';
import { el, val, esc, run, notify } from '../tts-ui/common';
import { uuid } from '../core/util/text';

const effectOptions = (selected: string, empty = '효과음 선택') => [`<option value="">${empty}</option>`, ...soundData().sfx.map(item => `<option value="${esc(item.key)}" ${item.key === selected ? 'selected' : ''}>${esc(item.name)}</option>`)].join('');
const effectName = (key: string) => soundData().sfx.find(item => item.key === key)?.name || '';

/** One word means one effect: a word given to a row leaves every other row and the unknown list. */
function giveWords(row: SfxTerm, words: readonly string[]): void {
  const data = soundData(), keys = new Set(words.map(word => word.toLowerCase()));
  for (const other of data.glossary) if (other !== row) other.terms = other.terms.filter(term => !keys.has(term.toLowerCase()));
  row.terms = soundTags([...row.terms, ...words]);
  data.unknownTerms = data.unknownTerms.filter(word => !keys.has(word.toLowerCase()));
}
/** Words and the unknown list are two tabs of the glossary. */
let tab: 'terms' | 'unknown' = 'terms';
function showTab(next: typeof tab): void {
  tab = next;
  for (const [name, panel, button] of [['terms', 'snd-gloss-terms', 'snd-gloss-tab-terms'], ['unknown', 'snd-gloss-unknown', 'snd-gloss-tab-unknown']] as const) {
    const on = tab === name; const node = el(panel); if (node) node.hidden = !on; el(button)?.setAttribute('aria-selected', String(on));
  }
  el('snd-term-add')?.toggleAttribute('hidden', tab !== 'terms');
}
const save = (focusRow?: string) => run(async () => { await saveSoundData(); renderGlossary(focusRow); });

/**
 * Word → effect tiles: the effect, its words as chips (× drops one), a field to
 * add words, ▶ to hear it, on/off and delete, all on the tile itself; no dialog.
 * Unknown words are small tiles that join a row by picking an effect.
 */
export function renderGlossary(focusRow?: string): void {
  const host = el('snd-terms'); if (!host) return;
  const query = val('snd-term-search').trim().toLowerCase();
  host.replaceChildren(); host.classList.add('snd-tile-grid');
  const rows = soundData().glossary.filter(row => !query || row.terms.some(term => term.toLowerCase().includes(query)) || effectName(row.sfxKey).toLowerCase().includes(query));
  if (!rows.length) host.innerHTML = `<p class="char-empty" style="grid-column:1/-1">${query ? '검색에 맞는 용어가 없습니다.' : '등록된 용어가 없습니다. + 묶음으로 만들거나, 아래 미등록 용어에서 효과음을 고르세요.'}</p>`;
  for (const row of rows) {
    const tile = document.createElement('div'); tile.className = 'snd-term-tile' + (row.enabled ? '' : ' off'); tile.dataset.row = row.id;
    tile.innerHTML = `<div class="snd-term-head"><label class="switch" title="사용"><input type="checkbox" ${row.enabled ? 'checked' : ''} aria-label="이 묶음 사용"></label>`
      + `<select class="snd-term-effect" aria-label="연결할 효과음">${effectOptions(row.sfxKey)}</select>`
      + `<button type="button" class="snd-term-play" title="들어보기" aria-label="효과음 들어보기" ${row.sfxKey ? '' : 'disabled'}>▶</button>`
      + `<button type="button" class="danger snd-term-delete" title="묶음 삭제" aria-label="묶음 삭제">✕</button></div>`
      + `<div class="snd-term-chips">${row.terms.map((term, i) => `<span class="snd-chip">${esc(term)}<button type="button" data-term="${i}" aria-label="${esc(term)} 빼기">×</button></span>`).join('')}`
      + `<input class="snd-term-new" placeholder="+ 용어 추가" title="Enter로 추가 · 쉼표로 여러 개" aria-label="용어 추가 (쉼표로 여러 개)"></div>`;
    const on = tile.querySelector<HTMLInputElement>('input[type=checkbox]')!, effect = tile.querySelector('select')!, add = tile.querySelector<HTMLInputElement>('.snd-term-new')!;
    on.addEventListener('change', () => { row.enabled = on.checked; tile.classList.toggle('off', !row.enabled); void save(); });
    effect.addEventListener('change', () => { row.sfxKey = effect.value; void save(); });
    tile.querySelector('.snd-term-play')!.addEventListener('click', () => run(async () => { const item = soundData().sfx.find(sfx => sfx.key === row.sfxKey); if (item) await omniSound.play(item); }));
    tile.querySelector('.snd-term-delete')!.addEventListener('click', () => { soundData().glossary = soundData().glossary.filter(r => r !== row); void save(); });
    for (const button of tile.querySelectorAll<HTMLButtonElement>('[data-term]')) button.addEventListener('click', () => { row.terms = row.terms.filter((_, i) => i !== Number(button.dataset.term)); void save(row.id); });
    const commit = () => { const words = soundTags(add.value); if (!words.length) return; giveWords(row, words); void save(row.id); };
    add.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); commit(); } });
    add.addEventListener('change', commit);
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
    tile.innerHTML = `<b>${esc(word)}</b><div class="snd-unknown-row"><select aria-label="${esc(word)}에 연결할 효과음">${effectOptions('', '효과음에 연결')}</select><button type="button" title="무시" aria-label="${esc(word)} 무시">무시</button></div>`;
    const pick = tile.querySelector('select')!;
    pick.addEventListener('change', () => {
      if (!pick.value) return;
      const target = soundData().glossary.find(row => row.sfxKey === pick.value);
      if (target) giveWords(target, [word]);
      else { const row: SfxTerm = { id: uuid(), terms: [], sfxKey: pick.value, enabled: true }; soundData().glossary.push(row); giveWords(row, [word]); }
      void save();
    });
    tile.querySelector('button')!.addEventListener('click', () => { soundData().unknownTerms = soundData().unknownTerms.filter(w => w !== word); void save(); });
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
  el('snd-unknown-clear')?.addEventListener('click', () => { if (!soundData().unknownTerms.length || !confirm('미등록 용어를 모두 지울까요?')) return; soundData().unknownTerms = []; void save(); });
  renderGlossary();
}
