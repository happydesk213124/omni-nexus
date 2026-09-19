/**
 * Risu module that holds compressed character reference images.
 * The roster stores only a hash; the module asset tuple owns the exact path
 * returned by saveAsset.
 */
import type { ApiResult } from '../core/types';
import { dbg } from '../core/debug';
import { hostHas, risuHost } from '../core/host';
import { asU8, sniffImageMime, u8ToArrayBuffer, sha256Hex, type BytesLike } from '../core/util/bytes';
import { encodeCharRefWebp } from '../core/util/image';
import { cleanText } from '../core/util/text';
import {
  CHAR_REF_MODULE_ID,
  CHAR_REF_MODULE_NAME,
  CHAR_REF_MODULE_NS,
  asUnknownArray,
  charRefAssetName,
  hashFromCharRefAssetName,
  isCharRefAssetName,
  parseCharRefModuleAssets,
  sanitizeHash,
} from '../domain/character/char-ref-store';

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
let assetIndex = new Map<string, string>();

function hostOrThrow(): NonNullable<ReturnType<typeof risuHost>> {
  const host = risuHost();
  if (!host) throw new Error('Risu 호스트가 없습니다');
  return host;
}

async function ensureDbAccess(): Promise<void> {
  const host = hostOrThrow();
  if (typeof host.requestPluginPermission === 'function') {
    try {
      await host.requestPluginPermission('db');
    } catch {
      // Already granted or older host.
    }
  }
}

function storeExtFromBytes(bytes: BytesLike): string {
  const mime = sniffImageMime(bytes);
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/png') return 'png';
  return 'webp';
}

function rebuildIndex(assets: Array<[string, string, string]>): void {
  assetIndex = new Map();
  for (const [name, path] of assets) {
    const hash = hashFromCharRefAssetName(name);
    if (hash && path) assetIndex.set(hash, path);
  }
}

function readModules(db: { modules?: unknown } | null | undefined): ModuleRow[] {
  return asUnknownArray(db?.modules).filter((row): row is ModuleRow => Boolean(row && typeof row === 'object'));
}

function findModuleIndex(modules: ModuleRow[]): number {
  return modules.findIndex(
    (m) => cleanText(m?.id, 80) === CHAR_REF_MODULE_ID || cleanText(m?.namespace, 80) === CHAR_REF_MODULE_NS,
  );
}

/**
 * How many reference hashes the roster still points at. Injected so this module
 * stays independent of the store it would otherwise have to import.
 */
let knownCharRefCount: () => number = () => 0;

export function setKnownCharRefCount(fn: () => number): void {
  knownCharRefCount = fn;
}

/**
 * True when the host returned an empty asset list for a module the roster says
 * holds reference images. Writing that list back replaces the module contents
 * with whatever we were adding — the failure that erased AssetGod users' assets
 * under PocketRisu 1.11's lazy asset loading.
 *
 * Only the empty case counts. A shorter list is a real deletion, and refusing
 * those writes would strand the module.
 */
function charRefListLooksUnloaded(raw: unknown): boolean {
  return parseCharRefModuleAssets(raw).length === 0 && knownCharRefCount() > 0;
}

/** Test seam: forgets the injected roster count. */
export function resetCharRefModuleState(): void {
  knownCharRefCount = () => 0;
}

export async function refreshCharRefAssetIndex(): Promise<Map<string, string>> {
  const mod = await ensureCharRefModule();
  rebuildIndex(parseCharRefModuleAssets(mod.assets));
  return assetIndex;
}

