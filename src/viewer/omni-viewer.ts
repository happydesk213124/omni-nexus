import type { TtsCharacter } from '../core/tts-types';
import { dbg } from '../core/debug';
import { risuHost } from '../core/host';
import { DEFAULT_EXPRESSION } from '../domain/emotion/emotions';
import { compactHash, cueLineKey, isSoundSegment, parseTtsMessage } from '../domain/tts/segment';
import { ttsComparable } from '../domain/tts/anchors';
import { ttsExcludeTerms } from '../domain/tts/filter';
import type { TtsSegment } from '../core/tts-types';
import { omniSound } from '../services/sound-runtime';
import { soundData, soundReady, updateSoundSettings } from '../storage/sound-store';
import { resolveTtsSpeaker } from '../domain/tts/identity';
import { settledWhileStreaming } from '../domain/tts/streaming';
import { buildScenes, replyGist, replyImages, storyClock, type ViewerScene } from '../domain/viewer/scenes';
import { placeAt, placeMarkers, streamingPlace } from '../domain/viewer/place';
import { pickPlace, placeEngine } from '../services/place-backgrounds';
import { backgroundStatus, currentEmotionBot, findBackground, findSprite, forgetMade, makeAhead, makeBackground, makeSprite, PLACE_PERSON, placeKey, SHARED_BOT, spriteNow, spriteStatus, subscribeSprites, type EmotionBot, type EmotionSprite } from '../services/emotion-assets';
import { loadViewerPrefs, saveViewerPrefs, skipWordList, SPEED_PACE, TEXT_SCALE, viewerPrefs } from '../storage/viewer-prefs';
import { focusSoundPanel, setSoundPage } from '../sound-ui/page';
import { withTtsAudio } from '../tts-ui/activation';
import { chatNoteSessionId, getSessionAuthorNote } from '../services/session-author-note';
import { replyPlace } from '../storage/viewer-places';
import { currentTtsContext, type TtsChatContext } from '../services/tts-context';
import { omniTts, type TtsRequest } from '../services/tts-runtime';
import { emotionData, loadEmotionData } from '../storage/emotion-store';
import { loadViewerMarks, saveViewerMarks } from '../storage/viewer-marks';
import { setViewerCovering } from '../services/viewer-presence';
import { loadTtsData, ttsData, updateTtsSettings } from '../storage/tts-store';
import { boxHtml, FRAME, personHtml, STATIC_CSS, stageCss, type StageState } from './look';
import { centerIn, nearestRow, quiet, release, rowAt, unwrap } from './safe-dom';
import { BACKGROUND_BOX, screenImage, SPRITE_BOX } from './shrink';
import { onSticker, elementsAtEnd, elementsClick, elementsClose, elementsCss, elementsDown, elementsEditing, elementsForReply, elementsOpen, elementsShown, elementsUp, toggleEdit, toggleElements } from './elements';

/**
 * 옴니 뷰어: the newest reply as a visual novel over the chat (Risu's own input stays
 * usable below). Everyone the reply has brought on stands there; whoever speaks
 * steps forward, lit, the rest wait dimmed. Built for a slow bridge: every
 * SafeElement call is a round trip, so the frame is made once and a scene is one
 * style text and one box. Pixels never go over twice: a chat image is cloned in
 * place, a sprite is sent once and then only shown or hidden, and taps are
 * hit-tested against rectangles measured once, so a tap itself costs nothing.
 */

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
// A shown CG's own bar: its buttons are there only while it is shown big.
const CG_BAR = new Set(['cgfull', 'cgroll', 'cgtags', 'cgclose']);
// Behind the viewer only the newest messages stay laid out: Risu's re-render costs less.
// The floating TTS and image viewers stand above everything: hidden while this covers the
// chat — Omni's overlay too, except while its 크게보기 is open over the stepped-down viewer.
const foldCss = (hideOmni: boolean) => `${LIST} > .chat-message-container:nth-child(n+3){display:none!important}[x-omnitts-viewer],[x-nx-float]${hideOmni ? ',.inlay-nx-overlay-root' : ''}{display:none!important}`;

interface HostPoint { clientX: number; clientY: number }
let doc: SafeDocument | null = null, root: SafeElement | null = null, dyn: SafeElement | null = null, fold: SafeElement | null = null;
let bgLayer: SafeElement | null = null, castLayer: SafeElement | null = null, cgLayer: SafeElement | null = null, box: SafeElement | null = null, logBox: SafeElement | null = null, stripEl: SafeElement | null = null, msgsEl: SafeElement | null = null;
// The right-hand strip: this reply's illustrations, each a way back to its scene.
interface StripItem { key: string; message: number; asset: string }
let stripOpen = false, stripItems: StripItem[] = [], thumbs: Array<StripItem & { r: DOMRect }> = [];
const STRIP_MAX = 6;
// The left-hand list: the replies around the one on stage, each a way to it; ▲ ▼ rows bring more.
let msgsOpen = false, msgsRect: DOMRect | null = null, msgRows: number[] = [], msgsSpan: [number, number] | null = null, msgsLoading: 'before' | 'after' | '' = '';
const MSGS_AROUND = 1, MSGS_MORE = 5, MORE_BEFORE = -1, MORE_AFTER = -2;
let open = false, rect = { left: 0, top: 0, width: 0, height: 0 }, controls: Array<{ act: string; r: DOMRect }> = [];
// The box the line is in: a drag there selects, no swipe.
let boxRect: DOMRect | null = null;
let context: TtsChatContext | null = null, bot: EmotionBot | null = null, messageIndex = -1, source = '', scenes: ViewerScene[] = [], at = 0;
let streaming = false, logOpen = false, autoTimer: ReturnType<typeof setTimeout> | undefined, positionTimer: ReturnType<typeof setInterval> | undefined;
/** Person key → their place on stage; `${person}|${path}` → the face sent into it; image id → cloned. */
const people = new Map<string, SafeElement>(), faces = new Map<string, string>(), clones = new Set<string>();
let bg = '', revealUntil = 0, epoch = 0, voiceKey = '', clickId = '';

