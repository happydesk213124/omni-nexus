import { measureWrite } from '../core/write-metrics';
/** Character-owned gallery assets; never toggle module activation to publish pixels. */
import { risuHost } from '../core/host';
import { sessionIdHash, unifiedSessionIdForCharacter } from '../core/util/text';
import type { BytesLike } from '../core/util/bytes';
import { serializeSessionStorage } from './chat-session-store';
import { characterDirectory, directoryWarm } from './character-directory';
import { storeShotBytes, readShotAssetBytes, type ShotAssetRow } from './shot-module';
import { isShotAssetName, idFromShotAssetName, sessionFromShotAssetName } from '../domain/gallery/shot-assets';
import { psGet, psRemove, psSet } from './device-store';
import { bufferedRosterLore, bufferedRosterTargets } from './character-roster';
export { readShotAssetBytes };
type Row=Record<string,unknown>;
type Target={id:string;index:number};
const obj=(v:unknown):Row=>v && typeof v==='object' && !Array.isArray(v)?v as Row:{};
/** Asset lists change with every saved shot, so this reads fresh (joining a read in flight). */
async function directory(fresh=true) {
 return (await characterDirectory({fresh}) || []).map(row=>({char:{chaId:row.chaId,id:row.id,name:row.name,additionalAssets:row.additionalAssets,chats:row.chats.map(chat=>({id:chat.id,name:chat.name}))} as Row,index:row.index}));
}
export async function resolveShotOwner(location:Row={}):Promise<Target> {
 const id=String(location.asset_owner_character_id || location.character_id || ''),sid=String(location.session_id || '');
 const hint=Number(location.char_index ?? await risuHost()?.getCurrentCharacterIndex?.());
 if(Number.isInteger(hint)&&hint>=0 && id) {
  const char=obj(await risuHost()?.getCharacterFromIndex?.(hint));
  if(String(char.chaId || char.id)===id)return {id,index:hint};
 }
 const pick=(list:Array<{char:Row;index:number}>)=>list.filter(({char})=>{
  const key=String(char.chaId || char.id || '');
  if(id) return key===id;
  return sid && (sid===key || sid===unifiedSessionIdForCharacter(key) || (Array.isArray(char.chats)?char.chats:[]).some(v=>sid==='risu_'+sessionIdHash(key+'|'+String(obj(v).id || ''))));
 });
 const warm=directoryWarm();
 let rows=await directory(false);
 let matches=pick(rows);
 if(matches.length!==1 && warm){rows=await directory(true);matches=pick(rows);}
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
  const match=(await directory(true)).filter(r=>String(r.char.chaId || r.char.id)===target.id);
  if(match.length!==1)throw new Error('Character assets unavailable');
  index=match[0]!.index;char=obj(await host.getCharacterFromIndex(index));
 }
 if(char.additionalAssets==null && char.additionalAssetManifest==null) char.additionalAssets=[];
 if(String(char.chaId || char.id)!==target.id || !Array.isArray(char.additionalAssets) || (char.additionalAssets.length===0 && char.additionalAssetManifest!=null)) throw new Error('Character asset list unavailable; refusing overwrite');
 return {host,index,char,assets:char.additionalAssets as unknown[]};
}
/**
 * Registering a shot in the character's asset list rewrites the whole character
 * (its chats too), once per image. While an image job runs, registrations wait
 * here and go out together in one character write: before the bake that needs
 * them (chat-bake), or when the jobs end. The file itself is saved at once, and
 * the waiting list is kept in plugin storage, so a restart still registers it.
 * Listings already see a waiting shot as if it were registered.
 */
type PendingShot = { name: string; path: string };
const pendingShots = new Map<string, { target: Target; rows: PendingShot[] }>();
const PENDING_SHOTS_KEY = 'onx_pending_shot_assets';
const SHOT_SAFETY_MS = 120_000;
let shotHolds = 0, shotTimer: ReturnType<typeof setTimeout> | undefined;
export function holdShotAssets(): void { shotHolds++; }
export function releaseShotAssets(): void {
  shotHolds = Math.max(0, shotHolds - 1);
  if (!shotHolds) void flushShotAssets().catch(error => console.warn('[omni] shot registration deferred', error));
}
// The key exists only while something waits: nothing is written for a job whose shots all registered.
let pendingStored = false;
async function rememberPendingShots(): Promise<void> {
  const waiting = [...pendingShots.values()].filter(entry => entry.rows.length);
  if (waiting.length) { await psSet(PENDING_SHOTS_KEY, waiting); pendingStored = true; }
  else if (pendingStored) { await psRemove(PENDING_SHOTS_KEY); pendingStored = false; }
}
/**
 * One character write carrying its waiting shot registrations and its waiting
 * roster changes (character-roster) together, verified after.
 */
