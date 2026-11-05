import { dbg } from '../core/debug';
import { risuHost } from '../core/host';
import { compactHash } from '../domain/tts/segment';
import { findElementKinds, kindLabel, type ElementKind } from '../domain/viewer/elements';
import { elementKey, elementRules, elementSig, GROUP_LETTERS, saveElementRules, type ElementFrom, type ElementRole, type ElementRule, type ElementRules } from '../storage/viewer-elements';
import { saveViewerPrefs, viewerPrefs } from '../storage/viewer-prefs';
import { liveTargets } from './elements-live';
import { popAt, popAttach, popClose, popCloseAt, popCss, popDetach, popOpen, popOpenSig, popRelay, popRetarget, popSeen, popSync, popTapped, type PopHost, type PopTile } from './elements-pop';
import { quiet, release, rowAt, unwrap } from './safe-dom';

/**
 * 옴니 뷰어's 요소: a bot's own elements (its status panel, its choice list) brought
 * onto the stage. Only kinds the reader registered in 편집 come: a sticker is the
 * chat's element cloned (no pixels, the bot's look kept) and placed where the reader
 * dragged it, shown with 요소 on, or always; a choice is offered at the end of the
 * newest reply, and choosing it twice sends it as the user's message.
 *
 * 작동 is a kind of its own (never a sticker as well): a tile on the stage, dragged anywhere like a floating icon; a
 * tap opens the element in the middle of the viewer, its buttons Risu's, and a tap anywhere else folds it
 * (elements-pop.ts).
 *
 * A kind is found in the reply on stage, in the reader's message after it, or in the bot's message 1 or 2 after it
 * (편집's tabs: a bot that sends its status panel in a message of its own). With 접기 a sticker has a title bar: a
 * tap folds it, a drag moves it.
 *
 * 작동 tiles can be grouped, and stickers too (each group one or the other), each group a letter (편집's 선택, then
 * 그룹화 or 분리): the places one panel may come from. Out of 편집 a group is one, the one of them in the newest
 * message (the absent passed over): a tile opening it, or its copy. A group's members are seldom all in one reply: with
 * 편집's 없는것 숨김 off, a kind registered and absent from its message is a grey tile there, to be placed and picked.
 *
 * Optimistic: a tap shows what it did with its first write (편집's chip lit, the panel in, the popup's dim); the
 * stage and the save catch up after, a spinner turning meanwhile.
 *
 * Nothing here runs for a bot with nothing registered: the reply's HTML is read once,
 * and only when there is something to find or 편집 is open.
 */
export interface ElementsHost extends Omit<PopHost, 'lost'> {
  root: () => SafeElement | null;
  /** The reply on stage: its chat index and its bot. null while streaming, or with none. */
  reply: () => { index: number; bot: string } | null;
  /** The bot's `n`th message after `index` (the reader's are passed over), or -1. */
  charAfter: (index: number, n: number) => number;
  /** The reader's message right after `index`, before the bot's next one, or -1. */
  userAfter: (index: number) => number;
  atEnd: () => boolean;
}
interface HostPoint { clientX: number; clientY: number }
/** A grouped kind, found where its rule says: its rule's key, the message and its element, its rule, its name. */
interface Member { sig: string; tile: PopTile; rule: ElementRule; label: string }
/**
 * A sticker (a copy), a 작동 tile (its element found by `tile` when it opens), a group's one (its members found in
 * this reply's messages: a tile, or the newest one's copy), or in 편집 a kind absent here (a grey tile), on the stage.
 */
interface Sticker { key: string; el: SafeElement; r: DOMRect | null; tile?: PopTile; members?: Member[]; group?: string; ghost?: boolean }
interface Row { sig: string; label: string; count: number; text: string }
type ChipId = ElementRole | 'always' | 'hidden' | 'scale' | 'fold';
/** 편집's tabs, in the chat's order: the reply, the reader's message after it, the bot's next two. */
const TABS = ['이 답장', '다음 유저 메시지', '다음 메시지 1', '다음 메시지 2'] as const;
const TAB_FROM: readonly ElementFrom[] = [0, 3, 1, 2];
/** A tile's tab, shown on it in 편집 (the same panel may be registered from each). */
const TAB_TAG: Readonly<Record<ElementFrom, string>> = { 0: '답장', 1: '다음1', 2: '다음2', 3: '유저' };
/** A group's one on the stage, by its letter (no kind's signature starts so). */
const GROUP = '@group:';
const groupKey = (letter: string) => GROUP + letter;
const isGroup = (key: string) => key.startsWith(GROUP);
/** The newest of the members present: the one the group's tile opens, or its sticker is the copy of. */
const newest = (members: readonly Member[]): Member | undefined => members.reduce<Member | undefined>((best, m) => !best || m.tile.index > best.tile.index ? m : best, undefined);
/** What one on the stage looks and folds by: its rule; a group's, the newest member's (the one it is). */
const ruleOf = (sig: string): ElementRule | undefined => isGroup(sig) ? newest(stickers.get(sig)?.members ?? [])?.rule : rules[sig];
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
/**
 * 편집's chips as the list was drawn (each row's ids) and where each is, read once after it is drawn, with where the
 * list's title was then: a tap is told from them and one read of where the title is now (the list may have scrolled
 * since, or the panel still been sliding in when it was read).
 */
let painted: ChipId[][] = [], chipRects: Array<{ row: number; chip: number; r: DOMRect }> = [], chipsAt = { left: 0, top: 0 };
/** 편집 catching up with a tap (the stage, the save): its spinner turns while any is under way. */
let busy = 0, rebuilding: Promise<void> | null = null, rebuildAgain = false;
/**
 * 편집's buttons at the top (선택, 그룹화, 분리, 없는것 숨김: where each is, read with the list), whether 선택 is on,
 * the tiles and stickers picked with it (by rule key), and whether a kind absent from its message stays off the stage
 * (on, as 편집 first opens; off, it is a grey tile there).
 */
