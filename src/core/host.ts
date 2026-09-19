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
