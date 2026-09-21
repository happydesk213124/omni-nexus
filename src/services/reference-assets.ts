import { rankedReferenceAssets, type ReferenceCandidate } from '../domain/nai-meta/reference-search';
import type { RefSeedTarget } from '../domain/character/char-ref-seed';
import { parseAliasList } from '../core/util/text';
import { characterSource } from './character-source';
import { listSearchableAssets, loadLookAssetsFromTargets } from './asset-tags';

/** Reference registration uses only the saved roster identity, like the asset picker. */
export async function collectReferenceCandidates(terms: readonly string[], characterId: string): Promise<ReferenceCandidate[]> {
  if (!terms.length) return [];
  const character = await characterSource(characterId);
  if (!character) return [];
  const pool = await listSearchableAssets(character);
  const candidates = new Map<string, ReferenceCandidate>();
  for (const term of terms) {
    const siblings = [term];
    for (const asset of rankedReferenceAssets(pool.assets, siblings)) {
      const existing = candidates.get(asset.key);
      candidates.set(asset.key, { name: asset.name, key: asset.key,
        terms: parseAliasList([...(existing?.terms || []), ...siblings]) });
    }
  }
  return [...candidates.values()];
}

export async function referenceLooksForTargets(targets: readonly RefSeedTarget[], characterId: string) {
  const candidates = await collectReferenceCandidates(targets.flatMap(target => target.names), characterId);
  const out: Array<{ targetId: string; scope: string; bytes: Uint8Array }> = [];
  for (const target of targets) {
    // A stale/broken first file must not hide the next valid ranked candidate.
    for (const candidate of rankedReferenceAssets(candidates, target.names)) {
      const [look] = await loadLookAssetsFromTargets([candidate]);
      if (look?.bytes.byteLength) {
        out.push({ targetId: target.id, scope: target.scope, bytes: look.bytes });
        break;
      }
    }
  }
  return out;
}
