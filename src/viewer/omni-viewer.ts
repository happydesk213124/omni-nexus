import type { TtsCharacter } from '../core/tts-types';
import { dbg } from '../core/debug';
import { risuHost } from '../core/host';
import { bytesToBase64, sniffImageMime } from '../core/util/bytes';
import { DEFAULT_EXPRESSION } from '../domain/emotion/emotions';
import { compactHash, cueLineKey, isSoundSegment, parseTtsMessage } from '../domain/tts/segment';
import { ttsComparable } from '../domain/tts/anchors';
import { ttsExcludeTerms } from '../domain/tts/filter';
import type { TtsSegment } from '../core/tts-types';
import { omniSound } from '../services/sound-runtime';
import { soundData, soundReady } from '../storage/sound-store';
import { resolveTtsSpeaker } from '../domain/tts/identity';
import { settledWhileStreaming } from '../domain/tts/streaming';
import { buildScenes, storyClock, type ViewerScene } from '../domain/viewer/scenes';
import { currentEmotionBot, findSprite, makeSprite, subscribeSprites, type EmotionBot } from '../services/emotion-assets';
import { currentTtsContext, type TtsChatContext } from '../services/tts-context';
import { omniTts, type TtsRequest } from '../services/tts-runtime';
import { emotionData, loadEmotionData } from '../storage/emotion-store';
import { psGet, psSet } from '../storage/device-store';
import { loadTtsData, ttsData } from '../storage/tts-store';
import { boxHtml, FRAME, personHtml, STATIC_CSS, stageCss, type StageState } from './look';

/**
 * 옴니 뷰어: the newest reply as a visual novel over the chat (Risu's own input stays
 * usable below). Everyone the reply has brought on stands there; whoever speaks
 * steps forward, lit, the rest wait dimmed. Built for a slow bridge: every
 * SafeElement call is a round trip, so the frame is made once and a scene is one
 * style text and one box. Pixels never go over twice: a chat image is cloned in
 * place, a sprite is sent once and then only shown or hidden, and taps are
 * hit-tested against rectangles measured once, so a tap itself costs nothing.
 */
const VIEWER_KEY = 'omniviewer.data';
interface ViewerPrefs { auto: boolean; voice: boolean }
let prefs: ViewerPrefs = { auto: false, voice: true };

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const key = (s: string) => compactHash(s).slice(0, 10);
const LIST = '.default-chat-screen > .flex-col-reverse';
// More than three on a phone's stage hide each other; the three last to speak stay.
const MAX_CAST = 3;

interface HostPoint { clientX: number; clientY: number }
let doc: SafeDocument | null = null, root: SafeElement | null = null, dyn: SafeElement | null = null, fold: SafeElement | null = null;
let bgLayer: SafeElement | null = null, castLayer: SafeElement | null = null, cgLayer: SafeElement | null = null, box: SafeElement | null = null, logBox: SafeElement | null = null;
let open = false, rect = { left: 0, top: 0, width: 0, height: 0 }, controls: Array<{ act: string; r: DOMRect }> = [];
let context: TtsChatContext | null = null, bot: EmotionBot | null = null, messageIndex = -1, source = '', scenes: ViewerScene[] = [], at = 0;
let streaming = false, logOpen = false, autoTimer: ReturnType<typeof setTimeout> | undefined, positionTimer: ReturnType<typeof setInterval> | undefined;
/** Person key → their place on stage; `${person}|${path}` → the face sent into it; image id → cloned. */
const people = new Map<string, SafeElement>(), faces = new Map<string, string>(), clones = new Set<string>();
let bg = '', revealUntil = 0, revealed = false, epoch = 0, voiceKey = '', clickId = '';

// Risu's SafeElement methods may answer synchronously (release() returns nothing there):
// never chain on their result, wrap it.
const quiet = (value: unknown): Promise<unknown> => Promise.resolve(value).catch(() => undefined);
async function release(value: unknown): Promise<void> { const r = value && typeof value === 'object' ? Reflect.get(value, 'release') : null; if (typeof r === 'function') await quiet((() => { try { return r.call(value); } catch { return undefined; } })()); }

