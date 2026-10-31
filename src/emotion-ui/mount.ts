import type { TtsCharacter } from '../core/tts-types';
import { risuHost } from '../core/host';
import { BASE_EXPRESSIONS, baseExpression } from '../domain/emotion/emotions';
import { backgroundPlaces, collectFaces, currentEmotionBot, findBackground, findSprite, makeBackground, makeSprite, PLACE_PERSON, spriteJobKey, spriteJobs, spriteLooks, subscribeSprites, type EmotionBot } from '../services/emotion-assets';
import { PLACE_SAMPLES } from '../config/place-samples';
import { placeKey, samePlace } from '../domain/viewer/place';
import { ensurePlaceModule } from '../storage/place-module';
import { currentTtsContext } from '../services/tts-context';
import { emotionData, loadEmotionData, updateEmotionSettings, type EmotionSettings } from '../storage/emotion-store';
import { ttsData } from '../storage/tts-store';
import { loadViewerPrefs, saveViewerPrefs, viewerPrefs, type ViewerBgPick, type ViewerSpeed, type ViewerTextSize } from '../storage/viewer-prefs';
import { EMOTION_CSS, EMOTION_PANEL, EMOTION_SHEET, EMOTION_SHEET_SWITCH, EMOTION_TABS } from './markup';
import { attachSoundHelp } from '../sound-ui/help';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T | null;
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Adds the 뷰어 · 배경 · 감정 에셋 tabs and panels beside BGM·효과음 (outside the TTS power fieldset). Idempotent. */
export function addEmotionStructure(root: ParentNode): void {
  if (root.querySelector('#emo-assets')) return;
  root.querySelector('.tts-tabs-bar nav')?.insertAdjacentHTML('beforeend', EMOTION_TABS.map(([id, label]) => `<button role="tab" id="tab-${id}" aria-controls="${id}" aria-selected="false" tabindex="-1" data-tts-tab="${id}">${label}</button>`).join(''));
  root.querySelector('#sound-controls')?.insertAdjacentHTML('beforeend', EMOTION_PANEL);
  attachSoundHelp(root);
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
  gates(s);
  value('emo-words', Object.entries(s.words).map(([w, face]) => `${w}=${face}`).join('\n'));
}
/** A section whose switch is off greys out (its values stay). */
function gates(s: Pick<EmotionSettings, 'enabled' | 'placeBackgrounds'>): void {
  const gate = (id: string, on: boolean) => { const node = $<HTMLFieldSetElement>(id); if (node) node.disabled = !on; };
  gate('emo-faces-gate', s.enabled); gate('emo-bg-gate', s.placeBackgrounds);
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

/**
 * 배경: this bot's backgrounds (a tile each, its picture after) and the sample places (a
 * chip each). What was drawn is marked on the list itself: a page opened again is new
 * markup and is drawn again (marked here in memory, it stayed empty once reopened).
 */
async function renderBackgrounds(): Promise<void> {
  const list = $('emo-bg-list'), chips = $('emo-bg-samples'), count = $('emo-bg-count');
  if (!list || !chips) return;
  const bot = await currentEmotionBot().catch(() => null);
  const prefix = bot ? spriteJobKey(bot.id, PLACE_PERSON, '') : '';
  const places = bot ? await backgroundPlaces(bot) : [], busy = new Set(bot ? [...spriteJobs()].filter(key => key.startsWith(prefix)).map(key => key.slice(prefix.length)) : []);
  if (count) count.textContent = bot ? `${places.length}장` : '';
  const signature = JSON.stringify([bot?.id ?? '', places, [...busy]]);
  if (list.dataset.shown === signature && chips.childElementCount) return;
  list.dataset.shown = signature;
  list.innerHTML = !bot ? '<small>채팅을 연 봇이 없습니다. 봇과의 채팅을 열면 그 봇의 배경이 보입니다.</small>'
    : [...[...busy].filter(place => !places.some(known => samePlace(known, place))).map(place => `<div class="emo-bg-tile" role="listitem"><div class="emo-bg-pic" data-busy="1">그리는 중…</div><small title="${esc(place)}">${esc(place)}</small></div>`),
      ...places.map((place, i) => `<div class="emo-bg-tile" role="listitem"><div class="emo-bg-pic" data-bg-pic="${i}"></div><small title="${esc(place)}">${esc(place)}</small></div>`)].join('')
      || '<small>아직 없습니다. 뷰어에 장소가 나오면 그려서 여기에 쌓입니다.</small>';
  // The samples are tags: listed with or without a bot (drawing one needs the bot's chat open).
  chips.innerHTML = PLACE_SAMPLES.map(sample => { const k = placeKey(sample), made = places.some(place => samePlace(place, k)); return `<button type="button" data-emo-bg-make="${esc(k)}"${made ? ' data-made="1"' : ''}${made || !bot ? ' disabled' : ''}>${esc(k)}</button>`; }).join('');
  if (!bot) return;
  // Pictures last, one by one: the list is up at once.
  for (const [i, place] of places.entries()) {
    const found = await findBackground(place, bot).catch(() => null), url = found ? await thumb(found.path).catch(() => '') : '';
    const pic = list.querySelector<HTMLElement>(`[data-bg-pic="${i}"]`);
    if (pic && url) pic.style.backgroundImage = `url("${url}")`;
  }
}

export async function mountEmotion(root: HTMLElement, live: () => boolean): Promise<void> {
  await Promise.all([loadEmotionData(), loadViewerPrefs()]); if (!live()) return;
  fillSettings(emotionData().settings);
  // 옴니 뷰어's own settings (its store, not 감정 에셋's): read on its next open.
  const skip = root.querySelector<HTMLTextAreaElement>('#emo-skip'), speed = root.querySelector<HTMLSelectElement>('#emo-speed'), size = root.querySelector<HTMLSelectElement>('#emo-size');
  if (skip) skip.value = viewerPrefs().skipWords;
  if (speed) speed.value = viewerPrefs().speed;
  if (size) size.value = viewerPrefs().textSize;
  const pick = root.querySelector<HTMLSelectElement>('#emo-bg-pick'), module = root.querySelector<HTMLInputElement>('#emo-place-module'), moduleStatus = $('emo-place-module-status');
  if (pick) pick.value = viewerPrefs().bgPick;
  if (module) module.checked = viewerPrefs().placeModule;
  pick?.addEventListener('change', event => { event.stopPropagation(); void saveViewerPrefs({ bgPick: (pick.value || 'auto') as ViewerBgPick }); });
  // ⚛️ omni place: written to Risu's module list at once; a failure puts the switch back and says why.
  module?.addEventListener('change', event => {
    event.stopPropagation();
    const on = module.checked;
    if (moduleStatus) moduleStatus.textContent = on ? '설치하는 중…' : '끄는 중…';
    void ensurePlaceModule(on).then(async () => {
      await saveViewerPrefs({ placeModule: on });
      if (moduleStatus) moduleStatus.textContent = on ? '켜짐 · 응답이 [[place:…]]를 씁니다' : '꺼짐';
    }).catch(error => { module.checked = !on; if (moduleStatus) moduleStatus.textContent = String((error as Error)?.message || error); });
  });
  if (moduleStatus) moduleStatus.textContent = viewerPrefs().placeModule ? '켜짐 · 응답이 [[place:…]]를 씁니다' : '';
  const keepViewer = () => void saveViewerPrefs({ skipWords: skip?.value ?? '', speed: (speed?.value || 'fast') as ViewerSpeed, textSize: (size?.value || 'normal') as ViewerTextSize });
  let viewerTimer: ReturnType<typeof setTimeout> | undefined;
  for (const node of [skip, speed, size]) {
    // Kept as typed (a window closed mid-word keeps it); not 감정 에셋's own save.
    node?.addEventListener('input', event => { event.stopPropagation(); clearTimeout(viewerTimer); viewerTimer = setTimeout(keepViewer, 400); });
    node?.addEventListener('change', event => { event.stopPropagation(); clearTimeout(viewerTimer); keepViewer(); });
  }
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  const save = () => { const next = readSettings(); gates({ enabled: !!next.enabled, placeBackgrounds: !!next.placeBackgrounds }); return updateEmotionSettings(next); };
  for (const panel of root.querySelectorAll('#emo-bg, #emo-assets')) {
    panel.addEventListener('input', () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => void save(), 400); });
    panel.addEventListener('change', () => { clearTimeout(saveTimer); void save(); });
  }
  root.querySelector('#emo-assets')?.addEventListener('click', event => {
    const id = (event.target as Element | null)?.closest?.('[data-emo-open]')?.getAttribute('data-emo-open');
    if (id) document.dispatchEvent(new CustomEvent('omnitts-open-character', { detail: { id, view: 'faces' } }));
  });
  // A sample pressed: drawn now for this bot (it shows in the list while it is being drawn, then as itself).
  root.querySelector('#emo-bg')?.addEventListener('click', event => {
    const button = (event.target as Element | null)?.closest?.<HTMLButtonElement>('[data-emo-bg-make]');
    const place = button?.getAttribute('data-emo-bg-make');
    if (!button || !place) return;
    button.disabled = true;
    void currentEmotionBot().then(bot => { if (!bot) throw new Error('채팅을 연 봇이 없습니다.'); const job = makeBackground(place, bot, true); void renderBackgrounds(); return job; })
      .catch(error => { button.disabled = false; button.title = String((error as Error)?.message || error); }).finally(() => void renderBackgrounds());
  });
  $('tab-emo-assets')?.addEventListener('click', () => void renderPeople());
  // Drawn whenever 배경 comes into view: its tab pressed, or the page opened (again) on it.
  const bgPanel = $('emo-bg');
  if (bgPanel) {
    const shown = () => { if (live() && !bgPanel.hidden) void renderBackgrounds(); };
    new MutationObserver(shown).observe(bgPanel, { attributes: true, attributeFilter: ['hidden'] });
    shown();
  }
  const unsubscribe = subscribeSprites(() => { if (!live()) { unsubscribe(); return; } if (!$('emo-bg')?.hidden) void renderBackgrounds(); });
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
    for (const face of faces) void makeSprite(who, face, where, true).then(() => status(`${baseExpression(face)?.label || face} 완료`)).catch(error => status(String((error as Error)?.message || error)));
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
