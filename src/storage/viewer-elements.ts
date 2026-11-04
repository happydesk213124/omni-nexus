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
 * from: where the kind is found, against the reply on stage: the reply itself (0), or the bot's message 1 or 2 after
 * it (a status panel a bot sends in a message of its own). fold (a sticker's): a title bar over it, which folds it
 * (folded) and moves it. Rules stored before these read as 0 and off; one stored as a sticker with live on (the first
 * build of 작동) reads as 작동.
 */
export type ElementFrom = 0 | 1 | 2;
export type ElementRole = 'sticker' | 'live' | 'choice';
export interface ElementRule { role: ElementRole; x: number; y: number; scale: number; hidden: boolean; always: boolean; from: ElementFrom; fold: boolean; folded: boolean }
export type ElementRules = Record<string, ElementRule>;
let cache: Record<string, ElementRules> | undefined;

async function load(): Promise<Record<string, ElementRules>> {
  if (cache) return cache;
  const raw = await psGet(VIEWER_ELEMENTS_KEY).catch(() => null);
  cache = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, ElementRules> : {};
  return cache;
}
const num = (v: unknown, fallback: number, lo: number, hi: number) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback; };
function clean(rule: (Partial<ElementRule> & { live?: unknown }) | undefined): ElementRule | null {
  const role = rule?.role === 'sticker' && rule.live === true ? 'live' : rule?.role;
  if (!rule || (role !== 'sticker' && role !== 'live' && role !== 'choice')) return null;
  return {
    role, x: num(rule.x, 4, 0, 96), y: num(rule.y, 12, 0, 96), scale: num(rule.scale, 1, 0.4, 1.5), hidden: rule.hidden === true, always: rule.always === true,
    from: rule.from === 1 || rule.from === 2 ? rule.from : 0, fold: rule.fold === true, folded: rule.folded === true,
  };
}
/** The bot's registered kinds, by signature; a stored row that is not a rule is left out. */
export async function elementRules(botId: string): Promise<ElementRules> {
  const out: ElementRules = {};
  for (const [sig, rule] of Object.entries((await load())[botId] ?? {})) { const r = clean(rule); if (r) out[sig] = r; }
  return out;
}
export async function saveElementRules(botId: string, rules: ElementRules): Promise<void> {
  if (!botId) return;
  const all = await load();
  if (Object.keys(rules).length) all[botId] = rules; else delete all[botId];
  await psSet(VIEWER_ELEMENTS_KEY, all);
}
export function resetViewerElements(): void { cache = undefined; }
