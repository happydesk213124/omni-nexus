/**
 * Roster operations: trigger aliases, name → character resolution, cast dedupe
 * and the session/global merge used for tagging and generation.
 *
 * Every identity decision is delegated to identity.ts. The 1.x build could not
 * import across files, so it reached the identity module through
 * `globalThis.__INLAY_IDENTITY__` and carried an inline duplicate as a fallback;
 * both are gone — this module imports the real thing.
 */
import type { ShotCharacter } from '../../core/types.ts';
import { cleanText, compactText, hashCode, joinTags, normalizeAlias, parseAliasList } from '../../core/util/text.ts';
import type { CharacterInput, MigratedCharacter } from './identity.ts';
import { mergeCharacterView, migrateCharacter, resolveCharacterIdentity, normalizeGender, characterMatchesIdentity } from './identity.ts';
import { normalizeEyeColorSlot, normalizeHairColorSlot } from './looks-fields.ts';

/** Injected helpers for `mergeSessionAndGlobalRoster`; every one has a no-op default. */
export interface RosterMergeHelpers {
  hasAppearance?: (char: CharacterInput | null | undefined) => boolean;
  resolve?: (name: unknown, list: CharacterInput[]) => CharacterInput | null;
  aliasKeys?: (char: CharacterInput | null | undefined) => Set<string>;
  normalizeName?: (name: unknown) => string;
  fullTags?: (char: CharacterInput) => string;
  clean?: (value: unknown, limit?: number) => string;
  globalScope?: string;
}

/** Every name a message can mention to summon this character; bare surnames excluded. */
export function characterTriggers(char: CharacterInput | null | undefined): string[] {
  const migrated = migrateCharacter(char || {});
  const out = parseAliasList([migrated.name, ...(migrated.aliases || [])]);
  const surnames = parseAliasList([migrated.surname, ...(migrated.surname_variants || [])]);
  const givenNames = parseAliasList([migrated.given_name, ...(migrated.given_name_variants || [])]);
  for (const surname of surnames) {
    for (const given of givenNames) {
      out.push(`${surname} ${given}`, `${surname}${given}`, `${given} ${surname}`);
    }
  }
  return parseAliasList(out).filter((token) => {
    const isSurnameOnly = surnames.some((surname) => normalizeAlias(surname) === normalizeAlias(token));
    return !isSurnameOnly;
  });
}

/** Resolves a name against a roster; ambiguous names resolve to nothing. */
export function resolveCharacter(
  name: unknown,
  characters: CharacterInput[] | null | undefined,
): MigratedCharacter | null {
  return resolveCharacterIdentity(name, characters || []);
}

/** Merge duplicate cast entries that resolve to the same roster/name alias (LLM sometimes doubles char1/char2). */
export function dedupeShotCharacters(
  chars: ShotCharacter[] | null | undefined,
  roster: CharacterInput[] | null | undefined,
  charMax: unknown = 6,
): ShotCharacter[] {
  const limit = Math.max(1, Math.min(6, Number(charMax) || 6));
  const out: Array<ShotCharacter & { _dedupeKey: string }> = [];
  const seen = new Set<string>();
  const mergeFields = (dst: Record<string, unknown>, src: ShotCharacter): Record<string, unknown> => {
    if (!dst || !src) return dst;
    for (const field of ['action', 'expression', 'attire', 'accessories', 'appearance', 'label', 'age', 'body', 'sex', 'original', 'original_tag', 'negative', 'source', 'target', 'mutual']) {
      const cur = cleanText(dst[field] || '', 2000);
      const add = cleanText(src[field] || '', 2000);
      if (!add) continue;
      if (!cur) dst[field] = add;
      else if (!cur.toLowerCase().includes(add.toLowerCase())) dst[field] = joinTags(cur, add);
    }
    if (!dst.wear_state && src.wear_state) dst.wear_state = src.wear_state;
    return dst;
  };
  for (const raw of chars || []) {
    if (!raw || typeof raw !== 'object') continue;
    const name = cleanText(raw.name, 200);
    if (!name) continue;
    const stored = resolveCharacter(name, roster);
    const key = stored
      ? `id:${cleanText(stored.id || stored.name, 200)}`
      : `name:${normalizeAlias(name)}`;
    if (!key || key === 'id:' || key === 'name:') continue;
    const idx = out.findIndex((item) => item._dedupeKey === key);
    if (idx >= 0) {
      mergeFields(out[idx], raw);
      continue;
    }
    if (out.length >= limit) continue;
    seen.add(key);
    out.push({
      ...raw,
      name: stored?.name || name,
      _dedupeKey: key,
    });
  }
  return out.map(({ _dedupeKey, ...rest }) => rest);
}

