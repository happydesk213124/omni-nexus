import { measureWrite } from '../core/write-metrics';
/** Character-owned gallery assets; never toggle module activation to publish pixels. */
import { risuHost } from '../core/host';
import { sessionIdHash, unifiedSessionIdForCharacter } from '../core/util/text';
import type { BytesLike } from '../core/util/bytes';
import { serializeSessionStorage } from './chat-session-store';
import { storeShotBytes, readShotAssetBytes, type ShotAssetRow } from './shot-module';
import { isShotAssetName, idFromShotAssetName, sessionFromShotAssetName } from '../domain/gallery/shot-assets';
export { readShotAssetBytes };
type Row=Record<string,unknown>;
type Target={id:string;index:number};
const obj=(v:unknown):Row=>v && typeof v==='object' && !Array.isArray(v)?v as Row:{};
async function directory() {
 const db=await risuHost()?.getDatabase?.(['characters']);
 return (Array.isArray(db?.characters)?db.characters:[]).map((v:unknown,index:number)=>({char:obj(v),index}));
}
export async function resolveShotOwner(location:Row={}):Promise<Target> {
 const id=String(location.asset_owner_character_id || location.character_id || ''),sid=String(location.session_id || '');
 const hint=Number(location.char_index ?? await risuHost()?.getCurrentCharacterIndex?.());
 if(Number.isInteger(hint)&&hint>=0 && id) {
  const char=obj(await risuHost()?.getCharacterFromIndex?.(hint));
  if(String(char.chaId || char.id)===id)return {id,index:hint};
 }
 const rows=await directory();
 let matches=rows.filter(({char})=>{
  const key=String(char.chaId || char.id || '');
  if(id) return key===id;
  return sid && (sid===key || sid===unifiedSessionIdForCharacter(key) || (Array.isArray(char.chats)?char.chats:[]).some(v=>sid==='risu_'+sessionIdHash(key+'|'+String(obj(v).id || ''))));
 });
 if (!id && matches.length===0) {
  const current=await risuHost()?.getCurrentCharacterIndex?.();
  matches=rows.filter(({char,index})=>String(char.chaId || char.id)===String(current) || index===Number(current));
 }
 if(matches.length!==1) throw new Error('Image target character missing or ambiguous');
 return {id:String(matches[0]!.char.chaId || matches[0]!.char.id),index:matches[0]!.index};
}
async function read(target:Target) {
 const host=risuHost();
 if(!host?.getCharacterFromIndex || !host.setCharacterToIndex)throw new Error('Character assets unavailable');
 let index=target.index,char=obj(await host.getCharacterFromIndex(index));
 if(String(char.chaId || char.id)!==target.id) {
  const match=(await directory()).filter(r=>String(r.char.chaId || r.char.id)===target.id);
  if(match.length!==1)throw new Error('Character assets unavailable');
  index=match[0]!.index;char=obj(await host.getCharacterFromIndex(index));
 }
 if(char.additionalAssets==null && char.additionalAssetManifest==null) char.additionalAssets=[];
 if(String(char.chaId || char.id)!==target.id || !Array.isArray(char.additionalAssets) || (char.additionalAssets.length===0 && char.additionalAssetManifest!=null)) throw new Error('Character asset list unavailable; refusing overwrite');
 return {host,index,char,assets:char.additionalAssets as unknown[]};
}
export async function putShotAsset(id:string,bytes:BytesLike,sessionId='',owner?:Target,castIds?:readonly unknown[]) {
  const target=owner || await resolveShotOwner({session_id:sessionId});
  const saved=await storeShotBytes(id,bytes,sessionId,castIds);
 if(!saved) throw new Error('Image asset file save failed');
 await serializeSessionStorage(async()=>{
  const {host,index,char,assets}=await read(target);
  const hits=assets.filter(v=>Array.isArray(v)&&v[0]===saved.name);
  if(hits.some(v=>(v as unknown[])[1]!==saved.path)) throw new Error('Image asset name collision');
  if(!hits.length) await measureWrite('character','asset-register',()=>host.setCharacterToIndex!(index,{...char,additionalAssets:[...assets,[saved.name,saved.path,saved.name.split('.').pop() || 'webp']]} as never));
  const verified=await read(target);
  if(!verified.assets.some(v=>Array.isArray(v)&&v[0]===saved.name&&v[1]===saved.path)) throw new Error('Image asset registration failed');
 });
 invalidateShotListing(target.id);
 return saved;
}
export type CharacterShotAsset = ShotAssetRow & { location: Row };
const listedAssets = new Map<string, CharacterShotAsset>();
export function listedShotAsset(id:string): CharacterShotAsset | undefined { return listedAssets.get(id); }
const listings = new Map<string,Promise<CharacterShotAsset[]>>();
const listingExpiry=new Map<string,number>();
export function invalidateShotListing(characterId?:string):void {
 for (const [id,asset] of listedAssets) if (!characterId || asset.location.character_id===characterId) listedAssets.delete(id);
 if(characterId){listings.delete(characterId);listingExpiry.delete(characterId);}else {listings.clear();listingExpiry.clear();}
}
export async function listShotAssets(sessionId?:string):Promise<CharacterShotAsset[]> {
 let rows:Awaited<ReturnType<typeof directory>>=[];
 const belongs=(char:Row)=>{
   const id=String(char.chaId || char.id || '');
   return sessionId===unifiedSessionIdForCharacter(id) || (Array.isArray(char.chats)?char.chats:[]).some(c=>sessionId==='risu_'+sessionIdHash(id+'|'+String(obj(c).id || '')));
 };
 if(sessionId) {
  const index=Number(await risuHost()?.getCurrentCharacterIndex?.());
  if(Number.isInteger(index)&&index>=0) {
   const char=obj(await risuHost()?.getCharacterFromIndex?.(index));
   if(belongs(char))rows=[{index,char}];
  }
 }
 if(!rows.length)rows=await directory();
 const selected=sessionId ? rows.filter(({char})=> {
  const id=String(char.chaId || char.id || '');
  return sessionId===unifiedSessionIdForCharacter(id) || (Array.isArray(char.chats)?char.chats:[]).some(c=>sessionId==='risu_'+sessionIdHash(id+'|'+String(obj(c).id || '')));
 }) : rows;
 const results=await Promise.all(selected.map(row=>{
  const id=String(row.char.chaId || row.char.id || row.index);
  let task=listings.get(id);
  if((listingExpiry.get(id) || 0)<=Date.now())task=undefined;
  if(!task){
    listingExpiry.set(id,Infinity);
    task=scanShotAssets([row]).catch(error=>{listings.delete(id);throw error;}).finally(()=>{if(listings.get(id)===task)listingExpiry.set(id,Date.now()+2000);});listings.set(id,task);
  }
  return task;
 }));
 const assets=results.flat();
 for(const asset of assets) listedAssets.set(asset.id,asset);
 return assets;
}
async function scanShotAssets(rows:Awaited<ReturnType<typeof directory>>):Promise<CharacterShotAsset[]> {
 const out:CharacterShotAsset[]=[];
 for(const row of rows) {
  // Some hosts return full characters in the directory; do not fetch them again.
  const char=Array.isArray(row.char.additionalAssets) ? row.char : obj(await risuHost()?.getCharacterFromIndex?.(row.index));
  const assets = Array.isArray(char.additionalAssets) ? char.additionalAssets : [];
  const characterId=String(char.chaId || char.id || '');
  const chats=Array.isArray(char.chats)?char.chats:[];
  const chatSessions=new Map(chats.map((c,index)=>['risu_'+sessionIdHash(characterId+'|'+String(obj(c).id || '')),index]));
  for(const [assetOrder, v] of assets.entries()) {
   if(!Array.isArray(v)||!isShotAssetName(v[0])) continue;
   const name=String(v[0]),id=idFromShotAssetName(name);
   const session=sessionFromShotAssetName(name);
   const chatIndex=chatSessions.get(session) ?? -1;
   const chat=obj(chats[chatIndex]);
   if(id) out.push({id,name,path:String(v[1]),session,location:{
    character_id:characterId,character_name:String(char.name || ''),char_index:row.index,
    chat_id:String(chat.id || ''),chat_name:String(chat.name || ''),chat_index:chatIndex,
    session_id:session,asset_path:String(v[1]),asset_name:name,asset_order:assetOrder,
   }});
  }
 }
 return out;
}
export async function dropShotAsset(id:string):Promise<boolean> {
 let changed=false;
 for(const row of await directory()) await serializeSessionStorage(async()=>{
  const target={id:String(row.char.chaId || row.char.id),index:row.index};
  if(!Array.isArray(row.char.additionalAssets) || !row.char.additionalAssets.some(v=>Array.isArray(v)&&isShotAssetName(v[0])&&idFromShotAssetName(String(v[0]))===id)) return;
  const {host,index,char,assets}=await read(target);
  const kept=assets.filter(v=>!Array.isArray(v)||!isShotAssetName(v[0])||idFromShotAssetName(String(v[0]))!==id);
  if(kept.length!==assets.length) {await host.setCharacterToIndex!(index,{...char,additionalAssets:kept} as never);invalidateShotListing(target.id);changed=true;}
 });
 return changed;
}
export function setKnownShotCount(_fn:()=>number):void {}
