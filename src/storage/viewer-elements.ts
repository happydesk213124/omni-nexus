import { psGet, psSet } from './device-store';

/**
 * 옴니 뷰어's 요소, per bot: which kinds of a bot's own elements (its status panel, its
 * choice list) the reader registered, and as what. A sticker keeps its place on the
 * stage (percent of the frame), its size, whether it hides, and whether it shows even
 * with 요소 보기 off. A bot's classes are its own, so each bot keeps its own list.
 */
export const VIEWER_ELEMENTS_KEY = 'omniviewer.elements';
/**
 * role: a sticker (a copy, placed on the stage), 작동 (live: a tile on the stage; a tap opens the chat's own element in
 * the middle, its buttons Risu's), or a choice. One of them: a kind is never a sticker and 작동 at once.
 * from: where the kind is found, against the reply on stage: the reply itself (0), the bot's message 1 or 2 after it
 * (a status panel a bot sends in a message of its own), or the reader's message after it (3). fold (a sticker's): a
 * title bar over it, which folds it (folded) and moves it. group (a 작동's): the letter of its group ('' none), the
 * places one panel may come from, shown as one tile at the group's gx, gy (it opens the one in the newest message).
 * Rules stored before these read as 0 and off; one stored as a sticker with live on (the first build of 작동) reads as
 * 작동, and one grouped by the first build of groups (one group, on or off) as group A.
 *
 * A rule is keyed by its kind's signature and, when it is not the reply's, where it is found (elementKey): the same
 * panel may be registered from each tab, and grouped.
 */
export type ElementFrom = 0 | 1 | 2 | 3;
export type ElementRole = 'sticker' | 'live' | 'choice';
export interface ElementRule { role: ElementRole; x: number; y: number; scale: number; hidden: boolean; always: boolean; from: ElementFrom; fold: boolean; folded: boolean; group: string; gx: number; gy: number }
/** A group's letter. */
export const GROUP_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
export type ElementRules = Record<string, ElementRule>;
let cache: Record<string, ElementRules> | undefined;

async function load(): Promise<Record<string, ElementRules>> {
  if (cache) return cache;
  const raw = await psGet(VIEWER_ELEMENTS_KEY).catch(() => null);
  cache = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, ElementRules> : {};
  return cache;
}
const num = (v: unknown, fallback: number, lo: number, hi: number) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback; };
function clean(rule: (Omit<Partial<ElementRule>, 'group'> & { live?: unknown; group?: unknown }) | undefined): ElementRule | null {
  const role = rule?.role === 'sticker' && rule.live === true ? 'live' : rule?.role;
  if (!rule || (role !== 'sticker' && role !== 'live' && role !== 'choice')) return null;
  const x = num(rule.x, 4, 0, 96), y = num(rule.y, 12, 0, 96), g = rule.group;
  const group = role !== 'live' ? '' : typeof g === 'string' && g.length === 1 && GROUP_LETTERS.includes(g) ? g : g === true ? 'A' : '';
  return {
    role, x, y, scale: num(rule.scale, 1, 0.4, 1.5), hidden: rule.hidden === true, always: rule.always === true,
    from: rule.from === 1 || rule.from === 2 || rule.from === 3 ? rule.from : 0, fold: rule.fold === true, folded: rule.folded === true,
    group, gx: num(rule.gx, x, 0, 96), gy: num(rule.gy, y, 0, 96),
  };
}
/** A rule's key: its kind's signature (which never holds a space) and, when not the reply's, where it is found. */
export const elementKey = (sig: string, from: ElementFrom): string => from === 0 ? sig : `${sig} @${from}`;
export const elementSig = (key: string): string => key.split(' @')[0]!;
/** The bot's registered kinds, by key; a stored row that is not a rule is left out. Keyed as elementKey says. */
export async function elementRules(botId: string): Promise<ElementRules> {
  const out: ElementRules = {};
  // Rules stored keyed by the signature alone (all of them, before the tabs) keep it for the reply's.
  for (const [key, rule] of Object.entries((await load())[botId] ?? {})) { const r = clean(rule); if (r) out[elementKey(elementSig(key), r.from)] = r; }
  return out;
}
export async function saveElementRules(botId: string, rules: ElementRules): Promise<void> {
  if (!botId) return;
  const all = await load();
  if (Object.keys(rules).length) all[botId] = rules; else delete all[botId];
  await psSet(VIEWER_ELEMENTS_KEY, all);
}
export function resetViewerElements(): void { cache = undefined; }
