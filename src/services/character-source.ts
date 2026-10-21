import { risuHost } from '../core/host';
import { characterDirectory, directoryWarm } from '../storage/character-directory';

type Row = Record<string, unknown>;
const object = (v: unknown): Row | null => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Row : null;
const idOf = (c: Row | null | undefined) => String(c?.chaId || c?.id || '');

/**
 * One bot by index from the shared directory, so a tagging pass copies that bot
 * alone instead of every bot (on upstream Risu, with every chat of every bot).
 * undefined: this path cannot answer (no directory, or the bot sits elsewhere).
 */
async function byIndex(characterId: string): Promise<Row | null | undefined> {
  const host = risuHost();
  if (typeof host?.getCharacterFromIndex !== 'function') return undefined;
  const read = async (fresh: boolean): Promise<Row | null | 'moved' | undefined> => {
    const rows = await characterDirectory({ fresh });
    if (!rows) return undefined;
    const row = rows.find(r => (r.chaId || r.id) === characterId);
    if (!row) return null;
    const char = object(await host.getCharacterFromIndex!(row.index));
    return idOf(char) === characterId ? char : 'moved';
  };
  const warm = directoryWarm();
  let found = await read(false);
  // A reused directory may predate a new or reordered bot: read it again once.
  if (found === 'moved' || (found === null && warm)) found = await read(true);
  return found === 'moved' ? undefined : found;
}

/** Settings navigation may select a different bot from the live chat. */
export async function characterSource(characterId = ''): Promise<Record<string, unknown> | null> {
  const host = risuHost();
  if (!characterId) {
    const value = await host?.getCharacter?.();
    return value && typeof value === 'object' ? value as Record<string, unknown> : null;
  }
  const one = await byIndex(characterId);
  if (one !== undefined) return one;
  const db = await host?.getDatabase?.(['characters']);
  return (db?.characters || []).find(c => idOf(c as Row) === characterId) as Record<string, unknown> | undefined || null;
}