async function measure(): Promise<void> {
  if (!doc || !root) return;
  const screen = await doc.querySelector('.default-chat-screen');
  let next = rect;
  try {
    if (screen) {
      const s = await screen.getBoundingClientRect();
      let below = 0;
      const others = await screen.querySelectorAll(':scope > :not(.absolute):not(.fixed):has(~ .flex-col-reverse)');
      for (const node of await unwrap(others)) { const r = await node.getBoundingClientRect(); below += r.height; await release(node); }
      next = { left: Math.round(s.left), top: Math.round(s.top), width: Math.round(s.width), height: Math.max(160, Math.round(s.height - below)) };
    }
  } finally { await release(screen); }
  if (screen && next.width > 0) {
    if (JSON.stringify(next) !== JSON.stringify(rect)) await root.setStyleAttribute(`left:${next.left}px;top:${next.top}px;width:${next.width}px;height:${next.height}px`);
  } else {
    // No chat screen to cover (another layout): the frame keeps its fallback size; read where that is.
    const r = await root.getBoundingClientRect();
    next = { left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
  }
  if (JSON.stringify(next) === JSON.stringify(rect) && controls.length) return;
  rect = next;
  controls = [];
  for (const node of await unwrap(await root.querySelectorAll('[data-vn-act]'))) {
    const html = await node.getOuterHTML(), act = /data-vn-act="([a-z]+)"/.exec(html)?.[1] || '';
    if (act) controls.push({ act, r: await node.getBoundingClientRect() });
    await release(node);
  }
}
async function unwrap<T>(list: SafeClassArray<T> | T[]): Promise<T[]> {
  if (Array.isArray(list)) return list;
  const n = await list.length(), out: T[] = [];
  for (let i = 0; i < n; i++) { const item = await list.at(i); if (item) out.push(item); }
  return out;
}

async function loadPrefs(): Promise<void> {
  const raw = await psGet(VIEWER_KEY).catch(() => null) as Partial<ViewerPrefs> | null;
  prefs = { auto: raw?.auto === true, voice: raw?.voice !== false };
}
const savePrefs = () => void psSet(VIEWER_KEY, prefs).catch(() => {});

/**
 * The newest reply (or the one at/before `index`), from the chat data. Which of its
 * lines are scenes is what the chat shows of it: a status panel or summary the
 * bot's regex hides is in the source but never on screen, so it is no scene either.
 */
async function load(index?: number, keepPlace = false): Promise<void> {
  context = await currentTtsContext();
  bot = await currentEmotionBot().catch(() => null);
  const messages = context.messages;
  let i = index ?? messages.length - 1;
  while (i >= 0 && messages[i]?.role !== 'char') i--;
  messageIndex = i;
  const shown = i >= 0 && !streaming ? await renderedText(i) : '';
  setSource(i >= 0 ? String(messages[i]!.data ?? '') : '', keepPlace, shown);
}
/** The reply as the chat draws it (innerText: what CSS hides is left out). '' when it is not on screen. */
async function renderedText(index: number): Promise<string> {
  if (!doc) return '';
  const node = await doc.querySelector(`.risu-chat[data-chat-index="${index}"] .chattext`);
  if (!node) return '';
  try { return String(await node.innerText() ?? ''); } catch { return ''; } finally { await release(node); }
}
/** BGM tags and effect words in the reply, played where the reading reaches them. */
let cues: TtsSegment[] = [];
const fired = new Set<string>();
function soundCues() {
  if (!soundReady()) return undefined;
  const s = soundData().settings;
  return s.bgmEnabled || s.sfxEnabled ? { bgm: s.bgmEnabled, sfxRules: s.sfxEnabled ? s.sfxRules : [] } : undefined;
}
function setSource(text: string, keepPlace: boolean, shown = ''): void {
  source = text;
  const settled = streaming ? text.slice(0, Math.max(0, text.lastIndexOf('\n'))) : text;
  // The voice's own filters (excluded text, short or symbol-only lines) apply to scenes too.
  const t = ttsData().settings;
  let segments = parseTtsMessage(settled, ttsExcludeTerms(t.excludeText), t.skipChars, t.skipSymbolOnly, soundCues());
  if (streaming) segments = settledWhileStreaming(segments.map(segment => ({ segment })), settled + '\n').map(r => r.segment);
  const visible = ttsComparable(shown);
  if (visible) {
    const kept = segments.filter(s => isSoundSegment(s) || !ttsComparable(s.text) || visible.includes(ttsComparable(s.text)));
    // Drawn text that matches none of the reply is another row (or a bot that redraws everything): keep the reply whole.
    if (kept.some(s => !isSoundSegment(s))) segments = kept;
  }
  cues = segments.filter(isSoundSegment);
  scenes = buildScenes(settled, segments, emotionData().settings.words);
  if (!keepPlace) { at = 0; bg = ''; fired.clear(); }
  at = Math.max(0, Math.min(at, scenes.length - 1));
}
/** Cues up to this scene that have not played: the music changes and effects sound where they are written. */
function playCues(scene: ViewerScene): void {
  for (const cue of cues) {
    if (cue.start > scene.end || fired.has(cue.id)) continue;
    fired.add(cue.id);
    const tags = (cue as TtsSegment & { tags?: string[] }).tags;
    if (cue.kind === 'bgm' && tags?.length) void omniSound.playBgmForTags(tags).catch(error => dbg('viewer.bgm', { message: String(error) }, 'warn'));
    // Only an effect at this scene sounds: ones passed over by a jump are not replayed.
    else if (cue.kind === 'sfx' && cue.start >= scene.start - 400) void omniSound.playSfxWord(cue.text, scene.text).catch(() => {});
  }
}
const charIndexes = (): number[] => (context?.messages ?? []).flatMap((m, i) => m?.role === 'char' ? [i] : []);
/** The reply before or after this one; false when there is none that way. */
async function stepReply(dir: 1 | -1): Promise<boolean> {
  const list = charIndexes(), next = list[list.indexOf(messageIndex) + dir];
  if (next === undefined) return false;
  await load(next);
  if (dir < 0) at = Math.max(0, scenes.length - 1);
  return true;
}

function messageId(): string {
  const message = context?.messages[messageIndex];
  return String(message?.chatId || message?.id || `${messageIndex}:${compactHash(source)}`);
}
function voice(scene: ViewerScene): void {
  if (!prefs.voice || !context || !scene.segmentId || !ttsData().settings.enabled) return;
  const segment = parseTtsMessage(source).find(s => s.id === scene.segmentId);
  if (!segment) return;
  const request: TtsRequest = { context, messageId: messageId(), sourceKey: cueLineKey(source.slice(segment.start, segment.end)), segment };
  voiceKey = `${messageId()}:${segment.id}`;
  void omniTts.play([request], 0).catch(error => dbg('viewer.voice', { message: String(error) }, 'warn'));
}

interface Member { key: string; name: string; person: TtsCharacter | null; face: string; speaking: boolean }
/**
 * Who stands on stage at scene `index`: everyone who has spoken so far (the
 * last three), left to right in the order they came in, each with the face of
 * their latest line. A speaker without a TTS card still stands, as a silhouette.
 */
function castAt(index: number): Member[] {
  const seen = new Map<string, Member>(), order: string[] = [];
  let speaker = '';
  for (let i = 0; i <= index && i < scenes.length; i++) {
    const scene = scenes[i]!;
    if (scene.kind !== 'line' || !scene.speaker) continue;
    const person = context ? resolveTtsSpeaker(scene.speaker, ttsData().characters, context.rosterScope) : null;
    const id = person ? `t${key(person.id)}` : `n${key(scene.speaker)}`;
    const before = seen.get(id);
    seen.set(id, { key: id, name: person?.name || scene.speaker, person, face: scene.face || before?.face || DEFAULT_EXPRESSION, speaking: false });
    const pos = order.indexOf(id);
    if (pos >= 0) order.splice(pos, 1);
    order.push(id);
    if (i === index) speaker = id;
  }
  const recent = new Set(order.slice(-MAX_CAST));
  // Map keeps first-entrance order: people keep their spots as others come and go.
  return [...seen.values()].filter(m => recent.has(m.key)).map(m => ({ ...m, speaking: m.key === speaker }));
}
function resolveName(speaker: string): string {
  const person = context ? resolveTtsSpeaker(speaker, ttsData().characters, context.rosterScope) : null;
  return person?.name || speaker;
}

/** A person's place on stage, made once. */
async function placeFor(m: Member): Promise<SafeElement | null> {
  const known = people.get(m.key);
  if (known || !doc || !castLayer) return known ?? null;
  const el = await doc.createElement('div');
  await el.setAttribute('x-vn-p', m.key);
  await el.setInnerHTML(personHtml(m.name));
  await castLayer.appendChild(el);
  people.set(m.key, el);
  return el;
}
/** The picture for a member's face, sent into their place once. '' while they have none (it may be in the making). */
async function faceFor(m: Member, place: SafeElement): Promise<string> {
  if (!m.person || !bot || !emotionData().settings.enabled) return '';
  const sprite = await findSprite(m.person, m.face, bot) ?? (m.face !== DEFAULT_EXPRESSION ? await findSprite(m.person, DEFAULT_EXPRESSION, bot) : null);
  if (emotionData().settings.autoGenerate && sprite?.face !== m.face) void makeSprite(m.person, m.face, bot).catch(() => {});
  if (!sprite) return '';
  const id = key(sprite.path), slot = `${m.key}|${sprite.path}`;
  if (faces.has(slot)) return id;
  const raw = await risuHost()?.readImage?.(sprite.path);
  const bytes = raw instanceof Uint8Array ? raw : raw instanceof ArrayBuffer ? new Uint8Array(raw) : null;
  if (!bytes?.byteLength || !doc) return '';
  const holder = await doc.createElement('div');
  await holder.setAttribute('x-vn-sp', id);
  await holder.setInnerHTML(`<img alt="" src="data:${sniffImageMime(bytes) || 'image/png'};base64,${bytesToBase64(bytes)}">`);
  await place.appendChild(holder); await release(holder);
  faces.set(slot, id);
  return id;
}
/** A chat image, cloned into a layer (its pixels never cross the bridge). '' when the chat does not show it. */
async function cloneImage(scene: ViewerScene, layer: SafeElement | null, attr: 'x-vn-bg' | 'x-vn-cg'): Promise<string> {
  if (!scene.cg || !doc || !layer) return '';
  const selector = scene.cg.kind === 'baked' ? `[data-inray-asset="${scene.cg.asset}"] img` : scene.cg.kind === 'slot' ? `[data-inx-slot="${scene.cg.n}"] img` : '';
  if (!selector) return '';
  const id = key(selector + (scene.cg.kind === 'slot' ? source.length : ''));
  if (clones.has(`${attr}:${id}`)) return id;
  const img = await doc.querySelector(`${LIST} ${selector}`);
  if (!img) return '';
  try {
    const copy = await img.cloneNode(true);
    await copy.setAttribute(attr, id);
    await layer.appendChild(copy); await release(copy);
  } finally { await release(img); }
  clones.add(`${attr}:${id}`);
  return id;
}

const state = (cast: Array<{ key: string; face: string; speaking: boolean }>, extra: Partial<StageState> = {}): StageState =>
  ({ cast, narration: false, bg, cg: '', revealed, log: logOpen, auto: prefs.auto, voice: prefs.voice, ...extra });
let lastCast: Array<{ key: string; face: string; speaking: boolean }> = [];

/** One scene: who stands where (one style text) and the box. */
async function render(): Promise<void> {
  if (!open || !dyn || !box) return;
  const mine = ++epoch, scene = scenes[at];
  clearTimeout(autoTimer);
  if (!scene) {
    await box.setInnerHTML(boxHtml({ speaker: '', text: streaming ? '…' : '이 답장에는 읽을 문장이 없습니다.', narration: true }).html);
    return;
  }
  playCues(scene);
  if (scene.kind === 'cg') {
    // A CG comes in like a photo over the dimmed stage, then stays as the background.
    const [cg, behind] = [await cloneImage(scene, cgLayer, 'x-vn-cg'), await cloneImage(scene, bgLayer, 'x-vn-bg')];
    if (mine !== epoch) return;
    if (!cg) { await go(1); return; }
    await dyn.setTextContent(stageCss(state(lastCast, { cg })));
    bg = behind || bg;
    if (prefs.auto) autoTimer = setTimeout(() => void autoNext(mine), 2600);
    return;
  }
  const members = castAt(at), cast: Array<{ key: string; face: string; speaking: boolean }> = [];
  for (const m of members) {
    const place = await placeFor(m);
    cast.push({ key: m.key, face: place ? await faceFor(m, place) : '', speaking: m.speaking });
  }
  if (mine !== epoch) return;
  lastCast = cast; revealed = false;
  await dyn.setTextContent(stageCss(state(cast, { narration: scene.kind === 'narration' })));
  const { html, revealMs } = boxHtml({ speaker: scene.kind === 'line' ? resolveName(scene.speaker) : '', text: scene.text, narration: scene.kind !== 'line' });
  revealUntil = Date.now() + revealMs;
  await box.setInnerHTML(`${html}<div data-vn-count>${at + 1} / ${scenes.length}${streaming ? ' · 받는 중' : ''}</div>`);
  voice(scene);
  if (prefs.auto) autoTimer = setTimeout(() => void autoNext(mine), revealMs + 900 + scene.text.length * 30);
}
/** A tap while the letters still come in shows them all; the next tap moves on. */
async function reveal(): Promise<void> {
  if (!dyn) return;
  revealed = true; revealUntil = 0;
  await dyn.setTextContent(stageCss(state(lastCast, { narration: scenes[at]?.kind === 'narration' })));
}
/** 자동: wait for the voice to end (when it speaks), then move on. */
async function autoNext(mine: number): Promise<void> {
  if (mine !== epoch || !prefs.auto) return;
  if (['playing', 'loading'].includes(String(omniTts.player.status)) && voiceKey) { autoTimer = setTimeout(() => void autoNext(mine), 500); return; }
  await go(1);
}
/** Past either end of a reply the next or previous reply goes on; the newest reply's end stays. */
async function go(delta: number): Promise<void> {
  const next = at + delta;
  if (next >= 0 && next < scenes.length) { at = next; await render(); return; }
  if (streaming) return;
  if (await stepReply(delta > 0 ? 1 : -1)) await render();
}

async function act(name: string): Promise<void> {
  if (name === 'close' || name === 'chat') { await closeViewer(); return; }
  if (name === 'next') await go(1);
  else if (name === 'prev') await go(-1);
  else if (name === 'auto') { prefs.auto = !prefs.auto; savePrefs(); await render(); }
  else if (name === 'voice') { prefs.voice = !prefs.voice; savePrefs(); if (!prefs.voice) omniTts.stop(); await render(); }
  else if (name === 'older') { if (await stepReply(-1)) await render(); }
  else if (name === 'newest') { await load(); await render(); }
  else if (name === 'log') {
    logOpen = !logOpen;
    if (logOpen && logBox) await logBox.setInnerHTML(scenes.map((s, i) => s.kind === 'cg' ? '' : `<p${i === at ? ' data-now' : ''}>${s.kind === 'line' ? `<b>${esc(resolveName(s.speaker))}</b>` : ''}${esc(s.text)}</p>`).join('') || '<p>기록이 없습니다.</p>');
    await dyn?.setTextContent(stageCss(state(lastCast, { narration: scenes[at]?.kind === 'narration' })));
  }
}
const inside = (p: HostPoint, r: { left: number; top: number; width: number; height: number }) => p.clientX >= r.left && p.clientX <= r.left + r.width && p.clientY >= r.top && p.clientY <= r.top + r.height;
function onClick(p: HostPoint): void {
  if (!open || !Number.isFinite(p?.clientX) || !inside(p, rect)) return;
  const hit = controls.find(c => inside(p, c.r));
  const next = hit ? act(hit.act) : logOpen ? act('log') : Date.now() < revealUntil && !revealed ? reveal() : go(1);
  void next.catch(error => dbg('viewer.tap', { message: String(error) }, 'warn'));
}

/** The streaming reply: a scene appears once its line has ended (the TTS rule). */
let tickTimer: ReturnType<typeof setTimeout> | undefined, lastTick = 0, pendingText = '';
function onStreamTick(text: string): void {
  if (!open) return;
  pendingText = text; lastTick = Date.now();
  if (tickTimer) return;
  tickTimer = setTimeout(() => {
    tickTimer = undefined;
    const waiting = at >= scenes.length - 1;
    if (!streaming) { streaming = true; messageIndex = -1; }
    setSource(pendingText, true);
    if (waiting && at < scenes.length - 1) at++;
    void render();
    // No chunk for a while: the reply ended. Read the saved one (its images baked by then or soon).
    setTimeout(() => { if (open && streaming && Date.now() - lastTick >= 4000) { streaming = false; void load(undefined, true).then(render); } }, 4200);
  }, 400);
}

// Until the chat screen is measured: the whole page above Risu's input bar.
const FALLBACK_RECT = 'left:0;top:0;width:100vw;height:calc(100dvh - 96px)';
let opening = false;
/** A failure the user can see: in the frame when there is one, else Risu's own alert. */
async function showError(error: unknown): Promise<void> {
  const message = String((error as Error)?.message || error).slice(0, 300);
  dbg('viewer.open', { message }, 'warn');
  if (box) { await quiet(box.setInnerHTML(boxHtml({ speaker: '옴니 뷰어', text: `열지 못했습니다: ${message}`, narration: false }).html)); return; }
  const alert = Reflect.get(risuHost() ?? {}, 'alertError');
  if (typeof alert === 'function') await Promise.resolve(alert.call(risuHost(), `[옴니 뷰어] ${message}`)).catch(() => {});
}
export async function openViewer(): Promise<void> {
  const host = risuHost();
  if (open || opening || !host?.getRootDocument) return;
  opening = true;
  try {
    doc = await host.getRootDocument();
    if (!doc) throw new Error('Risu 화면에 접근할 수 없습니다. 플러그인 권한을 허용해 주세요.');
    await Promise.all([loadPrefs(), loadEmotionData(), loadTtsData(), omniSound.init().catch(() => {})]);
    const body = await doc.querySelector('body');
    if (!body) throw new Error('Risu 화면을 찾지 못했습니다.');
    for (const old of await unwrap(await doc.querySelectorAll('[x-omni-vn],[x-omni-vn-style]'))) { await old.remove(); await release(old); }
    root = await doc.createElement('div'); await root.setAttribute('x-omni-vn', '1'); await root.setInnerHTML(FRAME);
    await root.setStyleAttribute(FALLBACK_RECT);
    const css = await doc.createElement('style'); await css.setAttribute('x-omni-vn-style', 'static'); await css.setTextContent(STATIC_CSS);
    fold = await doc.createElement('style'); await fold.setAttribute('x-omni-vn-style', 'fold');
    // Behind the viewer only the newest messages stay laid out: Risu's re-render costs less.
    await fold.setTextContent(`${LIST} > .chat-message-container:nth-child(n+3){display:none!important}`);
    dyn = await doc.createElement('style'); await dyn.setAttribute('x-omni-vn-style', 'scene');
    for (const node of [css, fold, dyn, root]) await body.appendChild(node);
    await release(css); await release(body);
    [bgLayer, castLayer, cgLayer, box, logBox] = await Promise.all(['[data-vn-bg]', '[data-vn-cast]', '[data-vn-cg]', '[data-vn-box]', '[data-vn-log]'].map(s => root!.querySelector(s)));
    open = true; rect = { left: 0, top: 0, width: 0, height: 0 }; people.clear(); faces.clear(); clones.clear(); bg = ''; lastCast = []; logOpen = false; revealed = false;
    // Taps first: ✕ has to work even when the reply cannot be read. Only while open: closed, it costs Risu nothing.
    clickId = await doc.addEventListener('click', (e: HostPoint) => onClick(e));
    await measure().catch(error => dbg('viewer.measure', { message: String(error) }, 'warn'));
    clearInterval(positionTimer);
    positionTimer = setInterval(() => { if (open) void measure().catch(() => {}); }, 2000);
    streaming = Reflect.get(globalThis, '__OMNI_REPLY_STREAMING__')?.() === true;
    await load();
    const clock = storyClock(source) || (context ? context.messages.slice(0, messageIndex).reverse().map(m => storyClock(String(m.data ?? ''))).find(Boolean) || '' : '');
    const clockNode = await root.querySelector('[data-vn-clock]'); if (clockNode) { await clockNode.setInnerHTML(clock ? `<span>${esc(clock)}</span>` : ''); await release(clockNode); }
    await render();
  } catch (error) {
    await showError(error);
  } finally {
    opening = false;
  }
}
export async function closeViewer(): Promise<void> {
  if (!open) return;
  open = false; epoch++; clearTimeout(autoTimer); clearInterval(positionTimer);
  if (doc && clickId) { await quiet(doc.removeEventListener('click', clickId)); clickId = ''; }
  for (const node of [root, dyn, fold]) if (node) { await quiet(node.remove()); await release(node); }
  if (doc) for (const old of await unwrap(await doc.querySelectorAll('[x-omni-vn-style]'))) { await old.remove(); await release(old); }
  for (const place of people.values()) await release(place);
  people.clear();
  root = dyn = fold = bgLayer = castLayer = cgLayer = box = logBox = null;
}
export const viewerOpen = (): boolean => open;

let installed = false;
export async function installOmniViewer(): Promise<void> {
  const host = risuHost();
  if (installed || !host?.registerButton || !host.getRootDocument) return;
  installed = true;
  const toggle = () => void (open ? closeViewer() : openViewer()).catch(error => dbg('viewer.toggle', { message: String(error) }, 'warn'));
  const icon = '<span style="font-size:16px">🎬</span>';
  await host.registerButton({ name: '옴니 뷰어', icon, iconType: 'html', location: 'chat', id: 'omni-viewer-chat' }, toggle);
  await host.registerButton({ name: '옴니 뷰어', icon, iconType: 'html', location: 'hamburger', id: 'omni-viewer-menu' }, toggle);
  Reflect.set(globalThis, '__OMNI_STREAM_TICK__', onStreamTick);
  // A sprite finished: the scene on screen may be waiting for it.
  subscribeSprites(() => { if (open) void render(); });
}
