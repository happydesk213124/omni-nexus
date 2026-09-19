import { STORE_NAMES, STORE_KEY, SETTINGS_KEY, ROOM_INDEX_KEY, isRetiredStorageKey } from '../core/constants';
import { measureWrite } from '../core/write-metrics';
/**
 * Raw key/value access to Risu save-file storage.
 *
 * The live store is `pluginStorage` (moves with the save). Device IndexedDB
 * (`getLocalPluginStorage`) is only a fallback when the save API is missing,
 * plus leftover pixel reads. Image pixels stay in the shot module.
 */


import { dbg, dbgSpan } from '../core/debug';
import { risuHost } from '../core/host';
import { isSessionStorageKey, readSessionStorage, writeSessionStorage, removeSessionStorage } from './chat-session-store';

export interface KvApi {
  getItem?(key: string): Promise<unknown>;
  setItem?(key: string, value: unknown): Promise<unknown> | unknown;
  removeItem?(key: string): Promise<unknown> | unknown;
  keys?(): Promise<unknown>;
}

type UsableKvApi = KvApi & Required<Pick<KvApi, 'getItem' | 'setItem'>>;

export type StoreKind = 'idb' | 'plugin';

interface DeviceStore {
  readonly kind: StoreKind;
  readonly api: UsableKvApi;
}

const isUsable = (api: KvApi | null | undefined): api is UsableKvApi =>
  typeof api?.getItem === 'function' && typeof api?.setItem === 'function';

let deviceStorePromise: Promise<DeviceStore> | null = null;

function saveFileApi(): UsableKvApi | null {
  const api = risuHost()?.pluginStorage as KvApi | undefined;
  return isUsable(api) ? api : null;
}

/** Explicit migration only; never called while opening normal save storage. */
export async function importLegacyDeviceRows(): Promise<void> {
  const save=saveFileApi(), host=risuHost();
  if(!save || !host?.getLocalPluginStorage)return;
  const device=await host.getLocalPluginStorage() as KvApi;
  if(!isUsable(device))return;
  const listed=await device.keys?.();
  const keys=Array.isArray(listed)?listed:[SETTINGS_KEY,ROOM_INDEX_KEY,...STORE_NAMES.map(STORE_KEY)];
  for(const raw of keys) {
    const key=String(raw);
    if(!key.startsWith('onx_') || isRetiredStorageKey(key) || key.startsWith('onx_nximg_'))continue;
    const current=await save.getItem(key);
    if(current!=null && current!=='')continue;
    const value=await device.getItem(key);
    if(value!=null && value!=='')await save.setItem(key,value);
  }
}

export async function getDeviceStore(): Promise<DeviceStore> {
  if (deviceStorePromise) return deviceStorePromise;
  deviceStorePromise = (async (): Promise<DeviceStore> => {
    const g = risuHost();
    const save = saveFileApi();
    if (save) {
      const span = dbgSpan('storage.open');
      // Opening the live save must not enumerate or copy an older device store.
      span.end({ message: 'pluginStorage/save-file' });
      return { kind: 'plugin', api: save };
    }
    if (typeof g?.getLocalPluginStorage === 'function') {
      try {
        const api = (await g.getLocalPluginStorage()) as KvApi | null | undefined;
        if (isUsable(api)) {
          dbg('storage.open', { message: 'fallback idb (no pluginStorage)' }, 'warn');
          return { kind: 'idb', api };
        }
      } catch (err) {
        dbg('storage.open', { message: String((err as Error)?.message || err) }, 'error');
      }
    }
    dbg('storage.open', { message: 'no storage API' }, 'error');
    throw new Error('세이브 저장소(pluginStorage)를 사용할 수 없습니다.');
  })().catch((error: unknown) => {
    deviceStorePromise = null;
    throw error;
  });
  return deviceStorePromise;
}

function legacyPluginStorage(): KvApi | null {
  return saveFileApi();
}

export async function saveFileGet(key: string): Promise<unknown> {
  try {
    const api = saveFileApi();
    if (!api) return null;
    const v = await api.getItem(key);
    if (v != null && v !== '') return v;
    return null;
  } catch {
    return null;
  }
}

