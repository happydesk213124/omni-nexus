import type { SoundItem } from '../core/sound-types';
import { soundData } from '../storage/sound-store';
import { omniSound } from '../services/sound-runtime';
import { matchesSoundSearch, suggestSfx } from '../domain/sound/find';
import { el, esc, run } from '../tts-ui/common';

export const SOUND_PICK_DIALOG = `<dialog id="snd-pick-dialog" aria-labelledby="snd-pick-title"><div class="dialog-head"><span id="snd-pick-title">효과음 고르기</span><button type="button" id="snd-pick-close" aria-label="닫기">✕</button></div>
<input id="snd-pick-search" placeholder="이름·태그·폴더 검색" aria-label="효과음 검색" autocomplete="off"><div id="snd-pick-list" role="listbox" aria-label="효과음"></div><small id="snd-pick-count"></small></dialog>`;

let picking: { word: string; current: string; done: (item: SoundItem) => void } | undefined;
let active = 0;

/**
 * Choosing one effect out of a few hundred: a search box, ▶ on every row, and
 * the effects the word sounds like on top. Replaces a long native select, which
 * could neither be searched nor heard.
 */
export function pickSfx(options: { word?: string; current?: string; title?: string }, done: (item: SoundItem) => void): void {
  const box = el<HTMLDialogElement>('snd-pick-dialog'); if (!box) return;
  picking = { word: options.word || '', current: options.current || '', done };
  el('snd-pick-title').textContent = options.title || (options.word ? `「${options.word}」에 연결할 효과음` : '효과음 고르기');
  el<HTMLInputElement>('snd-pick-search').value = '';
  active = 0; paint();
  if (!box.open) box.showModal();
  el('snd-pick-search').focus();
}

function rows(): { item: SoundItem; hint?: boolean }[] {
  if (!picking) return [];
  const query = el<HTMLInputElement>('snd-pick-search').value.trim(), items = soundData().sfx;
  const hits = items.filter(item => matchesSoundSearch(item, query));
  if (query || !picking.word) return hits.map(item => ({ item }));
  const hints = suggestSfx(picking.word, soundData().glossary, items, 3), keys = new Set(hints.map(item => item.key));
  return [...hints.map(item => ({ item, hint: true })), ...hits.filter(item => !keys.has(item.key)).map(item => ({ item }))];
}

function paint(): void {
  const list = el('snd-pick-list'); if (!list || !picking) return;
  const shown = rows();
  active = Math.max(0, Math.min(active, shown.length - 1));
  list.replaceChildren();
  shown.forEach(({ item, hint }, index) => {
    const row = document.createElement('div');
    row.className = 'snd-pick-row' + (index === active ? ' active' : '') + (item.key === picking!.current ? ' current' : '');
    row.setAttribute('role', 'option'); row.setAttribute('aria-selected', String(index === active)); row.dataset.key = item.key;
    row.innerHTML = `<button type="button" class="snd-pick-play" aria-label="${esc(item.name)} 들어보기" title="들어보기">▶</button>`
      + `<button type="button" class="snd-pick-name"><b>${esc(item.name)}</b>${hint ? '<em>추천</em>' : ''}${item.key === picking!.current ? '<em>지금</em>' : ''}<small>${esc([item.folder, item.tags.slice(0, 4).join(', ')].filter(Boolean).join(' · '))}</small></button>`;
    row.querySelector('.snd-pick-play')!.addEventListener('click', () => run(() => omniSound.play(item)));
    row.querySelector('.snd-pick-name')!.addEventListener('click', () => choose(item));
    list.append(row);
  });
  if (!shown.length) list.innerHTML = `<p class="char-empty">${soundData().sfx.length ? '검색에 맞는 효과음이 없습니다.' : '등록된 효과음이 없습니다. 효과음 목록에서 먼저 추가하세요.'}</p>`;
  el('snd-pick-count').textContent = shown.length ? `${shown.length}개 · ↑↓로 고르고 Enter` : '';
}

function choose(item: SoundItem): void {
  const done = picking?.done; picking = undefined;
  el<HTMLDialogElement>('snd-pick-dialog')?.close();
  done?.(item);
}

export function bindSfxPicker(): void {
  const box = el<HTMLDialogElement>('snd-pick-dialog'); if (!box || box.dataset.bound) return;
  box.dataset.bound = '1';
  el('snd-pick-close').addEventListener('click', () => box.close());
  box.addEventListener('close', () => { picking = undefined; });
  // A tap on the backdrop (the dialog itself, outside its content) closes it.
  box.addEventListener('click', event => { if (event.target === box) box.close(); });
  el('snd-pick-search').addEventListener('input', () => { active = 0; paint(); });
  el('snd-pick-search').addEventListener('keydown', event => {
    const shown = rows();
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault(); active = (active + (event.key === 'ArrowDown' ? 1 : -1) + shown.length) % Math.max(1, shown.length); paint();
      el('snd-pick-list').querySelector('.active')?.scrollIntoView({ block: 'nearest' });
    } else if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); const row = shown[active]; if (row) choose(row.item); }
  });
}
