import { serializeModuleWrite } from './module-write';
/**
 * Gallery pixels in a dedicated Risu module.
 *
 * The images index still keys by card id. This module stores the bytes via
 * saveAsset and remembers the exact path in location.asset_path. A miss is a
 * missing image — plugin storage is not a pixel fallback.
 */
import { dbg } from '../core/debug';
import { hostHas, risuHost } from '../core/host';
import { asU8, sniffImageMime, u8ToArrayBuffer, type BytesLike } from '../core/util/bytes';
import { sleep } from '../core/util/async';
import { cleanText } from '../core/util/text';
import {
  SHOT_MODULE_ID,
  SHOT_MODULE_NAME,
  SHOT_MODULE_NS,
  asShotAssetRows,
  bounceEnabledModuleIds,
  idFromShotAssetName,
  isShotAssetName,
  normalizeAssetPath,
  parseShotModuleAssets,
  sanitizeSessionId,
  sanitizeShotId,
  sessionFromShotAssetName,
  shotAssetName,
} from '../domain/gallery/shot-assets';

type ModuleRow = {
  id?: string;
  name?: string;
  description?: string;
  namespace?: string;
  hideIcon?: boolean;
  lorebook?: unknown[];
  assets?: Array<[string, string, string] | unknown>;
};

const MIN_IMAGE_BYTES = 32;

function hostOrNull(): ReturnType<typeof risuHost> {
  return risuHost();
}

/**
 * How many shots our own index says exist. Injected rather than imported:
 * `stores.ts` sits above this module and importing it back would be a cycle.
 */
let knownShotCount: () => number = () => 0;

export function setKnownShotCount(fn: () => number): void {
  knownShotCount = fn;
}

/**
 * True when the host handed back an empty asset list for a module we know holds
 * shots. PocketRisu 1.11 loads module assets lazily, and a plugin that writes
 * back what it read in that state replaces the whole list with whatever it was
 * adding — this is how AssetGod users lost their character assets.
 *
 * Only the all-or-nothing case counts. A list that is merely shorter than our
 * index is a deletion the user really made, and refusing those writes would
 * strand the module for good.
 */
function assetListLooksUnloaded(raw: unknown): boolean {
  return parseShotModuleAssets(raw).length === 0 && knownShotCount() > 0;
}

/** Shots whose bytes landed but whose tuple could not be committed yet. */
const pendingShotTuples = new Map<string, ShotAssetSaved>();

/** Test seam: drops the held-back tuples and the injected count. */
export function resetShotModuleState(): void {
  pendingShotTuples.clear();
  knownShotCount = () => 0;
}

export function shotModuleAvailable(): boolean {
  return hostHas('saveAsset') && hostHas('readImage') && hostHas('getDatabase') && hostHas('setDatabase');
}

const HOST_ASSET_REFRESH = [
  'refreshModules',
  'refreshAssets',
  'hydrateModuleAssets',
  'refreshAssetList',
  'reloadAssets',
] as const;

/**
 * Rebuild the host's name→path map so `{{raw::inxshot_…}}` sees a just-written
 * gallery row. Touches enabledModules only — never the asset byte list.
 */
export async function refreshGalleryAssetLookup(): Promise<boolean> {
  const host = hostOrNull();
  if (!host) return false;
  for (const name of HOST_ASSET_REFRESH) {
    const fn = host[name];
    if (typeof fn !== 'function') continue;
    try {
      await (fn as () => unknown)();
      return true;
    } catch (err) {
      dbg('shot.module.asset-refresh.host.fail', { name, message: String((err as Error)?.message || err) }, 'warn');
    }
  }
  if (!hostHas('getDatabase') || !hostHas('setDatabase')) return false;
  await ensureDbAccess();
  return serializeModuleWrite(async () => {
  const db = await host.getDatabase!(['enabledModules']);
  if (!db) return false;
  const { off, on } = bounceEnabledModuleIds(db.enabledModules);
  try {
    await host.setDatabase!({ enabledModules: off as string[] });
    await sleep(16);
    await host.setDatabase!({ enabledModules: on as string[] });
    await sleep(16);
    return true;
  } catch (err) {
    dbg('shot.module.asset-refresh.fail', { message: String((err as Error)?.message || err) }, 'warn');
    return false;
  }
  });
}

