import { syncGenderIntoAppearance } from '../domain/character/tags';
import { mergeSessionAndGlobalRoster } from '../domain/character/roster';
import { readCharacterRoster, mutateCharacterRoster } from '../storage/character-roster';
import { givenNameDuplicates, mergedGivenNames } from '../domain/character/save-identity';
/**
 * Bot-owned character rosters. Storage resolves chat aliases to one disabled
 * character-lore entry; it never reads legacy plugin/global roster rows.
 * Identity normalization remains in domain/character. Scene wear lives on shots.
 */

import { GLOBAL_SCOPE, charRefScopeForCharacter } from '../core/constants';
import { dbg } from '../core/debug';
import { compactAssetKey } from '../domain/nai-meta/match.ts';
import type { ApiResult, CharacterRecord, ShotCharacter, TaggerResult } from '../core/types';
import { cleanText, joinTags, normalizeAlias, parseAliasList, writeSessionId } from '../core/util/text';
import { characterMatchesIdentity, inferGenderFromExactTags, normalizeGender, latinGivenTokenOverlap, absorbAliasesFromDonor, ASSET_LOOKS_PRIORITY } from '../domain/character/identity';
import type { CharacterInput } from '../domain/character/identity';
import {
  characterTriggers,
  foldCharacterUpsert,
  matchCharactersInText,
  normalizeCharacterRecord,
  pickUnifiedWinners,
  resolveCharacter,
  scanLinkedChatsForRosterMerge,
} from '../domain/character/roster';
import {
  characterHasAppearance,
  incomingLooksForIncomplete,
  fullTags,
  normalizeTaggedLookBuckets,
  parseWearState,
  wearLocked,
} from '../domain/character/tags';
import {
  COSTUME_FIELDS,
  collectCostumePairs,
  ensureCostumes,
  mergeCostumeLists,
  promoteCostumeToDefault,
  syncActiveCostumeFromWear,
} from '../domain/character/costume';
import { sanitizeHash } from '../domain/character/char-ref-store';
import { sanitizeCastId } from '../domain/gallery/cast-ids.ts';
import { normalizeEyeColorSlot, normalizeHairColorSlot } from '../domain/character/looks-fields';
import { restoreAssetTagWeights } from '../domain/nai-meta/prompt-tags.ts';
import { idbDelete, idbGetAll, idbPut } from '../storage/stores';
import { getLastAssetWeightMap } from './asset-tags';
import { getCharRefPreviewUrl, getConfig, getExamplePreviewUrl } from './context';
import { seedCharRefsFromLooks } from './nai-assets';
import type { ReferenceCandidate } from '../domain/nai-meta/reference-search';

export interface ReplaceOptions {
  prune?: boolean;
  rootSessionIds?: unknown[];
}

/** Mirrors the `_runJob` call site: the tagger's own arguments, in order. */
export interface MergeRosterArgs {
  sessionId: string;
  /** Mutated in place: `new_characters` is rewritten with the shot-derived additions. */
  tagged: TaggerResult;
  /** Every character of every shot, flattened. */
  shotChars: ShotCharacter[];
  /** Threaded through to `rosterForSession`, which ignores it. */
  unifiedSessionId?: string;
  characterId?: string;
  sourceSessionIds?: unknown[];
  /** When true (char_looks prepass), bump written rows to ASSET_LOOKS_PRIORITY. */
  assetLooks?: boolean;
  /** Compact trigger/name → NAI identity tag; wins over LLM `original` when set. */
  originalHints?: Record<string, string>;
  referenceCandidates?: readonly ReferenceCandidate[];
}

interface SessionEditCount {
  sessions: number;
}

/** Anything that might carry name parts: a roster row, or a raw cast entry. */
type NamePartSource = {
  surname?: unknown;
  given_name?: unknown;
  surname_variants?: unknown;
  given_name_variants?: unknown;
  [key: string]: unknown;
} | null | undefined;

interface NameParts {
  surname: string;
  given_name: string;
  surname_variants: string[];
  given_name_variants: string[];
}

const hasOwn = (value: unknown, field: string): boolean =>
  !!value && Object.prototype.hasOwnProperty.call(value as object, field);

/** Mirrors `[...(value || [])]`: a string spreads into characters, as it always has. */
const spreadLoose = (value: unknown): unknown[] => (value ? [...(value as Iterable<unknown>)] : []);

const asRoster = (rows: readonly CharacterInput[]): CharacterRecord[] => rows as CharacterRecord[];

// ── reads ──────────────────────────────────────────────────────────────────

