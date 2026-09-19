/**
 * Which message a job owns, and whether it is free.
 *
 * This lives on its own because two services gate the same lock: `jobs.ts` when
 * accepting a new generation, and `cards.ts` when rerolling. Both need the exact
 * same key derivation, and any drift between two copies would let a reroll and a
 * generation write to one message concurrently — the failure would be a corrupted
 * gallery, and it would only appear under a race.
 *
 * The lock state itself is held in `context.ts`; this module only interprets it.
 */

import type { JobRequest } from '../core/types';
import { cleanText, toInt } from '../core/util/text';
import { idbGet } from '../storage/stores';
import { jobEpochByKey, jobRunMeta, messageBusyKeys } from './context';

/** States that mean a job still owns its target message. */
export const ACTIVE_JOB_STATES = ['queued', 'tagging', 'generating'];

/** The subset of a job request that identifies which message it targets. */
export type TargetRequest = Partial<JobRequest> & Record<string, unknown>;

/**
 * Identifies the message a job targets. Content hash is preferred because it
 * survives message reordering; index is the fallback, and `all` covers a
 * whole-session request.
 */
export function jobKey(request: TargetRequest = {}, sessionId = ''): string {
  const sid = cleanText(sessionId || request.session_id || '', 200) || '_';
  const hash = cleanText(request.content_hash || '', 128);
  if (hash) return `${sid}::h:${hash}`;
  const mi = toInt(request.message_index, -1);
  if (mi >= 0) return `${sid}::m:${mi}`;
  return `${sid}::all`;
}

/** The id of the job currently occupying a target, or '' when free. */
export async function busyJobIdForKey(key: string): Promise<string> {
  if (messageBusyKeys.has(key)) return 'message-reroll';
  const cur = jobEpochByKey.get(key);
  if (!cur?.jobId) return '';
  const meta = jobRunMeta.get(cur.jobId);
  if (!meta || meta.cancelRequested) return '';
  const row = await idbGet('jobs', cur.jobId);
  if (!row) return '';
  if (ACTIVE_JOB_STATES.includes(String(row.state || ''))) return cur.jobId;
  return '';
}

/** Narrower than `ApiResult` so callers can read `.error.message` without a cast. */
export interface BusyReply extends Record<string, unknown> {
  ok: false;
  busy: true;
  error: { code: string; message: string };
}

/** The 409-shaped reply when a target is occupied, or `null` when it is free. */
export async function busyReplyForRequest(
  request: TargetRequest = {},
  sessionId = '',
): Promise<BusyReply | null> {
  const key = jobKey(request, sessionId);
  const busyId = await busyJobIdForKey(key);
  if (!busyId) return null;
  return {
    ok: false,
    busy: true,
    accepted: false,
    job_id: busyId === 'message-reroll' ? '' : busyId,
    session_id: cleanText(sessionId || request.session_id || '', 200),
    job_state: 'busy',
    error: { code: 'busy', message: '같은 메시지 작업이 아직 진행 중입니다. 끝날 때까지 기다려 주세요.' },
  };
}