async function ensureDbAccess(): Promise<void> {
  const host = hostOrNull();
  if (host && typeof host.requestPluginPermission === 'function') {
    try {
      await host.requestPluginPermission('db');
    } catch {
      /* already granted or older host */
    }
  }
}

function storeExtFromBytes(bytes: BytesLike): string {
  const mime = sniffImageMime(bytes);
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/png') return 'png';
  return 'webp';
}

function readModules(db: { modules?: unknown } | null | undefined): ModuleRow[] {
  return asShotAssetRows(db?.modules).filter((row): row is ModuleRow => Boolean(row && typeof row === 'object'));
}

function findModuleIndex(modules: ModuleRow[]): number {
  return modules.findIndex(
    (m) => cleanText(m?.id, 80) === SHOT_MODULE_ID || cleanText(m?.namespace, 80) === SHOT_MODULE_NS,
  );
}

function coerceImageBytes(data: unknown): ArrayBuffer | null {
  if (!data) return null;
  if (data instanceof ArrayBuffer) return data.byteLength >= MIN_IMAGE_BYTES ? data : null;
  if (data instanceof Uint8Array) {
    return data.byteLength >= MIN_IMAGE_BYTES ? u8ToArrayBuffer(data) : null;
  }
  if (typeof Blob !== 'undefined' && data instanceof Blob) return null;
  if (typeof data === 'string') {
    const m = data.match(/^data:[^;]+;base64,(.+)$/i);
    const payload = m?.[1] || (data.startsWith('data:') ? '' : data.replace(/\s+/g, ''));
    if (!payload) return null;
    try {
      const bin = atob(payload);
      if (bin.length < MIN_IMAGE_BYTES) return null;
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i += 1) u8[i] = bin.charCodeAt(i);
      return u8ToArrayBuffer(u8);
    } catch {
      return null;
    }
  }
  if (typeof data === 'object') {
    const rec = data as Record<string, unknown>;
    if (rec.data instanceof ArrayBuffer || rec.data instanceof Uint8Array || typeof rec.data === 'string') {
      return coerceImageBytes(rec.data);
    }
    if (Array.isArray(rec.data) && rec.data.every((n) => typeof n === 'number')) {
      const u8 = Uint8Array.from(rec.data as number[]);
      return u8.byteLength >= MIN_IMAGE_BYTES ? u8ToArrayBuffer(u8) : null;
    }
    if (typeof rec.length === 'number' && rec.length >= MIN_IMAGE_BYTES) {
      try {
        const u8 = Uint8Array.from(rec as unknown as ArrayLike<number>);
        return u8.byteLength >= MIN_IMAGE_BYTES ? u8ToArrayBuffer(u8) : null;
      } catch {
        return null;
      }
    }
  }
  return null;
}

export async function readShotAssetBytes(path: string): Promise<ArrayBuffer | null> {
  const host = hostOrNull();
  if (!host || typeof host.readImage !== 'function' || !path) return null;
  try {
    const data = await host.readImage(path);
    if (typeof Blob !== 'undefined' && data instanceof Blob) {
      const buf = await data.arrayBuffer();
      return buf.byteLength >= MIN_IMAGE_BYTES ? buf : null;
    }
    return coerceImageBytes(data);
  } catch (err) {
    dbg('shot.module.read.fail', {
      path: cleanText(path, 220),
      message: cleanText((err as Error)?.message ?? err, 220),
      background: true,
    }, 'warn');
    return null;
  }
}

function copyBytes(bytes: BytesLike): ArrayBuffer {
  return u8ToArrayBuffer(asU8(bytes));
}