/** The chat screen less Risu's input bar under its messages: what the viewer covers. */
async function chatArea(screen: SafeElement): Promise<{ left: number; top: number; width: number; height: number }> {
  const s = await screen.getBoundingClientRect();
  let below = 0;
  const others = await screen.querySelectorAll(':scope > :not(.absolute):not(.fixed):has(~ .flex-col-reverse)');
  for (const node of await unwrap(others)) { const r = await node.getBoundingClientRect(); below += r.height; await release(node); }
  return { left: Math.round(s.left), top: Math.round(s.top), width: Math.round(s.width), height: Math.max(160, Math.round(s.height - below)) };
}
async function measure(): Promise<void> {
  if (!doc || !root) return;
  const screen = await doc.querySelector('.default-chat-screen');
  let next = rect;
  try {
    if (screen) next = await chatArea(screen);
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
  boxRect = box ? await box.getBoundingClientRect() : null;
}
async function measureActs(selector: string, names: readonly string[]): Promise<Array<{ act: string; r: DOMRect }>> {
  if (!root) return [];
  const found: Array<{ act: string; r: DOMRect }> = [], nodes = await unwrap(await root.querySelectorAll(selector));
  for (let i = 0; i < nodes.length; i++) {
    try { if (names[i]) found.push({ act: names[i]!, r: await nodes[i]!.getBoundingClientRect() }); } finally { await release(nodes[i]); }
  }
  return found;
}
/** A button that moves with what it opens (✎ 편집 steps out beside its panel): its rectangle read again. */
async function remeasure(name: string): Promise<void> {
  const [found] = await measureActs(`[data-vn-act="${name}"]`, [name]);
  if (found) controls = controls.map(c => c.act === name ? found : c);
}
/**
 * A CG brings its own buttons (its bar, its full-screen sheet): only theirs are read
 * again. They stand above everything else, so they come first: a tap is the first hit.
 */
async function measureCgControls(): Promise<void> {
  const cg = await measureActs(CG_CONTROLS, CG_ACTS);
  controls = [...cg, ...controls.filter(c => !c.act.startsWith('cg'))];
}


/**
 * The chat, read: its context, and the bot (the character just read is the bot's, so only
 * its place in Risu's list is asked: a second read of it, every chat it has, was the
 * dearest call the viewer made).
 */
async function readChat(ctx?: TtsChatContext): Promise<void> {
  context = ctx ?? await currentTtsContext();
  shownText.clear();
  const index = Number(await Promise.resolve(risuHost()?.getCurrentCharacterIndex?.()).catch(() => NaN));
  bot = Number.isInteger(index) && index >= 0 && context.characterId ? { id: context.characterId, index, character: context.character } : await currentEmotionBot().catch(() => null);
}
/**
 * The newest reply (or the one at/before `index`), from the chat data. Which of its
 * lines are scenes is what the chat shows of it: a status panel or summary the
 * bot's regex hides is in the source but never on screen, so it is no scene either.
 * The chat is read only when asked (`read`: the chat as just read, or 'fresh' for 최신, a
 * stream's end, a picture baked) or never yet: turning to another reply reads nothing.
 * Its background and stickers come after its first line.
 */
let elementsDue = false, elementsReady: Promise<void> = Promise.resolve();
async function load(index?: number, keepPlace = false, read: TtsChatContext | 'fresh' | null = null): Promise<void> {
  if (read || !context) await readChat(read && read !== 'fresh' ? read : undefined);
  const messages = context?.messages ?? [];
  let i = index ?? messages.length - 1;
  while (i >= 0 && messages[i]?.role !== 'char') i--;
  messageIndex = i;
  const shown = i >= 0 && !streaming ? await shownOf(i) : '';
  setSource(i >= 0 ? String(messages[i]!.data ?? '') : '', keepPlace, shown);
  // A reply loaded (again) asks its voices afresh: what is made already is cached and skipped.
  askedAhead = new Set(); askedFor = '';
  // Just streamed: the place its blocks said holds until the reply's own is stored.
  const said = keepPlace ? livePlace : '';
  if (!streaming) livePlace = '';
  basePlace = await readPlace(said);
  // A reply that says no place: its text picks one (JEV or embedding), once; meanwhile the stage stays as it was.
  if (!basePlace && !placeMarks.length && !streaming) askPlace();
  place = sceneWants(scenes[at]) || place;
  elementsDue = true;
  if (!streaming) makeForReply();
}
/** The reply's stickers and choices, once its first line is out; at the end of the newest reply the line waits for them. */
function elementsAfter(): void {
  if (!elementsDue) return;
  elementsDue = false;
  elementsReady = elementsForReply().catch(error => { dbg('viewer.elements', { message: String(error) }, 'warn'); });
}
/** Every face this reply shows and its place, asked for once it is on stage (not only after it arrived). */
function makeForReply(): void {
  if (!bot || !context) return;
  const who = bot, wants: Array<{ person: TtsCharacter; face: string } | { place: string }> = [], seen = new Set<string>();
  for (const p of new Set([basePlace, ...placeMarks.map(mark => mark.place)].filter(Boolean))) wants.push({ place: p });
  for (const scene of scenes) {
    if (scene.kind !== 'line' || !scene.speaker) continue;
    const person = resolveTtsSpeaker(scene.speaker, ttsData().characters, context.rosterScope), face = scene.face || DEFAULT_EXPRESSION;
    if (!person || seen.has(person.id + face)) continue;
    seen.add(person.id + face); wants.push({ person, face });
  }
  void makeAhead(wants, who).catch(error => dbg('viewer.ahead', { message: String(error) }, 'warn'));
}
/** The reply as the chat draws it, read once per reply (and ahead, near a reply's edge: turning to the next waits on nothing). */
const shownText = new Map<number, Promise<string>>();
function shownOf(index: number): Promise<string> {
  let job = shownText.get(index);
  if (!job) { job = renderedText(index); shownText.set(index, job); }
  return job;
}
/** The reply as the chat draws it (innerText: what CSS hides is left out). '' when it is not on screen. */
async function renderedText(index: number): Promise<string> {
  if (!doc) return '';
  const node = await doc.querySelector(`.risu-chat[data-chat-index="${index}"] .chattext`);
  if (!node) return '';
  try { return String(await node.innerText() ?? ''); } catch { return ''; } finally { await release(node); }
}
/**
 * Where the stage is. A line under a `[[place:…]]` mark is there (the mark before it in
 * the reply); else the reply's own place (`basePlace`): stored when its cast block closed
 * or its first picture was drawn, or picked for it from its text; else what its blocks
 * say; else (no way to pick) the chat's last known place. None at all: the stage stays.
 * A background for a place is drawn the first time it is wanted.
 */
let place = '', basePlace = '', livePlace = '', bgFor = '', picking = false;
let placeMarks: Array<{ at: number; place: string }> = [];
const bgs = new Map<string, string>();
const sceneWants = (scene: ViewerScene | undefined): string => (scene ? placeAt(placeMarks, scene.start) : '') || basePlace || (placeMarks[0]?.place ?? '');
async function readPlace(said = ''): Promise<string> {
  if (!context) return '';
  const own = await replyPlace(context.characterId, context.chatId, messageId()).catch(() => '');
  if (own) return own;
  const written = said || streamingPlace(source);
  if (written) return written;
  // Picked from its text, when a way to pick is set: the chat's place is not this reply's.
  if (placeEngine(viewerPrefs().bgPick)) return '';
  const note = await getSessionAuthorNote(chatNoteSessionId(context.sessionId, { character_id: context.characterId, chat_id: context.chatId })).catch(() => null) as { location?: unknown } | null;
  return typeof note?.location === 'string' ? note.location : '';
}
async function stagePlace(): Promise<void> {
  if (!place || !bot || !doc || !bgLayer || !emotionData().settings.placeBackgrounds) return;
  const made = await findBackground(place, bot);
  if (!made) {
    if (emotionData().settings.autoGenerate) void makeBackground(place, bot).catch(error => dbg('viewer.background', { message: `${placeKey(place)}: ${String((error as Error)?.message || error)}` }, 'warn'));
    return;
  }
  const wanted = place, id = bgs.get(made.path) ?? await sendBackground(made, bot);
  // The reading moved to another place meanwhile: that one is its turn.
  if (!id || place !== wanted) return;
  bg = id; bgFor = wanted;
}
/** A background's picture into its layer, once (asked again while on its way, the same trip). '' when unreadable. */
const bgSending = new Map<string, Promise<string>>();
function sendBackground(made: EmotionSprite, who: EmotionBot): Promise<string> {
  let job = bgSending.get(made.path);
  if (job) return job;
  const d = doc, layer = bgLayer, run = opened;
  job = (async () => {
    if (!d || !layer) return '';
    const raw = await risuHost()?.readImage?.(made.path).catch(() => null);
    const bytes = raw instanceof Uint8Array ? raw : raw instanceof ArrayBuffer ? new Uint8Array(raw) : null;
    if (!bytes?.byteLength) { dbg('viewer.background', { message: `${made.path}: unreadable, drawn again` }, 'warn'); void forgetMade(made.shared ? SHARED_BOT : who.id, PLACE_PERSON, made.face).catch(() => {}); return ''; }
    const id = key(made.path), src = await screenImage(made.path, bytes, BACKGROUND_BOX), holder = await d.createElement('div');
    // Sent together: the bridge keeps their order.
    await Promise.all([holder.setAttribute('x-vn-bg', id), holder.setInnerHTML(`<img alt="" src="${src}">`), layer.appendChild(holder)]);
    await release(holder);
    if (run !== opened) return '';
    bgs.set(made.path, id);
    return id;
  })().finally(() => bgSending.delete(made.path));
  bgSending.set(made.path, job);
  return job;
}
/** A reply that says no place: one is picked from its text (once per message), and the stage goes there. */
function askPlace(): void {
  if (!context || !bot || messageIndex < 0 || !emotionData().settings.placeBackgrounds) return;
  const ids = { characterId: context.characterId, chatId: context.chatId, messageId: messageId() }, from = source, who = bot;
  picking = true;
  void pickPlace(from, ids, who, viewerPrefs().bgPick).then(async picked => {
    picking = false;
    // Still that reply on stage, and nothing nearer said where: the stage goes there.
    if (!open || source !== from || !picked) { if (open) await restyle(); return; }
    basePlace = picked;
    place = sceneWants(scenes[at]) || place;
    await stagePlace();
    await restyle();
  }).catch(error => { picking = false; dbg('viewer.place.pick', { message: String((error as Error)?.message || error) }, 'warn'); void restyle().catch(() => {}); });
}
/** Why there is no background, after the clock: '' when there is one (or backgrounds are off). */
function bgNote(): string {
  const s = emotionData().settings;
  if (bg || !s.placeBackgrounds) return '';
  if (picking) return '배경 고르는 중…';
  if (!placeKey(place)) return '배경: 장소 없음';
  if (!bot) return '';
  const status = backgroundStatus(place, bot);
  if (status.state === 'running') return '배경 그리는 중…';
  if (status.state === 'failed') return `배경 못 그림 · ${status.message.slice(0, 40)}`;
  return s.autoGenerate ? '배경 기다리는 중' : '배경 없음 · 자동 생성 꺼짐';
}
/** Effects play: the viewer's 효과음 and the sound settings' both on. */
const effectsOn = (): boolean => viewerPrefs().sfx && soundReady() && soundData().settings.sfxEnabled;
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
  // 뷰어 설정: lines holding any of these words are no scene (a status line, an OOC note).
  const skip = skipWordList(viewerPrefs().skipWords).map(word => word.toLowerCase());
  if (skip.length) segments = segments.filter(seg => isSoundSegment(seg) || !skip.some(word => seg.text.toLowerCase().includes(word)));
  const visible = ttsComparable(shown);
  if (visible) {
    const kept = segments.filter(s => isSoundSegment(s) || !ttsComparable(s.text) || visible.includes(ttsComparable(s.text)));
    // Drawn text that matches none of the reply is another row (or a bot that redraws everything): keep the reply whole.
    if (kept.some(s => !isSoundSegment(s))) segments = kept;
  }
  cues = segments.filter(isSoundSegment);
  scenes = buildScenes(settled, segments, emotionData().settings.words);
  // The stage keeps its background until the new reply's place is up (or the reply says none).
  if (!keepPlace) { at = 0; fired.clear(); lastCg = ''; lastCgAt = -1; cgView = 'none'; cgThumb = null; }
  placeMarks = placeMarkers(source);
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
    // 효과음 off: passed over, never kept for later.
    else if (cue.kind === 'sfx' && cue.start >= scene.start - 400 && viewerPrefs().sfx) void omniSound.playSfxWord(cue.text, scene.text).catch(() => {});
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

/**
 * Where the reader left each chat: reopened, the viewer goes back to that very line.
 * A reply that came since (or the last one rerolled) opens instead, from its top:
 * that is what is unread. Kept on the device, the newest {@link MARKS_MAX} chats.
 */
const MARKS_MAX = 60;
interface ReadMark { message: string; hash: string; at: number; newest: string; t: number }
let marks: Record<string, ReadMark> | null = null, markTimer: ReturnType<typeof setTimeout> | undefined;
const idOf = (i: number): string => { const m = context?.messages[i]; return String(m?.chatId || m?.id || `${i}:${compactHash(String(m?.data ?? ''))}`); };
const chatKey = (ctx: TtsChatContext): string => `${ctx.characterId}|${ctx.chatId}`;
async function readMarks(): Promise<Record<string, ReadMark>> {
  if (!marks) {
    const raw = await loadViewerMarks().catch(() => null);
    marks = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, ReadMark> : {};
  }
  return marks;
}
/** Every scene shown notes where the reader is: a JS write now, the device a moment later. */
function noteMark(): void {
  if (!context || !marks || streaming || messageIndex < 0) return;
  const list = charIndexes(), newest = list[list.length - 1];
  marks[chatKey(context)] = { message: idOf(messageIndex), hash: compactHash(source), at, newest: newest === undefined ? '' : idOf(newest), t: Date.now() };
  clearTimeout(markTimer);
  markTimer = setTimeout(flushMarks, 1500);
}
function flushMarks(): void {
  clearTimeout(markTimer); markTimer = undefined;
  if (!marks) return;
  marks = Object.fromEntries(Object.entries(marks).sort((a, b) => (Number(b[1]?.t) || 0) - (Number(a[1]?.t) || 0)).slice(0, MARKS_MAX));
  void saveViewerMarks(marks).catch(() => {});
}
/** The reply and scene to open at: where the reader left this chat, or the first reply since. */
async function resume(): Promise<void> {
  const [ctx, all] = await Promise.all([currentTtsContext(), streaming ? null : readMarks()]), mark = all?.[chatKey(ctx)];
  context = ctx;
  const list = charIndexes(), newest = list[list.length - 1];
  let target: number | undefined, resumeAt = 0;
  if (mark && typeof mark === 'object' && newest !== undefined) {
    if (mark.newest === idOf(newest)) {
      // Nothing new since: back to the very line, unless that reply's text changed (a reroll).
      target = list.find(i => idOf(i) === mark.message);
      if (target !== undefined && compactHash(String(ctx.messages[target]?.data ?? '')) === mark.hash) resumeAt = Math.max(0, Number(mark.at) || 0);
    } else {
      // Replies came since: the first of them, from its top.
      const seen = list.findIndex(i => idOf(i) === mark.newest);
      target = seen >= 0 ? list[seen + 1] : undefined;
    }
  }
  await load(target, false, ctx);
  if (resumeAt) at = Math.min(resumeAt, Math.max(0, scenes.length - 1));
}
let parsedFor = '', parsed: TtsSegment[] = [];
/** A scene's TTS request; null when it is not voiced (voice off, narration off, no segment). */
function requestOf(scene: ViewerScene): TtsRequest | null {
  if (!viewerPrefs().voice || !context || !scene.segmentId || !ttsData().settings.enabled) return null;
  if (scene.kind === 'narration' && ttsData().settings.narration === false) return null;
  if (parsedFor !== source) { parsedFor = source; parsed = parseTtsMessage(source); }
  const segment = parsed.find(s => s.id === scene.segmentId);
  return segment ? { context, messageId: messageId(), sourceKey: cueLineKey(source.slice(segment.start, segment.end)), segment } : null;
}
/**
 * Voices ahead, as the chat makes them: every voiced line left in this reply, nearest
 * first, then the next reply's first lines, as many as TTS 미리 생성 allows. The chat's
 * own voicing ahead waits while the viewer is open (it would cancel these for lines
 * hidden behind it). A step forward asks nothing new: what is left was asked already,
 * and asking again would put lines still waiting back in the queue.
 */
const NEXT_REPLY_LINES = 6;
let askedAhead = new Set<string>(), askedFor = '';
function voicesAhead(): void {
  if (!context) return;
  const limit = Math.max(0, ttsData().settings.prefetch || 0);
  if (!limit) return;
  const ahead: TtsRequest[] = [];
  for (let i = at + 1; i < scenes.length && ahead.length < limit; i++) { const request = requestOf(scenes[i]!); if (request) ahead.push(request); }
  // The next reply's opening, so turning to it starts at once.
  const next = charIndexes().find(i => i > messageIndex);
  if (next !== undefined && !streaming && ahead.length < limit) ahead.push(...nextReplyRequests(next, Math.min(NEXT_REPLY_LINES, limit - ahead.length)));
  if (!ahead.length) return;
  const keys = ahead.map(r => `${r.messageId}:${r.segment.id}`), owner = `${context.scope}|${messageId()}`;
  if (owner === askedFor && keys.every(k => askedAhead.has(k))) return;
  askedFor = owner; askedAhead = new Set(keys);
  void omniTts.prefetch(ahead).catch(error => dbg('viewer.voice.ahead', { message: String(error) }, 'warn'));
}
/** A later reply's first voiced lines, as its own requests (its text, its message id). */
function nextReplyRequests(index: number, count: number): TtsRequest[] {
  const message = context?.messages[index];
  if (!context || !message || count <= 0) return [];
  const text = String(message.data ?? ''), id = String(message.chatId || message.id || `${index}:${compactHash(text)}`), s = ttsData().settings;
  const out: TtsRequest[] = [];
  for (const segment of parseTtsMessage(text)) {
    if (out.length >= count) break;
    if (segment.kind !== 'dialogue' && segment.kind !== 'narration') continue;
    if (segment.kind === 'narration' && s.narration === false) continue;
    out.push({ context, messageId: id, sourceKey: cueLineKey(text.slice(segment.start, segment.end)), segment });
  }
  return out;
}
/** The line's voice is being made or fetched (the player says loading, for this line): its spinner turns, a restyle each way. */
let voiceWaiting = false, unsubscribeVoice: (() => void) | undefined;
function onVoiceChange(): void {
  if (!open) return;
  const c = omniTts.current, now = !!voiceKey && omniTts.player.status === 'loading' && !!c && `${c.messageId}:${c.segment.id}` === voiceKey;
  if (now === voiceWaiting) return;
  voiceWaiting = now;
  void restyle().catch(() => {});
}
/** The line's voice, and the next lines' made meanwhile. 나레이션 off: narration is shown, never voiced (its voice is not even made). */
function voice(scene: ViewerScene): void {
  const request = requestOf(scene);
  if (!request) return;
  voiceKey = `${request.messageId}:${request.segment.id}`;
  void omniTts.play([request], 0).catch(error => dbg('viewer.voice', { message: String(error) }, 'warn'));
  voicesAhead();
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
/** The TTS characters this reply brings on, in the order they first speak. */
function replyPeople(): string[] {
  const names: string[] = [];
  for (const scene of scenes) {
    if (scene.kind !== 'line' || !scene.speaker || !context) continue;
    const person = resolveTtsSpeaker(scene.speaker, ttsData().characters, context.rosterScope);
    if (person && !names.includes(person.name)) names.push(person.name);
  }
  return names;
}
/** The settings window on the TTS · 감정 에셋 slot (its page chosen before). */
async function openSoundWindow(): Promise<void> {
  const openPage = Reflect.get(globalThis, '__OMNI_OPEN_TTS__');
  if (typeof openPage === 'function') await Promise.resolve(openPage()).catch(error => dbg('viewer.settings', { message: String(error) }, 'warn'));
}
function resolveName(speaker: string): string {
  const person = context ? resolveTtsSpeaker(speaker, ttsData().characters, context.rosterScope) : null;
  return person?.name || speaker;
}

/** Under the name in a person's oval: the face, then whether its picture is being drawn, or why it could not be. */
function ovalLabel(m: Member): string {
  const status = m.person && bot && emotionData().settings.enabled ? spriteStatus(bot.id, m.person.id, m.face) : { state: '', message: '' };
  return `(${m.face})${status.state === 'running' ? '\n그리는 중…' : status.state === 'failed' ? `\n못 그림 · ${status.message.slice(0, 22)}` : ''}`;
}
/** A person's place on stage, made once (asked again while on its way, the same trip; its three calls sent together). */
const placing = new Map<string, Promise<SafeElement | null>>();
function placeFor(m: Member): Promise<SafeElement | null> {
  const known = people.get(m.key);
  if (known) return Promise.resolve(known);
  if (!doc || !castLayer) return Promise.resolve(null);
  let job = placing.get(m.key);
  if (job) return job;
  const d = doc, layer = castLayer, run = opened;
  job = (async () => {
    const el = await d.createElement('div');
    await Promise.all([el.setAttribute('x-vn-p', m.key), el.setInnerHTML(personHtml(m.name)), layer.appendChild(el)]);
    // Closed and opened again meanwhile: that stage is gone.
    if (run !== opened) { await release(el); return null; }
    people.set(m.key, el);
    return el;
  })().finally(() => placing.delete(m.key));
  placing.set(m.key, job);
  return job;
}
/** The picture for a member's face, or null while they have none (it may be in the making: it is asked for). */
async function spriteFor(m: Member): Promise<EmotionSprite | null> {
  if (!m.person || !bot || !emotionData().settings.enabled) return null;
  const sprite = await findSprite(m.person, m.face, bot) ?? (m.face !== DEFAULT_EXPRESSION ? await findSprite(m.person, DEFAULT_EXPRESSION, bot) : null);
  if (emotionData().settings.autoGenerate && sprite?.face !== m.face) void makeSprite(m.person, m.face, bot).catch(() => {});
  return sprite;
}
/** spriteFor with no wait: undefined while the bot's pictures have never been read (spriteFor reads them). */
function spriteKnown(m: Member): EmotionSprite | null | undefined {
  if (!m.person || !bot || !emotionData().settings.enabled) return null;
  const exact = spriteNow(m.person, m.face, bot);
  if (exact === undefined) return undefined;
  const sprite = exact ?? (m.face !== DEFAULT_EXPRESSION ? spriteNow(m.person, DEFAULT_EXPRESSION, bot) ?? null : null);
  if (emotionData().settings.autoGenerate && sprite?.face !== m.face) void makeSprite(m.person, m.face, bot).catch(() => {});
  return sprite;
}
/**
 * A face's picture sent into its person's place, once (the bytes read, fitted, sent:
 * the dearest thing a scene does). Asked for twice at once, it is sent once.
 */
const sending = new Map<string, Promise<void>>(), shownFace = new Map<string, string>();
let opened = 0;
function sendFace(m: Member, place: SafeElement, sprite: EmotionSprite): Promise<void> {
  const slot = `${m.key}|${sprite.path}`, run = opened;
  const known = sending.get(slot);
  if (known) return known;
  const job = (async () => {
    const raw = await risuHost()?.readImage?.(sprite.path).catch(() => null);
    const bytes = raw instanceof Uint8Array ? raw : raw instanceof ArrayBuffer ? new Uint8Array(raw) : null;
    if (!bytes?.byteLength) { if (sprite.source === 'omni' && bot && m.person) void forgetMade(bot.id, m.person.id, sprite.face).catch(() => {}); return; }
    const src = await screenImage(sprite.path, bytes, SPRITE_BOX);
    if (!doc || run !== opened) return;
    const id = key(sprite.path), holder = await doc.createElement('div');
    // Sent together: the bridge keeps their order.
    await Promise.all([holder.setAttribute('x-vn-sp', id), holder.setInnerHTML(`<img alt="" src="${src}">`), place.appendChild(holder)]);
    await release(holder);
    // Closed and opened again meanwhile: that place is gone, and so is this face.
    if (run === opened) faces.set(slot, id);
  })().catch(error => { dbg('viewer.face', { message: String(error) }, 'warn'); }).finally(() => sending.delete(slot));
  sending.set(slot, job);
  return job;
}
type CastEntry = { key: string; face: string; speaking: boolean; label?: string; bounce?: 'a' | 'b' };
/** Work a scene leaves for after its line: started only once the line has gone out, so no call of theirs is ahead of it. */
type Later = Array<() => Promise<unknown>>;
/**
 * Everyone on stage at a scene, as they can show now, with no call: a face already sent
 * shows. Whatever is missing (someone's place, a face not sent, the bot's pictures never
 * read) is work for after the line (`later`), and until it is done a person keeps the
 * face they last showed (someone new: the oval). The line never waits on a picture.
 */
function castNow(index: number, later: Later): CastEntry[] {
  const cast: CastEntry[] = [];
  const send = (m: Member, sprite: EmotionSprite) => placeFor(m).then(place => place ? sendFace(m, place, sprite) : undefined);
  for (const m of castAt(index)) {
    if (!people.has(m.key)) later.push(() => placeFor(m));
    const sprite = spriteKnown(m);
    let face = '';
    if (sprite === undefined) later.push(() => spriteFor(m).then(found => found ? send(m, found) : undefined));
    else if (sprite && faces.has(`${m.key}|${sprite.path}`)) face = key(sprite.path);
    else if (sprite) { later.push(() => send(m, sprite)); face = shownFace.get(m.key) ?? ''; }
    if (face) shownFace.set(m.key, face);
    cast.push({ key: m.key, face, speaking: m.speaking, label: ovalLabel(m), bounce: springOf(m.key, face, m.speaking) });
  }
  return cast;
}
/** A scene's left work, run (after its line), and the stage brought up to date once it is all done. */
function behind(mine: number, later: Later): void {
  if (!later.length) return;
  void Promise.allSettled(later.map(run => run())).then(() => restage(mine)).catch(error => dbg('viewer.behind', { message: String(error) }, 'warn'));
}
/**
 * The spring each person is on: it turns when they come in, show another face (a picture
 * arriving late too) or step forward to speak, and then plays once (see stageCss).
 */
const springs = new Map<string, { face: string; speaking: boolean; turn: 'a' | 'b' }>();
function springOf(key: string, face: string, speaking: boolean): 'a' | 'b' {
  const was = springs.get(key);
  const turn = !was ? 'a' : was.face !== face || (speaking && !was.speaking) ? (was.turn === 'a' ? 'b' : 'a') : was.turn;
  springs.set(key, { face, speaking, turn });
  return turn;
}
/**
 * What went over after a line (a place, faces, a background): the stage shows it, the box
 * stays as it is. What that brought to light (a face, once the bot's pictures were read)
 * comes the same way, a round or two at most.
 */
async function restage(mine: number, round = 0): Promise<void> {
  if (mine !== epoch || !open) return;
  const more: Later = [], cast = castNow(at, more);
  lastCast = cast;
  await restyle();
  if (more.length && round < 2) void Promise.allSettled(more.map(run => run())).then(() => restage(mine, round + 1));
}
/**
 * The next two lines' faces, sent while this one is read: the step to them waits on
 * nothing. Near a reply's edge the reply beyond it is read too (its text as the chat
 * draws it), so turning to it waits on nothing either.
 */
function sendAhead(mine: number): void {
  setTimeout(() => void (async () => {
    for (let i = at + 1; i <= at + 2 && i < scenes.length; i++) {
      for (const m of castAt(i)) {
        // A step since: its own scene comes first.
        if (mine !== epoch || stepping || pendingSteps) return;
        const sprite = await spriteFor(m);
        if (!sprite || faces.has(`${m.key}|${sprite.path}`)) continue;
        const place = await placeFor(m);
        if (place) await sendFace(m, place, sprite);
      }
    }
    if (mine !== epoch || stepping || pendingSteps || streaming) return;
    const list = charIndexes(), here = list.indexOf(messageIndex);
    if (at >= scenes.length - 2 && list[here + 1] !== undefined) await shownOf(list[here + 1]!);
    if (at <= 1 && here > 0) await shownOf(list[here - 1]!);
  })().catch(error => dbg('viewer.ahead', { message: String(error) }, 'warn')), 300);
}
/**
 * A streaming reply's CG (its `[[inxN]]` slot) is a frame saying it is being drawn: the
 * chat paints a base64 preview there that changes until the image is done, and cloning
 * it again on every streamed chunk piled copies up. Once the reply holds the finished
 * image (baked), that is cloned, once. One frame serves every pending CG.
 */
const PENDING = 'pending';
let pendingMade = false, pendingTimer: ReturnType<typeof setInterval> | undefined, slotsShown = -1;
async function pendingFrame(): Promise<string> {
  if (!pendingMade && doc && cgLayer) {
    const frame = await doc.createElement('div');
    await frame.setAttribute('x-vn-cg', PENDING);
    await frame.setInnerHTML('<span>삽화 그리는 중…</span>');
    await cgLayer.appendChild(frame); await release(frame);
    pendingMade = true;
  }
  watchPending();
  return PENDING;
}
/** The picture for a CG scene: baked, cloned from the chat; still being drawn, its picture once done (else the frame); a pink slot, its picture or none. */
const cgFor = (scene: ViewerScene): Promise<string> => {
  const cg = scene.cg;
  if (cg?.kind === 'slot' || cg?.kind === 'spin') { const id = previewOf(cg); return id ? Promise.resolve(id) : pendingFrame(); }
  if (cg?.kind === 'wait') return Promise.resolve(previewOf(cg));
  return cloneImage(scene, cgLayer, 'x-vn-cg');
};
/**
 * A streaming reply's pictures as they finish: the chat shows each in its slot (its
 * base64, before the reply is baked), and so does the viewer, once per picture.
 * Only for the reply they belong to: slot numbers start again in every reply.
 */
const previews = new Map<string, string>();
let previewMsg = -2;
/** Where a picture goes: a streaming block's slot, a pink slot, or a line batch's spinner. */
type PreviewSlot = { messageIndex?: unknown; url?: unknown; inlineSlot?: unknown; waitSlot?: unknown; jobId?: unknown; shot?: unknown };
const slotKey = (cg: ViewerScene['cg']): string => cg?.kind === 'slot' ? `inx:${cg.n}` : cg?.kind === 'wait' ? `wait:${cg.id}` : cg?.kind === 'spin' ? `spin:${cg.id}` : '';
function previewKey(p: PreviewSlot): string {
  if (Number.isInteger(Number(p?.inlineSlot)) && p?.inlineSlot !== undefined) return `inx:${Number(p.inlineSlot)}`;
  if (typeof p?.waitSlot === 'string' && p.waitSlot) return `wait:${p.waitSlot}`;
  return typeof p?.jobId === 'string' && p.jobId && Number.isInteger(Number(p?.shot)) ? `spin:${p.jobId}_${Number(p.shot)}` : '';
}
function previewOf(cg: ViewerScene['cg']): string {
  return streaming || previewMsg === messageIndex ? previews.get(slotKey(cg)) || '' : '';
}
async function onPreview(p: PreviewSlot): Promise<void> {
  const slot = previewKey(p), url = String(p?.url || ''), message = Number(p?.messageIndex);
  if (!open || !doc || !cgLayer || !slot || !url.startsWith('data:image/')) return;
  if (message !== previewMsg) { previews.clear(); previewMsg = message; }
  if (previews.has(slot)) return;
  // An <img> can only be made through markup: it is made in a holder, marked, and moved into the layer.
  const id = `pv${key(`${message}:${slot}`)}`, holder = await doc.createElement('div');
  await holder.setInnerHTML(`<img alt="" src="${url}">`);
  const img = await holder.querySelector('img');
  if (!img) { await release(holder); return; }
  await img.setAttribute('x-vn-cg', id);
  await cgLayer.appendChild(img); await release(img); await release(holder);
  if (!open) return;
  previews.set(slot, id);
  // The picture on show (or folded at the top) is that slot's frame: it becomes the picture.
  const shownAt = lastCgAt >= 0 ? scenes[lastCgAt] : undefined;
  if (lastCg === PENDING && slotKey(shownAt?.cg) === slot) { lastCg = id; cgThumb = null; await restyle(); }
}
/**
 * While the reply on stage still has slots: a look every few seconds at how many the chat
 * shows (a JS timer, one call). When one is gone it was baked: the reply is read again.
 * During a stream nothing is looked at: its end reads the saved reply anyway.
 */
function watchPending(): void {
  if (pendingTimer) return;
  pendingTimer = setInterval(() => void (async () => {
    if (!open || !doc) { stopPending(); return; }
    if (streaming) return;
    if (!scenes.some(sc => sc.cg?.kind === 'slot' || sc.cg?.kind === 'spin')) { stopPending(); return; }
    const found = await doc.querySelectorAll(`.risu-chat[data-chat-index="${messageIndex}"] :is([data-inx-slot],[data-inray-spinner])`) as SafeClassArray<SafeElement> | SafeElement[];
    const count = Array.isArray(found) ? found.length : await found.length();
    const was = slotsShown; slotsShown = count;
    if (was < 0 || count >= was) return;
    await load(messageIndex, true, 'fresh');
    await render();
  })().catch(error => dbg('viewer.pending', { message: String(error) }, 'warn')), 2500);
}
function stopPending(): void { clearInterval(pendingTimer); pendingTimer = undefined; slotsShown = -1; }
/** A chat image, cloned into a layer (its pixels never cross the bridge). '' when the chat does not show it. */
async function cloneImage(scene: ViewerScene, layer: SafeElement | null, attr: 'x-vn-bg' | 'x-vn-cg'): Promise<string> {
  if (!scene.cg || !doc || !layer) return '';
  const selector = scene.cg.kind === 'baked' ? `[data-inray-asset="${scene.cg.asset}"] img` : '';
  if (!selector) return '';
  const id = key(selector);
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
  if (!cgLayer || !lastCg || cgView !== 'fold') return;
  const id = lastCg, node = await cgLayer.querySelector(`img[x-vn-cg="${id}"]`);
  if (!node) return;
  const box = await node.getBoundingClientRect();
  await release(node);
  // Only the folded picture is the thumb: a key back to its scene meanwhile (it came up big)
  // made this the big one, and the thumb would never take a tap again.
  if (cgView === 'fold' && lastCg === id) cgThumb = box;
}
/**
 * 🎲 리롤 and 🔮 샷 태그 수정 on the picture on show, as 크게보기 has them. Not while the reply
 * streams (its pictures are still being baked into it) nor on a picture not saved yet. A
 * picture drawn again is taken from the chat again once the chat shows it.
 */
const shotLocked = (): boolean => streaming || scenes[lastCgAt]?.cg?.kind !== 'baked' || typeof Reflect.get(globalThis, '__OMNI_SHOT_ACTION__') !== 'function';
let shotWatch: ReturnType<typeof setInterval> | undefined;
async function shotAction(act: 'reroll' | 'base'): Promise<void> {
  const cg = scenes[lastCgAt]?.cg, run = Reflect.get(globalThis, '__OMNI_SHOT_ACTION__');
  if (shotLocked() || cg?.kind !== 'baked' || typeof run !== 'function') return;
  if (act === 'reroll') { await waitOn(async () => { if (await run('reroll', cg.card) === true) await pictureAgain(cg.asset, 8); }); return; }
  if (await run('base', cg.card) !== true) return;
  // The editor is Omni's window over everything: once it closes, the picture (drawn again or not) is read again.
  clearInterval(shotWatch);
  shotWatch = setInterval(() => {
    const up = Reflect.get(globalThis, '__OMNI_SHOT_TAGS_OPEN__');
    if (open && typeof up === 'function' && up() === true) return;
    clearInterval(shotWatch); shotWatch = undefined;
    if (open) void pictureAgain(cg.asset, 1).catch(error => dbg('viewer.shot', { message: String(error) }, 'warn'));
  }, 500);
}
/** The reply read again until its picture is another one (`tries` reads, the chat given a moment between), then on show once the chat shows it. */
async function pictureAgain(was: string, tries: number): Promise<void> {
  const cgAt = lastCgAt;
  let now = '';
  for (let i = 0; i < tries && open && !streaming; i++) {
    if (i) await new Promise(resolve => setTimeout(resolve, 800));
    await load(messageIndex, true, 'fresh');
    const cg = scenes[cgAt]?.cg;
    now = cg?.kind === 'baked' ? cg.asset : '';
    if (now && now !== was) break;
  }
  if (!open || !now || now === was) return;
  for (let i = 0; i < 20 && open && doc; i++) {
    const img = await doc.querySelector(`${LIST} [data-inray-asset="${now}"] img`);
    if (img) { await release(img); break; }
    await new Promise(resolve => setTimeout(resolve, 400));
  }
  if (open) await render(true);
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
    // Never seen open (a slow phone, or it did not open): after a good while the viewer comes back, and closes
    // it first should it be there, unseen — left open under the viewer it held every chat button and the floating viewer.
    if (seen || Date.now() - since > 20_000) { if (!seen) closeInspect(); void comeBack().catch(error => dbg('viewer.inspect', { message: String(error) }, 'warn')); }
  }, 300);
  return true;
}
/** Omni's 크게보기 closed from here (when the viewer closes, or never saw it open). */
function closeInspect(): void {
  const close = Reflect.get(globalThis, '__OMNI_INSPECT_CLOSE__');
  if (typeof close === 'function') void Promise.resolve(close()).catch(() => {});
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
  log: logOpen, logSel: logOpen ? logSel : -1, bgNote: bgNote(), textScale: TEXT_SCALE[viewerPrefs().textSize], motion: { breathe: viewerPrefs().breathe, bounce: viewerPrefs().bounce }, strip: stripOpen, msgs: msgsOpen, auto: viewerPrefs().auto, voice: viewerPrefs().voice, narrVoice: ttsData().settings.narration !== false,
  bgm: omniSound.player.bgmPlaying, sfx: effectsOn(), cgFill, cgPending: lastCg === PENDING, endCg: cgView === 'open' && scenes[at]?.kind === 'cg' && atEnd(), cgNav: cgView === 'full' ? { prev: cgNeighbour(-1) >= 0, next: cgNeighbour(1) >= 0 } : undefined,
  busy: busy > 0, msgsLoading, cgLocked: shotLocked(), voiceWait: voiceWaiting,
  count: scenes.length ? `${at + 1} / ${scenes.length}${streaming ? ' · 받는 중' : ''}` : '', ...extra });

