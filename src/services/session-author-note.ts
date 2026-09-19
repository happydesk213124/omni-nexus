import { readChatNote, writeChatNote } from '../storage/chat-session-store';
import { SESSION_AUTHOR_NOTE_PRESETS_KEY } from '../core/constants';
import type { ApiResult } from '../core/types';
import { cleanText, sessionIdHash } from '../core/util/text';
import { joinSessionAuthorNote, parseSessionAuthorNote, parseSessionWear, formatSessionWearReference, sessionAuthorNoteSystemContent, type SessionWearEntry } from '../domain/tagging/session-note';
import { parseWearState } from '../domain/character/wear-state';
import { psGet, psSet } from '../storage/device-store';

let noteUpdates: Promise<unknown> = Promise.resolve();
function updateNote<T>(work: () => Promise<T>): Promise<T> {
  const next = noteUpdates.then(work);
  noteUpdates = next.catch(() => {});
  return next;
}

export interface SessionNotePreset {
  id: string;
  name: string;
  prefix: string;
  suffix: string;
}

function asPresets(raw: unknown): SessionNotePreset[] {
  const rec = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as { items?: unknown } : null;
  const arr = Array.isArray(raw) ? raw : Array.isArray(rec?.items) ? rec!.items : [];
  const out: SessionNotePreset[] = [];
  for (const row of arr) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const id = cleanText(r.id, 80);
    const name = cleanText(r.name, 80);
    if (!id || !name) continue;
    out.push({
      id,
      name,
      prefix: cleanText(r.prefix ?? r.text, 8000),
      suffix: cleanText(r.suffix ?? r.post, 8000),
    });
  }
  return out;
}

/** Notes belong to an actual chat, independently of gallery/roster scope. */
export function chatNoteSessionId(sessionId: unknown, extra: Record<string, unknown> = {}): string {
  const characterId = cleanText(extra.character_id ?? extra.characterId, 200);
  const chatId = cleanText(extra.chat_id ?? extra.chatId, 200);
  if (characterId && chatId && chatId !== '__unified__') {
    return `risu_${sessionIdHash(`${characterId}|${chatId}`)}`;
  }
  return cleanText(sessionId, 200);
}

export async function getSessionAuthorNote(
  sessionId: unknown,
  extra: Record<string, unknown> = {},
): Promise<ApiResult> {
  const id = chatNoteSessionId(sessionId, extra);
  if (!id) throw new Error('session_id required');
  const raw = await readChatNote(id);
  const parsed = parseSessionAuthorNote(raw);
  const text = joinSessionAuthorNote(parsed.prefix, parsed.suffix);
  // `wear` is omitted when empty so responses without remembered outfits stay
  // byte-identical to the pre-wear shape (parity + deepEqual tests).
  const { wear, ...rest } = parsed;
  void wear;
  return {
    ok: true,
    session_id: id,
    ...rest,
    ...(parsed.wear.length ? { wear: parsed.wear } : {}),
    text,
  };
}

/** Empty when no session or no text. Callers append this after the global note. */
export async function sessionAuthorNoteLlmContent(sessionId: unknown): Promise<string> {
  const id = cleanText(sessionId, 200);
  if (!id) return '';
  try {
    const note = await getSessionAuthorNote(id);
    const rec = note as unknown as Record<string, unknown>;
    const sys = sessionAuthorNoteSystemContent(note);
    const ref = formatSessionWearReference(parseSessionWear(rec.wear));
    return [sys, ref].filter(Boolean).join('\n\n');
  } catch {
    return '';
  }
}

