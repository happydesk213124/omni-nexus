import { hostDatabaseWrites, risuHost } from '../core/host';
import { sessionIdHash } from '../core/util/text';
import { psGet, psSet } from './device-store';

// Risu replaces the entire modules array. All plugin module writers share this queue.
let tail: Promise<unknown> = Promise.resolve();
export function serializeModuleWrite<T>(work: () => Promise<T>): Promise<T> {
  const result = tail.then(work);
  tail = result.catch(() => undefined);
  return result;
}

/**
 * Whether one of our modules is already as we would write it.
 *
 * Making sure of a module meant reading every module in Risu (`getDatabase(['modules'])`: on PocketRisu each one's
 * asset list with it, fetched from the server) and comparing: at every start once per module of ours, and again
 * before every bake. Now what was last written is written down: a mark of the module's content, kept in the save
 * beside the modules. When the mark matches what we would write, and Risu still has the module switched the way
 * we want (the enabled list alone: a few ids), nothing more is read. A module changed by hand keeps the change
 * until its content next changes (a setting, a new build), where each start used to put ours back.
 */
const MARKS_KEY = 'onx_module_marks';
const ENABLED_REUSE_MS = 60_000;
let marks: Promise<Record<string, string>> | null = null, marksHost: unknown = null;
// Read before a database write of ours (`writes`), the list is older than that write.
let enabledIds: { host: unknown; at: number; writes: number; ids: Promise<string[] | null> } | null = null;

/** A short mark of anything that goes into a module: equal content, equal mark. */
export function moduleMark(content: unknown): string { return sessionIdHash(JSON.stringify(content)); }

function storedMarks(): Promise<Record<string, string>> {
  const host = risuHost();
  if (marks && marksHost === host) return marks;
  marksHost = host;
  return marks = psGet(MARKS_KEY).then(raw => (raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...(raw as Record<string, string>) } : {}), () => ({}));
}
function enabledModuleIds(): Promise<string[] | null> {
  const host = risuHost();
  if (enabledIds && enabledIds.host === host && enabledIds.writes === hostDatabaseWrites() && Date.now() - enabledIds.at < ENABLED_REUSE_MS) return enabledIds.ids;
  const ids = (async () => {
    try {
      const db = await host?.getDatabase?.(['enabledModules']);
      return Array.isArray(db?.enabledModules) ? db.enabledModules.map(String) : null;
    } catch { return null; }
  })();
  enabledIds = { host, at: Date.now(), writes: hostDatabaseWrites(), ids };
  return ids;
}
/** True when the module was last written with this mark and Risu has it switched as `enabled` says (by any of `ids`). */
export async function moduleCurrent(ids: string | readonly string[], mark: string, enabled: boolean): Promise<boolean> {
  const names = typeof ids === 'string' ? [ids] : ids;
  if ((await storedMarks())[names[0]!] !== mark) return false;
  const on = await enabledModuleIds();
  return !!on && names.some(id => on.includes(id)) === enabled;
}
/** The module is now as `mark` says (written, or found already so). */
export async function noteModuleMark(id: string, mark: string): Promise<void> {
  const all = await storedMarks();
  if (all[id] === mark) return;
  all[id] = mark;
  try { await psSet(MARKS_KEY, all); } catch { /* made sure of again at the next start */ }
}
/** For tests and a reloaded host. */
export function forgetModuleMarks(): void { marks = null; enabledIds = null; }
