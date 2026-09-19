/**
 * Force retag unlinks every shot in the chat — illustrations and comic pages.
 * Late-saved comic rows may keep the hash on meta while location already moved,
 * so both sides must count.
 */
import { cleanText, toInt } from '../../core/util/text.ts';

/** Empty location.hash is a real unlink, not “missing → read meta”. */
export function resolveStoredContentHash(
  loc: Record<string, unknown> | null | undefined,
  meta: Record<string, unknown> | null | undefined,
): string {
  const row = loc && typeof loc === 'object' ? loc : {};
  const base = meta && typeof meta === 'object' ? meta : {};
  if (Object.prototype.hasOwnProperty.call(row, 'content_hash')) {
    return cleanText(row.content_hash, 128);
  }
  return cleanText(base.content_hash, 128);
}

export function cardMatchesMessageUnlink(args: {
  hashes: readonly unknown[];
  messageIndexes: readonly unknown[];
  hostIds?: readonly unknown[];
  wantHash: string;
  wantMessageIndex: number | null;
  wantHostId?: unknown;
}): boolean {
  const wantHost = cleanText(args.wantHostId, 160);
  const storedHosts = (Array.isArray(args.hostIds) ? args.hostIds : [])
    .map((id) => cleanText(id, 160))
    .filter(Boolean);
  if (wantHost && storedHosts.length) {
    return storedHosts.includes(wantHost);
  }
  const wantMsg = args.wantMessageIndex;
  if (wantMsg != null && wantMsg >= 0) {
    const stored = toInt(args.messageIndexes[0], -1);
    // Identical message text produces the same hash. When a card has an index,
    // that index is the only way to avoid unlinking both bubbles.
    if (stored >= 0) return stored === wantMsg;
  }
  const wantHash = cleanText(args.wantHash, 128);
  if (wantHash) {
    const storedHash = cleanText(args.hashes[0], 128);
    if (storedHash && storedHash === wantHash) return true;
  }
  return false;
}