export async function listCharacters(scope: string): Promise<CharacterRecord[]> {
  const rows = (await readCharacterRoster(scope)).map<CharacterRecord>(row=>({...row,scope}))
    .sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' }));
  const out: CharacterRecord[] = [];
  for (const row of rows) {
    let aliases: unknown = row.aliases;
    if (typeof aliases === 'string') {
      try {
        aliases = JSON.parse(aliases);
      } catch {
        aliases = parseAliasList(aliases);
      }
    }
    const appearance = cleanText(row.appearance || '', 4000);
    const attire = row.attire || '';
    const bottoms = row.bottoms || '';
    const accessories = row.accessories || '';
    let gender = normalizeGender(row.gender ?? row.sex);
    // Reads stay pure: infer legacy gender for this view, then persist it only
    // when the row is next explicitly written.
    if (!gender) {
      const inferred = inferGenderFromExactTags(appearance, attire, accessories);
      if (inferred) gender = inferred;
    }
    const ensured = ensureCostumes(row);
    const rec: CharacterRecord = {
      id: row.id,
      name: row.name,
      aliases: Array.isArray(aliases) ? (aliases as string[]) : parseAliasList(aliases),
      surname: row.surname || '',
      given_name: row.given_name || '',
      surname_variants: parseAliasList(row.surname_variants),
      given_name_variants: parseAliasList(row.given_name_variants),
      priority: Number(row.priority || 0),
      attire_locked: wearLocked(row.attire_locked),
      bottoms_locked: wearLocked(row.bottoms_locked),
      accessories_locked: wearLocked(row.accessories_locked),
      schema_version: Number(row.schema_version || 1),
      original: row.original || '',
      appearance,
      attire,
      bottoms,
      accessories,
      costumes: ensured.costumes,
      active_costume: ensured.active_costume,
      gender,
      wear_state: parseWearState(row.wear_state) || undefined,
      updated_at: row.updated_at,
      scope: row.scope,
    };
    const hairColor = normalizeHairColorSlot(row.hair_color || '', 120);
    const hairStyle = cleanText(row.hair_style || '', 400);
    const eyeColor = normalizeEyeColorSlot(row.eye_color || '', 120);
    const height = cleanText(row.height || '', 80);
    const penisSize = cleanText(row.penis_size || '', 40);
    if (hairColor) rec.hair_color = hairColor;
    if (hairStyle) rec.hair_style = hairStyle;
    if (eyeColor) rec.eye_color = eyeColor;
    if (height) rec.height = height;
    if (row.age != null && row.age !== '') rec.age = row.age;
    if (penisSize) rec.penis_size = penisSize;
    const castId = sanitizeCastId(row.cast_id);
    if (castId) rec.cast_id = castId;
    rec.tags = fullTags(rec);
    const cid = cleanText(rec.id, 200);
    if (cid) {
      const refScope = charRefScopeForCharacter(rec.scope, scope, scope);
      const hash = sanitizeHash(row.ref_hash);
      if (hash) rec.ref_hash = hash;
      rec.ref_configured = Boolean(hash);
      rec.ref_preview_url = hash ? getCharRefPreviewUrl(refScope, cid) : '';
      const ex = sanitizeHash(row.example_hash);
      if (ex) {
        rec.example_hash = ex;
        rec.example_configured = true;
        rec.example_preview_url = getExamplePreviewUrl(refScope, cid);
      }
    }
    out.push(rec);
  }
  return out;
}

// ── per-character global toggles ───────────────────────────────────────────

export async function getDisabledGlobals(characterId: string): Promise<string[]> {
  void characterId;return [];
}

export async function setDisabledGlobals(characterId: string, disabledKeys: unknown[]): Promise<ApiResult> {
  void disabledKeys;return {ok:true,character_id:characterId,disabled_globals:[]};
}

/** A toggle may have been stored under the id or the name, in either case. */
function globalCharKeys(char: { id?: unknown; name?: unknown }): string[] {
  const keys: string[] = [];
  for (const raw of [char.id, char.name]) {
    const text = cleanText(raw, 200);
    if (!text) continue;
    keys.push(text);
    const low = text.toLowerCase();
    if (low !== text) keys.push(low);
  }
  return [...new Set(keys)];
}

function globalToggleKeyDisabled(char: { id?: unknown; name?: unknown }, disabled: Set<string> | undefined): boolean {
  if (!disabled?.size) return false;
  for (const key of globalCharKeys(char)) {
    if (disabled.has(key)) return true;
  }
  return false;
}

export async function getDisabledGlobalsSet(characterId: string): Promise<Set<string>> {
  const list = await getDisabledGlobals(characterId);
  return new Set(list);
}

export async function globalEnabledMap(characterId: string): Promise<Record<string, boolean>> {
  const disabled = await getDisabledGlobalsSet(characterId);
  const out: Record<string, boolean> = {};
  for (const char of await listCharacters(GLOBAL_SCOPE)) {
    const enabled = !globalToggleKeyDisabled(char, disabled);
    for (const key of globalCharKeys(char)) out[key] = enabled;
    // Unconditional, so a nameless row writes an empty-string key. The UI looks
    // rows up by name and never asks for "", so the stray entry is inert.
    out[cleanText(char.name, 200)] = enabled;
  }
  return out;
}

// ── session roster ─────────────────────────────────────────────────────────

/**
 * Writes target the character unified id when the caller has one.
 */
export function rosterStoreSessionId(sessionId: string, unifiedSessionId = ''): string {
  return writeSessionId({ sessionId, unifiedSessionId });
}

export async function listMergedSessionCharacters(sourceSessionIds: unknown[] = []): Promise<CharacterRecord[]> {
  const collected: CharacterRecord[] = [];
  const seen = new Set<string>();
  for (const raw of sourceSessionIds || []) {
    const sid = cleanText(raw, 200);
    if (!sid || sid === GLOBAL_SCOPE || seen.has(sid)) continue;
    seen.add(sid);
    collected.push(...(await listCharacters(sid)));
  }
  return collected;
}

