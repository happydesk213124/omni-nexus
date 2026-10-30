import type { TtsCharacter } from '../core/tts-types';
import { risuHost } from '../core/host';
import { BASE_EXPRESSIONS, baseExpression } from '../domain/emotion/emotions';
import { collectFaces, currentEmotionBot, findSprite, makeSprite, spriteJobKey, spriteJobs, spriteLooks, subscribeSprites, type EmotionBot } from '../services/emotion-assets';
import { currentTtsContext } from '../services/tts-context';
import { emotionData, loadEmotionData, updateEmotionSettings, type EmotionSettings } from '../storage/emotion-store';
import { ttsData } from '../storage/tts-store';
import { EMOTION_CSS, EMOTION_PANEL, EMOTION_SHEET, EMOTION_SHEET_SWITCH, EMOTION_TABS } from './markup';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T | null;
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Adds the 감정 에셋 tab and panel beside BGM·효과음 (outside the TTS power fieldset). Idempotent. */
export function addEmotionStructure(root: ParentNode): void {
  if (root.querySelector('#emo-assets')) return;
  root.querySelector('.tts-tabs-bar nav')?.insertAdjacentHTML('beforeend', EMOTION_TABS.map(([id, label]) => `<button role="tab" id="tab-${id}" aria-controls="${id}" aria-selected="false" tabindex="-1" data-tts-tab="${id}">${label}</button>`).join(''));
  root.querySelector('#sound-controls')?.insertAdjacentHTML('beforeend', EMOTION_PANEL);
}
export const emotionStyleText = (): string => EMOTION_CSS;

// Thumbnails live in this settings iframe, so a blob URL is fine here (never in the chat).
const thumbs = new Map<string, string>();
async function thumb(path: string): Promise<string> {
  const cached = thumbs.get(path);
  if (cached) return cached;
  const raw = await risuHost()?.readImage?.(path);
  const bytes = raw instanceof Uint8Array ? raw : raw instanceof ArrayBuffer ? new Uint8Array(raw) : null;
  if (!bytes?.byteLength) return '';
  const url = URL.createObjectURL(new Blob([bytes.slice()]));
  thumbs.set(path, url);
  if (thumbs.size > 80) { const [first, old] = thumbs.entries().next().value!; thumbs.delete(first); URL.revokeObjectURL(old); }
  return url;
}

function fillSettings(s: EmotionSettings): void {
  const check = (id: string, on: boolean) => { const node = $<HTMLInputElement>(id); if (node) node.checked = on; };
  const value = (id: string, v: string) => { const node = $<HTMLInputElement>(id); if (node && document.activeElement !== node) node.value = v; };
  check('emo-enabled', s.enabled); check('emo-existing', s.useExisting); check('emo-auto', s.autoGenerate); check('emo-places', s.placeBackgrounds);
  value('emo-family', s.family); value('emo-transparent', s.transparent ? '1' : '0');
  value('emo-width', String(s.width)); value('emo-height', String(s.height));
  value('emo-prefix', s.prefix); value('emo-suffix', s.suffix); value('emo-pose', s.pose);
  for (const e of BASE_EXPRESSIONS) value(`emo-face-${e.key}`, s.faceTags[e.key] || '');
  value('emo-words', Object.entries(s.words).map(([w, face]) => `${w}=${face}`).join('\n'));
}
function readSettings(): Partial<EmotionSettings> {
  const val = (id: string) => $<HTMLInputElement>(id)?.value ?? '';
  const words: Record<string, string> = {};
  for (const line of val('emo-words').split('\n')) { const [w, face] = line.split('=').map(s => s.trim()); if (w && face && baseExpression(face)) words[w] = face; }
  return {
    enabled: !!$<HTMLInputElement>('emo-enabled')?.checked, useExisting: !!$<HTMLInputElement>('emo-existing')?.checked, autoGenerate: !!$<HTMLInputElement>('emo-auto')?.checked, placeBackgrounds: !!$<HTMLInputElement>('emo-places')?.checked,
    family: val('emo-family') === 'v4' ? 'v4' : 'v5', transparent: val('emo-transparent') !== '0',
    width: Number(val('emo-width')), height: Number(val('emo-height')), prefix: val('emo-prefix'), suffix: val('emo-suffix'), pose: val('emo-pose'),
    faceTags: Object.fromEntries(BASE_EXPRESSIONS.map(e => [e.key, val(`emo-face-${e.key}`).trim()]).filter(([, tags]) => tags)), words,
  };
}

/** This bot's TTS people with how many faces they showed; 열기 opens their sheet on 감정 에셋. */
async function renderPeople(): Promise<void> {
  const box = $('emo-people');
  if (!box) return;
  const ctx = await currentTtsContext().catch(() => null);
  if (ctx) collectFaces(ctx.messages.filter(m => m?.role === 'char').slice(-30).map(m => String(m.data ?? '')), ctx.rosterScope);
  const people = ttsData().characters.filter(c => !c.role && (c.scope === 'global' || c.scope === ctx?.rosterScope));
  const seen = emotionData().seen;
  box.innerHTML = people.length ? people.map(c => `<div class="emo-person" role="listitem"><span><b>${esc(c.name)}</b> <small>본 감정 ${(seen[c.id] || []).length}개</small></span><button type="button" data-emo-open="${esc(c.id)}">감정 에셋</button></div>`).join('')
    : '<small>이 봇의 TTS 캐릭터가 없습니다. TTS 설정의 캐릭터 탭에서 먼저 등록하세요.</small>';
}