const GROUP_BUTTONS = ['select', 'group', 'split', 'absent'] as const;
type GroupButton = typeof GROUP_BUTTONS[number];
const noButtons = (): Record<GroupButton, DOMRect | null> => ({ select: null, group: null, split: null, absent: null });
let buttons = noButtons(), selecting = false, hideAbsent = true;
const selected = new Set<string>();
const lit = (b: GroupButton) => `[x-omni-vn] [data-vn-gb="${b}"]{color:#1a1408;background:var(--gold)}`;

export async function elementsOpen(h: ElementsHost): Promise<void> {
  // 요소 stays as it was left, as AUTO and VOICE do (any bot, any chat); 편집 always starts closed.
  host = h; showing = viewerPrefs().elements; editing = false; rows = []; options = []; choicesOn = false; chosen = -1; choicesRect = null; panelRect = null;
  tab = 0; tabsRect = null; kindsAt.clear(); painted = []; chipRects = []; busy = 0; buttons = noButtons(); selecting = false; hideAbsent = true; selected.clear();
  stickers.clear();
  const root = h.root();
  let pop: SafeElement | null = null;
  if (root) [layer, choicesEl, panel, pop] = await Promise.all(['[data-vn-stickers]', '[data-vn-choices]', '[data-vn-edit]', '[data-vn-pop]'].map(s => root.querySelector(s)));
  lostAt = 0;
  popAttach({ ...h, lost: onLost }, pop);
}
/**
 * The open one's element gone from where it was (Risu drew its message anew after a button, or it went): the reply's
 * kinds read again and the stage rebuilt, which moves the window to it, or to one of its group there (resolveOpen);
 * none, the window stays as it is. Once in a while at most: a tap brings two reads of it, and one gone for good would
 * ask every time.
 */
let lostAt = 0;
function onLost(): void {
  if (!popOpenSig() || editing || rebuilding || Date.now() - lostAt < 1500) return;
  lostAt = Date.now();
  kindsAt.clear();
  void rebuildSoon().catch(report('viewer.pop'));
}
/**
 * After a rebuild, the open one: its tile here (a group's: its newest member there) is where its window goes; none
 * here, it stays where it was. Only the reader folds it.
 */
async function resolveOpen(): Promise<void> {
  const open = popOpenSig();
  if (!open || editing) return;
  const s = stickers.get(open);
  if (isGroup(open)) { const m = newest(s?.members ?? []); if (m?.rule.role === 'live') await popRetarget(m.tile, m.rule); return; }
  const r = rules[open];
  if (s?.tile && r?.role === 'live') await popRetarget(s.tile, r);
}
export async function elementsClose(): Promise<void> {
  await popDetach();
  await endDrag();
  await arm(null);
  for (const s of stickers.values()) await release(s.el);
  stickers.clear();
  for (const el of [layer, choicesEl, panel]) await release(el);
  layer = choicesEl = panel = null; host = null; showing = editing = false;
}
/** A point on a sticker or a tile on show (its taps are its own). */
export const onSticker = (p: HostPoint): boolean => [...stickers.values()].some(s => !!s.r && inside(p, s.r));
/** 요소 is on, or 편집 open: the 편집 button is there to press. */
export const elementsShown = (): boolean => showing || editing;
export const elementsEditing = (): boolean => editing;
/** 작동's popup is up (Escape folds it). */
export const elementsPopOpen = (): boolean => popSeen();
export const closeElementPop = (): Promise<void> => popClose();

const shown = (sig: string): boolean => {
  // The group's tile: out of 편집 (there each member is its own tile), with a member on show.
  if (isGroup(sig)) return !editing && (stickers.get(sig)?.members ?? []).some(m => showing || m.rule.always);
  const r = rules[sig];
  return !!r && (editing || (!r.hidden && (showing || r.always)));
};
/**
 * Where each sticker and tile on show is: a tap there is its own (a sticker's <details> folds, by the browser
 * itself), never a step of the story. Read again after such a tap, since a fold changes its size; read together.
 */
