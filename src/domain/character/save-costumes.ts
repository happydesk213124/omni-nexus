import type { CharacterCostume, CharacterRecord } from '../../core/types';
import { cleanText, splitTagTokens } from '../../core/util/text';
import type { CharacterInput } from './identity';
import { COSTUME_FIELDS, ensureCostumes, normalizeCostume, resolveCostumeFields } from './costume';

export function costumeOwnerName(row: CharacterInput): string {
  const name = cleanText(row.name, 160);
  const surname = cleanText(row.surname, 80).split(/[,/\n]/)[0]!.trim();
  const given = cleanText(row.given_name, 80).split(/[,/\n]/)[0]!.trim();
  if (surname && given && (!name || name === given)) {
    return /^[가-힣]+$/.test(surname + given) ? surname + given : `${given} ${surname}`;
  }
  return name || [surname, given].filter(Boolean).join(' ');
}

/** Owner text is added by code, so even a legacy default has a usable description. */
export function describeCharacterCostumes(row: CharacterInput, onlyMissing = false, previousOwner = ''): CharacterCostume[] {
  const owner = costumeOwnerName(row);
  return ensureCostumes(row as Partial<CharacterRecord>).costumes.map((costume, index) => {
    let note = cleanText(costume.note, 200);
    // Manual creation first persists "New Character"; its generated label must
    // follow the completed name without changing any user-authored description.
    if (index === 0 && previousOwner && previousOwner !== owner && note === `${previousOwner} · 기본 외형·의상`) note = '';
    if (!owner || (onlyMissing && note) || note.startsWith(`${owner} · `)) return costume;
    const detail = note || (costume.name === 'default' ? '기본 외형·의상' : costume.name);
    return { ...costume, note: cleanText(`${owner} · ${detail}`, 200) };
  });
}

const lookKey = (costume: CharacterCostume): string => COSTUME_FIELDS.map(field =>
  splitTagTokens(costume[field]).map(tag => tag.toLowerCase()).sort().join('\0'),
).join('\n');

/** Resolve donor inheritance before appending; [base] must never change owners. */
export function appendDuplicateCostumes(survivor: CharacterInput, donors: CharacterInput[]): CharacterCostume[] {
  const out = describeCharacterCostumes(survivor, true);
  for (const donor of donors) {
    const catalog = describeCharacterCostumes(donor);
    for (const costume of catalog) {
      const next = normalizeCostume({ ...costume, ...resolveCostumeFields(costume, catalog[0]!) }, out.length);
      if (!next) continue;
      if (out.some(existing => lookKey({ ...existing, ...resolveCostumeFields(existing, out[0]!) }) === lookKey(next)
        && existing.note === next.note)) continue;
      const stem = normalizeCostume({ ...next, name: `${costumeOwnerName(donor)}_${costume.name}` }, out.length)!.name;
      next.name = stem;
      let suffix = 2;
      const names = new Set(out.map(item => item.name.toLowerCase()));
      while (names.has(next.name.toLowerCase())) next.name = `${stem.slice(0, 70)}_${suffix++}`;
      out.push(next);
    }
  }
  return out;
}
