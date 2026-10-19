import { risuHost } from '../core/host';
import { CARD_PACK_KEY, SESSION_AUTHOR_NOTE_KEY, STORE_KEY, ROOM_INDEX_KEY } from '../core/constants';
import { cleanText, sessionIdHash, unifiedSessionIdForCharacter } from '../core/util/text';
import type { KvApi } from './device-store';
import { characterDirectory, directoryWarm } from './character-directory';

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

/** Writes route rows by this list, so they pass `fresh`; reads retry fresh on a miss. */
async function targets(fresh = false): Promise<Target[]> {
  const host = risuHost();
  if (!host?.getDatabase || !host.getCharacterFromIndex || !host.getChatFromIndex || !host.setChatToIndex) return [];
  const result: Target[] = [];
  for (const row of await characterDirectory({ fresh }) || []) {
    // Names and array indices are not durable identity. Older chats without an
    // id remain in the original store until Risu gives them one.
    const characterId = cleanText(row.chaId || row.id, 200);
    if (!characterId) continue;
    for (const entry of row.chats) {
      const chatId = cleanText(entry.id || entry.chatId, 200);
      if (!chatId || chatId === '__unified__') continue;
      result.push({ character: row.index, chat: entry.index, characterId, chatId, sid: `risu_${sessionIdHash(`${characterId}|${chatId}`)}` });
    }
  }
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
    const warm = directoryWarm();
    let all = await targets();
    if (warm && !directTarget(key, all) && !packedTargets(key, all).length) all = await targets(true);
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
    const all = await targets(true);
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
    const all = await targets(true);
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

/**
 * Automatic note changes (place, outfits, recent cast) wait here instead of
 * rewriting the chat at once. A note lives in the chat, and the plugin API can
 * only write a chat whole, so each change was one more full chat write (and on
 * PocketRisu one more redraw) beside the bake. Now the next bake write of the same
 * chat carries them; what no bake carries is written once the chat's image jobs
 * are done, or after NOTE_SAFETY_MS. User edits still write at once and win.
 * Reads see the waiting changes, so the next job is never behind.
 */
type PendingNote = { patch: RecordValue; target?: Target; holds: number; timer?: ReturnType<typeof setTimeout> };
const pendingNotes = new Map<string, PendingNote>();
const NOTE_SAFETY_MS = 120_000;
function pendingRow(sid: string): PendingNote {
  let row = pendingNotes.get(sid);
  if (!row) { row = { patch: {}, holds: 0 }; pendingNotes.set(sid, row); }
  return row;
}
/** An image job of this chat is running: its bake will carry the note. */
export function holdChatNote(sid: string): void { if (sid) pendingRow(sid).holds++; }
/** That job ended: with no other job holding the chat, what is left is written now. */
export function releaseChatNote(sid: string): void {
  const row = pendingNotes.get(sid);
  if (!row) return;
  row.holds = Math.max(0, row.holds - 1);
  if (!row.holds) void flushChatNote(sid);
}
/** Resolves at once while a job holds the chat; with none, once the change is written. */
export function queueChatNote(sid: string, patch: RecordValue): Promise<void> {
  if (!sid) return Promise.resolve();
  const row = pendingRow(sid);
  row.patch = { ...row.patch, ...patch };
  clearTimeout(row.timer);
  row.timer = setTimeout(() => void flushChatNote(sid, true), NOTE_SAFETY_MS);
  // Bakes find the note by chat; the list is the warm directory, not a fresh read.
  if (!row.target) void targets().then(list => { const target = list.find(t => t.sid === sid); if (target && pendingNotes.get(sid) === row) row.target = target; }).catch(() => {});
  return row.holds ? Promise.resolve() : flushChatNote(sid);
}
/** Writes what waits for this chat; `force` also while a job still holds it. */
export async function flushChatNote(sid: string, force = false): Promise<void> {
  const row = pendingNotes.get(sid);
  if (!row || (row.holds && !force)) return;
  clearTimeout(row.timer); row.timer = undefined;
  const patch = row.patch;
  row.patch = {};
  if (!row.holds) pendingNotes.delete(sid);
  if (!Object.keys(patch).length) return;
  try {
    await writeNote(sid, patch);
  } catch (error) {
    // Kept for the next bake or flush; anything newer that arrived meanwhile wins.
    const again = pendingRow(sid);
    again.patch = { ...patch, ...again.patch };
    again.target ??= row.target;
    clearTimeout(again.timer);
    again.timer = setTimeout(() => void flushChatNote(sid, true), NOTE_SAFETY_MS);
    console.warn('[omni] session note write deferred', error);
  }
}
/**
 * For a bake write of this chat: its localLore with every waiting note change
 * applied, and `done` to call once that write succeeded. Null when nothing waits.
 */
export function pendingNotesForChat(chat: RecordValue, character: number): { localLore: unknown[]; done: () => void } | null {
  const chatId = cleanText(chat.id || chat.chatId, 200);
  const rows = [...pendingNotes].filter(([, row]) => row.target && row.target.character === character && row.target.chatId === chatId && Object.keys(row.patch).length);
  if (rows.length !== 1) return null;
  const [sid, row] = rows[0]!;
  let previous: RecordValue;
  try { previous = object(notePayload(chat)) ?? {}; } catch { return null; }
  const snapshot = row.patch, note = { ...previous, ...snapshot };
  const done = () => {
    // Only what this write carried; a change queued meanwhile still waits.
    const current = pendingNotes.get(sid);
    if (!current) return;
    for (const key of Object.keys(snapshot)) if (JSON.stringify(current.patch[key]) === JSON.stringify(snapshot[key])) delete current.patch[key];
    if (!Object.keys(current.patch).length && !current.holds) { clearTimeout(current.timer); pendingNotes.delete(sid); }
  };
  if (JSON.stringify(previous) === JSON.stringify(note)) { done(); return null; }
  return { localLore: noteLore(chat, note), done };
}
function noteLore(chat: RecordValue, note: unknown): unknown[] {
  const lore = (chat.localLore as unknown[] || []).filter(v => object(v)?.comment !== 'omni.nexus.note');
  lore.push({ comment: 'omni.nexus.note', key: '', secondkey: '', alwaysActive: false, selective: false, mode: 'normal', insertorder: 0, content: JSON.stringify({ version: 1, note }) });
  return lore;
}

/** Dedicated note entry: intentionally never consult the legacy plugin key. */
export async function readChatNote(sid:string):Promise<unknown> {
  return serializeSessionStorage(async()=> {
    const warm=directoryWarm();
    const target=(await targets()).find(t=>t.sid===sid) || (warm ? (await targets(true)).find(t=>t.sid===sid) : undefined);
    const waiting=pendingNotes.get(sid)?.patch;
    const hasWaiting=!!waiting && Object.keys(waiting).length>0;
    if(!target) return hasWaiting ? { ...waiting } : null;
    const stored=notePayload(await readChat(target));
    return hasWaiting ? { ...(object(stored) ?? {}), ...waiting } : stored;
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
/** A user's edit: written at once, and a waiting automatic change to the same field is dropped. */
export async function writeChatNote(sid:string,note:unknown):Promise<unknown> {
  const waiting=pendingNotes.get(sid);
  if(waiting)for(const key of Object.keys(object(note) ?? {}))delete waiting.patch[key];
  return writeNote(sid,note);
}
function writeNote(sid:string,note:unknown):Promise<unknown> {
  return serializeSessionStorage(async()=> {
    const target=(await targets(true)).find(t=>t.sid===sid);
    if(!target)throw new Error('Chat required for author note');
    const chat=await readChat(target);
    const previous = object(notePayload(chat)) ?? {};
    // Merge under the same queue as the fresh chat read; omitted fields must
    // never replay a stale location or erase a concurrent note edit.
    note = { ...previous, ...object(note) };
    if (JSON.stringify(previous) === JSON.stringify(note)) return note;
    await risuHost()!.setChatToIndex!(target.character,target.chat,{...chat,localLore:noteLore(chat,note)});
    if(JSON.stringify(notePayload(await readChat(target)))!==JSON.stringify(note))throw new Error('Author note verification failed');
    return note;
  });
}
