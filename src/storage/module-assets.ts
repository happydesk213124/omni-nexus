import { risuHost } from '../core/host';

/**
 * PocketRisu moves every module's asset list out of the database into a server
 * "manifest" and keeps only a descriptor (`assetManifest: {id, count, …}`) in
 * the client. getDatabase() fills `assets` back in for plugins, fetching the
 * list in pages of 500; when any page fails (a slow remote link, a large module)
 * it logs a warning and hands the module over with the descriptor and no
 * `assets`. Reading it again is the only remedy the plugin API offers.
 */
export const MODULE_ASSET_RETRIES = 3;
const DELAYS_MS = [800, 2000, 4000];

type ModuleRow = { id?: unknown; namespace?: unknown; assets?: unknown; assetManifest?: unknown };

export function moduleAssetManifest(mod: ModuleRow | null | undefined): { count?: number } | null {
  const manifest = mod?.assetManifest;
  return manifest && typeof manifest === 'object' ? manifest as { count?: number } : null;
}

/** A module PocketRisu sent without its list: the descriptor is there, `assets` is not. */
export function moduleAssetsMissing(mod: ModuleRow | null | undefined): boolean {
  return !!mod && !Array.isArray(mod.assets) && !!moduleAssetManifest(mod);
}

function sameModule(a: ModuleRow, b: ModuleRow): boolean {
  const id = String(a.id || ''), ns = String(a.namespace || '');
  return (!!id && String(b.id || '') === id) || (!!ns && String(b.namespace || '') === ns);
}

/** The module's asset rows read again from getDatabase(), or null when every try came back without them. */
export async function refillModuleAssets(
  mod: ModuleRow,
  progress: (attempt: number) => void = () => {},
  stale: () => boolean = () => false,
  wait: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms)),
): Promise<unknown[] | null> {
  const host = risuHost();
  if (!host?.getDatabase) return null;
  for (let attempt = 1; attempt <= MODULE_ASSET_RETRIES; attempt++) {
    progress(attempt);
    await wait(DELAYS_MS[attempt - 1] ?? 4000);
    if (stale()) return null;
    try {
      const db = await host.getDatabase(['modules']) as { modules?: ModuleRow[] } | null;
      const fresh = (Array.isArray(db?.modules) ? db.modules : []).find(row => row && sameModule(mod, row));
      if (Array.isArray(fresh?.assets)) return fresh.assets;
    } catch { /* the next try asks again */ }
  }
  return null;
}

/**
 * Tagging's variant: one immediate re-read for all of them, and only when an
 * enabled module came without its list, so a healthy load costs nothing.
 */
export async function withRefilledModules<T extends ModuleRow>(modules: T[], wanted: (mod: T) => boolean): Promise<T[]> {
  const missing = modules.filter(mod => wanted(mod) && moduleAssetsMissing(mod));
  if (!missing.length) return modules;
  let fresh: ModuleRow[] = [];
  try {
    const db = await risuHost()?.getDatabase?.(['modules']) as { modules?: ModuleRow[] } | null;
    fresh = Array.isArray(db?.modules) ? db.modules : [];
  } catch { return modules; }
  return modules.map(mod => {
    if (!missing.includes(mod)) return mod;
    const row = fresh.find(other => other && sameModule(mod, other));
    return Array.isArray(row?.assets) ? { ...mod, assets: row.assets } : mod;
  });
}
