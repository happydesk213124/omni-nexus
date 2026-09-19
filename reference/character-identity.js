const clean = (value) => String(value ?? "").trim().replace(/\s+/g, " ");
const key = (value) => clean(value).normalize("NFKC").toLocaleLowerCase().replace(/[\s_.·•･-]+/g, "");

function list(value) {
  const input = Array.isArray(value) ? value : String(value ?? "").split(/[,/\n]/);
  const out = [];
  const seen = new Set();
  for (const item of input) {
    const text = clean(item);
    const normalized = key(text);
    if (!text || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(text);
  }
  return out;
}

function inferLatinName(name) {
  const parts = clean(name).split(" ").filter(Boolean);
  if (
    parts.length !== 2
    || !parts.every((part) => /^[A-Za-z'-]+$/.test(part))
    || !parts.every((part) => part === part.toUpperCase())
  ) {
    return { surname: "", given_name: "" };
  }
  return { surname: parts[0], given_name: parts[1] };
}

export function migrateCharacter(raw = {}) {
  const name = clean(raw.name);
  const inferred = inferLatinName(name);
  return {
    ...raw,
    id: clean(raw.id) || name,
    name,
    aliases: list(raw.aliases),
    surname: clean(raw.surname) || inferred.surname,
    given_name: clean(raw.given_name) || inferred.given_name,
    surname_variants: list(raw.surname_variants),
    given_name_variants: list(raw.given_name_variants),
    priority: Number.isFinite(Number(raw.priority)) ? Number(raw.priority) : 0,
    attire_locked: raw.attire_locked === true,
    accessories_locked: raw.accessories_locked === true,
    schema_version: 2,
  };
}

function partKeys(character, field, variantsField) {
  const char = migrateCharacter(character);
  return new Set(list([char[field], ...(char[variantsField] || [])]).map(key).filter(Boolean));
}

/** Surname + given both overlap (KR/EN variants count). Alias-only overlap does NOT merge. */
export function sameFullNameIdentity(a, b) {
  const left = migrateCharacter(a);
  const right = migrateCharacter(b);
  const aSur = partKeys(left, "surname", "surname_variants");
  const bSur = partKeys(right, "surname", "surname_variants");
  const aGiven = partKeys(left, "given_name", "given_name_variants");
  const bGiven = partKeys(right, "given_name", "given_name_variants");
  if (!aSur.size || !bSur.size || !aGiven.size || !bGiven.size) return false;
  const surnameHit = [...aSur].some((token) => bSur.has(token));
  const givenHit = [...aGiven].some((token) => bGiven.has(token));
  return surnameHit && givenHit;
}

/**
 * True when two roster rows are the same person for cascade delete.
 * Matches id, full-name identity, or any shared fullName/alias key.
 */
export function characterMatchesIdentity(a, b) {
  if (!a || !b) return false;
  const left = migrateCharacter(a);
  const right = migrateCharacter(b);
  if (left.id && right.id && String(left.id) === String(right.id)) return true;
  if (sameFullNameIdentity(left, right)) return true;
  const leftKeys = fullNameKeys(left);
  const rightKeys = fullNameKeys(right);
  for (const token of leftKeys) {
    if (rightKeys.has(token)) return true;
  }
  return false;
}

function fullNameKeys(character) {
  const char = migrateCharacter(character);
  const out = new Set();
  const add = (value) => {
    const normalized = key(value);
    if (normalized) out.add(normalized);
  };
  add(char.name);
  const surnameKeys = new Set(list([char.surname, ...char.surname_variants]).map(key));
  for (const alias of char.aliases) {
    if (!surnameKeys.has(key(alias))) add(alias);
  }
  const surnames = list([char.surname, ...char.surname_variants]);
  const givenNames = list([char.given_name, ...char.given_name_variants]);
  for (const surname of surnames) {
    for (const given of givenNames) {
      add(`${surname} ${given}`);
      add(`${surname}${given}`);
      add(`${given} ${surname}`);
    }
  }
  return out;
}

export function resolveCharacterIdentity(name, characters = []) {
  const target = key(name);
  if (!target) return null;
  const matches = characters
    .map(migrateCharacter)
    .filter((character) => fullNameKeys(character).has(target));
  if (matches.length !== 1) return null;
  return matches[0];
}

function comparePriority(a, b) {
  const priority = Number(b.priority || 0) - Number(a.priority || 0);
  if (priority) return priority;
  const created = Number(a.created_at || a.updated_at || 0) - Number(b.created_at || b.updated_at || 0);
  if (created) return created;
  return String(a.id).localeCompare(String(b.id));
}

function unionList(...parts) {
  return list(parts.flat());
}

/** Fold group into one display record. Source records stay in `records` — this does not delete. */
function foldGroup(group) {
  const sorted = [...group].sort(comparePriority);
  const best = { ...sorted[0] };
  best.aliases = unionList(...sorted.map((entry) => [entry.name, ...(entry.aliases || [])]));
  best.surname_variants = unionList(...sorted.map((entry) => [entry.surname, ...(entry.surname_variants || [])]));
  best.given_name_variants = unionList(...sorted.map((entry) => [entry.given_name, ...(entry.given_name_variants || [])]));
  if (!best.surname) best.surname = sorted.map((entry) => entry.surname).find(Boolean) || "";
  if (!best.given_name) best.given_name = sorted.map((entry) => entry.given_name).find(Boolean) || "";
  for (const entry of sorted) {
    const appearance = clean(entry.appearance || "");
    const attire = clean(entry.attire || "");
    const accessories = clean(entry.accessories || "");
    const original = clean(entry.original || "");
    if (appearance.length > clean(best.appearance || "").length) best.appearance = appearance;
    if (!best.attire_locked && attire.length > clean(best.attire || "").length) best.attire = attire;
    if (!best.accessories_locked && accessories.length > clean(best.accessories || "").length) best.accessories = accessories;
    if (original && !clean(best.original || "")) best.original = original;
  }
  // Prefer non-empty surname/given from the priority winner, else any member.
  best.surname = clean(best.surname) || sorted.map((entry) => clean(entry.surname)).find(Boolean) || "";
  best.given_name = clean(best.given_name) || sorted.map((entry) => clean(entry.given_name)).find(Boolean) || "";
  return best;
}

export function mergeCharacterView(characters = []) {
  const records = characters.map(migrateCharacter);
  const groups = [];
  const assigned = new Set();
  for (let i = 0; i < records.length; i++) {
    if (assigned.has(i)) continue;
    const group = [records[i]];
    assigned.add(i);
    for (let j = i + 1; j < records.length; j++) {
      if (assigned.has(j)) continue;
      if (group.some((member) => sameFullNameIdentity(member, records[j]))) {
        assigned.add(j);
        group.push(records[j]);
      }
    }
    groups.push(group);
  }
  const active = groups.map(foldGroup);
  return { records, active, groups };
}

export function applyAttireUpdate(character, nextAttire) {
  const migrated = migrateCharacter(character);
  if (migrated.attire_locked) return migrated;
  return { ...migrated, attire: clean(nextAttire) };
}

function applyAccessoriesUpdate(character, nextAccessories) {
  const migrated = migrateCharacter(character);
  if (migrated.accessories_locked) return migrated;
  return { ...migrated, accessories: clean(nextAccessories) };
}
