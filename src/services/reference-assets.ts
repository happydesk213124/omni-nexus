import { referenceLoreTerms, rankedReferenceAssets, referencesForNames, type ReferenceCandidate } from '../domain/nai-meta/reference-search';
import type { RefSeedTarget } from '../domain/character/char-ref-seed';
import type { LoreEntry } from '../core/types';
import { parseAliasList } from '../core/util/text';
import { characterSource } from './character-source';
import { listSearchableAssets, loadLookAssetsFromTargets } from './asset-tags';
import { fetchCharacterLorebookEntries } from './lorefilter';

/** Keep the candidate keys from the original search, before any LLM can rename the person. */
export async function collectReferenceCandidates(terms: readonly string[], characterId: string, lore?: LoreEntry[]): Promise<ReferenceCandidate[]> {
  if (!terms.length) return [];
  const character = await characterSource(characterId);
  if (!character) return [];
  const pool = await listSearchableAssets(character);
  const entries = lore ?? await fetchCharacterLorebookEntries(characterId);
  const candidates = new Map<string, ReferenceCandidate>();
  for (const term of terms) {
    const siblings = referenceLoreTerms([term], entries);
    for (const asset of rankedReferenceAssets(pool.assets, siblings)) {
      const existing = candidates.get(asset.key);
      candidates.set(asset.key, { name: asset.name, key: asset.key,
        terms: parseAliasList([...(existing?.terms || []), ...siblings]) });
    }
  }
  return [...candidates.values()];
}

export async function referenceLooksForTargets(targets: readonly RefSeedTarget[], characterId: string, captured?: readonly ReferenceCandidate[]) {
  const fallbackTargets = targets.filter(target => !captured?.length || !referencesForNames(captured, target.names).length);
  const fallback = fallbackTargets.length
    ? await collectReferenceCandidates(fallbackTargets.flatMap(target => target.names), characterId) : [];
  const out: Array<{ targetId: string; scope: string; bytes: Uint8Array }> = [];
  for (const target of targets) {
    const original = captured?.length ? referencesForNames(captured, target.names) : [];
    const candidates = original.length ? original : referencesForNames(fallback, target.names);
    // A stale/broken first file must not hide the next valid ranked candidate.
    for (const candidate of candidates) {
      const [look] = await loadLookAssetsFromTargets([candidate]);
      if (look?.bytes.byteLength) {
        out.push({ targetId: target.id, scope: target.scope, bytes: look.bytes });
        break;
      }
    }
  }
  return out;
}