export async function listUnifiedViewCharacters(sourceSessionIds: unknown[] = []): Promise<CharacterRecord[]> {
  const collected = await listMergedSessionCharacters(sourceSessionIds);
  if (getConfig()?.card?.unified_winners_only) {
    return asRoster(pickUnifiedWinners(collected, characterHasAppearance));
  }
  return collected;
}

/**
 * The roster a chat sees: its own rows plus every global the character has not
 * switched off. With `unified_chat_priority` the session half is the linked
 * chats concatenated. `unified_winners_only` then keeps one row per name.
 */
export async function rosterForSession(
  sessionId: string,
  _unifiedSessionId = '',
  characterId = '',
  _sourceSessionIds: unknown[] = [],
): Promise<CharacterRecord[]> {
  if(sessionId===GLOBAL_SCOPE)return listCharacters(GLOBAL_SCOPE);
  return mergeSessionAndGlobalRoster(await listCharacters(characterId || _unifiedSessionId || sessionId), await listCharacters(GLOBAL_SCOPE), {hasAppearance:characterHasAppearance,resolve:resolveCharacter}) as CharacterRecord[];
}

/** Same arguments `buildTaggerMessages` threads into `rosterForSession`. */
export interface TaggerRosterArgs {
  sessionId?: string;
  unifiedSessionId?: string;
  characterId?: string;
  sourceSessionIds?: unknown[];
}

/**
 * Roster the main tagger injects (merged session/unified + enabled globals,
 * then latin-peer alias absorb). The message-chip picker must call this —
 * not the raw GET session+global lists.
 */
export async function loadTaggerRoster(args: TaggerRosterArgs = {}): Promise<CharacterRecord[]> {
  const sessionId = cleanText(args.sessionId || '', 200);
  const unifiedSessionId = cleanText(args.unifiedSessionId || '', 200);
  const characterId = cleanText(args.characterId || '', 200);
  const sourceSessionIds = args.sourceSessionIds ?? [];
  const roster = await rosterForSession(sessionId, unifiedSessionId, characterId, sourceSessionIds);
  if (!roster.length) return roster;
  return absorbAliasesOntoLatinPeers({ sessionId, unifiedSessionId, characterId, sourceSessionIds });
}

/** Characters the tagger would list as "Characters in this message". */
export async function matchTriggeredCharacters(
  args: TaggerRosterArgs & { message?: unknown },
): Promise<CharacterRecord[]> {
  const roster = await loadTaggerRoster(args);
  return matchCharactersInText(cleanText(args.message, 20000), roster) as CharacterRecord[];
}

export async function matchTriggeredCharactersPayload(
  body: Record<string, unknown> | null | undefined,
): Promise<Record<string, unknown>> {
  const rec = body && typeof body === 'object' ? body : {};
  const characters = await matchTriggeredCharacters({
    message: rec.message ?? rec.text ?? rec.assistant_text ?? '',
    sessionId: String(rec.session_id || rec.sessionId || ''),
    unifiedSessionId: String(rec.unified_session_id || rec.unifiedSessionId || ''),
    characterId: String(rec.character_id || rec.characterId || ''),
    sourceSessionIds: (rec.source_session_ids || rec.sourceSessionIds || []) as unknown[],
  });
  return { ok: true, characters };
}

// ── writes ─────────────────────────────────────────────────────────────────