export async function ensureCharRefModule(): Promise<ModuleRow> {
  if (!hostHas('getDatabase') || !hostHas('setDatabase')) {
    throw new Error('모듈을 쓰려면 getDatabase / setDatabase가 필요합니다');
  }
  await ensureDbAccess();
  const host = hostOrThrow();
  const db = await host.getDatabase!(['modules', 'enabledModules']);
  if (!db) throw new Error('Risu 데이터베이스를 열 수 없습니다');
  const modules = readModules(db);
  let idx = findModuleIndex(modules);
  let changed = false;
  if (idx < 0) {
    modules.push({
      id: CHAR_REF_MODULE_ID,
      name: CHAR_REF_MODULE_NAME,
      description: '캐릭터 참고이미지. Inlay가 관리합니다.',
      namespace: CHAR_REF_MODULE_NS,
      hideIcon: false,
      lorebook: [],
      assets: [],
    });
    idx = modules.length - 1;
    changed = true;
  } else if (modules[idx]!.hideIcon || modules[idx]!.name !== CHAR_REF_MODULE_NAME) {
    // hideIcon on any enabled module makes the host stop rendering the chat
    // header (sender icon + name) for every card. Older builds set it here, so
    // repair the stored row instead of leaving the header hidden forever.
    modules[idx] = { ...modules[idx], hideIcon: false, name: CHAR_REF_MODULE_NAME };
    changed = true;
  }
  const enabled = asUnknownArray(db.enabledModules).map((id) => cleanText(id, 200)).filter(Boolean);
  const enabledSet = new Set(enabled);
  if (!enabledSet.has(CHAR_REF_MODULE_ID) && !enabledSet.has(CHAR_REF_MODULE_NS)) {
    enabled.push(CHAR_REF_MODULE_ID);
    changed = true;
  }
  const mod = modules[idx] || modules[modules.length - 1]!;
  if (charRefListLooksUnloaded(mod.assets)) {
    // Neither write nor reindex: the hideIcon repair above would carry the empty
    // list into storage, and rebuilding from it would drop paths the roster is
    // still using this session.
    dbg('char_ref.module.assets.unloaded', { known: knownCharRefCount(), background: true }, 'warn');
    return mod;
  }
  if (changed) {
    await host.setDatabase!({ modules: modules as never, enabledModules: enabled as string[] });
  }
  rebuildIndex(parseCharRefModuleAssets(mod.assets));
  return mod;
}

/**
 * Clears `hideIcon` on our module without creating one. Any enabled module with
 * `hideIcon` makes the host skip the chat header for every card, and the flag
 * lives in the host database — so it outlives a reload, a character switch and
 * even uninstalling the plugin. Returns the names of foreign modules that still
 * hide the header, since we must not touch those.
 */
export async function clearCharRefHideIcon(): Promise<{ cleared: boolean; blockedBy: string[] }> {
  if (!hostHas('getDatabase') || !hostHas('setDatabase')) return { cleared: false, blockedBy: [] };
  await ensureDbAccess();
  const host = hostOrThrow();
  const db = await host.getDatabase!(['modules', 'enabledModules']);
  const modules = readModules(db);
  const enabled = asUnknownArray(db?.enabledModules).map((id) => cleanText(id, 200)).filter(Boolean);
  const idx = findModuleIndex(modules);
  let cleared = false;
  if (idx >= 0 && charRefListLooksUnloaded(modules[idx]!.assets)) {
    // Clearing the flag rewrites the whole module row, empty asset list included.
    dbg('char_ref.module.assets.unloaded', { known: knownCharRefCount(), background: true }, 'warn');
    return { cleared: false, blockedBy: [] };
  }
  if (idx >= 0 && modules[idx]!.hideIcon) {
    modules[idx] = { ...modules[idx], hideIcon: false };
    await host.setDatabase!({ modules: modules as never, enabledModules: enabled as string[] });
    cleared = true;
  }
  const enabledSet = new Set(enabled);
  const blockedBy = modules
    .filter((m, i) => i !== idx && m.hideIcon)
    .filter((m) => enabledSet.has(cleanText(m.id, 80)) || enabledSet.has(cleanText(m.namespace, 80)))
    .map((m) => cleanText(m.name, 80) || cleanText(m.id, 80))
    .filter(Boolean);
  if (cleared || blockedBy.length) dbg('char_ref.module.hide_icon', { cleared, blockedBy });
  return { cleared, blockedBy };
}

