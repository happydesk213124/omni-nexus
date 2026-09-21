import { risuHost } from '../core/host';

/** Settings navigation may select a different bot from the live chat. */
export async function characterSource(characterId = ''): Promise<Record<string, unknown> | null> {
  const host = risuHost();
  if (!characterId) {
    const value = await host?.getCharacter?.();
    return value && typeof value === 'object' ? value as Record<string, unknown> : null;
  }
  const db = await host?.getDatabase?.(['characters']);
  return (db?.characters || []).find(c => String(c.chaId || c.id || '') === characterId) as Record<string, unknown> | undefined || null;
}