/** Normalised alias keys for a character, including the display name itself. */
export function characterAliasKeys(char: CharacterInput | null | undefined): Set<string> {
  const keys = new Set<string>();
  for (const token of characterTriggers(char)) {
    const key = normalizeAlias(token);
    if (key) keys.add(key);
  }
  const name = normalizeAlias(char?.name);
  if (name) keys.add(name);
  return keys;
}

function rowLooksFilled(
  char: CharacterInput | null | undefined,
  hasAppearance?: RosterMergeHelpers['hasAppearance'],
): boolean {
  if (typeof hasAppearance === 'function') return Boolean(hasAppearance(char));
  return Boolean(String(char?.appearance || '').trim());
}

/**
 * Same-person groups keep the winning row as-is (no look folding).
 * Winner: a filled look beats an empty one, then higher `priority`, then newer
 * `updated_at`. Empty-appearance rows stay last even if their priority is huge —
 * otherwise a leftover blank from another linked chat shadows the live chat.
 */
export function pickUnifiedWinners(
  characters: CharacterInput[] | null | undefined,
  hasAppearance?: RosterMergeHelpers['hasAppearance'],
): MigratedCharacter[] {
  const records = (characters || []).map((character) => migrateCharacter(character));
  const groups: MigratedCharacter[][] = [];
  const assigned = new Set<number>();
  for (let i = 0; i < records.length; i += 1) {
    if (assigned.has(i)) continue;
    const group = [records[i]];
    assigned.add(i);
    for (let j = i + 1; j < records.length; j += 1) {
      if (assigned.has(j)) continue;
      if (group.some((member) => characterMatchesIdentity(member, records[j]))) {
        assigned.add(j);
        group.push(records[j]);
      }
    }
    groups.push(group);
  }
  return groups.map((group) => {
    const sorted = [...group].sort((a, b) => {
      const lookA = rowLooksFilled(a, hasAppearance) ? 1 : 0;
      const lookB = rowLooksFilled(b, hasAppearance) ? 1 : 0;
      if (lookA !== lookB) return lookB - lookA;
      const priority = Number(b.priority || 0) - Number(a.priority || 0);
      if (priority) return priority;
      const updated = Number(b.updated_at || 0) - Number(a.updated_at || 0);
      if (updated) return updated;
      return String(a.id || '').localeCompare(String(b.id || ''));
    });
    return sorted[0];
  });
}

/** One row per person: rows that are the same character fold into their best record. */
export function mergeCharactersByAlias(
  characters: CharacterInput[] | null | undefined,
): MigratedCharacter[] {
  return mergeCharacterView(characters || []).active;
}

/** Characters whose trigger aliases appear in the text, in roster order. */
export function matchCharactersInText(
  text: unknown,
  characters: CharacterInput[] | null | undefined,
): CharacterInput[] {
  const hay = cleanText(text).toLowerCase();
  const hayCompact = compactText(text);
  if (!hay) return [];
  const matched: CharacterInput[] = [];
  const seenIds = new Set<string>();
  for (const char of characters || []) {
    const cid = cleanText(char.id || char.name, 200);
    if (!cid || seenIds.has(cid)) continue;
    for (const trigger of characterTriggers(char)) {
      const key = normalizeAlias(trigger);
      const compact = compactText(trigger);
      if (compact.length < 2) continue;
      if (hay.includes(key) || hayCompact.includes(compact)) {
        matched.push(char);
        seenIds.add(cid);
        break;
      }
    }
  }
  return matched;
}

/** Coerces anything character-shaped into a storable record, or null if unusable. */
export function normalizeCharacterRecord(
  raw: unknown,
  fallbackName = '',
): MigratedCharacter | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const rec = raw as CharacterInput;
  const name = cleanText(rec.name || fallbackName, 200);
  if (!name) return null;
  let aliases = parseAliasList(rec.aliases);
  aliases = [name, ...aliases.filter((a) => normalizeAlias(a) !== normalizeAlias(name))];
  const original = cleanText(rec.original || rec.original_tag || rec.copyright || '', 400);
  let appearance = cleanText(rec.appearance || '', 4000);
  let attire = cleanText(rec.attire || '', 4000);
  let bottoms = cleanText(rec.bottoms || '', 4000);
  let accessories = cleanText(rec.accessories || '', 4000);
  const tags = cleanText(rec.tags || '', 4000);
  // Legacy flat `tags`: dump into appearance as-is. Do not hint-split buckets.
  if (tags && !appearance && !attire && !bottoms && !accessories) {
    appearance = tags;
  }
  if (original && appearance) {
    appearance = joinTags(...appearance.split(',').filter((t) => normalizeAlias(t) !== normalizeAlias(original)));
  }
  let cid = cleanText(rec.id, 80) || name.replace(/[^a-zA-Z0-9_\uac00-\ud7a3]+/g, '_').replace(/^_|_$/g, '').slice(0, 64);
  if (!cid) cid = `char_${Math.abs(hashCode(name)) % 10000000}`;
  return migrateCharacter({
    ...rec,
    id: cid,
    name,
    aliases,
    original,
    appearance,
    attire,
    bottoms,
    accessories,
    gender: normalizeGender(rec.gender ?? rec.sex),
    costumes: Array.isArray(rec.costumes) ? rec.costumes : undefined,
    active_costume: rec.active_costume,
    hair_color: normalizeHairColorSlot(rec.hair_color || '', 120),
    hair_style: cleanText(rec.hair_style || '', 400),
    eye_color: normalizeEyeColorSlot(rec.eye_color || '', 120),
    height: cleanText(rec.height || '', 80),
    age: rec.age,
    penis_size: cleanText(rec.penis_size || '', 40),
  });
}

