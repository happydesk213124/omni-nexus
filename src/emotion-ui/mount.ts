import type { TtsCharacter } from '../core/tts-types';
import { risuHost } from '../core/host';
import { BASE_EXPRESSIONS, baseExpression } from '../domain/emotion/emotions';
import { backgroundPlaces, collectFaces, currentEmotionBot, deleteBackground, forgetOrphans, orphanMade, findBackground, findSharedBackground, findSprite, makeBackground, makeSprite, PLACE_PERSON, redrawBackground, SHARED_BOT, sharedBackgroundPlaces, spriteCostumes, spriteJobKey, spriteJobs, spriteLooks, subscribeSprites, type EmotionBot } from '../services/emotion-assets';
import { PLACE_SAMPLES } from '../config/place-samples';
import { placeKey, samePlace } from '../domain/viewer/place';
import { ensurePlaceModule } from '../storage/place-module';
import { currentTtsContext } from '../services/tts-context';
import { emotionData, loadEmotionData, updateEmotionSettings, type EmotionSettings } from '../storage/emotion-store';
import { ttsData } from '../storage/tts-store';
import { loadViewerPrefs, saveViewerPrefs, viewerPrefs, type ViewerBgPick, type ViewerSpeed, type ViewerTextSize } from '../storage/viewer-prefs';
import { EMOTION_CSS, EMOTION_PANEL, EMOTION_SHEET, EMOTION_SHEET_SWITCH, EMOTION_TABS } from './markup';
import { attachSoundHelp } from '../sound-ui/help';
import { getConfig } from '../services/context';

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
  check('emo-enabled', s.enabled); check('emo-existing', s.useExisting); check('emo-auto', s.autoGenerate); check('emo-places', s.placeBackgrounds); check('emo-costumes', s.costumes);
  costumeGate();
  value('emo-family', s.family); value('emo-effort', s.effort); value('emo-transparent', s.transparent ? '1' : '0');
  value('emo-width', String(s.width)); value('emo-height', String(s.height));
  value('emo-prefix', s.prefix); value('emo-suffix', s.suffix); value('emo-pose', s.pose);
  for (const e of BASE_EXPRESSIONS) value(`emo-face-${e.key}`, s.faceTags[e.key] || '');
  gates(s);
  value('emo-words', Object.entries(s.words).map(([w, face]) => `${w}=${face}`).join('\n'));
}
/**
 * 코스튬별 에셋 waits on streaming tags with costumes: only then does the writer see the costume list it names
 * a costume from. Already on, it can still be switched off.
 */
function costumeGate(): void {
  const node = $<HTMLInputElement>('emo-costumes'), note = $('emo-costumes-status');
  let ready = false;
  try { const card = getConfig().card; ready = card?.stream_inline_tags === true && card.costume === true; } catch { /* no settings read yet */ }
  if (node) node.disabled = !ready && !node.checked;
  if (note) note.textContent = ready ? '' : '스트리밍 중 태그 생성과 코스튬을 켜면 쓸 수 있습니다.';
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
    costumes: !!$<HTMLInputElement>('emo-costumes')?.checked,
    family: val('emo-family') === 'v4' ? 'v4' : 'v5', effort: (['high', 'medium'].includes(val('emo-effort')) ? val('emo-effort') : 'follow') as EmotionSettings['effort'], transparent: val('emo-transparent') !== '0',
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
  const seen = emotionData().seen, count = $('emo-people-count');
  if (count) count.textContent = people.length ? `${people.length}명` : '';
  box.innerHTML = people.length ? people.map(c => `<div class="emo-person" role="listitem"><span><b>${esc(c.name)}</b> <small>본 감정 ${(seen[c.id] || []).length}개</small></span><button type="button" data-emo-open="${esc(c.id)}">감정 에셋</button></div>`).join('')
    : '<small>이 봇의 TTS 캐릭터가 없습니다. TTS 설정의 캐릭터 탭에서 먼저 등록하세요.</small>';
}

/**
 * 배경: this bot's backgrounds and every chat's (a tile each: its picture, 다시 그리기,
 * 삭제), and the sample places (a chip each, drawn for every chat). What was drawn is
 * marked on the lists themselves: a page opened again is new markup and is drawn again.
 */
