import type { CharacterRecord } from '../../core/types';
import { cleanText } from '../../core/util/text';
import { normalizeGender, type CharacterInput } from './identity';
import { foldCharacterUpsert, normalizeCharacterRecord } from './roster';
import { syncGenderIntoAppearance, parseWearState, wearLocked } from './tags';
import { COSTUME_FIELDS, ensureCostumes, promoteCostumeToDefault, syncActiveCostumeFromWear } from './costume';
import { appendDuplicateCostumes, costumeOwnerName, describeCharacterCostumes } from './save-costumes';
import { givenNameDuplicates, mergedGivenNames } from './save-identity';
import { sanitizeHash } from './char-ref-store';
import { sanitizeCastId } from '../gallery/cast-ids';
import { normalizeEyeColorSlot, normalizeHairColorSlot } from './looks-fields';

export interface UpsertOptions {
  /** Whole-list groups retain transitive donors without changing visible names. */
  absorbed?: CharacterInput[];
}

const hasOwn = (value: unknown, field: string): boolean =>
  !!value && Object.prototype.hasOwnProperty.call(value as object, field);

/** Fold against the roster read inside the storage queue, never a stale pre-save snapshot. */
export function prepareCharacterUpsert(
  scopeKey: string, raw: unknown, existingList: CharacterRecord[], updatedAt: number, opts: UpsertOptions = {},
): { saved: CharacterRecord; replacedIds: ReadonlySet<unknown> } | null {
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
  const candidates = new Map<string, CharacterInput>();
  for (const row of [...existingList, ...(opts.absorbed || [])]) {
    if (row.id !== selfId) candidates.set(String(row.id || row.name), row);
  }
  const duplicates = givenNameDuplicates(rec, [...candidates.values()]);
  const dup = existingList.find(row => duplicates.some(other => other.id === row.id));
  const mergedDuplicate = duplicates.length > 0;
  if (mergedDuplicate) {
    const survivor = sameRow || dup || rec;
    const donors = duplicates.filter(row => row.id !== survivor.id);
    if (sameRow || rec.id !== survivor.id) donors.unshift(rec);
    rec = {
      ...survivor,
      costumes: appendDuplicateCostumes(survivor, donors),
    } as typeof rec;
  }

  // Normalize costumes: seed from attire if missing; sync active slot from wear on save.
  {
    let { costumes, active_costume } = ensureCostumes(rec);
    if (!mergedDuplicate && !costumesProvided && (attireProvided || bottomsProvided || accessoriesProvided)) {
      costumes = syncActiveCostumeFromWear(costumes, active_costume, {
        attire: rec.attire,
        bottoms: rec.bottoms,
        accessories: rec.accessories,
      });
    }
    if (!mergedDuplicate && promoteDefault) {
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
    rec.costumes = describeCharacterCostumes({ ...rec, costumes }, Boolean(sameRow || mergedDuplicate),
      sameRow && !mergedDuplicate ? costumeOwnerName(sameRow) : '');
    rec.active_costume = active_costume;
  }

  const now = updatedAt;
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
    ref_hash: mergedDuplicate ? sanitizeHash(rec.ref_hash) : hasOwn(raw, 'ref_hash')
      ? sanitizeHash((raw as Record<string, unknown>).ref_hash)
      : sanitizeHash(rec.ref_hash || sameRow?.ref_hash || dup?.ref_hash),
    example_hash: mergedDuplicate ? sanitizeHash(rec.example_hash) : hasOwn(raw, 'example_hash')
      ? sanitizeHash((raw as Record<string, unknown>).example_hash)
      : sanitizeHash(rec.example_hash || sameRow?.example_hash),
    // Cast ids are immutable once issued: an upsert that only touches looks
    // must carry the stored id forward, or resolve-cast goes blind while the
    // image location still points at it.
    cast_id: mergedDuplicate ? sanitizeCastId(rec.cast_id) : hasOwn(raw, 'cast_id')
      ? sanitizeCastId((raw as Record<string, unknown>).cast_id)
      : sanitizeCastId(rec.cast_id || sameRow?.cast_id || dup?.cast_id),
    updated_at: now,
  } as CharacterRecord;
  const replacedIds = new Set([selfId, rec.id, ...duplicates.map(row => row.id)]);
  return { saved, replacedIds };
}