export async function upsertCharacter(scope: string, raw: unknown): Promise<CharacterRecord | null> {
  const appearanceProvided = hasOwn(raw, 'appearance');
  const attireProvided = hasOwn(raw, 'attire');
  const bottomsProvided = hasOwn(raw, 'bottoms');
  const accessoriesProvided = hasOwn(raw, 'accessories');
  const originalProvided = hasOwn(raw, 'original');
  const surnameProvided = hasOwn(raw, 'surname');
  const givenProvided = hasOwn(raw, 'given_name');
  const surnameVariantsProvided = hasOwn(raw, 'surname_variants');
  const givenVariantsProvided = hasOwn(raw, 'given_name_variants');
  const costumesProvided = hasOwn(raw, 'costumes');
  const activeCostumeProvided = hasOwn(raw, 'active_costume');
  const wearStateProvided = hasOwn(raw, 'wear_state');
  const promoteDefault = Boolean(
    raw && typeof raw === 'object' && (raw as Record<string, unknown>).promote_costume_default,
  );
  let rec = normalizeCharacterRecord(raw);
  if (!rec) return null;
  // Empty name fields stay empty even when legacy normalization can infer a
  // given name from an uppercase display name.
  const incomingNames = mergedGivenNames([raw as CharacterInput]);
  rec.given_name = incomingNames.given_name || '';
  rec.given_name_variants = incomingNames.given_name_variants || [];
  const scopeKey = cleanText(scope, 200) || GLOBAL_SCOPE;
  const existingList = await listCharacters(scopeKey);
  const selfId = cleanText(rec.id, 80);
  const provided = {
    appearance: appearanceProvided,
    attire: attireProvided,
    bottoms: bottomsProvided,
    accessories: accessoriesProvided,
    original: originalProvided,
    surname: surnameProvided,
    given_name: givenProvided,
    surname_variants: surnameVariantsProvided,
    given_name_variants: givenVariantsProvided,
    costumes: costumesProvided,
    active_costume: activeCostumeProvided,
    wear_state: wearStateProvided,
    attire_locked: hasOwn(raw, 'attire_locked'),
    bottoms_locked: hasOwn(raw, 'bottoms_locked'),
    accessories_locked: hasOwn(raw, 'accessories_locked'),
    hair_color: hasOwn(raw, 'hair_color'),
    hair_style: hasOwn(raw, 'hair_style'),
    eye_color: hasOwn(raw, 'eye_color'),
    height: hasOwn(raw, 'height'),
    age: hasOwn(raw, 'age'),
    penis_size: hasOwn(raw, 'penis_size'),
    gender: hasOwn(raw, 'gender'),
    priority: hasOwn(raw, 'priority'),
  };
  const sameRow = selfId
    ? existingList.find((c) => cleanText(c.id, 80) === selfId)
    : undefined;
  if (sameRow) {
    rec = foldCharacterUpsert(sameRow, rec, provided);
    if (!rec) return null;
    rec.given_name = (givenProvided ? incomingNames.given_name : sameRow.given_name) || '';
    rec.given_name_variants = (givenVariantsProvided ? incomingNames.given_name_variants : sameRow.given_name_variants) || [];
  }
  const duplicates = givenNameDuplicates(rec, existingList.filter(c => c.id !== selfId));
  const dup = duplicates[0];
  const nameFields = mergedGivenNames([rec, ...duplicates]);
  for (const duplicate of duplicates) {
    rec = foldCharacterUpsert(duplicate, rec, provided);
    if (!rec) return null;
  }
  Object.assign(rec, nameFields);
  // Retain the first existing duplicate's identity, as the single-match save did.
  if (dup) rec.id = dup.id!;

  // Normalize costumes: seed from attire if missing; sync active slot from wear on save.
  {
    let { costumes, active_costume } = ensureCostumes(rec);
    if (!costumesProvided && (attireProvided || bottomsProvided || accessoriesProvided)) {
      costumes = syncActiveCostumeFromWear(costumes, active_costume, {
        attire: rec.attire,
        bottoms: rec.bottoms,
        accessories: rec.accessories,
      });
    }
    if (promoteDefault) {
      costumes = promoteCostumeToDefault(costumes, {
        ...costumes[active_costume],
        ...Object.fromEntries(COSTUME_FIELDS.filter(key=>hasOwn(raw,key)).map(key=>[key,rec![key]])),
      });
      active_costume = 0;
      // Mirror default wear onto top-level fields.
      rec.attire = costumes[0]!.attire;
      rec.bottoms = costumes[0]!.bottoms || '';
      rec.accessories = costumes[0]!.accessories;
    }
    rec.costumes = costumes;
    rec.active_costume = active_costume;
  }

  const now = Date.now() / 1000;
  const gender = normalizeGender(rec.gender ?? rec.sex);
  const appearance = syncGenderIntoAppearance(rec.appearance, gender);
  const saved: CharacterRecord = {
    scope: scopeKey,
    id: rec.id,
    name: rec.name,
    aliases: rec.aliases,
    surname: rec.surname || '',
    given_name: rec.given_name || '',
    surname_variants: rec.surname_variants || [],
    given_name_variants: rec.given_name_variants || [],
    priority: Number(rec.priority || 0),
    attire_locked: wearLocked(rec.attire_locked),
    bottoms_locked: wearLocked(rec.bottoms_locked),
    accessories_locked: wearLocked(rec.accessories_locked),
    schema_version: 2,
    appearance,
    attire: rec.attire,
    bottoms: rec.bottoms || '',
    accessories: rec.accessories || '',
    costumes: rec.costumes || [],
    active_costume: Number(rec.active_costume || 0),
    original: rec.original || '',
    gender,
    hair_color: normalizeHairColorSlot(rec.hair_color || '', 120),
    hair_style: cleanText(rec.hair_style || '', 400),
    eye_color: normalizeEyeColorSlot(rec.eye_color || '', 120),
    height: cleanText(rec.height || '', 80),
    age: rec.age ?? '',
    penis_size: cleanText(rec.penis_size || '', 40),
    wear_state: parseWearState(rec.wear_state) || '',
    ref_hash: hasOwn(raw, 'ref_hash')
      ? sanitizeHash((raw as Record<string, unknown>).ref_hash)
      : sanitizeHash(sameRow?.ref_hash || dup?.ref_hash || rec.ref_hash),
    example_hash: hasOwn(raw, 'example_hash')
      ? sanitizeHash((raw as Record<string, unknown>).example_hash)
      : sanitizeHash(sameRow?.example_hash || rec.example_hash),
    // Cast ids are immutable once issued: an upsert that only touches looks
    // must carry the stored id forward, or resolve-cast goes blind while the
    // image location still points at it.
    cast_id: hasOwn(raw, 'cast_id')
      ? sanitizeCastId((raw as Record<string, unknown>).cast_id)
      : sanitizeCastId(sameRow?.cast_id || dup?.cast_id || rec.cast_id),
    updated_at: now,
  } as CharacterRecord;
  const replacedIds = new Set([selfId, rec.id, ...duplicates.map(row => row.id)]);
  // Write the survivor and remove absorbed rows in one verified roster save.
  await mutateCharacterRoster(scopeKey, rows => [...rows.filter(row => !replacedIds.has(row.id)), saved]);
  rec.appearance = appearance;
  rec.gender = gender;

  return rec as CharacterRecord;
}

