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
import { buildScenes, replyGist, replyImages, storyClock, type ViewerScene } from '../domain/viewer/scenes';
import { currentEmotionBot, findBackground, findSprite, makeAhead, makeBackground, makeSprite, subscribeSprites, type EmotionBot } from '../services/emotion-assets';
import { chatNoteSessionId, getSessionAuthorNote } from '../services/session-author-note';
import { replyPlace } from '../storage/viewer-places';
import { currentTtsContext, type TtsChatContext } from '../services/tts-context';
import { omniTts, type TtsRequest } from '../services/tts-runtime';
import { emotionData, loadEmotionData } from '../storage/emotion-store';
import { psGet, psSet } from '../storage/device-store';
import { loadTtsData, ttsData, updateTtsSettings } from '../storage/tts-store';
import { boxHtml, FRAME, personHtml, STATIC_CSS, stageCss, type StageState } from './look';
import { centerIn, quiet, release, rowAt, unwrap } from './safe-dom';

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
// The frame's buttons in document order, read once from FRAME: measuring them reads no HTML.
const ACTS = [...FRAME.matchAll(/data-vn-act="([a-z]+)"/g)].map(m => m[1]!);
const CG_ACTS = ACTS.filter(name => name.startsWith('cg'));
const CG_CONTROLS = '[data-vn-cgbar] [data-vn-act],[data-vn-dock] [data-vn-act]';
// A full-screen CG covers the frame: only its own sheet's buttons are under a finger then.
const DOCK = new Set(['cgprev', 'cgfit', 'cgnext', 'cgback']);
// Behind the viewer only the newest messages stay laid out: Risu's re-render costs less.
// The floating TTS and image viewers stand above everything: hidden while this covers the
// chat — Omni's overlay too, except while its 크게보기 is open over the stepped-down viewer.
const foldCss = (hideOmni: boolean) => `${LIST} > .chat-message-container:nth-child(n+3){display:none!important}[x-omnitts-viewer]${hideOmni ? ',.inlay-nx-overlay-root' : ''}{display:none!important}`;

interface HostPoint { clientX: number; clientY: number }
let doc: SafeDocument | null = null, root: SafeElement | null = null, dyn: SafeElement | null = null, fold: SafeElement | null = null;
let bgLayer: SafeElement | null = null, castLayer: SafeElement | null = null, cgLayer: SafeElement | null = null, box: SafeElement | null = null, logBox: SafeElement | null = null, stripEl: SafeElement | null = null, msgsEl: SafeElement | null = null;
// The right-hand strip: this reply's illustrations, each a way back to its scene.
interface StripItem { key: string; message: number; asset: string }
let stripOpen = false, stripItems: StripItem[] = [], thumbs: Array<StripItem & { r: DOMRect }> = [];
const STRIP_MAX = 6;
// The left-hand list: the chat's replies in order, each a way to it.
let msgsOpen = false, msgsRect: DOMRect | null = null, msgRows: number[] = [];
const MSGS_MAX = 400;
let open = false, rect = { left: 0, top: 0, width: 0, height: 0 }, controls: Array<{ act: string; r: DOMRect }> = [];
let context: TtsChatContext | null = null, bot: EmotionBot | null = null, messageIndex = -1, source = '', scenes: ViewerScene[] = [], at = 0;
let streaming = false, logOpen = false, autoTimer: ReturnType<typeof setTimeout> | undefined, positionTimer: ReturnType<typeof setInterval> | undefined;
/** Person key → their place on stage; `${person}|${path}` → the face sent into it; image id → cloned. */
const people = new Map<string, SafeElement>(), faces = new Map<string, string>(), clones = new Set<string>();
let bg = '', revealUntil = 0, epoch = 0, voiceKey = '', clickId = '';

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
  controls = await measureActs('[data-vn-act]', ACTS);
}
async function measureActs(selector: string, names: readonly string[]): Promise<Array<{ act: string; r: DOMRect }>> {
  if (!root) return [];
  const found: Array<{ act: string; r: DOMRect }> = [], nodes = await unwrap(await root.querySelectorAll(selector));
  for (let i = 0; i < nodes.length; i++) {
    try { if (names[i]) found.push({ act: names[i]!, r: await nodes[i]!.getBoundingClientRect() }); } finally { await release(nodes[i]); }
  }
  return found;
}
/**
 * A CG brings its own buttons (its bar, its full-screen sheet): only theirs are read
 * again. They stand above everything else, so they come first: a tap is the first hit.
 */