async function writeCharacter(target: Target, rows: readonly PendingShot[]): Promise<void> {
  await serializeSessionStorage(async()=>{
    const {host,index,char,assets}=await read(target);
    const adds: unknown[] = [];
    for (const row of rows) {
      const hits=assets.filter(v=>Array.isArray(v)&&v[0]===row.name);
      if(hits.some(v=>(v as unknown[])[1]!==row.path)) throw new Error('Image asset name collision');
      if(!hits.length && !adds.some(v=>(v as unknown[])[0]===row.name)) adds.push([row.name,row.path,row.name.split('.').pop() || 'webp']);
    }
    const roster = bufferedRosterLore(char, target.id);
    if(adds.length || roster) await measureWrite('character','asset-register',()=>host.setCharacterToIndex!(index,{...char,additionalAssets:[...assets,...adds],...(roster ? { globalLore: roster.globalLore } : {})} as never));
    const verified=await read(target);
    for (const row of rows) if(!verified.assets.some(v=>Array.isArray(v)&&v[0]===row.name&&v[1]===row.path)) throw new Error('Image asset registration failed');
    if (roster) {
      if (!roster.check(verified.char)) throw new Error('Character roster save verification failed');
      roster.done();
    }
  });
  invalidateShotListing(target.id);
}
/** Registers every waiting shot and roster change: one character write per character. */
export async function flushShotAssets(): Promise<void> {
  clearTimeout(shotTimer); shotTimer = undefined;
  let failure: unknown;
  const ids = new Set([...pendingShots.keys(), ...bufferedRosterTargets().map(t => t.id)]);
  for (const key of ids) {
    const entry = pendingShots.get(key);
    const target = entry?.target ?? bufferedRosterTargets().find(t => t.id === key);
    if (!target) continue;
    const rows = [...(entry?.rows || [])];
    try {
      await writeCharacter(target, rows);
      if (entry) {
        entry.rows = entry.rows.filter(row => !rows.some(done => done.name === row.name));
        if (!entry.rows.length) pendingShots.delete(key);
      }
    } catch (error) { failure = error; }
  }
  await rememberPendingShots().catch(() => {});
  if (failure) { shotTimer = setTimeout(() => void flushShotAssets().catch(() => {}), SHOT_SAFETY_MS); throw failure; }
}
/** At boot: shots saved but not yet registered when the app last closed. */
export async function restorePendingShotAssets(): Promise<void> {
  const raw = await psGet(PENDING_SHOTS_KEY);
  if (!Array.isArray(raw) || !raw.length) return;
  pendingStored = true;
  for (const value of raw) {
    const entry = obj(value), target = obj(entry.target), rows = Array.isArray(entry.rows) ? entry.rows : [];
    const id = String(target.id || ''), index = Number(target.index);
    if (!id || !Number.isInteger(index)) continue;
    const kept = rows.map(obj).filter(row => isShotAssetName(row.name) && typeof row.path === 'string').map(row => ({ name: String(row.name), path: String(row.path) }));
    if (kept.length) pendingShots.set(id, { target: { id, index }, rows: kept });
  }
  await flushShotAssets();
}
function pendingAssetsFor(characterId: string): unknown[] {
  return (pendingShots.get(characterId)?.rows || []).map(row => [row.name, row.path, row.name.split('.').pop() || 'webp']);
}
export async function putShotAsset(id:string,bytes:BytesLike,sessionId='',owner?:Target,castIds?:readonly unknown[]) {
  const target=owner || await resolveShotOwner({session_id:sessionId});
  const saved=await storeShotBytes(id,bytes,sessionId,castIds);
 if(!saved) throw new Error('Image asset file save failed');
 if (shotHolds > 0) {
  const entry = pendingShots.get(target.id) ?? { target, rows: [] };
  if (!entry.rows.some(row => row.name === saved.name)) entry.rows.push({ name: saved.name, path: saved.path });
  pendingShots.set(target.id, entry);
  await rememberPendingShots().catch(() => {});
  clearTimeout(shotTimer);
  shotTimer = setTimeout(() => void flushShotAssets().catch(() => {}), SHOT_SAFETY_MS);
  invalidateShotListing(target.id);
  return saved;
 }
 await writeCharacter(target, [{ name: saved.name, path: saved.path }]);
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
  const characterId=String(char.chaId || char.id || '');
  // A shot waiting for its registration is listed as if it were registered.
  const registered = Array.isArray(char.additionalAssets) ? char.additionalAssets : [];
  const assets = [...registered, ...pendingAssetsFor(characterId).filter(v => !registered.some(r => Array.isArray(r) && r[0] === (v as unknown[])[0]))];
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
 for (const entry of pendingShots.values()) {
  const before = entry.rows.length;
  entry.rows = entry.rows.filter(row => idFromShotAssetName(row.name) !== id);
  if (entry.rows.length !== before) { changed = true; invalidateShotListing(entry.target.id); }
 }
 if (changed) await rememberPendingShots().catch(() => {});
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
