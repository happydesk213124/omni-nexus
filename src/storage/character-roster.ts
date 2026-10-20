import { INRAY_DISPLAY_MODULE_ID, INRAY_DISPLAY_MODULE_NS } from '../domain/inray-display';
import { risuHost } from '../core/host';
import type { CharacterRecord } from '../core/types';
import { sessionIdHash, unifiedSessionIdForCharacter } from '../core/util/text';
import { serializeSessionStorage } from './chat-session-store';
import { COSTUME_FIELDS } from '../domain/character/costume';
import { characterDirectory, directoryWarm } from './character-directory';

export const CHARACTER_ROSTER_LORE = 'omni.nexus.data.global';
type Row = Record<string, unknown>;
const object = (v: unknown): Row | null => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Row : null;
type Target = {index:number; id:string; scope:string};
const fields = new Set('id name original aliases surname given_name surname_variants given_name_variants appearance attire bottoms accessories costumes active_costume attire_locked bottoms_locked accessories_locked priority gender hair_color hair_style eye_color height age penis_size schema_version ref_hash example_hash cast_id disabled updated_at'.split(' '));
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
async function targets(fresh = false): Promise<Array<Target & {aliases:string[]}>> {
  return (await characterDirectory({ fresh }) || []).flatMap(char=> {
    const id=char.chaId || char.id;
    if(!id) return [];
    const scope=unifiedSessionIdForCharacter(id);
    const aliases=[id,scope,...char.chats.flatMap(chat=> {
      const cid=chat.id || chat.chatId;
      return cid?[`risu_${sessionIdHash(`${id}|${cid}`)}`]:[];
    })];
    return [{index:char.index,id,scope,aliases}];
  });
}
/** Reads may use the shared directory; a miss in a reused one reads again. Writes ask for `fresh`. */
async function target(scope:string, fresh = false):Promise<Target|null> {
  if(!scope || scope==='__global__') return null;
  const pick = async (again: boolean) => {
    const matches=(await targets(again)).filter(row=>row.aliases.includes(scope));
    if(matches.length>1) throw new Error('Ambiguous character identity');
    return matches[0] || null;
  };
  const warm = !fresh && directoryWarm();
  return await pick(fresh) || (warm ? pick(true) : null);
}
/** Resolve bot ownership without consulting the currently open chat. */
export async function characterIdForRosterScope(scope: string): Promise<string> {
  return (await target(scope))?.id || '';
}

async function readEntryData(t: Target): Promise<{ char: Row; data: Row }> {
  const char = object(await risuHost()?.getCharacterFromIndex?.(t.index));
  return entryData(char, t);
}
function entryData(char: Row | null, t: Target): { char: Row; data: Row } {
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
  const invalid = [
    entry.key !== '' && '키워드가 비어 있지 않음',
    entry.alwaysActive !== false && '항상 활성화가 꺼져 있지 않음',
    entry.mode !== 'normal' && '모드가 일반이 아님',
    data?.version !== 1 && '저장 버전이 1이 아님',
    !Array.isArray(data?.roster) && '캐릭터 목록 형식 오류',
  ].filter(Boolean);
  if (invalid.length || !data) throw new Error(`캐릭터 저장 데이터 오류 · ${String(char.name || t.id)} · ${CHARACTER_ROSTER_LORE}: ${invalid.join(', ')}. 원본은 보존했습니다.`);
  // The enclosing bot owns this lore, including after a copy/import. A stale
  // embedded ID is informational; both write paths stamp the current owner.
  return { char, data };
}

async function read(t: Target): Promise<{ char: Row; roster: CharacterRecord[] }> {
  const { char, data } = await readEntryData(t);
  return { char, roster: withBuffered(t, (data.roster as unknown[]).map(value => ({ ...clean(object(value) || {}), scope: t.scope }))) };
}

/**
 * Roster changes an image job makes (people it registers or completes) wait here,
 * per bot, instead of rewriting the whole character at once. They go out in the
 * same character write as the reply's shot registrations, at its bake
 * (shot-character). Every read sees them already, so within the reply someone
 * block 1 registered is known by name in block 2. Not kept across a restart: a
 * person not yet written is registered again the next time the model names them.
 */
type BufferedRoster = { target: Target; put: Map<string, CharacterRecord>; drop: Set<string> };
const bufferedRosters = new Map<string, BufferedRoster>();
function withBuffered(t: Target, rows: CharacterRecord[]): CharacterRecord[] {
  const ops = bufferedRosters.get(t.id);
  if (!ops) return rows;
  return [...rows.filter(row => !ops.drop.has(row.id) && !ops.put.has(row.id)), ...[...ops.put.values()].map(row => ({ ...row, scope: t.scope }))];
}
/** Bots with roster changes waiting for their character write. */
export function bufferedRosterTargets(): Array<{ index: number; id: string }> {
  return [...bufferedRosters.values()].filter(ops => ops.put.size || ops.drop.size).map(ops => ({ index: ops.target.index, id: ops.target.id }));
}
/**
 * For one character write (shot-character): this bot's globalLore with its waiting
 * roster changes applied, `check` to verify a re-read character, and `done` to
 * call once that write succeeded. Null when nothing waits for it.
 */