/**
 * Drop attire/accessories on appearance-empty session rows that match a global character.
 * Those rows are wardrobe overlays and otherwise keep shadowing a manual global clear
 * (e.g. removing "airpods in one ear" from global while a chat overlay still has it).
 */
export async function deleteCharacter(scope: string, id: string): Promise<boolean> {
  const scopeKey = cleanText(scope, 200) || GLOBAL_SCOPE;
  const idKey = cleanText(id, 80);
  if (!idKey) return false;
  await idbDelete('characters', { scope: scopeKey, id: idKey });
  return true;
}

const characterMatchesDeleteRef = (char: CharacterInput, ref: CharacterInput): boolean =>
  !!characterMatchesIdentity(char, ref);

/** Anything object-shaped carrying an id or a name is a usable reference. */
function refList(value: unknown[]): CharacterInput[] {
  return (Array.isArray(value) ? value : []).filter((r): r is CharacterInput => {
    if (!r || typeof r !== 'object') return false;
    const rec = r as CharacterInput;
    return Boolean(rec.id || rec.name);
  });
}

async function originScopeForUnifiedRow(
  raw: CharacterInput,
  sessionIds: unknown[],
): Promise<string> {
  const roots = [...new Set(
    (sessionIds || []).map((s) => cleanText(s, 200)).filter((sid) => sid && sid !== GLOBAL_SCOPE),
  )];
  const hinted = cleanText((raw as { scope?: unknown }).scope, 200);
  if (hinted && roots.includes(hinted)) return hinted;
  const id = cleanText(raw.id, 80);
  if (id) {
    const idHits: string[] = [];
    for (const sid of roots) {
      const hit = (await listCharacters(sid)).find((c) => cleanText(c.id, 80) === id);
      if (hit) idHits.push(sid);
    }
    if (idHits.length === 1) return idHits[0]!;
  }
  const nameHits: string[] = [];
  for (const sid of roots) {
    const list = await listCharacters(sid);
    if (resolveCharacter(raw.name, list) || (id && list.some((c) => cleanText(c.id, 80) === id))) {
      nameHits.push(sid);
    }
  }
  if (nameHits.length === 1) return nameHits[0]!;
  return '';
}

/**
 * Delete matching roster rows from root chat sessions (unified view delete → roots).
 * Never creates rows.
 */
export async function deleteMatchingInSessions(
  sessionIds: unknown[],
  deletedRefs: unknown[],
  skipSessionId = '',
): Promise<SessionEditCount & { deleted: number }> {
  const refs = refList(deletedRefs);
  if (!refs.length) return { deleted: 0, sessions: 0 };
  const skip = cleanText(skipSessionId, 200);
  let deleted = 0;
  let sessions = 0;
  const touched = new Set<string>();
  for (const ref of refs) {
    const sid = await originScopeForUnifiedRow(ref, sessionIds);
    if (!sid || sid === skip) continue;
    const list = await listCharacters(sid);
    for (const char of list) {
      if (!characterMatchesDeleteRef(char, ref) && cleanText(char.id, 80) !== cleanText(ref.id, 80)) continue;
      await deleteCharacter(sid, char.id);
      deleted += 1;
      touched.add(sid);
    }
  }
  sessions = touched.size;
  return { deleted, sessions };
}

export async function patchExistingInSessions(
  sessionIds: unknown[],
  characters: unknown[],
  skipSessionId = '',
): Promise<SessionEditCount & { updated: number }> {
  const rows = refList(characters);
  if (!rows.length) return { updated: 0, sessions: 0 };
  const skip = cleanText(skipSessionId, 200);
  let updated = 0;
  const touched = new Set<string>();
  for (const raw of rows) {
    const sid = await originScopeForUnifiedRow(raw, sessionIds);
    if (!sid || sid === skip) continue;
    const list = await listCharacters(sid);
    const existing = (cleanText(raw.id, 80) ? list.find((c) => cleanText(c.id, 80) === cleanText(raw.id, 80)) : null)
      || resolveCharacter(raw.name, list)
      || (Array.isArray(raw.aliases) ? raw.aliases.map((a) => resolveCharacter(a, list)).find(Boolean) : null);
    if (!existing) continue;
    const rec = await upsertCharacter(sid, {
      ...raw,
      id: existing.id,
      name: existing.name || raw.name,
    });
    if (rec) {
      updated += 1;
      touched.add(sid);
    }
  }
  return { updated, sessions: touched.size };
}

export async function replaceCharacters(
  scope: string,
  characters: unknown[],
  opts: ReplaceOptions = {},
): Promise<CharacterRecord[]> {
  const scopeKey = cleanText(scope, 200) || GLOBAL_SCOPE;
  const prune = opts.prune === true;
  const inputRows = (characters || []).filter((row): row is CharacterInput => Boolean(row && typeof row === 'object' && !Array.isArray(row)));
  const out: CharacterRecord[] = [];
  for (const raw of characters || []) {
    // The UI posts the whole list. A later row with the survivor's ID must not
    // overwrite spellings already absorbed from earlier rows in that same list.
    const group = raw && typeof raw === 'object' && !Array.isArray(raw)
      ? givenNameDuplicates(raw as CharacterInput, inputRows) : [];
    const rec = await upsertCharacter(scopeKey, group.length > 1
      ? { ...raw as CharacterInput, ...mergedGivenNames(group) } : raw);
    if (rec) out.push(rec);
  }
  if (prune) {
    const keep = new Set(out.map((c) => cleanText(c.id, 80)).filter(Boolean));
    for (const old of await listCharacters(scopeKey)) {
      const oid = cleanText(old.id, 80);
      if (oid && !keep.has(oid)) await deleteCharacter(scopeKey, oid);
    }
  }
  const savedIds = new Set(out.map(row => row.id));
  return (await listCharacters(scopeKey)).filter(row => savedIds.has(row.id));
}

