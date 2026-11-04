import { dbg } from '../core/debug';
import { risuHost } from '../core/host';
import type { ElementRule } from '../storage/viewer-elements';
import { liveCss, type Box, type LiveEntry } from './elements-live';
import { quiet, release, unwrap } from './safe-dom';

/**
 * 작동's popup: a tap on a tile shows the kind's element in the middle of 옴니 뷰어 (its frame, not the window), the
 * stage dimmed around it. In a message drawn behind the viewer (the chat's newest six) it is the chat's own element,
 * where Risu drew it: the chat behind is scrolled until it stands in the middle, and a hole is cut in the viewer
 * where it is (elements-live.ts), so its buttons are Risu's. In an older message it is a copy. elements.ts tells the
 * taps: in it, the element's; anywhere else, a fold.
 *
 * Optimistic: the tap's first write dims the stage and turns a spinner in the middle; the element shows through its
 * hole once it is scrolled there and read where it is. The spinner sits in the frame, which the hole cuts away.
 */
export interface PopHost {
  doc: () => SafeDocument | null;
  frame: () => Box;
  /** The message is drawn behind the viewer (not folded away): only there is the element the chat's own. */
  drawn: (index: number) => boolean;
  /** Something of the viewer's is over the stage (a panel, the picture big, 크게보기): the popup waits under it. */
  hideLive: () => boolean;
  /** The element named so scrolled to the middle of the chat behind the viewer (Risu's page put back, if pushed). */
  centre: (target: string) => Promise<void>;
  say: (text: string, ms: number) => void;
  restyle: () => Promise<void>;
}
/** A 작동 tile's element: the message it is in, its selector there, and one selector per window it holds. */
export interface PopTile { index: number; selector: string; targets: string[] }
interface HostPoint { clientX: number; clientY: number }

let host: PopHost | null = null, frameEl: SafeElement | null = null;
/** What is open (its signature: '' none), as the chat's own or a copy, waiting for its size meanwhile. */
let sig = '', mode: '' | 'wait' | 'live' | 'copy' = '', rule: ElementRule | null = null, tile: PopTile | null = null;
/** Each opening and each close counts: a read that comes back after another tap does nothing. */
let turn = 0;
/**
 * How tall the chat's bar under the viewer is (left out of the middle), where each window is, all of them together,
 * and the frame's style.
 */
let below = 0, rects: Array<Box | null> = [], rect: Box | null = null, framed = '';
/** The sheet that lifts it (made the first time), what it says, its writes one at a time, and which viewer they are for. */
let sheet: SafeElement | null = null, sheetText = '', writes: Promise<void> = Promise.resolve(), epoch = 0, warned = false;
let later: Array<ReturnType<typeof setTimeout>> = [];
const report = (what: string) => (error: unknown) => dbg(what, { message: String(error) }, 'warn');
const inside = (p: HostPoint, r: Box) => p.clientX >= r.left && p.clientX <= r.left + r.width && p.clientY >= r.top && p.clientY <= r.top + r.height;
const round = (n: number) => Math.round(n * 10) / 10;
const SPINNER = '<b data-vn-spin></b>';

export function popAttach(h: PopHost, el: SafeElement | null): void {
  host = h; frameEl = el; sig = ''; mode = ''; rule = null; tile = null; rects = []; rect = null; framed = ''; sheetText = ''; warned = false; below = 0;
}
export async function popDetach(): Promise<void> {
  // A write asked for before the close is dropped; one under way finishes first, so the sheet it made comes down too.
  epoch++; turn++;
  for (const t of later) clearTimeout(t);
  later = [];
  await writes;
  if (sheet) await quiet(sheet.remove());
  for (const el of [sheet, frameEl]) await release(el);
  sheet = frameEl = null; host = null; sig = ''; mode = ''; rule = null; tile = null; sheetText = '';
}
export const popOpenSig = (): string => sig;
/** Open and seen (nothing of the viewer's over the stage): its frame shows, a tap in it is its own. */
export const popSeen = (): boolean => !!sig && !!host && !host.hideLive();
export const popAt = (p: HostPoint): boolean => popSeen() && !!rect && inside(p, rect);
/** The part of the stage's style text that is the popup's: its frame (the dim, the spinner, the outline). */
export const popCss = (): string => popSeen() ? '[x-omni-vn] [data-vn-pop]{display:block}' : '';

