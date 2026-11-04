import { sessionIdHash, unifiedSessionIdForCharacter } from '../core/util/text';

/**
 * The character a chat request has just read (inline-tagging reads it to know the chat), kept a few seconds for
 * the same request's read-only lookups. Its roster (the chat state, then again the asset looks) was each time read
 * anew: the bot found in a directory of every bot (on upstream Risu, every message of every chat), then the whole
 * character copied again. That was most of what a streaming-tags request cost the host.
 *
 * Only reads take it. Every write of a character drops it, so nothing is read from before a write.
 */
type Row = Record<string, unknown>;
const KEEP_MS = 5000;
let primed: { char: Row; index: number; id: string; aliases: Set<string>; at: number } | null = null;

export function primeCharacter(char: unknown, index: number): void {
  const row = char !== null && typeof char === 'object' && !Array.isArray(char) ? char as Row : null;
  const id = String(row?.chaId || row?.id || '');
  if (!row || !id || !Number.isInteger(index) || index < 0) return;
  // Every scope a roster read may name this bot by: its id, its unified scope, a chat's session.
  const chats = Array.isArray(row.chats) ? row.chats as Row[] : [];
  const sessions = chats.flatMap(chat => { const cid = String(chat?.id || chat?.chatId || ''); return cid ? [`risu_${sessionIdHash(`${id}|${cid}`)}`] : []; });
  primed = { char: row, index, id, aliases: new Set([id, unifiedSessionIdForCharacter(id), ...sessions]), at: Date.now() };
}

/** The primed character a scope names, while it is fresh; null otherwise. */
export function primedCharacter(scope: string): { char: Row; index: number; id: string } | null {
  if (!primed || !scope) return null;
  if (Date.now() - primed.at > KEEP_MS) { primed = null; return null; }
  return primed.aliases.has(scope) ? primed : null;
}

/** A character was written: what was read before is not read again. */
export function forgetPrimedCharacter(): void {
  primed = null;
}