async function measureCgControls(): Promise<void> {
  const cg = await measureActs(CG_CONTROLS, CG_ACTS);
  controls = [...cg, ...controls.filter(c => !c.act.startsWith('cg'))];
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
  place = await readPlace();
  bg = '';
  await stagePlace().catch(error => dbg('viewer.place', { message: String(error) }, 'warn'));
}
/** The reply as the chat draws it (innerText: what CSS hides is left out). '' when it is not on screen. */
async function renderedText(index: number): Promise<string> {
  if (!doc) return '';
  const node = await doc.querySelector(`.risu-chat[data-chat-index="${index}"] .chattext`);
  if (!node) return '';
  try { return String(await node.innerText() ?? ''); } catch { return ''; } finally { await release(node); }
}
/**
 * The place this reply opens in: its cast block's (remembered when it closed), else
 * the chat's last known place. Its background is the stage; a missing one is made.
 */
let place = '';
const bgs = new Map<string, string>();
async function readPlace(): Promise<string> {
  if (!context) return '';
  const own = await replyPlace(context.characterId, context.chatId, messageId()).catch(() => '');
  if (own) return own;
  const note = await getSessionAuthorNote(chatNoteSessionId(context.sessionId, { character_id: context.characterId, chat_id: context.chatId })).catch(() => null) as { location?: unknown } | null;
  return typeof note?.location === 'string' ? note.location : '';
}
async function stagePlace(): Promise<void> {
  if (!place || !bot || !doc || !bgLayer || !emotionData().settings.placeBackgrounds) return;
  const made = await findBackground(place, bot);
  if (!made) { if (emotionData().settings.autoGenerate) void makeBackground(place, bot).catch(() => {}); return; }
  let id = bgs.get(made.path);
  if (!id) {
    const raw = await risuHost()?.readImage?.(made.path);
    const bytes = raw instanceof Uint8Array ? raw : raw instanceof ArrayBuffer ? new Uint8Array(raw) : null;
    if (!bytes?.byteLength) return;
    id = key(made.path);
    const holder = await doc.createElement('div');
    await holder.setAttribute('x-vn-bg', id);
    await holder.setInnerHTML(`<img alt="" src="data:${sniffImageMime(bytes) || 'image/png'};base64,${bytesToBase64(bytes)}">`);
    await bgLayer.appendChild(holder); await release(holder);
    bgs.set(made.path, id);
  }
  bg = id;
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
  if (!keepPlace) { at = 0; bg = ''; fired.clear(); lastCg = ''; lastCgAt = -1; cgView = 'none'; cgThumb = null; }
  at = Math.max(0, Math.min(at, scenes.length - 1));
}
/**
 * BGM only pauses and plays on: switching it off rewrites Risu's sound module and
 * redraws the chat. Paused here, the reply's music cues wait; playing on picks up
 * the latest of them, else the music that was paused.
 */
