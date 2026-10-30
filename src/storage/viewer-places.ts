import { psGet, psSet } from './device-store';

/**
 * Where each reply opens, from its cast block (`"place"`). The block itself leaves
 * the reply when it is baked, so the viewer reads the place from here.
 */
export const VIEWER_PLACES_KEY = 'omniviewer.places';
const KEEP = 300;
type Places = Record<string, { place: string; at: number }>;
let cache: Places | undefined;
const keyOf = (characterId: string, chatId: string, messageId: string) => `${characterId}|${chatId}|${messageId}`;
async function load(): Promise<Places> {
  if (cache) return cache;
  const raw = await psGet(VIEWER_PLACES_KEY).catch(() => null);
  cache = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Places : {};
  return cache;
}
export async function rememberReplyPlace(characterId: string, chatId: string, messageId: string, place: string): Promise<void> {
  if (!characterId || !chatId || !messageId || !place) return;
  const all = await load();
  all[keyOf(characterId, chatId, messageId)] = { place: place.slice(0, 400), at: Date.now() };
  const rows = Object.entries(all);
  if (rows.length > KEEP) for (const [k] of rows.sort((a, b) => a[1].at - b[1].at).slice(0, rows.length - KEEP)) delete all[k];
  await psSet(VIEWER_PLACES_KEY, all);
}
export async function replyPlace(characterId: string, chatId: string, messageId: string): Promise<string> {
  return (await load())[keyOf(characterId, chatId, messageId)]?.place || '';
}
export function resetViewerPlaces(): void { cache = undefined; }
