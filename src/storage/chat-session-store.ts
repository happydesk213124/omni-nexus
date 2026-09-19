import { risuHost } from '../core/host';
import { CARD_PACK_KEY, SESSION_AUTHOR_NOTE_KEY, STORE_KEY, ROOM_INDEX_KEY } from '../core/constants';
import { cleanText, sessionIdHash, unifiedSessionIdForCharacter } from '../core/util/text';
import type { KvApi } from './device-store';

export const SESSION_LORE_NAME = 'omni.nexus.data';
type RecordValue = Record<string, unknown>;
type Target = { character: number; chat: number; characterId: string; chatId: string; sid: string };
type Payload = { version: 1; sessionId: string; records: RecordValue };
const object = (v: unknown): RecordValue | null => v != null && typeof v === 'object' && !Array.isArray(v)
  ? v as RecordValue : null;
const storedObject = (v: unknown): RecordValue => {
  if (typeof v === 'string') return object(JSON.parse(v)) ?? {};
  return object(v) ?? {};
};
const owns = (v: RecordValue, k: string): boolean => Object.prototype.hasOwnProperty.call(v, k);

// One queue covers discovery, fresh read, modification and verification. A failed
// save must not poison later requests or turn into a write to the legacy backup.
let queue: Promise<unknown> = Promise.resolve();
export function serializeSessionStorage<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.then(work);
  queue = next.catch(() => {});
  return next;
}

async function targets(): Promise<Target[]> {
  const host = risuHost();
  if (!host?.getDatabase || !host.getCharacterFromIndex || !host.getChatFromIndex || !host.setChatToIndex) return [];
  const db = await host.getDatabase(['characters']);
  if (!Array.isArray(db?.characters)) return [];
  const result: Target[] = [];
  db.characters.forEach((raw: unknown, character: number) => {
    const row = object(raw);
    // Names and array indices are not durable identity. Older chats without an
    // id remain in the original store until Risu gives them one.
    const characterId = cleanText(row?.chaId || row?.id, 200);
    if (!characterId || !Array.isArray(row?.chats)) return;
    row.chats.forEach((rawChat: unknown, chat: number) => {
      const chatId = cleanText(object(rawChat)?.id || object(rawChat)?.chatId, 200);
      if (!chatId || chatId === '__unified__') return;
      result.push({ character, chat, characterId, chatId, sid: `risu_${sessionIdHash(`${characterId}|${chatId}`)}` });
    });
  });
  // Duplicate identities cannot be safely assigned, even if one is selected.
  return result.filter(t => result.filter(other => other.sid === t.sid).length === 1);
}

async function readChat(target: Target): Promise<RecordValue> {
  const host = risuHost()!;
  const character = object(await host.getCharacterFromIndex?.(target.character));
  if (!character || cleanText(character.chaId || character.id, 200) !== target.characterId) {
    throw new Error('Session character moved; retry the save');
  }
  const chat = object(await host.getChatFromIndex!(target.character, target.chat));
  if (!chat || cleanText(chat.id || chat.chatId, 200) !== target.chatId) throw new Error('Session chat moved; retry the save');
  if (chat.localLore != null && !Array.isArray(chat.localLore)) throw new Error('Invalid chat localLore');
  return chat;
}

function payload(chat: RecordValue, target: Target): Payload {
  const entries = (chat.localLore as unknown[] | undefined) ?? [];
  const matches = entries.filter(e => object(e)?.comment === SESSION_LORE_NAME);
  if (matches.length > 1) throw new Error('Duplicate omni.nexus.data entries');
  if (!matches.length) return { version: 1, sessionId: target.sid, records: {} };
  const entry = object(matches[0])!;
  const data = storedObject(entry.content);
  if (data.version !== 1 || data.sessionId !== target.sid || !object(data.records)) {
    throw new Error('Invalid or foreign omni.nexus.data; refusing to overwrite');
  }
  if (entry.key !== '' || entry.alwaysActive !== false || entry.mode !== 'normal') {
    throw new Error('omni.nexus.data must remain disabled (empty key, not always active)');
  }
  return data as Payload;
}

async function writeRecord(target: Target, key: string, value: unknown): Promise<void> {
  const chat = await readChat(target);
  const data = payload(chat, target);
  if (owns(data.records, key) && JSON.stringify(data.records[key]) === JSON.stringify(value)) return;
  const content = JSON.stringify({ ...data, records: { ...data.records, [key]: value } });
  // Risu's lore evaluator skips empty-key, non-always-active entries BEFORE
  // parsing their content. `disabled: true` alone is not a Risu lorebook field.
  const entry = { comment: SESSION_LORE_NAME, key: '', secondkey: '', content,
    mode: 'normal', alwaysActive: false, selective: false, insertorder: 0 };
  const lore = [...((chat.localLore as unknown[] | undefined) ?? [])];
  const index = lore.findIndex(e => object(e)?.comment === SESSION_LORE_NAME);
  if (index < 0) lore.push(entry);
  else lore[index] = { ...object(lore[index]), ...entry };
  await risuHost()!.setChatToIndex!(target.character, target.chat, { ...chat, localLore: lore });
  const verified = payload(await readChat(target), target);
  if (JSON.stringify(verified.records[key]) !== JSON.stringify(value)) throw new Error('Chat session write verification failed');
}

