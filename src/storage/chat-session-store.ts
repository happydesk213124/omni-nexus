import { risuHost } from '../core/host';
import { dbg } from '../core/debug';
import { CARD_PACK_KEY, SESSION_AUTHOR_NOTE_KEY, STORE_KEY, ROOM_INDEX_KEY } from '../core/constants';
import { cleanText, sessionIdHash, unifiedSessionIdForCharacter } from '../core/util/text';
import type { KvApi } from './device-store';
import { characterDirectory, directoryWarm } from './character-directory';
import { forgetBots, openBotFor } from './current-bot';

export const SESSION_LORE_NAME = 'omni.nexus.data';
type RecordValue = Record<string, unknown>;
/** `lore`: the names of our entries in the chat as the list of bots showed them, or null when it could not say. */
type Target = { character: number; chat: number; characterId: string; chatId: string; sid: string; lore: string[] | null };
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
  for (const row of await characterDirectory({ fresh, lore: true }) || []) {
    // Names and array indices are not durable identity. Older chats without an
    // id remain in the original store until Risu gives them one.
    const characterId = cleanText(row.chaId || row.id, 200);
    if (!characterId) continue;
    for (const entry of row.chats) {
      const chatId = cleanText(entry.id || entry.chatId, 200);
      if (!chatId || chatId === '__unified__') continue;
      result.push({ character: row.index, chat: entry.index, characterId, chatId, sid: `risu_${sessionIdHash(`${characterId}|${chatId}`)}`, lore: entry.omniLore });
    }
  }
  // Duplicate identities cannot be safely assigned, even if one is selected.
  const seen = new Map<string, number>();
  for (const t of result) seen.set(t.sid, (seen.get(t.sid) ?? 0) + 1);
  return result.filter(t => seen.get(t.sid) === 1);
}

/**
 * One chat's target without the list of every bot: the open bot (or one a job holds) names its own chats.
 * Null when that bot is not the scope's, or names the chat twice (the list refuses those).
 */
async function ownTarget(sid: string): Promise<Target | null> {
  const open = await openBotFor(sid), at = open?.chats.get(sid);
  if (!open || at === undefined) return null;
  const chats = (Array.isArray(open.char.chats) ? open.char.chats : []).map(object);
  const chatId = cleanText(chats[at]?.id || chats[at]?.chatId, 200);
  if (!chatId || chats.filter(chat => cleanText(chat?.id || chat?.chatId, 200) === chatId).length !== 1) return null;
  return { character: open.index, chat: at, characterId: open.id, chatId, sid, lore: null };
}
/** The chat a session id names: its own bot when that is open, else the list (read again on a miss in a reused one). */
async function targetOf(sid: string, fresh = false): Promise<Target | undefined> {
  const own = await ownTarget(sid);
  if (own) return own;
  if (fresh) return (await targets(true)).find(t => t.sid === sid);
  const warm = directoryWarm();
  return (await targets()).find(t => t.sid === sid) || (warm ? (await targets(true)).find(t => t.sid === sid) : undefined);
}

/**
 * A chat to read our entry from. Its own id is checked; the bot is not read to vouch for it, since what the entry
 * holds names the session it belongs to (`payload` refuses another's). A write goes by index, so it uses `readChat`.
 */
async function readChatOnly(target: Target): Promise<RecordValue> {
  const chat = object(await risuHost()!.getChatFromIndex!(target.character, target.chat));
  if (!chat || cleanText(chat.id || chat.chatId, 200) !== target.chatId) throw new Error('Session chat moved; retry the save');
  if (chat.localLore != null && !Array.isArray(chat.localLore)) throw new Error('Invalid chat localLore');
  return chat;
}
async function readChat(target: Target): Promise<RecordValue> {
  const host = risuHost()!;
  const character = object(await host.getCharacterFromIndex?.(target.character));
  if (!character || cleanText(character.chaId || character.id, 200) !== target.characterId) {
    throw new Error('Session character moved; retry the save');
  }
  return readChatOnly(target);
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
  chatEpoch++;
  await risuHost()!.setChatToIndex!(target.character, target.chat, { ...chat, localLore: lore });forgetBots();
  // The bot was vouched for a moment ago; the read back is the chat alone.
  const verified = payload(await readChatOnly(target), target);
  if (JSON.stringify(verified.records[key]) !== JSON.stringify(value)) throw new Error('Chat session write verification failed');
  await noteCensus(target.sid);
}

