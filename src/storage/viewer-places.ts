import { psGet, psSet } from './device-store';

/**
 * Where each reply opens, from its cast block (`"place"`), else from its first picture
 * (that shot's location). The blocks leave the reply when it is baked, so the viewer
 * reads the place from here.
 */
export const VIEWER_PLACES_KEY = 'omniviewer.places';
const KEEP = 300;
/** `rank`: who said it. 0 the cast block (where the reply opens); a picture, its block's number (1 for a whole reply tagged at once). */
type Places = Record<string, { place: string; at: number; rank?: number }>;
let cache: Places | undefined;
const keyOf = (characterId: string, chatId: string, messageId: string) => `${characterId}|${chatId}|${messageId}`;
async function load(): Promise<Places> {
  if (cache) return cache;
  const raw = await psGet(VIEWER_PLACES_KEY).catch(() => null);
  cache = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Places : {};
  return cache;
}
export async function rememberReplyPlace(characterId: string, chatId: string, messageId: string, place: string, rank = 0): Promise<void> {
  if (!characterId || !chatId || !messageId || !place) return;
  const all = await load(), key = keyOf(characterId, chatId, messageId), had = all[key];
  // The earlier word stands: a later picture never moves where the reply opens. The same
  // one again (its picture drawn anew) may.
  if (had && (had.rank ?? 0) < rank) return;
  if (had && had.place === place.slice(0, 400) && (had.rank ?? 0) === rank) return;
  all[key] = { place: place.slice(0, 400), at: Date.now(), ...(rank ? { rank } : {}) };
  const rows = Object.entries(all);
  if (rows.length > KEEP) for (const [k] of rows.sort((a, b) => a[1].at - b[1].at).slice(0, rows.length - KEEP)) delete all[k];
  await psSet(VIEWER_PLACES_KEY, all);
}
export async function replyPlace(characterId: string, chatId: string, messageId: string): Promise<string> {
  return (await load())[keyOf(characterId, chatId, messageId)]?.place || '';
}
export function resetViewerPlaces(): void { cache = undefined; }