function copyBytes(buf: BytesLike): Uint8Array {
  const src = asU8(buf);
  const out = new Uint8Array(src.byteLength);
  out.set(src);
  return out;
}

function normalizeAssetPath(path: string): string {
  return path.replace(/\\/g, '/').trim();
}

function coerceImageBytes(data: unknown): ArrayBuffer | null {
  if (!data) return null;
  if (data instanceof ArrayBuffer) return data.byteLength >= MIN_IMAGE_BYTES ? data : null;
  if (data instanceof Uint8Array) {
    return data.byteLength >= MIN_IMAGE_BYTES ? u8ToArrayBuffer(data) : null;
  }
  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    return null;
  }
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

async function readAssetBytes(path: string): Promise<ArrayBuffer | null> {
  const host = risuHost();
  if (!host || typeof host.readImage !== 'function') return null;
  try {
    const data = await host.readImage(path);
    if (typeof Blob !== 'undefined' && data instanceof Blob) {
      const buf = await data.arrayBuffer();
      return buf.byteLength >= MIN_IMAGE_BYTES ? buf : null;
    }
    return coerceImageBytes(data);
  } catch (err) {
    dbg('char_ref.module.read.fail', {
      path: cleanText(path, 220),
      message: cleanText((err as Error)?.message ?? err, 220),
      background: true,
    }, 'warn');
    return null;
  }
}

export async function putCharRefAsset(
  bytes: BytesLike,
  opts?: { quality?: number },
): Promise<{ hash: string; bytes: ArrayBuffer; path: string }> {
  const stored = await encodeCharRefWebp(bytes, opts?.quality);
  if (stored.byteLength < MIN_IMAGE_BYTES) throw new Error('참고 이미지가 비어 있습니다');
  const hash = sanitizeHash(await sha256Hex(stored));
  if (!hash) throw new Error('참고 이미지 해시를 만들지 못했습니다');
  if (!hostHas('getDatabase') || !hostHas('setDatabase')) {
    throw new Error('모듈을 쓰려면 getDatabase / setDatabase가 필요합니다');
  }
  await ensureDbAccess();
  const host = hostOrThrow();
  if (typeof host.saveAsset !== 'function') throw new Error('saveAsset을 쓸 수 없습니다');
  const db = await host.getDatabase!(['modules', 'enabledModules']);
  if (!db) throw new Error('Risu 데이터베이스를 열 수 없습니다');
  const modules = readModules(db);
  let idx = findModuleIndex(modules);
  const unloaded = idx >= 0 && charRefListLooksUnloaded(modules[idx]!.assets);
  if (!unloaded) rebuildIndex(idx >= 0 ? parseCharRefModuleAssets(modules[idx]!.assets) : []);
  const enabled = asUnknownArray(db.enabledModules).map((id) => cleanText(id, 200)).filter(Boolean);
  const moduleEnabled = enabled.includes(CHAR_REF_MODULE_ID) || enabled.includes(CHAR_REF_MODULE_NS);
  const existing = assetIndex.get(hash) || '';
  if (existing) {
    const check = await readAssetBytes(existing);
    if (check && check.byteLength >= MIN_IMAGE_BYTES) {
      if (!moduleEnabled) {
        enabled.push(CHAR_REF_MODULE_ID);
        await host.setDatabase!({ modules: modules as never, enabledModules: enabled as string[] });
      }
      return { hash, bytes: stored, path: existing };
    }
  }

  const ext = storeExtFromBytes(stored);
  const name = charRefAssetName(hash, ext);
  const payload = copyBytes(stored);
  const path = normalizeAssetPath(cleanText(await host.saveAsset(payload), 800));
  if (!path) throw new Error('모듈 에셋 저장에 실패했습니다');
  const readBack = await readAssetBytes(path);
  if (!readBack || readBack.byteLength < MIN_IMAGE_BYTES) {
    throw new Error('저장한 참고 이미지를 다시 읽지 못했습니다');
  }

  if (idx < 0) {
    modules.push({
      id: CHAR_REF_MODULE_ID,
      name: CHAR_REF_MODULE_NAME,
      description: '캐릭터 참고이미지. Inlay가 관리합니다.',
      namespace: CHAR_REF_MODULE_NS,
      hideIcon: false,
      lorebook: [],
      assets: [],
    });
    idx = modules.length - 1;
  }
  const assets = parseCharRefModuleAssets(modules[idx]!.assets);
  const sameHashIndex = assets.findIndex((row) => hashFromCharRefAssetName(row[0]) === hash);
  if (sameHashIndex >= 0) {
    assets[sameHashIndex] = [name, path, name];
  } else {
    assets.push([name, path, name]);
  }
  modules[idx] = {
    ...modules[idx],
    id: CHAR_REF_MODULE_ID,
    name: CHAR_REF_MODULE_NAME,
    namespace: CHAR_REF_MODULE_NS,
    hideIcon: false,
    lorebook: Array.isArray(modules[idx]?.lorebook) ? modules[idx]!.lorebook : [],
    assets,
  };
  if (!moduleEnabled) {
    enabled.push(CHAR_REF_MODULE_ID);
  }
  if (unloaded) {
    // The bytes are saved and read back, so hand the path to the roster and let
    // this session resolve it from memory. Committing would trade every existing
    // reference image for this one.
    assetIndex.set(hash, path);
    dbg('char_ref.module.assets.unloaded', { hash: hash.slice(0, 12), known: knownCharRefCount(), background: true }, 'warn');
    return { hash, bytes: stored, path };
  }
  await host.setDatabase!({ modules: modules as never, enabledModules: enabled as string[] });
  rebuildIndex(assets);
  dbg('char_ref.module.put', { hash: hash.slice(0, 12), bytes: stored.byteLength, ext, path });
  return { hash, bytes: stored, path };
}