/** Saves bytes and proves they can be read back, or null. No DB write. */
export async function storeShotBytes(
  id: string,
  bytes: BytesLike,
  sessionId: string,
  castIds?: readonly unknown[],
): Promise<{ path: string; name: string } | null> {
  const host = hostOrNull();
  if (!host || typeof host.saveAsset !== 'function') return null;
  const stored = copyBytes(bytes);
  if (stored.byteLength < MIN_IMAGE_BYTES) return null;
  const name = shotAssetName(id, storeExtFromBytes(stored), sessionId, castIds);
  if (!name) return null;
  const path = normalizeAssetPath(await host.saveAsset(stored));
  if (!path) return null;
  // The readback is what lets a caller drop its own copy of the bytes.
  const readBack = await readShotAssetBytes(path);
  if (!readBack || readBack.byteLength < MIN_IMAGE_BYTES) {
    dbg('shot.module.readback.fail', { id, path }, 'warn');
    return null;
  }
  return { path, name };
}

/** Upserts asset tuples into the module array in place. Mutates `modules`. */
function upsertShotTuples(modules: ModuleRow[], saved: ShotAssetSaved[]): void {
  if (!saved.length) return;
  let idx = findModuleIndex(modules);
  if (idx < 0) {
    modules.push({
      id: SHOT_MODULE_ID,
      name: SHOT_MODULE_NAME,
      description: '생성된 이미지. Inlay가 관리합니다.',
      namespace: SHOT_MODULE_NS,
      hideIcon: false,
      lorebook: [],
      assets: [],
    });
    idx = modules.length - 1;
  }
  const assets = parseShotModuleAssets(modules[idx]!.assets);
  for (const row of saved) {
    const same = assets.findIndex(
      (a) => idFromShotAssetName(a[0]) === sanitizeShotId(row.id) || a[0] === row.name,
    );
    if (same >= 0) assets[same] = [row.name, row.path, row.name];
    else assets.push([row.name, row.path, row.name]);
  }
  modules[idx] = {
    ...modules[idx],
    id: SHOT_MODULE_ID,
    name: SHOT_MODULE_NAME,
    namespace: SHOT_MODULE_NS,
    hideIcon: false,
    lorebook: Array.isArray(modules[idx]?.lorebook) ? modules[idx]!.lorebook : [],
    assets,
  };
}

export async function putShotAsset(
  id: string,
  bytes: BytesLike,
  sessionId?: string,
  castIds?: readonly unknown[],
): Promise<{ path: string; name: string } | null> {
  const saved = await putShotAssetsBatch([{ id, bytes, session_id: sessionId, cast_ids: castIds }]);
  const hit = saved[0];
  return hit ? { path: hit.path, name: hit.name } : null;
}

export type ShotAssetSaved = { id: string; path: string; name: string };

/**
 * Stores many shots against a single Risu DB commit.
 *
 * `getDatabase`/`setDatabase` rewrite the whole module array, so doing that per
 * image is what makes migrating a full gallery slow — the bytes are the cheap
 * part. Batching turns N DB round-trips into one.
 *
 * `saveAsset` stays sequential on purpose: it is a host call whose internals we
 * do not own, and a one-time migration is not worth racing it.
 */