// ── payloads ───────────────────────────────────────────────────────────────

export async function getCharactersPayload(sessionId: string, characterId = ''): Promise<Record<string, unknown>> {
  const sid = cleanText(sessionId, 200);
  const cid = cleanText(characterId, 200);
  const session = sid ? await listCharacters(sid) : [];
  const disabled = new Set<string>();
  const globalChars = await listCharacters(GLOBAL_SCOPE);
  const appearance = Object.fromEntries(session.map((c) => [c.name, fullTags(c)]));
  return {
    ok: true,
    session_id: sid,
    character_id: cid,
    characters: session,
    global: globalChars,
    appearance,
    disabled_globals: [...disabled].sort(),
    global_enabled: {},
  };
}

export async function unifyCharacterSessions(
  targetSessionId: string,
  sourceSessionIds: unknown[],
  includeTarget = true,
): Promise<ApiResult> {
  const target = cleanText(targetSessionId, 200);
  if (!target) return { ok: false, error: { code: 'bad_request', message: 'target_session_id required' } };
  void sourceSessionIds;void includeTarget;
  return {...await getCharactersPayload(target),merged:0,sources:[]};
}

export async function getAppearance(sessionId: string): Promise<Record<string, string>> {
  return Object.fromEntries((await listCharacters(sessionId)).map((c) => [c.name, fullTags(c)]));
}

export async function setAppearance(sessionId: string, mapping: unknown): Promise<ApiResult> {
  const chars = Object.entries((mapping || {}) as Record<string, unknown>).map(([name, tags]) => ({ name, tags }));
  await replaceCharacters(sessionId, chars);
  return { ok: true, appearance: await getAppearance(sessionId) };
}

// ── tagger merge ───────────────────────────────────────────────────────────

/**
 * Copy aliases from latin-given peers onto appearance-filled hosts (asset refs).
 * Does not delete or fold donor rows. Persist before LLM trigger inject.
 */
export async function absorbAliasesOntoLatinPeers(args: {
  sessionId?: string;
  unifiedSessionId?: string;
  characterId?: string;
  sourceSessionIds?: unknown[];
}): Promise<CharacterRecord[]> {
  const sessionId = cleanText(args.sessionId || '', 200);
  const unifiedSessionId = cleanText(args.unifiedSessionId || '', 200);
  const characterId = cleanText(args.characterId || '', 200);
  const sourceSessionIds = args.sourceSessionIds ?? [];
  let roster = await rosterForSession(sessionId, unifiedSessionId, characterId, sourceSessionIds);
  const hosts = roster.filter((row) => characterHasAppearance(row));
  for (const host of hosts) {
    let aliases = parseAliasList([...(host.aliases || []), host.name]);
    let changed = false;
    for (const donor of roster) {
      if (!donor || cleanText(donor.id, 80) === cleanText(host.id, 80)) continue;
      if (!latinGivenTokenOverlap(host, donor)) continue;
      const next = absorbAliasesFromDonor(host, donor);
      const nextList = parseAliasList(next);
      if (nextList.length > aliases.length || nextList.some((a) => !aliases.includes(a))) {
        aliases = nextList;
        changed = true;
      }
    }
    if (!changed) continue;
    const writeScope = host.scope === GLOBAL_SCOPE ? GLOBAL_SCOPE : (host.scope || sessionId);
    await upsertCharacter(writeScope, {
      ...host,
      aliases,
    });
    roster = await rosterForSession(sessionId, unifiedSessionId, characterId, sourceSessionIds);
  }
  return roster;
}

/**
 * Folds the tagger's `new_characters` and every shot's cast back into the roster,
 * then returns the roster the generator should use.
 *
 * The roster is re-read after every write because each upsert can fold two rows
 * into one, which changes what the next name resolves to.
 */
