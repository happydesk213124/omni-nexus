/**
 * Typed access to the Risu host object.
 *
 * The SDK declares `risuai` as a plain `const`, so touching it directly throws a
 * ReferenceError anywhere the plugin runs outside Risu — unit tests, the parity
 * harness, a stale host build. Every capability is also version-dependent: an
 * older Risu may not expose `getLocalPluginStorage`, `nativeFetch` or
 * `runLLMModel` at all.
 *
 * So all host access goes through here: one cast, in one file, and callers get
 * an optional value they are forced to narrow before use.
 */

/**
 * The host as we may actually find it: every member optional, plus room for
 * methods newer than our type definitions.
 */
export type RisuHost = Partial<RisuaiPluginAPI> & Record<string, unknown>;

export function risuHost(): RisuHost | undefined {
  const g = globalThis as { risuai?: RisuHost; Risuai?: RisuHost };
  return g.risuai ?? g.Risuai;
}

/** True when the host exposes a callable method of that name. */
export function hostHas(method: string): boolean {
  return typeof risuHost()?.[method] === 'function';
}

/**
 * Writes database keys (modules, the enabled list, personas). `setDatabaseLite` where the host has it: it assigns
 * the keys and no more. `setDatabase` also runs Risu's whole settings normaliser, which ends by marking every chat
 * of every bot as not streaming, so a module written while a reply streamed (a person registered from its first
 * block, the TTS module switched) told Risu, and our own "is it still streaming?" checks, that the reply was over.
 */
let databaseWrites = 0;
/** How many database writes we have made: what was read before the last one is older than it. */
export function hostDatabaseWrites(): number { return databaseWrites; }
export async function writeHostDatabase(patch: Record<string, unknown>): Promise<void> {
  const host = risuHost();
  databaseWrites++;
  const lite = host?.setDatabaseLite, full = host?.setDatabase;
  if (typeof lite === 'function') { await lite.call(host, patch as never); return; }
  if (typeof full !== 'function') throw new Error('Risu database writing unavailable');
  await full.call(host, patch as never);
}
