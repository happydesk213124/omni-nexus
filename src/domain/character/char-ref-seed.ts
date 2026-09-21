/**
 * Match empty character-ref slots to trigger-named look assets.
 * I/O (module write / roster hash) stays in nai-assets.
 */
import { GLOBAL_SCOPE, normalizeCharRefScope } from '../../core/constants.ts';
import { cleanText } from '../../core/util/text.ts';
import { sanitizeHash } from './char-ref-store.ts';
import { characterAssetTerms } from '../nai-meta/reference-search';
import { compactAssetKey } from '../nai-meta/match';

export interface RefSeedTarget {
  id: string;
  scope: string;
  names: string[];
}

export interface RefSeedLook {
  trigger: string;
  bytes: Uint8Array;
}

export function refSeedTargets(characters: readonly unknown[]): RefSeedTarget[] {
  const out: RefSeedTarget[] = [];
  const seen = new Set<string>();
  for (const raw of characters || []) {
    if (!raw || typeof raw !== 'object') continue;
    const rec = raw as Record<string, unknown>;
    const id = cleanText(rec.id, 200);
    const scope = normalizeCharRefScope(rec.scope) || GLOBAL_SCOPE;
    if (!id || sanitizeHash(rec.ref_hash)) continue;
    const key = `${scope}\0${id}`;
    if (seen.has(key)) continue;
    const names = characterAssetTerms(rec);
    if (!names.length) continue;
    seen.add(key);
    out.push({ id, scope, names });
  }
  return out;
}

export function lookBytesForTarget(
  target: Pick<RefSeedTarget, 'names'>,
  looks: readonly RefSeedLook[],
): Uint8Array | null {
  const keys = new Set(
    target.names.map((name) => compactAssetKey(name)).filter((key) => key.length >= 2),
  );
  for (const look of looks || []) {
    const trigger = compactAssetKey(look.trigger);
    if (trigger.length >= 2 && keys.has(trigger) && look.bytes?.byteLength) return look.bytes;
  }
  return null;
}