function directTarget(key: string, all: Target[]): Target | undefined {
  const matches = all.filter(t => key === CARD_PACK_KEY(t.sid) || key === SESSION_AUTHOR_NOTE_KEY(t.sid));
  return matches.length === 1 ? matches[0] : undefined;
}

function packedTargets(key: string, all: Target[]): Target[] {
  return all.filter(t => key === CARD_PACK_KEY(unifiedSessionIdForCharacter(t.characterId)));
}
function packChunk(raw: unknown, target: Target): RecordValue {
  const pack = storedObject(raw), cards = storedObject(pack.cards), images = storedObject(pack.images);
  const ownsImage = (image: unknown) => {
    const loc = object(object(image)?.location);
    return loc?.character_id === target.characterId && loc?.chat_id === target.chatId;
  };
  const ids = new Set(Object.keys(images).filter(id => ownsImage(images[id])));
  return { cards: Object.fromEntries(Object.entries(cards).filter(([id]) => ids.has(id))),
    images: Object.fromEntries(Object.entries(images).filter(([id]) => ids.has(id))) };
}
function replacePackChunk(base: RecordValue, old: RecordValue, saved: RecordValue): void {
  for (const name of ['cards', 'images']) {
    const rows = { ...storedObject(base[name]) };
    for (const id of Object.keys(storedObject(old[name]))) delete rows[id];
    Object.assign(rows, storedObject(saved[name]));
    base[name] = rows;
  }
}

const mixedKeys = new Set([STORE_KEY('characters'), STORE_KEY('jobs'), STORE_KEY('meta'), ROOM_INDEX_KEY]);
function rowSession(key: string, id: string, raw: unknown): string {
  const row = object(raw);
  if (key === ROOM_INDEX_KEY) return id;
  if (key === STORE_KEY('characters')) return String(row?.scope || id.split('\t')[0] || '');
  if (key === STORE_KEY('jobs')) {
    let request: RecordValue = {};
    try { request = storedObject(row?.request_json); } catch { /* legacy incomplete job */ }
    const character = cleanText(request.character_id, 200), chat = cleanText(request.chat_id, 200);
    return character && chat && chat !== '__unified__' ? `risu_${sessionIdHash(`${character}|${chat}`)}` : String(row?.session_id || '');
  }
  if (key === STORE_KEY('meta') && id.startsWith('appearance:')) return id.slice('appearance:'.length);
  return '';
}

export function isSessionStorageKey(key: string): boolean {
  return mixedKeys.has(key) || key.startsWith('onx_nxcards_') ||
    (key.startsWith('onx_session_author_note_') && key !== 'onx_session_author_note_presets');
}

/** Legacy values stay untouched; an explicit empty record prevents resurrection. */
export async function readSessionStorage(key: string, legacy: unknown): Promise<unknown> {
  // Jobs are memory-only: no boot reader exists, so lorebook slices would be
  // write-only weight. Nothing stored, nothing merged.
  if (key === STORE_KEY('jobs')) return legacy;
  return serializeSessionStorage(async () => {
    const all = await targets();
    const target = directTarget(key, all);
    if (target) {
      const data = payload(await readChat(target), target);
      if (owns(data.records, key)) return data.records[key];
      // No seeding: pack/note rows are memory-only now. A legacy value is
      // returned as-is so old entries stay readable; the lorebook stays clean.
      return legacy;
    }
    const packed = packedTargets(key, all);
    if (packed.length) {
      const result = { ...storedObject(legacy) };
      for (const t of packed) {
        const data = payload(await readChat(t), t), old = packChunk(legacy, t);
        if (!owns(data.records, key)) continue;
        const saved = storedObject(data.records[key]);
        if (JSON.stringify(packChunk(saved, t)) !== JSON.stringify({ cards: storedObject(saved.cards), images: storedObject(saved.images) })) throw new Error('Foreign gallery rows');
        replacePackChunk(result, old, saved);
      }
      return result;
    }
    if (!mixedKeys.has(key) || !all.length) return legacy;
    const result = { ...storedObject(legacy) };
    for (const t of all) {
      const data = payload(await readChat(t), t);
      const rows = Object.fromEntries(Object.entries(result).filter(([id, row]) => rowSession(key, id, row) === t.sid));
      if (!owns(data.records, key)) {
        if (Object.keys(rows).length) await writeRecord(t, key, rows);
        continue;
      }
      for (const id of Object.keys(rows)) delete result[id];
      const saved = storedObject(data.records[key]);
      // Refuse a foreign row instead of merging it into another chat's scope.
      if (Object.entries(saved).some(([id, row]) => rowSession(key, id, row) !== t.sid)) throw new Error('Foreign session row');
      Object.assign(result, saved);
    }
    return result;
  });
}

