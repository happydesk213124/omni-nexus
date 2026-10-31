import { dbg } from '../core/debug';
import { risuHost } from '../core/host';
import { compactHash } from '../domain/tts/segment';
import { findElementKinds, type ElementKind } from '../domain/viewer/elements';
import { elementRules, saveElementRules, type ElementRule, type ElementRules } from '../storage/viewer-elements';
import { quiet, release, rowAt, unwrap } from './safe-dom';

/**
 * 옴니 뷰어's 요소: a bot's own elements (its status panel, its choice list) brought
 * onto the stage. Only kinds the reader registered in 편집 come: a sticker is the
 * chat's element cloned (no pixels, the bot's look kept) and placed where the reader
 * dragged it, shown with 요소 on, or always; a choice is offered at the end of the
 * newest reply, and choosing it twice sends it as the user's message.
 *
 * Nothing here runs for a bot with nothing registered: the reply's HTML is read once,
 * and only when there is something to find or 편집 is open.
 */
export interface ElementsHost {
  doc: () => SafeDocument | null;
  root: () => SafeElement | null;
  frame: () => { left: number; top: number; width: number; height: number };
  /** The reply on stage: its chat index and its bot. null while streaming, or with none. */
  reply: () => { index: number; bot: string } | null;
  atEnd: () => boolean;
  restyle: () => Promise<void>;
}
interface HostPoint { clientX: number; clientY: number }
interface Sticker { key: string; el: SafeElement; r: DOMRect | null }
interface Row { sig: string; label: string; count: number; text: string }

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const keyOf = (sig: string) => compactHash(sig).slice(0, 10);
const inside = (p: HostPoint, r: { left: number; top: number; width: number; height: number }) => p.clientX >= r.left && p.clientX <= r.left + r.width && p.clientY >= r.top && p.clientY <= r.top + r.height;
const report = (what: string) => (error: unknown) => dbg(what, { message: String(error) }, 'warn');
const MAX_OPTIONS = 8;

let host: ElementsHost | null = null, layer: SafeElement | null = null, choicesEl: SafeElement | null = null, panel: SafeElement | null = null;
let showing = false, editing = false, bot = '', rules: ElementRules = {}, kinds: ElementKind[] = [], rows: Row[] = [];
const stickers = new Map<string, Sticker>();
let options: string[] = [], choicesOn = false, chosen = -1, choicesRect: DOMRect | null = null, panelRect: DOMRect | null = null;

export async function elementsOpen(h: ElementsHost): Promise<void> {
  host = h; showing = false; editing = false; kinds = []; rows = []; options = []; choicesOn = false; chosen = -1; choicesRect = null; panelRect = null;
  stickers.clear();
  const root = h.root();
  if (root) [layer, choicesEl, panel] = await Promise.all(['[data-vn-stickers]', '[data-vn-choices]', '[data-vn-edit]'].map(s => root.querySelector(s)));
}
export async function elementsClose(): Promise<void> {
  await endDrag();
  for (const s of stickers.values()) await release(s.el);
  stickers.clear();
  for (const el of [layer, choicesEl, panel]) await release(el);
  layer = choicesEl = panel = null; host = null; showing = editing = false;
}
/** A point on a sticker on show (its taps are its own). */
export const onSticker = (p: HostPoint): boolean => [...stickers.values()].some(s => !!s.r && inside(p, s.r));
/** 요소 is on, or 편집 open: the 편집 button is there to press. */
export const elementsShown = (): boolean => showing || editing;
export const elementsEditing = (): boolean => editing;

const shown = (sig: string): boolean => { const r = rules[sig]; return !!r && (editing || (!r.hidden && (showing || r.always))); };
/**
 * Where each sticker on show is: a tap there is the sticker's (its <details> folds, by
 * the browser itself), never a step of the story. Read again after such a tap, since a
 * fold changes its size.
 */