/** Which keys the caller actually sent. Omitted look fields must not become "". */
export type CharacterUpsertProvided = {
  appearance: boolean;
  attire: boolean;
  bottoms: boolean;
  accessories: boolean;
  original: boolean;
  surname: boolean;
  given_name: boolean;
  surname_variants: boolean;
  given_name_variants: boolean;
  costumes: boolean;
  active_costume: boolean;
  wear_state: boolean;
  attire_locked: boolean;
  bottoms_locked: boolean;
  accessories_locked: boolean;
  hair_color: boolean;
  hair_style: boolean;
  eye_color: boolean;
  height: boolean;
  age: boolean;
  penis_size: boolean;
  gender: boolean;
  priority: boolean;
};

/**
 * Patch `incoming` onto an existing row. `normalizeCharacterRecord` fills missing
 * looks with "", so a wear_state-only save would otherwise wipe appearance.
 * Empty string still clears when that key was present on the payload.
 */
export function foldCharacterUpsert(
  base: CharacterInput,
  incoming: MigratedCharacter,
  provided: CharacterUpsertProvided,
): MigratedCharacter | null {
  const nextAppearance = cleanText(incoming.appearance || '', 4000);
  const nextAttire = cleanText(incoming.attire || '', 4000);
  const nextBottoms = cleanText(incoming.bottoms || '', 4000);
  const nextAccessories = cleanText(incoming.accessories || '', 4000);
  const nextOriginal = cleanText(incoming.original || '', 400);
  const nextSurname = cleanText(incoming.surname || '', 200);
  const nextGiven = cleanText(incoming.given_name || '', 200);
  return normalizeCharacterRecord({
    ...base,
    ...incoming,
    id: base.id,
    name: incoming.name || base.name,
    aliases: parseAliasList([
      ...(base.aliases || []),
      ...(incoming.aliases || []),
      incoming.name,
      base.name,
    ]),
    original: provided.original ? nextOriginal : nextOriginal || base.original || '',
    appearance: provided.appearance ? nextAppearance : nextAppearance || base.appearance || '',
    attire: provided.attire ? nextAttire : nextAttire || base.attire || '',
    bottoms: provided.bottoms ? nextBottoms : nextBottoms || base.bottoms || '',
    accessories: provided.accessories ? nextAccessories : nextAccessories || base.accessories || '',
    surname: provided.surname ? nextSurname : nextSurname || base.surname || '',
    given_name: provided.given_name ? nextGiven : nextGiven || base.given_name || '',
    surname_variants: provided.surname_variants
      ? parseAliasList([...(incoming.surname_variants || []), nextSurname])
      : parseAliasList([
          ...(base.surname_variants || []),
          ...(incoming.surname_variants || []),
          nextSurname,
          base.surname,
        ]),
    given_name_variants: provided.given_name_variants
      ? parseAliasList([...(incoming.given_name_variants || []), nextGiven])
      : parseAliasList([
          ...(base.given_name_variants || []),
          ...(incoming.given_name_variants || []),
          nextGiven,
          base.given_name,
        ]),
    attire_locked: provided.attire_locked ? incoming.attire_locked : base.attire_locked,
    bottoms_locked: provided.bottoms_locked ? incoming.bottoms_locked : base.bottoms_locked,
    accessories_locked: provided.accessories_locked ? incoming.accessories_locked : base.accessories_locked,
    priority: provided.priority
      ? (Number.isFinite(Number(incoming.priority)) ? Number(incoming.priority) : Number(base.priority || 0))
      : Number(base.priority || 0),
    costumes: provided.costumes ? incoming.costumes : base.costumes,
    active_costume: provided.active_costume ? incoming.active_costume : base.active_costume,
    wear_state: provided.wear_state ? incoming.wear_state : (base.wear_state || incoming.wear_state),
    gender: provided.gender ? incoming.gender : (incoming.gender || base.gender),
    hair_color: provided.hair_color ? incoming.hair_color : (base.hair_color || incoming.hair_color),
    hair_style: provided.hair_style ? incoming.hair_style : (base.hair_style || incoming.hair_style),
    eye_color: provided.eye_color ? incoming.eye_color : (base.eye_color || incoming.eye_color),
    height: provided.height ? incoming.height : (base.height || incoming.height),
    age: provided.age ? incoming.age : (base.age ?? incoming.age),
    penis_size: provided.penis_size ? incoming.penis_size : (base.penis_size || incoming.penis_size),
  });
}

