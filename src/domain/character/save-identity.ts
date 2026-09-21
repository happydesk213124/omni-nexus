import type { CharacterInput } from './identity';

const key = (value: string): string => value.normalize('NFKC').toLowerCase().replace(/\s+/g, '');

/** UI name fields accept comma-separated spellings, including inside legacy arrays. */
function names(value: unknown): string[] {
  const seen = new Set<string>();
  return (Array.isArray(value) ? value : [value])
    .flatMap(item => String(item ?? '').split(/[,/\n]/))
    .map(item => item.trim())
    .filter(item => {
      const token = key(item);
      if (!token || seen.has(token)) return false;
      seen.add(token);
      return true;
    });
}

function keys(row: CharacterInput): Set<string> {
  // Display names, surnames and trigger aliases must never identify a save duplicate.
  return new Set(names([row.given_name, ...names(row.given_name_variants)]).map(key));
}

/** Revisit skipped rows: a later spelling can bridge two earlier groups. */
export function givenNameDuplicates(seed: CharacterInput, rows: CharacterInput[]): CharacterInput[] {
  const known = keys(seed);
  const found = new Set<CharacterInput>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      if (found.has(row)) continue;
      const candidate = keys(row);
      if (![...candidate].some(token => known.has(token))) continue;
      found.add(row);
      for (const token of candidate) known.add(token);
      changed = true;
    }
  }
  return [...found];
}

/** Keep Korean and English UI fields separate while retaining every merged spelling. */
export function mergedGivenNames(rows: CharacterInput[]): Pick<CharacterInput, 'given_name' | 'given_name_variants'> {
  return {
    given_name: names(rows.map(row => row.given_name)).join(', '),
    given_name_variants: names(rows.flatMap(row => names(row.given_name_variants))),
  };
}
