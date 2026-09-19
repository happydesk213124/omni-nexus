import { beginCharacterImage, endCharacterImage, characterImagesPending, characterImageRevision, publishCharacterImage } from '../core/character-ui-events';
import { writeMetrics } from '../core/write-metrics';
import { publishReferenceProgress, type ReferenceProgress } from '../core/reference-progress';
/**
 * `globalThis.__INLAY_NATIVE__` — the only backend surface the UI can see.
 *
 * The UI is a frozen, minified bundle that cannot be rebuilt from source, so
 * this object's shape is a hard contract: every property below is called by the
 * UI and none may be renamed, removed, or changed from sync to async. See
 * `docs/UI-CONTRACT.md`.
 *
 * Boot is lazy and idempotent. The UI calls `ready()` before its first request
 * and again after an error, so a failed boot must drop its cached promise and
 * allow a genuine retry instead of replaying the same failure forever.
 */

import { VERSION } from '../core/constants';
import { clearDebug, dbg, debugSnapshot, setDebugCounts, setDebugMemory, startStallMonitor } from '../core/debug';
import { errorBody, isFetchError, makeFetchError } from '../core/errors';
import { hostHas } from '../core/host';
import { routeFetch } from '../api/router';
import { getDeviceStore } from '../storage/device-store';
import { ensureBlobUrl, imageUrlStats, pngToDataUrl, resolveImageUrl, subscribeImageUrl, warmImages, warmProgress, warmFocusProgress, onWarmProgress, pinImageUrls, retainImageUrls, dropImageUrl, prioritizeWarmFocus, clearWarmFocus } from '../storage/image-urls';
import { dropExplorerThumbUrl, ensureExplorerThumbUrl, pinExplorerThumbs, resolveExplorerThumbUrl, retainExplorerThumbs, warmExplorerThumbs } from '../storage/explorer-thumbs';
import { loadSettingsFromStorage } from '../storage/settings-store';
import { blobUrlCount, imageMeta, idbGet, imageCacheStats, isStorageMigrated, knownCharRefHashCount, openDb, storeSize } from '../storage/stores';
import { setKnownCharRefCount } from '../services/char-ref-module';
import {
  getConfig,
  getRefPreviewUrl,
  getVibePreviewUrl,
  setConfig,
  setRefPreviewUrl,
  setVibePreviewUrl,
} from '../services/context';
import { ensureInrayDisplayModule } from '../storage/inray-display-module';
import { migrateAppearanceToCharacters, migrateCharacterIdentity } from '../services/characters';
import { hydratePresetVibePreviews } from '../services/nai-assets';
import { hydratePresetLookPreviews } from '../services/preset-look';
import { seedPrompts } from '../services/settings';
import { closeTagStudio, openTagStudio } from '../tag-studio/mount';
import {
  bindCharacterExampleShot,
  bindCharacterHeaderRef,
  closeCharacterCommandEdit,
  closeImagePeek,
  openCharacterCommandEdit,
  openImagePeek,
  paintExampleSlot,
  paintHeaderRefSlot,
  readCharacterFromForm,
  setGenSpin,
} from '../char-command/mount';

let readyPromise: Promise<void> | null = null;

async function boot(): Promise<void> {
  dbg('boot.ready.start', { message: VERSION });
  await openDb();
  const store = await getDeviceStore().catch((err: unknown) => {
    dbg('boot.storage', { message: String((err as Error)?.message || err) }, 'error');
    throw err;
  });
  dbg('boot.storage', { message: store.kind });

  setConfig(await loadSettingsFromStorage());
  if (getConfig().card?.persist_chat_images) {
    void ensureInrayDisplayModule(getConfig().card?.persist_chat_images_folded === true, getConfig().card?.inline_chat_scale_pct).catch((err: unknown) => {
      dbg('boot.inray-display', { message: String((err as Error)?.message || err) }, 'warn');
    });
  }
  await seedPrompts();
  dbg('boot.ready.done', {
    message: VERSION,
    has_nativeFetch: hostHas('nativeFetch'),
    has_idb: hostHas('getLocalPluginStorage'),
  });
}

