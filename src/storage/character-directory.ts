import { dbg } from '../core/debug';
import { risuHost } from '../core/host';

/**
 * Where each Risu character and chat sits, by index, with no message bodies.
 *
 * `getDatabase(['characters'])` is the only v3 call that lists every bot, and on
 * RisuNest it streams every message of every chat to build that list. Roster,
 * session, bake and asset lookups each need only this directory, often many times
 * in one job. A read in flight is shared, and a finished one is reused briefly.
 *
 * Reuse is safe because every consumer verifies the character id at the index it
 * then reads (a moved bot fails as "moved", as it would mid-call anyway), and a
 * lookup that finds nothing reads again (`fresh`) so a chat opened a moment ago is
 * never missed. Writes that route data by this list pass `fresh` themselves.
 */
type Row = Record<string, unknown>;
export interface DirectoryChat { index: number; id: string; chatId: string; name: string; modules: unknown }
export interface DirectoryCharacter {
  index: number; chaId: string; id: string; name: string; image: unknown; chatPage: unknown; chats: DirectoryChat[];
  /** Asset tuples only (names and paths): the gallery lists shots from these. */
  additionalAssets: unknown;
}
const REUSE_MS = 2000;
const SLOW_MS = 100;
const object = (v: unknown): Row | null => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Row : null;
let inFlight: { host: unknown; rows: Promise<DirectoryCharacter[] | null> } | null = null;
// Tied to the host object: a reloaded plugin (or a swapped test host) starts over.
let done: { host: unknown; at: number; rows: DirectoryCharacter[] } | null = null;

function project(list: unknown[]): DirectoryCharacter[] {
  return list.map((value, index) => {
    const c = object(value) || {};
    const chats = (Array.isArray(c.chats) ? c.chats : []).map((raw, at) => {
      const chat = object(raw) || {};
      return { index: at, id: String(chat.id ?? ''), chatId: String(chat.chatId ?? ''), name: String(chat.name ?? ''), modules: chat.modules };
    });
    return { index, chaId: String(c.chaId ?? ''), id: String(c.id ?? ''), name: String(c.name ?? ''), image: c.image, chatPage: c.chatPage, chats, additionalAssets: c.additionalAssets };
  });
}

/** Null when the host cannot list characters (no getDatabase, or permission refused). */
export async function characterDirectory(opts: { fresh?: boolean } = {}): Promise<DirectoryCharacter[] | null> {
  const host = risuHost();
  if (!opts.fresh && done && done.host === host && Date.now() - done.at < REUSE_MS) return done.rows;
  if (inFlight && inFlight.host === host) return inFlight.rows;
  if (typeof host?.getDatabase !== 'function') return null;
  const at = Date.now();
  const read = (async () => {
    const db = await host.getDatabase!(['characters']);
    if (!Array.isArray(db?.characters)) return null;
    const rows = project(db.characters as unknown[]);
    // Logged only when slow: a fast host (PocketRisu) would flood the job's short event log.
    const ms = Date.now() - at;
    if (ms >= SLOW_MS) dbg('host.characters', { ms, count: rows.length, chats: rows.reduce((n, r) => n + r.chats.length, 0) }, 'warn');
    done = { host, at: Date.now(), rows };
    return rows;
  })();
  inFlight = { host, rows: read };
  try { return await read; }
  finally { if (inFlight?.rows === read) inFlight = null; }
}

/**
 * True when the next plain read would reuse a finished one. Only then may a lookup that
 * finds nothing read again: a miss in a read just made is final, so no lookup ever costs
 * more host reads than it did before the directory existed.
 */
export function directoryWarm(): boolean {
  return !!done && done.host === risuHost() && Date.now() - done.at < REUSE_MS;
}

/** For tests and for code that just changed the character list itself. */
export function forgetCharacterDirectory(): void { done = null; }
