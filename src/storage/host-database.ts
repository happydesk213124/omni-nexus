import { hostDatabaseWrites, risuHost } from '../core/host';
import { heldStretch } from './current-bot';

/**
 * Risu's modules, with the enabled list and the personas, for reading.
 *
 * `getDatabase(['modules', …])` hands over every module in Risu, and on PocketRisu each one's asset list with it
 * (fetched from the server). An image job asked three times, each for its own reason: the shared roster (it lives
 * in a module), the assets a look may be drawn from, the persona. While a job holds its bot (current-bot), the
 * first of these reads the lot once and the rest are answered from it, for that job and the ones running beside it.
 * A module we write ourselves lets it go.
 *
 * Outside a job every call reads, and only the keys it names: nothing is kept then. Readers only read what they
 * are handed here, and a write reads for itself.
 */
const KEPT_KEYS = ['modules', 'enabledModules', 'moduleIntergration', 'personas', 'selectedPersona'];
type Db = Record<string, unknown>;
let kept: { stretch: number; host: unknown; writes: number; db: Promise<Db | null> } | null = null;

export async function readModulesDb(keys: readonly string[]): Promise<Db | null> {
  const host = risuHost(), stretch = heldStretch();
  if (typeof host?.getDatabase !== 'function') return null;
  if (!stretch || !keys.every(key => KEPT_KEYS.includes(key))) return await host.getDatabase([...keys]) as Db | null;
  const writes = hostDatabaseWrites();
  if (!kept || kept.stretch !== stretch || kept.host !== host || kept.writes !== writes) {
    const entry = { stretch, host, writes, db: Promise.resolve(host.getDatabase([...KEPT_KEYS])).then(db => db as Db | null) };
    // A read that failed is not an answer for the next asker.
    entry.db.then(db => { if (!db && kept === entry) kept = null; }, () => { if (kept === entry) kept = null; });
    kept = entry;
  }
  return kept.db;
}