async function measureStickers(): Promise<void> {
  const all = [...stickers.entries()];
  const read = await Promise.all(all.map(([sig, s]) => shown(sig) ? s.el.getBoundingClientRect() : Promise.resolve(null)));
  all.forEach(([, s], i) => { s.r = read[i] ?? null; });
}
/** The popup's sheet as things stand, no read (the stage restyled: a panel opened over it, the picture went big). */
export const elementsSyncLive = (): Promise<void> => popSync();
/** The stickers read where they are, the popup's windows too and its holes cut there (the frame moved, a tap, a drop). */
export async function elementsRelayLive(): Promise<void> {
  if (!host) return;
  await measureStickers();
  await popRelay();
}
/** The part of the scene's one style text that is 요소's: which stickers show, the panel, the choices. */
export function elementsCss(): string {
  const out: string[] = [];
  if (showing || editing) out.push('[x-omni-vn] [data-vn-act="elems"]{color:#1a1408;background:var(--gold)}[x-omni-vn] [data-vn-act="eledit"]{visibility:visible}');
  // In 편집 a press drags: a <details> under it must not fold as well.
  // Open, the panel covers the tab: ✎ steps out to the panel's left edge, still a tap away.
  // A finger must land on what it drags (the layer lets presses through) and must not pan, or a phone takes the
  // move for a scroll and the drag stops: in 편집 a sticker takes the press, none of what is in it (a link in a copy).
  if (editing) out.push('[x-omni-vn] [data-vn-edit]{translate:0 0}[x-omni-vn] [data-vn-act="eledit"]{right:calc(min(84%,330px) + 8px);color:#1a1408;background:var(--gold)}[x-omni-vn] [x-vn-st] summary{pointer-events:none}'
    + '[x-omni-vn] [x-vn-st]{pointer-events:auto;touch-action:none;cursor:grab}[x-omni-vn] [x-vn-st] *{pointer-events:none}'
    // 선택 · 그룹화 · 분리 · 없는것 숨김 at the top, 선택 and 숨김 lit while they are on.
    + `[x-omni-vn] [data-vn-groupbar]{display:flex}${selecting ? lit('select') : ''}${hideAbsent ? lit('absent') : ''}`);
  // What is picked with 선택: a tile ringed, ✓ in its corner; a sticker's copy ringed the same.
  if (editing) for (const key of selected) {
    const s = stickers.get(key);
    if (!s) continue;
    const at = `[x-omni-vn] [x-vn-st="${s.key}"]${s.tile || s.ghost ? ' [data-vn-tile]' : ''}`;
    out.push(`${at}{box-shadow:0 0 0 3px #8fd3ff}${at}::after{content:"✓";position:absolute;left:4px;bottom:2px;color:#8fd3ff;font:700 13px/1 system-ui,sans-serif}`);
  }
  // 편집 catching up with a tap: a spinner by its title until the stage and the save are done.
  if (busy) out.push('[x-omni-vn] [data-vn-edit] h4::after{content:"";display:inline-block;width:10px;height:10px;margin-left:8px;vertical-align:-1px;border-radius:50%;border:2px solid rgba(227,194,122,.25);border-top-color:var(--gold);animation:vn-spin .8s linear infinite}');
  const open = popOpenSig();
  for (const [sig, s] of stickers) {
    // A group's one looks as its newest member does (its fold too); it is there out of 편집 only.
    const r = ruleOf(sig);
    if (!r) continue;
    if (isGroup(sig)) { if (shown(sig)) out.push(`[x-omni-vn] [x-vn-st="${s.key}"]{display:block}`); }
    else if (editing) out.push(`[x-omni-vn] [x-vn-st="${s.key}"]{display:block;outline:2px dashed var(--gold);outline-offset:4px${r.hidden ? ';opacity:.35' : ''}}`);
    else if (!r.hidden && (showing || r.always)) out.push(`[x-omni-vn] [x-vn-st="${s.key}"]{display:block}`);
    // Folded, only its bar stays (in 편집 it is always open: what is placed is seen).
    if (r.role === 'sticker' && r.fold && r.folded && !editing) out.push(`[x-omni-vn] [x-vn-st="${s.key}"] [x-vn-st-body]{display:none}[x-omni-vn] [x-vn-st="${s.key}"] [x-vn-st-bar]{border-radius:8px;border-bottom-width:1px}[x-omni-vn] [x-vn-st="${s.key}"] [x-vn-st-bar]::after{content:"▸"}`);
    // The tile whose element is open is lit.
    if (sig === open && !editing) out.push(`[x-omni-vn] [x-vn-st="${s.key}"] [data-vn-tile]{color:#1a1408;background:var(--gold)}`);
  }
  out.push(popCss());
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
/** A tile keeps its own size: 크기 is its popup's. */
const scaleOf = (r: ElementRule) => r.role === 'live' ? 1 : r.scale;
const place = (r: ElementRule) => `left:${r.x}%;top:${r.y}%;transform:scale(${scaleOf(r)})`;
/** A grey tile stands where its kind would (a sticker's corner), a tile's size. */
const ghostPlace = (r: ElementRule) => `left:${r.x}%;top:${r.y}%;transform:scale(1)`;
/**
 * The message a kind is found in: the reply on stage, the reader's message after it (3), or the bot's message 1 or 2
 * after it (-1: there is none).
 */
function sourceIndex(from: ElementFrom): number {
  const reply = host?.reply();
  if (!host || !reply) return -1;
  return from === 0 ? reply.index : from === 3 ? host.userAfter(reply.index) : host.charAfter(reply.index, from);
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
/** A tile's face: its icon and name, in 편집 its tab (which message it is found in), its group's letter in the corner. */
const tileFace = (icon: string, label: string, rule: ElementRule) =>
  `<div data-vn-tile><b>${icon}</b><span>${esc(label)}</span>${editing ? `<em>${TAB_TAG[rule.from]}</em>` : ''}${rule.group ? `<i>${rule.group}</i>` : ''}</div>`;
/**
 * 작동: a tile where the reader put it, the kind's name on it; its element is found when it opens (elements-pop.ts).
 * In 편집 a grouped one shows its group's letter (there each member is its own tile, to be picked and let go).
 */
async function putTile(doc: SafeDocument, ruleKey: string, tile: PopTile, label: string, rule: ElementRule): Promise<void> {
  if (!layer) return;
  const wrap = await doc.createElement('div'), key = keyOf(ruleKey);
  await wrap.setAttribute('x-vn-st', key);
  await wrap.setStyleAttribute(place(rule));
  await wrap.setInnerHTML(tileFace('📋', label, rule));
  await layer.appendChild(wrap);
  stickers.set(ruleKey, { key, el: wrap, r: null, tile });
}
/**
 * 편집 with 없는것 숨김 off: a kind registered and absent from its message (or with no such message after this reply)
 * is a grey tile where its rule puts it, to be seen, placed and picked: a group's members are seldom all in one reply.
 */
async function putGhost(doc: SafeDocument, ruleKey: string, rule: ElementRule): Promise<void> {
  if (!layer) return;
  const wrap = await doc.createElement('div'), key = keyOf(ruleKey);
  await wrap.setAttribute('x-vn-st', key);
  await wrap.setAttribute('x-vn-ghost', '1');
  await wrap.setStyleAttribute(ghostPlace(rule));
  await wrap.setInnerHTML(tileFace(rule.role === 'live' ? '📋' : '🏷️', kindLabel(elementSig(ruleKey)), rule));
  await layer.appendChild(wrap);
  stickers.set(ruleKey, { key, el: wrap, r: null, ghost: true });
}
const tileOf = (index: number, kind: ElementKind): PopTile => ({ index, selector: kind.selector, targets: liveTargets(index, kind.selector, kind.count) });
/**
 * Where a group's one stands: its place, which every member keeps (the first one's, should they differ), as large as
 * the one it is.
 */
const groupPlace = (members: readonly Member[]) => `left:${members[0]!.rule.gx}%;top:${members[0]!.rule.gy}%;transform:scale(${scaleOf(newest(members)!.rule)})`;
/** A group's one tile: the name of the one it opens (the newest present), and the group's letter. */
async function putGroup(doc: SafeDocument, letter: string, members: Member[]): Promise<void> {
  if (!layer || !members.length) return;
  const wrap = await doc.createElement('div'), sig = groupKey(letter), key = keyOf(sig), lead = newest(members)!;
  await wrap.setAttribute('x-vn-st', key);
  await wrap.setStyleAttribute(groupPlace(members));
  await wrap.setInnerHTML(`<div data-vn-tile data-vn-group="${letter}"><b>🗂️</b><span>${esc(lead.label)}</span><i>${letter}</i></div>`);
  await layer.appendChild(wrap);
  stickers.set(sig, { key, el: wrap, r: null, members, group: letter });
}
/**
 * A registered kind's elements, cloned into one sticker where the reader put it: its body a .chattext (the bot's
 * chat CSS reaches what sits in one, so the clone looks as it does in the chat), its bar over it with 접기. A group's
 * is its newest member's, where the group is.
 */
async function putSticker(doc: SafeDocument, ruleKey: string, at: PopTile, label: string, rule: ElementRule, group?: { letter: string; members: Member[] }): Promise<void> {
  if (!layer) return;
  const nodes = await unwrap(await doc.querySelectorAll(`.risu-chat[data-chat-index="${at.index}"] .chattext ${at.selector}`));
  try {
    if (!nodes.length) return;
    const wrap = await doc.createElement('div'), body = await doc.createElement('div'), key = keyOf(ruleKey);
    await wrap.setAttribute('x-vn-st', key);
    await wrap.setStyleAttribute(group ? groupPlace(group.members) : place(rule));
    if (rule.fold) await putBar(doc, wrap, label);
    // In 편집 a grouped one has its group's letter by it (there each member is its own sticker, to be picked).
    if (editing && rule.group) {
      const tag = await doc.createElement('div');
      await tag.setAttribute('x-vn-st-group', rule.group);
      await tag.setTextContent(rule.group);
      await wrap.appendChild(tag); await release(tag);
    }
    await body.setAttribute('x-vn-st-body', '1');
    await quiet(body.setClassName('chattext'));
    for (const node of nodes.slice(0, 6)) { const copy = await node.cloneNode(true); await body.appendChild(copy); await release(copy); }
    await wrap.appendChild(body); await release(body);
    await layer.appendChild(wrap);
    stickers.set(ruleKey, group ? { key, el: wrap, r: null, members: group.members, group: group.letter } : { key, el: wrap, r: null });
  } finally { for (const node of nodes) await release(node); }
}
/** After a reply loads: its stickers and tiles put up and its choices gathered (or nothing, with nothing registered). */
export async function elementsForReply(): Promise<void> {
  kindsAt.clear();
  await putUp();
}
/**
 * The stage's stickers and tiles as the rules have them, and the reply's choices: the reply's kinds are read once
 * (a rule changed in 편집 reads nothing). The new go up before the old come down, so what stays never blinks.
 */
async function putUp(): Promise<void> {
  const old = [...stickers.values()];
  stickers.clear(); options = []; choicesOn = false; chosen = -1; choicesRect = null;
  await arm(null);
  // An open popup stays (only the reader folds it; resolveOpen moves it after), but not into 편집: its hole would cut
  // through the panel.
  if (editing) await popClose(false);
  const h = host, doc = h?.doc(), reply = h?.reply();
  if (h && doc && reply) {
    if (reply.bot !== bot) { bot = reply.bot; rules = await elementRules(bot); }
    if (editing || Object.keys(rules).length) {
      if (editing) await kindsOf(doc, tab);
      // Out of 편집 a group's members are found, not put up: each group is one (those absent, or hidden, out).
      const groups = new Map<string, Member[]>();
      for (const [key, rule] of Object.entries(rules)) {
        const sig = elementSig(key), kind = (await kindsOf(doc, rule.from)).find(k => k.sig === sig);
        if (!kind) {
          if (editing && !hideAbsent && rule.role !== 'choice') await putGhost(doc, key, rule);
          continue;
        }
        if (rule.role === 'choice') { options.push(...kind.options); continue; }
        const tile = tileOf(sourceIndex(rule.from), kind);
        if (rule.group && !editing) {
          if (!rule.hidden) groups.set(rule.group, [...(groups.get(rule.group) ?? []), { sig: key, tile, rule, label: kind.label }]);
          continue;
        }
        await (rule.role === 'live' ? putTile : putSticker)(doc, key, tile, kind.label, rule);
      }
      // A group of 작동 is a tile opening its newest member; one of stickers, the newest one's copy.
      for (const [letter, members] of groups) {
        const lead = newest(members)!;
        if (lead.rule.role === 'live') await putGroup(doc, letter, members);
        else await putSticker(doc, groupKey(letter), lead.tile, lead.label, lead.rule, { letter, members });
      }
      options = options.slice(0, MAX_OPTIONS);
    }
  }
  // Picked and no longer on the stage (absent ones hidden again): let go, so 그룹화 takes only what is seen.
  for (const key of selected) if (!stickers.has(key)) selected.delete(key);
  if (editing) await paintPanel();
  // What shows them is the stage's style text: the line it was written for may already be out (a reply opened
  // where the reader left it, its stickers put up after), and nothing writes it again until the next line.
  if (stickers.size || old.length) await host?.restyle();
  for (const s of old) { await quiet(s.el.remove()); await release(s.el); }
  setTimeout(() => void (editing ? measureEditing() : measureStickers()).catch(() => {}), 120);
  await resolveOpen();
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
/** A row's chips: what it is (one of the three), then what a placed one can be. */
function chipsOf(r: ElementRule | undefined): Array<{ id: ChipId; label: string; on: boolean }> {
  const out: Array<{ id: ChipId; label: string; on: boolean }> = [
    { id: 'sticker', label: '스티커', on: r?.role === 'sticker' }, { id: 'live', label: '작동', on: r?.role === 'live' }, { id: 'choice', label: '선택지', on: r?.role === 'choice' },
  ];
  if (r && r.role !== 'choice') out.push({ id: 'always', label: '📌 항상', on: r.always }, { id: 'hidden', label: '숨김', on: r.hidden }, { id: 'scale', label: `크기 ${Math.round(r.scale * 100)}%`, on: false });
  if (r?.role === 'sticker') out.push({ id: 'fold', label: '접기', on: r.fold });
  return out;
}
const HINT = '스티커는 끌어서 옮겨요(접기: 제목줄). 작동은 타일, 누르면 진짜 요소가 가운데 열려요. 위 선택→고르기→그룹화(스티커끼리·작동끼리), 묶이면 최신 것 하나만. 없는것 숨김을 끄면 지금 없는 것도 흑백 타일로. 선택지는 최신 답장 끝에.';
/** The rule of a kind in the tab open now (one panel may be registered from each tab). */
const ruleHere = (sig: string): ElementRule | undefined => rules[elementKey(sig, tab)];
async function paintPanel(): Promise<void> {
  if (!panel) return;
  const here = kindsAt.get(tab), none = sourceIndex(tab) < 0;
  rows = (here ?? []).map(k => ({ sig: k.sig, label: k.label, count: k.count, text: k.text }));
  if (here) for (const [key, rule] of Object.entries(rules)) {
    const sig = elementSig(key);
    if (rule.from === tab && !rows.some(r => r.sig === sig)) rows.push({ sig, label: kindLabel(sig), count: 0, text: '이 메시지에는 없음' });
  }
  painted = rows.map(row => chipsOf(ruleHere(row.sig)).map(c => c.id));
  chipRects = [];
  const tabs = `<nav data-vn-tabs>${TABS.map((name, i) => `<i${TAB_FROM[i] === tab ? ' data-on' : ''}>${name}</i>`).join('')}</nav>`;
  const empty = none ? `이 답장 뒤에 ${tab === 3 ? '유저' : '봇'} 메시지가 없어요.` : '이 메시지에는 고를 요소가 없어요. (Omni가 만든 것은 빼요)';
  // Its message not read yet: a spinner where its kinds will be.
  const list = !here && !none ? '<small data-vn-hint data-vn-wait>요소를 읽는 중…</small>' : rows.map(row => {
    const r = ruleHere(row.sig), chips = chipsOf(r).map(c => `<i${c.on ? ' data-on' : ''}>${c.label}</i>`).join('');
    return `<div data-vn-el><b>${esc(row.label)}</b>${r?.group ? `<small>🔗 그룹 ${r.group}</small>` : ''}${row.count > 1 ? `<small>×${row.count}</small>` : ''}<span>${esc(row.text)}</span><p>${chips}</p></div>`;
  }).join('') || `<small data-vn-hint>${empty}</small>`;
  await panel.setInnerHTML(`<h4>요소 편집</h4>${tabs}<small data-vn-hint>${HINT}</small>${list}`);
}
/** Where 편집's panel, its tabs and every chip are, read together once it is drawn: a tap then reads one place. */
async function measureEditing(): Promise<void> {
  if (!editing) return;
  const root = host?.root();
  if (panel && root) {
    const drawn = painted;
    const [[tabsEl, head, chips], gb] = await Promise.all([
      Promise.all([panel.querySelector('[data-vn-tabs]'), panel.querySelector('h4'), panel.querySelectorAll('[data-vn-el] i').then(list => unwrap(list))]),
      Promise.all(GROUP_BUTTONS.map(b => root.querySelector(`[data-vn-gb="${b}"]`))),
    ]);
    try {
      const read = await Promise.all([panel, tabsEl, head, ...gb, ...chips].map(el => el ? el.getBoundingClientRect() : Promise.resolve(null)));
      // The panel and the buttons stay whatever the list: kept even when it was drawn again meanwhile, or a tap
      // would fall on no panel until the next read.
      panelRect = read[0] ?? null;
      buttons = noButtons();
      GROUP_BUTTONS.forEach((b, i) => { buttons[b] = read[3 + i] ?? null; });
      // Drawn again meanwhile: the tabs, the title and the chips read are another list's.
      if (drawn === painted) {
        tabsRect = read[1] ?? null; chipsAt = { left: read[2]?.left ?? 0, top: read[2]?.top ?? 0 };
        chipRects = [];
        let k = 3 + GROUP_BUTTONS.length;
        drawn.forEach((ids, row) => ids.forEach((_, chip) => { const r = read[k++]; if (r) chipRects.push({ row, chip, r }); }));
      }
    } finally { for (const el of [tabsEl, head, ...gb, ...chips]) await release(el); }
  }
  await measureStickers();
}
/**
 * Where 편집's panel is now, and how far its list has moved since its chips were read (scrolled, or the panel slid
 * on: where its title is now), read together at a tap. It slides in as 편집 opens, and on a busy page the reads after
 * it opens may find it on its way: told by those, a tap on it fell outside it and was dropped.
 */
async function panelNow(): Promise<{ box: DOMRect | null; dx: number; dy: number }> {
  const head = await panel?.querySelector('h4');
  try {
    const [box, now] = await Promise.all([panel ? panel.getBoundingClientRect() : Promise.resolve(null), head ? head.getBoundingClientRect() : Promise.resolve(null)]);
    return { box, dx: now ? now.left - chipsAt.left : 0, dy: now ? now.top - chipsAt.top : 0 };
  } finally { await release(head); }
}
/** Another tab: lit at once (its list to come, the spinner turning, unless read already); its message read once per reply. */
async function openTab(next: ElementFrom): Promise<void> {
  const doc = host?.doc();
  if (!doc || next === tab) return;
  tab = next;
  await paintPanel();
  if (!kindsAt.has(tab)) { await kindsOf(doc, tab); await paintPanel(); }
  await measureEditing();
}
/**
 * A tap on the 편집 list, told from where its chips were read, shifted by how far the list has moved since (dx, dy:
 * panelNow): the list shows it at once, the stage and the save catch up after.
 */
async function panelTap(p: HostPoint, dx: number, dy: number): Promise<void> {
  if (!panel || !host) return;
  const at = (r: DOMRect) => inside(p, { left: r.left + dx, top: r.top + dy, width: r.width, height: r.height });
  if (tabsRect && at(tabsRect)) {
    const i = Math.floor((p.clientX - tabsRect.left - dx) / Math.max(1, tabsRect.width / TABS.length));
    await openTab(TAB_FROM[Math.min(TABS.length - 1, Math.max(0, i))]!);
    return;
  }
  const hit = chipRects.find(c => at(c.r)), row = hit && rows[hit.row], id = hit && painted[hit.row]?.[hit.chip];
  if (!row || !id) return;
  applyChip(row.sig, id);
  await paintPanel();
  void measureEditing().catch(() => {});
  await rebuildSoon();
}
/** A chip's change to the rules: what a kind is (one of the three: a sticker made 작동 keeps its place), or an option. */
function applyChip(sig: string, id: ChipId): void {
  const key = elementKey(sig, tab), r = rules[key], placed = Object.values(rules).filter(x => x.role !== 'choice').length;
  if (id === 'sticker' || id === 'live' || id === 'choice') {
    if (r?.role === id) delete rules[key];
    // A sticker made 작동 or back keeps its place and size, and leaves its group (one of stickers, or of 작동).
    else if (r && r.role !== 'choice' && id !== 'choice') { r.role = id; r.group = ''; }
    else {
      const y = id === 'choice' ? 12 : Math.min(70, 12 + placed * 14);
      rules[key] = { role: id, x: 4, y, scale: 1, hidden: false, always: false, from: tab, fold: false, folded: false, group: '', gx: 4, gy: y };
    }
    // A group of one is no group: what is left of it alone goes back to a tile of its own.
    dissolveLone();
    return;
  }
  if (!r || r.role === 'choice') return;
  if (id === 'always') r.always = !r.always;
  else if (id === 'hidden') r.hidden = !r.hidden;
  else if (id === 'scale') r.scale = r.scale > 0.9 ? 0.8 : r.scale > 0.7 ? 0.6 : 1;
  else if (id === 'fold' && r.role === 'sticker') { r.fold = !r.fold; r.folded = false; }
}
/**
 * The stage and the save catching up with 편집's taps, the spinner turning meanwhile: one run at a time, and once
 * more if taps came during it (the last state is what is kept).
 */
function rebuildSoon(): Promise<void> {
  if (rebuilding) { rebuildAgain = true; return rebuilding; }
  busy++;
  rebuilding = (async () => {
    try {
      // The spinner, and what the style text alone shows (a sticker let go is gone, 숨김 and 📌 at once).
      await host?.restyle();
      do {
        rebuildAgain = false;
        await saveElementRules(bot, rules);
        await putUp();
        await elementsAtEnd(host?.atEnd() ?? false);
      } while (rebuildAgain);
    } finally { busy--; rebuilding = null; await host?.restyle().catch(() => {}); }
  })();
  return rebuilding;
}

/**
 * A tap on a title bar: folded or open again at once, then read where it is and kept for the bot. A group's folds as
 * one: whichever member it is next keeps the fold.
 */
async function toggleFolded(sig: string): Promise<void> {
  const r = ruleOf(sig), group = stickers.get(sig)?.group;
  if (r?.role !== 'sticker' || !r.fold) return;
  const folded = !r.folded;
  for (const x of group ? Object.values(rules).filter(x => x.group === group) : [r]) x.folded = folded;
  await host?.restyle();
  await measureStickers();
  await saveElementRules(bot, rules);
}
export async function toggleElements(): Promise<void> {
  showing = !showing;
  void saveViewerPrefs({ elements: showing }).catch(() => {});
  if (!showing) editing = false;
  const open = popOpenSig();
  if (open && !shown(open)) await popClose(false);
  await host?.restyle();
  await measureStickers();
}
export async function toggleEdit(): Promise<void> {
  editing = !editing;
  panelRect = null; tabsRect = null; chipRects = [];
  // 선택 is 편집's: closed, nothing stays picked.
  selecting = false; selected.clear();
  if (editing) showing = true;
  busy++;
  try {
    // At once: the panel slides in, drawn from what is known (the rest to come, the spinner turning), or out.
    if (editing) await paintPanel();
    await host?.restyle();
    // Rebuilt, the reply's choices wait for the end again: at the end now, they come straight back.
    await putUp();
    await elementsAtEnd(host?.atEnd() ?? false);
  } finally { busy--; await host?.restyle().catch(() => {}); }
  setTimeout(() => void (editing ? measureEditing() : measureStickers()).catch(() => {}), editing ? 380 : 120);
}

/**
 * Dragging a sticker in 편집, or a tile or a title bar at any time: the press finds it by its measured rectangle,
 * the move is listened to only while it lasts (closed, it costs Risu nothing), and the drop keeps the place as a
 * share of the frame, so it holds on any screen.
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
  const d = drag, s = d && stickers.get(d.sig);
  if (!d || !s) return;
  const style = `left:${Math.round(d.left + d.dx)}px;top:${Math.round(d.top + d.dy)}px;transform:scale(${sizeOf(d.sig, s)})`;
  if (style !== d.painted) { d.painted = style; await s.el.setStyleAttribute(style); }
}
/** How large one on the stage is drawn: a grey tile at a tile's size; a group's, as the one it is. */
function sizeOf(sig: string, s: Sticker): number {
  const r = ruleOf(sig);
  return s.ghost || !r ? 1 : scaleOf(r);
}
/** 편집's button at the top under the point (선택, 그룹화, 분리, 없는것 숨김), if any. */
const buttonAt = (p: HostPoint): GroupButton | '' => GROUP_BUTTONS.find(b => { const r = buttons[b]; return !!r && inside(p, r); }) ?? '';
/** A group of one is no group: what is left of a group alone goes back to a tile of its own. */
function dissolveLone(): void {
  const count = new Map<string, number>();
  for (const r of Object.values(rules)) if (r.group) count.set(r.group, (count.get(r.group) ?? 0) + 1);
  for (const r of Object.values(rules)) if (r.group && (count.get(r.group) ?? 0) < 2) r.group = '';
}
/** A tile or a sticker tapped with 선택 on: picked, or let go again, at once (a choice is never on the stage). */
async function togglePick(key: string): Promise<void> {
  const r = rules[key];
  if (!r || r.role === 'choice') return;
  if (selected.has(key)) selected.delete(key); else selected.add(key);
  await host?.restyle();
}
/**
 * The buttons at the top of 편집. 선택 turns picking on and off. 그룹화 makes the picked a new group (the next free
 * letter; the first picked one's place is the group's), taking them out of any they were in: stickers, or 작동 tiles,
 * never both. 분리 takes the picked ones out of their groups. A group left with one is undone; the picks are cleared.
 * 없는것 숨김 puts a kind absent from its message on the stage (a grey tile) or takes it off. The stage and the save
 * catch up behind the spinner.
 */
async function pressButton(button: GroupButton): Promise<void> {
  if (button === 'select') {
    selecting = !selecting;
    if (!selecting) selected.clear();
    await host?.restyle();
    if (selecting) host?.say('묶거나 풀 타일·스티커를 눌러 고른 뒤, 그룹화나 분리를 누르세요.', 3000);
    return;
  }
  if (button === 'absent') {
    hideAbsent = !hideAbsent;
    host?.say(hideAbsent ? '이 메시지에 없는 요소는 숨겨요.' : '이 메시지에 없는 요소도 흑백 타일로 보여요. 옮기고, 골라서 묶을 수 있어요.', 3000);
    await rebuildSoon();
    return;
  }
  const picked = [...selected].filter(k => rules[k] && rules[k]!.role !== 'choice');
  if (button === 'group') {
    if (picked.length < 2) { host?.say(selecting ? '2개 이상 고르세요.' : '선택을 켜고 묶을 것을 고르세요.', 2500); return; }
    if (new Set(picked.map(k => rules[k]!.role)).size > 1) { host?.say('스티커와 작동은 따로 묶어요.', 2500); return; }
    const used = new Set(Object.values(rules).map(r => r.group)), letter = [...GROUP_LETTERS].find(l => !used.has(l));
    if (!letter) { host?.say('그룹을 더 만들 수 없어요.', 2500); return; }
    const lead = rules[picked[0]!]!;
    for (const k of picked) { const r = rules[k]!; r.group = letter; r.gx = lead.x; r.gy = lead.y; }
    host?.say(`그룹 ${letter}로 묶었어요. 편집을 닫으면 하나만 보이고, 가장 최근 메시지의 것이에요.`, 3000);
  } else {
    const grouped = picked.filter(k => rules[k]!.group);
    if (!grouped.length) { host?.say(selecting ? '묶인 것을 고른 뒤 분리를 누르세요.' : '선택을 켜고 풀 것을 고르세요.', 2500); return; }
    for (const k of grouped) rules[k]!.group = '';
    host?.say('분리했어요.', 2000);
  }
  dissolveLone();
  selected.clear();
  await rebuildSoon();
}
async function endDrag(): Promise<void> {
  clearTimeout(moveTimer); moveTimer = undefined;
  const id = moveId; moveId = null;
  const doc = host?.doc();
  if (id && doc) { const resolved = await id.catch(() => ''); if (resolved) await quiet(doc.removeEventListener('pointermove', resolved)); }
}
/** The sticker (or a group's) whose title bar is under the point (with 접기 on; as tall as its scale makes it). */
function barAt(p: HostPoint): string {
  for (const [sig, s] of stickers) {
    const r = ruleOf(sig);
    if (!s.ghost && r?.role === 'sticker' && r.fold && s.r && inside(p, s.r) && p.clientY <= s.r.top + BAR_H * r.scale) return sig;
  }
  return '';
}
/** The 작동 tile (or a group's) under the point: never a group of stickers, nor a grey tile. */
function tileAt(p: HostPoint): string {
  for (const [sig, s] of stickers) if (!s.ghost && ruleOf(sig)?.role === 'live' && s.r && inside(p, s.r)) return sig;
  return '';
}
/** A tile tapped: its element opens in the middle (on show, out of 편집); the group's, its newest member's. */
async function openTile(sig: string): Promise<void> {
  if (editing || !shown(sig)) return;
  const s = stickers.get(sig);
  if (isGroup(sig)) { const m = newest(s?.members ?? []); if (m?.rule.role === 'live') await popOpen(sig, m.tile, m.rule); return; }
  const r = rules[sig];
  if (!s?.tile || r?.role !== 'live') return;
  await popOpen(sig, s.tile, r);
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
 * 작동 tile or a sticker's title bar drags it (and taps open or fold it, elementsClick); with the popup up, a press
 * in it is its own and one anywhere else only folds it; any other press is the stage's.
 */
export function elementsDown(p: HostPoint, onControl: boolean): boolean {
  if (!editing) {
    if (popAt(p)) return true;
    const sig = onControl ? '' : tileAt(p) || barAt(p);
    if (sig) { startDrag(sig, p); return true; }
    return popSeen() && !onControl;
  }
  // Before the panel is read a press may be on it (a scroll of its list): no sticker under it is dragged.
  if (onControl || !host || !panelRect || inside(p, panelRect) || buttonAt(p)) return true;
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
  // A finger wobbles further than a mouse: under this a press was a tap (a tile opens, a bar folds).
  const frame = host.frame(), r = rules[d.sig], s = stickers.get(d.sig), moved = Math.hypot(d.dx, d.dy) >= 8;
  // The click this release brings is no tap; the next one is.
  if (moved) dragUntil = Date.now() + 250;
  void (async () => {
    await endDrag();
    if (!s || !moved) return;
    const x = Math.min(96, Math.max(0, Math.round((d.left + d.dx) / Math.max(1, frame.width) * 1000) / 10));
    const y = Math.min(96, Math.max(0, Math.round((d.top + d.dy) / Math.max(1, frame.height) * 1000) / 10));
    if (s.group) {
      // A group's place is every member's, those absent here too.
      for (const rule of Object.values(rules)) if (rule.group === s.group) { rule.gx = x; rule.gy = y; }
      await s.el.setStyleAttribute(`left:${x}%;top:${y}%;transform:scale(${sizeOf(d.sig, s)})`);
    } else if (!r) return;
    else {
      r.x = x; r.y = y;
      // A member placed in 편집 is where its group shows: a group of stickers has no bar to move it by otherwise.
      if (r.group) for (const rule of Object.values(rules)) if (rule.group === r.group) { rule.gx = x; rule.gy = y; }
      await s.el.setStyleAttribute(s.ghost ? ghostPlace(r) : place(r));
    }
    await measureStickers();
    await saveElementRules(bot, rules);
  })().catch(report('viewer.sticker'));
  return true;
}
/**
 * A tap in 편집: on its list (a tab, a chip), on a button at the top (선택 · 그룹화 · 분리 · 없는것 숨김), or with
 * 선택 on, on a tile or a sticker (picked, or let go).
 */
async function editTap(p: HostPoint): Promise<void> {
  if (!editing) return;
  // Never read since it was drawn (편집 just opened, a phone's bridge slow): its chips, the buttons and the stickers
  // read first. Then where the panel is now, read at the tap.
  if (!chipRects.length || !buttons.select) await measureEditing();
  const now = await panelNow();
  if (!editing) return;
  if (now.box && inside(p, now.box)) { panelRect = now.box; await panelTap(p, now.dx, now.dy); return; }
  const button = buttonAt(p);
  if (button) { await pressButton(button); return; }
  const tile = selecting ? tileAt(p) || [...stickers.keys()].find(k => { const r = stickers.get(k)!.r; return !!r && inside(p, r); }) || '' : '';
  if (tile) await togglePick(tile);
}
/**
 * The viewer's taps, 요소's first: 편집 takes every tap but the buttons' (its list's
 * chips; the click a drag ends with is nothing), and choices take theirs.
 */
export function elementsClick(p: HostPoint, onControl: boolean): boolean {
  if (!onControl && Date.now() < dragUntil) { dragUntil = 0; return true; }
  if (editing) {
    if (onControl) return false;
    void editTap(p).catch(report('viewer.elements'));
    return true;
  }
  // The popup up: a tap in it is the element's (Risu takes its buttons); one on its tile folds it, on another tile
  // opens that one; anywhere else folds it, and that is all the tap does, but a button of the viewer's does its own.
  const open = popSeen() ? popOpenSig() : '';
  if (open) {
    if (popCloseAt(p)) { void popClose().catch(report('viewer.pop')); return true; }
    if (popAt(p)) { popTapped(); return true; }
    const tile = onControl ? '' : tileAt(p);
    void (async () => { await popClose(); if (tile && tile !== open) await openTile(tile); })().catch(report('viewer.pop'));
    return !onControl;
  }
  const tile = onControl ? '' : tileAt(p);
  if (tile) { void openTile(tile).catch(report('viewer.pop')); return true; }
  const bar = onControl ? '' : barAt(p);
  if (bar) { void toggleFolded(bar).catch(report('viewer.sticker')); return true; }
  if (!onControl) for (const s of stickers.values()) if (s.r && inside(p, s.r)) {
    // The tap was the sticker's: its size may change with it (a <details>), so it is read again then.
    setTimeout(() => void measureStickers().catch(() => {}), 200);
    return true;
  }
  if (choicesOn && !onControl && choicesRect && inside(p, choicesRect)) {
    void choiceTap(p).catch(error => { report('viewer.choice')(error); const alert = risuHost()?.alertError; if (typeof alert === 'function') void Promise.resolve(alert.call(risuHost(), `[옴니 뷰어] ${String((error as Error)?.message || error)}`)).catch(() => {}); });
    return true;
  }
  return false;
}