async function measureStickers(): Promise<void> {
  for (const [sig, s] of stickers) s.r = shown(sig) ? await s.el.getBoundingClientRect() : null;
}
/** The part of the scene's one style text that is 요소's: which stickers show, the panel, the choices. */
export function elementsCss(): string {
  const out: string[] = [];
  if (showing || editing) out.push('[x-omni-vn] [data-vn-act="elems"]{color:#1a1408;background:var(--gold)}[x-omni-vn] [data-vn-act="eledit"]{visibility:visible}');
  // In 편집 a press drags: a <details> under it must not fold as well.
  if (editing) out.push('[x-omni-vn] [data-vn-edit]{translate:0 0}[x-omni-vn] [data-vn-act="eledit"]{color:#1a1408;background:var(--gold)}[x-omni-vn] [x-vn-st] summary{pointer-events:none}');
  for (const [sig, s] of stickers) {
    const r = rules[sig];
    if (!r) continue;
    if (editing) out.push(`[x-omni-vn] [x-vn-st="${s.key}"]{display:block;outline:2px dashed var(--gold);outline-offset:4px${r.hidden ? ';opacity:.35' : ''}}`);
    else if (!r.hidden && (showing || r.always)) out.push(`[x-omni-vn] [x-vn-st="${s.key}"]{display:block}`);
  }
  if (choicesOn) out.push('[x-omni-vn] [data-vn-choices]{display:flex}[x-omni-vn] [data-vn-end]{display:none}');
  return out.join('\n');
}

/** The bot's elements in this reply, read once through the bridge and parsed here. */
async function readKinds(doc: SafeDocument, index: number): Promise<ElementKind[]> {
  if (typeof DOMParser === 'undefined') return [];
  const body = await doc.querySelector(`.risu-chat[data-chat-index="${index}"] .chattext`);
  if (!body) return [];
  let html = '';
  try { html = String(await body.getInnerHTML() ?? ''); } finally { await release(body); }
  const parsed = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html').body.firstElementChild;
  return parsed ? findElementKinds(parsed) : [];
}
const place = (r: ElementRule) => `left:${r.x}%;top:${r.y}%;transform:scale(${r.scale})`;
/** A registered kind's elements, cloned into one sticker where the reader put it. */
async function putSticker(doc: SafeDocument, index: number, kind: ElementKind, rule: ElementRule): Promise<void> {
  if (!layer) return;
  const nodes = await unwrap(await doc.querySelectorAll(`.risu-chat[data-chat-index="${index}"] .chattext ${kind.selector}`));
  try {
    if (!nodes.length) return;
    const wrap = await doc.createElement('div'), key = keyOf(kind.sig);
    await wrap.setAttribute('x-vn-st', key);
    // The bot's chat CSS reaches what sits in a .chattext: the clone looks as it does in the chat.
    await quiet(wrap.setClassName('chattext'));
    await wrap.setStyleAttribute(place(rule));
    for (const node of nodes.slice(0, 6)) { const copy = await node.cloneNode(true); await wrap.appendChild(copy); await release(copy); }
    await layer.appendChild(wrap);
    stickers.set(kind.sig, { key, el: wrap, r: null });
  } finally { for (const node of nodes) await release(node); }
}
/** After a reply loads: its stickers put up and its choices gathered (or nothing, with nothing registered). */
export async function elementsForReply(): Promise<void> {
  for (const s of stickers.values()) { await quiet(s.el.remove()); await release(s.el); }
  stickers.clear(); kinds = []; options = []; choicesOn = false; chosen = -1; choicesRect = null;
  const h = host, doc = h?.doc(), reply = h?.reply();
  if (h && doc && reply) {
    if (reply.bot !== bot) { bot = reply.bot; rules = await elementRules(bot); }
    if (editing || Object.keys(rules).length) {
      kinds = await readKinds(doc, reply.index);
      for (const kind of kinds) { const rule = rules[kind.sig]; if (rule?.role === 'sticker') await putSticker(doc, reply.index, kind, rule); }
      options = kinds.filter(k => rules[k.sig]?.role === 'choice').flatMap(k => k.options).slice(0, MAX_OPTIONS);
    }
  }
  if (editing) { await paintPanel(); setTimeout(() => void measureEditing().catch(() => {}), 120); }
  else if (stickers.size) setTimeout(() => void measureStickers().catch(() => {}), 120);
}

/**
 * The end of the newest reply: its registered choices come up over the box (the end
 * cue gives way to them). Painted once when they come; nothing while they stay.
 */
export async function elementsAtEnd(end: boolean): Promise<void> {
  const want = end && options.length > 0;
  if (want === choicesOn) return;
  choicesOn = want; chosen = -1; choicesRect = null;
  if (want) { await paintChoices(); setTimeout(() => void measureChoices().catch(() => {}), 150); }
}
async function paintChoices(): Promise<void> {
  await choicesEl?.setInnerHTML(options.map((text, i) => `<div data-vn-ch${i === chosen ? ' data-sel' : ''}>${esc(text)}</div>`).join(''));
}
async function measureChoices(): Promise<void> { if (choicesOn && choicesEl) choicesRect = await choicesEl.getBoundingClientRect(); }
/** One tap picks a choice (it lights, and says so); a second on it sends it as the user's message. */
async function choiceTap(p: HostPoint): Promise<void> {
  if (!choicesEl) return;
  const i = await rowAt(choicesEl, '[data-vn-ch]', p.clientY);
  if (i < 0 || !options[i]) return;
  if (chosen !== i) { chosen = i; await paintChoices(); await measureChoices(); return; }
  const send = risuHost()?.sendChat;
  if (typeof send !== 'function') throw new Error('이 Risu는 플러그인이 메시지를 보낼 수 없습니다 (sendChat 없음).');
  const text = options[i]!;
  choicesOn = false; chosen = -1; options = [];
  await host?.restyle();
  await send.call(risuHost(), text);
}

