import type { TtsCharacter } from '../core/tts-types';
import { dbg } from '../core/debug';
import { risuHost } from '../core/host';
import { bytesToBase64, sniffImageMime } from '../core/util/bytes';
import { DEFAULT_EXPRESSION } from '../domain/emotion/emotions';
import { compactHash, cueLineKey, parseTtsMessage } from '../domain/tts/segment';
import { resolveTtsSpeaker } from '../domain/tts/identity';
import { settledWhileStreaming } from '../domain/tts/streaming';
import { buildScenes, storyClock, type ViewerScene } from '../domain/viewer/scenes';
import { currentEmotionBot, findSprite, makeSprite, subscribeSprites, type EmotionBot } from '../services/emotion-assets';
import { currentTtsContext, type TtsChatContext } from '../services/tts-context';
import { omniTts, type TtsRequest } from '../services/tts-runtime';
import { emotionData, loadEmotionData } from '../storage/emotion-store';
import { psGet, psSet } from '../storage/device-store';
import { loadTtsData, ttsData } from '../storage/tts-store';

/**
 * 옴니 뷰어: the newest reply as a visual novel over the chat (Risu's own input stays
 * usable below). Built for a slow bridge: every SafeElement call is a round trip,
 * so the frame is made once and a scene change is one style text and one box:
 * images are never re-sent (chat images are cloned in place; a sprite's pixels go
 * over once and are only shown or hidden after), and taps are hit-tested against
 * rectangles measured once, so a tap costs no call at all.
 */
const VIEWER_KEY = 'omniviewer.data';
interface ViewerPrefs { auto: boolean; voice: boolean }
let prefs: ViewerPrefs = { auto: false, voice: true };

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const key = (s: string) => compactHash(s).slice(0, 10);
const LIST = '.default-chat-screen > .flex-col-reverse';

const STATIC_CSS = `
[x-omni-vn]{position:fixed;z-index:2147482000;isolation:isolate;overflow:hidden;background:#07090e;color:#f2f2f5;font:15px/1.6 system-ui,sans-serif;user-select:none;-webkit-user-select:none;touch-action:manipulation;border-radius:0}
[x-omni-vn] [data-vn-bg],[x-omni-vn] [data-vn-stage]{position:absolute;inset:0}
[x-omni-vn] [x-vn-bg]{display:none;position:absolute;inset:0;width:100%!important;height:100%!important;max-width:none!important;max-height:none!important;object-fit:cover;filter:brightness(.62) blur(1px);margin:0!important;border-radius:0!important}
[x-omni-vn] [x-vn-sp]{display:none;position:absolute;bottom:0;height:82%;max-width:70%;transition:opacity .25s,filter .25s,transform .25s}
[x-omni-vn] [x-vn-sp] img{height:100%;width:auto;display:block;object-fit:contain}
[x-omni-vn] [data-vn-top]{position:absolute;top:0;left:0;right:0;display:flex;gap:6px;align-items:center;padding:8px;background:linear-gradient(#000a,#0000);z-index:3}
[x-omni-vn] [data-vn-clock]{flex:1;min-width:0;font-size:12px;opacity:.85;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
[x-omni-vn] button{all:unset;cursor:pointer;min-width:40px;height:36px;padding:0 10px;border-radius:10px;background:#ffffff1c;border:1px solid #ffffff2a;text-align:center;font-size:13px;box-sizing:border-box}
[x-omni-vn] [data-vn-box]{position:absolute;left:10px;right:10px;bottom:54px;min-height:96px;max-height:42%;overflow:auto;padding:12px 14px 16px;border-radius:14px;background:#0d1018e6;border:1px solid #ffffff22;z-index:3;box-sizing:border-box}
[x-omni-vn] [data-vn-name]{display:inline-block;margin:-26px 0 6px;padding:2px 12px;border-radius:8px;background:#7132f5;font-weight:700;font-size:14px}
[x-omni-vn] [data-vn-name]:empty{display:none}
[x-omni-vn] [data-vn-text]{white-space:pre-wrap;word-break:break-word;animation:omnivn-in .35s ease}
[x-omni-vn] [data-vn-narr]{font-style:italic;opacity:.92}
[x-omni-vn] [data-vn-ctrl]{position:absolute;left:0;right:0;bottom:0;display:flex;gap:6px;justify-content:center;padding:8px;z-index:3}
[x-omni-vn] [data-vn-log]{display:none;position:absolute;inset:52px 10px 54px;overflow:auto;padding:12px;border-radius:14px;background:#0d1018f2;z-index:4;font-size:13px}
[x-omni-vn] [data-vn-log] p{margin:0 0 8px}
[x-omni-vn] [data-vn-hint]{position:absolute;right:12px;bottom:6px;font-size:11px;opacity:.6}
@keyframes omnivn-in{from{opacity:.2;transform:translateY(4px)}to{opacity:1;transform:none}}
`;
const FRAME = `<div data-vn-bg></div><div data-vn-stage></div>
<div data-vn-top><span data-vn-clock></span><button data-vn-act="log" type="button">로그</button><button data-vn-act="chat" type="button">채팅</button><button data-vn-act="close" type="button">✕</button></div>
<div data-vn-box></div><div data-vn-log></div>
<div data-vn-ctrl><button data-vn-act="prev" type="button">◀</button><button data-vn-act="auto" type="button">자동</button><button data-vn-act="voice" type="button">🔊</button><button data-vn-act="older" type="button">이전 답장</button><button data-vn-act="next" type="button">▶</button></div>`;