/** A tile tapped: the stage dims at once, then the element comes (the chat's own where it is drawn, else a copy). */
export async function popOpen(nextSig: string, nextTile: PopTile, nextRule: ElementRule): Promise<void> {
  const h = host, doc = h?.doc();
  if (!h || !doc) return;
  if (sig) await popClose(false);
  sig = nextSig; tile = nextTile; rule = nextRule; mode = 'wait'; rects = []; rect = null;
  const mine = ++turn;
  await h.restyle();
  // What tells is its size: a message folded away behind the viewer has none (and comes as a copy). drawn() only
  // spares that read for the messages the fold is known to hide.
  if (h.drawn(nextTile.index)) {
    // Drawn, and how tall the chat's bar is under the viewer (the chat screen's foot against the frame's).
    const [first, screen] = await Promise.all([doc.querySelector(nextTile.targets[0]!), doc.querySelector('.default-chat-screen')]);
    let box: Box | null = null, chat: Box | null = null;
    try { [box, chat] = await Promise.all([first ? first.getBoundingClientRect() : null, screen ? screen.getBoundingClientRect() : null]); } finally { await release(first); await release(screen); }
    if (mine !== turn) return;
    if (box && box.width > 0 && box.height > 0) {
      const f = h.frame();
      below = chat ? Math.max(0, chat.top + chat.height - (f.top + f.height)) : 0;
      mode = 'live';
      // The room and the margin first (no hole yet), then the scroll into the middle, then the hole where it is.
      await popSync();
      await h.centre(nextTile.targets[0]!);
      if (mine !== turn) return;
      await popRelay();
      warnClickToEdit();
      return;
    }
  }
  mode = 'copy';
  await fillCopy(doc, mine);
}
/** Folded: the frame goes and the element is back in its message at once; what the frame held is cleared after. */
export async function popClose(restyle = true): Promise<void> {
  if (!sig) return;
  const wasCopy = mode === 'copy';
  turn++; sig = ''; mode = ''; rule = null; tile = null; rects = []; rect = null;
  for (const t of later) clearTimeout(t);
  later = [];
  await Promise.all([restyle ? host?.restyle() : undefined, writeSheet('')]);
  if (!frameEl) return;
  if (framed) { framed = ''; await frameEl.setStyleAttribute(''); }
  if (wasCopy) { await frameEl.setAttribute('x-vn-pop', ''); await frameEl.setInnerHTML(SPINNER); }
}
/** A tap in it was its own: its size may change (a <details>), a button's message is drawn anew a moment later. */
export function popTapped(): void {
  if (mode !== 'live') return;
  for (const ms of [200, 900]) later.push(setTimeout(() => void popRelay().catch(report('viewer.pop')), ms));
}

