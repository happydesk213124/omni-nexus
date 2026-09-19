/**
 * assistant_preview exists only so a just-finished stream can rematch cards
 * (Dice/prefix ≥60%). Older cards keep hash/line; they do not need the prose.
 */

export const ASSISTANT_PREVIEW_RETENTION = 20;

export interface PreviewRetentionRow {
  id: string;
  created_at?: number;
}

/** Card ids older than the newest `limit` — their preview may be dropped. */
export function cardIdsToStripPreview(
  rows: readonly PreviewRetentionRow[],
  limit = ASSISTANT_PREVIEW_RETENTION,
): string[] {
  if (rows.length <= limit) return [];
  const newest = [...rows].sort((a, b) => {
    const dt = Number(b.created_at || 0) - Number(a.created_at || 0);
    if (dt !== 0) return dt;
    return String(b.id).localeCompare(String(a.id));
  });
  const keep = new Set(newest.slice(0, limit).map((row) => String(row.id || '')).filter(Boolean));
  const drop: string[] = [];
  for (const row of rows) {
    const id = String(row.id || '');
    if (id && !keep.has(id)) drop.push(id);
  }
  return drop;
}