export async function getCharRefAssetBytes(hash: unknown): Promise<ArrayBuffer | null> {
  const h = sanitizeHash(hash);
  if (!h) return null;
  if (!assetIndex.size) await refreshCharRefAssetIndex().catch(() => assetIndex);
  let path = assetIndex.get(h) || '';
  if (!path) {
    await refreshCharRefAssetIndex().catch(() => assetIndex);
    path = assetIndex.get(h) || '';
  }
  if (!path) return null;
  return readAssetBytes(path);
}

export async function clearAllCharRefModuleAssets(): Promise<number> {
  await ensureDbAccess();
  const host = hostOrThrow();
  if (!hostHas('getDatabase') || !hostHas('setDatabase')) return 0;
  const db = await host.getDatabase!(['modules', 'enabledModules']);
  const modules = readModules(db);
  const idx = findModuleIndex(modules);
  if (idx < 0) {
    assetIndex = new Map();
    return 0;
  }
  if (charRefListLooksUnloaded(modules[idx]!.assets)) {
    // "Clear everything" on a list we cannot see would clear assets we never read.
    dbg('char_ref.module.assets.unloaded', { known: knownCharRefCount(), background: true }, 'warn');
    return 0;
  }
  const assets = parseCharRefModuleAssets(modules[idx]!.assets);
  const kept = assets.filter((row) => !isCharRefAssetName(row[0]));
  const removed = assets.length - kept.length;
  modules[idx] = { ...modules[idx], assets: kept };
  await host.setDatabase!({
    modules: modules as never,
    enabledModules: asUnknownArray(db?.enabledModules).map((id) => cleanText(id, 200)).filter(Boolean) as string[],
  });
  assetIndex = new Map();
  return removed;
}

export async function resetCharRefLibrary(): Promise<ApiResult> {
  const removed = await clearAllCharRefModuleAssets();
  return { ok: true, removed };
}
