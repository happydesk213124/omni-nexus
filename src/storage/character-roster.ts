import { INRAY_DISPLAY_MODULE_ID, INRAY_DISPLAY_MODULE_NS } from '../domain/inray-display';
import { risuHost } from '../core/host';
import type { CharacterRecord } from '../core/types';
import { sessionIdHash, unifiedSessionIdForCharacter } from '../core/util/text';
import { serializeSessionStorage } from './chat-session-store';
import { COSTUME_FIELDS } from '../domain/character/costume';

export const CHARACTER_ROSTER_LORE = 'omni.nexus.data.global';
type Row = Record<string, unknown>;
const object = (v: unknown): Row | null => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Row : null;
type Target = {index:number; id:string; scope:string};
const fields = new Set('id name original aliases surname given_name surname_variants given_name_variants appearance attire bottoms accessories costumes active_costume attire_locked bottoms_locked accessories_locked priority gender hair_color hair_style eye_color height age penis_size schema_version ref_hash example_hash cast_id updated_at'.split(' '));
function clean(row: Row): CharacterRecord {
  const out = Object.fromEntries(Object.entries(row).filter(([key])=>fields.has(key)));
  if (!out.id || typeof out.id !== 'string' || typeof out.name !== 'string') throw new Error('Invalid character roster record');
  if (Array.isArray(out.costumes)) out.costumes = out.costumes.map(value=> {
    const costume=object(value) || {};
    return Object.fromEntries(Object.entries(costume).filter(([key])=>['name','note',...COSTUME_FIELDS,'attire_locked','bottoms_locked','accessories_locked'].includes(key)));
  });
  if (/data:image\/|data:application\//i.test(JSON.stringify(out))) throw new Error('Image bytes cannot be stored in character lore');
  return out as CharacterRecord;
}
async function targets(): Promise<Array<Target & {aliases:string[]}>> {
  const db=await risuHost()?.getDatabase?.(['characters']);
  if (!Array.isArray(db?.characters)) return [];
  return db.characters.flatMap((value:unknown,index:number)=> {
    const char=object(value); const id=String(char?.chaId || char?.id || '');
    if(!id) return [];
    const scope=unifiedSessionIdForCharacter(id);
    const aliases=[id,scope,...(Array.isArray(char?.chats)?char.chats:[]).flatMap(value=> {
      const chat=object(value);const cid=String(chat?.id || chat?.chatId || '');
      return cid?[`risu_${sessionIdHash(`${id}|${cid}`)}`]:[];
    })];
    return [{index,id,scope,aliases}];
  });
}
async function target(scope:string):Promise<Target|null> {
  if(!scope || scope==='__global__') return null;
  const matches=(await targets()).filter(row=>row.aliases.includes(scope));
  if(matches.length>1) throw new Error('Ambiguous character identity');
  return matches[0] || null;
}
async function readEntryData(t: Target): Promise<{ char: Row; data: Row }> {
  const char = object(await risuHost()?.getCharacterFromIndex?.(t.index));
  if (!char || String(char.chaId || char.id) !== t.id) throw new Error('Character moved during roster access');
  if (char.globalLore != null && !Array.isArray(char.globalLore)) throw new Error('Invalid character lorebook');
  const entries = (char.globalLore as unknown[] || []).filter(v => object(v)?.comment === CHARACTER_ROSTER_LORE);
  if (entries.length > 1) throw new Error('Duplicate ' + CHARACTER_ROSTER_LORE);
  if (!entries.length) return { char, data: { version: 1, characterId: t.id, roster: [] } };
  const entry = object(entries[0])!;
  const content = String(entry.content ?? '').trim();
  // An empty disabled placeholder contains no records to recover or overwrite.
  // Nonempty corrupt content must remain untouched rather than becoming an empty roster.
  if (!content && entry.key === '' && entry.alwaysActive === false && entry.mode === 'normal') {
    return { char, data: { version: 1, characterId: t.id, roster: [] } };
  }
  let data: Row | null;
  try { data = object(JSON.parse(content)); }
  catch { throw new Error(`캐릭터 저장 데이터 오류 · ${String(char.name || t.id)} · ${CHARACTER_ROSTER_LORE} 내용이 올바른 JSON이 아닙니다. 원본은 보존했습니다.`); }
  if (entry.key !== '' || entry.alwaysActive !== false || entry.mode !== 'normal' || data?.version !== 1 || data.characterId !== t.id || !Array.isArray(data.roster)) throw new Error('Invalid ' + CHARACTER_ROSTER_LORE + '; refusing overwrite');
  return { char, data };
}

async function read(t: Target): Promise<{ char: Row; roster: CharacterRecord[] }> {
  const { char, data } = await readEntryData(t);
  return { char, roster: (data.roster as unknown[]).map(value => ({ ...clean(object(value) || {}), scope: t.scope })) };
}

/**
 * Extra per-character values live in the same disabled lorebook entry as the
 * roster, so deleting the Risu character deletes them too. `scope` accepts a
 * character id — identity aliases cover it, same as roster access.
 */
export async function readCharacterEntryKey(scope: string, key: string): Promise<unknown> {
  const t = await target(scope);
  if (!t) return undefined;
  return (await readEntryData(t)).data[key];
}

export async function writeCharacterEntryKey(scope: string, key: string, value: unknown): Promise<void> {
  const t = await target(scope);
  if (!t) throw new Error('Risu character required for lore save');
  await serializeSessionStorage(async () => {
    const host = risuHost();
    if (!host?.setCharacterToIndex) throw new Error('Character lorebook writing unavailable');
    const { char, data } = await readEntryData(t);
    const content = JSON.stringify({ ...data, version: 1, characterId: t.id, [key]: value });
    const entries = [...(char.globalLore as unknown[] || [])];
    const index = entries.findIndex(v => object(v)?.comment === CHARACTER_ROSTER_LORE);
    const entry = { ...(index >= 0 ? object(entries[index]) : {}), comment: CHARACTER_ROSTER_LORE, key: '', secondkey: '', alwaysActive: false, selective: false, mode: 'normal', insertorder: 0, content };
    if (index < 0) entries.push(entry); else entries[index] = entry;
    await host.setCharacterToIndex(t.index, { ...char, globalLore: entries });
    if (JSON.stringify((await readEntryData(t)).data[key]) !== JSON.stringify(value)) throw new Error('Character lore save verification failed');
  });
}
export async function readCharacterRoster(scope:string):Promise<CharacterRecord[]> {
  if(scope==='__global__') return (await readShared()).roster;
  const t=await target(scope);return t?(await read(t)).roster:[];
}
/**
 * Bot-level unified scopes that own one chat session id. Session rows carry
 * the owner's unified scope (not the chat id), so entry-time scans that
 * filter by chat id must accept these too — exact chat-id matching goes
 * blind and the tab paints no thumbnails.
 */
export async function rosterOwnerScopesForSession(sessionId:string):Promise<string[]> {
  const sid=String(sessionId||'');
  if(!sid) return [];
  const out:string[]=[];
  for(const t of await targets()) {
    if(t.aliases.includes(sid) && t.scope && !out.includes(t.scope)) out.push(t.scope);
  }
  return out;
}
export async function allCharacterRosters():Promise<CharacterRecord[]> {
  const rows:CharacterRecord[]=[...(await readShared()).roster];
  for(const t of await targets()) rows.push(...(await read(t)).roster);
  return rows;
}
export async function mutateCharacterRoster(scope:string,change:(rows:CharacterRecord[])=>CharacterRecord[]):Promise<void> {
  if(scope==='__global__') return mutateShared(change);
  const t=await target(scope);
  if(!t) throw new Error('Risu character required for roster save');
  await serializeSessionStorage(async()=> {
    const host=risuHost();if(!host?.setCharacterToIndex) throw new Error('Character lorebook writing unavailable');
    const {char,data}=await readEntryData(t);
    const roster=(data.roster as unknown[]).map(value=>({...clean(object(value)||{}),scope:t.scope}));
    const next=change(roster).map(clean);
    if(new Set(next.map(row=>row.id)).size!==next.length) throw new Error('Duplicate roster IDs');
    const content=JSON.stringify({...data,version:1,characterId:t.id,roster:next});
    const entries=[...(char.globalLore as unknown[] || [])];
    const index=entries.findIndex(v=>object(v)?.comment===CHARACTER_ROSTER_LORE);
    const entry={...(index>=0?object(entries[index]):{}),comment:CHARACTER_ROSTER_LORE,key:'',secondkey:'',alwaysActive:false,selective:false,mode:'normal',insertorder:0,content};
    if(index<0) entries.push(entry);else entries[index]=entry;
    await host.setCharacterToIndex(t.index,{...char,globalLore:entries});
    if(JSON.stringify((await read(t)).roster.map(clean))!==JSON.stringify(next)) throw new Error('Character roster save verification failed');
  });
}

export const SHARED_ROSTER_LORE = 'omni.nexus.data.globalcharacter';
async function readShared() {
  const db=await risuHost()?.getDatabase?.(['modules']);
  const modules=Array.isArray(db?.modules)?db.modules:[];
  const matches=modules.filter(m=>m.id===INRAY_DISPLAY_MODULE_ID || m.namespace===INRAY_DISPLAY_MODULE_NS);
  if(matches.length>1) throw new Error('Duplicate Omni display modules');
  const module=matches[0];
  const entries=module?.lorebook || [];
  if(!Array.isArray(entries)) throw new Error('Invalid module lorebook');
  const hits=entries.filter(e=>object(e)?.comment===SHARED_ROSTER_LORE);
  if(hits.length>1) throw new Error('Duplicate '+SHARED_ROSTER_LORE);
  let roster:CharacterRecord[]=[];
  if(hits.length) {
    const entry=object(hits[0])!; const data=object(JSON.parse(String(entry.content)));
    if(entry.key!=='' || entry.alwaysActive!==false || data?.version!==1 || !Array.isArray(data.roster)) throw new Error('Invalid '+SHARED_ROSTER_LORE);
    roster=data.roster.map(v=>({...clean(object(v)||{}),scope:'__global__'}));
  }
  return {modules,module,entries,roster};
}
async function mutateShared(change:(rows:CharacterRecord[])=>CharacterRecord[]):Promise<void> {
  await serializeSessionStorage(async()=> {
    const host=risuHost();if(!host?.setDatabase)throw new Error('Module writing unavailable');
    const {modules,module,entries,roster}=await readShared();
    if(!module) throw new Error('Omni display module required');
    const next=change(roster).map(clean);
    if(new Set(next.map(r=>r.id)).size!==next.length)throw new Error('Duplicate roster IDs');
    const entry={comment:SHARED_ROSTER_LORE,key:'',secondkey:'',alwaysActive:false,selective:false,mode:'normal',insertorder:0,content:JSON.stringify({version:1,roster:next})};
    const lore=entries.filter(e=>object(e)?.comment!==SHARED_ROSTER_LORE);lore.push(entry);
    await host.setDatabase({modules:modules.map(m=>m===module?{...m,lorebook:lore}:m)});
    if(JSON.stringify((await readShared()).roster.map(clean))!==JSON.stringify(next))throw new Error('Shared roster verification failed');
  });
}