interface HostPoint { clientX: number; clientY: number }
let doc: SafeDocument | null = null, root: SafeElement | null = null, dyn: SafeElement | null = null, fold: SafeElement | null = null;
let bgShelf: SafeElement | null = null, stage: SafeElement | null = null, box: SafeElement | null = null, logBox: SafeElement | null = null;
let open = false, rect = { left: 0, top: 0, width: 0, height: 0 }, controls: Array<{ act: string; r: DOMRect }> = [];
let context: TtsChatContext | null = null, bot: EmotionBot | null = null, messageIndex = -1, source = '', scenes: ViewerScene[] = [], at = 0;
let streaming = false, logOpen = false, autoTimer: ReturnType<typeof setTimeout> | undefined, positionTimer: ReturnType<typeof setInterval> | undefined;
const sprites = new Map<string, string>(), backgrounds = new Map<string, string>();
let shownSprites: string[] = [], shownBg = '', cgMode = false, lastBg = '';
let epoch = 0, voiceKey = '', clickId = '';

async function release(value: unknown): Promise<void> { const r = value && typeof value === 'object' ? Reflect.get(value, 'release') : null; if (typeof r === 'function') await r.call(value).catch(() => {}); }

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

/** The newest reply (or `index`), read from the chat data, never from the screen. */
async function load(index?: number, keepPlace = false): Promise<void> {
  context = await currentTtsContext();
  bot = await currentEmotionBot().catch(() => null);
  const messages = context.messages;
  let i = index ?? messages.length - 1;
  while (i >= 0 && messages[i]?.role !== 'char') i--;
  messageIndex = i;
  setSource(i >= 0 ? String(messages[i]!.data ?? '') : '', keepPlace);
}
function setSource(text: string, keepPlace: boolean): void {
  source = text;
  const settled = streaming ? text.slice(0, Math.max(0, text.lastIndexOf('\n'))) : text;
  const segments = parseTtsMessage(settled);
  scenes = buildScenes(settled, streaming ? settledWhileStreaming(segments.map(segment => ({ segment })), settled + '\n').map(r => r.segment) : segments, emotionData().settings.words);
  if (!keepPlace) at = 0;
  at = Math.max(0, Math.min(at, scenes.length - 1));
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

function personOf(scene: ViewerScene): TtsCharacter | null {
  return scene.speaker && context ? resolveTtsSpeaker(scene.speaker, ttsData().characters, context.rosterScope) : null;
}
/** The sprite element for a person's face, sent once. '' when they have none (yet). */
async function spriteFor(person: TtsCharacter, face: string): Promise<string> {
  if (!bot || !emotionData().settings.enabled) return '';
  const sprite = await findSprite(person, face, bot) ?? (face !== DEFAULT_EXPRESSION ? await findSprite(person, DEFAULT_EXPRESSION, bot) : null);
  if (emotionData().settings.autoGenerate && (!sprite || sprite.face !== face)) void makeSprite(person, face, bot).catch(() => {});
  if (!sprite) return '';
  const id = key(sprite.path);
  if (sprites.has(sprite.path)) return id;
  const raw = await risuHost()?.readImage?.(sprite.path);
  const bytes = raw instanceof Uint8Array ? raw : raw instanceof ArrayBuffer ? new Uint8Array(raw) : null;
  if (!bytes?.byteLength || !doc || !stage) return '';
  const holder = await doc.createElement('div');
  await holder.setAttribute('x-vn-sp', id);
  await holder.setInnerHTML(`<img alt="" src="data:${sniffImageMime(bytes) || 'image/png'};base64,${bytesToBase64(bytes)}">`);
  await stage.appendChild(holder); await release(holder);
  sprites.set(sprite.path, id);
  return id;
}
/** A chat image as the background: the chat's own <img>, cloned (its pixels never cross the bridge). */
async function backgroundFor(scene: ViewerScene): Promise<string> {
  if (!scene.cg || !doc || !bgShelf) return '';
  const selector = scene.cg.kind === 'baked' ? `[data-inray-asset="${scene.cg.asset}"] img` : scene.cg.kind === 'slot' ? `[data-inx-slot="${scene.cg.n}"] img` : '';
  if (!selector) return '';
  const id = key(selector + (scene.cg.kind === 'slot' ? source.length : ''));
  if (backgrounds.has(id)) return id;
  const img = await doc.querySelector(`${LIST} ${selector}`);
  if (!img) return '';
  try {
    const copy = await img.cloneNode(true);
    await copy.setAttribute('x-vn-bg', id);
    await bgShelf.appendChild(copy); await release(copy);
  } finally { await release(img); }
  backgrounds.set(id, id);
  return id;
}

/** One scene: one style text (what shows) and the box. */
async function render(): Promise<void> {
  if (!open || !dyn || !box) return;
  const mine = ++epoch, scene = scenes[at];
  clearTimeout(autoTimer);
  if (!scene) {
    await box.setInnerHTML(`<div data-vn-name></div><div data-vn-text data-vn-narr>${streaming ? '…' : '이 답장에는 읽을 문장이 없습니다.'}</div>`);
    return;
  }
  if (scene.kind === 'cg') {
    const bg = await backgroundFor(scene);
    if (mine !== epoch) return;
    if (bg) { lastBg = bg; shownBg = bg; cgMode = true; }
    else { await go(1); return; }
  } else {
    cgMode = false;
    const person = personOf(scene);
    const sprite = person ? await spriteFor(person, scene.face || DEFAULT_EXPRESSION) : '';
    if (mine !== epoch) return;
    // The speaker stands in front; whoever spoke before stays, dimmed, beside them.
    if (scene.kind === 'line') shownSprites = sprite ? [sprite, ...shownSprites.filter(s => s !== sprite)].slice(0, 2) : shownSprites.slice(0, 1).map(s => s);
    shownBg = lastBg;
  }
  const [front, back] = shownSprites;
  const css = [
    shownBg ? `[x-omni-vn] [x-vn-bg="${shownBg}"]{display:block${cgMode ? ';object-fit:contain;filter:none;background:#000' : ''}}` : '',
    !cgMode && front ? `[x-omni-vn] [x-vn-sp="${front}"]{display:block;left:${back ? '58%' : '50%'};transform:translateX(-50%)${scene.kind === 'narration' ? ';filter:brightness(.55)' : ''}}` : '',
    !cgMode && back ? `[x-omni-vn] [x-vn-sp="${back}"]{display:block;left:26%;transform:translateX(-50%) scale(.94);filter:brightness(.5)}` : '',
    cgMode ? '[x-omni-vn] [data-vn-box]{opacity:.0;pointer-events:none}' : '',
    logOpen ? '[x-omni-vn] [data-vn-log]{display:block}' : '',
    `[x-omni-vn] [data-vn-act="auto"]{background:${prefs.auto ? '#7132f5' : '#ffffff1c'}}[x-omni-vn] [data-vn-act="voice"]{opacity:${prefs.voice ? 1 : .45}}`,
  ].join('\n');
  await dyn.setTextContent(css);
  const name = scene.kind === 'line' ? esc(scene.speaker) : '';
  await box.setInnerHTML(`<div data-vn-name>${name}</div><div data-vn-text${scene.kind === 'narration' ? ' data-vn-narr' : ''}>${esc(scene.text)}</div><div data-vn-hint>${at + 1}/${scenes.length}${streaming ? ' · 받는 중' : ''}</div>`);
  if (scene.kind !== 'cg') voice(scene);
  if (prefs.auto) autoTimer = setTimeout(() => void autoNext(mine), scene.kind === 'cg' ? 2500 : 1200 + scene.text.length * 55);
}
/** 자동: wait for the voice to end (when it speaks), then move on. */
async function autoNext(mine: number): Promise<void> {
  if (mine !== epoch || !prefs.auto) return;
  if (['playing', 'loading'].includes(String(omniTts.player.status)) && omniTts.player.key?.includes?.(voiceKey.split(':').pop() || '\u0000')) { autoTimer = setTimeout(() => void autoNext(mine), 500); return; }
  await go(1);
}
async function go(delta: number): Promise<void> {
  const next = at + delta;
  if (next < 0 || next >= scenes.length) { if (delta > 0 && !streaming) await render(); return; }
  at = next; await render();
}

async function act(name: string): Promise<void> {
  if (name === 'close' || name === 'chat') { await closeViewer(); return; }
  if (name === 'next') await go(1);
  else if (name === 'prev') await go(-1);
  else if (name === 'auto') { prefs.auto = !prefs.auto; savePrefs(); await render(); }
  else if (name === 'voice') { prefs.voice = !prefs.voice; savePrefs(); if (!prefs.voice) omniTts.stop(); await render(); }
  else if (name === 'older') { await load(Math.max(0, messageIndex - 1)); await render(); }
  else if (name === 'log') {
    logOpen = !logOpen;
    if (logOpen && logBox) await logBox.setInnerHTML(scenes.filter(s => s.kind !== 'cg').map((s, i) => `<p${i === at ? ' style="color:#c4b5fd"' : ''}>${s.kind === 'line' ? `<b>${esc(s.speaker)}</b> ` : ''}${esc(s.text)}</p>`).join('') || '<p>없음</p>');
    await render();
  }
}
const inside = (p: HostPoint, r: { left: number; top: number; width: number; height: number }) => p.clientX >= r.left && p.clientX <= r.left + r.width && p.clientY >= r.top && p.clientY <= r.top + r.height;
function onClick(p: HostPoint): void {
  if (!open || !Number.isFinite(p?.clientX) || !inside(p, rect)) return;
  const hit = controls.find(c => inside(p, c.r));
  void (hit ? act(hit.act) : logOpen ? act('log') : go(1)).catch(error => dbg('viewer.tap', { message: String(error) }, 'warn'));
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
  if (box) { await box.setInnerHTML(`<div data-vn-name>옴니 뷰어</div><div data-vn-text>열지 못했습니다: ${esc(message)}</div>`).catch(() => {}); return; }
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
    await Promise.all([loadPrefs(), loadEmotionData(), loadTtsData()]);
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
    [bgShelf, stage, box, logBox] = await Promise.all(['[data-vn-bg]', '[data-vn-stage]', '[data-vn-box]', '[data-vn-log]'].map(s => root!.querySelector(s)));
    open = true; rect = { left: 0, top: 0, width: 0, height: 0 }; sprites.clear(); backgrounds.clear(); shownSprites = []; shownBg = ''; lastBg = ''; logOpen = false;
    // Taps first: ✕ has to work even when the reply cannot be read. Only while open: closed, it costs Risu nothing.
    clickId = await doc.addEventListener('click', (e: HostPoint) => onClick(e));
    await measure().catch(error => dbg('viewer.measure', { message: String(error) }, 'warn'));
    clearInterval(positionTimer);
    positionTimer = setInterval(() => { if (open) void measure().catch(() => {}); }, 2000);
    streaming = Reflect.get(globalThis, '__OMNI_REPLY_STREAMING__')?.() === true;
    await load();
    const clock = storyClock(source) || (context ? context.messages.slice(0, messageIndex).reverse().map(m => storyClock(String(m.data ?? ''))).find(Boolean) || '' : '');
    const clockNode = await root.querySelector('[data-vn-clock]'); if (clockNode) { await clockNode.setTextContent(clock); await release(clockNode); }
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
  if (doc && clickId) { await doc.removeEventListener('click', clickId).catch(() => {}); clickId = ''; }
  for (const node of [root, dyn, fold]) if (node) { await node.remove().catch(() => {}); await release(node); }
  if (doc) for (const old of await unwrap(await doc.querySelectorAll('[x-omni-vn-style]'))) { await old.remove(); await release(old); }
  root = dyn = fold = bgShelf = stage = box = logBox = null;
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
