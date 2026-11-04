import { dbg } from '../core/debug';
import { risuHost } from '../core/host';
import { compactHash } from '../domain/tts/segment';
import { findElementKinds, type ElementKind } from '../domain/viewer/elements';
import { elementRules, saveElementRules, type ElementFrom, type ElementRule, type ElementRules } from '../storage/viewer-elements';
import { saveViewerPrefs, viewerPrefs } from '../storage/viewer-prefs';
import { liveCss, liveTargets, type LiveEntry } from './elements-live';
import { quiet, release, rowAt, unwrap } from './safe-dom';

/**
 * 옴니 뷰어's 요소: a bot's own elements (its status panel, its choice list) brought
 * onto the stage. Only kinds the reader registered in 편집 come: a sticker is the
 * chat's element cloned (no pixels, the bot's look kept) and placed where the reader
 * dragged it, shown with 요소 on, or always; a choice is offered at the end of the
 * newest reply, and choosing it twice sends it as the user's message.
 *
 * A kind is found in the reply on stage, or in the bot's message 1 or 2 after it (편집's tabs: a bot that sends its
 * status panel in a message of its own). With 접기 a sticker has a title bar: a tap folds it, a drag moves it.
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
  /** The bot's `n`th message after `index` (the reader's are passed over), or -1. */
  charAfter: (index: number, n: number) => number;
  /** The message is drawn behind the viewer (not folded away): only a drawn element can be shown live. */
  drawn: (index: number) => boolean;
  /** Something of the viewer's is over the stage (a panel, the picture big, 크게보기): no hole cut through it. */
  hideLive: () => boolean;
  /** A word over the stage for `ms`. */
  say: (text: string, ms: number) => void;
  atEnd: () => boolean;
  restyle: () => Promise<void>;
}
interface HostPoint { clientX: number; clientY: number }
/** live (작동): the chat's element, lifted to the window; the frame on the stage holds only its bar. */
interface Live { index: number; selector: string; targets: string[]; w: number; rects: Array<DOMRect | null> }
interface Sticker { key: string; el: SafeElement; r: DOMRect | null; live?: Live }
interface Row { sig: string; label: string; count: number; text: string }
const TABS = ['이 답장', '다음 메시지 1', '다음 메시지 2'] as const;
/** A sticker's title bar, as tall as the stage's style draws it (before its scale). */
const BAR_H = 26;

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const keyOf = (sig: string) => compactHash(sig).slice(0, 10);
const inside = (p: HostPoint, r: { left: number; top: number; width: number; height: number }) => p.clientX >= r.left && p.clientX <= r.left + r.width && p.clientY >= r.top && p.clientY <= r.top + r.height;
const report = (what: string) => (error: unknown) => dbg(what, { message: String(error) }, 'warn');
const MAX_OPTIONS = 8;

let host: ElementsHost | null = null, layer: SafeElement | null = null, choicesEl: SafeElement | null = null, panel: SafeElement | null = null;
let showing = false, editing = false, bot = '', rules: ElementRules = {}, rows: Row[] = [];
/** The kinds each message holds (the reply, the bot's next one, the one after), read once per reply when asked. */
const kindsAt = new Map<ElementFrom, ElementKind[]>();
const stickers = new Map<string, Sticker>();
let options: string[] = [], choicesOn = false, chosen = -1, choicesRect: DOMRect | null = null, panelRect: DOMRect | null = null;
/** 편집's tab, and where its row of tabs is (the tabs share it evenly: no rect of each). */
let tab: ElementFrom = 0, tabsRect: DOMRect | null = null;
/** 작동's sheet (made the first time something is lifted), what it says now, and whether Risu edits on a click. */
let liveStyle: SafeElement | null = null, liveShown = '', editWarned = false;
/** The sheet's writes, one after another, and which viewer they are for (one asked before a close is not done after). */
let liveWrites: Promise<void> = Promise.resolve(), liveEpoch = 0;