export async function saveFileSet(key: string, value: unknown): Promise<boolean> {
  const api = saveFileApi();
  if (!api) return false;
  const approx = approxBytes(value);
  try {
    await measureWrite('settings', key === 'onx_native_settings' ? 'config' : 'store', () => Promise.resolve(api.setItem(key, value)));
    if (approx > 8_000) dbg('storage.savefile.set', { message: key, bytes: approx, background: true });
    return true;
  } catch (err) {
    dbg(
      'storage.savefile.set',
      { message: `${key}: ${(err as Error)?.message || err}`, bytes: approx, background: true },
      'warn',
    );
    return false;
  }
}

export async function saveFileRemove(key: string): Promise<boolean> {
  if (!key) return false;
  try {
    const { kind } = await getDeviceStore();
    const host = risuHost();
    const hasSeparateIdb = typeof host?.getLocalPluginStorage === 'function';
    // pluginStorage is the live store. Never delete onx_* rows, and never
    // delete 1.x keys when this save file is the only backend.
    if (kind === 'plugin' && (String(key).startsWith('onx_') || !hasSeparateIdb)) {
      dbg('storage.savefile.remove.skip', { message: key, kind, background: true }, 'warn');
      return false;
    }
    const api = saveFileApi();
    if (typeof api?.removeItem !== 'function') return false;
    await api.removeItem(key);
    return true;
  } catch (err) {
    dbg(
      'storage.savefile.remove',
      { message: `${key}: ${(err as Error)?.message || err}`, background: true },
      'warn',
    );
    return false;
  }
}

/** Pixels that never moved into pluginStorage — leftover device-IDB `onx_nximg_*`. */
export async function leftoverIdbGet(key: string): Promise<unknown> {
  if (!key) return null;
  try {
    const g = risuHost();
    if (typeof g?.getLocalPluginStorage !== 'function') return null;
    const idb = (await g.getLocalPluginStorage()) as KvApi | null | undefined;
    if (!isUsable(idb)) return null;
    const v = await idb.getItem(key);
    if (v != null && v !== '') return v;
  } catch {
    /* leftover IDB is best-effort */
  }
  return null;
}

async function legacyPsGet(key: string, legacyKey?: string): Promise<unknown> {
  try {
    const { api } = await getDeviceStore();
    const v = await api.getItem(key);
    if (v != null && v !== '') return v;
    if (legacyKey) {
      const old = legacyPluginStorage();
      if (old?.getItem) {
        try {
          const legacy = await old.getItem(legacyKey);
          if (legacy != null && legacy !== '') {
            await api.setItem(key, legacy);
            return legacy;
          }
        } catch {
          /* legacy read is best-effort */
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

export async function psGet(key: string, legacyKey?: string): Promise<unknown> {
  const legacy = await legacyPsGet(key, legacyKey);
  return isSessionStorageKey(key) ? readSessionStorage(key, legacy) : legacy;
}

function approxBytes(value: unknown): number {
  if (typeof value === 'string') return value.length;
  try {
    return JSON.stringify(value).length;
  } catch {
    return 0;
  }
}

export async function psSet(key: string, value: unknown): Promise<boolean> {
  const { kind, api } = await getDeviceStore();
  if (isSessionStorageKey(key)) {
    await writeSessionStorage(key, value, api);
    return true;
  }
  const approx = approxBytes(value);
  const large = approx > 50_000;
  const span = large ? dbgSpan('storage.set.large') : null;
  try {
    await measureWrite('settings', key === 'onx_native_settings' ? 'config' : 'store', () => Promise.resolve(api.setItem(key, value)));
    if (span) span.end({ message: key, bytes: approx, kind, background: true });
    else if (approx > 8_000) dbg('storage.set', { message: key, bytes: approx, kind, background: true });
    return true;
  } catch (err) {
    if (span) span.fail(err, { message: key, bytes: approx, kind, background: true });
    else {
      dbg(
        'storage.set',
        { message: `${key}: ${(err as Error)?.message || err}`, bytes: approx, kind, background: true },
        'error',
      );
    }
    throw err;
  }
}

export async function psRemove(key: string): Promise<void> {
  if (isSessionStorageKey(key)) {
    if (await removeSessionStorage(key)) return;
  }
  try {
    const { api } = await getDeviceStore();
    if (api?.removeItem) await api.removeItem(key);
  } catch {
    /* removal is best-effort */
  }
}

export function resetDeviceStore(): void {
  deviceStorePromise = null;
}
