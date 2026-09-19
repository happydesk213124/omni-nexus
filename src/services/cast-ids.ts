/**
 * Cast ids live on the roster row (`cast_id`): assigned once, immutable.
 * Seed from name+aliases+original on first issue; random redraw on collision.
 * Uniqueness is global across all rosters because fullscreen resolves ids
 * through a roster-wide scan.
 */
import { randomCastId, sanitizeCastId, seedCastId } from '../domain/gallery/cast-ids.ts';
import { castFromShotAssetName } from '../domain/gallery/shot-assets.ts';
import { GLOBAL_SCOPE } from '../core/constants';
import { cleanText } from '../core/util/text';
import { allCharacterRosters } from '../storage/character-roster';
import { readShotAssetBytes } from '../storage/shot-character.ts';
import { findInspectAsset } from '../storage/inspect-assets';
import { dbg } from '../core/debug';
import { errorBody, makeFetchError } from '../core/errors';
import { bytesToDataUrlAsync, sniffImageMime } from '../core/util/bytes';
import { listCharacters, upsertCharacter } from './characters';

function seedTextFor(row: { name?: unknown; aliases?: unknown; original?: unknown }): string {
  const aliases = Array.isArray(row.aliases) ? row.aliases.join(',') : String(row.aliases ?? '');
  return `${cleanText(row.name, 200)}|${cleanText(aliases, 1000)}|${cleanText(row.original, 400)}`;
}

/**
 * Returns id→cast_id for every requested roster id, issuing + persisting new
 * ids where missing. Existing ids are never changed, even on rename.
 */
export async function ensureCastIds(
  scope: string,
  wants: ReadonlyArray<{ id?: unknown; name?: unknown }>,
): Promise<Record<string, string>> {
  const scopeKey = cleanText(scope, 200) || GLOBAL_SCOPE;
  const rows = await listCharacters(scopeKey);
  const byId = new Map(rows.map((r) => [cleanText(r.id, 80), r]));
  const taken = new Set<string>();
  for (const r of await allCharacterRosters()) {
    const c = sanitizeCastId((r as { cast_id?: unknown }).cast_id);
    if (c) taken.add(c);
  }
  const out: Record<string, string> = {};
  for (const w of wants) {
    const id = cleanText(w.id, 80);
    if (!id) continue;
    const row = byId.get(id);
    const existing = sanitizeCastId(row?.cast_id);
    if (existing) {
      out[id] = existing;
      continue;
    }
    let candidate = seedCastId(seedTextFor({ name: row?.name ?? w.name, aliases: row?.aliases, original: row?.original }));
    let guard = 0;
    while (taken.has(candidate) && guard++ < 100) candidate = randomCastId();
    if (taken.has(candidate)) continue;
    taken.add(candidate);
    out[id] = candidate;
    if (row) await upsertCharacter(scopeKey, { id, name: row.name, cast_id: candidate });
  }
  return out;
}

/** Fullscreen path: cast ids → display names, '' when unknown. */
export async function resolveCastNames(ids: readonly unknown[]): Promise<Record<string, string>> {
  const want = new Set(ids.map((v) => sanitizeCastId(v)).filter(Boolean));
  const out: Record<string, string> = {};
  if (!want.size) return out;
  for (const r of await allCharacterRosters()) {
    const c = sanitizeCastId((r as { cast_id?: unknown }).cast_id);
    if (c && want.has(c) && !(c in out)) out[c] = cleanText(r.name, 200);
  }
  return out;
}

/**
 * Card id → character asset name, falling back to the legacy gallery module.
 * The rendered img URL is Risu's file path and does not carry the cast.
 */
export async function shotCastIds(cardId: unknown): Promise<{ ids: string[]; name: string }> {
  const id = cleanText(cardId, 200);
  if (!id) return { ids: [], name: '' };
  const row = await findInspectAsset('', id);
  return row ? { ids: castFromShotAssetName(row.name), name: row.name } : { ids: [], name: '' };
}

/**
 * Fullscreen path, user's design: asset NAME (from the chat div's
 * data-inray-asset) → file bytes → displayable data URL, plus cast names in
 * the same round trip. Name lookup survives reloads because the pixels live
 * on Risu's side; our memory bytes do not.
 */
export async function shotAssetByName(name: unknown, includeCast = true): Promise<{ image_url: string; ids: string[]; names: Record<string, string>; warning?: string }> {
  const want = cleanText(name, 400);
  if (!want) throw makeFetchError(400, errorBody('asset_name_required', 'asset_name_required'));
  const row = await findInspectAsset(want);
  if (!row) throw makeFetchError(404, errorBody('asset_not_found: ' + want, 'asset_not_found'));
  const ids = castFromShotAssetName(row.name);
  const bytes = await readShotAssetBytes(row.path);
  if (!bytes) throw makeFetchError(422, errorBody('asset_read_failed: ' + want, 'asset_read_failed'));
  const image_url = await bytesToDataUrlAsync(bytes, sniffImageMime(bytes));
  if (!includeCast) return { image_url, ids, names: {} };
  try {
    return { image_url, ids, names: await resolveCastNames(ids) };
  } catch (error) {
    // An unrelated corrupt roster must not discard successfully read pixels.
    const warning = 'cast_resolve_failed: ' + String((error as Error)?.message || error);
    dbg('shots.asset.cast.fail', { message: warning }, 'warn');
    return { image_url, ids, names: {}, warning };
  }
}
