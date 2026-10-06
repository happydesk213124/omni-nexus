/**
 * Cast ids live on the roster row (`cast_id`): assigned once, immutable.
 * Seed from name+aliases+original on first issue; random redraw on collision.
 * Uniqueness remains global on issuance; viewers read only the current bot
 * and shared roster so naming an image cannot load every other bot.
 */
import { randomCastId, sanitizeCastId, seedCastId } from '../domain/gallery/cast-ids.ts';
import { castFromShotAssetName } from '../domain/gallery/shot-assets.ts';
import { GLOBAL_SCOPE } from '../core/constants';
import { cleanText } from '../core/util/text';
import { allCharacterRosters, viewerCharacterRosters } from '../storage/character-roster';
import { readShotAssetBytes } from '../storage/shot-character.ts';
import { findInspectAsset } from '../storage/inspect-assets';
import { dbg } from '../core/debug';
import { errorBody, makeFetchError } from '../core/errors';
import { bytesToDataUrlAsync, sniffImageMime } from '../core/util/bytes';
import { listCharacters, upsertCharacter } from './characters';

type RosterReadError = (scope: string, error: unknown) => void;
function readCastRosters(onReadError?: RosterReadError) {
  return allCharacterRosters((scope, error) => {
    dbg('cast.roster.read.fail', { scope, message: String((error as Error)?.message || error), background: true }, 'warn');
    onReadError?.(scope, error);
  });
}
function readViewerCastRosters(onReadError?: RosterReadError) {
  return viewerCharacterRosters((scope, error) => {
    dbg('cast.roster.read.fail', { scope, message: String((error as Error)?.message || error), background: true }, 'warn');
    onReadError?.(scope, error);
  });
}

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
  if (!wants.some(w => cleanText(w.id, 80))) return {};
  const rows = await listCharacters(scopeKey);
  const byId = new Map(rows.map((r) => [cleanText(r.id, 80), r]));
  let taken: Set<string> | undefined;
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
    // Reusing a persisted ID needs only its owner's roster. Scan for collisions
    // once, and only when this call actually needs to issue a new ID.
    if (!taken) taken = new Set((await readCastRosters()).map(r => sanitizeCastId(r.cast_id)).filter(Boolean));
    if (out[id]) continue;
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
export async function resolveCastNames(ids: readonly unknown[], onReadError?: RosterReadError): Promise<Record<string, string>> {
  const want = new Set(ids.map((v) => sanitizeCastId(v)).filter(Boolean));
  const out: Record<string, string> = {};
  if (!want.size) return out;
  for (const r of await readViewerCastRosters(onReadError)) {
    const c = sanitizeCastId((r as { cast_id?: unknown }).cast_id);
    if (c && want.has(c) && !(c in out)) out[c] = cleanText(r.name, 200);
  }
  return out;
}

/** Identity travels with the name so a global cast never opens a session namesake. */
export async function resolveCastCharacters(ids: readonly unknown[]): Promise<{ characters: Array<{cast_id: string; id: string; scope: string; name: string}> }> {
  const want = new Set(ids.map(sanitizeCastId).filter(Boolean));
  const rows = want.size ? await readViewerCastRosters() : [];
  return { characters: rows.filter(row => want.has(sanitizeCastId(row.cast_id))).map(row => ({
    cast_id: sanitizeCastId(row.cast_id), id: String(row.id), scope: String(row.scope || GLOBAL_SCOPE), name: cleanText(row.name, 200),
  })) };
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
 * data-inray-asset) → file bytes → display URL, plus cast names in
 * the same round trip. Name lookup survives reloads because the pixels live
 * on Risu's side; our memory bytes do not.
 */
export async function shotAssetByName(name: unknown, includeCast = true, delivery: 'data' | 'blob' = 'data'): Promise<{ image_url: string; image_bytes?: number; ids: string[]; names: Record<string, string>; warning?: string }> {
  const want = cleanText(name, 400);
  if (!want) throw makeFetchError(400, errorBody('asset_name_required', 'asset_name_required'));
  const row = await findInspectAsset(want);
  if (!row) throw makeFetchError(404, errorBody('asset_not_found: ' + want, 'asset_not_found'));
  const ids = castFromShotAssetName(row.name);
  const bytes = await readShotAssetBytes(row.path);
  if (!bytes) throw makeFetchError(422, errorBody('asset_read_failed: ' + want, 'asset_read_failed'));
  // Blob ownership transfers to the inspector; it revokes discarded URLs.
  // Keep the default data URL contract for other callers.
  const image_url = delivery === 'blob'
    ? URL.createObjectURL(new Blob([bytes], { type: sniffImageMime(bytes) }))
    : await bytesToDataUrlAsync(bytes, sniffImageMime(bytes));
  const image = delivery === 'blob' ? { image_url, image_bytes: bytes.byteLength } : { image_url };
  if (!includeCast) return { ...image, ids, names: {} };
  try {
    let warning = '';
    const names = await resolveCastNames(ids, (_scope, error) => {
      warning ||= 'cast_resolve_failed: ' + String((error as Error)?.message || error);
    });
    return { ...image, ids, names, ...(warning ? { warning } : {}) };
  } catch (error) {
    // An unrelated corrupt roster must not discard successfully read pixels.
    const warning = 'cast_resolve_failed: ' + String((error as Error)?.message || error);
    dbg('shots.asset.cast.fail', { message: warning }, 'warn');
    return { ...image, ids, names: {}, warning };
  }
}
