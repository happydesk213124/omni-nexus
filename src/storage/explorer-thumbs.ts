/**
 * Explorer grid thumbs: bytes → Blob → object URL.
 * Overlay display URLs stay on the other cache and are not used here.
 */

import { sniffImageMime } from '../core/util/bytes';
import { explorerThumbCache } from './blob-url-cache';
import { imagePng } from './stores';
import { listedShotAsset, readShotAssetBytes } from './shot-character';

export function resolveExplorerThumbUrl(cardOrId: unknown): string {
  const id = typeof cardOrId === 'string' ? cardOrId : (cardOrId as { id?: unknown } | null)?.id;
  if (!id) return '';
  return explorerThumbCache.get(String(id)) || '';
}

type PendingThumb = { promise:Promise<string>; cancelled:boolean };
const pending = new Map<string,PendingThumb>();
const queue: Array<()=>Promise<void>> = [];
let active=0;
function pump():void {
  while(active<3 && queue.length) {
    active++;
    void queue.shift()!().finally(()=>{active--;pump();});
  }
}

export function ensureExplorerThumbUrl(id: string): Promise<string> {
  const key = String(id || '');
  if (!key) return Promise.resolve('');
  const hit = explorerThumbCache.get(key);
  if (hit) return Promise.resolve(hit);
  const existing=pending.get(key);
  if(existing)return existing.promise;
  let resolve!:(url:string)=>void, reject!:(error:unknown)=>void;
  const task:PendingThumb={cancelled:false,promise:new Promise<string>((yes,no)=>{resolve=yes;reject=no;})};
  pending.set(key,task);
  queue.push(async()=>{
    try {
      if(task.cancelled){resolve('');return;}
      // The explorer already knows the file path. Do not rediscover every bot
      // or retain full-size pixels in the legacy card store to make a thumbnail.
      const asset=listedShotAsset(key);
      const png = asset ? await readShotAssetBytes(asset.path) : await imagePng(key);
      if(task.cancelled || !png?.byteLength || (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function')){resolve('');return;}
      const mime = sniffImageMime(png);
      const url = URL.createObjectURL(new Blob([new Uint8Array(png)], { type: mime || 'image/png' }));
      explorerThumbCache.set(key, url, png.byteLength);
      resolve(url);
    } catch(error){reject(error);}
    finally {if(pending.get(key)===task)pending.delete(key);}
  });
  pump();
  return task.promise;
}

export async function warmExplorerThumbs(ids: unknown[] = []): Promise<string[]> {
  const list = [...new Set((ids || []).map(String).filter(Boolean))];
  await Promise.all(list.map((id) => ensureExplorerThumbUrl(id)));
  return list.map((id) => resolveExplorerThumbUrl(id)).filter(Boolean);
}

export function dropExplorerThumbUrl(id: unknown): void {
  const key=String(id || '');
  const task=pending.get(key);
  if(task){task.cancelled=true;pending.delete(key);}
  explorerThumbCache.drop(key);
}

export function retainExplorerThumbs(ids: unknown[] = []): void {
  const keep=new Set(ids.map(String));
  for(const key of pending.keys())if(!keep.has(key))dropExplorerThumbUrl(key);
  explorerThumbCache.retainOnly(ids);
}

export function pinExplorerThumbs(ids: unknown[] = []): void {
  explorerThumbCache.pin(ids);
}