/**
 * Fills the strip, newest first: the chat's own images cloned (no pixels sent), a label
 * where the chat draws none. Every tile is looked up and copied at once, then put in
 * order, sent together: one item after another was six trips each.
 */
async function buildStrip(): Promise<void> {
  const d = doc, strip = stripEl;
  if (!d || !strip || !context) return;
  const items: StripItem[] = [];
  // This reply's illustrations only.
  for (const img of replyImages(source)) {
    if (img.cg.kind === 'baked' && items.length < STRIP_MAX) items.push({ key: key(`${messageIndex}|${img.cg.asset}`), message: messageIndex, asset: img.cg.asset });
  }
  const order = charIndexes();
  const [, ...found] = await Promise.all([strip.setInnerHTML(items.length ? '' : '<p style="font-size:12px;opacity:.7;margin:4px">이 답장에는 삽화가 없습니다.</p>'),
    ...items.map(item => d.querySelector(`.risu-chat[data-chat-index="${item.message}"] [data-inray-asset="${item.asset}"] img`))]);
  const nodes = await Promise.all(items.map(async (item, i) => {
    const img = found[i] as SafeElement | null;
    if (img) { try { return await img.cloneNode(true); } finally { await release(img); } }
    const label = await d.createElement('div');
    await label.setInnerHTML(`답장 ${order.indexOf(item.message) + 1} · 삽화`);
    return label;
  }));
  await Promise.all(nodes.flatMap((node, i) => [node.setAttribute('x-vn-thumb', items[i]!.key), strip.appendChild(node)]));
  for (const node of nodes) await release(node);
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
  await waitOn(async () => {
    await load(item.message);
    const index = scenes.findIndex(s => s.cg?.kind === 'baked' && s.cg.asset === item.asset);
    at = index >= 0 ? index : 0;
    await render();
  });
}
/**
 * Fills the message list: the reply on stage and one either side (every reply at once was
 * one write of hundreds of tiles, and a phone choked on it), each a tile with its number,
 * its story clock when it has one, and its first line; ▲ ▼ rows bring a few more at a
 * time. The reply on stage is in sight as it is: nothing is scrolled. A tap finds its tile
 * by a binary search, never by reading every tile.
 */