export function bufferedRosterLore(char: Row, characterId: string): { globalLore: unknown[]; check: (char: Row) => boolean; done: () => void } | null {
  const ops = bufferedRosters.get(characterId);
  if (!ops || (!ops.put.size && !ops.drop.size)) return null;
  const t = ops.target, { data } = entryData(char, t);
  const stored = (data.roster as unknown[]).map(value => clean(object(value) || {}));
  const next = [...stored.filter(row => !ops.drop.has(row.id) && !ops.put.has(row.id)), ...[...ops.put.values()].map(clean)];
  const put = new Map(ops.put), drop = new Set(ops.drop);
  return {
    globalLore: rosterLore(char, t, data, next),
    check: reread => JSON.stringify((entryData(reread, t).data.roster as unknown[]).map(value => clean(object(value) || {}))) === JSON.stringify(next),
    done: () => {
      const current = bufferedRosters.get(characterId);
      if (!current) return;
      // Only what this write carried; a change buffered meanwhile still waits.
      for (const [id, row] of put) if (current.put.get(id) === row) current.put.delete(id);
      for (const id of drop) current.drop.delete(id);
      if (!current.put.size && !current.drop.size) bufferedRosters.delete(characterId);
    },
  };
}
function rosterLore(char: Row, t: Target, data: Row, next: CharacterRecord[]): unknown[] {
  const content = JSON.stringify({ ...data, version: 1, characterId: t.id, roster: next });
  const entries = [...(char.globalLore as unknown[] || [])];
  const index = entries.findIndex(v => object(v)?.comment === CHARACTER_ROSTER_LORE);
  const entry = { ...(index >= 0 ? object(entries[index]) : {}), comment: CHARACTER_ROSTER_LORE, key: '', secondkey: '', alwaysActive: false, selective: false, mode: 'normal', insertorder: 0, content };
  if (index < 0) entries.push(entry); else entries[index] = entry;
  return entries;
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
  const t = await target(scope, true);
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
/**
 * A lorebook entry of our own on the bot, apart from the roster's: its text. Kept
 * disabled like the roster's (no key, never always active), so Risu never injects it.
 */
export async function readCharacterLoreText(scope: string, comment: string): Promise<string | null> {
  const t = await target(scope);
  if (!t) return null;
  const char = object(await risuHost()?.getCharacterFromIndex?.(t.index));
  if (!char || String(char.chaId || char.id) !== t.id) throw new Error('Character moved during lore access');
  const entry = (Array.isArray(char.globalLore) ? char.globalLore : []).find(v => object(v)?.comment === comment);
  return entry ? String(object(entry)?.content ?? '') : '';
}

/** Writes that entry, or takes it out when the text is empty; one character write. */
export async function writeCharacterLoreText(scope: string, comment: string, content: string): Promise<void> {
  const t = await target(scope, true);
  if (!t) throw new Error('Risu character required for lore save');
  await serializeSessionStorage(async () => {
    const host = risuHost();
    if (!host?.setCharacterToIndex) throw new Error('Character lorebook writing unavailable');
    const char = object(await host.getCharacterFromIndex?.(t.index));
    if (!char || String(char.chaId || char.id) !== t.id) throw new Error('Character moved during lore save');
    if (char.globalLore != null && !Array.isArray(char.globalLore)) throw new Error('Invalid character lorebook');
    const entries = [...(char.globalLore as unknown[] || [])];
    const index = entries.findIndex(v => object(v)?.comment === comment);
    if (!content && index < 0) return;
    if (!content) entries.splice(index, 1);
    else {
      const entry = { ...(index >= 0 ? object(entries[index]) : {}), comment, key: '', secondkey: '', alwaysActive: false, selective: false, mode: 'normal', insertorder: 0, content };
      if (index < 0) entries.push(entry); else entries[index] = entry;
    }
    await host.setCharacterToIndex(t.index, { ...char, globalLore: entries });
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
export async function allCharacterRosters(onReadError?: (scope: string, error: unknown) => void):Promise<CharacterRecord[]> {
  // Partial results are opt-in for cast lookup. Storage/export callers still
  // fail closed rather than mistaking an unreadable roster for an empty one.
  const rows:CharacterRecord[]=[];
  const collect = async (scope: string, load: () => Promise<{roster: CharacterRecord[]}>) => {
    try { rows.push(...(await load()).roster); }
    catch (error) {
      if (!onReadError) throw error;
      onReadError(scope, error);
    }
  };
  await collect('__global__', readShared);
  for(const t of await targets()) await collect(t.scope, () => read(t));
  return rows;
}

/** Viewer reads must not fetch the all-bot directory just to name one image. */
export async function viewerCharacterRosters(onReadError?: (scope: string, error: unknown) => void): Promise<CharacterRecord[]> {
  const rows: CharacterRecord[] = [];
  try { rows.push(...(await readShared()).roster); }
  catch (error) { if (!onReadError) throw error; onReadError('__global__', error); }
  const host = risuHost();
  const index = Number(await host?.getCurrentCharacterIndex?.());
  if (!Number.isInteger(index) || index < 0) return rows;
  let scope = '';
  try {
    const char = object(await host?.getCharacterFromIndex?.(index));
    const id = String(char?.chaId || char?.id || '');
    if (!id) return rows;
    scope = unifiedSessionIdForCharacter(id);
    const { data } = entryData(char, { index, id, scope });
    rows.push(...withBuffered({ index, id, scope }, (data.roster as unknown[]).map(value => ({ ...clean(object(value) || {}), scope }))));
  } catch (error) { if (!onReadError) throw error; onReadError(scope, error); }
  return rows;
}
export async function mutateCharacterRoster(scope:string,change:(rows:CharacterRecord[])=>CharacterRecord[],opts:{buffer?:boolean}={}):Promise<void> {
  if(scope==='__global__') return mutateShared(change);
  const t=await target(scope, true);
  if(!t) throw new Error('Risu character required for roster save');
  if(opts.buffer) return serializeSessionStorage(async()=> {
    // Waits for the bake's character write; reads see it from now on.
    const {roster}=await read(t);
    const next=change(roster).map(clean);
    if(new Set(next.map(row=>row.id)).size!==next.length) throw new Error('Duplicate roster IDs');
    const ops=bufferedRosters.get(t.id) ?? { target: t, put: new Map<string, CharacterRecord>(), drop: new Set<string>() };
    ops.target=t;
    const before=new Map(roster.map(row=>[row.id,JSON.stringify(clean(row))]));
    const after=new Set(next.map(row=>row.id));
    for(const id of before.keys()) if(!after.has(id)) { ops.drop.add(id); ops.put.delete(id); }
    for(const row of next) if(before.get(row.id)!==JSON.stringify(row)) { ops.put.set(row.id,row); ops.drop.delete(row.id); }
    if(ops.put.size || ops.drop.size) bufferedRosters.set(t.id,ops);
  });
  await serializeSessionStorage(async()=> {
    const host=risuHost();if(!host?.setCharacterToIndex) throw new Error('Character lorebook writing unavailable');
    const {char,data}=await readEntryData(t);
    // Built on what reads show, waiting changes included: this write carries them too.
    const roster=withBuffered(t,(data.roster as unknown[]).map(value=>({...clean(object(value)||{}),scope:t.scope})));
    const next=change(roster).map(clean);
    if(new Set(next.map(row=>row.id)).size!==next.length) throw new Error('Duplicate roster IDs');
    const stored=(data.roster as unknown[]).map(value=>clean(object(value)||{}));
    if(data.characterId===t.id && JSON.stringify(stored)===JSON.stringify(next)) { bufferedRosters.delete(t.id); return; }
    await host.setCharacterToIndex(t.index,{...char,globalLore:rosterLore(char,t,data,next)});
    // This write already holds every waiting change it was built on (reads include them).
    bufferedRosters.delete(t.id);
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
    const host=risuHost();
    const {modules,module,entries,roster}=await readShared();
    const next=change(roster).map(clean);
    if(new Set(next.map(r=>r.id)).size!==next.length)throw new Error('Duplicate roster IDs');
    if(JSON.stringify(roster.map(clean))===JSON.stringify(next)) return;
    if(!host?.setDatabase)throw new Error('Module writing unavailable');
    if(!module) throw new Error('Omni display module required');
    const entry={comment:SHARED_ROSTER_LORE,key:'',secondkey:'',alwaysActive:false,selective:false,mode:'normal',insertorder:0,content:JSON.stringify({version:1,roster:next})};
    const lore=entries.filter(e=>object(e)?.comment!==SHARED_ROSTER_LORE);lore.push(entry);
    await host.setDatabase({modules:modules.map(m=>m===module?{...m,lorebook:lore}:m)});
    if(JSON.stringify((await readShared()).roster.map(clean))!==JSON.stringify(next))throw new Error('Shared roster verification failed');
  });
}