export async function writeSessionStorage(key: string, value: unknown, api: KvApi): Promise<void> {
  // Jobs are memory-only. An interrupted run that never baked is just a
  // failure; reroll reads image metadata through its own logic now.
  if (key === STORE_KEY('jobs')) return;
  return serializeSessionStorage(async () => {
    const all = await targets();
    // directTarget matches pack keys and per-chat note keys only, and neither
    // is written anywhere any more (memory + Risu assets only; the user clears
    // old values by hand). Reads of existing lorebook entries keep working.
    const target = directTarget(key, all);
    if (target) return;
    // Room packs are memory + Risu assets only now: no pack chunks go to chat
    // lorebooks any more. Reads of existing entries still work; nothing new
    // is written. Mixed keys (roster/jobs/meta/rooms) below are untouched.
    const packed = packedTargets(key, all);
    if (packed.length) {
      return;
    }
    if (!mixedKeys.has(key) || !all.length) {
      // Pack/note keys are memory-only now (the user clears old values by
      // hand): an unknown sid must not resurrect a legacy save-file row.
      if (!mixedKeys.has(key)) return;
      await api.setItem!(key, value); return;
    }
    const next = { ...storedObject(value) };
    const legacy = storedObject(await api.getItem!(key));
    for (const t of all) {
      const rows = Object.fromEntries(Object.entries(next).filter(([id, row]) => rowSession(key, id, row) === t.sid));
      const data = payload(await readChat(t), t);
      const backup = Object.fromEntries(Object.entries(legacy).filter(([id, row]) => rowSession(key, id, row) === t.sid));
      if (Object.keys(rows).length || Object.keys(backup).length || owns(data.records, key)) await writeRecord(t, key, rows);
      for (const id of Object.keys(rows)) delete next[id];
      Object.assign(next, backup);
    }
    // Only the non-session portion changes in pluginStorage. Session rows here
    // are retained byte-for-byte as a read-only migration backup.
    await api.setItem!(key, next);
  });
}

export async function removeSessionStorage(key: string): Promise<boolean> {
  // Pack/note keys are hands-off: the user clears old values by hand, so
  // neither the lorebook nor the save file is touched here.
  if (!mixedKeys.has(key)) return true;
  return serializeSessionStorage(async () => {
    const all = await targets();
    const target = directTarget(key, all);
    if (!target) {
      const packed = packedTargets(key, all);
      if (!packed.length) return false;
      for (const t of packed) await writeRecord(t, key, {cards:{}, images:{}});
      return true;
    }
    await writeRecord(target, key, null);
    return true;
  });
}

/** Dedicated note entry: intentionally never consult the legacy plugin key. */
export async function readChatNote(sid:string):Promise<unknown> {
  return serializeSessionStorage(async()=> {
    const target=(await targets()).find(t=>t.sid===sid);
    if(!target) return null;
    return notePayload(await readChat(target));
  });
}
function notePayload(chat:RecordValue):unknown {
  const entries=(chat.localLore as unknown[] || []).filter(v=>object(v)?.comment==='omni.nexus.note');
  if(entries.length>1)throw new Error('Duplicate omni.nexus.note');
  if(!entries.length)return null;
  const e=object(entries[0])!; const data=storedObject(e.content);
  if(e.key!=='' || e.alwaysActive!==false || data.version!==1 || !object(data.note))throw new Error('Invalid omni.nexus.note');
  return data.note;
}
export async function writeChatNote(sid:string,note:unknown):Promise<unknown> {
  return serializeSessionStorage(async()=> {
    const target=(await targets()).find(t=>t.sid===sid);
    if(!target)throw new Error('Chat required for author note');
    const chat=await readChat(target);
    const previous = object(notePayload(chat)) ?? {};
    // Merge under the same queue as the fresh chat read; omitted fields must
    // never replay a stale location or erase a concurrent note edit.
    note = { ...previous, ...object(note) };
    if (JSON.stringify(previous) === JSON.stringify(note)) return note;
    const lore=(chat.localLore as unknown[] || []).filter(v=>object(v)?.comment!=='omni.nexus.note');
    lore.push({comment:'omni.nexus.note',key:'',secondkey:'',alwaysActive:false,selective:false,mode:'normal',insertorder:0,content:JSON.stringify({version:1,note})});
    await risuHost()!.setChatToIndex!(target.character,target.chat,{...chat,localLore:lore});
    if(JSON.stringify(notePayload(await readChat(target)))!==JSON.stringify(note))throw new Error('Author note verification failed');
    return note;
  });
}