/** The element as the sheet has it: its windows, its 크기, the bar left out of the middle, its holes. */
function entry(): LiveEntry | null {
  if (!host || !tile || !rule || mode !== 'live' || !popSeen()) return null;
  return { targets: tile.targets, scale: rule.scale, below, rects };
}
function union(boxes: Array<Box | null>): Box | null {
  const real = boxes.filter((b): b is Box => !!b && b.width > 0 && b.height > 0);
  if (!real.length) return null;
  const left = Math.min(...real.map(b => b.left)), top = Math.min(...real.map(b => b.top));
  return { left, top, width: Math.max(...real.map(b => b.left + b.width)) - left, height: Math.max(...real.map(b => b.top + b.height)) - top };
}
/** The frame where the windows are: cut away by their holes, its outline and the dim around them left. */
async function placeFrame(): Promise<void> {
  const f = host?.frame();
  rect = union(rects);
  if (!frameEl || !f || !rect) return;
  const style = `left:${round(rect.left - f.left)}px;top:${round(rect.top - f.top)}px;width:${round(rect.width)}px;height:${round(rect.height)}px;transform:none`;
  if (style !== framed) { framed = style; await frameEl.setStyleAttribute(style); }
}
/** The sheet as things stand, no read (the stage restyled: a panel opened over it, the picture went big). */
export async function popSync(): Promise<void> {
  const e = entry(), f = host?.frame();
  await writeSheet(e && f ? liveCss([e], f) : '');
}
/** The sheet written, each window read where it went, the holes and the frame set there (it opened, the frame moved, a tap). */
export async function popRelay(): Promise<void> {
  await popSync();
  // A copy is centred by the style text: where it is now is read (the frame moved), for the taps that are its own.
  if (mode === 'copy' && frameEl) {
    const mine = turn, now = await frameEl.getBoundingClientRect();
    if (mine === turn) rect = now;
    return;
  }
  const doc = host?.doc(), t = tile, mine = turn;
  if (!doc || !t || !entry()) return;
  const read = await Promise.all(t.targets.map(async target => {
    const node = await doc.querySelector(target);
    try { return node ? await node.getBoundingClientRect() : null; } finally { await release(node); }
  }));
  if (mine !== turn || mode !== 'live') return;
  rects = read.map(b => b && b.width > 0 && b.height > 0 ? { left: b.left, top: b.top, width: b.width, height: b.height } : null);
  await placeFrame();
  await popSync();
}
/** An older reply's: a copy in the frame (its buttons not Risu's there), said so under it. */
async function fillCopy(doc: SafeDocument, mine: number): Promise<void> {
  const t = tile, r = rule;
  if (!frameEl || !t || !r) return;
  const nodes = await unwrap(await doc.querySelectorAll(`.risu-chat[data-chat-index="${t.index}"] .chattext ${t.selector}`));
  try {
    if (mine !== turn) return;
    const body = await doc.createElement('div'), note = await doc.createElement('div');
    await quiet(body.setClassName('chattext'));
    for (const node of nodes.slice(0, 6)) { const copy = await node.cloneNode(true); await body.appendChild(copy); await release(copy); }
    await note.setAttribute('x-vn-pop-note', '1');
    await note.setTextContent(nodes.length ? '지난 답장이라 복사본이에요. 버튼은 최근 메시지 6개에서만 눌려요.' : '이 메시지에서 요소를 찾지 못했어요.');
    await frameEl.setInnerHTML('');
    await frameEl.appendChild(body); await frameEl.appendChild(note);
    for (const el of [body, note]) await release(el);
    framed = `transform:translate(-50%,-50%) scale(${r.scale})`;
    await frameEl.setStyleAttribute(framed);
    await frameEl.setAttribute('x-vn-pop', 'copy');
    if (mine === turn) rect = await frameEl.getBoundingClientRect();
  } finally { for (const node of nodes) await release(node); }
}

/**
 * One write at a time: the stage's restyle and a relay often ask together, and two at once would each find no sheet
 * and make one, the first left empty and never taken down.
 */
function writeSheet(css: string): Promise<void> {
  const at = epoch;
  const run = writes.then(() => at === epoch ? writeNow(css) : undefined);
  writes = run.catch(() => {});
  return run;
}
async function writeNow(css: string): Promise<void> {
  const doc = host?.doc();
  if (css === sheetText || !doc) return;
  if (!sheet) {
    if (!css) return;
    const body = await doc.querySelector('body');
    if (!body) return;
    try {
      const style = await doc.createElement('style');
      await style.setAttribute('x-omni-vn-style', 'live');
      await body.appendChild(style);
      sheet = style;
    } finally { await release(body); }
  }
  sheetText = css;
  await sheet.setTextContent(css);
}
/** Risu's 클릭해서 편집 starts an edit on a click in a message, a lifted element's too: said once, the first time. */
function warnClickToEdit(): void {
  if (warned) return;
  warned = true;
  void (async () => {
    const db = await risuHost()?.getDatabase?.(['clickToEdit']).catch(() => null) as { clickToEdit?: unknown } | null | undefined;
    if (db?.clickToEdit === true) host?.say('Risu의 "클릭해서 편집"이 켜져 있어요. 작동 요소를 누르면 메시지 편집이 시작될 수 있어요.', 5000);
  })().catch(() => {});
}
