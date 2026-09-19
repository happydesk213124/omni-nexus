import type { CharacterRecord } from './types';
export type CharacterImageKind = 'ref' | 'example';
export interface CharacterImageChange { scope:string; id:string; kind:CharacterImageKind; url:string; hash?:string; configured:boolean }
const revisions = new Map<string,number>();
const pending = new Set<string>();
const previews = new Map<string,CharacterImageChange>();
const listeners = new Set<(change:CharacterImageChange)=>void>();
const key = (scope:string,id:string,kind:CharacterImageKind) => JSON.stringify([scope==='global'?'__global__':scope,id,kind]);
export function beginCharacterImage(scope:string,id:string,kind:CharacterImageKind, write = true):()=>boolean {
  const k=key(scope,id,kind), rev=(revisions.get(k)||0)+(write ? 1 : 0);
  const blocked=!write && pending.has(k);
  if(write){revisions.set(k,rev);pending.add(k);}
  return ()=>!blocked && (revisions.get(k)||0)===rev;
}
export function endCharacterImage(scope:string,id:string,kind:CharacterImageKind):void {pending.delete(key(scope,id,kind));}
export function characterImagesPending():boolean {return pending.size>0;
}
export function characterImageRevision():string { return JSON.stringify([...revisions]); }
export function publishCharacterImage(change:CharacterImageChange):void {
  change={...change,scope:change.scope==='global'?'__global__':change.scope};
  previews.set(key(change.scope,change.id,change.kind),change);
  for(const listener of listeners)listener(change);
}
export function characterImages():CharacterImageChange[] { return [...previews.values()]; }
export function subscribeCharacterImages(listener:(change:CharacterImageChange)=>void):()=>void {listeners.add(listener);return ()=>{listeners.delete(listener);};}
export function characterImagePatch(change:CharacterImageChange):Partial<CharacterRecord> & Record<string,unknown> {
  return change.kind==='ref' ? {...(change.hash!==undefined?{ref_hash:change.hash}:{}),ref_preview_url:change.url,ref_configured:change.configured}
    : {...(change.hash!==undefined?{example_hash:change.hash}:{}),example_preview_url:change.url};
}
