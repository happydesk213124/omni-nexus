/**
 * Cap the jobs store so completed runs do not accumulate.
 *
 * Cards keep their own prompts; the job row is only needed while a run is
 * live (poll / busy / stop). A finished row survives only until the next job
 * starts — the creation write is what sweeps the previous run, because the
 * poller must still observe `done` after the terminal write lands. Pruning on
 * the terminal write itself would delete the row synchronously and every
 * waiter would time out. Active rows are never dropped.
 */

export const JOB_RETENTION_LIMIT = 0;

/** Same set as `ACTIVE_JOB_STATES` in job-locks — in-flight rows must survive. */
const ACTIVE_STATES = new Set(['queued', 'tagging', 'generating']);

/** True while a runner owns the row. Pruning runs on these writes only. */
export function isActiveJobState(state: unknown): boolean {
  return ACTIVE_STATES.has(String(state || ''));
}

export interface JobRetentionRow {
  id: string;
  state?: string;
  created_at?: number;
  updated_at?: number;
}

export function jobRetentionStamp(row: JobRetentionRow): number {
  const updated = Number(row.updated_at);
  if (Number.isFinite(updated) && updated > 0) return updated;
  const created = Number(row.created_at);
  return Number.isFinite(created) && created > 0 ? created : 0;
}

/**
 * Ids that fall outside the newest `limit` *finished* rows. Rows still running
 * are always kept and never count against the cap.
 *
 * They must not count: a row is written on every state change, and this prune
 * runs on each write. When three in-flight rows filled the cap by themselves,
 * the very write that moved a job to `error` or `done` was the write that
 * deleted it — the poller then got `not_found` and the toast froze on
 * "장면 태깅" forever. Retry toasts still worked because `tagging` is active.
 */
export function jobIdsToPrune(
  rows: readonly JobRetentionRow[],
  limit = JOB_RETENTION_LIMIT,
): string[] {
  const finished = rows.filter((row) => !ACTIVE_STATES.has(String(row.state || '')));
  if (finished.length <= limit) return [];
  const newest = [...finished].sort((a, b) => {
    const dt = jobRetentionStamp(b) - jobRetentionStamp(a);
    if (dt !== 0) return dt;
    return String(b.id).localeCompare(String(a.id));
  });
  const keep = new Set<string>();
  for (const row of newest) {
    if (keep.size >= limit) break;
    const id = String(row.id || '');
    if (id) keep.add(id);
  }
  const drop: string[] = [];
  for (const row of finished) {
    const id = String(row.id || '');
    if (id && !keep.has(id)) drop.push(id);
  }
  return drop;
}

export const ORPHAN_JOB_ERROR = '이전 세션에서 중단된 작업입니다.';

/**
 * In-flight rows found at boot. Nothing can be running before the plugin has
 * loaded, so every one of these is a job that was cut off by a reload or a
 * crash. Left alone they never leave the active set: no runner owns them, stop
 * cannot see them, and each one permanently occupies a retention slot.
 */
export function orphanJobIds(rows: readonly JobRetentionRow[]): string[] {
  const out: string[] = [];
  for (const row of rows) {
    const id = String(row.id || '');
    if (id && ACTIVE_STATES.has(String(row.state || ''))) out.push(id);
  }
  return out;
}
