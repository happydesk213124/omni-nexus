/**
 * Persist + seed the character lore whitelist (lorefilter).
 */
import { dbg } from '../core/debug.ts';
import { hostHas, risuHost } from '../core/host.ts';
import type { ApiResult, LoreEntry } from '../core/types.ts';
import { cleanText } from '../core/util/text.ts';
import { resolveLlmRole } from '../domain/llm/roles.ts';
import {
  buildLoreCatalog,
  filterLoreEntriesBySelected,
  matchCatalogIdsFromNames,
  normalizeLorefilterSelected,
  parseLorefilterNameArray,
  type LoreCatalogItem,
} from '../domain/lore/lorefilter.ts';
import { callLlm } from './llm-call.ts';
import { idbGet } from '../storage/stores.ts';
import { readCharacterEntryKey, writeCharacterEntryKey } from '../storage/character-roster.ts';
import { getPrompt } from './settings.ts';
import { getConfig } from './context.ts';

export const lorefilterMetaKey = (characterId: string): string =>
  `lorefilter_${cleanText(characterId, 200) || 'unknown'}`;

interface LorefilterMetaRow {
  key: string;
  selected?: string[];
  updated_at?: number;
}

/** Generation reads this per shot; the lorebook round-trip happens once. */
const selectedCache = new Map<string, string[]>();
const initialized = new Set<string>();
const revisions = new Map<string, number>();
const scans = new Map<string, Promise<string[]>>();
const LOREFILTER_ENTRY_KEY = 'lorefilter';

async function readSelected(characterId: string): Promise<string[]> {
  // Lorebook first; the meta row is a read-only leftover the user deletes by
  // hand. Risu character deletion cascades the lorebook copy — the meta row
  // never did, which is why it moved.
  const cached = selectedCache.get(characterId);
  if (cached) return [...cached];
  const revision = revisions.get(characterId) || 0;
  let selected: unknown;
  try {
    selected = await readCharacterEntryKey(characterId, LOREFILTER_ENTRY_KEY);
  } catch {
    selected = undefined;
  }
  if (selected === undefined) {
    const row = (await idbGet('meta', lorefilterMetaKey(characterId))) as LorefilterMetaRow | null;
    selected = row?.selected;
  }
  if ((revisions.get(characterId) || 0) !== revision) return [...(selectedCache.get(characterId) || [])];
  const next = normalizeLorefilterSelected(selected);
  if (Array.isArray(selected)) {
    initialized.add(characterId);
    selectedCache.set(characterId, next);
  }
  return next;
}

async function writeSelected(characterId: string, selected: string[]): Promise<string[]> {
  const next = normalizeLorefilterSelected(selected);
  // Lorebook only. No meta write: a fresh meta row here would outlive the
  // character it belongs to, which was the whole reason for the move.
  await writeCharacterEntryKey(characterId, LOREFILTER_ENTRY_KEY, next);
  selectedCache.set(characterId, next);
  initialized.add(characterId);
  return next;
}

/** Full lorebook from Risu host when available. */
export async function fetchHostLorebookEntries(): Promise<LoreEntry[]> {
  if (!hostHas('getCurrentLorebookEntries')) return [];
  try {
    const host = risuHost() as { getCurrentLorebookEntries?: () => Promise<unknown> };
    const raw = await host.getCurrentLorebookEntries?.();
    return Array.isArray(raw) ? (raw as LoreEntry[]) : [];
  } catch (err) {
    dbg('lorefilter.host_lore.fail', { message: String((err as Error)?.message || err) }, 'warn');
    return [];
  }
}

/** Settings navigation selects a bot without changing Risu's live chat. */
export async function fetchCharacterLorebookEntries(characterId: string): Promise<LoreEntry[]> {
  const db = await risuHost()?.getDatabase?.(['characters', 'modules', 'enabledModules']);
  const characters = Array.isArray(db?.characters) ? db.characters as Record<string, unknown>[] : [];
  const character = characters.find(c => String(c.chaId || c.id || '') === characterId);
  if (!character) return [];
  const chats = Array.isArray(character.chats) ? character.chats as Record<string, unknown>[] : [];
  const chat = chats[Number(character.chatPage) || 0];
  const enabled = new Set([...(db?.enabledModules || []), ...(Array.isArray(chat?.modules) ? chat.modules : [])]);
  const entries = [
    ...(Array.isArray(character.globalLore) ? character.globalLore : []),
    ...(Array.isArray(chat?.localLore) ? chat.localLore : []),
    ...(db?.modules || []).filter(m => enabled.has(m.id)).flatMap(m => m.lorebook || []),
  ] as LoreEntry[];
  return entries.filter(entry => !String(entry.comment || '').startsWith('omni.nexus.data.') && !String(entry.comment || '').startsWith('inlay.nexus.data.'));
}