async function setSessionAuthorNoteUnlocked(
  sessionId: unknown,
  body: Record<string, unknown> | unknown,
): Promise<ApiResult> {
  const rec = body && typeof body === 'object' && !Array.isArray(body)
    ? body as Record<string, unknown>
    : { text: body };
  const id = chatNoteSessionId(sessionId, rec);
  if (!id) throw new Error('session_id required');
  const patch: Record<string, unknown> = {};
  for (const key of ['prefix', 'suffix', 'preset_id', 'location']) {
    if (rec[key] != null) patch[key] = rec[key];
  }
  if (rec.wear != null) {
    const entries = parseSessionWear(rec.wear);
    patch.wear = Object.fromEntries(entries.map((e) => [e.id, { name: e.name, wear: e.wear }]));
  }
  if (rec.prefix == null && rec.suffix == null && rec.text != null) {
    patch.prefix = rec.text;
    patch.suffix = '';
  }
  if (rec.preset_id == null && rec.presetId != null) patch.preset_id = rec.presetId;
  if (rec.location == null && rec.location_tags != null) patch.location = rec.location_tags;
  for (const key of Object.keys(patch)) {
    // wear is already a validated id→{name, wear} map, not text — cleanText
    // would stringify it into oblivion.
    if (key === 'wear') continue;
    patch[key] = cleanText(patch[key], key === 'location' ? 800 : key === 'preset_id' ? 80 : 8000);
  }
  const next = parseSessionAuthorNote(await writeChatNote(id, patch));
  const { prefix, suffix } = next;
  // Same omission as GET: no wear key when nothing is remembered.
  const { wear: _worn, ...rest } = next;
  void _worn;
  return {
    ok: true,
    session_id: id,
    ...rest,
    ...(next.wear.length ? { wear: next.wear } : {}),
    text: joinSessionAuthorNote(prefix, suffix),
  };
}

/** Keep prefix/suffix; write the running place tags after a job. */
function persistSessionLocationUnlocked(sessionId: unknown, location: unknown): Promise<void> {
  const id = cleanText(sessionId, 200);
  if (!id) return Promise.resolve();
  return writeChatNote(id, { location: cleanText(location, 800) }).then(() => {});
}

/**
 * Replace the session's remembered outfit map with the latest generation's
 * final states. `clothed` is the default and is never stored — an empty map
 * means "everyone clothed", which also clears a stale nude entry when a
 * character dresses again. Looks are never touched; only the wear key.
 */
export interface SessionWearPersistEntry {
  id?: unknown;
  name?: unknown;
  wear?: unknown;
}

function persistSessionWearStatesUnlocked(sessionId: unknown, entries: SessionWearPersistEntry[]): Promise<void> {
  const id = cleanText(sessionId, 200);
  if (!id) return Promise.resolve();
  const map: Record<string, { name: string; wear: string }> = {};
  for (const entry of entries || []) {
    const wid = cleanText(entry?.id, 200);
    const wear = parseWearState(entry?.wear);
    if (!wid || !wear || wear === 'clothed') continue;
    map[wid] = { name: cleanText(entry?.name, 200) || wid, wear };
  }
  return writeChatNote(id, { wear: map }).then(() => {});
}

export function setSessionAuthorNote(sessionId: unknown, body: Record<string, unknown> | unknown): Promise<ApiResult> {
  return updateNote(() => setSessionAuthorNoteUnlocked(sessionId, body));
}

export function persistSessionLocation(sessionId: unknown, location: unknown): Promise<void> {
  return updateNote(() => persistSessionLocationUnlocked(sessionId, location));
}

export function persistSessionWearStates(sessionId: unknown, entries: SessionWearPersistEntry[]): Promise<void> {
  return updateNote(() => persistSessionWearStatesUnlocked(sessionId, entries));
}

export type { SessionWearEntry };

export async function listSessionAuthorNotePresets(): Promise<ApiResult> {
  const items = asPresets(await psGet(SESSION_AUTHOR_NOTE_PRESETS_KEY));
  return { ok: true, items };
}

export async function saveSessionAuthorNotePresets(items: unknown): Promise<ApiResult> {
  const next = asPresets(items);
  await psSet(SESSION_AUTHOR_NOTE_PRESETS_KEY, { items: next });
  return { ok: true, items: next };
}
