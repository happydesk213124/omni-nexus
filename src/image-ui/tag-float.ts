import { dbg } from '../core/debug';
import { risuHost } from '../core/host';
import { IMAGE_COUNT_STEPS } from '../domain/image-count';
import { MESSAGE_CONTROL_KINDS } from '../domain/message-controls';
import { readingReply } from '../domain/viewer/reply-at';
import { getConfig } from '../services/context';
import { currentTtsContext } from '../services/tts-context';
import { addChatCover, chatCovered, viewerCovering } from '../services/viewer-presence';
import { watchChatScreen, type ChatScreen } from '../services/chat-screen-watch';
import { chatView } from '../viewer/chat-screen';
import { quiet, release, unwrap } from '../viewer/safe-dom';

/**
 * 플로팅 태그: 🟪 on the chat screen's right edge. Pressed, the chat's message row (⚛️ 🔃 👨‍👩‍👧‍👦 🟥 📚 ✒️ 🔢) comes out beside
 * it, as 옴니 뷰어's 태그 tab has it, and runs on the reply the reader is at (readingReply): the newest at the chat's
 * bottom, else the one in the middle of the screen. 🔢 opens − + 1~3 − + under it. The buttons are the chat's own
 * (__OMNI_MESSAGE_ACTION__, __OMNI_IMAGE_COUNTS__: tools/vendor-patches/message-runtime.js).
 *
 * The switch (대시보드 › 플로팅 태그) is read from memory once a second: off, nothing of it is in Risu's page and nothing
 * is read from it. On, it hears whether the chat screen is up, and its size, from the one check the TTS window and the
 * floating viewer hear too (chat-screen-watch.ts); it looked every other second itself before. A tap costs no
 * call unless it is on a button: the buttons' rectangles are read when they show.
 */
interface HostPoint { clientX: number; clientY: number }
type Box = { left: number; top: number; right: number; bottom: number };

const KINDS = new Set<string>(MESSAGE_CONTROL_KINDS.map(([kind]) => kind));
const STEPS = new Set<string>(IMAGE_COUNT_STEPS);
// A reply's own: they want it saved, not still arriving.
const NEEDS_REPLY = new Set(['tag', 'regen', 'note']);
const NOTES: Record<string, string> = { tag: '⚛️ 태그 생성을 시작했어요', regen: '🔃 전체 이미지 리롤을 마쳤어요', stop: '🟥 생성을 멈췄어요' };

const button = (act: string, glyph: string, label: string) => `<button data-tf-act="${act}" type="button" title="${label}" aria-label="${label}">${glyph}</button>`;
export const TAG_FLOAT_HTML = `<div data-tf-bar><div data-tf-row>${MESSAGE_CONTROL_KINDS.map(([kind, icon, label]) => button(kind, icon, label)).join('')}</div>${button('toggle', '🟪', '메시지 버튼 펼치기')}</div>`
  + `<div data-tf-counts>${button('min-down', '−', '최소 줄이기')}${button('min-up', '+', '최소 늘리기')}<span data-tf-range></span>${button('max-down', '−', '최대 줄이기')}${button('max-up', '+', '최대 늘리기')}</div><div data-tf-note></div>`;
