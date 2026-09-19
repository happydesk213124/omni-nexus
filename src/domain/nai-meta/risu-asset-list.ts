/**
 * Pure helpers: list Risu character / module assets for NAI tag matching.
 *
 * Mirrors Risu's getModules() id sources (global enabled, chat, character,
 * persona embedded, moduleIntergration) and getModuleAssets() concat.
 */
import { isCharRefAssetName } from '../character/char-ref-store.ts';
import { cleanText } from '../../core/util/text.ts';

export interface RisuNamedAsset {
  name: string;
  key: string;
}

/** Parse additionalAssets / module.assets rows: [name, path, type?] or {name,key}. */
export function parseRisuAssetRows(raw: unknown): RisuNamedAsset[] {
  if (!Array.isArray(raw)) return [];
  const out: RisuNamedAsset[] = [];
  for (const row of raw) {
    if (Array.isArray(row)) {
      const name = cleanText(row[0], 400);
      const key = cleanText(row[1], 800);
      if (name && key && !isCharRefAssetName(name)) out.push({ name, key });
      continue;
    }
    if (row && typeof row === 'object') {
      const r = row as Record<string, unknown>;
      const name = cleanText(r.name ?? r.assetName ?? r.fileName, 400);
      const key = cleanText(r.key ?? r.path ?? r.id ?? r.asset, 800);
      if (name && key && !isCharRefAssetName(name)) out.push({ name, key });
    }
  }
  return out;
}

function pushIdList(out: string[], raw: unknown): void {
  if (!Array.isArray(raw)) return;
  for (const id of raw) {
    const s = cleanText(id, 200);
    if (s) out.push(s);
  }
}

/**
 * Module ids that Risu treats as active for the current character/chat/persona.
 */
export function collectEnabledModuleIds(opts: {
  enabledModules?: unknown;
  characterModules?: unknown;
  chatModules?: unknown;
  moduleIntergration?: unknown;
  /** When set, the persona-embedded module is active (same as Risu getModules). */
  personaEmbeddedModuleId?: unknown;
}): string[] {
  const out: string[] = [];
  pushIdList(out, opts.enabledModules);
  pushIdList(out, opts.chatModules);
  pushIdList(out, opts.characterModules);
  const embedded = cleanText(opts.personaEmbeddedModuleId, 200);
  if (embedded) out.push(embedded);
  if (typeof opts.moduleIntergration === 'string') {
    for (const part of opts.moduleIntergration.split(',')) {
      const s = part.trim();
      if (s) out.push(s);
    }
  }
  return out;
}

function moduleMatchesIds(mod: Record<string, unknown>, idSet: Set<string>): boolean {
  const id = cleanText(mod.id, 200);
  if (id && idSet.has(id)) return true;
  const ns = cleanText(mod.namespace, 200);
  return Boolean(ns && idSet.has(ns));
}

/**
 * Assets from modules whose id or namespace is in `enabledIds`.
 * `poolExtra` modules are searched the same way (persona.embeddedModule lives
 * outside db.modules). Pass `forceAssets` for rows that must be included when
 * the active persona has an embedded module (Risu activates it while selected).
 */
export function assetsFromEnabledModules(
  modules: readonly unknown[],
  enabledIds: readonly string[],
  poolExtra: readonly unknown[] = [],
): RisuNamedAsset[] {
  if (!enabledIds.length) return [];
  const idSet = new Set(enabledIds);
  const out: RisuNamedAsset[] = [];
  const seenMod = new Set<string>();

  const visit = (raw: unknown) => {
    if (!raw || typeof raw !== 'object') return;
    const mod = raw as Record<string, unknown>;
    if (!moduleMatchesIds(mod, idSet)) return;
    const mid = cleanText(mod.id, 200) || cleanText(mod.namespace, 200) || '';
    if (mid) {
      if (seenMod.has(mid)) return;
      seenMod.add(mid);
    }
    out.push(...parseRisuAssetRows(mod.assets));
  };

  for (const m of modules) visit(m);
  for (const m of poolExtra) visit(m);
  return out;
}

/** First occurrence of each storage key wins (character assets should come first). */
export function mergeNamedAssets(...lists: Array<readonly RisuNamedAsset[]>): RisuNamedAsset[] {
  const out: RisuNamedAsset[] = [];
  const seen = new Set<string>();
  for (const list of lists) {
    for (const a of list) {
      if (!a.name || !a.key || seen.has(a.key)) continue;
      seen.add(a.key);
      out.push(a);
    }
  }
  return out;
}

/** selectedPersona is a numeric index into personas[]. */
export function personaEmbeddedModule(db: unknown): unknown | null {
  if (!db || typeof db !== 'object') return null;
  const rec = db as Record<string, unknown>;
  if (!Array.isArray(rec.personas)) return null;
  const idx = typeof rec.selectedPersona === 'number' ? rec.selectedPersona : 0;
  const persona = rec.personas[idx];
  if (!persona || typeof persona !== 'object') return null;
  const embedded = (persona as Record<string, unknown>).embeddedModule;
  return embedded && typeof embedded === 'object' ? embedded : null;
}