const busyFor = (owner: string): Set<string> => { const prefix = spriteJobKey(owner, PLACE_PERSON, ''); return new Set([...spriteJobs()].filter(key => key.startsWith(prefix)).map(key => key.slice(prefix.length))); };
function tiles(places: string[], busy: Set<string>, shared: boolean, empty: string): string {
  const drawing = [...busy].filter(place => !places.some(known => samePlace(known, place)));
  return [...drawing.map(place => `<div class="emo-bg-tile" role="listitem"><div class="emo-bg-pic" data-busy="1">그리는 중…</div><small title="${esc(place)}">${esc(place)}</small></div>`),
    ...places.map((place, i) => { const doing = [...busy].some(known => samePlace(known, place)) ? ' disabled' : ''; return `<div class="emo-bg-tile" role="listitem"><div class="emo-bg-pic" data-bg-pic="${shared ? 's' : 'b'}${i}"${doing ? ' data-busy="1"' : ''}></div><small title="${esc(place)}">${esc(place)}</small><div class="emo-bg-tools"><button type="button" data-emo-bg-redraw="${esc(place)}" data-shared="${shared ? 1 : 0}"${doing}>다시 그리기</button><button type="button" class="danger" data-emo-bg-delete="${esc(place)}" data-shared="${shared ? 1 : 0}"${doing}>삭제</button></div></div>`; })].join('') || `<small>${empty}</small>`;
}
async function renderBackgrounds(): Promise<void> {
  const list = $('emo-bg-list'), shared = $('emo-bg-shared'), chips = $('emo-bg-samples');
  if (!list || !shared || !chips) return;
  const bot = await currentEmotionBot().catch(() => null);
  const own = bot ? await backgroundPlaces(bot) : [], common = await sharedBackgroundPlaces();
  const ownBusy = bot ? busyFor(bot.id) : new Set<string>(), commonBusy = busyFor(SHARED_BOT);
  const count = (id: string, n: number | null) => { const node = $(id); if (node) node.textContent = n === null ? '' : `${n}장`; };
  count('emo-bg-count', bot ? own.length : null); count('emo-bg-shared-count', common.length);
  const signature = JSON.stringify([bot?.id ?? '', own, common, [...ownBusy], [...commonBusy]]);
  if (list.dataset.shown === signature && chips.childElementCount) return;
  list.dataset.shown = signature;
  list.innerHTML = bot ? tiles(own, ownBusy, false, '아직 없습니다. 뷰어에 장소가 나오면 그려서 여기에 쌓입니다.') : '<small>채팅을 연 봇이 없습니다. 봇과의 채팅을 열면 그 봇의 배경이 보입니다.</small>';
  shared.innerHTML = tiles(common, commonBusy, true, '아직 없습니다. 샘플 장소를 누르거나 뷰어가 샘플 장소를 고르면 여기에 쌓입니다.');
  // The samples are tags, drawn for every chat (no bot needed).
  chips.innerHTML = PLACE_SAMPLES.map(sample => { const k = placeKey(sample), made = common.some(place => samePlace(place, k)) || [...commonBusy].some(place => samePlace(place, k)); return `<button type="button" data-emo-bg-make="${esc(k)}"${made ? ' data-made="1" disabled' : ''}>${esc(k)}</button>`; }).join('');
  // Pictures last, one by one: the lists are up at once.
  const paint = async (box: HTMLElement, mark: string, i: number, find: () => Promise<{ path: string } | null>) => {
    const found = await find().catch(() => null), url = found ? await thumb(found.path).catch(() => '') : '';
    const pic = box.querySelector<HTMLElement>(`[data-bg-pic="${mark}${i}"]`);
    if (pic && url) pic.style.backgroundImage = `url("${url}")`;
  };
  if (bot) for (const [i, place] of own.entries()) await paint(list, 'b', i, () => findBackground(place, bot));
  for (const [i, place] of common.entries()) await paint(shared, 's', i, () => findSharedBackground(place));
}