// Opacity only: the buttons are measured as they come out, and a slide would move them under the measure.
// Against the right edge, as 옴니 뷰어's 태그 is against its left: what touches the edge has no border or rounding there.
// The row slides out from behind 🟪 to its left and back in, as 태그's row slides from its edge. It stays laid out
// when in, so 🟪 never moves (centred on a row that came and went, it jumped). Unseen, it takes no tap: its
// visibility waits out the slide, and the bar around it lets taps through.
const CSS = `[x-omni-tagfloat]{position:fixed;right:0;top:42%;z-index:2147483000;display:flex;flex-direction:column;align-items:flex-end;gap:6px;max-width:calc(100vw - 16px);pointer-events:none;font:13px/1.4 system-ui,sans-serif;color:#eee;user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent}
[x-omni-tagfloat] [data-tf-bar]{display:flex;align-items:center;gap:6px;overflow:hidden;pointer-events:none}
[x-omni-tagfloat] [data-tf-row]{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:4px;max-width:calc(100vw - 72px);padding:5px;box-sizing:border-box;border:1px solid #344052;border-radius:12px;background:rgba(22,30,44,.95);pointer-events:auto;translate:calc(100% + 54px) 0;visibility:hidden;transition:translate .32s cubic-bezier(.2,.8,.25,1),visibility 0s .32s}
[x-omni-tagfloat][x-tf-open="1"] [data-tf-row]{translate:0 0;visibility:visible;transition:translate .32s cubic-bezier(.2,.8,.25,1)}
[x-omni-tagfloat] button{display:inline-grid;place-items:center;width:40px;height:40px;margin:0;padding:0;border:1px solid transparent;border-radius:10px;background:rgba(255,255,255,.08);color:inherit;font:20px/1 system-ui,sans-serif;cursor:pointer;box-shadow:none;text-shadow:none;touch-action:manipulation}
[x-omni-tagfloat] [data-tf-act="toggle"]{position:relative;z-index:1;pointer-events:auto;width:42px;height:42px;border-color:#344052;border-right:0;border-radius:12px 0 0 12px;background:rgba(22,30,44,.88)}
[x-omni-tagfloat][x-tf-open="1"] [data-tf-act="toggle"]{background:#7132f566;border-color:#7132f5}
[x-omni-tagfloat] [data-tf-counts]{display:none;align-items:center;gap:6px;padding:6px;border:1px solid rgba(255,255,255,.25);border-right:0;border-radius:16px 0 0 16px;background:rgba(24,28,40,.95);pointer-events:auto}
[x-omni-tagfloat][x-tf-counts="1"] [data-tf-counts]{display:flex;animation:omni-tf-in .18s ease-out}
[x-omni-tagfloat][x-tf-counts="1"] [data-tf-act="counts"]{background:rgba(113,50,245,.55)}
[x-omni-tagfloat] [data-tf-counts] button{font-size:22px}
[x-omni-tagfloat] [data-tf-range]{min-width:54px;text-align:center;font:600 15px/1 system-ui,sans-serif;font-variant-numeric:tabular-nums}
[x-omni-tagfloat] [data-tf-note]{display:none;max-width:min(280px,calc(100vw - 24px));padding:8px 10px;box-sizing:border-box;border:1px solid #ffffff24;border-right:0;border-radius:10px 0 0 10px;background:rgba(23,32,49,.95);font-size:12px;line-height:18px;overflow-wrap:anywhere;pointer-events:none}
[x-omni-tagfloat][x-tf-note="1"] [data-tf-note]{display:block}
@keyframes omni-tf-in{from{opacity:0}to{opacity:1}}
@media (hover:hover){[x-omni-tagfloat] button:hover{background:rgba(255,255,255,.18)}}
@media (max-width:400px){[x-omni-tagfloat] [data-tf-row] button{width:36px;height:36px;font-size:18px}}`;

let installed = false, mounted = false, ticking = false, rerun = false, stopScreen: (() => void) | undefined;
let doc: SafeDocument | null = null, root: SafeElement | null = null, style: SafeElement | null = null;
let rangeEl: SafeElement | null = null, noteEl: SafeElement | null = null, clickId = '';
let shown = false, inChat = false, screenSig = '', open = false, countsOpen = false, range = '', note = '', busy = '';
let noteTimer: ReturnType<typeof setTimeout> | undefined, slideTimer: ReturnType<typeof setTimeout> | undefined, sliding = false;
const SLIDE_MS = 320;
// What the page has now, so an unchanged paint writes nothing.
const written = new Map<string, string>();
// Where the buttons and their panels are, read when they show.
let hits: Array<{ act: string; r: Box }> = [], areas: Box[] = [];

const inside = (p: HostPoint, r: Box) => p.clientX >= r.left && p.clientX <= r.right && p.clientY >= r.top && p.clientY <= r.bottom;
const box = (r: DOMRect): Box => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
const covered = (x: number, y: number): boolean => shown && areas.some(r => inside({ clientX: x, clientY: y }, r));
// The frozen UI's screen state (settings open, 크게보기, a modal): the TTS window's rule. Unknown until it boots.
const hostAllows = (): boolean => { const blocked = Reflect.get(globalThis, '__OMNI_TTS_HOST_BLOCKED__'); return typeof blocked === 'function' && !blocked(); };
const streaming = (): boolean => { const live = Reflect.get(globalThis, '__OMNI_REPLY_STREAMING__'); return typeof live === 'function' && !!live(); };

async function write(node: SafeElement | null, key: string, value: string, put: (node: SafeElement) => unknown): Promise<void> {
  if (!node || written.get(key) === value) return;
  written.set(key, value);
  await put(node);
}

async function measure(): Promise<void> {
  if (!root || !shown) { hits = []; areas = []; return; }
  const found: typeof hits = [], panels: Box[] = [];
  const read = async (selector: string, acts: readonly string[]) => {
    const nodes = await unwrap(await root!.querySelectorAll(selector));
    for (let i = 0; i < nodes.length; i++) {
      try { const r = await nodes[i]!.getBoundingClientRect(); if (acts[i] && r.width > 0) found.push({ act: acts[i]!, r: box(r) }); } finally { await release(nodes[i]); }
    }
  };
  const panel = async (selector: string) => {
    const node = await root!.querySelector(selector);
    if (node) try { const r = await node.getBoundingClientRect(); if (r.width > 0) panels.push(box(r)); } finally { await release(node); }
  };
  // 🟪 first, so it wins where a row on its way still crosses it; the row is read once it has stopped.
  await read('[data-tf-act="toggle"]', ['toggle']);
  if (open && !sliding) { await read('[data-tf-row] [data-tf-act]', [...KINDS]); await panel('[data-tf-bar]'); }
  else panels.push(...found.map(h => h.r));
  if (open && !sliding && countsOpen) { await read('[data-tf-counts] [data-tf-act]', IMAGE_COUNT_STEPS); await panel('[data-tf-counts]'); }
  hits = found; areas = panels;
  written.set('measured', '1');}