export async function elementsOpen(h: ElementsHost): Promise<void> {
  // 요소 stays as it was left, as AUTO and VOICE do (any bot, any chat); 편집 always starts closed.
  host = h; showing = viewerPrefs().elements; editing = false; rows = []; options = []; choicesOn = false; chosen = -1; choicesRect = null; panelRect = null;
  tab = 0; tabsRect = null; kindsAt.clear(); liveShown = ''; editWarned = false;
  stickers.clear();
  const root = h.root();
  if (root) [layer, choicesEl, panel] = await Promise.all(['[data-vn-stickers]', '[data-vn-choices]', '[data-vn-edit]'].map(s => root.querySelector(s)));
}
export async function elementsClose(): Promise<void> {
  // A write asked for before the close is dropped; one under way finishes first, so the sheet it made comes down too.
  liveEpoch++;
  await liveWrites;
  await endDrag();
  await arm(null);
  for (const s of stickers.values()) await release(s.el);
  stickers.clear();
  // The viewer takes its sheets down with it; this one again, in case it was made after the viewer swept them.
  if (liveStyle) await quiet(liveStyle.remove());
  for (const el of [layer, choicesEl, panel, liveStyle]) await release(el);
  layer = choicesEl = panel = liveStyle = null; host = null; showing = editing = false; liveShown = '';
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
 * fold changes its size. A live one is its bar and its windows (where each was lifted to, read where it ended up).
 */
async function measureStickers(): Promise<void> {
  const doc = host?.doc();
  for (const [sig, s] of stickers) {
    if (!shown(sig)) { s.r = null; continue; }
    const frame = await s.el.getBoundingClientRect();
    if (!s.live || !doc) { s.r = frame; continue; }
    s.live.rects = liveActive(sig) ? await Promise.all(s.live.targets.map(async target => {
      const node = await doc.querySelector(target);
      try { return node ? await node.getBoundingClientRect() : null; } finally { await release(node); }
    })) : [];
    s.r = union([frame, ...s.live.rects]);
  }
}
function union(boxes: Array<DOMRect | null>): DOMRect | null {
  const real = boxes.filter((b): b is DOMRect => !!b && b.width > 0 && b.height > 0);
  if (!real.length) return null;
  const left = Math.min(...real.map(b => b.left)), top = Math.min(...real.map(b => b.top));
  const right = Math.max(...real.map(b => b.left + b.width)), bottom = Math.max(...real.map(b => b.top + b.height));
  return { left, top, width: right - left, height: bottom - top, right, bottom, x: left, y: top } as DOMRect;
}

/** Lifted now: 작동, on show, open, out of 편집 (there it is a copy, to be seen and placed), nothing over the stage. */
function liveActive(sig: string): boolean {
  const r = rules[sig], s = stickers.get(sig);
  return !!host && !!r && !!s?.live && !editing && !host.hideLive() && shown(sig) && !(r.fold && r.folded);
}
/** Where each live window goes: the rule's place in the frame (under its bar), its width as the chat drew it. */
function liveEntries(): LiveEntry[] {
  if (!host) return [];
  const frame = host.frame(), out: LiveEntry[] = [];
  for (const [sig, s] of stickers) {
    const r = rules[sig], live = s.live;
    if (!r || !live || !liveActive(sig)) continue;
    // Dragged by its bar, it follows (and its holes with it) before it is read again where it was dropped.
    const dx = drag?.sig === sig ? drag.dx : 0, dy = drag?.sig === sig ? drag.dy : 0;
    out.push({
      index: live.index, selector: live.selector, targets: live.targets, scale: r.scale,
      left: frame.left + frame.width * r.x / 100 + dx, top: frame.top + frame.height * r.y / 100 + (r.fold ? BAR_H * r.scale : 0) + dy,
      width: Math.min(live.w, Math.max(60, (frame.width - 16) / r.scale)), maxHeight: frame.height * 0.6 / r.scale,
      rects: live.rects.map(b => b && (dx || dy) ? { left: b.left + dx, top: b.top + dy, width: b.width, height: b.height } : b),
    });
  }
  return out;
}
/**
 * One write at a time: the stage's restyle and a relay often ask together, and two at once would each find no sheet
 * and make one, the first left empty and never taken down.
 */
function writeLive(css: string): Promise<void> {
  const epoch = liveEpoch;
  const run = liveWrites.then(() => epoch === liveEpoch ? writeLiveNow(css) : undefined);
  liveWrites = run.catch(() => {});
  return run;
}
async function writeLiveNow(css: string): Promise<void> {
  const doc = host?.doc();
  if (css === liveShown || !doc) return;
  if (!liveStyle) {
    if (!css) return;
    const body = await doc.querySelector('body');
    if (!body) return;
    try {
      const style = await doc.createElement('style');
      await style.setAttribute('x-omni-vn-style', 'live');
      await body.appendChild(style);
      liveStyle = style;
    } finally { await release(body); }
  }
  liveShown = css;
  await liveStyle.setTextContent(css);
}
/** The live sheet as things stand, no read (the stage restyled: a panel opened, the picture went big). */
export async function elementsSyncLive(): Promise<void> {
  if (host) await writeLive(liveCss(liveEntries(), host.frame()));
}
/** The live sheet written, each window read where it ended up, the holes cut there (the frame moved, a tap, a drop). */
export async function elementsRelayLive(): Promise<void> {
  if (!host) return;
  await writeLive(liveCss(liveEntries(), host.frame()));
  await measureStickers();
  await writeLive(liveCss(liveEntries(), host.frame()));
}
/** Risu's 클릭해서 편집 starts an edit on a click in a message, a live window's too: said once, the first time. */
function warnClickToEdit(): void {
  if (editWarned) return;
  editWarned = true;
  void (async () => {
    const db = await risuHost()?.getDatabase?.(['clickToEdit']).catch(() => null) as { clickToEdit?: unknown } | null | undefined;
    if (db?.clickToEdit === true) host?.say('Risu의 "클릭해서 편집"이 켜져 있어요. 작동 요소를 누르면 메시지 편집이 시작될 수 있어요.', 5000);
  })().catch(() => {});
}
/** The part of the scene's one style text that is 요소's: which stickers show, the panel, the choices. */
export function elementsCss(): string {
  const out: string[] = [];
  if (showing || editing) out.push('[x-omni-vn] [data-vn-act="elems"]{color:#1a1408;background:var(--gold)}[x-omni-vn] [data-vn-act="eledit"]{visibility:visible}');
  // In 편집 a press drags: a <details> under it must not fold as well.
  // Open, the panel covers the tab: ✎ steps out to the panel's left edge, still a tap away.
  if (editing) out.push('[x-omni-vn] [data-vn-edit]{translate:0 0}[x-omni-vn] [data-vn-act="eledit"]{right:calc(min(84%,330px) + 8px);color:#1a1408;background:var(--gold)}[x-omni-vn] [x-vn-st] summary{pointer-events:none}');
  for (const [sig, s] of stickers) {
    const r = rules[sig];
    if (!r) continue;
    if (editing) out.push(`[x-omni-vn] [x-vn-st="${s.key}"]{display:block;outline:2px dashed var(--gold);outline-offset:4px${r.hidden ? ';opacity:.35' : ''}}`);
    else if (!r.hidden && (showing || r.always)) out.push(`[x-omni-vn] [x-vn-st="${s.key}"]{display:block}`);
    // Folded, only its bar stays (in 편집 it is always open: what is placed is seen).
    if (r.fold && r.folded && !editing) out.push(`[x-omni-vn] [x-vn-st="${s.key}"] [x-vn-st-body]{display:none}[x-omni-vn] [x-vn-st="${s.key}"] [x-vn-st-bar]{border-radius:8px;border-bottom-width:1px}[x-omni-vn] [x-vn-st="${s.key}"] [x-vn-st-bar]::after{content:"▸"}`);
  }
  if (choicesOn) out.push('[x-omni-vn] [data-vn-choices]{display:flex}[x-omni-vn] [data-vn-end]{display:none}');
  return out.join('\n');
}

/** The bot's elements in this reply, read once through the bridge and parsed here. */
async function readKinds(doc: SafeDocument, index: number): Promise<ElementKind[]> {
  if (typeof DOMParser === 'undefined' || index < 0) return [];
  const body = await doc.querySelector(`.risu-chat[data-chat-index="${index}"] .chattext`);
  if (!body) return [];
  let html = '';
  try { html = String(await body.getInnerHTML() ?? ''); } finally { await release(body); }
  const parsed = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html').body.firstElementChild;
  return parsed ? findElementKinds(parsed) : [];
}
const place = (r: ElementRule) => `left:${r.x}%;top:${r.y}%;transform:scale(${r.scale})`;
/** The message a kind is found in: the reply on stage, or the bot's message 1 or 2 after it (-1: there is none). */
function sourceIndex(from: ElementFrom): number {
  const reply = host?.reply();
  if (!host || !reply) return -1;
  return from === 0 ? reply.index : host.charAfter(reply.index, from);
}
async function kindsOf(doc: SafeDocument, from: ElementFrom): Promise<ElementKind[]> {
  let found = kindsAt.get(from);
  if (!found) { found = await readKinds(doc, sourceIndex(from)); kindsAt.set(from, found); }
  return found;
}
/** A sticker's title bar (접기): its name, tapped to fold, dragged to move. */
async function putBar(doc: SafeDocument, wrap: SafeElement, label: string): Promise<void> {
  const bar = await doc.createElement('div');
  await bar.setAttribute('x-vn-st-bar', '1');
  await bar.setTextContent(label);
  await wrap.appendChild(bar); await release(bar);
}
/**
 * 작동: the frame on the stage holds only the bar (with 접기); the element itself is lifted to under it (writeLive).
 * Its width is read first, as the chat draws it (nothing lifted at that moment): the window keeps it.
 */
async function putLive(doc: SafeDocument, index: number, kind: ElementKind, rule: ElementRule): Promise<void> {
  if (!layer) return;
  const targets = liveTargets(index, kind.selector, kind.count), first = await doc.querySelector(targets[0]!);
  if (!first) return;
  let w = 0;
  try { w = (await first.getBoundingClientRect()).width; } finally { await release(first); }
  const wrap = await doc.createElement('div'), key = keyOf(kind.sig);
  await wrap.setAttribute('x-vn-st', key);
  await wrap.setStyleAttribute(place(rule));
  if (rule.fold) await putBar(doc, wrap, kind.label);
  await layer.appendChild(wrap);
  stickers.set(kind.sig, { key, el: wrap, r: null, live: { index, selector: kind.selector, targets, w: Math.max(60, w), rects: [] } });
}
/**
 * A registered kind's elements, cloned into one sticker where the reader put it: its body a .chattext (the bot's
 * chat CSS reaches what sits in one, so the clone looks as it does in the chat), its bar over it with 접기.
 */
async function putSticker(doc: SafeDocument, index: number, kind: ElementKind, rule: ElementRule): Promise<void> {
  if (!layer) return;
  const nodes = await unwrap(await doc.querySelectorAll(`.risu-chat[data-chat-index="${index}"] .chattext ${kind.selector}`));
  try {
    if (!nodes.length) return;
    const wrap = await doc.createElement('div'), body = await doc.createElement('div'), key = keyOf(kind.sig);
    await wrap.setAttribute('x-vn-st', key);
    await wrap.setStyleAttribute(place(rule));
    if (rule.fold) await putBar(doc, wrap, kind.label);
    await body.setAttribute('x-vn-st-body', '1');
    await quiet(body.setClassName('chattext'));
    for (const node of nodes.slice(0, 6)) { const copy = await node.cloneNode(true); await body.appendChild(copy); await release(copy); }
    await wrap.appendChild(body); await release(body);
    await layer.appendChild(wrap);
    stickers.set(kind.sig, { key, el: wrap, r: null });
  } finally { for (const node of nodes) await release(node); }
}
/** After a reply loads: its stickers put up and its choices gathered (or nothing, with nothing registered). */
export async function elementsForReply(): Promise<void> {
  for (const s of stickers.values()) { await quiet(s.el.remove()); await release(s.el); }
  stickers.clear(); kindsAt.clear(); options = []; choicesOn = false; chosen = -1; choicesRect = null;
  await arm(null);
  // Whatever was lifted goes back to its message first: a live one's width is read as the chat draws it.
  await writeLive('');
  const h = host, doc = h?.doc(), reply = h?.reply();
  if (h && doc && reply) {
    if (reply.bot !== bot) { bot = reply.bot; rules = await elementRules(bot); }
    if (editing || Object.keys(rules).length) {
      if (editing) await kindsOf(doc, tab);
      for (const [sig, rule] of Object.entries(rules)) {
        const kind = (await kindsOf(doc, rule.from)).find(k => k.sig === sig);
        if (!kind) continue;
        if (rule.role !== 'sticker') { options.push(...kind.options); continue; }
        // 작동 needs its message drawn behind the viewer (the bot's newest three): an older one's comes as a copy,
        // as it does in 편집, where what is placed must be seen.
        const index = sourceIndex(rule.from);
        if (rule.live && !editing && h.drawn(index)) await putLive(doc, index, kind, rule);
        else await putSticker(doc, index, kind, rule);
      }
      options = options.slice(0, MAX_OPTIONS);
    }
  }
  if (editing) { await paintPanel(); setTimeout(() => void measureEditing().catch(() => {}), 120); }
  else if (stickers.size) {
    // What shows them is the stage's style text: the line it was written for may already be out (a reply opened
    // where the reader left it, its stickers put up after), and nothing writes it again until the next line.
    await host?.restyle();
    if ([...stickers.values()].some(s => s.live)) { await elementsRelayLive(); warnClickToEdit(); }
    setTimeout(() => void measureStickers().catch(() => {}), 120);
  }
}

/**
 * The end of the newest reply: its registered choices come up over the box (the end
 * cue gives way to them). Painted once when they come; nothing while they stay.
 */
export async function elementsAtEnd(end: boolean): Promise<void> {
  const want = end && options.length > 0;
  if (want === choicesOn) return;
  choicesOn = want; chosen = -1; choicesRect = null;
  if (!want) await arm(null);
  if (want) { await paintChoices(); setTimeout(() => void measureChoices().catch(() => {}), 150); }
}
async function paintChoices(): Promise<void> {
  await choicesEl?.setInnerHTML(options.map((text, i) => `<div data-vn-ch${i === chosen ? ' data-sel' : ''}>${esc(text)}</div>`).join(''));
}
async function measureChoices(): Promise<void> { if (choicesOn && choicesEl) choicesRect = await choicesEl.getBoundingClientRect(); }
/**
 * One tap picks a choice (it lights, and says so); a second on it sends it as the user's message. Picked, it is
 * armed: what the reader types in Risu's own box goes with it, the choice first. That is Risu's input handler,
 * there only while a choice is armed (a handler costs every send a call into the plugin).
 */
async function choiceTap(p: HostPoint): Promise<void> {
  if (!choicesEl) return;
  const i = await rowAt(choicesEl, '[data-vn-ch]', p.clientY);
  if (i < 0 || !options[i]) return;
  if (chosen !== i) { chosen = i; await paintChoices(); await measureChoices(); await arm(options[i]!); return; }
  const send = risuHost()?.sendChat;
  if (typeof send !== 'function') throw new Error('이 Risu는 플러그인이 메시지를 보낼 수 없습니다 (sendChat 없음).');
  const text = options[i]!;
  // Sent on its own: never a second time by the handler.
  await arm(null);
  choicesOn = false; chosen = -1; options = [];
  await host?.restyle();
  await send.call(risuHost(), text);
}
/** A choice picked and not sent: armed. */
export const choiceArmed = (): boolean => choicesOn && chosen >= 0;
/** Let go: the light off, and what the reader types goes alone again. The list stays up. */
export async function disarmChoice(): Promise<void> {
  if (!choiceArmed()) return;
  chosen = -1;
  await arm(null);
  await paintChoices();
  await measureChoices();
}
let armed: ((typed: string) => string) | null = null;
async function arm(choice: string | null): Promise<void> {
  const risu = risuHost();
  if (armed) { const was = armed; armed = null; await quiet(risu?.removeRisuScriptHandler?.('input', was)); }
  if (!choice || typeof risu?.addRisuScriptHandler !== 'function') return;
  const withChoice = (typed: string): string => {
    // Once: the choice went with this message, and the list is done.
    if (armed === withChoice) { void arm(null).catch(() => {}); choicesOn = false; chosen = -1; options = []; void host?.restyle().catch(() => {}); }
    const own = String(typed ?? '').trim();
    return own && own !== choice ? `${choice}\n${own}` : choice;
  };
  armed = withChoice;
  await risu.addRisuScriptHandler('input', withChoice);
}

/**
 * The 편집 list: the tabs (the reply, the bot's next message, the one after), then the kinds of the tab's message,
 * then kinds registered from that tab which this message lacks (so they can be let go). The tabs are a <nav>, not a
 * <div>: a row's chips are found by its place among the divs.
 */
async function paintPanel(): Promise<void> {
  if (!panel) return;
  const here = kindsAt.get(tab) ?? [], none = sourceIndex(tab) < 0;
  rows = here.map(k => ({ sig: k.sig, label: k.label, count: k.count, text: k.text }));
  for (const [sig, rule] of Object.entries(rules)) if (rule.from === tab && !rows.some(r => r.sig === sig)) rows.push({ sig, label: sig.replace(/^[a-z0-9]+/, '').replace(/^[.#]/, '').replace(/x-risu-/g, '') || sig, count: 0, text: '이 메시지에는 없음' });
  const chip = (label: string, on: boolean) => `<i${on ? ' data-on' : ''}>${label}</i>`;
  const tabs = `<nav data-vn-tabs>${TABS.map((name, i) => `<i${i === tab ? ' data-on' : ''}>${name}</i>`).join('')}</nav>`;
  const empty = none ? '이 답장 뒤에 봇 메시지가 없어요.' : '이 메시지에는 고를 요소가 없어요. (Omni가 만든 것은 빼요)';
  await panel.setInnerHTML(`<h4>요소 편집</h4>${tabs}<small data-vn-hint>스티커는 끌어서 옮겨요. 접기를 켜면 제목줄로 접고 옮겨요. 선택지는 최신 답장의 마지막 줄에서 떠요.</small>${rows.map(row => {
    const r = rules[row.sig];
    const more = r?.role === 'sticker' ? chip('📌 항상', r.always) + chip('숨김', r.hidden) + chip(`크기 ${Math.round(r.scale * 100)}%`, false) + chip('접기', r.fold) + chip('작동', r.live) : '';
    return `<div data-vn-el><b>${esc(row.label)}</b>${row.count > 1 ? `<small>×${row.count}</small>` : ''}<span>${esc(row.text)}</span><p>${chip('스티커', r?.role === 'sticker')}${chip('선택지', r?.role === 'choice')}${more}</p></div>`;
  }).join('') || `<small data-vn-hint>${empty}</small>`}`);
}
async function measureEditing(): Promise<void> {
  if (!editing) return;
  if (panel) {
    const tabsEl = await panel.querySelector('[data-vn-tabs]');
    try { [panelRect, tabsRect] = await Promise.all([panel.getBoundingClientRect(), tabsEl ? tabsEl.getBoundingClientRect() : null]); } finally { await release(tabsEl); }
  }
  for (const s of stickers.values()) s.r = await s.el.getBoundingClientRect();
}
/** Another tab: the kinds of its message (read once per reply), the list drawn again. */
async function openTab(next: ElementFrom): Promise<void> {
  const doc = host?.doc();
  if (!doc || next === tab) return;
  tab = next;
  await kindsOf(doc, tab);
  await paintPanel();
  await measureEditing();
}
/** A tap on the 편집 list: a tab by where it falls in their row, else the row by a binary search, then its chip. */
async function panelTap(p: HostPoint): Promise<void> {
  if (!panel || !host) return;
  if (tabsRect && inside(p, tabsRect)) {
    const i = Math.floor((p.clientX - tabsRect.left) / Math.max(1, tabsRect.width / TABS.length));
    await openTab(Math.min(TABS.length - 1, Math.max(0, i)) as ElementFrom);
    return;
  }
  const at = await rowAt(panel, '[data-vn-el]', p.clientY), row = rows[at];
  if (!row) return;
  const chips = await unwrap(await panel.querySelectorAll(`[data-vn-el]:nth-of-type(${at + 1}) i`));
  let which = -1;
  for (let i = 0; i < chips.length; i++) { if (which < 0 && inside(p, await chips[i]!.getBoundingClientRect())) which = i; await release(chips[i]); }
  if (which < 0) return;
  const r = rules[row.sig], stickersNow = Object.values(rules).filter(x => x.role === 'sticker').length;
  const fresh = { x: 4, scale: 1, hidden: false, always: false, from: tab, fold: false, folded: false, live: false };
  if (which === 0) { if (r?.role === 'sticker') delete rules[row.sig]; else rules[row.sig] = { ...fresh, role: 'sticker', y: Math.min(70, 12 + stickersNow * 14) }; }
  else if (which === 1) { if (r?.role === 'choice') delete rules[row.sig]; else rules[row.sig] = { ...fresh, role: 'choice', y: 12 }; }
  else if (r?.role === 'sticker') {
    if (which === 2) r.always = !r.always;
    else if (which === 3) r.hidden = !r.hidden;
    else if (which === 4) r.scale = r.scale > 0.9 ? 0.8 : r.scale > 0.7 ? 0.6 : 1;
    else if (which === 5) { r.fold = !r.fold; r.folded = false; }
    else if (which === 6) r.live = !r.live;
  }
  await saveElementRules(bot, rules);
  await elementsForReply();
  await elementsAtEnd(host.atEnd());
  await host.restyle();
}

/** A tap on a title bar: folded or open again, kept for the bot, its size read again. */
async function toggleFolded(sig: string): Promise<void> {
  const r = rules[sig];
  if (!r?.fold) return;
  r.folded = !r.folded;
  await host?.restyle();
  await elementsRelayLive();
  await saveElementRules(bot, rules);
}
export async function toggleElements(): Promise<void> {
  showing = !showing;
  void saveViewerPrefs({ elements: showing }).catch(() => {});
  if (!showing) editing = false;
  await host?.restyle();
  await elementsRelayLive();
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
  if (style !== d.painted) { d.painted = style; await s.el.setStyleAttribute(style); if (s.live) await elementsSyncLive(); }
}
async function endDrag(): Promise<void> {
  clearTimeout(moveTimer); moveTimer = undefined;
  const id = moveId; moveId = null;
  const doc = host?.doc();
  if (id && doc) { const resolved = await id.catch(() => ''); if (resolved) await quiet(doc.removeEventListener('pointermove', resolved)); }
}
/** The sticker whose title bar is under the point (with 접기 on; as tall as its scale makes it). */
function barAt(p: HostPoint): string {
  for (const [sig, s] of stickers) {
    const r = rules[sig];
    if (r?.fold && s.r && inside(p, s.r) && p.clientY <= s.r.top + BAR_H * r.scale) return sig;
  }
  return '';
}
function startDrag(sig: string, p: HostPoint): void {
  const s = stickers.get(sig), doc = host?.doc();
  if (!s?.r || !host || !doc) return;
  const frame = host.frame();
  drag = { sig, x0: p.clientX, y0: p.clientY, left: s.r.left - frame.left, top: s.r.top - frame.top, dx: 0, dy: 0, painted: '' };
  moveId = doc.addEventListener('pointermove', (e: HostPoint) => onMove(e));
}
/**
 * In 편집 every press is 편집's (no swipe, no line completed); one on a sticker drags it. Outside it, a press on a
 * sticker's title bar drags it (and taps fold it, elementsClick); any other press is the stage's.
 */
export function elementsDown(p: HostPoint, onControl: boolean): boolean {
  if (!editing) {
    const sig = onControl ? '' : barAt(p);
    if (!sig) return false;
    startDrag(sig, p);
    return true;
  }
  if (onControl || !host || (panelRect && inside(p, panelRect))) return true;
  for (const [sig, s] of stickers) {
    if (!s.r || !inside(p, s.r)) continue;
    startDrag(sig, p);
    break;
  }
  return true;
}
export function elementsUp(p: HostPoint): boolean {
  if (!editing && !drag) return false;
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
    // Read where it was dropped (a live one: lifted there, its holes cut again).
    await elementsRelayLive();
    await saveElementRules(bot, rules);
  })().catch(report('viewer.sticker'));
  return true;
}
/**
 * The viewer's taps, 요소's first: 편집 takes every tap but the buttons' (its list's
 * chips; the click a drag ends with is nothing), and choices take theirs.
 */
export function elementsClick(p: HostPoint, onControl: boolean): boolean {
  if (!onControl && Date.now() < dragUntil) { dragUntil = 0; return true; }
  if (editing) {
    if (onControl) return false;
    if (panelRect && inside(p, panelRect)) void panelTap(p).catch(report('viewer.elements'));
    return true;
  }
  const bar = onControl ? '' : barAt(p);
  if (bar) { void toggleFolded(bar).catch(report('viewer.sticker')); return true; }
  if (!onControl) for (const s of stickers.values()) if (s.r && inside(p, s.r)) {
    // The tap was the sticker's (a live one's, Risu's own): its size may change with it, a button's message drawn
    // anew a moment later too, so it is read again then.
    setTimeout(() => void elementsRelayLive().catch(() => {}), 200);
    if (s.live) setTimeout(() => void elementsRelayLive().catch(() => {}), 900);
    return true;
  }
  if (choicesOn && !onControl && choicesRect && inside(p, choicesRect)) {
    void choiceTap(p).catch(error => { report('viewer.choice')(error); const alert = risuHost()?.alertError; if (typeof alert === 'function') void Promise.resolve(alert.call(risuHost(), `[옴니 뷰어] ${String((error as Error)?.message || error)}`)).catch(() => {}); });
    return true;
  }
  return false;
}