export async function mountEmotion(root: HTMLElement, live: () => boolean): Promise<void> {
  await Promise.all([loadEmotionData(), loadViewerPrefs()]); if (!live()) return;
  fillSettings(emotionData().settings);
  // 옴니 뷰어's own settings (its store, not 감정 에셋's): read on its next open.
  const skip = root.querySelector<HTMLTextAreaElement>('#emo-skip'), speed = root.querySelector<HTMLSelectElement>('#emo-speed'), size = root.querySelector<HTMLSelectElement>('#emo-size');
  if (skip) skip.value = viewerPrefs().skipWords;
  if (speed) speed.value = viewerPrefs().speed;
  if (size) size.value = viewerPrefs().textSize;
  // 캐릭터 움직임: read on the viewer's next open (its scene style carries them).
  const reach = root.querySelector<HTMLSelectElement>('#emo-reach');
  if (reach) reach.value = String(viewerPrefs().stageReach);
  reach?.addEventListener('change', event => { event.stopPropagation(); void saveViewerPrefs({ stageReach: Number(reach.value) }); });
  for (const [id, key] of [['emo-breathe', 'breathe'], ['emo-bounce', 'bounce']] as const) {
    const node = root.querySelector<HTMLInputElement>(`#${id}`);
    if (!node) continue;
    node.checked = viewerPrefs()[key];
    node.addEventListener('change', event => { event.stopPropagation(); void saveViewerPrefs({ [key]: node.checked }); });
  }
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
  // A sample pressed: drawn now for every chat. A tile's 다시 그리기 draws it again; 삭제 takes it away.
  root.querySelector('#emo-bg')?.addEventListener('click', event => {
    const button = (event.target as Element | null)?.closest?.<HTMLButtonElement>('[data-emo-bg-make],[data-emo-bg-redraw],[data-emo-bg-delete]');
    if (!button || button.disabled) return;
    const make = button.getAttribute('data-emo-bg-make'), redraw = button.getAttribute('data-emo-bg-redraw'), remove = button.getAttribute('data-emo-bg-delete');
    const shared = button.getAttribute('data-shared') === '1';
    if (remove && !confirm(`「${remove}」 배경을 지울까요? ${shared ? '모든 채팅에서 빠집니다.' : '이 봇의 에셋에서 빠집니다.'}`)) return;
    button.disabled = true;
    const work = async () => {
      const bot = await currentEmotionBot().catch(() => null);
      if (make) { const job = makeBackground(make, bot, true); void renderBackgrounds(); await job; }
      else if (redraw) { const job = redrawBackground(redraw, shared ? null : bot, shared); void renderBackgrounds(); await job; }
      else if (remove) await deleteBackground(remove, shared ? null : bot, shared);
    };
    void work().catch(error => { button.disabled = false; button.title = String((error as Error)?.message || error); alert(String((error as Error)?.message || error)); }).finally(() => void renderBackgrounds());
  });
  $('tab-emo-assets')?.addEventListener('click', () => void renderPeople());
  // 고아 메모 정리: what would go, told first; only on a yes.
  $('emo-tidy')?.addEventListener('click', () => void (async () => {
    const button = $('emo-tidy') as HTMLButtonElement | null, status = $('emo-tidy-status');
    if (!button || button.disabled) return;
    button.disabled = true;
    try {
      const found = await orphanMade();
      if (!found) { if (status) status.textContent = 'Risu 봇 목록을 읽지 못해 정리하지 않았습니다.'; return; }
      if (!found.records.length) { if (status) status.textContent = '정리할 메모가 없습니다.'; return; }
      const size = found.bytes < 1024 ? `${found.bytes}B` : `${(found.bytes / 1024).toFixed(1)}KB`;
      const who = [found.bots ? `지운 봇 ${found.bots}개` : '', found.people ? `지운 캐릭터 ${found.people}명` : ''].filter(Boolean).join(', ');
      if (!confirm(`${who}의 메모 ${found.records.length}개(약 ${size})를 지울까요? 그림 파일은 그대로 둡니다.`)) return;
      const gone = await forgetOrphans(found.records);
      if (status) status.textContent = `메모 ${gone}개를 정리했습니다.`;
    } catch (error) { if (status) status.textContent = String((error as Error)?.message || error); }
    finally { button.disabled = false; }
  })());
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
  // costume: the one the faces show and are made in (0 the default), picked on the bar over them.
  let person: TtsCharacter | null = null, bot: EmotionBot | null = null, epoch = 0, costume = 0;
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
    // 코스튬별 에셋: the illustration character's costumes, each its own faces. Off (or one costume), the default's.
    const costumes = emotionData().settings.costumes ? await spriteCostumes(person, bot).catch(() => []) : [];
    if (mine !== epoch) return;
    if (!costumes.some(c => c.index === costume)) costume = 0;
    const bar = $('emo-char-costumes'), worn = costume;
    if (bar) {
      bar.hidden = costumes.length < 2;
      bar.innerHTML = costumes.map(c => `<button type="button" role="tab" data-emo-costume="${c.index}" aria-selected="${c.index === worn}" title="${esc(c.note)}">${c.index ? `${c.index}번` : '기본'} · ${esc(c.name)}</button>`).join('');
    }
    const seen = new Set(emotionData().seen[person.id] || []);
    const faces = [...seen, ...BASE_EXPRESSIONS.map(e => e.key).filter(k => !seen.has(k))];
    const busy = spriteJobs();
    const tiles = await Promise.all(faces.map(async face => ({ face, sprite: await findSprite(person!, face, bot!, worn).catch(() => null), busy: busy.has(spriteJobKey(bot!.id, person!.id, face, worn)) })));
    if (mine !== epoch) return;
    grid.innerHTML = tiles.map(({ face, sprite, busy: running }) => `<div class="emo-tile" data-seen="${seen.has(face) ? 1 : 0}"><div class="emo-pic" data-face="${esc(face)}" data-busy="${running ? 1 : 0}">${running ? '만드는 중…' : sprite ? '' : '없음'}</div>
<b>${esc(baseExpression(face)?.label || face)}</b><small>${esc(face)}${sprite ? ` · ${sprite.source === 'bot' ? '봇 에셋' : '옴니'}` : ''}${seen.has(face) ? ' · 대사에 나옴' : ''}</small>
<button type="button" data-emo-make="${esc(face)}" ${running ? 'disabled' : ''}>${sprite ? '다시 만들기' : '만들기'}</button></div>`).join('');
    for (const { face, sprite } of tiles) if (sprite) void thumb(sprite.path).then(url => { const pic = grid.querySelector<HTMLElement>(`.emo-pic[data-face="${CSS.escape(face)}"]`); if (url && pic && mine === epoch) pic.style.backgroundImage = `url("${url}")`; }).catch(() => {});
    const looks = await spriteLooks(person, bot, worn).catch(() => '');
    const line = $('emo-char-looks');
    if (line && mine === epoch) line.textContent = looks ? `외형${worn ? ` (${worn}번 코스튬)` : ''}: ${looks}` : '외형 태그가 없습니다. 삽화 캐릭터 탭에서 이 사람의 외형을 채우면 만들 수 있습니다.';
  };
  const make = (faces: string[]) => {
    if (!person || !bot) return;
    const who = person, where = bot, worn = costume;
    for (const face of faces) void makeSprite(who, face, where, true, worn).then(() => status(`${baseExpression(face)?.label || face} 완료`)).catch(error => status(String((error as Error)?.message || error)));
    void render();
  };
  form.addEventListener('click', event => {
    const target = event.target as Element | null;
    // The form itself carries data-emo-view: only the switch's own buttons count here.
    const switchTo = target?.closest?.('[data-emo-tab]')?.getAttribute('data-emo-tab');
    if (switchTo === 'voice' || switchTo === 'faces') { event.preventDefault(); view(switchTo); return; }
    const pick = target?.closest?.('[data-emo-costume]')?.getAttribute('data-emo-costume');
    if (pick != null) { event.preventDefault(); costume = Number(pick) || 0; void render(); return; }
    const face = target?.closest?.('[data-emo-make]')?.getAttribute('data-emo-make');
    if (face) { event.preventDefault(); make([face]); }
  });
  const missing = async (faces: string[]) => {
    if (!person || !bot) return [];
    const found = await Promise.all(faces.map(face => findSprite(person!, face, bot!, costume).catch(() => null)));
    return faces.filter((_, i) => !found[i]);
  };
  $('emo-char-make-seen')?.addEventListener('click', () => void (async () => make(await missing(emotionData().seen[person?.id || ''] || [])))());
  $('emo-char-make-all')?.addEventListener('click', () => void (async () => make(await missing(BASE_EXPRESSIONS.map(e => e.key))))());
  const unsubscribe = subscribeSprites(() => { if (live()) void render(); else unsubscribe(); });
  document.addEventListener('omnitts-character-open', event => {
    const detail = (event as CustomEvent<{ id?: string; view?: string }>).detail || {};
    person = ttsData().characters.find(c => c.id === detail.id && !c.role) ?? null; costume = 0;
    const sw = form.querySelector<HTMLElement>('.emo-sheet-switch');
    if (sw) sw.hidden = !person;
    status('');
    view(person && detail.view === 'faces' ? 'faces' : 'voice');
  });
}
