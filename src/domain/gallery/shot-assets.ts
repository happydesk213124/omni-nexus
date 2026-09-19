/**
 * Pure rules for the gallery shot module.
 * Bytes live in a Risu module; the images index keeps card id + asset_path.
 */
import { cleanText } from '../../core/util/text.ts';
import { formatCastSegment, parseCastSegment } from './cast-ids.ts';

export const SHOT_ASSET_PREFIX = 'inxshot_';
export const SHOT_MODULE_ID = 'inlay-gallery';
export const SHOT_MODULE_NS = 'inlay.gallery';
export const SHOT_MODULE_NAME = '⚛️Omni Nexus 갤러리';

/** Drop then restore our gallery ids so the host rebuilds the name→path map. */
export function bounceEnabledModuleIds(
  enabled: unknown,
  bounceIds: readonly string[] = [SHOT_MODULE_ID, SHOT_MODULE_NS],
): { off: string[]; on: string[] } {
  const drop = new Set(bounceIds.map((id) => cleanText(id, 200)).filter(Boolean));
  const ids = asShotAssetRows(enabled).map((row) => cleanText(row, 200)).filter(Boolean);
  const off = ids.filter((id) => !drop.has(id));
  const on = [...off];
  for (const id of bounceIds) {
    const key = cleanText(id, 200);
    if (key && !on.includes(key)) on.push(key);
  }
  return { off, on };
}

export function sanitizeShotId(id: unknown): string {
  return String(id || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
}

export function isShotAssetName(name: unknown): boolean {
  const n = cleanText(name, 400).toLowerCase();
  return n.startsWith(SHOT_ASSET_PREFIX);
}

/**
 * Marks the room segment of an asset name:
 * `inxshot_<id>.s<session>.c<id-id>.<ext>`.
 *
 * `.` separates because `sanitizeShotId` strips it, so neither the card id nor
 * the session id can contain one. That is what keeps the split unambiguous for
 * ids that already hold underscores, and it leaves the extension last for hosts
 * that sniff the name. The cast segment is last among the middle segments so
 * older `[id, s<session>, ext]` names keep parsing unchanged.
 */
const SESSION_MARK = 's';

export function sanitizeSessionId(id: unknown): string {
  return String(id || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
}

export function shotAssetName(id: unknown, ext = 'webp', sessionId?: unknown, castIds?: readonly unknown[]): string {
  const safe = sanitizeShotId(id);
  if (!safe) return '';
  const e = String(ext || 'webp').toLowerCase().replace(/[^a-z0-9]/g, '') || 'webp';
  const sid = sanitizeSessionId(sessionId);
  const room = sid ? `.${SESSION_MARK}${sid}` : '';
  const cast = formatCastSegment(castIds ?? []);
  const castSeg = cast ? `.${cast}` : '';
  return `${SHOT_ASSET_PREFIX}${safe}${room}${castSeg}.${e}`;
}

/** The `.s<session>`, `.c<cast>` and `.<ext>` segments of a name; ''/[] when absent. */
function shotNameParts(name: unknown): { id: string; session: string; cast: string[] } {
  const n = cleanText(name, 400);
  if (!n.toLowerCase().startsWith(SHOT_ASSET_PREFIX)) return { id: '', session: '', cast: [] };
  const parts = n.slice(SHOT_ASSET_PREFIX.length).split('.');
  const id = sanitizeShotId(parts[0]);
  // parts: [id, ext] before rooms were stamped, [id, s<session>, ext] after,
  // [id, s<session>, c<cast>, ext] with the cast segment.
  let session = '';
  let cast: string[] = [];
  for (const mid of parts.slice(1, -1)) {
    const seg = cleanText(mid, 80);
    if (!session && seg.startsWith(SESSION_MARK)) session = sanitizeSessionId(seg.slice(SESSION_MARK.length));
    else if (!cast.length) cast = parseCastSegment(seg);
  }
  return { id, session, cast };
}

export function idFromShotAssetName(name: unknown): string {
  return shotNameParts(name).id;
}

/** Which character-chat a stored shot belongs to, '' for pre-room names. */
export function sessionFromShotAssetName(name: unknown): string {
  return shotNameParts(name).session;
}

/** Cast ids baked into the filename, [] when the name carries none. */
export function castFromShotAssetName(name: unknown): string[] {
  return shotNameParts(name).cast;
}

/** Risu getDatabase may wrap arrays; accept array-likes and {name,path} rows. */
export function asShotAssetRows(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object' && typeof (raw as { length?: unknown }).length === 'number') {
    try {
      return Array.from(raw as ArrayLike<unknown>);
    } catch {
      return [];
    }
  }
  return [];
}

export function parseShotModuleAssets(raw: unknown): Array<[string, string, string]> {
  const out: Array<[string, string, string]> = [];
  for (const row of asShotAssetRows(raw)) {
    if (Array.isArray(row) && row.length >= 2) {
      const name = cleanText(row[0], 400);
      const path = cleanText(row[1], 800);
      const ext = cleanText(row[2], 400) || extFromName(name);
      if (name && path) out.push([name, path, ext]);
      continue;
    }
    if (!row || typeof row !== 'object') continue;
    const rec = row as Record<string, unknown>;
    const name = cleanText(rec.name ?? rec.assetName ?? rec.fileName, 400);
    const path = cleanText(rec.key ?? rec.path ?? rec.id ?? rec.asset, 800);
    const ext = cleanText(rec.ext ?? rec.type, 400) || extFromName(name);
    if (name && path) out.push([name, path, ext]);
  }
  return out;
}

function extFromName(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name);
  return (m?.[1] || 'webp').toLowerCase();
}

export function normalizeAssetPath(path: unknown): string {
  return cleanText(path, 800).replace(/\\/g, '/').trim();
}