// Previews are UI data, not a boot dependency.
const previewHydration = new Map<string,Promise<void>>();
async function hydrateSettingsPreviews(tab: string): Promise<boolean> {
  if (!['gen_options','style_presets'].includes(tab)) return false;
  const first=!previewHydration.has(tab);
  if (!previewHydration.has(tab)) previewHydration.set(tab,(async () => {
    if(tab==='style_presets') {
      await Promise.all([hydratePresetVibePreviews(),hydratePresetLookPreviews()]);
    } else {
      const ref = await idbGet('meta', 'reference_image');
      if (ref?.png) setRefPreviewUrl(pngToDataUrl(ref.png));
      const vibe = await idbGet('meta', 'vibe_transfer');
      if (vibe?.png) setVibePreviewUrl(pngToDataUrl(vibe.png));
    }
  })().catch(error => { previewHydration.delete(tab); throw error; }));
  await previewHydration.get(tab);
  return first;
}

let rosterMigration:Promise<void> | null=null;
async function prepareLegacyRosters():Promise<void> {
  if(!rosterMigration)rosterMigration=(async()=>{
    if(!(await isStorageMigrated())) {await migrateAppearanceToCharacters();await migrateCharacterIdentity();}
  })().catch(error=>{rosterMigration=null;throw error;});
  await rosterMigration;
}

export async function ready(): Promise<boolean> {
  if (!readyPromise) {
    readyPromise = boot().catch((error: unknown) => {
      readyPromise = null;
      throw error;
    });
  }
  await readyPromise;
  return true;
}

/**
 * `timeoutMs` is accepted for contract compatibility but not enforced, matching
 * the deployed behaviour: image generation legitimately runs past the UI's
 * default, and cutting the request off would abandon an image the user has
 * already spent Anlas on.
 */
export async function fetch(
  path: string,
  options: Record<string, unknown> = {},
  _timeoutMs = 120000,
): Promise<unknown> {
  await ready();
  try {
    const body=(options.body && typeof options.body==='object'?options.body:{}) as Record<string,unknown>;
    const imagePath = path.split('?')[0]!;
    const imageKind = imagePath.includes('/example-shot') ? 'example' as const : 'ref' as const;
    const params = new URLSearchParams(path.split('?')[1] || '');
    const imageScope = String(body.scope || body.session_id || params.get('scope') || params.get('session_id') || '');
    const imageId = String(body.character_id || params.get('character_id') || '');
    const imageRequest = /^\/v1\/characters\/(example-shot|ref)(\/clear)?$/.test(imagePath) && !!imageId;
    const imageWrite=String(options.method||'GET').toUpperCase()!=='GET';
    const imageCurrent = imageRequest ? beginCharacterImage(imageScope,imageId,imageKind,String(options.method||'GET').toUpperCase()!=='GET') : ()=>true;
    const hydrationRevision = characterImagesPending() ? null : characterImageRevision();
    const tracked=String(options.method||'GET').toUpperCase()!=='GET' && /^\/v1\/(presets\/look(?:\/generate)?|characters\/(example-shot|ref))$/.test(path);
    const state:ReferenceProgress={kind:path.includes('/presets/')?'preset':'character',id:String(body.preset_id||body.character_id||body.id||(body.character as {id?:unknown})?.id||''),scope:String(body.scope||body.session_id||''),busy:true};
    if(tracked)publishReferenceProgress(state);
    let result;
    if(path.startsWith('/v1/characters'))await prepareLegacyRosters();
    try {
      result=await routeFetch(path, options);
      const data=result.data as Record<string,unknown>;
      if(result.status<400 && imageRequest && imageCurrent()) {
        publishCharacterImage({scope:imageScope,id:imageId,kind:imageKind,url:String(data?.preview_url||''),hash:data?.ref_hash!=null?String(data.ref_hash):data?.hash!=null?String(data.hash):data?.example_hash!=null?String(data.example_hash):data?.configured===false?'':undefined,configured:!!data?.configured});
      }
      if(result.status<400 && imagePath==='/v1/characters/ref/hydrate' && hydrationRevision===characterImageRevision()) {
        for (const [group,scope] of [['session',imageScope],['global','__global__']] as const) {
          for (const row of (Array.isArray(data[group])?data[group]:[]) as Array<Record<string,unknown>>) {
            if(scope)publishCharacterImage({scope,id:String(row.id||''),kind:'ref',url:String(row.preview_url||''),hash:String(row.hash||''),configured:!!row.configured});
            if(scope && (row.example_hash || row.example_preview_url))publishCharacterImage({scope,id:String(row.id||''),kind:'example',url:String(row.example_preview_url||''),hash:String(row.example_hash||''),configured:!!row.example_configured});
          }
        }
      }
      if(tracked && imageCurrent())publishReferenceProgress({...state,busy:false,error:result.status>=400?'참고컷 저장 실패':undefined,...(state.kind==='preset'?{url:String(data?.preview_url||'')}:{})});
    } catch(error) {if(tracked && imageCurrent())publishReferenceProgress({...state,busy:false,error:String(error)});throw error;}
    finally {if(imageRequest && imageWrite && imageCurrent())endCharacterImage(imageScope,imageId,imageKind);}
    if (result.raw) return result.data;
    if (result.status >= 400) throw makeFetchError(result.status, result.data);
    return result.data;
  } catch (err) {
    if (isFetchError(err)) throw err;
    const message = String((err as Error)?.message || err);
    throw makeFetchError(500, { ok: false, ...errorBody(message, 'internal') }, message);
  }
}