async function buildMsgs(): Promise<void> {
  if (!msgsEl || !context) return;
  const messages = context.messages, list = charIndexes(), here = Math.max(0, list.indexOf(messageIndex));
  const [from, to] = msgsSpan ??= [Math.max(0, here - MSGS_AROUND), Math.min(list.length, here + MSGS_AROUND + 1)];
  msgRows = [...(from > 0 ? [MORE_BEFORE] : []), ...list.slice(from, to), ...(to < list.length ? [MORE_AFTER] : [])];
  const more = (side: 'before' | 'after', n: number) => `<div data-vn-msg data-more="${side}">${side === 'before' ? '▲ 이전' : '▼ 다음'} 답장 ${n}개 더 보기</div>`;
  await msgsEl.setInnerHTML(msgRows.map(i => {
    if (i === MORE_BEFORE) return more('before', Math.min(MSGS_MORE, from));
    if (i === MORE_AFTER) return more('after', Math.min(MSGS_MORE, list.length - to));
    const raw = String(messages[i]?.data ?? ''), clock = storyClock(raw);
    return `<div data-vn-msg${i === messageIndex ? ' data-now' : ''}><b>#${i + 1}</b>${clock ? `<small>${esc(clock)}</small>` : ''}<span>${esc(replyGist(raw) || '…')}</span></div>`;
  }).join('') || '<p style="font-size:12px;opacity:.7;margin:4px">답장이 없습니다.</p>');
}
async function jumpFromMsgs(y: number): Promise<void> {
  if (!msgsEl || !msgRows.length) return;
  const found = await rowAt(msgsEl, '[data-vn-msg]', y), row = msgRows[found];
  if (found < 0 || row === undefined) return;
  if (row === MORE_BEFORE || row === MORE_AFTER) { await moreMsgs(row === MORE_BEFORE ? 'before' : 'after'); return; }
  msgsOpen = false; msgsRect = null;
  await waitOn(async () => { await load(row); await render(true); });
}
/** ▲ ▼ in 메시지: a few more replies that way; the row turns until they are in. */
async function moreMsgs(side: 'before' | 'after'): Promise<void> {
  if (!msgsSpan || msgsLoading) return;
  const total = charIndexes().length, [from, to] = msgsSpan;
  msgsLoading = side;
  await restyle();
  msgsSpan = side === 'before' ? [Math.max(0, from - MSGS_MORE), to] : [from, Math.min(total, to + MSGS_MORE)];
  try { await buildMsgs(); } finally { msgsLoading = ''; }
  await restyle();
  if (msgsOpen && msgsEl) msgsRect = await msgsEl.getBoundingClientRect();
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
    // The stage as it was, its spinner gone.
    await Promise.all([box.setInnerHTML(boxHtml({ speaker: '', text: streaming ? '…' : '이 답장에는 읽을 문장이 없습니다.', narration: true }).html), writeStage(state(lastCast))]);
    return;
  }
  noteMark();
  // The line's place (a mark before it moves the stage). A background finished since, or the
  // place moved: it goes up after the line, never in its way, and until it is up the old one
  // stays: a bare stage would flash.
  place = sceneWants(scene) || place;
  const later: Later = [];
  if (place && (!bg || bgFor !== place)) later.push(() => stagePlace());
  if (scene.kind === 'cg') {
    // The illustration is a photo over the dimmed stage; the stage itself stays the place.
    const cg = await cgFor(scene);
    if (mine !== epoch) return;
    if (!cg) { queueStep(1); return; }
    // Shown once; past it, it waits folded at the top, a tap away.
    lastCg = cg; lastCgAt = at; cgView = 'open'; revealedAt = -1;
    const end = atEnd(), endCue = end && !(shownSig === '' && shownEnd);
    if (endCue) { shownSig = ''; shownEnd = true; }
    if (end) { elementsAfter(); await elementsReady; }
    // The reply ends on this picture: the cue to write the next message comes with it. Its calls go out together.
    await Promise.all([elementsAtEnd(end), writeStage(state(lastCast, { cg, cgView })), endCue ? box.setInnerHTML(boxHtml({ speaker: '', text: '', narration: true, end: true }).html) : null]);
    playCues(scene);
    elementsAfter();
    behind(mine, later);
    if (viewerPrefs().auto) autoTimer = setTimeout(() => void autoNext(mine), 2600);
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
    const passedId = passedAt >= 0 ? await cgFor(scenes[passedAt]!) : '';
    if (passedId !== lastCg) { lastCg = passedId; cgThumb = null; }
    lastCgAt = passedId ? passedAt : -1;
    if (!lastCg) cgView = 'none'; else if (cgView === 'none') cgView = 'fold';
    const cast = castNow(at, later);
    if (mine !== epoch || pendingSteps) return;
    // The line itself, not which message holds it: a streaming reply becomes its saved self mid-scene.
    const sig = lineSig(at), end = atEnd(), same = !force && sig === shownSig && end === shownEnd;
    lastCast = cast;
    // Only the end cue is new (the reply finished streaming): the letters already shown stay shown.
    if (!same) revealedAt = askReveal === draw || (sig === shownSig && !force) ? at : -1;
    if (end) { elementsAfter(); await elementsReady; }
    const stage = state(cast, { narration: scene.kind === 'narration' });
    // The folded picture's rect, also when the same line comes back (from its picture, a key back and on).
    if (cgView === 'fold' && !cgThumb) setTimeout(() => void measureCgThumb().catch(() => {}), 450);
    if (same) {
      await Promise.all([elementsAtEnd(end), writeStage(stage)]);
      elementsAfter();
      behind(mine, later);
      return;
    }
    shownSig = sig; shownEnd = end;
    const { html, revealMs } = boxHtml({ speaker: scene.kind === 'line' ? resolveName(scene.speaker) : '', text: scene.text, narration: scene.kind !== 'line', end, pace: SPEED_PACE[viewerPrefs().speed] });
    revealUntil = revealedAt === at ? 0 : Date.now() + revealMs;
    // The line and its stage go out first, together (the bridge keeps their order): all else follows them.
    const out = Promise.all([elementsAtEnd(end), box.setInnerHTML(html), writeStage(stage)]);
    // The voice and the music start as it goes: whatever they ask of Risu queues behind it.
    voice(scene);
    playCues(scene);
    await out;
    // A tap that came while the box went out: the line is complete now too.
    if (askReveal === draw && revealedAt !== at) await reveal();
    if (viewerPrefs().auto) autoTimer = setTimeout(() => void autoNext(mine), revealMs + 900 + scene.text.length * 30);
    elementsAfter();
    behind(mine, later);
    sendAhead(mine);
  } finally { if (drawId === draw) drawing = -1; }
}
/** A tap while the letters still come in shows them all; the next tap moves on. */
async function reveal(): Promise<void> {
  if (!dyn) return;
  revealedAt = at; revealUntil = 0;
  await writeStage(state(lastCast, { narration: scenes[at]?.kind === 'narration' }));
}
/** 자동: wait for the voice to end (when it speaks), then move on. */
async function autoNext(mine: number): Promise<void> {
  if (mine !== epoch || !viewerPrefs().auto) return;
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
  // A step moves the reading: a photo shown big over the line folds away, or the line it moved to stays under it.
  const folded = cgView === 'show' || cgView === 'full';
  if (folded) { cgView = 'fold'; cgThumb = null; }
  const next = at + delta;
  if (next >= 0 && next < scenes.length) { at = next; await render(); return; }
  // A long swipe stops at the reply's edge first; the next one crosses into the other reply.
  if (Math.abs(delta) > 1 && at !== (delta > 0 ? scenes.length - 1 : 0)) { at = delta > 0 ? scenes.length - 1 : 0; await render(); return; }
  // The story so far ends on its picture (or it is the last scene in yet): going on folds it, and the stage
  // and the end cue come back. It stood there for good, every tap a step to nowhere.
  const endsOnIt = delta > 0 && cgView === 'open' && scenes[at]?.kind === 'cg' && (streaming || !charIndexes().some(i => i > messageIndex));
  if (endsOnIt) { cgView = 'fold'; cgThumb = null; }
  else if (!streaming && await stepReply(delta > 0 ? 1 : -1)) { await render(); return; }
  // Nowhere to step: only the fold shows.
  if (endsOnIt || folded) { await restyle(); setTimeout(() => void measureCgThumb().catch(() => {}), 450); }
}