/**
 * Which chats hold an entry of ours (`omni.nexus.data`), kept in the save beside the chats it speaks of.
 *
 * Every store that keeps rows per chat used to find them by reading every chat of every bot: twice at each start
 * (the meta and roster stores) and once more for each save of them, a whole bot and a chat per chat. On PocketRisu
 * a chat not opened yet is fetched from the server whole, so a start downloaded every chat there is, twice. Nothing
 * writes such rows any more except to move old ones, so the answer is nearly always "none", and it only changes
 * when we write one ourselves. So it is looked up once (every chat that could hold one, read alone), written down,
 * and kept up by `writeRecord`. With none, a start reads no bot and no chat; with some, those chats only.
 *
 * A chat brought in later with an old entry inside is not seen: its rows are the old plain store's, still read from
 * there. Nothing is ever deleted on the strength of this list, since a write visits only chats it has rows for.
 */
const CENSUS_KEY = 'onx_session_slice_census';
let censusApi: KvApi | null = null, census: Set<string> | null = null, censusRead = false;
/** Bumped by every chat write made here: entries read before it are read again. */
let chatEpoch = 0;
type Slice = Payload | 'invalid';
let sliceCache: { at: number; epoch: number; rows: Map<string, Slice | null> } | null = null;
const SLICE_REUSE_MS = 5000;

/** For tests and a reloaded host: what was learned about another database is not carried over. */
export function resetSessionStorageState(): void { censusApi = null; census = null; censusRead = false; sliceCache = null; }

async function storedCensus(api: KvApi | null): Promise<Set<string> | null> {
  if (api) censusApi = api;
  if (censusRead || !censusApi?.getItem) return census;
  censusRead = true;
  try {
    const raw = object(await censusApi.getItem(CENSUS_KEY));
    if (raw?.v === 1 && Array.isArray(raw.has)) census = new Set(raw.has.map(String));
  } catch { /* not known: looked up below */ }
  return census;
}
async function saveCensus(): Promise<void> {
  if (!census || !censusApi?.setItem) return;
  try { await censusApi.setItem(CENSUS_KEY, { v: 1, has: [...census] }); }
  catch (error) { dbg('session.census.save', { message: String((error as Error)?.message || error) }, 'warn'); }
}
/** A chat we just wrote an entry into. */
async function noteCensus(sid: string): Promise<void> {
  if (!census || census.has(sid)) return;
  census.add(sid);
  await saveCensus();
}

/**
 * Each given chat's entry: read alone, once, and kept a few seconds (a start asks for two stores in a row). One that
 * is another chat's or broken is 'invalid': left alone, and never a reason to fail the whole read. Chats that could
 * not be read are named in `missed`.
 */
async function slicesOf(list: readonly Target[], known = false): Promise<{ rows: Map<string, Slice>; missed: string[] }> {
  if (!sliceCache || sliceCache.epoch !== chatEpoch || Date.now() - sliceCache.at > SLICE_REUSE_MS) sliceCache = { at: Date.now(), epoch: chatEpoch, rows: new Map() };
  const cache = sliceCache, rows = new Map<string, Slice>(), missed: string[] = [];
  for (const t of list) {
    if (!cache.rows.has(t.sid)) {
      let slice: Slice | null = null;
      // The list of bots already showed this chat's lorebook, and nothing of ours in it. A chat written down as
      // holding an entry is read whatever the list showed: the list may be a moment older than our own write.
      if (known || !t.lore || t.lore.includes(SESSION_LORE_NAME)) {
        let chat: RecordValue;
        try { chat = await readChatOnly(t); }
        catch (error) { dbg('session.slice.read', { message: `${t.sid}: ${String((error as Error)?.message || error)}` }, 'warn'); missed.push(t.sid); continue; }
        if (((chat.localLore as unknown[] | undefined) ?? []).some(e => object(e)?.comment === SESSION_LORE_NAME)) {
          try { slice = payload(chat, t); }
          catch (error) { dbg('session.slice.skip', { message: `${t.sid}: ${String((error as Error)?.message || error)}` }, 'warn'); slice = 'invalid'; }
        }
      }
      // A write made here meanwhile started a new cache; this one is only ours now.
      cache.rows.set(t.sid, slice);
    }
    const slice = cache.rows.get(t.sid);
    if (slice) rows.set(t.sid, slice);
  }
  return { rows, missed };
}

/**
 * The census, looked up when the save has none: every chat that could hold an entry is read once. Null when the
 * host cannot list its bots (then nothing is known, and nothing is written down).
 */