async function paint(): Promise<void> {
  if (!root) return;
  await write(root, 'shown', shown ? '1' : '0', node => node.setStyleAttribute(shown ? '' : 'display:none'));
  if (!shown) { hits = []; areas = []; return; }
  await write(root, 'open', open ? '1' : '0', node => node.setAttribute('x-tf-open', open ? '1' : '0'));
  await write(root, 'counts', open && countsOpen ? '1' : '0', node => node.setAttribute('x-tf-counts', open && countsOpen ? '1' : '0'));
  await write(root, 'note', note ? '1' : '0', node => node.setAttribute('x-tf-note', note ? '1' : '0'));
  await write(rangeEl, 'range', range, node => node.setTextContent(range));
  await write(noteEl, 'noteText', note, node => node.setTextContent(note));
  await measure();
}

/** The row in or out: painted now, its buttons read again once it has stopped (until then 🟪 is the one button). */
async function slide(): Promise<void> {
  sliding = true;
  clearTimeout(slideTimer);
  slideTimer = setTimeout(() => { sliding = false; void measure().catch(() => {}); }, SLIDE_MS + 60);
  await paint();
}

function say(text: string, ms: number): void {
  clearTimeout(noteTimer);
  note = text;
  noteTimer = setTimeout(() => { note = ''; void paint().catch(() => {}); }, ms);
  void paint().catch(() => {});
}

async function readCounts(step?: string): Promise<void> {
  const counts = Reflect.get(globalThis, '__OMNI_IMAGE_COUNTS__');
  if (typeof counts !== 'function') { say('Omni가 아직 준비되지 않았어요.', 2600); return; }
  try { const { min, max } = await counts(step) as { min: number; max: number }; range = `${min}~${max}`; }
  catch (error) { say(String((error as Error)?.message || error || '생성 장수를 바꾸지 못했습니다.').slice(0, 120), 4500); }
}

/** The reply on screen, as readingReply picks it; -1 without one. */
async function replyOnScreen(): Promise<number> {
  const [context, view] = await Promise.all([currentTtsContext(), doc ? chatView(doc) : null]);
  return readingReply(context.messages.map(m => m?.role), view ?? { center: -1, atBottom: true });
}