async function act(name: string): Promise<void> {
  if (name === 'close') { await closeViewer(); return; }
  if (name === 'next') queueStep(1);
  else if (name === 'prev') queueStep(-1);
  else if (name === 'cgclose') { cgView = lastCg ? 'fold' : 'none'; await restyle(); }
  else if (name === 'cgfull') { if (!await inspectCg()) { cgView = 'full'; await restyle(); await measureCgControls(); } }
  else if (name === 'cgback') { cgView = 'show'; await restyle(); await measureCgControls(); }
  else if (name === 'cgfit') { cgFill = !cgFill; await restyle(); }
  else if (name === 'cgroll' || name === 'cgtags') await shotAction(name === 'cgroll' ? 'reroll' : 'base');
  else if (name === 'cgprev' || name === 'cgnext') await cgStep(name === 'cgnext' ? 1 : -1);
  else if (name === 'auto') { await saveViewerPrefs({ auto: !viewerPrefs().auto }); await render(true); }
  else if (name === 'voice') { await saveViewerPrefs({ voice: !viewerPrefs().voice }); if (!viewerPrefs().voice) omniTts.stop(); await restyle(); }
  else if (name === 'set') {
    // Its settings need typing, which Risu's screen layer never hands a plugin back: they live
    // on a page of the settings window (감정 에셋 › 옴니 뷰어). Reopened, the viewer is where it was.
    await closeViewer();
    setSoundPage('asset');
    await openSoundWindow();
  }
  else if (name === 'cast') {
    // This reply's people in TTS 캐릭터, searched ("하린, 세라"), as the chat's 👨‍👩‍👧‍👦 opens the
    // illustration roster on a message's: in the settings window, so the viewer closes as for ⚙.
    const people = replyPeople();
    await closeViewer();
    setSoundPage('tts');
    focusSoundPanel('tts-characters', people.join(', '));
    await openSoundWindow();
  }
  else if (name === 'narr') {
    // TTS 나레이션 itself: one style outside the chat, no module write (the TTS viewer's own switch).
    const on = ttsData().settings.narration === false;
    await updateTtsSettings({ narration: on });
    if (!on && scenes[at]?.kind === 'narration') omniTts.stop();
    parsedFor = '';
    if (on && !streaming && messageIndex >= 0) await load(messageIndex, true);
    await restyle();
    const scene = scenes[at];
    if (on && scene?.kind === 'narration') voice(scene);
  }
  else if (name === 'bgm') { await toggleMusic().catch(error => dbg('viewer.bgm', { message: String(error) }, 'warn')); await restyle(); }
  else if (name === 'sfx') {
    // The viewer's own switch, as VOICE is. Off in the sound settings, a press turns them on there
    // too (Risu's sound module is written once): the reader asked for effects.
    const on = !effectsOn(), saving = saveViewerPrefs({ sfx: on });
    if (!on) omniSound.player.stopSfx();
    else if (soundReady() && !soundData().settings.sfxEnabled) {
      await updateSoundSettings({ sfxEnabled: true });
      // The reply's effects are cues only with them on: read again (from the chat as read).
      if (messageIndex >= 0 && !streaming) await load(messageIndex, true);
    }
    await restyle();
    await saving;
  }
  else if (name === 'newest') await waitOn(async () => { await load(undefined, false, 'fresh'); await render(); });
  else if (name === 'strip') {
    stripOpen = !stripOpen; thumbs = [];
    if (stripOpen) { msgsOpen = false; logOpen = false; }
    // It slides in at once (its spinner turning), its tiles right behind it; they are measured once in.
    await Promise.all([restyle(), stripOpen ? buildStrip() : null]);
    if (stripOpen) setTimeout(() => { if (stripOpen) void measureThumbs().catch(() => {}); }, 380);
  }
  else if (name === 'elems') { await toggleElements(); await remeasure('eledit'); }
  else if (name === 'eledit') {
    if (!elementsShown()) return;
    // 편집 is a panel too: the others make room.
    if (!elementsEditing()) { stripOpen = false; msgsOpen = false; logOpen = false; }
    await toggleEdit();
    await remeasure('eledit');
  }
  else if (name === 'msgs') {
    msgsOpen = !msgsOpen; msgsRect = null; msgsSpan = null; msgsLoading = '';
    if (msgsOpen) { stripOpen = false; logOpen = false; }
    // It slides in at once, its few tiles right behind it (sent together).
    await Promise.all([restyle(), msgsOpen ? buildMsgs() : null]);
    // Once it has slid in: its rectangle for the taps.
    if (msgsOpen) setTimeout(() => void (async () => { if (msgsOpen && msgsEl) msgsRect = await msgsEl.getBoundingClientRect(); })().catch(() => {}), 380);
  }
  else if (name === 'log') {
    logOpen = !logOpen; logRows = []; logRect = null; logSel = -1;
    if (logOpen) { stripOpen = false; msgsOpen = false; }
    // Its lines and its showing go out together (the lines first: they pick the line lit).
    await Promise.all([logOpen ? buildLog() : null, restyle()]);
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
/**
 * The button under a point, as the reader sees it: a panel's tab lies under its open
 * panel (there the tap is the panel's), a full-screen CG leaves only its own sheet,
 * and 편집 shows only with 요소.
 */
function liveHit(p: HostPoint): { act: string; r: DOMRect } | undefined {
  const editing = elementsEditing();
  // A CG's bar and full-screen sheet keep the rectangles they had when last shown: hidden, they take no tap
  // (the sheet's ▶ and 닫기 lay over the menu's ◀ and took its taps).
  return controls.find(c => inside(p, c.r) && (cgView !== 'full' || DOCK.has(c.act)) && !(DOCK.has(c.act) && cgView !== 'full') && !(CG_BAR.has(c.act) && cgView !== 'show') && !(c.act === 'msgs' && msgsOpen)
    && !((c.act === 'strip' || c.act === 'elems') && (stripOpen || editing)) && !(c.act === 'eledit' && !elementsShown()));
}
function onClick(p: HostPoint): void {
  if (!open || away || !Number.isFinite(p?.clientX) || !inside(p, rect)) return;
  // Enter or Space on the button pressed last (it keeps the focus) clicks it again, at 0,0:
  // the key has acted already, and 0,0 would be whatever sits in the corner (⚙).
  if (p.clientX === 0 && p.clientY === 0) return;
  const hit = liveHit(p);
  const report = (what: string) => (error: unknown) => dbg(what, { message: String(error) }, 'warn');
  // 요소 first: 편집 takes every tap but the buttons', and the end's choices take theirs.
  if (elementsClick(p, !!hit)) return;
  // The click a drag ends with is not a tap (buttons still work): a selection, a list moved by the mouse, a swipe.
  if (!hit && Date.now() < swipeUntil) return;
  // An open panel takes the tap: a tile or row jumps to its place, anywhere else closes it.
  if (msgsOpen && !hit) { void (msgsRect && inside(p, msgsRect) ? jumpFromMsgs(p.clientY) : act('msgs')).catch(report('viewer.msgs')); return; }
  if (stripOpen && !hit) { const tile = thumbs.find(t => inside(p, t.r)); void (tile ? jumpTo(tile) : act('strip')).catch(report('viewer.strip')); return; }
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

/** The scene's one style text: the stage's, then 요소's (its stickers, its panel, its choices). */
async function writeStage(s: StageState): Promise<void> {
  busyShown = !!s.busy;
  await dyn?.setTextContent(`${stageCss(s)}\n${elementsCss()}`);
}
/**
 * Work the reader waits on (another reply read in, the chat read again): the spinner turns
 * from the tap on, at once, and stops when it is done.
 */
let busy = 0, busyShown = false;
async function waitOn(work: () => Promise<void>): Promise<void> {
  busy++;
  if (!busyShown) void restyle().catch(() => {});
  try { await work(); }
  finally { busy--; if (!busy && busyShown && open) void restyle().catch(() => {}); }
}
/** Only the stage's style text: buttons' state, panels. */
async function restyle(): Promise<void> {
  await writeStage(state(lastCast, { narration: scenes[at]?.kind === 'narration' }));
}
/** The tapped line of the open 기록: its rows are in reading order, so a binary search finds it in a few calls. */
let logRows: number[] = [], logRect: DOMRect | null = null, logSel = -1;
/** 기록: this reply's lines under its number and clock (as its tile shows them), the line on screen lit. */
async function buildLog(): Promise<void> {
  if (!logBox) return;
  const rows = scenes.flatMap((s, i) => s.kind === 'cg' ? [] : [i]), clock = storyClock(source);
  const head = messageIndex >= 0 ? `<h5>#${messageIndex + 1}${clock ? ` · ${esc(clock)}` : ''}</h5>` : '';
  logRows = rows;
  logSel = rows.indexOf(at);
  await logBox.setInnerHTML(head + (rows.map(i => { const s = scenes[i]!; return `<p${i === at ? ' data-now' : ''}>${s.kind === 'line' ? `<b>${esc(resolveName(s.speaker))}</b>` : ''}${esc(s.text)}</p>`; }).join('') || '<p>기록이 없습니다.</p>'));
}
/** ↑ ↓ in 기록: the line picked moves (lit by the style text), and scrolls into sight. */
async function moveLogSel(delta: number): Promise<void> {
  if (!logBox || !logRows.length) return;
  logSel = Math.max(0, Math.min(logRows.length - 1, (logSel < 0 ? logRows.indexOf(at) : logSel) + delta));
  await restyle();
  const row = await logBox.querySelector(`p:nth-of-type(${logSel + 1})`);
  if (row) { await centerIn(row); await release(row); }
}
/** ← → in 기록: the reply before or after, its lines in the same place. */
async function logReply(dir: 1 | -1): Promise<void> {
  if (streaming || !await stepReply(dir)) return;
  at = dir > 0 ? 0 : Math.max(0, scenes.length - 1);
  await buildLog();
  await render(true);
  logRect = logBox ? await logBox.getBoundingClientRect() : null;
}
async function jumpFromLog(y: number): Promise<void> {
  if (!logBox || !logRows.length) return;
  const found = await rowAt(logBox, 'p', y);
  if (found < 0 || logRows[found] === undefined) return;
  at = logRows[found]!; logOpen = false; logRows = []; logRect = null; logSel = -1;
  await render(true);
}
/**
 * Keys, for a keyboard: → (or ↓) goes on, Enter too but completing a line still coming
 * in first (as a tap does), ← goes back, ↑ opens 기록. In 기록 ↑ ↓ pick a line, Enter goes
 * there, ← → turn to the reply before or after, Esc closes it. Only while the viewer is
 * what the reader last pressed on: a press anywhere else (Risu's input, to type) hands
 * the keys back, so Enter there sends the message and moves nothing here.
 */
let keysOn = false, keyId = '', keyStepAt = 0;
// Held, a key repeats some 30 times a second (Risu passes `repeat`): a line per beat.
const KEY_HOLD_MS = 140;
/**
 * A step by key. Held, one line per beat and none while one is still going out: never a
 * backlog that runs on after the key is let go, nor (as 광클 does for taps) a wait for it
 * to be let go. A single press always counts.
 */
function keyStep(delta: number, held: boolean): void {
  const now = Date.now();
  if (held && (stepping || now - keyStepAt < KEY_HOLD_MS)) return;
  keyStepAt = now;
  queueStep(delta);
}
/** ↑ ↓ in 기록, gathered while one is drawing (held, they jump: a list is for skimming). */
let logMove = 0, logMoving = false;
function queueLogMove(delta: number, report: (error: unknown) => void): void {
  logMove += delta;
  if (logMoving) return;
  logMoving = true;
  void (async () => { try { while (logMove) { const d = logMove; logMove = 0; await moveLogSel(d); } } finally { logMoving = false; } })().catch(report);
}
function onKey(event: { key?: unknown; repeat?: unknown }): void {
  if (!open || away || !keysOn) return;
  const key = String(event?.key || ''), held = event?.repeat === true, report = (error: unknown) => dbg('viewer.key', { message: String(error) }, 'warn');
  if (logOpen) {
    if (key === 'ArrowUp' || key === 'ArrowDown') queueLogMove(key === 'ArrowUp' ? -1 : 1, report);
    else if (held) return;
    else if (key === 'Enter' && logSel >= 0 && logRows[logSel] !== undefined) { at = logRows[logSel]!; logOpen = false; logRows = []; logRect = null; logSel = -1; void render(true).catch(report); }
    else if (key === 'ArrowLeft' || key === 'ArrowRight') void logReply(key === 'ArrowLeft' ? -1 : 1).catch(report);
    else if (key === 'Escape') void act('log').catch(report);
    return;
  }
  if (msgsOpen || stripOpen || elementsEditing()) { if (key === 'Escape') void act(msgsOpen ? 'msgs' : stripOpen ? 'strip' : 'eledit').catch(report); return; }
  // A photo shown big: ← → step through the story as ever (the photo folds away with the step); the other keys fold it.
  if ((cgView === 'show' || cgView === 'full') && key !== 'ArrowLeft' && key !== 'ArrowRight') { if (!held && ['Enter', 'Escape', 'ArrowUp', 'ArrowDown'].includes(key)) { cgView = 'fold'; void restyle().catch(report); } return; }
  // Enter is a tap: a line still coming in completes first. The arrows go on at once.
  if (key === 'Enter') { if (held || !completeLine(Date.now())) keyStep(1, held); }
  else if (key === 'ArrowRight' || key === 'ArrowDown') keyStep(1, held);
  else if (key === 'ArrowLeft') keyStep(-1, held);
  else if (key === 'ArrowUp' && !held) void act('log').catch(report);
}
/**
 * Swipes: Risu gives a plugin no wheel events, so dragging the stage is how to
 * run through it — up goes on, down goes back, a longer drag several scenes at
 * once. On the line itself a drag selects its letters, to copy them (and scrolls a
 * long one), never a swipe. The click any drag ends with is not a tap.
 */
let swipeFrom: { x: number; y: number } | null = null, pressFrom: { x: number; y: number } | null = null, swipeUntil = 0, downId = '', upId = '';
// A press that moved this far was a drag: a selection, a list moved by the mouse, a swipe.
const DRAG_SLOP = 8;
function onDown(p: HostPoint): void {
  swipeFrom = null; pressFrom = null;
  if (!open || away || !Number.isFinite(p?.clientY)) return;
  // The keys follow the last press: on the viewer they are its, anywhere else they are not.
  keysOn = inside(p, rect);
  if (!keysOn) return;
  pressFrom = { x: p.clientX, y: p.clientY };
  if (elementsDown(p, !!liveHit(p)) || logOpen || stripOpen || msgsOpen) return;
  // (A picture up front hides the box, or leaves only the end cue there: no line to select, the swipe is the stage's.)
  if (!boxRect || !inside(p, boxRect) || cgView === 'open') swipeFrom = { x: p.clientX, y: p.clientY };
  if (liveHit(p) || onSticker(p) || cgView === 'show' || cgView === 'full' || (cgView === 'fold' && cgThumb && inside(p, cgThumb))) return;
  const now = Date.now();
  pressAt = now;
  if (completeLine(now)) pressRevealAt = now;
}
function onUp(p: HostPoint): void {
  const from = swipeFrom, press = pressFrom; swipeFrom = null; pressFrom = null;
  if (open && !away && elementsUp(p)) return;
  if (!open || away || !Number.isFinite(p?.clientY)) return;
  // A drag ends in a click that is no tap: what it selected stays, to be copied.
  if (press && Math.hypot(p.clientX - press.x, p.clientY - press.y) > DRAG_SLOP) { swipeUntil = Date.now() + 450; pressRevealAt = 0; }
  if (!from) return;
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
    // The reply's cast block (or its first picture's block) has closed: its place is the stage now.
    const said = streamingPlace(pendingText);
    if (said && said !== livePlace) { livePlace = said; basePlace = said; }
    if (waiting && at < scenes.length - 1) at++;
    void render();
    // No chunk for a while: the reply ended, if Risu has not said so already.
    setTimeout(() => { if (Date.now() - lastTick >= 4000) endStream(); }, 4200);
  }, 400);
}
/**
 * The reply ended (Risu says so once it is saved, else no chunk came for a while): the
 * saved one is read, its images baked by then or soon. A chunk still waiting to be drawn
 * is dropped: the saved reply holds it.
 */
function endStream(): void {
  if (!open || !streaming) return;
  clearTimeout(tickTimer); tickTimer = undefined;
  streaming = false;
  void load(undefined, true, 'fresh').then(() => render()).catch(error => dbg('viewer.stream', { message: String(error) }, 'warn'));
}

// Until the chat screen is measured: the whole page above Risu's input bar.
const FALLBACK_RECT = 'left:0;top:0;width:100vw;height:calc(100dvh - 96px)';
let opening = false;
/** A failure the user can see: in the frame when there is one, else Risu's own alert. */
async function showError(error: unknown): Promise<void> {
  const message = String((error as Error)?.message || error).slice(0, 300);
  dbg('viewer.open', { message }, 'warn');
  if (box) { await quiet(dyn?.setTextContent('')); await quiet(box.setInnerHTML(boxHtml({ speaker: '옴니 뷰어', text: `열지 못했습니다: ${message}`, narration: false }).html)); return; }
  const alert = Reflect.get(risuHost() ?? {}, 'alertError');
  if (typeof alert === 'function') await Promise.resolve(alert.call(risuHost(), `[옴니 뷰어] ${message}`)).catch(() => {});
}
/**
 * The chat message in the middle of the chat screen as Risu shows it: a binary search over
 * the messages drawn (newest first in the page), a few calls whatever the chat's length.
 * Read before the viewer folds the chat, which moves it. -1 for none.
 */
async function messageAtCenter(d: SafeDocument): Promise<number> {
  const screen = await d.querySelector('.default-chat-screen');
  if (!screen) return -1;
  let area: Awaited<ReturnType<typeof chatArea>>;
  try { area = await chatArea(screen); } finally { await release(screen); }
  const row = await nearestRow(d, `${LIST} .risu-chat[data-chat-index]`, area.top + area.height / 2, true);
  if (!row) return -1;
  try {
    // Risu lets a plugin read only its own x- attributes: the number is read off the row's own tag.
    const html = String(await row.getOuterHTML() ?? '');
    return Number(/\bdata-chat-index="(\d+)"/.exec(html.slice(0, html.indexOf('>') + 1))?.[1] ?? -1);
  } finally { await release(row); }
}
/** Opened at a chat message: its reply from the top (a message of the reader's: the reply after it, else the one before). */
async function openAt(index: number): Promise<void> {
  // The marks too: where the reader goes from here is noted as from anywhere.
  await Promise.all([readChat(), readMarks()]);
  const list = charIndexes(), target = context?.messages[index]?.role === 'char' ? index : list.find(i => i > index) ?? [...list].reverse().find(i => i < index);
  await load(target);
}
/** `from`: 'resume' where the reader left this chat, 'center' at the message in the middle of the chat screen. */
export async function openViewer(from: 'resume' | 'center' = 'resume'): Promise<void> {
  const host = risuHost();
  if (open || opening || !host?.getRootDocument) return;
  opening = true;
  try {
    doc = await host.getRootDocument();
    if (!doc) throw new Error('Risu 화면에 접근할 수 없습니다. 플러그인 권한을 허용해 주세요.');
    await Promise.all([loadViewerPrefs(), loadEmotionData(), loadTtsData(), omniSound.init().catch(() => {})]);
    const centered = from === 'center' ? await messageAtCenter(doc).catch(() => -1) : -1;
    const body = await doc.querySelector('body');
    if (!body) throw new Error('Risu 화면을 찾지 못했습니다.');
    for (const old of await unwrap(await doc.querySelectorAll('[x-omni-vn],[x-omni-vn-style]'))) { await old.remove(); await release(old); }
    root = await doc.createElement('div'); await root.setAttribute('x-omni-vn', '1'); await root.setInnerHTML(FRAME);
    await root.setStyleAttribute(FALLBACK_RECT);
    const css = await doc.createElement('style'); await css.setAttribute('x-omni-vn-style', 'static'); await css.setTextContent(STATIC_CSS);
    fold = await doc.createElement('style'); await fold.setAttribute('x-omni-vn-style', 'fold');
    await fold.setTextContent(foldCss(true));
    dyn = await doc.createElement('style'); await dyn.setAttribute('x-omni-vn-style', 'scene');
    // Until the first line: the spinner, so the frame never stands there blank.
    await dyn.setTextContent('[x-omni-vn] [data-vn-busy]{display:block}');
    for (const node of [css, fold, dyn, root]) await body.appendChild(node);
    await release(css); await release(body);
    [bgLayer, castLayer, cgLayer, box, logBox, stripEl, msgsEl] = await Promise.all(['[data-vn-bg]', '[data-vn-cast]', '[data-vn-cg]', '[data-vn-box]', '[data-vn-log]', '[data-vn-strip]', '[data-vn-msgs]'].map(s => root!.querySelector(s)));
    await elementsOpen({ doc: () => doc, root: () => root, frame: () => rect, atEnd, restyle,
      reply: () => context && messageIndex >= 0 && !streaming ? { index: messageIndex, bot: context.characterId } : null });
    stripOpen = false; stripItems = []; thumbs = []; msgsOpen = false; msgsRect = null; msgRows = [];
    shownSig = ''; shownEnd = false; drawing = -1; askReveal = 0; revealedAt = -1; tapRun = 0; lastTapAt = 0; pressAt = 0; pressRevealAt = 0;
    away = false; cgFill = false; heldTags = null; bgmHeld = omniSound.player.bgmPaused; pendingMade = false; stopPending();
    open = true; rect = { left: 0, top: 0, width: 0, height: 0 }; boxRect = null; people.clear(); faces.clear(); clones.clear(); bgs.clear(); bg = ''; place = ''; basePlace = ''; livePlace = ''; bgFor = ''; placeMarks = []; picking = false; lastCast = []; logOpen = false;
    opened++; sending.clear(); shownFace.clear(); previews.clear(); previewMsg = -2; askedAhead = new Set(); askedFor = ''; springs.clear();
    placing.clear(); bgSending.clear(); shownText.clear(); context = null; elementsDue = false; elementsReady = Promise.resolve(); busy = 0; busyShown = true;
    // Behind it the chat's TTS buttons and window go quiet until it closes.
    setViewerCovering(true);
    voiceWaiting = false; unsubscribeVoice?.(); unsubscribeVoice = omniTts.subscribe(onVoiceChange);
    // Taps first: ✕ has to work even when the reply cannot be read. Only while open: closed, it costs Risu nothing.
    clickId = await doc.addEventListener('click', (e: HostPoint) => onClick(e));
    keysOn = true; logSel = -1;
    keyId = await doc.addEventListener('keydown', (e: { key?: unknown; repeat?: unknown }) => onKey(e));
    downId = await doc.addEventListener('pointerdown', (e: HostPoint) => onDown(e));
    upId = await doc.addEventListener('pointerup', (e: HostPoint) => onUp(e));
    await measure().catch(error => dbg('viewer.measure', { message: String(error) }, 'warn'));
    clearInterval(positionTimer);
    // Never while the reader is tapping or a scene is going out: a tap's one call would queue behind these.
    positionTimer = setInterval(() => { if (open && !away && !stepping && drawing < 0 && Date.now() - lastTapAt > 1500) void measure().catch(() => {}); }, 2000);
    streaming = Reflect.get(globalThis, '__OMNI_REPLY_STREAMING__')?.() === true;
    if (centered >= 0) await openAt(centered); else await resume();
    // Read by openAt or resume (the reset above leaves the compiler thinking it is still null).
    const read = context as TtsChatContext | null;
    const clock = storyClock(source) || (read ? read.messages.slice(0, messageIndex).reverse().map(m => storyClock(String(m.data ?? ''))).find(Boolean) || '' : '');
    const clockNode = await root.querySelector('[data-vn-clock]'); if (clockNode) { await clockNode.setInnerHTML(clock ? `<span>${esc(clock)}</span>` : ''); await release(clockNode); }
    await render();
    // The voice needs a press inside the plugin before it can sound: asked for now, so the first line speaks.
    if (viewerPrefs().voice && ttsData().settings.enabled && !omniTts.player.ready) void withTtsAudio(() => { const scene = scenes[at]; if (scene) voice(scene); }).catch(error => dbg('viewer.audio', { message: String(error) }, 'warn'));
  } catch (error) {
    await showError(error);
  } finally {
    opening = false;
  }
}
export async function closeViewer(): Promise<void> {
  if (!open) return;
  try { await takeDown(); }
  // Only once the frame is gone: the chat's TTS buttons and window catch up behind it.
  finally { setViewerCovering(false); }
}
async function takeDown(): Promise<void> {
  open = false; epoch++; clearTimeout(autoTimer); clearInterval(positionTimer); clearInterval(awayTimer); if (away) closeInspect(); away = false; stopPending();
  clearInterval(shotWatch); shotWatch = undefined; unsubscribeVoice?.(); unsubscribeVoice = undefined;
  if (markTimer) flushMarks();
  if (doc && clickId) { await quiet(doc.removeEventListener('click', clickId)); clickId = ''; }
  if (doc && downId) { await quiet(doc.removeEventListener('pointerdown', downId)); downId = ''; }
  if (doc && upId) { await quiet(doc.removeEventListener('pointerup', upId)); upId = ''; }
  if (doc && keyId) { await quiet(doc.removeEventListener('keydown', keyId)); keyId = ''; }
  for (const node of [root, dyn, fold]) if (node) { await quiet(node.remove()); await release(node); }
  if (doc) for (const old of await unwrap(await doc.querySelectorAll('[x-omni-vn-style]'))) { await old.remove(); await release(old); }
  await elementsClose().catch(() => {});
  for (const place of people.values()) await release(place);
  people.clear(); placing.clear();
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
  for (const p of new Set([at, ...placeMarkers(text).map(mark => mark.place)].filter(Boolean))) wants.push({ place: p });
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
  const toggle = (from: 'resume' | 'center') => () => void (open ? closeViewer() : openViewer(from)).catch(error => dbg('viewer.toggle', { message: String(error) }, 'warn'));
  const icon = '<span style="font-size:16px">🎬</span>';
  await host.registerButton({ name: '옴니 뷰어', icon, iconType: 'html', location: 'chat', id: 'omni-viewer-chat' }, toggle('resume'));
  // The menu opens it two ways: where the reader left this chat, or at the message in the middle of the chat screen.
  await host.registerButton({ name: '옴니 뷰어 · 보던 곳', icon, iconType: 'html', location: 'hamburger', id: 'omni-viewer-menu' }, toggle('resume'));
  await host.registerButton({ name: '옴니 뷰어 · 화면 중앙', icon, iconType: 'html', location: 'hamburger', id: 'omni-viewer-menu-center' }, toggle('center'));
  Reflect.set(globalThis, '__OMNI_STREAM_TICK__', onStreamTick);
  Reflect.set(globalThis, '__OMNI_VIEWER_PREVIEW__', (p: PreviewSlot) => void onPreview(p).catch(error => dbg('viewer.preview', { message: String(error) }, 'warn')));
  // Taps on the viewer are not taps on the chat beneath (TTS lines, pink slots, message gestures, illustration presses).
  Reflect.set(globalThis, '__OMNI_VIEWER_COVERS__', (x: number, y: number) => open && inside({ clientX: x, clientY: y }, rect));
  // A reply saved: its faces made ahead, and a viewer showing it as it streamed reads the saved one at once.
  if (host.addRisuChatListener) await host.addRisuChatListener('output', () => { scheduleAhead(); endStream(); });
  // A sprite finished: the scene on screen may be waiting for it.
  // A picture finished (or a background drawn again): the scene may be waiting for it, and the stage looks again.
  subscribeSprites(() => { if (open) { bgFor = ''; void render(); } });
}