/**
 * Whether `new_characters` merge may treat linked chats as "already on the roster".
 * Off matches `rosterForSession`: live chat + globals only, even if the job
 * still sends `source_session_ids`.
 */
export function scanLinkedChatsForRosterMerge(
  unifiedChatPriority: unknown,
  sourceSessionIds: unknown[] | null | undefined,
): boolean {
  if (!unifiedChatPriority) return false;
  return (Array.isArray(sourceSessionIds) ? sourceSessionIds : []).some((id) =>
    Boolean(String(id ?? '').trim()),
  );
}

/**
 * Merge per-chat session characters with globals for tagging / generation.
 *
 * Attire-only session rows (empty appearance, optional attire/accessories) must NOT
 * hide a filled global look — those rows are clothes overlays, not "incomplete" chars.
 */
export function mergeSessionAndGlobalRoster(
  session: CharacterInput[] | null | undefined,
  globalChars: CharacterInput[] | null | undefined,
  helpers: RosterMergeHelpers = {},
): CharacterInput[] {
  const list = Array.isArray(session) ? session : [];
  const globals = Array.isArray(globalChars) ? globalChars : [];
  const hasAppearance: Required<RosterMergeHelpers>['hasAppearance'] =
    typeof helpers.hasAppearance === 'function' ? helpers.hasAppearance : () => false;
  const resolve: Required<RosterMergeHelpers>['resolve'] =
    typeof helpers.resolve === 'function' ? helpers.resolve : () => null;
  const aliasKeys: Required<RosterMergeHelpers>['aliasKeys'] =
    typeof helpers.aliasKeys === 'function' ? helpers.aliasKeys : () => new Set<string>();
  const normalizeName: Required<RosterMergeHelpers>['normalizeName'] =
    typeof helpers.normalizeName === 'function'
      ? helpers.normalizeName
      : (name: unknown) => String(name || '').trim().toLowerCase();
  const clean: Required<RosterMergeHelpers>['clean'] =
    typeof helpers.clean === 'function' ? helpers.clean : (v: unknown) => String(v || '').trim();

  const merged: CharacterInput[] = [];
  const sessionIncomplete = new Set<string>();

  for (const schar of list) {
    if (!clean(schar?.name, 200) || hasAppearance(schar)) continue;
    // Empty chat row + filled global = attire overlay, not an incomplete blocker.
    const globalHit = resolve(schar.name, globals);
    if (globalHit && hasAppearance(globalHit)) continue;
    for (const key of aliasKeys(schar)) sessionIncomplete.add(key);
    const nameKey = normalizeName(schar.name);
    if (nameKey) sessionIncomplete.add(nameKey);
  }

  for (const gchar of globals) {
    // Wear overlays removed: base attire/accessories on the global row win.
    const gKeys = aliasKeys(gchar);
    if ([...gKeys].some((k) => sessionIncomplete.has(k))) continue;
    merged.push(gchar);
  }

  for (const schar of list) {
    const hit = resolve(schar.name, merged);
    if (hit && hasAppearance(schar)) {
      if (!hasAppearance(hit)) {
        const idx = merged.findIndex((c) => resolve(schar.name, [c]));
        const wear = schar.wear_state || hit.wear_state;
        if (idx >= 0) merged[idx] = wear ? { ...schar, wear_state: wear } : schar;
        else merged.push(schar);
      } else if (schar.wear_state) {
        hit.wear_state = schar.wear_state;
      }
      continue;
    }
    if (hit && !hasAppearance(schar)) {
      // Keep a filled global (or merged attire overlay) — do not replace with empty session row.
      // Chat-local clothing state still overlays onto the filled look.
      if (hasAppearance(hit)) {
        if (schar.wear_state) hit.wear_state = schar.wear_state;
        continue;
      }
      const idx = merged.findIndex((c) => resolve(schar.name, [c]));
      if (idx >= 0) merged[idx] = schar;
      else merged.push(schar);
      continue;
    }
    if (hit) continue;
    merged.push(schar);
  }

  return merged;
}
