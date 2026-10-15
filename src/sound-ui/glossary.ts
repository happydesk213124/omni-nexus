import type { SfxTerm } from '../core/sound-types';
import { soundData, saveSoundData } from '../storage/sound-store';
import { soundTags } from '../domain/sound/tags';
import { el, val, esc, run } from '../tts-ui/common';
import { uuid } from '../core/util/text';

const effectOptions = (selected: string) => ['<option value="">효과음 선택</option>', ...soundData().sfx.map(item => `<option value="${esc(item.key)}" ${item.key === selected ? 'selected' : ''}>${esc(item.name)}</option>`)].join('');

/** Word → effect rows, plus the words replies used that no row knows yet. */
export function renderGlossary(): void {
  const host = el('snd-terms'); if (!host) return;
  const query = val('snd-term-search').toLowerCase();
  host.replaceChildren();
  const rows = soundData().glossary.filter(row => !query || row.terms.some(term => term.toLowerCase().includes(query)));
  if (!rows.length) host.innerHTML = '<p class="char-empty">등록된 용어가 없습니다.</p>';
  for (const row of rows) {
    const line = document.createElement('div'); line.className = 'row snd-term';
    line.innerHTML = `<label class="switch"><input type="checkbox" ${row.enabled ? 'checked' : ''} aria-label="용어 사용"></label>`
      + `<input value="${esc(row.terms.join(', '))}" aria-label="용어 · 쉼표로 구분" style="flex:1;min-width:0">`
      + `<select aria-label="연결할 효과음">${effectOptions(row.sfxKey)}</select><button type="button" class="danger">삭제</button>`;
    const on = line.querySelector<HTMLInputElement>('input[type=checkbox]')!, terms = line.querySelectorAll('input')[1] as HTMLInputElement, effect = line.querySelector('select')!;
    const save = () => run(async () => { Object.assign(row, { enabled: on.checked, terms: soundTags(terms.value), sfxKey: effect.value }); if (!row.terms.length) soundData().glossary = soundData().glossary.filter(r => r !== row); await saveSoundData(); renderGlossary(); });
    for (const field of [on, terms, effect]) field.addEventListener('change', save);
    line.querySelector('button')!.addEventListener('click', () => run(async () => { soundData().glossary = soundData().glossary.filter(r => r !== row); await saveSoundData(); renderGlossary(); }));
    host.append(line);
  }
  const unknown = el('snd-unknown'); unknown.replaceChildren();
  if (!soundData().unknownTerms.length) unknown.innerHTML = '<p class="char-empty">아직 모인 말이 없습니다.</p>';
  for (const word of soundData().unknownTerms) {
    const line = document.createElement('div'); line.className = 'row snd-unknown';
    line.innerHTML = `<b style="flex:1;min-width:0;overflow-wrap:anywhere">${esc(word)}</b><select aria-label="${esc(word)}에 연결할 효과음">${effectOptions('')}</select><button type="button">무시</button>`;
    const pick = line.querySelector('select')!;
    pick.addEventListener('change', () => run(async () => {
      if (!pick.value) return;
      const target = soundData().glossary.find(row => row.sfxKey === pick.value);
      if (target) target.terms = soundTags([...target.terms, word]);
      else soundData().glossary.push({ id: uuid(), terms: [word], sfxKey: pick.value, enabled: true } satisfies SfxTerm);
      soundData().unknownTerms = soundData().unknownTerms.filter(w => w !== word);
      await saveSoundData(); renderGlossary();
    }));
    line.querySelector('button')!.addEventListener('click', () => run(async () => { soundData().unknownTerms = soundData().unknownTerms.filter(w => w !== word); await saveSoundData(); renderGlossary(); }));
    unknown.append(line);
  }
}
export function bindGlossary(): void {
  el('snd-term-search')?.addEventListener('input', renderGlossary);
  el('snd-term-add')?.addEventListener('click', () => run(async () => {
    soundData().glossary.unshift({ id: uuid(), terms: ['새 용어'], sfxKey: '', enabled: true }); await saveSoundData(); renderGlossary();
  }));
  renderGlossary();
}
