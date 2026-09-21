import { cleanText, parseAliasList } from '../../core/util/text';
import { migrateCharacter, type CharacterInput } from '../character/identity';
import { characterTriggers } from '../character/roster';
import { assetBasenameCompact, assetNameWords, compactAssetKey } from './match';

export interface ReferenceCandidate {
  name: string;
  key: string;
  /** Identity keys from the search that found this file, including sibling lore keys. */
  terms: string[];
}

export function characterAssetTerms(raw: CharacterInput): string[] {
  const rec = migrateCharacter(raw);
  let given = rec.given_name;
  if (!given && rec.surname && rec.name.startsWith(rec.surname)) {
    given = rec.name.slice(rec.surname.length).trim();
  }
  const surnames = new Set([rec.surname, ...rec.surname_variants].map(v => compactAssetKey(v)).filter(Boolean));
  return parseAliasList([rec.name, ...rec.aliases, given, ...rec.given_name_variants, ...characterTriggers(rec)])
    .filter(v => compactAssetKey(v).length >= 2 && !surnames.has(compactAssetKey(v)));
}

export function assetMatchesTerms(name: string, terms: readonly string[]): boolean {
  const keys = terms.map(v => compactAssetKey(v)).filter(Boolean);
  const filename = assetBasenameCompact(name);
  return !keys.length || keys.some(key => filename.includes(key));
}

export function referencePriority(name: string, terms: readonly string[]): number {
  const filename = assetBasenameCompact(name);
  if (terms.some(term => compactAssetKey(term) === filename)) return 5;
  const words = assetNameWords(name);
  if (words.includes('default')) return 4;
  if (words.includes('profile')) return 3;
  if (words.some(word => word === 'normal' || word.startsWith('smil'))) return 2;
  return 1;
}

export function rankedReferenceAssets<T extends { name: string }>(assets: readonly T[], terms: readonly string[]): T[] {
  if (!terms.some(term => compactAssetKey(term))) return [...assets];
  return assets.filter(asset => assetMatchesTerms(asset.name, terms)).sort((a, b) =>
    referencePriority(b.name, terms) - referencePriority(a.name, terms)
    || assetBasenameCompact(a.name).length - assetBasenameCompact(b.name).length
    || a.name.localeCompare(b.name));
}

/** Expand only entries already identified by a name/key; never merge unrelated entries transitively. */
export function referenceLoreTerms(terms: readonly string[], lore: readonly Record<string, unknown>[]): string[] {
  const keys = new Set(terms.map(v => compactAssetKey(v)).filter(Boolean));
  const extra: string[] = [];
  for (const entry of lore) {
    const siblings = parseAliasList([...parseAliasList(entry.key), ...parseAliasList(entry.keys)]);
    const headings = [...siblings, cleanText(entry.title), cleanText(entry.comment)];
    if (headings.some(value => keys.has(compactAssetKey(value)))) extra.push(...headings);
  }
  return parseAliasList([...terms, ...extra]);
}

export function referencesForNames(candidates: readonly ReferenceCandidate[], names: readonly string[]): ReferenceCandidate[] {
  const keys = new Set(names.map(v => compactAssetKey(v)));
  const eligible = candidates.filter(c => c.terms.some(term => keys.has(compactAssetKey(term))) || assetMatchesTerms(c.name, names));
  const terms = parseAliasList([...names, ...eligible.flatMap(c => c.terms)]);
  // Candidates may match via an alias associated with their original search.
  return rankedReferenceAssets(eligible, terms);
}