export async function mountEmotion(root: HTMLElement, live: () => boolean): Promise<void> {
  await loadEmotionData(); if (!live()) return;
  fillSettings(emotionData().settings);
  const panel = root.querySelector('#emo-assets');
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  panel?.addEventListener('input', () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => void updateEmotionSettings(readSettings()), 400); });
  panel?.addEventListener('change', () => { clearTimeout(saveTimer); void updateEmotionSettings(readSettings()); });
  panel?.addEventListener('click', event => {
    const id = (event.target as Element | null)?.closest?.('[data-emo-open]')?.getAttribute('data-emo-open');
    if (id) document.dispatchEvent(new CustomEvent('omnitts-open-character', { detail: { id, view: 'faces' } }));
  });
  $('tab-emo-assets')?.addEventListener('click', () => void renderPeople());
  void renderPeople();
  bindCharacterSheet(live);
}

/** The character sheet: 음성 | 감정 에셋. Role cards (narration, monologue) have no face. */
function bindCharacterSheet(live: () => boolean): void {
  const form = $<HTMLFormElement>('character-form'), scroll = form?.querySelector('.editor-scroll');
  if (!form || !scroll || $('emo-char-section')) return;
  scroll.insertAdjacentHTML('afterbegin', EMOTION_SHEET_SWITCH);
  scroll.insertAdjacentHTML('beforeend', EMOTION_SHEET);
  let person: TtsCharacter | null = null, bot: EmotionBot | null = null, epoch = 0;
  const view = (name: 'voice' | 'faces') => {
    form.dataset.emoView = name;
    for (const b of form.querySelectorAll<HTMLElement>('[data-emo-tab]')) b.setAttribute('aria-selected', String(b.dataset.emoTab === name));
    if (name === 'faces') void render();
  };
  const status = (text: string) => { const node = $('emo-char-status'); if (node) node.textContent = text; };
  const render = async () => {
    const mine = ++epoch, grid = $('emo-char-grid');
    if (!grid || !person || form.dataset.emoView !== 'faces') return;
    bot = await currentEmotionBot();
    if (mine !== epoch || !bot) { if (!bot) status('Risu에서 봇을 연 상태에서 쓸 수 있습니다.'); return; }
    const seen = new Set(emotionData().seen[person.id] || []);
    const faces = [...seen, ...BASE_EXPRESSIONS.map(e => e.key).filter(k => !seen.has(k))];
    const busy = spriteJobs();
    const tiles = await Promise.all(faces.map(async face => ({ face, sprite: await findSprite(person!, face, bot!).catch(() => null), busy: busy.has(spriteJobKey(bot!.id, person!.id, face)) })));
    if (mine !== epoch) return;
    grid.innerHTML = tiles.map(({ face, sprite, busy: running }) => `<div class="emo-tile" data-seen="${seen.has(face) ? 1 : 0}"><div class="emo-pic" data-face="${esc(face)}" data-busy="${running ? 1 : 0}">${running ? '만드는 중…' : sprite ? '' : '없음'}</div>
<b>${esc(baseExpression(face)?.label || face)}</b><small>${esc(face)}${sprite ? ` · ${sprite.source === 'bot' ? '봇 에셋' : '옴니'}` : ''}${seen.has(face) ? ' · 대사에 나옴' : ''}</small>
<button type="button" data-emo-make="${esc(face)}" ${running ? 'disabled' : ''}>${sprite ? '다시 만들기' : '만들기'}</button></div>`).join('');
    for (const { face, sprite } of tiles) if (sprite) void thumb(sprite.path).then(url => { const pic = grid.querySelector<HTMLElement>(`.emo-pic[data-face="${CSS.escape(face)}"]`); if (url && pic && mine === epoch) pic.style.backgroundImage = `url("${url}")`; }).catch(() => {});
    const looks = await spriteLooks(person, bot).catch(() => '');
    const line = $('emo-char-looks');
    if (line && mine === epoch) line.textContent = looks ? `외형: ${looks}` : '외형 태그가 없습니다. 삽화 캐릭터 탭에서 이 사람의 외형을 채우면 만들 수 있습니다.';
  };
  const make = (faces: string[]) => {
    if (!person || !bot) return;
    const who = person, where = bot;
    for (const face of faces) void makeSprite(who, face, where).then(() => status(`${baseExpression(face)?.label || face} 완료`)).catch(error => status(String((error as Error)?.message || error)));
    void render();
  };
  form.addEventListener('click', event => {
    const target = event.target as Element | null;
    // The form itself carries data-emo-view: only the switch's own buttons count here.
    const switchTo = target?.closest?.('[data-emo-tab]')?.getAttribute('data-emo-tab');
    if (switchTo === 'voice' || switchTo === 'faces') { event.preventDefault(); view(switchTo); return; }
    const face = target?.closest?.('[data-emo-make]')?.getAttribute('data-emo-make');
    if (face) { event.preventDefault(); make([face]); }
  });
  const missing = async (faces: string[]) => {
    if (!person || !bot) return [];
    const found = await Promise.all(faces.map(face => findSprite(person!, face, bot!).catch(() => null)));
    return faces.filter((_, i) => !found[i]);
  };
  $('emo-char-make-seen')?.addEventListener('click', () => void (async () => make(await missing(emotionData().seen[person?.id || ''] || [])))());
  $('emo-char-make-all')?.addEventListener('click', () => void (async () => make(await missing(BASE_EXPRESSIONS.map(e => e.key))))());
  const unsubscribe = subscribeSprites(() => { if (live()) void render(); else unsubscribe(); });
  document.addEventListener('omnitts-character-open', event => {
    const detail = (event as CustomEvent<{ id?: string; view?: string }>).detail || {};
    person = ttsData().characters.find(c => c.id === detail.id && !c.role) ?? null;
    const sw = form.querySelector<HTMLElement>('.emo-sheet-switch');
    if (sw) sw.hidden = !person;
    status('');
    view(person && detail.view === 'faces' ? 'faces' : 'voice');
  });
}