let bgmHeld = false, heldTags: string[] | null = null;
async function toggleMusic(): Promise<void> {
  if (omniSound.player.bgmPlaying) { omniSound.player.pauseBgm(); bgmHeld = true; return; }
  bgmHeld = false;
  const tags = heldTags; heldTags = null;
  if (tags) await omniSound.playBgmForTags(tags); else await omniSound.toggleBgm();
}
/** Cues up to this scene that have not played: the music changes and effects sound where they are written. */
function playCues(scene: ViewerScene): void {
  for (const cue of cues) {
    if (cue.start > scene.end || fired.has(cue.id)) continue;
    fired.add(cue.id);
    const tags = (cue as TtsSegment & { tags?: string[] }).tags;
    if (cue.kind === 'bgm' && tags?.length) {
      if (bgmHeld) heldTags = tags;
      // The music starts after the scene's style text went out: the BGM button catches up.
      else void omniSound.playBgmForTags(tags).then(() => restyle()).catch(error => dbg('viewer.bgm', { message: String(error) }, 'warn'));
    }
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
/** The last scene of the newest reply: the story so far has ended, and the next message is the user's. */
const atEnd = (): boolean => !streaming && at === scenes.length - 1 && !charIndexes().some(i => i > messageIndex);

function messageId(): string {
  const message = context?.messages[messageIndex];
  return String(message?.chatId || message?.id || `${messageIndex}:${compactHash(source)}`);
}
function voice(scene: ViewerScene): void {
  if (!prefs.voice || !context || !scene.segmentId || !ttsData().settings.enabled) return;
  // 나레이션 off: narration is shown, never voiced (its voice is not even made).
  if (scene.kind === 'narration' && ttsData().settings.narration === false) return;
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

/**
 * The last CG this reply showed (and its scene), and how it stands: none, coming in,
 * folded at the top, shown again, full screen.
 */
let lastCg = '', lastCgAt = -1, cgView: 'none' | 'open' | 'fold' | 'show' | 'full' = 'none', cgThumb: DOMRect | null = null, cgFill = false;
async function measureCgThumb(): Promise<void> {
  cgThumb = null;
  if (!cgLayer || !lastCg) return;
  const node = await cgLayer.querySelector(`img[x-vn-cg="${lastCg}"]`);
  if (node) { cgThumb = await node.getBoundingClientRect(); await release(node); }
}
/** The reply's illustration before or after the one on show; -1 when there is none that way. */
function cgNeighbour(dir: 1 | -1): number {
  for (let i = lastCgAt + dir; i >= 0 && i < scenes.length; i += dir) if (scenes[i]!.kind === 'cg') return i;
  return -1;
}
/** ◀ ▶ under a full-screen CG: the reply's other illustrations, full screen too. Where the reading is stays. */
async function cgStep(dir: 1 | -1): Promise<void> {
  for (let i = lastCgAt + dir; i >= 0 && i < scenes.length; i += dir) {
    if (scenes[i]!.kind !== 'cg') continue;
    const id = await cloneImage(scenes[i]!, cgLayer, 'x-vn-cg');
    if (!id) continue;
    lastCg = id; lastCgAt = i; cgThumb = null; cgView = 'full';
    await restyle();
    return;
  }
}
/**
 * 전체화면 is Omni's own 크게보기 (⚛️ 🔃 🎲 🔮 🆙) for a baked illustration, as the
 * chat's ⛶ opens it: the viewer steps down under it, takes no taps, and comes back
 * when it closes. false when it cannot open (no such card, Omni not loaded): the
 * viewer's own full screen then.
 */
let away = false, awayTimer: ReturnType<typeof setInterval> | undefined;
async function inspectCg(): Promise<boolean> {
  const scene = scenes[lastCgAt], shot = Reflect.get(globalThis, '__OMNI_INSPECT_SHOT__');
  if (scene?.cg?.kind !== 'baked' || typeof shot !== 'function') return false;
  let shown = false;
  try { shown = await shot(scene.cg.card, scene.cg.asset) === true; } catch (error) { dbg('viewer.inspect', { message: String(error) }, 'warn'); }
  if (!shown || !open) return false;
  away = true;
  await fold?.setTextContent(foldCss(false));
  await restyle();
  const since = Date.now();
  let seen = false;
  clearInterval(awayTimer);
  // Only a JS flag is read: watching costs Risu nothing.
  awayTimer = setInterval(() => {
    const showing = Reflect.get(globalThis, '__OMNI_INSPECT_OPEN__');
    if (typeof showing === 'function' && showing() === true) { seen = true; return; }
    if (seen || Date.now() - since > 5000) void comeBack().catch(error => dbg('viewer.inspect', { message: String(error) }, 'warn'));
  }, 300);
  return true;
}
async function comeBack(): Promise<void> {
  clearInterval(awayTimer); awayTimer = undefined;
  if (!away) return;
  away = false;
  if (!open) return;
  await fold?.setTextContent(foldCss(true));
  cgView = lastCg ? 'show' : 'none';
  await restyle();
  await measureCgControls();
}

const state = (cast: Array<{ key: string; face: string; speaking: boolean }>, extra: Partial<StageState> = {}): StageState => ({
  cgView: cgView === 'none' ? undefined : cgView, cast, narration: false, bg, cg: cgView === 'none' ? '' : lastCg, revealed: revealedAt === at,
  log: logOpen, strip: stripOpen, msgs: msgsOpen, auto: prefs.auto, voice: prefs.voice, narrVoice: ttsData().settings.narration !== false,
  bgm: omniSound.player.bgmPlaying, cgFill, away, endCg: cgView === 'open' && scenes[at]?.kind === 'cg' && atEnd(), cgNav: cgView === 'full' ? { prev: cgNeighbour(-1) >= 0, next: cgNeighbour(1) >= 0 } : undefined,
  count: scenes.length ? `${at + 1} / ${scenes.length}${streaming ? ' · 받는 중' : ''}` : '', ...extra });

/** Fills the strip, newest first: the chat's own images cloned (no pixels sent), a label where the chat draws none. */
async function buildStrip(): Promise<void> {
  if (!doc || !stripEl || !context) return;
  const items: StripItem[] = [];
  // This reply's illustrations only.
  for (const img of replyImages(source)) {
    if (img.cg.kind === 'baked' && items.length < STRIP_MAX) items.push({ key: key(`${messageIndex}|${img.cg.asset}`), message: messageIndex, asset: img.cg.asset });
  }
  await stripEl.setInnerHTML(items.length ? '' : '<p style="font-size:12px;opacity:.7;margin:4px">이 답장에는 삽화가 없습니다.</p>');
  const order = charIndexes();
  for (const item of items) {
    const img = await doc.querySelector(`.risu-chat[data-chat-index="${item.message}"] [data-inray-asset="${item.asset}"] img`);
    let node: SafeElement;
    if (img) { node = await img.cloneNode(true); await release(img); }
    else { node = await doc.createElement('div'); await node.setInnerHTML(`답장 ${order.indexOf(item.message) + 1} · 삽화`); }
    await node.setAttribute('x-vn-thumb', item.key);
    await stripEl.appendChild(node); await release(node);
  }
  stripItems = items;
}
/** Tile rectangles, once the strip has slid in: taps on it then cost nothing. */
async function measureThumbs(): Promise<void> {
  if (!stripEl) return;
  const found: typeof thumbs = [];
  for (const node of await unwrap(await stripEl.querySelectorAll('[x-vn-thumb]'))) {
    const id = await node.getAttribute('x-vn-thumb'), item = stripItems.find(it => it.key === id);
    if (item) found.push({ ...item, r: await node.getBoundingClientRect() });
    await release(node);
  }
  thumbs = found;
}
async function jumpTo(item: StripItem): Promise<void> {
  stripOpen = false;
  await load(item.message);
  const index = scenes.findIndex(s => s.cg?.kind === 'baked' && s.cg.asset === item.asset);
  at = index >= 0 ? index : 0;
  await render();
}
/**
 * Fills the message list: every reply in order (the newest {@link MSGS_MAX}), each a
 * tile with its number, its story clock when it has one, and its first line. One
 * write for the whole list; a tap finds its tile by a binary search, never by
 * reading every tile.
 */
async function buildMsgs(): Promise<void> {
  if (!msgsEl || !context) return;
  const messages = context.messages, list = charIndexes().slice(-MSGS_MAX);
  msgRows = list;
  await msgsEl.setInnerHTML(list.map(i => {
    const raw = String(messages[i]?.data ?? ''), clock = storyClock(raw);
    return `<div data-vn-msg${i === messageIndex ? ' data-now' : ''}><b>#${i + 1}</b>${clock ? `<small>${esc(clock)}</small>` : ''}<span>${esc(replyGist(raw) || '…')}</span></div>`;
  }).join('') || '<p style="font-size:12px;opacity:.7;margin:4px">답장이 없습니다.</p>');
}
async function jumpFromMsgs(y: number): Promise<void> {
  if (!msgsEl || !msgRows.length) return;
  const found = await rowAt(msgsEl, '[data-vn-msg]', y);
  if (found < 0 || msgRows[found] === undefined) return;
  msgsOpen = false; msgsRect = null;
  await load(msgRows[found]);
  await render(true);
}
let lastCast: Array<{ key: string; face: string; speaking: boolean }> = [];

/**
 * One scene. The stage (one style text) is always brought up to date — a face may
 * have arrived — but the box and the voice only change when the scene does: a
 * streaming reply re-reads every 0.4 s, and rewriting the box each time restarted
 * its letters over and over.
 *
 * A tap may come while a line is still being drawn (its people, its faces): it is
 * remembered for that drawing (`askReveal`), so the line comes in whole.
 */
let shownSig = '', shownEnd = false, drawing = -1, drawId = 0, askReveal = 0, revealedAt = -1;
const lineSig = (index: number): string => { const s = scenes[index]; return s ? `${s.id}|${s.text}` : ''; };
async function render(force = false): Promise<void> {
  if (!open || !dyn || !box) return;
  const mine = ++epoch, scene = scenes[at];
  clearTimeout(autoTimer);
  if (!scene) {
    await box.setInnerHTML(boxHtml({ speaker: '', text: streaming ? '…' : '이 답장에는 읽을 문장이 없습니다.', narration: true }).html);
    return;
  }
  playCues(scene);
  // A background finished since: put it up.
  if (!bg && place) await stagePlace().catch(() => {});
  if (scene.kind === 'cg') {
    // The illustration is a photo over the dimmed stage; the stage itself stays the place.
    const cg = await cloneImage(scene, cgLayer, 'x-vn-cg');
    if (mine !== epoch) return;
    if (!cg) { queueStep(1); return; }
    // Shown once; past it, it waits folded at the top, a tap away.
    lastCg = cg; lastCgAt = at; cgView = 'open'; revealedAt = -1;
    await dyn.setTextContent(stageCss(state(lastCast, { cg, cgView })));
    // The reply ends on this picture: the cue to write the next message comes with it.
    if (atEnd() && !(shownSig === '' && shownEnd)) { shownSig = ''; shownEnd = true; await box.setInnerHTML(boxHtml({ speaker: '', text: '', narration: true, end: true }).html); }
    if (prefs.auto) autoTimer = setTimeout(() => void autoNext(mine), 2600);
    return;
  }
  if (pendingSteps) return;
  const draw = ++drawId;
  drawing = at;
  try {
    // A folded CG stays at the top while the reply goes on: the reply's last CG before
    // this scene, also when a jump went straight past it. Back before it, it goes.
    if (cgView === 'open') cgView = 'fold';
    let passedAt = -1;
    for (let i = at - 1; i >= 0; i--) if (scenes[i]!.kind === 'cg') { passedAt = i; break; }
    const passedId = passedAt >= 0 ? await cloneImage(scenes[passedAt]!, cgLayer, 'x-vn-cg') : '';
    if (passedId !== lastCg) { lastCg = passedId; cgThumb = null; }
    lastCgAt = passedId ? passedAt : -1;
    if (!lastCg) cgView = 'none'; else if (cgView === 'none') cgView = 'fold';
    const members = castAt(at), cast: Array<{ key: string; face: string; speaking: boolean }> = [];
    for (const m of members) {
      const place = await placeFor(m);
      cast.push({ key: m.key, face: place ? await faceFor(m, place) : '', speaking: m.speaking });
    }
    if (mine !== epoch || pendingSteps) return;
    // The line itself, not which message holds it: a streaming reply becomes its saved self mid-scene.
    const sig = lineSig(at), end = atEnd(), same = !force && sig === shownSig && end === shownEnd;
    lastCast = cast;
    // Only the end cue is new (the reply finished streaming): the letters already shown stay shown.
    if (!same) revealedAt = askReveal === draw || (sig === shownSig && !force) ? at : -1;
    await dyn.setTextContent(stageCss(state(cast, { narration: scene.kind === 'narration' })));
    if (same) return;
    shownSig = sig; shownEnd = end;
    if (cgView === 'fold' && !cgThumb) setTimeout(() => void measureCgThumb().catch(() => {}), 450);
    const { html, revealMs } = boxHtml({ speaker: scene.kind === 'line' ? resolveName(scene.speaker) : '', text: scene.text, narration: scene.kind !== 'line', end });
    revealUntil = revealedAt === at ? 0 : Date.now() + revealMs;
    await box.setInnerHTML(html);
    // A tap that came while the box went out: the line is complete now too.
    if (askReveal === draw && revealedAt !== at) await reveal();
    voice(scene);
    if (prefs.auto) autoTimer = setTimeout(() => void autoNext(mine), revealMs + 900 + scene.text.length * 30);
  } finally { if (drawId === draw) drawing = -1; }
}
/** A tap while the letters still come in shows them all; the next tap moves on. */
async function reveal(): Promise<void> {
  if (!dyn) return;
  revealedAt = at; revealUntil = 0;
  await dyn.setTextContent(stageCss(state(lastCast, { narration: scenes[at]?.kind === 'narration' })));
}
/** 자동: wait for the voice to end (when it speaks), then move on. */
async function autoNext(mine: number): Promise<void> {
  if (mine !== epoch || !prefs.auto) return;
  if (['playing', 'loading'].includes(String(omniTts.player.status)) && voiceKey) { autoTimer = setTimeout(() => void autoNext(mine), 500); return; }
  await go(1);
}
/**
 * Taps and swipes only count steps; one loop draws where they lead. Rapid taps
 * no longer each draw a scene in turn (a backlog of bridge calls): the scene at
 * the end of them is drawn once, a jump.
 */
let pendingSteps = 0, stepping = false, burstTimer: ReturnType<typeof setTimeout> | undefined;
/** `burst`: 광클. Those taps are gathered and drawn once they pause, so a burst is one jump. */
function queueStep(delta: number, burst = false): void {
  pendingSteps += delta;
  if (stepping) return;
  clearTimeout(burstTimer);
  const run = () => void runSteps().catch(error => dbg('viewer.step', { message: String(error) }, 'warn'));
  if (burst) burstTimer = setTimeout(run, 140); else run();
}
async function runSteps(): Promise<void> {
  stepping = true;
  try { while (pendingSteps) { const delta = pendingSteps; pendingSteps = 0; await go(delta); } }
  finally { stepping = false; }
}
/** Past either end of a reply the next or previous reply goes on; the newest reply's end stays. */
async function go(delta: number): Promise<void> {
  const next = at + delta;
  if (next >= 0 && next < scenes.length) { at = next; await render(); return; }
  // A long swipe stops at the reply's edge first; the next one crosses into the other reply.
  if (Math.abs(delta) > 1 && at !== (delta > 0 ? scenes.length - 1 : 0)) { at = delta > 0 ? scenes.length - 1 : 0; await render(); return; }
  if (streaming) return;
  if (await stepReply(delta > 0 ? 1 : -1)) await render();
}

async function act(name: string): Promise<void> {
  if (name === 'close') { await closeViewer(); return; }
  if (name === 'next') queueStep(1);
  else if (name === 'prev') queueStep(-1);
  else if (name === 'cgclose') { cgView = lastCg ? 'fold' : 'none'; await restyle(); }
  else if (name === 'cgfull') { if (!await inspectCg()) { cgView = 'full'; await restyle(); await measureCgControls(); } }
  else if (name === 'cgback') { cgView = 'show'; await restyle(); await measureCgControls(); }
  else if (name === 'cgfit') { cgFill = !cgFill; await restyle(); }
  else if (name === 'cgprev' || name === 'cgnext') await cgStep(name === 'cgnext' ? 1 : -1);
  else if (name === 'auto') { prefs.auto = !prefs.auto; savePrefs(); await render(true); }
  else if (name === 'voice') { prefs.voice = !prefs.voice; savePrefs(); if (!prefs.voice) omniTts.stop(); await restyle(); }
  else if (name === 'narr') {
    // TTS 나레이션 itself: one style outside the chat, no module write (the TTS viewer's own switch).
    const on = ttsData().settings.narration === false;
    await updateTtsSettings({ narration: on });
    if (!on && scenes[at]?.kind === 'narration') omniTts.stop();
    await restyle();
  }
  else if (name === 'bgm') { await toggleMusic().catch(error => dbg('viewer.bgm', { message: String(error) }, 'warn')); await restyle(); }
  else if (name === 'newest') { await load(); await render(); }
  else if (name === 'strip') {
    stripOpen = !stripOpen; thumbs = [];
    if (stripOpen) { msgsOpen = false; logOpen = false; await buildStrip(); }
    await restyle();
    if (stripOpen) setTimeout(() => { if (stripOpen) void measureThumbs().catch(() => {}); }, 380);
  }
  else if (name === 'msgs') {
    msgsOpen = !msgsOpen; msgsRect = null;
    if (msgsOpen) { stripOpen = false; logOpen = false; await buildMsgs(); }
    await restyle();
    // Once it has slid in: the reply on screen in the middle (scrolling it earlier could
    // move the frame itself), then its rectangle for the taps.
    if (msgsOpen) setTimeout(() => void (async () => {
      if (!msgsOpen || !msgsEl) return;
      const now = await msgsEl.querySelector('[data-now]');
      if (now) { await centerIn(now); await release(now); }
      if (msgsOpen && msgsEl) msgsRect = await msgsEl.getBoundingClientRect();
    })().catch(() => {}), 380);
  }
  else if (name === 'log') {
    logOpen = !logOpen; logRows = []; logRect = null;
    if (logOpen && logBox) {
      stripOpen = false; msgsOpen = false;
      const rows = scenes.flatMap((s, i) => s.kind === 'cg' ? [] : [i]);
      await logBox.setInnerHTML(rows.map(i => { const s = scenes[i]!; return `<p${i === at ? ' data-now' : ''}>${s.kind === 'line' ? `<b>${esc(resolveName(s.speaker))}</b>` : ''}${esc(s.text)}</p>`; }).join('') || '<p>기록이 없습니다.</p>');
      logRows = rows;
    }
    await restyle();
    if (logOpen && logBox) {
      // A real scroll area: the wheel and a finger scroll it. Opened at the line on screen.
      const now = await logBox.querySelector('[data-now]');
      if (now) { await centerIn(now); await release(now); }
      logRect = await logBox.getBoundingClientRect();
    }
  }
}
const inside = (p: HostPoint, r: { left: number; top: number; width: number; height: number }) => p.clientX >= r.left && p.clientX <= r.left + r.width && p.clientY >= r.top && p.clientY <= r.top + r.height;
/**
 * Completing a line goes first, on the press itself: the finger has not lifted
 * and the letters are already all there. 광클 (a third tap in a row and on) only
 * ever moves on, so it jumps.
 */
let lastTapAt = 0, tapRun = 0, pressAt = 0, pressRevealAt = 0;
function completeLine(now: number): boolean {
  tapRun = now - lastTapAt < 350 ? tapRun + 1 : 1;
  lastTapAt = now;
  if (tapRun >= 3 || pendingSteps || revealedAt === at) return false;
  // A new line being drawn comes in whole. The line already on screen drawn again (a
  // streaming tick, a face arriving) is not new: its letters are completed, or the tap moves on.
  if (drawing === at && lineSig(at) !== shownSig) { askReveal = drawId; return true; }
  if (now < revealUntil) { void reveal().catch(() => {}); return true; }
  return false;
}
function onClick(p: HostPoint): void {
  if (!open || away || !Number.isFinite(p?.clientX) || !inside(p, rect)) return;
  // A panel's tab lies under the open panel: there the tap is the panel's.
  const hit = controls.find(c => inside(p, c.r) && (cgView !== 'full' || DOCK.has(c.act)) && !(c.act === 'strip' && stripOpen) && !(c.act === 'msgs' && msgsOpen));
  const report = (what: string) => (error: unknown) => dbg(what, { message: String(error) }, 'warn');
  // An open panel takes the tap: a tile or row jumps to its place, anywhere else closes it.
  if (msgsOpen && !hit) { void (msgsRect && inside(p, msgsRect) ? jumpFromMsgs(p.clientY) : act('msgs')).catch(report('viewer.msgs')); return; }
  if (stripOpen && !hit) { const tile = thumbs.find(t => inside(p, t.r)); void (tile ? jumpTo(tile) : act('strip')).catch(report('viewer.strip')); return; }
  // The click a drag ends with is not a tap on the stage (buttons still work).
  if (!hit && Date.now() < swipeUntil) return;
  if (logOpen && !hit) { void (logRect && inside(p, logRect) ? jumpFromLog(p.clientY) : act('log')).catch(report('viewer.log')); return; }
  // A tap on the folded CG opens it; a tap on an open or full CG folds it again.
  if (!hit && cgView === 'fold' && cgThumb && inside(p, cgThumb)) { cgView = 'show'; void restyle().then(() => measureCgControls()).catch(() => {}); return; }
  if (!hit && (cgView === 'show' || cgView === 'full')) { cgView = 'fold'; void restyle().catch(() => {}); return; }
  if (hit) { void act(hit.act).catch(report('viewer.tap')); return; }
  const now = Date.now();
  // This tap's press already completed the line.
  if (now - pressRevealAt < 1500) { pressRevealAt = 0; return; }
  // A host that sends no press first: the click itself completes a line still coming in.
  if (now - pressAt > 1000 && completeLine(now)) return;
  queueStep(1, tapRun >= 3);
}

/** Only the stage's style text: buttons' state, panels. */
async function restyle(): Promise<void> {
  await dyn?.setTextContent(stageCss(state(lastCast, { narration: scenes[at]?.kind === 'narration' })));
}
/** The tapped line of the open 기록: its rows are in reading order, so a binary search finds it in a few calls. */
let logRows: number[] = [], logRect: DOMRect | null = null;
async function jumpFromLog(y: number): Promise<void> {
  if (!logBox || !logRows.length) return;
  const found = await rowAt(logBox, 'p', y);
  if (found < 0 || logRows[found] === undefined) return;
  at = logRows[found]!; logOpen = false; logRows = []; logRect = null;
  await render(true);
}
/**
 * Swipes: Risu gives a plugin no wheel events, so dragging the stage is how to
 * run through it — up goes on, down goes back, a longer drag several scenes at
 * once. The click a drag ends with is not a tap.
 */
let swipeFrom: { x: number; y: number } | null = null, swipeUntil = 0, downId = '', upId = '';
function onDown(p: HostPoint): void {
  swipeFrom = null;
  if (!open || away || !Number.isFinite(p?.clientY) || !inside(p, rect) || logOpen || stripOpen || msgsOpen) return;
  swipeFrom = { x: p.clientX, y: p.clientY };
  if (controls.some(c => inside(p, c.r)) || cgView === 'show' || cgView === 'full' || (cgView === 'fold' && cgThumb && inside(p, cgThumb))) return;
  const now = Date.now();
  pressAt = now;
  if (completeLine(now)) pressRevealAt = now;
}
function onUp(p: HostPoint): void {
  const from = swipeFrom; swipeFrom = null;
  if (!from || !open || away || !Number.isFinite(p?.clientY)) return;
  const dy = p.clientY - from.y, dx = p.clientX - from.x;
  if (Math.abs(dy) < 36 || Math.abs(dy) < Math.abs(dx)) return;
  swipeUntil = Date.now() + 450; pressRevealAt = 0;
  const steps = Math.min(12, Math.max(1, Math.round(Math.abs(dy) / 70)));
  queueStep(dy < 0 ? steps : -steps);
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
    setTimeout(() => { if (open && streaming && Date.now() - lastTick >= 4000) { streaming = false; void load(undefined, true).then(() => render()); } }, 4200);
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
    await fold.setTextContent(foldCss(true));
    dyn = await doc.createElement('style'); await dyn.setAttribute('x-omni-vn-style', 'scene');
    for (const node of [css, fold, dyn, root]) await body.appendChild(node);
    await release(css); await release(body);
    [bgLayer, castLayer, cgLayer, box, logBox, stripEl, msgsEl] = await Promise.all(['[data-vn-bg]', '[data-vn-cast]', '[data-vn-cg]', '[data-vn-box]', '[data-vn-log]', '[data-vn-strip]', '[data-vn-msgs]'].map(s => root!.querySelector(s)));
    stripOpen = false; stripItems = []; thumbs = []; msgsOpen = false; msgsRect = null; msgRows = [];
    shownSig = ''; shownEnd = false; drawing = -1; askReveal = 0; revealedAt = -1; tapRun = 0; lastTapAt = 0; pressAt = 0; pressRevealAt = 0;
    away = false; cgFill = false; heldTags = null; bgmHeld = omniSound.player.bgmPaused;
    open = true; rect = { left: 0, top: 0, width: 0, height: 0 }; people.clear(); faces.clear(); clones.clear(); bgs.clear(); bg = ''; place = ''; lastCast = []; logOpen = false;
    // Taps first: ✕ has to work even when the reply cannot be read. Only while open: closed, it costs Risu nothing.
    clickId = await doc.addEventListener('click', (e: HostPoint) => onClick(e));
    downId = await doc.addEventListener('pointerdown', (e: HostPoint) => onDown(e));
    upId = await doc.addEventListener('pointerup', (e: HostPoint) => onUp(e));
    await measure().catch(error => dbg('viewer.measure', { message: String(error) }, 'warn'));
    clearInterval(positionTimer);
    // Never while the reader is tapping or a scene is going out: a tap's one call would queue behind these.
    positionTimer = setInterval(() => { if (open && !away && !stepping && drawing < 0 && Date.now() - lastTapAt > 1500) void measure().catch(() => {}); }, 2000);
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
  open = false; epoch++; clearTimeout(autoTimer); clearInterval(positionTimer); clearInterval(awayTimer); away = false;
  if (doc && clickId) { await quiet(doc.removeEventListener('click', clickId)); clickId = ''; }
  if (doc && downId) { await quiet(doc.removeEventListener('pointerdown', downId)); downId = ''; }
  if (doc && upId) { await quiet(doc.removeEventListener('pointerup', upId)); upId = ''; }
  for (const node of [root, dyn, fold]) if (node) { await quiet(node.remove()); await release(node); }
  if (doc) for (const old of await unwrap(await doc.querySelectorAll('[x-omni-vn-style]'))) { await old.remove(); await release(old); }
  for (const place of people.values()) await release(place);
  people.clear();
  root = dyn = fold = bgLayer = castLayer = cgLayer = box = logBox = stripEl = msgsEl = null;
}
export const viewerOpen = (): boolean => open;

/**
 * After a reply settles: its speakers' faces and its place, made ahead while
 * NovelAI idles (makeAhead keeps it to free generations and a few per reply).
 * Off (감정 에셋 or 자동 생성 off), nothing is read.
 */
let aheadTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleAhead(): void {
  clearTimeout(aheadTimer);
  aheadTimer = setTimeout(() => void ahead().catch(error => dbg('viewer.ahead', { message: String(error) }, 'warn')), 5000);
}
async function ahead(): Promise<void> {
  if (Reflect.get(globalThis, '__OMNI_REPLY_STREAMING__')?.() === true) { scheduleAhead(); return; }
  const settings = (await loadEmotionData()).settings;
  if (!settings.enabled || !settings.autoGenerate) return;
  await loadTtsData();
  const ctx = await currentTtsContext(), who = await currentEmotionBot();
  if (!who) return;
  const index = ctx.messages.map(m => m?.role).lastIndexOf('char');
  if (index < 0) return;
  const text = String(ctx.messages[index]!.data ?? '');
  const wants: Array<{ person: TtsCharacter; face: string } | { place: string }> = [];
  const reply = String(ctx.messages[index]!.chatId || ctx.messages[index]!.id || '');
  const at = await replyPlace(ctx.characterId, ctx.chatId, reply).catch(() => '');
  if (at) wants.push({ place: at });
  const seen = new Set<string>();
  for (const scene of buildScenes(text, parseTtsMessage(text), settings.words)) {
    if (scene.kind !== 'line' || !scene.speaker) continue;
    const person = resolveTtsSpeaker(scene.speaker, ttsData().characters, ctx.rosterScope), face = scene.face || DEFAULT_EXPRESSION;
    if (!person || seen.has(person.id + face)) continue;
    seen.add(person.id + face); wants.push({ person, face });
  }
  await makeAhead(wants, who);
}

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
  // Taps on the viewer are not taps on the chat beneath (TTS lines, pink slots, message gestures, illustration presses).
  Reflect.set(globalThis, '__OMNI_VIEWER_COVERS__', (x: number, y: number) => open && inside({ clientX: x, clientY: y }, rect));
  if (host.addRisuChatListener) await host.addRisuChatListener('output', () => scheduleAhead());
  // A sprite finished: the scene on screen may be waiting for it.
  subscribeSprites(() => { if (open) void render(); });
}