async function seedSelectedFromLlm(catalog: LoreCatalogItem[]): Promise<string[]> {
  if (!catalog.length) return [];
  const system = (await getPrompt('lorefilter_scan')).trim()
    || 'Extract distinct RP character names from lorebook entry titles. Return JSON array of strings only.';
  const titles = catalog.map((c) => (c.keys.length ? `${c.title} (${c.keys.slice(0, 4).join(', ')})` : c.title));
  const messages = [
    { role: 'system' as const, content: system },
    {
      role: 'user' as const,
      content: JSON.stringify({ lorebookEntryIdentifiers: titles }),
    },
  ];
  const raw = await callLlm(resolveLlmRole(getConfig(), 'asset_char'), messages);
  const names = parseLorefilterNameArray(raw);
  const ids = matchCatalogIdsFromNames(catalog, names);
  dbg('lorefilter.seed', { titles: titles.length, names: names.length, matched: ids.length, focus: true });
  return ids;
}

/**
 * Seed once per bot. An explicitly saved empty selection is already initialized.
 * `force` re-scans even when selected already exists.
 */
export function ensureLorefilter(
  characterId: string,
  entries: LoreEntry[] | null | undefined,
  opts: { force?: boolean } = {},
): Promise<string[]> {
  const cid = cleanText(characterId, 200);
  if (!cid) return Promise.resolve([]);
  const pending = scans.get(cid);
  if (pending) return pending;
  const revision = revisions.get(cid) || 0;
  const task = (async () => {
    const existing = await readSelected(cid);
    if ((initialized.has(cid) || existing.length) && !opts.force) return existing;
    const catalog = buildLoreCatalog(entries);
    if (!catalog.length) return existing;
    try {
      const seeded = await seedSelectedFromLlm(catalog);
      if ((revisions.get(cid) || 0) !== revision) return readSelected(cid);
      if (!seeded.length) {
        dbg('lorefilter.seed.empty', { character_id: cid, catalog: catalog.length }, 'warn');
        // A failed match must not erase a previously curated selection.
        if (existing.length) return existing;
      }
      return await writeSelected(cid, seeded);
    } catch (err) {
      dbg('lorefilter.seed.fail', { message: String((err as Error)?.message || err) }, 'warn');
      if (opts.force) throw err;
      return existing;
    }
  })().finally(() => { if (scans.get(cid) === task) scans.delete(cid); });
  scans.set(cid, task);
  return task;
}

/** Apply whitelist; fail-open when empty / no matches. */
export function applyLorefilter(
  entries: LoreEntry[] | null | undefined,
  selected: readonly string[] | null | undefined,
): LoreEntry[] {
  return filterLoreEntriesBySelected(entries, selected);
}

export async function getLorefilterPayload(args: {
  character_id?: string;
  lorebook?: LoreEntry[] | null;
} = {}): Promise<ApiResult> {
  const cid = cleanText(args.character_id || '', 200);
  if (!cid) return { ok: false, error: { code: 'bad_request', message: 'character_id required' } };
  const hostLore = Array.isArray(args.lorebook)
    ? args.lorebook
    : await fetchCharacterLorebookEntries(cid);
  const catalog = buildLoreCatalog(hostLore);
  const selected = await readSelected(cid);
  return {
    ok: true,
    character_id: cid,
    selected,
    initialized: initialized.has(cid),
    catalog,
    count_selected: selected.length,
    count_catalog: catalog.length,
  };
}

export async function setLorefilterSelected(args: {
  character_id?: string;
  selected?: unknown;
} = {}): Promise<ApiResult> {
  const cid = cleanText(args.character_id || '', 200);
  if (!cid) return { ok: false, error: { code: 'bad_request', message: 'character_id required' } };
  revisions.set(cid, (revisions.get(cid) || 0) + 1);
  const selected = await writeSelected(cid, normalizeLorefilterSelected(args.selected));
  return { ok: true, character_id: cid, selected, count_selected: selected.length };
}

export async function rescanLorefilter(args: {
  character_id?: string;
  lorebook?: LoreEntry[] | null;
} = {}): Promise<ApiResult> {
  const cid = cleanText(args.character_id || '', 200);
  if (!cid) return { ok: false, error: { code: 'bad_request', message: 'character_id required' } };
  const hostLore = Array.isArray(args.lorebook)
    ? args.lorebook
    : await fetchCharacterLorebookEntries(cid);
  const selected = await ensureLorefilter(cid, hostLore, { force: true });
  const catalog = buildLoreCatalog(hostLore);
  return {
    ok: true,
    character_id: cid,
    selected,
    catalog,
    count_selected: selected.length,
    count_catalog: catalog.length,
    rescanned: true,
    initialized: initialized.has(cid),
  };
}

/** For UI helpers without importing the service graph. */
export {
  loreEntryId,
  loreEntryTitle,
  buildLoreCatalog,
  filterLoreEntriesBySelected,
  normalizeLorefilterSelected,
} from '../domain/lore/lorefilter.ts';
