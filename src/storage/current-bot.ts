import { risuHost } from '../core/host';
import { sessionIdHash, unifiedSessionIdForCharacter } from '../core/util/text';

/**
 * The bot open in Risu now, for reads that would otherwise look it up in the directory of every bot
 * (`getDatabase(['characters'])`: on upstream Risu every message of every chat) and then read it again.
 *
 * Nothing is kept on a timer. One read serves whoever asks while it is under way. A job that read the bot (a chat
 * request building its tag state) holds it while the job runs, so the job's later reads of the same bot read
 * nothing; it is let go when the job ends, and at once by any write of a character or a chat (`forgetBots`), so
 * nothing read before a write is used after it.
 *
 * Reads only. Writes keep finding their bot in the directory, which also refuses two bots with one id.
 */
type Row = Record<string, unknown>;
export interface Bot {
  char: Row;
  index: number;
  id: string;
  /** Every scope a read may name it by: its id, its unified scope, each chat's session id. */
  aliases: Set<string>;
  /** Each chat's index, by its session id. */
  chats: Map<string, number>;
}

const object = (v: unknown): Row | null => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Row : null;

/** A bot as read elsewhere (a whole character and its index), to hold for a job. Null when it is no bot. */
export function botFrom(value: unknown, index: number): Bot | null { return botOf(value, index); }

function botOf(value: unknown, index: number): Bot | null {
  const char = object(value), id = String(char?.chaId || char?.id || '');
  if (!char || !id || !Number.isInteger(index) || index < 0) return null;
  const chats = new Map<string, number>();
  (Array.isArray(char.chats) ? char.chats : []).forEach((chat, at) => {
    const chatId = String(object(chat)?.id || object(chat)?.chatId || '');
    if (chatId && chatId !== '__unified__') chats.set(`risu_${sessionIdHash(`${id}|${chatId}`)}`, at);
  });
  return { char, index, id, aliases: new Set([id, unifiedSessionIdForCharacter(id), ...chats.keys()]), chats };
}

let reading: Promise<Bot | null> | null = null;
// Who the open bot was at its last read (its index and names only, never its data): a scope naming someone else,
// with that bot still open, goes to the directory without a read of the open one.
let seen: { index: number; aliases: Set<string> } | null = null;
const held = new Map<string, { bot: Bot; jobs: number }>();
/**
 * Scopes whose bot is kept while an image job runs. Such a job asks for its bot dozens of times (its roster nine
 * times over, the character note, the shots already made), and each answer was the whole bot again, every chat of
 * it. While a scope is held, the bot read for it is kept until a write (`forgetBots`), and the first read after
 * that write is kept in turn: one read per write, not one per question. A write never uses a kept bot: each reads
 * its bot from the host itself, right before writing.
 */
const holds = new Map<string, number>();
const kept = new Map<string, Bot>();
/** Counts writes of a bot or a chat: a read begun before one is not kept after it. */
let botWrites = 0;
const wanted = (bot: Bot): boolean => { for (const scope of holds.keys()) if (bot.aliases.has(scope)) return true; return false; };
/** When the read of a bot began (`botReadEpoch()`), for `keepBot`. */
export function botReadEpoch(): number { return botWrites; }
/** A bot just read from the host (the open one, or another by its index): kept when a job holds one of its scopes. */
export function keepBot(bot: Bot | null, epoch: number): void { if (bot && epoch === botWrites && wanted(bot)) kept.set(bot.id, bot); }
/**
 * Which stretch of held jobs this is (0 when none runs): what was read once for the jobs of one stretch is kept
 * for them (the shared roster too), and never carried into the next.
 */
let stretch = 0;
export function heldStretch(): number { return holds.size ? stretch : 0; }
/** Holds a scope's bot for a job; the returned call lets it go. */
export function holdBotScope(scope: string): () => void {
  if (!scope) return () => {};
  if (!holds.size) stretch++;
  holds.set(scope, (holds.get(scope) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const left = (holds.get(scope) ?? 1) - 1;
    if (left > 0) holds.set(scope, left); else holds.delete(scope);
    for (const [id, bot] of kept) if (!wanted(bot)) kept.delete(id);
  };
}

/** The open bot: one read for everyone asking while it is under way. Null when the host cannot say. */
export function readOpenBot(): Promise<Bot | null> {
  if (reading) return reading;
  const host = risuHost();
  if (typeof host?.getCurrentCharacterIndex !== 'function' || typeof host.getCharacterFromIndex !== 'function') return Promise.resolve(null);
  const job = async (): Promise<Bot | null> => {
    const index = Number(await host.getCurrentCharacterIndex!());
    if (!Number.isInteger(index) || index < 0) return null;
    const epoch = botWrites;
    const bot = botOf(await host.getCharacterFromIndex!(index), index);
    // Not after a write that came meanwhile: what it names may be older than the write.
    if (bot && reading === read) { seen = { index, aliases: bot.aliases }; keepBot(bot, epoch); }
    return bot;
  };
  const read: Promise<Bot | null> = job().finally(() => { if (reading === read) reading = null; });
  reading = read;
  return read;
}

/** A bot a job holds, by any of its scopes; null when none is held for it. */
export function heldBot(scope: string): Bot | null {
  if (!scope) return null;
  for (const { bot } of held.values()) if (bot.aliases.has(scope)) return bot;
  for (const bot of kept.values()) if (bot.aliases.has(scope)) return bot;
  return null;
}

/**
 * The open bot if the scope names it: a held one at no cost; else the open bot is read (once for all asking).
 * Null for another bot's scope: the caller looks it up in the directory as before.
 */
export async function openBotFor(scope: string): Promise<Bot | null> {
  if (!scope) return null;
  const hit = heldBot(scope);
  if (hit) return hit;
  const host = risuHost();
  if (seen && !seen.aliases.has(scope) && typeof host?.getCurrentCharacterIndex === 'function') {
    // Still the bot seen last (one small call): this scope is someone else's.
    if (Number(await host.getCurrentCharacterIndex()) === seen.index) return null;
  }
  const bot = await readOpenBot();
  return bot && bot.aliases.has(scope) ? bot : null;
}

/** Runs a job with a bot it read held for its own later reads (and anyone's meanwhile); let go when it ends. */
export async function holdBot<T>(bot: Bot | null, job: () => Promise<T>): Promise<T> {
  if (!bot) return job();
  const slot = held.get(bot.id) ?? { bot, jobs: 0 };
  slot.bot = bot; slot.jobs++; held.set(bot.id, slot);
  try { return await job(); }
  finally { if (--slot.jobs <= 0 && held.get(bot.id) === slot) held.delete(bot.id); }
}

/** A character or chat was written: what was read before it is not used again. */
export function forgetBots(): void {
  held.clear();
  kept.clear();
  botWrites++;
  reading = null;
}