export async function mergeRosterFromTagged(args: MergeRosterArgs): Promise<CharacterRecord[]> {
  const { sessionId, tagged, shotChars } = args;
  const unifiedSessionId = args.unifiedSessionId ?? '';
  const sourceSessionIds = args.sourceSessionIds ?? [];
  const characterId = cleanText(args.characterId || '', 200);
  const assetLooks = !!args.assetLooks;
  const assetPriorityFloor = assetLooks ? ASSET_LOOKS_PRIORITY : 0;
  const originalHints = args.originalHints && typeof args.originalHints === 'object' ? args.originalHints : {};
  const originalFromHint = (raw: unknown): string => {
    if (!raw || typeof raw !== 'object') return '';
    const rec = raw as CharacterInput;
    const keys = [rec.name, ...(rec.aliases || []), ...characterTriggers(rec)];
    let best = '';
    for (const k of keys) {
      const ck = compactAssetKey(k, 200);
      const hit = ck ? originalHints[ck] : '';
      if (hit && hit.length > best.length) best = hit;
    }
    return best;
  };
  // Autotag / new chars always land on the live chat — never the unified cache.
  const writeSessionId = cleanText(sessionId || '', 200);
  const readRoster = (): Promise<CharacterRecord[]> =>
    rosterForSession(sessionId, unifiedSessionId, characterId, sourceSessionIds);

  let roster = await readRoster();
  // Same gate as roster reads: priority off must not see sibling chats as "already exists".
  const pool = scanLinkedChatsForRosterMerge(getConfig()?.card?.unified_chat_priority, sourceSessionIds)
    ? await listMergedSessionCharacters([writeSessionId, ...sourceSessionIds])
    : roster;
  const newList = [...(tagged.new_characters || [])];
  const covered = new Set(newList.map((raw) => normalizeAlias(raw?.name)));
  for (const row of pool) {
    const key = normalizeAlias(row.name);
    if (key && characterHasAppearance(row)) covered.add(key);
  }
  const shotLookFallbacks = new Map<string, { appearance: string; attire: string; bottoms: string; accessories: string }>();
  const namePartsFrom = (rec: NamePartSource, existing: NamePartSource = null): NameParts => ({
    surname: cleanText(rec?.surname || existing?.surname || '', 200),
    given_name: cleanText(rec?.given_name || existing?.given_name || '', 200),
    surname_variants: parseAliasList([
      ...spreadLoose(existing?.surname_variants),
      ...spreadLoose(rec?.surname_variants),
      rec?.surname,
      existing?.surname,
    ]),
    given_name_variants: parseAliasList([
      ...spreadLoose(existing?.given_name_variants),
      ...spreadLoose(rec?.given_name_variants),
      rec?.given_name,
      existing?.given_name,
    ]),
  });
  for (const char of shotChars || []) {
    const name = cleanText(char.name, 200);
    if (!name) continue;
    const key = normalizeAlias(name);
    const shotApp = joinTags(char.label, char.age, char.appearance, char.body);
    const shotAttire = cleanText(char.attire || '');
    const shotBottoms = cleanText((char as { bottoms?: unknown }).bottoms || '');
    const shotAcc = cleanText(char.accessories || '');
    if (covered.has(key)) {
      if (shotApp || shotAttire || shotBottoms || shotAcc) {
        const previous = shotLookFallbacks.get(key);
        shotLookFallbacks.set(key, {
          appearance: joinTags(previous?.appearance, shotApp),
          attire: joinTags(previous?.attire, shotAttire),
          bottoms: joinTags(previous?.bottoms, shotBottoms),
          accessories: joinTags(previous?.accessories, shotAcc),
        });
      }
      continue;
    }
    const existing = resolveCharacter(name, pool);
    if (existing && characterHasAppearance(existing)) continue;
    if (!shotApp && !shotAttire && !shotBottoms && !shotAcc) continue;
    newList.push({
      name,
      aliases: parseAliasList(char.aliases) || [name],
      original: cleanText(char.original || char.original_tag || '', 400),
      appearance: shotApp,
      attire: shotAttire,
      bottoms: shotBottoms,
      accessories: shotAcc,
      ...namePartsFrom(char, null),
    });
    covered.add(key);
  }
  if (typeof tagged === 'object') tagged.new_characters = newList;

  for (const raw of newList) {
    const rec = normalizeCharacterRecord(raw);
    if (!rec) continue;
    const hinted = originalFromHint(raw) || originalFromHint(rec);
    if (hinted) rec.original = hinted;
    const weightMap = getLastAssetWeightMap();
    if (weightMap.size) {
      rec.appearance = restoreAssetTagWeights(rec.appearance, weightMap);
      rec.attire = restoreAssetTagWeights(rec.attire, weightMap);
      rec.bottoms = restoreAssetTagWeights(rec.bottoms || '', weightMap);
      rec.accessories = restoreAssetTagWeights(rec.accessories, weightMap);
    }
    const buckets = normalizeTaggedLookBuckets(rec, shotLookFallbacks.get(normalizeAlias(rec.name)));
    rec.appearance = buckets.appearance;
    rec.attire = buckets.attire;
    rec.bottoms = buckets.bottoms;
    rec.accessories = buckets.accessories;
    const existing = resolveCharacter(rec.name, pool) || resolveCharacter(rec.name, roster);
    const newApp = cleanText(rec.appearance || '');
    const newAttire = cleanText(rec.attire || '');
    const newBottoms = cleanText(rec.bottoms || '');
    const newAccessories = cleanText(rec.accessories || '');
    if (existing) {
      const fill = incomingLooksForIncomplete(existing, {
        appearance: newApp,
        attire: newAttire,
        bottoms: newBottoms,
        accessories: newAccessories,
      });
      if (fill) {
        const writeScope = existing.scope === GLOBAL_SCOPE ? GLOBAL_SCOPE : (existing.scope || writeSessionId);
        await upsertCharacter(writeScope, {
          id: existing.id,
          name: existing.name,
          appearance: fill.appearance,
          attire: fill.attire,
          bottoms: fill.bottoms,
          accessories: fill.accessories,
          ...(hinted ? { original: hinted } : {}),
          ...(cleanText(rec.hair_color || '') ? { hair_color: rec.hair_color } : {}),
          ...(cleanText(rec.hair_style || '') ? { hair_style: rec.hair_style } : {}),
          ...(cleanText(rec.eye_color || '') ? { eye_color: rec.eye_color } : {}),
          ...(cleanText(rec.height || '') ? { height: rec.height } : {}),
          ...(rec.age != null && rec.age !== '' ? { age: rec.age } : {}),
          ...(cleanText(rec.penis_size || '') ? { penis_size: rec.penis_size } : {}),
          ...(rec.gender ? { gender: rec.gender } : {}),
        });
      }
      roster = await readRoster();
      continue;
    }
    const costumes = mergeCostumeLists(
      // Seed the editor's default from the new identity before normalizing
      // costumes. An empty seed makes missing look slots explicitly empty,
      // so the editor later clears the correctly saved top-level fields.
      ensureCostumes({ ...rec, appearance: syncGenderIntoAppearance(newApp, rec.gender), costumes: [], active_costume: 0 }).costumes,
      Array.isArray(raw.costumes) && raw.costumes.length
        ? raw.costumes
        : [{ name: 'default', attire: newAttire, bottoms: newBottoms, accessories: newAccessories }],
      { protectDefault: false },
    );
    const appearance = newApp || '';
    const attire = newAttire || costumes[0]?.attire || '';
    const bottoms = newBottoms || costumes[0]?.bottoms || '';
    const accessories = newAccessories || costumes[0]?.accessories || '';
    const { appearance: _dropApp, attire: _dropAtt, bottoms: _dropBot, accessories: _dropAcc, ...rest } = rec;
    void _dropApp;
    void _dropAtt;
    void _dropBot;
    void _dropAcc;
    await upsertCharacter(writeSessionId, {
      ...rest,
      costumes,
      active_costume: 0,
      attire_locked: wearLocked(rec.attire_locked),
      bottoms_locked: wearLocked(rec.bottoms_locked),
      accessories_locked: wearLocked(rec.accessories_locked),
      priority: Math.max(assetPriorityFloor, Number(rec.priority || 0)),
      ...(appearance ? { appearance } : {}),
      ...(attire ? { attire } : {}),
      ...(bottoms ? { bottoms } : {}),
      ...(accessories ? { accessories } : {}),
    });
    roster = await readRoster();
  }

  const costumePairs = collectCostumePairs({
    new_costumes: (tagged as { new_costumes?: unknown }).new_costumes,
    new_characters: tagged.new_characters,
    shots: [{ characters: shotChars }],
  });
  for (const pair of costumePairs) {
    const name = pair.name;
    const incoming = pair.costumes;
    if (!incoming.length) continue;
    const existing = resolveCharacter(name, roster);
    if (!existing) continue;
    const writeScope = existing.scope === GLOBAL_SCOPE ? GLOBAL_SCOPE : (existing.scope || writeSessionId);
    const protectDefault = characterHasAppearance(existing);
    const merged = mergeCostumeLists(ensureCostumes(existing).costumes, incoming, { protectDefault });
    await upsertCharacter(writeScope, {
      id: existing.id,
      name: existing.name,
      costumes: merged,
      active_costume: existing.active_costume,
    });
    roster = await readRoster();
  }

  for (const char of shotChars || []) {
    const name = cleanText(char.name, 200);
    if (!name) continue;
    const existing = resolveCharacter(name, pool) || resolveCharacter(name, roster);
    if (existing) continue;
    {
      const appearance = joinTags(char.label, char.age, char.appearance || '', char.body || '');
      const attire = cleanText(char.attire || '');
      const bottoms = cleanText((char as { bottoms?: unknown }).bottoms || '');
      const accessories = cleanText(char.accessories || '');
      if (!appearance && !attire && !bottoms && !accessories) continue;
      await upsertCharacter(writeSessionId, {
        name,
        aliases: parseAliasList(char.aliases) || [name],
        original: cleanText(char.original || char.original_tag || '', 400),
        attire_locked: true,
        bottoms_locked: true,
        accessories_locked: true,
        ...namePartsFrom(char, null),
        ...(appearance ? { appearance } : {}),
        ...(attire ? { attire } : {}),
        ...(bottoms ? { bottoms } : {}),
        ...(accessories ? { accessories } : {}),
      });
    }
    roster = await readRoster();
  }
  await absorbAliasesOntoLatinPeers({
    sessionId,
    unifiedSessionId,
    characterId,
    sourceSessionIds,
  });
  const seededRoster = await readRoster();
  await seedCharRefsFromLooks(seededRoster, characterId, args.referenceCandidates).catch((err) => {
    dbg('char_ref.seed.merge.fail', { message: String((err as Error)?.message || err) }, 'warn');
  });
  return readRoster();
}

// ── one-time migrations ────────────────────────────────────────────────────

/** Seeds the roster from the pre-roster `appearance:<session>` meta rows. */
export async function migrateAppearanceToCharacters(): Promise<void> {
  // Omni is not released; legacy roster migration is a separate future feature.
  return;
}

/** Lifts schema-1 rows to the surname/given-name identity model. */
export async function migrateCharacterIdentity(): Promise<void> {
  const rows = await idbGetAll('characters');
  for (const row of rows) {
    if (Number(row.schema_version || 0) >= 2) continue;
    const rec = normalizeCharacterRecord(row);
    if (!rec) continue;
    await idbPut('characters', {
      ...row,
      ...rec,
      scope: row.scope,
      updated_at: row.updated_at || Date.now() / 1000,
    });
  }
}