async function ensureImageUrl(id: string): Promise<string> {
  await ready();
  return ensureBlobUrl(id);
}

/** Publishes the bridge and feeds the debug snapshot its storage counters. */
export function installNativeBridge(): void {
  Reflect.set(globalThis,"__OMNI_IMAGE_META__",imageMeta);
  // Injected rather than imported so `core/debug` need not depend on storage.
  setDebugCounts(() => ({
    cards: storeSize('cards'),
    images: storeSize('images'),
    jobs: storeSize('jobs'),
    blob_urls: blobUrlCount(),
  }));
  setDebugMemory(() => ({ ...imageCacheStats(), encode: imageUrlStats() }));
  startStallMonitor();

  // Same reason: the reference-image module must be able to tell "no assets
  // stored" from "the host did not load them", and only the roster knows.
  setKnownCharRefCount(knownCharRefHashCount);

  Reflect.set(globalThis, '__INLAY_NATIVE__', {
    VERSION,
    writeMetrics,
    ready,
    hydrateSettingsPreviews,
    fetch,
    resolveImageUrl,
    refPreviewUrl: getRefPreviewUrl,
    vibePreviewUrl: getVibePreviewUrl,
    ensureImageUrl,
    // Inline shots place their markers first and fill each cell as its own id
    // resolves, so they never re-run a paint pass just to catch a late encode.
    subscribeImageUrl,
    warmImages,
    pinImageUrls,
    prioritizeWarmFocus,
    clearWarmFocus,
    retainImageUrls,
    dropImageUrl,
    resolveExplorerThumbUrl,
    ensureExplorerThumbUrl,
    warmExplorerThumbs,
    dropExplorerThumbUrl,
    retainExplorerThumbs,
    pinExplorerThumbs,
    warmProgress,
    warmFocusProgress,
    onWarmProgress,
    debug: debugSnapshot,
    clearDebug,
    openTagStudio,
    closeTagStudio,
    openCharacterCommandEdit,
    closeCharacterCommandEdit,
    openImagePeek,
    closeImagePeek,
    bindCharacterHeaderRef,
    paintHeaderRefSlot,
    bindCharacterExampleShot,
    paintExampleSlot,
    readCharacterFromForm,
    setGenSpin,
  });
}