export async function putShotAssetsBatch(
  entries: Array<{ id: string; bytes: BytesLike; session_id?: string; cast_ids?: readonly unknown[] }>,
): Promise<ShotAssetSaved[]> {
  const list = (Array.isArray(entries) ? entries : []).filter((e) => e && cleanText(e.id, 80));
  if (!list.length || !shotModuleAvailable()) return [];
  await ensureDbAccess();
  const host = hostOrNull();
  if (!host || typeof host.saveAsset !== 'function') return [];

  const saved: ShotAssetSaved[] = [];
  for (const entry of list) {
    const hit = await storeShotBytes(entry.id, entry.bytes, sanitizeSessionId(entry.session_id), entry.cast_ids);
    if (hit) saved.push({ id: entry.id, path: hit.path, name: hit.name });
  }
  if (!saved.length) return [];

  // Read the DB only after the bytes are in, so a long batch cannot commit a
  // module array that went stale while we were writing assets.
  return serializeModuleWrite(async () => {
  const db = await host.getDatabase!(['modules', 'enabledModules']);
  if (!db) return [];
  const modules = readModules(db);
  const existing = findModuleIndex(modules);
  if (existing >= 0 && assetListLooksUnloaded(modules[existing]!.assets)) {
    // The rows still ship. Returning nothing here makes `idbPut` treat the shot
    // as lost and clear the image it just generated, which is worse than the
    // missing tuple: the bytes are stored and already read back once, so the
    // card displays from `asset_path` either way.
    for (const row of saved) pendingShotTuples.set(sanitizeShotId(row.id), row);
    dbg('shot.module.assets.unloaded', {
      message: `${saved.length} tuple(s) held back, ${knownShotCount()} known`,
      background: true,
    }, 'warn');
    return saved;
  }
  const enabled = asShotAssetRows(db.enabledModules).map((row) => cleanText(row, 200)).filter(Boolean);
  const moduleEnabled = enabled.includes(SHOT_MODULE_ID) || enabled.includes(SHOT_MODULE_NS);
  const held = [...pendingShotTuples.values()].filter((row) => !saved.some((s) => s.id === row.id));
  upsertShotTuples(modules, held.length ? [...held, ...saved] : saved);
  if (!moduleEnabled) enabled.push(SHOT_MODULE_ID);
  await host.setDatabase!({ modules: modules as never, enabledModules: enabled as string[] });
  pendingShotTuples.clear();
  return saved;
  });
}

export type ShotAssetRow = { id: string; session: string; path: string; name: string };

/**
 * Every stored shot, oldest first, straight from the module array.
 *
 * This is the one card inventory we can read without loading a single room
 * pack, which is what lets the explorer show all rooms at once. Insertion order
 * is generation order, so a newest-first view just reverses it.
 */
export async function listShotAssets(): Promise<ShotAssetRow[]> {
  if (!shotModuleAvailable()) return [];
  await ensureDbAccess();
  const host = hostOrNull();
  if (!host) return [];
  const db = await host.getDatabase!(['modules']);
  const modules = readModules(db);
  const idx = findModuleIndex(modules);
  if (idx < 0) return [];
  const out: ShotAssetRow[] = [];
  for (const [name, path] of parseShotModuleAssets(modules[idx]!.assets)) {
    if (!isShotAssetName(name)) continue;
    const id = idFromShotAssetName(name);
    if (id) out.push({ id, session: sessionFromShotAssetName(name), path, name });
  }
  return out;
}

export async function dropShotAsset(id: string): Promise<boolean> {
  if (!shotModuleAvailable()) return false;
  await ensureDbAccess();
  const host = hostOrNull();
  if (!host) return false;
  return serializeModuleWrite(async () => {
  const db = await host.getDatabase!(['modules', 'enabledModules']);
  const modules = readModules(db);
  const idx = findModuleIndex(modules);
  if (idx < 0) return false;
  const want = sanitizeShotId(id);
  // A held-back tuple for a deleted shot must not be revived by the next write.
  pendingShotTuples.delete(want);
  // An unloaded list needs no guard here: it filters to itself, so `kept` and
  // `assets` match and the early return below skips the write.
  const assets = parseShotModuleAssets(modules[idx]!.assets);
  const kept = assets.filter((row) => {
    if (!isShotAssetName(row[0])) return true;
    return idFromShotAssetName(row[0]) !== want;
  });
  if (kept.length === assets.length) return false;
  modules[idx] = { ...modules[idx], assets: kept };
  await host.setDatabase!({
    modules: modules as never,
    enabledModules: asShotAssetRows(db?.enabledModules).map((row) => cleanText(row, 200)).filter(Boolean) as string[],
  });
  return true;
  });
}