/** The 편집 list: the reply's kinds, then registered kinds this reply lacks (so they can be let go). */
async function paintPanel(): Promise<void> {
  if (!panel) return;
  rows = kinds.map(k => ({ sig: k.sig, label: k.label, count: k.count, text: k.text }));
  for (const sig of Object.keys(rules)) if (!rows.some(r => r.sig === sig)) rows.push({ sig, label: sig.replace(/^[a-z0-9]+/, '').replace(/^[.#]/, '').replace(/x-risu-/g, '') || sig, count: 0, text: '이 답장에는 없음' });
  const chip = (label: string, on: boolean) => `<i${on ? ' data-on' : ''}>${label}</i>`;
  await panel.setInnerHTML(`<h4>요소 편집</h4><small data-vn-hint>스티커는 끌어서 옮겨요. 선택지는 최신 답장의 마지막 줄에서 떠요.</small>${rows.map(row => {
    const r = rules[row.sig];
    const more = r?.role === 'sticker' ? chip('📌 항상', r.always) + chip('숨김', r.hidden) + chip(`크기 ${Math.round(r.scale * 100)}%`, false) : '';
    return `<div data-vn-el><b>${esc(row.label)}</b>${row.count > 1 ? `<small>×${row.count}</small>` : ''}<span>${esc(row.text)}</span><p>${chip('스티커', r?.role === 'sticker')}${chip('선택지', r?.role === 'choice')}${more}</p></div>`;
  }).join('') || '<small data-vn-hint>이 답장에는 고를 요소가 없어요. (Omni가 만든 것은 빼요)</small>'}`);
}
async function measureEditing(): Promise<void> {
  if (!editing) return;
  if (panel) panelRect = await panel.getBoundingClientRect();
  for (const s of stickers.values()) s.r = await s.el.getBoundingClientRect();
}
/** A tap on the 편집 list: the row by a binary search, then which of its few chips. */
async function panelTap(p: HostPoint): Promise<void> {
  if (!panel || !host) return;
  const at = await rowAt(panel, '[data-vn-el]', p.clientY), row = rows[at];
  if (!row) return;
  const chips = await unwrap(await panel.querySelectorAll(`[data-vn-el]:nth-of-type(${at + 1}) i`));
  let which = -1;
  for (let i = 0; i < chips.length; i++) { if (which < 0 && inside(p, await chips[i]!.getBoundingClientRect())) which = i; await release(chips[i]); }
  if (which < 0) return;
  const r = rules[row.sig], stickersNow = Object.values(rules).filter(x => x.role === 'sticker').length;
  if (which === 0) { if (r?.role === 'sticker') delete rules[row.sig]; else rules[row.sig] = { role: 'sticker', x: 4, y: Math.min(70, 12 + stickersNow * 14), scale: 1, hidden: false, always: false }; }
  else if (which === 1) { if (r?.role === 'choice') delete rules[row.sig]; else rules[row.sig] = { role: 'choice', x: 4, y: 12, scale: 1, hidden: false, always: false }; }
  else if (r?.role === 'sticker') {
    if (which === 2) r.always = !r.always;
    else if (which === 3) r.hidden = !r.hidden;
    else r.scale = r.scale > 0.9 ? 0.8 : r.scale > 0.7 ? 0.6 : 1;
  }
  await saveElementRules(bot, rules);
  await elementsForReply();
  await elementsAtEnd(host.atEnd());
  await host.restyle();
}

export async function toggleElements(): Promise<void> {
  showing = !showing;
  if (!showing) editing = false;
  await host?.restyle();
  await measureStickers();
}
export async function toggleEdit(): Promise<void> {
  editing = !editing;
  panelRect = null;
  if (editing) showing = true;
  // Rebuilt, the reply's choices wait for the end again: at the end now, they come straight back.
  await elementsForReply();
  await elementsAtEnd(host?.atEnd() ?? false);
  await host?.restyle();
  setTimeout(() => void (editing ? measureEditing() : measureStickers()).catch(() => {}), editing ? 380 : 120);
}

/**
 * Dragging a sticker in 편집: the press finds it by its measured rectangle, the move
 * is listened to only while it lasts (closed, it costs Risu nothing), and the drop
 * keeps the place as a share of the frame, so it holds on any screen.
 */
let drag: { sig: string; x0: number; y0: number; left: number; top: number; dx: number; dy: number; painted: string } | null = null;
let moveId: Promise<string> | null = null, moveTimer: ReturnType<typeof setTimeout> | undefined, dragUntil = 0;
function onMove(p: HostPoint): void {
  if (!drag || !Number.isFinite(p?.clientX)) return;
  drag.dx = p.clientX - drag.x0; drag.dy = p.clientY - drag.y0;
  if (moveTimer) return;
  moveTimer = setTimeout(() => { moveTimer = undefined; void paintDrag().catch(() => {}); }, 32);
}
async function paintDrag(): Promise<void> {
  const d = drag, s = d && stickers.get(d.sig), r = d && rules[d.sig];
  if (!d || !s || !r) return;
  const style = `left:${Math.round(d.left + d.dx)}px;top:${Math.round(d.top + d.dy)}px;transform:scale(${r.scale})`;
  if (style !== d.painted) { d.painted = style; await s.el.setStyleAttribute(style); }
}
async function endDrag(): Promise<void> {
  clearTimeout(moveTimer); moveTimer = undefined;
  const id = moveId; moveId = null;
  const doc = host?.doc();
  if (id && doc) { const resolved = await id.catch(() => ''); if (resolved) await quiet(doc.removeEventListener('pointermove', resolved)); }
}
/** In 편집 every press is 편집's (no swipe, no line completed); one on a sticker drags it. */
export function elementsDown(p: HostPoint, onControl: boolean): boolean {
  if (!editing) return false;
  if (onControl || !host || (panelRect && inside(p, panelRect))) return true;
  const frame = host.frame(), doc = host.doc();
  for (const [sig, s] of stickers) {
    if (!s.r || !inside(p, s.r) || !doc) continue;
    drag = { sig, x0: p.clientX, y0: p.clientY, left: s.r.left - frame.left, top: s.r.top - frame.top, dx: 0, dy: 0, painted: '' };
    moveId = doc.addEventListener('pointermove', (e: HostPoint) => onMove(e));
    break;
  }
  return true;
}
export function elementsUp(p: HostPoint): boolean {
  if (!editing) return false;
  const d = drag;
  drag = null;
  if (!d || !host) return true;
  if (Number.isFinite(p?.clientX)) { d.dx = p.clientX - d.x0; d.dy = p.clientY - d.y0; }
  const frame = host.frame(), r = rules[d.sig], s = stickers.get(d.sig), moved = Math.hypot(d.dx, d.dy) >= 4;
  // The click this release brings is no tap; the next one is.
  if (moved) dragUntil = Date.now() + 250;
  void (async () => {
    await endDrag();
    if (!r || !s || !moved) return;
    r.x = Math.min(96, Math.max(0, Math.round((d.left + d.dx) / Math.max(1, frame.width) * 1000) / 10));
    r.y = Math.min(96, Math.max(0, Math.round((d.top + d.dy) / Math.max(1, frame.height) * 1000) / 10));
    await s.el.setStyleAttribute(place(r));
    s.r = await s.el.getBoundingClientRect();
    await saveElementRules(bot, rules);
  })().catch(report('viewer.sticker'));
  return true;
}
/**
 * The viewer's taps, 요소's first: 편집 takes every tap but the buttons' (its list's
 * chips; the click a drag ends with is nothing), and choices take theirs.
 */
export function elementsClick(p: HostPoint, onControl: boolean): boolean {
  if (editing) {
    if (onControl) return false;
    if (Date.now() < dragUntil) { dragUntil = 0; return true; }
    if (panelRect && inside(p, panelRect)) void panelTap(p).catch(report('viewer.elements'));
    return true;
  }
  if (!onControl) for (const s of stickers.values()) if (s.r && inside(p, s.r)) {
    setTimeout(() => void measureStickers().catch(() => {}), 200);
    return true;
  }
  if (choicesOn && !onControl && choicesRect && inside(p, choicesRect)) {
    void choiceTap(p).catch(error => { report('viewer.choice')(error); const alert = risuHost()?.alertError; if (typeof alert === 'function') void Promise.resolve(alert.call(risuHost(), `[옴니 뷰어] ${String((error as Error)?.message || error)}`)).catch(() => {}); });
    return true;
  }
  return false;
}