async function censusOf(api: KvApi | null, list?: readonly Target[]): Promise<Set<string> | null> {
  const stored = await storedCensus(api);
  if (stored) return stored;
  const all = list ?? await listedTargets(false);
  if (!all) return null;
  const { rows, missed } = await slicesOf(all);
  const found = new Set([...rows].filter(([, slice]) => slice !== 'invalid').map(([sid]) => sid));
  // A chat that could not be read may hold one: the next start looks again.
  if (missed.length) return found;
  census = found;
  await saveCensus();
  return census;
}
/** `targets`, but null when the host cannot list its bots at all (no call for it, or refused). */
async function listedTargets(fresh: boolean): Promise<Target[] | null> {
  const host = risuHost();
  if (!host?.getDatabase || !host.getCharacterFromIndex || !host.getChatFromIndex || !host.setChatToIndex) return null;
  if (!await characterDirectory({ fresh, lore: true })) return null;
  return targets(false);
}
/** A store's rows by the session each belongs to; rows of no session (and the global scope) are left out. */
function rowsBySession(key: string, store: RecordValue): Map<string, RecordValue> {
  const out = new Map<string, RecordValue>();
  for (const [id, row] of Object.entries(store)) {
    const sid = rowSession(key, id, row);
    if (!sid || sid === '__global__') continue;
    const rows = out.get(sid) ?? {};
    rows[id] = row;
    out.set(sid, rows);
  }
  return out;
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

/** A chat's rows for one store, from its entry: null when it holds none for it (or its entry is not its own). */
function savedRows(slice: Slice | undefined, key: string): RecordValue | null {
  return slice && slice !== 'invalid' && owns(slice.records, key) ? storedObject(slice.records[key]) : null;
}

/** Legacy values stay untouched; an explicit empty record prevents resurrection. */
export async function readSessionStorage(key: string, legacy: unknown, api: KvApi | null = null): Promise<unknown> {
  // Jobs are memory-only: no boot reader exists, so lorebook slices would be
  // write-only weight. Nothing stored, nothing merged.
  if (key === STORE_KEY('jobs')) return legacy;
  return serializeSessionStorage(async () => {
    const known = await storedCensus(api);
    // No chat holds an entry of ours: the plain value is all there is, with no bot listed and no chat read.
    if (known && !known.size) return legacy;
    if (!mixedKeys.has(key)) {
      // A pack or a note key, one chat's (or one bot's chats'): the chats that hold an entry are the only ones read.
      const has = known ?? await censusOf(api);
      if (!has?.size) return legacy;
      const warm = directoryWarm();
      let all = await targets();
      if (warm && !directTarget(key, all) && !packedTargets(key, all).length) all = await targets(true);
      const target = directTarget(key, all);
      if (target) {
        // No seeding: pack/note rows are memory-only now. A legacy value is
        // returned as-is so old entries stay readable; the lorebook stays clean.
        if (!has.has(target.sid)) return legacy;
        const slice = (await slicesOf([target], true)).rows.get(target.sid);
        return slice && slice !== 'invalid' && owns(slice.records, key) ? slice.records[key] : legacy;
      }
      const packed = packedTargets(key, all).filter(t => has.has(t.sid));
      if (!packed.length) return legacy;
      const result = { ...storedObject(legacy) }, slices = (await slicesOf(packed, true)).rows;
      for (const t of packed) {
        const saved = savedRows(slices.get(t.sid), key), old = packChunk(legacy, t);
        if (!saved) continue;
        if (JSON.stringify(packChunk(saved, t)) !== JSON.stringify({ cards: storedObject(saved.cards), images: storedObject(saved.images) })) throw new Error('Foreign gallery rows');
        replacePackChunk(result, old, saved);
      }
      return result;
    }
    const all = await listedTargets(false);
    if (!all?.length) return legacy;
    const result = { ...storedObject(legacy) };
    const merge = (t: Target, saved: RecordValue): void => {
      // A row of another session is left out rather than merged into this chat's scope.
      if (Object.entries(saved).some(([id, row]) => rowSession(key, id, row) !== t.sid)) { dbg('session.slice.foreign', { message: `${key} ${t.sid}` }, 'warn'); return; }
      for (const [id, row] of Object.entries(result)) if (rowSession(key, id, row) === t.sid) delete result[id];
      Object.assign(result, saved);
    };
    if (known) {
      // Only the chats written down as holding an entry are read.
      const holders = all.filter(t => known.has(t.sid)), slices = (await slicesOf(holders, true)).rows;
      for (const t of holders) { const saved = savedRows(slices.get(t.sid), key); if (saved) merge(t, saved); }
      return result;
    }
    // The first look of this save: every chat that could hold an entry, and old rows moved into their chat.
    const { rows: slices, missed } = await slicesOf(all);
    const plain = rowsBySession(key, result), found = new Set<string>();
    for (const t of all) {
      const slice = slices.get(t.sid);
      if (slice === 'invalid') continue;
      if (slice) found.add(t.sid);
      const saved = savedRows(slice, key);
      if (saved) { merge(t, saved); continue; }
      const rows = plain.get(t.sid);
      if (rows && !missed.includes(t.sid)) { await writeRecord(t, key, rows); found.add(t.sid); }
    }
    if (!missed.length && !census) { census = found; await saveCensus(); }
    return result;
  });
}

export async function writeSessionStorage(key: string, value: unknown, api: KvApi): Promise<void> {
  // Jobs are memory-only. An interrupted run that never baked is just a
  // failure; reroll reads image metadata through its own logic now.
  if (key === STORE_KEY('jobs')) return;
  // Pack keys and per-chat note keys are written nowhere any more (memory + Risu assets only; the user clears old
  // values by hand): an unknown sid must not resurrect a legacy save-file row. Reads of existing entries keep working.
  if (!mixedKeys.has(key)) return;
  return serializeSessionStorage(async () => {
    const next = { ...storedObject(value) };
    const sessions = rowsBySession(key, next);
    const known = await storedCensus(api);
    // No row here belongs to a chat and no chat holds one of ours: the plain store alone, no bot listed.
    if (known && !known.size && !sessions.size) { await api.setItem!(key, value); return; }
    const all = await listedTargets(true);
    if (!all?.length) { await api.setItem!(key, value); return; }
    const has = known ?? await censusOf(api, all);
    const backups = rowsBySession(key, storedObject(await api.getItem!(key)));
    // Only chats with rows to store, a backup to keep in step, or an entry that may hold rows since removed here.
    for (const t of all) {
      const rows = sessions.get(t.sid) ?? {}, backup = backups.get(t.sid) ?? {};
      const holds = Object.keys(rows).length || Object.keys(backup).length || (has?.has(t.sid) && savedRows((await slicesOf([t], true)).rows.get(t.sid), key));
      if (holds) await writeRecord(t, key, rows);
      for (const id of Object.keys(rows)) delete next[id];
      Object.assign(next, backup);
    }
    // Only the non-session portion changes in pluginStorage. Session rows here
    // are retained byte-for-byte as a read-only migration backup.
    await api.setItem!(key, next);
  });
}

/**
 * True when the key is ours to keep (nothing more to remove), false when the plain store should drop it.
 * Pack/note keys are hands-off: the user clears old values by hand, so neither the lorebook nor the save file is
 * touched here. A store that keeps rows per chat is never one chat's key, so only its plain value goes.
 */
export async function removeSessionStorage(key: string): Promise<boolean> {
  return !mixedKeys.has(key);
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
  // Bakes find the note by chat: the open bot names its own chats, and only another bot's is looked up in the list.
  if (!row.target) void targetOf(sid).then(target => { if (target && pendingNotes.get(sid) === row) row.target = target; }).catch(() => {});
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
/** The bot a note session belongs to (its chat's character), or "" when none is known. */
export async function characterIdForNoteSession(sid:string):Promise<string> {
  // The open bot (or one a job holds) owns it: no directory of every bot.
  const open=await openBotFor(sid);
  if(open?.chats.has(sid)) return open.id;
  return (await targetOf(sid))?.characterId || '';
}
export async function readChatNote(sid:string):Promise<unknown> {
  return serializeSessionStorage(async()=> {
    const waiting=pendingNotes.get(sid)?.patch;
    const hasWaiting=!!waiting && Object.keys(waiting).length>0;
    // The open bot's chat comes with the bot as read: no directory of every bot, no second copy, no chat read.
    const open=await openBotFor(sid), at=open?.chats.get(sid);
    const own=open && at!==undefined ? object((open.char.chats as unknown[])[at]) : null;
    if(own) { const stored=notePayload(own); return hasWaiting ? { ...(object(stored) ?? {}), ...waiting } : stored; }
    const target=await targetOf(sid);
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
    // The open bot names its own chat (no list of every bot); a write still has the bot and the chat vouched for.
    let target=await targetOf(sid,true);
    if(!target)throw new Error('Chat required for author note');
    let chat:RecordValue;
    try { chat=await readChat(target); }
    catch (error) {
      // Where the open bot sat when it was last read may be stale: the list is asked once.
      const listed=(await targets(true)).find(t=>t.sid===sid);
      if(!listed) throw error;
      target=listed; chat=await readChat(target);
    }
    const previous = object(notePayload(chat)) ?? {};
    // Merge under the same queue as the fresh chat read; omitted fields must
    // never replay a stale location or erase a concurrent note edit.
    note = { ...previous, ...object(note) };
    if (JSON.stringify(previous) === JSON.stringify(note)) return note;
    chatEpoch++;
    await risuHost()!.setChatToIndex!(target.character,target.chat,{...chat,localLore:noteLore(chat,note)});forgetBots();
    if(JSON.stringify(notePayload(await readChatOnly(target)))!==JSON.stringify(note))throw new Error('Author note verification failed');
    return note;
  });
}