async function messageAction(kind: string): Promise<void> {
  const run = Reflect.get(globalThis, '__OMNI_MESSAGE_ACTION__');
  if (typeof run !== 'function') { say('Omni가 아직 준비되지 않았어요.', 2600); return; }
  if (NEEDS_REPLY.has(kind) && streaming()) { say('답장을 다 받은 뒤에 할 수 있어요.', 2600); return; }
  // One at a time (a stop aside): a second tap while the first is under way would pay for its pictures twice.
  if (busy && kind !== 'stop') { say('이미 하고 있어요.', 2600); return; }
  busy = kind;
  let result: unknown;
  try {
    // 🟥 and 📚 want no reply; 👨‍👩‍👧‍👦 searches the roster by the reply's people when there is one.
    const index = kind === 'stop' || kind === 'preset' ? -1 : await replyOnScreen();
    if (NEEDS_REPLY.has(kind) && index < 0) { say('이 채팅에는 답장이 없어요.', 2600); return; }
    if (kind === 'tag' || kind === 'regen') say(`${kind === 'tag' ? '⚛️ 태그 생성을 거는 중' : '🔃 전체 이미지 리롤 중'}… #${index + 1}`, 60_000);
    result = await run(kind, index);
    if (result === true) { if (NOTES[kind]) say(`${NOTES[kind]}${index >= 0 ? ` · #${index + 1}` : ''}`, 3000); else if (note) say('', 1); }
    else say(typeof result === 'string' && result.trim() ? result.trim().slice(0, 120) : '하지 못했습니다.', 4500);
  } catch (error) { say(String((error as Error)?.message || error).slice(0, 120), 4500); }
  finally { if (busy === kind) busy = ''; }
}

async function press(act: string): Promise<void> {
  if (act === 'toggle') { open = !open; countsOpen = false; await slide(); return; }
  if (act === 'counts') { countsOpen = !countsOpen; if (countsOpen) await readCounts(); await paint(); return; }
  if (STEPS.has(act)) { await readCounts(act); await paint(); return; }
  if (!KINDS.has(act)) return;
  // A message button puts the row away, as 옴니 뷰어's does: what it started is said under 🟪.
  open = false; countsOpen = false; await slide();
  await messageAction(act);
}

function onClick(p: HostPoint): void {
  if (!shown || !Number.isFinite(p?.clientX) || !Number.isFinite(p?.clientY)) return;
  const hit = hits.find(h => inside(p, h.r));
  if (hit) { void press(hit.act).catch(error => dbg('tagfloat.press', { message: String(error) }, 'warn')); return; }
  // A tap anywhere else puts the row away; the tap is still the chat's.
  if ((open || countsOpen) && !covered(p.clientX, p.clientY)) { open = false; countsOpen = false; void slide().catch(() => {}); }
}

async function mount(): Promise<void> {
  const host = risuHost();
  if (!host?.getRootDocument) return;
  doc = await host.getRootDocument();
  if (!doc) return;
  const body = await doc.querySelector('body');
  if (!body) return;
  try {
    for (const old of await unwrap(await doc.querySelectorAll('[x-omni-tagfloat],[x-omni-tagfloat-style]'))) { await old.remove(); await release(old); }
    style = await doc.createElement('style');
    await style.setAttribute('x-omni-tagfloat-style', '1');
    await style.setTextContent(CSS);
    root = await doc.createElement('div');
    await root.setAttribute('x-omni-tagfloat', '1');
    // The frozen UI's message taps leave alone what carries this (excludedMessageTarget).
    await root.setAttribute('x-inlay-ignore', 'true');
    await root.setStyleAttribute('display:none');
    await root.setInnerHTML(TAG_FLOAT_HTML);
    await body.appendChild(style);
    await body.appendChild(root);
  } finally { await release(body); }
  [rangeEl, noteEl] = await Promise.all([root.querySelector('[data-tf-range]'), root.querySelector('[data-tf-note]')]);
  written.clear(); written.set('shown', '0');
  clickId = await doc.addEventListener('click', (p: HostPoint) => onClick(p));
  mounted = true;
  stopScreen = watchChatScreen(onScreen);
}

async function unmount(): Promise<void> {
  stopScreen?.(); stopScreen = undefined;
  mounted = false; shown = false; inChat = false; screenSig = ''; open = false; countsOpen = false; note = ''; hits = []; areas = []; sliding = false;
  clearTimeout(noteTimer); clearTimeout(slideTimer);
  if (doc && clickId) await quiet(doc.removeEventListener('click', clickId));
  clickId = '';
  for (const node of [root, style, rangeEl, noteEl]) if (node) { if (node === root || node === style) await quiet(node.remove()); await release(node); }
  root = style = rangeEl = noteEl = null;
  written.clear();
}

/** Whether the chat screen is up, and its size: a new size (a turned phone) means the buttons are read again. */
function onScreen(screen: ChatScreen): void {
  inChat = screen.present;
  if (screen.present) {
    const sig = `${screen.width}x${screen.height}`;
    if (sig !== screenSig) { screenSig = sig; written.delete('measured'); }
  }
  run();
}

async function step(): Promise<void> {
  if (getConfig().card?.floating_tag_bar !== true) { if (mounted) await unmount(); return; }
  if (!mounted) await mount();
  if (!mounted) return;
  const allowed = !viewerCovering() && hostAllows();
  const next = allowed && inChat;
  // Out of sight it folds: what it was over has moved on by the time it is back.
  if (next !== shown) { shown = next; if (!shown) { open = false; countsOpen = false; } await paint(); }
  else if (shown && !written.has('measured')) await measure();
}

/** A step now; asked for while one is under way, one more as it ends (what changed is not left for the next second). */
function run(): void {
  if (ticking) { rerun = true; return; }
  ticking = true; rerun = false;
  void step().catch(error => dbg('tagfloat.tick', { message: String(error) }, 'warn')).finally(() => { ticking = false; if (rerun) run(); });
}

export function installTagFloat(): void {
  if (installed) return;
  installed = true;
  // 옴니 뷰어 asks the covers too once it is up; until then (or on a host without its button) this one answers.
  if (typeof Reflect.get(globalThis, '__OMNI_VIEWER_COVERS__') !== 'function') Reflect.set(globalThis, '__OMNI_VIEWER_COVERS__', chatCovered);
  addChatCover(covered);
  // The second's own step is dropped while one runs; only news of the chat screen waits for it.
  const timer = setInterval(() => { if (!ticking) run(); }, 1000);
  // Node hosts (smoke, audit) boot the bundle and end when nothing is left to run: a held tick kept them up for hours.
  (timer as unknown as { unref?: () => void }).unref?.();
}
