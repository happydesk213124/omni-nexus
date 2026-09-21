import { reuseCreatedCostumePicks } from '../domain/character/costume';
import { writeJobSpinners, finishJobSpinners, stripBakedImagesFromChatMessage } from './chat-bake';
/**
 * The generation job engine.
 *
 * A job turns one chat message into N illustrated cards: tag the scene with an
 * LLM, reconcile the character roster, then generate and store one image per
 * shot. Two properties dominate the design:
 *
 * **Supersession.** The user can edit or reroll a message while its job is still
 * running. Results from the old run must never appear. Each target message has
 * an epoch (`jobEpochByKey`); starting a job bumps it, and the running job
 * re-checks `isJobCurrent` at every await boundary. A superseded job deletes any
 * cards it already published and marks itself cancelled. In-flight NovelAI
 * requests are deliberately allowed to finish rather than aborted — the image is
 * already paid for in Anlas, and discarding after the fact is simpler than
 * unwinding a partial HTTP read. As soon as a shot's PNG exists, publish +
 * spinner→image run immediately (and in parallel across shots). Card-row
 * idb can trail that reveal while the next NovelAI request is already in flight.
 *
 * **Progress without I/O.** Progress ticks every few seconds for potentially
 * minutes. Persisting a full jobs snapshot per tick is what made 1.x stall
 * during NovelAI calls, so `generating`→`generating` transitions stay in memory
 * (`persist: false`) and only state changes reach disk. Payloads are also kept
 * small: `tagged`, `appearance` and data URLs are stripped before storage
 * because they run to megabytes and would block the storage RPC.
 */

import { ASSISTANT_PREVIEW_LIMIT } from '../core/constants';
import { normalizeAssetNaiTagsMode } from '../config/schema';
import {
  dbg,
  dbgSpan,
  eventsForJob,
  getFocusStage,
  getJobContext,
  getLastError,
  getLastStage,
  setJobContext,
} from '../core/debug';
import type { ApiResult, JobRequest, JobState, TaggedShot, TaggerResult } from '../core/types';
import { cleanText, stripCbs, toInt, uuid, writeSessionId } from '../core/util/text';
import { parseJsonLoose, TAGGER_JSON_RETRY_FAIL_MESSAGE } from '../core/util/object';
import {
  forceFinishNaiBody,
  getNaiBodyBytesExpected,
  getNaiBodyBytesReceived,
  getNaiInflight,
  getNaiLastByteAt,
  hasNaiBodyControl,
} from '../providers/nai/http';
import { allUniqueNaiTokens, naiHasAnyToken, tokensForFamily } from '../domain/nai/keys';
import { imageBackendKind, imageGenTokens } from '../providers/comfy/client';
import { aspectFromCanvas, canvasDimsForShot, resolveShotAspect } from '../domain/nai-meta/aspect';
import {
  cardFlagOn,
  isNaiQuotaError,
  isNaiRetryableKeyError,
  modelForFamily,
  pickPresetForFamily,
  type ShotNaiRoute,
} from '../domain/nai/routing';
import { callLlm } from './llm-call';
import { resolveLlmRole } from '../domain/llm/roles';
import { comicGenOn, clampComicByRatio } from '../domain/comic/kind';
import { applyComicAspect } from '../domain/comic/aspect';
import { normalizeComicSchedule } from '../domain/comic/params';
import { pickNextReadyShot } from '../domain/comic/schedule';
import { characterHasAppearance, characterMaxLimit, applyWearContinuityToShots, applyCostumeContinuityToShots, applyCreatedCostumesToShots, collectCostumePairs, createdCostumeWearByName, ensureCostumes } from '../domain/character/tags';
import { slimCardCharacters } from '../domain/gallery/slim-cast';
import { stripStoredCardMeta } from '../domain/gallery/strip-stored-meta';
import { dedupeShotCharacters, matchCharactersInText, resolveCharacter } from '../domain/character/roster';
import { publishImage, resolveImageUrl } from '../storage/image-urls';
import { idbGet, idbPut, rememberSessionAlias } from '../storage/stores';
import { getConfig, jobEpochByKey, jobRunMeta, requestMessageRerollStop } from './context';
import { mergeRosterFromTagged, rosterForSession } from './characters';
import { ensureCastIds } from './cast-ids';
import { applyLocationContinuityToShots } from '../domain/tagging/location';
import { chatNoteSessionId, getSessionAuthorNote, persistSessionLocation, sessionOutfitRevision, rosterWithSessionOutfits, persistSessionOutfits } from './session-author-note';
import { parseWearState } from '../domain/character/wear-state';
import { shotKeepsComicSlots } from '../domain/comic/page';
import { fillComicPagesForShots } from './comic';
import { buildComicGenerationForShot, buildGenerationForShot, buildImageLocation, cardMetaFromLocation, generateImage, isComicShot, readImageLocation } from './generation';
import { buildCharacterLooksMessages, buildTaggerMessages, collectAssetTagsForTagger, flattenShots } from './tagger';
import {
  applyLorefilter,
  ensureLorefilter,
  fetchHostLorebookEntries,
} from './lorefilter';
import { collectTriggeredLoreKeys } from '../domain/lore/assemble';
import { collectBestLookAssets } from './asset-tags';
import { runVisionAutotagLook } from './vision-autotag';
import { deleteCard, rebindCardsHash } from './gallery';
import { ACTIVE_JOB_STATES, busyReplyForRequest, jobKey } from './job-locks';
import { getPrompt } from './settings';
import {
  canRetargetJobSaveHash,
  jobMatchesMessageIdentity,
} from '../ui-contract/viewer-core';
import { stripBakeTokens } from '../domain/chat-bake';
import { speakAfterBake } from './tts';
import {
  bakeCardsIntoChatMessage,
  jobChatTarget,
  persistChatImagesOn,
  readStoredMessageBody,
} from './chat-bake';

export { canRetargetJobSaveHash, jobMatchesMessageIdentity };


/** Progress heartbeat period while waiting on NovelAI. */
const HEARTBEAT_MS = 5000;

const jobLlmControllers = new Map<string, AbortController>();
let bakeWriteChain: Promise<void> = Promise.resolve();
function enqueueBakeWrite<T>(work: () => Promise<T>): Promise<T> {
  const next = bakeWriteChain.then(work, work);
  bakeWriteChain = next.then(() => undefined, () => undefined);
  return next;
}

/**
 * Mid-job streaming can rebind earlier shots to a newer message hash while later
 * shots are still generating. Prefer (1) an explicit save-hash retarget on the
 * running job, then (2) a sibling card's rebound hash, so the rest of the job
 * lands on the same message. Lock key / request.content_hash stay untouched.
 */
async function resolveJobContentHash(
  jobId: string,
  requestHash: string,
): Promise<{ contentHash: string; assistantPreview: string }> {
  const fallback = cleanText(requestHash || '', 128);
  const meta = jobRunMeta.get(jobId);
  const saveHash = cleanText(meta?.saveContentHash || '', 128);
  if (saveHash && fallback && saveHash !== fallback) {
    return {
      contentHash: saveHash,
      assistantPreview: cleanText(meta?.saveAssistantPreview || '', ASSISTANT_PREVIEW_LIMIT),
    };
  }
  const published = meta?.publishedIds || [];
  for (const id of published) {
    try {
      const loc = await readImageLocation(id);
      const h = cleanText(loc?.content_hash || '', 128);
      if (h && fallback && h !== fallback) {
        return {
          contentHash: h,
          assistantPreview: cleanText(loc?.assistant_preview || '', ASSISTANT_PREVIEW_LIMIT),
        };
      }
    } catch {
      /* try next sibling */
    }
  }
  return { contentHash: fallback, assistantPreview: '' };
}

/**
 * True when any active job targets the same char/chat/msg/role (hash ignored).
 * Lets the UI skip Ka while tagging/generating under a streaming hash.
 */
export async function busyJobForMessage(args: {
  session_id?: string;
  character_id?: string;
  chat_id?: string;
  message_index?: unknown;
  role?: string;
} = {}): Promise<ApiResult> {
  const identity = {
    sessionId: cleanText(args.session_id || '', 200),
    characterId: cleanText(args.character_id || '', 200),
    chatId: cleanText(args.chat_id || '', 200),
    messageIndex: toInt(args.message_index, -1),
    role: args.role || '',
  };
  if (!identity.characterId || identity.messageIndex < 0) {
    return { ok: true, busy: false };
  }
  for (const [jobId, meta] of jobRunMeta.entries()) {
    if (!jobMatchesMessageIdentity(meta, identity)) continue;
    const row = await idbGet('jobs', jobId);
    const state = String(row?.state || '');
    if (!ACTIVE_JOB_STATES.includes(state)) continue;
    return {
      ok: true,
      busy: true,
      job_id: jobId,
      state,
      content_hash: cleanText(meta.saveContentHash || '', 128),
    };
  }
  return { ok: true, busy: false };
}

/**
 * While a job is still running, point later card saves at the finished message
 * hash — only when identity matches and text is ≥60% similar to the job-start
 * preview. Does not change the busy/lock key (still the original hash).
 */
export async function retargetJobSaveHash(args: {
  session_id?: string;
  character_id?: string;
  chat_id?: string;
  message_index?: unknown;
  role?: string;
  to_hash?: string;
  assistant_text?: string;
  assistant_preview?: string;
} = {}): Promise<ApiResult> {
  const toHash = cleanText(args.to_hash || '', 128);
  const text = cleanText(args.assistant_preview || args.assistant_text || '', ASSISTANT_PREVIEW_LIMIT);
  const identity = {
    toHash,
    text,
    sessionId: cleanText(args.session_id || '', 200),
    characterId: cleanText(args.character_id || '', 200),
    chatId: cleanText(args.chat_id || '', 200),
    messageIndex: toInt(args.message_index, -1),
    role: args.role || '',
  };
  if (!toHash || !text || !identity.characterId || identity.messageIndex < 0) {
    return { ok: false, error: { code: 'bad_request', message: 'to_hash, text, character_id, message_index required' }, retargeted: false };
  }
  for (const [jobId, meta] of jobRunMeta.entries()) {
    if (!canRetargetJobSaveHash(meta, identity)) continue;
    const row = await idbGet('jobs', jobId);
    const state = String(row?.state || '');
    if (!ACTIVE_JOB_STATES.includes(state)) continue;
    meta.saveContentHash = toHash;
    meta.saveAssistantPreview = text;
    let rebound = 0;
    if (meta.publishedIds?.length) {
      try {
        const res = await rebindCardsHash({
          session_id: identity.sessionId || meta.sessionId,
          card_ids: [...meta.publishedIds],
          to_hash: toHash,
          assistant_preview: text,
        });
        rebound = Number((res as { rebound?: unknown })?.rebound || 0);
      } catch {
        /* save-hash still updated; published cards may catch up on next rebind */
      }
    }
    dbg('job.retarget', {
      job_id: jobId,
      to: toHash.slice(0, 8),
      msg: identity.messageIndex,
      rebound,
      focus: true,
    });
    return { ok: true, retargeted: true, job_id: jobId, content_hash: toHash, rebound };
  }
  return { ok: true, retargeted: false, job_id: '', content_hash: toHash };
}


/**
 * NovelAI occasionally delivers the whole ZIP then never closes the stream. Once
 * bytes have arrived and gone quiet this long, treat the body as complete.
 */
const NAI_IDLE_FINISH_MS = 2500;
const NAI_MIN_BODY_BYTES = 64;

/** A request as it arrives from the UI: `session_id` is filled in by `createJob`. */
type IncomingRequest = Partial<JobRequest> & Record<string, unknown>;

// ── target identity and epochs ──────────────────────────────────────────────

const lastGeneratingReady = new Set<string>();
const lastGeneratingWaiters = new Map<string, () => void>();

function resetLastGeneratingPoll(jobId: string): void {
  lastGeneratingReady.delete(jobId);
  lastGeneratingWaiters.delete(jobId);
}

function noteLastGeneratingPoll(
  jobId: string,
  state: string,
  result: Record<string, unknown> | null,
): void {
  if (state !== 'generating' || !result) return;
  const shotDone = Number(result.shot_done);
  const shotCount = Number(result.shot_count);
  if (!(shotCount > 0) || shotDone !== shotCount) return;
  lastGeneratingReady.add(jobId);
  const release = lastGeneratingWaiters.get(jobId);
  if (release) {
    lastGeneratingWaiters.delete(jobId);
    release();
  }
}

function waitForLastGeneratingPoll(jobId: string, timeoutMs = 1500): Promise<void> {
  if (lastGeneratingReady.has(jobId)) {
    lastGeneratingReady.delete(jobId);
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      lastGeneratingWaiters.delete(jobId);
      resolve();
    }, timeoutMs);
    lastGeneratingWaiters.set(jobId, () => {
      clearTimeout(timer);
      lastGeneratingReady.delete(jobId);
      resolve();
    });
  });
}

function beginJobEpoch(jobId: string, request: IncomingRequest, sessionId: string): { key: string; epoch: number } {
  const key = jobKey(request, sessionId);
  const prev = jobEpochByKey.get(key);
  const epoch = (prev?.epoch || 0) + 1;
  // Deliberately does not cancel a running job for the same key; callers must
  // busy-check first, so that a queued duplicate is rejected rather than
  // silently replacing work the user is already waiting on.
  jobEpochByKey.set(key, { epoch, jobId });
  resetLastGeneratingPoll(jobId);
  const preview = cleanText(request.assistant_text || '', ASSISTANT_PREVIEW_LIMIT);
  const hash = cleanText(request.content_hash || '', 128);
  jobRunMeta.set(jobId, {
    key,
    epoch,
    cancelRequested: false,
    publishedIds: [],
    saveContentHash: hash,
    saveAssistantPreview: preview,
    sourcePreview: preview,
    sessionId,
    characterId: cleanText(request.character_id || '', 200),
    chatId: cleanText(request.chat_id || '', 200),
    messageIndex: toInt(request.message_index, -1),
    messageRole: cleanText(request.message_role || request.role || '', 40).toLowerCase(),
  });
  return { key, epoch };
}

function isJobCurrent(jobId: string): boolean {
  const meta = jobRunMeta.get(jobId);
  if (!meta || meta.cancelRequested) return false;
  const cur = jobEpochByKey.get(meta.key);
  return Boolean(cur && cur.jobId === jobId && cur.epoch === meta.epoch);
}

/** Removes cards a now-superseded run already published. */
async function discardJobPublished(jobId: string): Promise<number> {
  const meta = jobRunMeta.get(jobId);
  const ids = meta?.publishedIds ? [...meta.publishedIds] : [];
  if (meta) meta.publishedIds = [];
  for (const id of ids) {
    try {
      await deleteCard(id);
    } catch {
      /* a card the user already deleted is not an error here */
    }
  }
  return ids.length;
}

/** Returns true when the job was stale and has now been cancelled. */
async function cancelJobIfStale(jobId: string, note = 'interrupted'): Promise<boolean> {
  if (isJobCurrent(jobId)) return false;
  const meta = jobRunMeta.get(jobId);
  // User soft-stop: keep published cards (already paid / already shown).
  if (meta?.userStop) {
    await finishUserStoppedJob(jobId, note);
    return true;
  }
  const dropped = await discardJobPublished(jobId);
  await setJob(
    jobId,
    'cancelled',
    {
      phase: 'cancelled',
      progress: 0,
      message: `${note}${dropped ? ` · discarded ${dropped}` : ''}`,
      shot_count: 0,
      shot_done: 0,
    },
    null,
  );
  dbg('job.cancelled', { job_id: jobId, message: note, discarded: dropped, focus: true });
  return true;
}

/** Soft-stop terminal: cancelled UI, no card discard. */
async function finishUserStoppedJob(jobId: string, note = '사용자 중단'): Promise<void> {
  const meta = jobRunMeta.get(jobId);
  const n = meta?.publishedIds?.length || 0;
  await setJob(
    jobId,
    'cancelled',
    {
      phase: 'cancelled',
      progress: 100,
      message: `${note}${n ? ` · 유지 ${n}장` : ''}`,
      shot_count: n,
      shot_done: n,
    },
    null,
  );
  dbg('job.user_stop', { job_id: jobId, message: note, kept: n, focus: true });
}

/**
 * Stop each job's cancellable LLM calls; let paid NAI finish and keep saved cards.
 */
export async function requestJobStop(args: { session_id?: string } = {}): Promise<ApiResult> {
  // Soft-stop message-level reroll batches / UI live loops (do not abort in-flight NAI).
  requestMessageRerollStop();
  const sid = cleanText(args.session_id || '', 200);
  const stopped: string[] = [];
  for (const [jobId, meta] of jobRunMeta.entries()) {
    const liveSid = chatNoteSessionId('', { characterId: meta.characterId, chatId: meta.chatId });
    if (sid && meta.sessionId !== sid && liveSid !== sid) continue;
    const row = await idbGet('jobs', jobId);
    const state = String(row?.state || '');
    if (!ACTIVE_JOB_STATES.includes(state)) continue;
    meta.cancelRequested = true;
    meta.userStop = true;
    jobLlmControllers.get(jobId)?.abort();
    const prev = (row?.result_json && (() => {
      try {
        return JSON.parse(String(row.result_json));
      } catch {
        return null;
      }
    })()) as Record<string, unknown> | null;
    const shotDone = toInt(prev?.shot_done, meta.publishedIds?.length || 0);
    const shotCount = toInt(prev?.shot_count, Math.max(shotDone, meta.publishedIds?.length || 0));
    await setJob(
      jobId,
      'cancelled',
      {
        phase: 'cancelled',
        progress: Number(prev?.progress) || Math.round((shotDone / Math.max(1, shotCount || 1)) * 100) || 0,
        message: '사용자 중단',
        shot_count: shotCount,
        shot_done: shotDone,
      },
      null,
    );
    stopped.push(jobId);
    dbg('job.stop_requested', { job_id: jobId, session: (sid || meta.sessionId || '').slice(-8), focus: true });
  }
  return {
    ok: true,
    stopped: stopped.length,
    job_ids: stopped,
    reroll_stop: true,
  };
}

// ── progress and state ─────────────────────────────────────────────────────

type PendingInlineRow = {
  shot_index: number;
  line: number;
  aspect?: string;
  width?: number;
  height?: number;
  kind?: 'comic';
};

interface ProgressExtra {
  shot_count?: number;
  shot_index?: number;
  shot_done?: number;
  progress?: number;
  phase?: string;
  message?: string;
  cards_so_far?: number;
  /** Known line slots for bubble inline placeholders (spinner until image ready). */
  pending_inline?: PendingInlineRow[];
  /** Message index the pending rows belong to — UI must not paint them on other turns. */
  pending_message_index?: number;
}

/** Small by design: a progress row must never carry the tagged scene. */
function progressPayload(extra: ProgressExtra = {}): Record<string, unknown> {
  return {
    shot_count: extra.shot_count ?? 0,
    shot_index: extra.shot_index ?? 0,
    shot_done: extra.shot_done ?? 0,
    progress: extra.progress ?? 0,
    phase: extra.phase || 'generating',
    message: extra.message || '',
    cards_so_far: extra.cards_so_far,
    pending_inline: Array.isArray(extra.pending_inline) ? extra.pending_inline : undefined,
    pending_message_index: Number.isFinite(Number(extra.pending_message_index))
      ? Number(extra.pending_message_index)
      : undefined,
    debug_stage: getFocusStage() || getLastStage(),
    debug_error: getLastError()?.message || '',
  };
}

/** Strips payload fields that must never reach storage. */
function slimResultForStorage(result: unknown): unknown {
  if (!result || typeof result !== 'object') return result;
  return JSON.parse(
    JSON.stringify(result, (key, val: unknown) => {
      if (key === 'image_url' && typeof val === 'string' && val.startsWith('data:')) return '';
      if (key === 'tagged' || key === 'appearance' || key === 'debug_tail') return undefined;
      return val;
    }),
  );
}

async function setJob(
  jobId: string,
  state: JobState,
  result: unknown = null,
  error: string | null = null,
): Promise<void> {
  const meta = jobRunMeta.get(jobId);
  // After optimistic user-stop, ignore non-terminal progress (heartbeat / mid-shot).
  if (
    meta?.userStop
    && state !== 'cancelled'
    && state !== 'error'
    && state !== 'done'
  ) {
    return;
  }
  const row = await idbGet('jobs', jobId);
  if (!row) return;
  const next: Record<string, unknown> = { ...(row as unknown as Record<string, unknown>), state };
  const stored = slimResultForStorage(result);
  next.result_json = stored != null ? JSON.stringify(stored) : null;
  next.error = error;
  next.updated_at = Date.now() / 1000;
  const persistDisk = false;
  await idbPut('jobs', next, {persist:false});
  dbg('job.set', {
    message: `${state}${error ? ' ERR' : ''}${persistDisk ? '' : ' (mem)'}`,
    job_id: jobId,
    state,
    persist: persistDisk,
    err: error ? String(error).slice(0, 160) : '',
    background: state === 'generating',
    focus: state !== 'generating',
  });
}

// ── public API ─────────────────────────────────────────────────────────────

export async function createJob(request: IncomingRequest): Promise<ApiResult> {
  const card = getConfig().card || {};
  if (!card.power && !request.force) throw new Error('Power가 OFF 상태입니다.');
  const nai = getConfig().nai;
  if (imageBackendKind(nai) !== 'comfy' && !naiHasAnyToken(nai)) {
    return {
      ok: false,
      accepted: false,
      error: {
        code: 'no_nai_key',
        message: 'NovelAI API 키를 먼저 입력하세요. 모델 설정에서 키를 넣어 주세요.',
      },
    };
  }
  const sessionId = writeSessionId({
    sessionId: request.session_id,
    characterId: request.character_id,
    unifiedSessionId: request.unified_session_id,
  }) || `sess_${uuid().replace(/-/g, '').slice(0, 12)}`;
  const foldChar = cleanText(request.character_id, 200);
  const liveSid = cleanText(request.session_id, 200);
  if (foldChar) {
    if (liveSid) {
      await rememberSessionAlias(liveSid, foldChar, {
        character_name: request.character_name,
        chat_id: request.chat_id,
        chat_name: request.chat_name,
        char_index: request.char_index,
        chat_index: request.chat_index,
      });
    }
  }
  const payload: JobRequest = { ...request, session_id: sessionId, unified_session_id: sessionId };
  const busy = await busyReplyForRequest(payload, sessionId);
  if (busy) {
    dbg('job.busy', { message: busy.error.message || 'busy', key: jobKey(payload, sessionId), focus: true }, 'warn');
    return busy;
  }
  const jobId = uuid();
  const now = Date.now() / 1000;
  beginJobEpoch(jobId, payload, sessionId);
  // Baked tokens own placement. Retagging must not scan/unlink gallery assets.
  await idbPut('jobs', {
    id: jobId,
    session_id: sessionId,
    state: 'queued',
    request_json: JSON.stringify(payload),
    result_json: null,
    error: null,
    created_at: now,
    updated_at: now,
  });
  // Intentionally not awaited: the UI polls `getJob`, so createJob returns as
  // soon as the job is durable.
  runJob(jobId).catch(async (err: unknown) => {
    console.error('[Inlay Nexus] job crashed', jobId, err);
    try {
      await setJob(jobId, 'error', null, String((err as Error)?.message || err).slice(0, 1500));
    } catch {
      /* the job row is already gone */
    }
  });
  return { ok: true, accepted: true, job_id: jobId, session_id: sessionId, job_state: 'queued' };
}

export async function getJob(jobId: string): Promise<ApiResult> {
  const row = await idbGet('jobs', jobId);
  if (!row) return { ok: false, error: { code: 'not_found', message: 'job not found' } };
  const result = row.result_json ? (JSON.parse(row.result_json) as Record<string, unknown> | null) : null;
  const progress: Record<string, unknown> = {};
  if (result && typeof result === 'object') {
    for (const key of [
      'shot_count',
      'shot_index',
      'shot_done',
      'progress',
      'phase',
      'message',
      'cards_so_far',
      'pending_inline',
      'pending_message_index',
      'debug_stage',
      'debug_error',
    ]) {
      if (key in result) progress[key] = result[key];
    }
  }
  noteLastGeneratingPoll(jobId, row.state, result);
  // Result cards carry no display URL (see gallery.ts). Encoding here is what
  // once left the toast on generating N/N; attaching from cache was retention
  // the UI's own `resolveImageUrl` lookup makes redundant.
  return {
    ok: true,
    job_id: row.id,
    session_id: row.session_id,
    state: row.state,
    error: row.error,
    result,
    progress,
    debug: {
      last_stage: getLastStage(),
      last_error: getLastError(),
      events: eventsForJob(jobId, 40),
    },
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// ── the run loop ───────────────────────────────────────────────────────────

/** Reads the LLM's vertical anchor for a shot, if it gave one. */
function shotAnchorPercent(shot: TaggedShot): number | null {
  for (const key of ['y_percent', 'anchor_percent', 'read_percent'] as const) {
    const raw = (shot as unknown as Record<string, unknown>)[key];
    if (raw == null) continue;
    try {
      return Math.max(0, Math.min(100, Number(raw)));
    } catch {
      return null;
    }
  }
  return null;
}

async function runJob(jobId: string): Promise<void> {
  const row = await idbGet('jobs', jobId);
  if (!row) return;
  const request = JSON.parse(row.request_json ?? '{}') as JobRequest;
  const sessionId = String(row.session_id ?? '');
  const noteSessionId = chatNoteSessionId(request.session_id, request);
  const outfitRevision = sessionOutfitRevision(noteSessionId);
  const llmController = new AbortController();
  jobLlmControllers.set(jobId, llmController);
  const llmOptions = { signal: llmController.signal };
  const prevCtx = getJobContext();
  setJobContext(jobId);
  const jobSpan = dbgSpan('job.run');
  dbg('job.start', {
    job_id: jobId,
    session_id: sessionId,
    message_index: request.message_index,
    text_len: String(request.assistant_text || '').length,
  });
  // Background shot saves (publish/hash/card row). Hoisted so catch can drain.
  let pendingShotSave: Promise<void> = Promise.resolve();
  let shotSaveFailed: unknown = null;
  let durableSpinners = false;
  const completedSpinnerCards = new Map<number,string>();
  const bakedSpinnerShots = new Set<number>();
  async function finishCompletedSpinners(): Promise<boolean> {
    if (!durableSpinners || !completedSpinnerCards.size) return false;
    return enqueueBakeWrite(async () => {
      const meta = jobRunMeta.get(jobId);
      const current = meta && jobEpochByKey.get(meta.key);
      // A user stop keeps paid shots only while this epoch owns the message.
      if (!meta || current?.jobId !== jobId || current.epoch !== meta.epoch ||
          (meta.cancelRequested && !meta.userStop)) return false;
      const cards = [...completedSpinnerCards].filter(([shot])=>!bakedSpinnerShots.has(shot)).sort((a, b) => a[0] - b[0])
        .map(([shot, cardId]) => ({ shot, cardId }));
      if(cards.length) {
        // Stop remounting previews before the one final message write. Existing
        // preview DOM stays visible until Risu replaces that message.
        const closePreview = Reflect.get(globalThis, '__OMNI_CLEAR_SPINNER_PREVIEW__');
        if (typeof closePreview === 'function') await closePreview(jobId);
        if(!await finishJobSpinners({...jobChatTarget(request),jobId,cards})) throw new Error('Spinner slots missing');
        for(const card of cards) bakedSpinnerShots.add(card.shot);
        meta.publishedIds=(meta.publishedIds || []).filter(id=>!cards.some(card=>card.cardId===id));
      }
      return cards.length > 0;
    });
  }
  try {
    if (await cancelJobIfStale(jobId, 'superseded before start')) return;
    // Canonical source: the stored Risu message body, so tagger L-numbers
    // and spinner placement address the same lines. Only when no stored
    // message is reachable (unified view, out-of-range index) does the
    // request text stand in — there is no stored original there at all.
    const storedBody = await readStoredMessageBody(request.char_index, request.chat_index, request.message_index);
    request.assistant_text = stripBakeTokens(storedBody ?? request.assistant_text);
    if (await cancelJobIfStale(jobId, 'superseded before tagging')) return;
    await setJob(jobId, 'tagging', {
      phase: 'tagging',
      progress: 0,
      message: '장면 태깅 중…',
      shot_count: 0,
      shot_done: 0,
      debug_stage: 'job.tagging',
    });

    const unifiedSessionId = cleanText(request.unified_session_id || '', 200);
    const characterId = cleanText(request.character_id || '', 200);
    const sourceSessionIds = Array.isArray(request.source_session_ids)
      ? request.source_session_ids.map((s) => cleanText(s, 200)).filter(Boolean)
      : [];

    // Lorefilter: whitelist character lore before assets/tagger (fail-open).
    if (characterId && getConfig().card?.lorebook !== false) {
      try {
        const hostLore = await fetchHostLorebookEntries();
        const book = hostLore.length
          ? hostLore
          : Array.isArray(request.lorebook)
            ? request.lorebook
            : [];
        if (book.length) {
          const selected = await ensureLorefilter(characterId, book);
          const filtered = applyLorefilter(book, selected);
          request.lorebook = filtered;
          request.lore_trigger_keys = collectTriggeredLoreKeys(
            filtered,
            cleanText(request.assistant_text || '', 20000),
          );
          dbg('job.lorefilter', {
            character_id: characterId,
            selected: selected.length,
            in: book.length,
            out: filtered.length,
            focus: true,
          });
        }
      } catch (err) {
        dbg(
          'job.lorefilter.fail',
          { message: String((err as Error)?.message || err) },
          'warn',
        );
      }
    }

    // Asset NAI: off | inline (soup on main) | prepass (looks LLM; no-meta → autotag + lore ref).
    const assetMode = normalizeAssetNaiTagsMode(getConfig().card?.asset_nai_tags);
    let skipAssetInject = false;
    if (assetMode === 'prepass') {
      const assetCollected = await collectAssetTagsForTagger(request, {
        withPreviews: false,
      });
      if (assetCollected?.block) {
        await setJob(jobId, 'tagging', {
          phase: 'tagging',
          progress: 0.05,
          message: '에셋 캐릭터 룩 태깅 중…',
          shot_count: 0,
          shot_done: 0,
          debug_stage: 'job.char_looks',
        });
        if (await cancelJobIfStale(jobId, 'superseded before char looks')) return;
        try {
          const lookAssetNames = assetCollected.packed.groups.flatMap((g) => g.assets.map((a) => a.name));
          const lookMessages = await buildCharacterLooksMessages(
            request,
            assetCollected.block,
            lookAssetNames,
            [],
          );
          dbg('job.char_looks.messages', {
            mode: assetMode,
            msgs: lookMessages.length,
            assets: lookAssetNames,
            groups: assetCollected.packed.groups.map((g) => g.trigger),
            previews: (assetCollected.previews || []).map((p) => p.name),
          });
          const lookRaw = await callLlm(resolveLlmRole(getConfig(), 'asset_char'), lookMessages, llmOptions);
          if (await cancelJobIfStale(jobId, 'superseded after char looks')) return;
          const lookTagged = parseJsonLoose(lookRaw) as TaggerResult;
          const newChars = Array.isArray(lookTagged?.new_characters) ? lookTagged.new_characters : [];
          if (newChars.length) {
            await mergeRosterFromTagged({
              sessionId,
              tagged: { new_characters: newChars, scenes: [] },
              shotChars: [],
              unifiedSessionId,
              characterId,
              sourceSessionIds,
              assetLooks: true,
              originalHints: assetCollected.originalHints || {},
            });
          }
          const filledLooks = newChars.filter((c) => characterHasAppearance(c)).length;
          skipAssetInject = true;
          dbg('job.char_looks.done', {
            mode: assetMode,
            new_characters: newChars.length,
            filled_looks: filledLooks,
            raw_len: String(lookRaw || '').length,
          });
        } catch (err) {
          skipAssetInject = false;
          dbg(
            'job.char_looks.fail',
            { mode: assetMode, message: String((err as Error)?.message || err) },
            'warn',
          );
        }
      }
      try {
        const rosterNow = await rosterForSession(sessionId, unifiedSessionId, characterId, sourceSessionIds);
        const hay = String(request.assistant_text || '');
        const incomplete = matchCharactersInText(hay, rosterNow).filter((c) => !characterHasAppearance(c));
        if (incomplete.length) {
          const looks = await collectBestLookAssets(
            incomplete.map((c) => c.name),
            { roster: rosterNow, characterId },
          );
          const lorebook = Array.isArray(request.lorebook) ? request.lorebook : [];
          const filled: Array<Record<string, unknown>> = [];
          for (const asset of looks.slice(0, 5)) {
            const loreRef = lorebook
              .filter((e) => {
                const keyBits = [e.key, e.keys, e.title].flatMap((v) => (Array.isArray(v) ? v : [v]));
                const blob = keyBits.map((v) => String(v || '')).join(' ').toLowerCase();
                return blob.includes(String(asset.trigger || '').toLowerCase());
              })
              .map((e) => String(e.content || e.comment || '').slice(0, 800))
              .filter(Boolean)
              .join('\n');
            const look = await runVisionAutotagLook(asset.bytes, { loreRef });
            filled.push({
              name: asset.trigger,
              ...look,
            });
          }
          if (filled.length) {
            await mergeRosterFromTagged({
              sessionId,
              tagged: { new_characters: filled, scenes: [] },
              shotChars: [],
              unifiedSessionId,
              characterId,
              sourceSessionIds,
              assetLooks: true,
            });
            skipAssetInject = true;
            dbg('job.char_looks.no_meta_autotag', { filled: filled.length });
          }
        }
      } catch (noMetaErr) {
        dbg(
          'job.char_looks.no_meta_autotag.fail',
          { message: String((noMetaErr as Error)?.message || noMetaErr) },
          'warn',
        );
        throw noMetaErr;
      }
    }

    await setJob(jobId, 'tagging', {
      phase: 'tagging',
      progress: 10,
      message: '장면 태깅 중…',
      shot_count: 0,
      shot_done: 0,
      debug_stage: 'job.tagging',
    });

    const messages = await buildTaggerMessages(request, { skipAssetInject });
    dbg('job.tagger.messages', { msgs: messages.length, skip_asset_inject: skipAssetInject });
    if (getConfig().card?.preprocessing) {
      const pre = stripCbs(await getPrompt('preprocess'));
      if (pre) {
        const preMessages = [{ role: 'system', content: pre }, messages[messages.length - 1]];
        const summary = await callLlm(resolveLlmRole(getConfig(), 'main'), preMessages, llmOptions);
        if (await cancelJobIfStale(jobId, 'superseded during preprocess')) return;
        messages.splice(messages.length - 1, 0, {
          role: 'system',
          content: `## Preprocess Summary\n${summary}`,
        });
      }
    }
    // Start the paid request first and strip only after it resolves. The strip
    // remounts the chat (height drop); running it in parallel left an empty
    // slot for the whole tagger wait, fighting bottom autoscroll. The tagger
    // input was already built above, so deferring the message-only cleanup
    // changes no tagger behaviour.
    const tagRequest = callLlm(resolveLlmRole(getConfig(), 'main'), messages, llmOptions);
    const taggedRaw0 = await tagRequest;
    if (await cancelJobIfStale(jobId, 'superseded after tagging')) return;
    if (request.force && persistChatImagesOn()) {
      await enqueueBakeWrite(() => stripBakedImagesFromChatMessage(jobChatTarget(request)));
      if (await cancelJobIfStale(jobId, 'superseded after strip')) return;
    }
    let taggedRaw = taggedRaw0;
    const readMainTagger = (raw: string): { tagged: TaggerResult; shots: TaggedShot[] } => {
      const tagged = parseJsonLoose(raw) as TaggerResult;
      const shots = flattenShots(tagged, request.assistant_text);
      if (!shots.length) throw new Error('태거가 shot을 반환하지 않았습니다.');
      return { tagged, shots };
    };
    let tagged: TaggerResult;
    let shots: TaggedShot[];
    try {
      ({ tagged, shots } = readMainTagger(taggedRaw));
    } catch (parseErr) {
      const retryOn = getConfig().card?.llm_json_retry === true;
      const errMsg = String((parseErr as Error)?.message || parseErr).slice(0, 800);
      dbg('job.tagger.json_fail', {
        err: errMsg.slice(0, 160),
        raw_len: String(taggedRaw || '').length,
        retry: retryOn,
      }, 'warn');
      if (!retryOn) throw parseErr;
      if (await cancelJobIfStale(jobId, 'superseded before json retry')) return;
      dbg('job.tagger.json_retry', { err: errMsg.slice(0, 160), raw_len: String(taggedRaw || '').length }, 'warn');
      await setJob(jobId, 'tagging', {
        phase: 'tagging',
        progress: 0.28,
        message: '태거 JSON 오류 → 재시도 중…',
        shot_count: 0,
        shot_done: 0,
        debug_stage: 'job.tagger_json_retry',
      });
      messages.push(
        { role: 'assistant', content: String(taggedRaw || '').slice(0, 12000) },
        {
          role: 'user',
          content:
            `이전 응답 JSON 파싱 실패:\n${errMsg}\nformat 스키마에 맞는 JSON 객체 하나만 다시 출력하세요. scenes[].shots에 컷을 넣으세요.`,
        },
      );
      taggedRaw = await callLlm(resolveLlmRole(getConfig(), 'main'), messages, llmOptions);
      if (await cancelJobIfStale(jobId, 'superseded after json retry')) return;
      try {
        ({ tagged, shots } = readMainTagger(taggedRaw));
      } catch {
        throw new Error(TAGGER_JSON_RETRY_FAIL_MESSAGE);
      }
    }
    dbg('job.tagger.done', { shots: shots.length, raw_len: String(taggedRaw || '').length });
    const card = getConfig().card || {};
    const imageMin = Math.max(1, Number(card.image_min ?? 1));
    const imageMax = Math.max(imageMin, Number(card.image_max ?? 3));
    shots = shots.slice(0, imageMax);
    if (comicGenOn(card)) shots = clampComicByRatio(shots, card.comic_gen_ratio);
    shots = applyComicAspect(shots, card.comic_aspect);

    const allChars = shots.flatMap((shot) => shot.characters || []);
    let roster = await mergeRosterFromTagged({
      sessionId,
      tagged,
      shotChars: allChars,
      unifiedSessionId,
      characterId,
      sourceSessionIds,
    });
    roster = rosterWithSessionOutfits(roster, await getSessionAuthorNote(noteSessionId));
    const successfulOutfitShots = new Map<number, TaggedShot>();
    dbg('job.roster', { roster: roster.length });
    const charMax = characterMaxLimit(card);
    for (const shot of shots) {
      if (shotKeepsComicSlots(shot)) continue;
      shot.characters = dedupeShotCharacters(shot.characters || [], roster, charMax);
    }
    // Session-remembered outfits (id-keyed, from prior generations in this
    // chat). Roster first, then the note, then the clothed default inside
    // applyWearContinuityToShots.
    const noteWearById = new Map<string, string>();
    const noteWearByName = new Map<string, string>();
    try {
      const remembered = ((await getSessionAuthorNote(noteSessionId)) as unknown as Record<string, unknown>).wear;
      if (Array.isArray(remembered)) {
        for (const entry of remembered) {
          const rec = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : null;
          const wear = parseWearState(rec?.wear);
          if (!wear) continue;
          const id = cleanText(rec?.id, 200);
          const nm = cleanText(rec?.name, 200).toLowerCase();
          if (id) noteWearById.set(id, wear);
          if (nm) noteWearByName.set(nm, wear);
        }
      }
    } catch { /* no session note yet */ }
    const wearPrev = (name: string): unknown => {
      const rec = resolveCharacter(name, roster);
      return rec?.wear_state
        ?? (rec?.id ? noteWearById.get(String(rec.id)) : undefined)
        ?? noteWearByName.get(String(name || '').toLowerCase());
    };
    applyWearContinuityToShots(shots, wearPrev);

    applyCreatedCostumesToShots(
      shots,
      createdCostumeWearByName(collectCostumePairs({
        new_costumes: (tagged as { new_costumes?: unknown }).new_costumes,
        new_characters: tagged.new_characters,
        shots,
      })),
    );
    reuseCreatedCostumePicks(shots, collectCostumePairs({new_costumes: tagged.new_costumes, new_characters: tagged.new_characters, shots}), roster);
    applyCostumeContinuityToShots(shots, (name) => {
      const rec = resolveCharacter(name, roster);
      if (!rec) return undefined;
      const { costumes, active_costume } = ensureCostumes(rec);
      return costumes[active_costume]?.name ?? active_costume;
    });
    let sessionLocation = '';
    try {
      sessionLocation = cleanText((await getSessionAuthorNote(noteSessionId) as { location?: unknown }).location, 800);
    } catch { /* no session note yet */ }
    sessionLocation = applyLocationContinuityToShots(shots, sessionLocation);
    await persistSessionLocation(noteSessionId, sessionLocation);

    const ready = new Set<number>();
    const done = new Set<number>();
    const inflight = new Set<number>();
    const order = shots.map((_, i) => i);
    for (let i = 0; i < shots.length; i += 1) {
      if (!isComicShot(shots[i])) ready.add(i);
    }
    let comicFinished = !shots.some((s) => isComicShot(s));
    let releaseComic: () => void = () => {};
    const comicGate = new Promise<void>((resolve) => { releaseComic = resolve; });
    const runComicLayout = async (): Promise<void> => {
      if (comicFinished) {
        releaseComic();
        return;
      }
      try {
        await setJob(jobId, 'tagging', {
          phase: 'tagging',
          progress: 0.48,
          message: '만화 레이아웃 중…',
          shot_count: shots.length,
          shot_done: 0,
          debug_stage: 'job.comic_layout',
        });
        if (await cancelJobIfStale(jobId, 'superseded during comic layout')) return;
        const assigned = await fillComicPagesForShots({
          shots,
          roster,
          assistantText: request.assistant_text,
          sessionId,
          chatSessionId: noteSessionId,
          signal: llmController.signal,
        });
        applyWearContinuityToShots(shots, wearPrev);

        sessionLocation = applyLocationContinuityToShots(shots, sessionLocation);
        await persistSessionLocation(noteSessionId, sessionLocation);
        for (const idx of assigned) ready.add(idx);
        dbg('job.comic.done', { assigned: assigned.size, comics: shots.filter((s) => isComicShot(s)).length });
      } catch (err) {
        if (llmController.signal.aborted) return;
        dbg('job.comic.fail', { message: String((err as Error)?.message || err) }, 'warn');
      } finally {
        comicFinished = true;
        releaseComic();
      }
    };
    if (normalizeComicSchedule(card.comic_schedule) === 'wait_taggers') {
      await runComicLayout();
    } else {
      void runComicLayout();
    }

    if (await cancelJobIfStale(jobId, 'superseded before generate')) return;
    const pendingMessageIndex =
      request.message_index != null ? toInt(request.message_index, -1) : -1;
    const pendingInline: PendingInlineRow[] = [];
    const nai = getConfig().nai;
    shots.forEach((shot, i) => {
      const requestedLine = Math.floor(Number((shot as { line?: unknown }).line));
      const line = Number.isFinite(requestedLine) && requestedLine >= 1 ? requestedLine : Number.MAX_SAFE_INTEGER;
      const canvas = canvasDimsForShot(
        shot.aspect,
        nai,
        Boolean(card.auto_aspect),
        isComicShot(shot),
      );
      pendingInline.push({
        shot_index: i,
        line,
        aspect: resolveShotAspect(shot.aspect),
        width: canvas.width,
        height: canvas.height,
        ...(isComicShot(shot) ? { kind: 'comic' as const } : {}),
      });
    });
    if(persistChatImagesOn()) {
      // Tagging does not change layout. Begin holding only for the atomic token swap.
      durableSpinners=await enqueueJobSpinners();
    }
    async function enqueueJobSpinners() { return writeJobSpinners({...jobChatTarget(request),jobId,stripExisting:Boolean(request.force),shots:pendingInline}); }
    await setJob(
      jobId,
      'generating',
      progressPayload({
        shot_count: shots.length,
        shot_index: 0,
        shot_done: 0,
        progress: 0,
        phase: 'generating',
        message: `이미지 1/${shots.length} 생성 준비`,
        pending_inline: pendingInline,
        pending_message_index: pendingMessageIndex,
      }),
    );

    const cards: Array<Record<string, unknown> | undefined> = new Array(shots.length);
    const wantAnchor = Boolean(card.llm_anchor_percent);
    // After unzip, reveal (publish + spinner→image) starts immediately and in
    // parallel across shots — do not serialize behind an earlier shot's idb.
    // Next NAI still overlaps those reveals. Drain before done/cancel/discard.
    const shotSaveTasks: Promise<void>[] = [];
    shotSaveFailed = null;
    const drainSaves = async (): Promise<void> => {
      pendingShotSave = Promise.allSettled(shotSaveTasks).then(results => {
        const failed = results.find(result => result.status === 'rejected');
        if (failed?.status === 'rejected') throw failed.reason;
      });
      await pendingShotSave;
    };
    const cardsDone = (): number => cards.reduce((n, c) => n + (c ? 1 : 0), 0);

    const naiTokens = allUniqueNaiTokens(getConfig().nai);
    const workerTokens = naiTokens.length ? naiTokens : [''];
    const runShot = async (idx: number, workerToken: string): Promise<void> => {
      if (shotSaveFailed) throw shotSaveFailed;
      // Prior saves must finish before discard so publishedIds is complete.
      if (!isJobCurrent(jobId)) {
        await drainSaves();
        if (await cancelJobIfStale(jobId, `superseded before shot ${idx + 1}`)) return;
      }
      const shot = shots[idx];
      if (isComicShot(shot) && !shot.comic_page) return;
      const built = isComicShot(shot)
        ? await buildComicGenerationForShot({ shot, roster, sessionId })
        : await buildGenerationForShot({ shot, roster, sessionId });
      let { main, neg, captions, meta, route, use_coords, cfg } = built;
      const cardId = uuid();
      const now = Date.now() / 1000;
      // Resolve hash at reveal time (below) so mid-job retarget/sibling rebind is fresh.
      // The LLM's anchor is always stored when present; the setting only affects
      // how it is used at display time.
      let yPercent = shotAnchorPercent(shot);
      // With anchoring on but no LLM value, fall back to an equal band start so
      // the sticky-pin logic still has a threshold to compare against.
      if (yPercent == null && wantAnchor) {
        yPercent = Math.round((idx / Math.max(1, shots.length)) * 10000) / 100;
      }

      dbg('job.shot.prepare', {
        shot: idx,
        card_id: cardId,
        model: route.model,
        family: route.family,
        complexity: cleanText(shot.complexity, 20),
        nai5_first: cardFlagOn(card.nai5_first, false),
        nai5_only: cardFlagOn(card.nai5_only, false),
        nai4_fallback: cardFlagOn(card.nai4_fallback, false),
        nai_model: cleanText(getConfig().nai?.model, 80),
        prompt_len: String(main || '').length,
        captions: (captions || []).length,
      });
      await setJob(
        jobId,
        'generating',
        progressPayload({
          shot_count: shots.length,
          shot_index: idx,
          shot_done: cardsDone(),
          progress: Math.round((idx / Math.max(1, shots.length)) * 1000) / 10,
          phase: 'generating',
          message: `NovelAI 요청 중 ${idx + 1}/${shots.length}… [${getFocusStage()}]`,
          pending_inline: pendingInline,
        pending_message_index: pendingMessageIndex,
        }),
      );

      let hbTicks = 0;
      const hb = setInterval(() => {
        hbTicks += HEARTBEAT_MS / 1000;
        const lastByteAt = getNaiLastByteAt();
        if (
          getNaiInflight() <= 1 &&
          hasNaiBodyControl() &&
          getNaiBodyBytesReceived() >= NAI_MIN_BODY_BYTES &&
          lastByteAt &&
          Date.now() - lastByteAt >= NAI_IDLE_FINISH_MS
        ) {
          forceFinishNaiBody('heartbeat-idle');
        }
        const kb = getNaiBodyBytesReceived() || getNaiBodyBytesExpected();
        setJob(
          jobId,
          'generating',
          progressPayload({
            shot_count: shots.length,
            shot_index: idx,
            shot_done: cardsDone(),
            progress: Math.round((idx / Math.max(1, shots.length)) * 1000) / 10,
            phase: 'generating',
            message: `NovelAI 대기 ${idx + 1}/${shots.length} (${hbTicks}s) · ${getFocusStage()}${
              kb ? ` ${Math.round(kb / 1024)}KB` : ''
            }`,
            pending_inline: pendingInline,
        pending_message_index: pendingMessageIndex,
          }),
        ).catch(() => {});
      }, HEARTBEAT_MS);

      let raw: ArrayBuffer | undefined;
      let recipe: import('../providers/nai/payload').T2iRequest | undefined;
      let seed = 0;
      try {
        // Not cancelled mid-flight on purpose: the image is already being paid
        // for, so let it land and discard afterwards if the job went stale.
        const uniqueTokens = (list: string[]): string[] =>
          list.map((t) => cleanText(t)).filter((t, i, arr) => t && arr.indexOf(t) === i);
        const tryKeys = imageGenTokens(
          imageBackendKind(getConfig().nai),
          [workerToken, ...tokensForFamily(getConfig().nai, route.family)],
        );
        let lastErr: unknown;
        let sawQuota = false;
        const runGenerate = (token: string) => generateImage(
          {
            main,
            neg,
            captions,
            characters: meta.characters,
            token,
            model: route.model,
            preset: route.preset,
            use_coords,
            cfg,
          },
          shot.aspect,
          { useShotAspect: isComicShot(shot) },
        );
        for (const token of tryKeys) {
          try {
            ({ bytes: raw, seed, recipe } = await runGenerate(token));
            lastErr = null;
            break;
          } catch (err) {
            lastErr = err;
            if (isNaiQuotaError(err)) sawQuota = true;
            if (!isNaiRetryableKeyError(err)) throw err;
          }
        }
        const canFallback = cardFlagOn(card.nai4_fallback, false)
          && route.family === 'v5'
          && !isComicShot(shot)
          && sawQuota;
        if (lastErr && canFallback) {
          dbg('job.shot.nai4_fallback', {
            shot: idx,
            from: route.model,
            to: modelForFamily(getConfig().nai, 'v4'),
            message: String((lastErr as Error)?.message || lastErr),
          }, 'warn');
          const v4Route: ShotNaiRoute = {
            family: 'v4',
            model: modelForFamily(getConfig().nai, 'v4'),
            preset: pickPresetForFamily(card, 'v4'),
            useV5Natural: false,
            useSpeech: false,
          };
          const rebuilt = await buildGenerationForShot({ shot, roster, sessionId, route: v4Route });
          main = rebuilt.main;
          neg = rebuilt.neg;
          captions = rebuilt.captions;
          meta = rebuilt.meta;
          route = rebuilt.route;
          use_coords = rebuilt.use_coords;
          const v4Keys = uniqueTokens([
            workerToken,
            ...tokensForFamily(getConfig().nai, 'v4'),
          ]);
          lastErr = null;
          for (const token of v4Keys) {
            try {
              ({ bytes: raw, seed, recipe } = await runGenerate(token));
              lastErr = null;
              break;
            } catch (err) {
              lastErr = err;
              if (!isNaiRetryableKeyError(err)) throw err;
            }
          }
        }
        if (lastErr) throw lastErr;
        if (!raw) {
          throw new Error(
            imageBackendKind(getConfig().nai) === 'comfy'
              ? 'ComfyUI 생성 결과가 비어 있습니다.'
              : 'NAI api_key가 설정되지 않았습니다.',
          );
        }
      } finally {
        clearInterval(hb);
      }
      dbg('job.shot.nai_done', { shot: idx, bytes: raw?.byteLength || 0, seed });

      // Supersession: drop without saving. User soft-stop: save this paid shot, then exit.
      {
        const metaAfterNai = jobRunMeta.get(jobId);
        if (!isJobCurrent(jobId) && !metaAfterNai?.userStop) {
          await drainSaves();
          if (await cancelJobIfStale(jobId, `superseded after shot ${idx + 1} nai`)) return;
        }
      }

      // Reveal as soon as PNG bytes exist — do not wait on another shot's persist.
      // Next loop iteration may already be on NovelAI while this runs.
      const saveP = (async () => {
        await setJob(
          jobId,
          'generating',
          progressPayload({
            shot_count: shots.length,
            shot_index: idx,
            shot_done: cardsDone(),
            progress: Math.round(((idx + 0.5) / Math.max(1, shots.length)) * 1000) / 10,
            phase: 'generating',
            message: `이미지 반영 중 ${idx + 1}/${shots.length}… [${getFocusStage()}]`,
            pending_inline: pendingInline,
            pending_message_index: pendingMessageIndex,
          }),
        );
        const inherited = await resolveJobContentHash(jobId, cleanText(request.content_hash || ''));
        const contentHash = inherited.contentHash;
        const assistantPreview =
          inherited.assistantPreview || cleanText(request.assistant_text || '', ASSISTANT_PREVIEW_LIMIT);
        const location = buildImageLocation({
          imageId: cardId,
          sessionId,
          request,
          shotIndex: idx,
          paragraph: shot.paragraph,
          yPercent,
          line: (() => {
            const n = Math.floor(Number((shot as { line?: unknown }).line));
            return Number.isFinite(n) && n >= 1 ? n : null;
          })(),
          contentHash,
          assistantPreview,
        });
        // One cached data URL paints the reserved slot until the final bake.
        // Cast ids ride the location into the asset filename (memory-only).
        const castWants = new Map<string, Array<{ id?: unknown; name?: unknown }>>();
        for (const c of meta.characters || []) {
          const s = String((c as { scope?: unknown }).scope || sessionId);
          const list = castWants.get(s) ?? [];
          list.push({ id: (c as { id?: unknown }).id, name: (c as { name?: unknown }).name });
          castWants.set(s, list);
        }
        const castIds: string[] = [];
        for (const [castScope, wants] of castWants) {
          const issued = await ensureCastIds(castScope, wants);
          for (const w of wants) {
            const got = issued[String(w.id || '')];
            if (got && !castIds.includes(got)) castIds.push(got);
          }
        }
        if (castIds.length) location.cast_ids = castIds;
        await publishImage(cardId, raw, location, {
          warmUrl: true,
          recipe,
          characters:(meta.characters || []).map(c=>({scope:String(c.scope || ''),id:String(c.id || ''),name:String(c.name || '')})),
          generatedAt:Date.now(),
          ...(durableSpinners ? { onPreview: async (url: string) => {
            if (!isJobCurrent(jobId)) return;
            const preview = Reflect.get(globalThis, '__OMNI_SPINNER_PREVIEW__');
            if (typeof preview !== 'function') {
              dbg('job.preview.unavailable', { shot: idx }, 'warn');
              return;
            }
            try { await preview({jobId, shot:idx, cardId, characterId:request.character_id, chatId:request.chat_id, messageIndex:request.message_index, url}); }
            catch { dbg('job.preview.fail', {shot:idx}, 'warn'); }
          }} : {}),
        });
        const runMeta = jobRunMeta.get(jobId);
        if (runMeta) runMeta.publishedIds.push(cardId);
        const canvas = canvasDimsForShot(
          shot.aspect,
          nai,
          Boolean(card.auto_aspect),
          isComicShot(shot),
        );
        const canvasAspect = aspectFromCanvas(canvas.width, canvas.height);
        const cardMeta = {
          ...cardMetaFromLocation(meta, location, raw?.byteLength || 0),
          assistant_preview: assistantPreview,
          aspect: canvasAspect,
          width: canvas.width,
          height: canvas.height,
          kind: isComicShot(shot) ? 'comic' : 'illustration',
          characters: slimCardCharacters(meta.characters || []),
          ...(cleanText(shot.complexity, 20) ? { complexity: cleanText(shot.complexity, 20) } : {}),
        };
        cards[idx] = {
          id: cardId,
          shot_index: idx,
          paragraph: location.paragraph,
          y_percent: location.y_percent,
          line: location.line,
          message_index: location.message_index ?? -1,
          message_role: location.message_role || '',
          content_hash: location.content_hash || '',
          ...(location.host_message_id ? { host_message_id: location.host_message_id } : {}),
          character_id: location.character_id || '',
          chat_id: location.chat_id || '',
          character_name: location.character_name || '',
          chat_name: location.chat_name || '',
          char_index: location.char_index ?? -1,
          chat_index: location.chat_index ?? -1,
          assistant_preview: assistantPreview,
          aspect: canvasAspect,
          width: canvas.width,
          height: canvas.height,
          main_prompt: main,
          negative_prompt: neg,
          characters: slimCardCharacters(meta.characters || []),
          seed,
          storage: 'indexeddb',
          png_bytes: raw?.byteLength || 0,
        };
        const done = cardsDone();
        dbg('job.shot.revealed', { shot: idx, card_id: cardId, has_url: Boolean(resolveImageUrl(cardId)) });
        await idbPut('cards', {
          id: cardId,
          job_id: jobId,
          session_id: sessionId,
          shot_index: idx,
          paragraph: Number(shot.paragraph || 0),
          main_prompt: '',
          negative_prompt: '',
          // Cast / prompt / hash / preview are not stored: no gallery, no
          // chips, no legacy rebind. The response object above keeps the live
          // values for this session; only the persisted row is stripped.
          characters_json: '[]',
          seed,
          meta_json: JSON.stringify(stripStoredCardMeta(cardMeta)),
          created_at: now,
        });
        if(durableSpinners) {
          completedSpinnerCards.set(idx,cardId);
        }
        successfulOutfitShots.set(idx, shot);
        if (isJobCurrent(jobId)) await persistSessionOutfits(noteSessionId, [...successfulOutfitShots].sort((a,b)=>a[0]-b[0]).map(([,value])=>value), roster, outfitRevision);
        dbg('job.shot.saved', { shot: idx, card_id: cardId });
        await setJob(
          jobId,
          'generating',
          progressPayload({
            shot_count: shots.length,
            shot_index: idx,
            shot_done: done,
            progress: Math.round((done / Math.max(1, shots.length)) * 1000) / 10,
            phase: 'generating',
            message: `이미지 ${idx + 1}/${shots.length} 완료`,
            cards_so_far: done,
            pending_inline: pendingInline,
            pending_message_index: pendingMessageIndex,
          }),
        );
      })().catch((err) => {
        shotSaveFailed = err;
        throw err;
      });
      shotSaveTasks.push(saveP);
      pendingShotSave = Promise.allSettled(shotSaveTasks).then(results => {
        const failed = results.find(result => result.status === 'rejected');
        if (failed?.status === 'rejected') throw failed.reason;
      });

      // Soft-stop / supersession after queueing this paid save: flush then exit.
      if (!isJobCurrent(jobId)) {
        await drainSaves();
        if (await cancelJobIfStale(jobId, `superseded after shot ${idx + 1} save`)) return;
      }
    };
    const workers = await Promise.allSettled(workerTokens.map(async (token) => {
      for (;;) {
        if (shotSaveFailed || !isJobCurrent(jobId)) return;
        const idx = pickNextReadyShot({ order, done, inflight, ready });
        if (idx == null) {
          if (!comicFinished) {
            await Promise.race([
              comicGate,
              new Promise((resolve) => setTimeout(resolve, 80)),
            ]);
            continue;
          }
          return;
        }
        inflight.add(idx);
        ready.delete(idx);
        try {
          await runShot(idx, token);
          done.add(idx);
        } finally {
          inflight.delete(idx);
        }
      }
    }));
    await drainSaves();
    const failedWorker = workers.find((worker) => worker.status === 'rejected');
    if (failedWorker?.status === 'rejected') throw failedWorker.reason;
    if (shotSaveFailed) throw shotSaveFailed;
    if (await cancelJobIfStale(jobId, 'superseded before done')) return;
    const finalCards = cards.filter((c): c is Record<string, unknown> => Boolean(c));
    const result = {
      cards: finalCards,
      message_index: request.message_index != null ? Number(request.message_index) : -1,
      shot_count: shots.length,
      shot_done: shots.length,
      progress: 100,
      phase: 'done',
      message: `이미지 ${shots.length}/${shots.length} 완료`,
      // Done = no spinners. Leaving pending_inline here kept circles on finished bubbles.
    };
    // Last shot needs one generating poll tick, same as shots 1..N-1, before
    // done. 2.5.8 skips painting on done on purpose.
    if (!durableSpinners) await waitForLastGeneratingPoll(jobId);
    if(durableSpinners) await finishCompletedSpinners();
    if (durableSpinners && bakedSpinnerShots.size) speakAfterBake(request);
    if (persistChatImagesOn() && !durableSpinners) {
      try {
        await enqueueBakeWrite(async () => {
          await bakeCardsIntoChatMessage({
            ...jobChatTarget(request),
            cards: finalCards,
          });
        });
        speakAfterBake(request);
      } catch (err) {
        dbg('job.bake.fail', { message: String((err as Error)?.message || err) }, 'warn');
      }
    }
    await setJob(jobId, 'done', result);
    // The run succeeded, so its cards are the user's now and must survive any
    // later supersession of this job id.
    const doneMeta = jobRunMeta.get(jobId);
    if (doneMeta) doneMeta.publishedIds = [];
    jobSpan.end({ message: 'done', cards: finalCards.length });
  } catch (exc) {
    try {
      await pendingShotSave;
    } catch {
      /* prefer the primary error below */
    }
    if (llmController.signal.aborted && await cancelJobIfStale(jobId, '사용자 중단')) return;
    jobSpan.fail(exc);
    const err = exc as Error;
    const errText = `${err?.message || exc}\n${err?.stack || ''}`.slice(-1500);
    await setJob(
      jobId,
      'error',
      {
        phase: 'error',
        message: String(err?.message || exc).slice(0, 240),
        debug_stage: getLastStage(),
        debug_tail: eventsForJob(jobId, 12),
      },
      errText,
    );
  } finally {
    llmController.abort();
    jobLlmControllers.delete(jobId);
    await finishCompletedSpinners().catch(err => dbg('job.partial.bake.fail', { message: String(err) }, 'warn'));
    // Unfinished frames remain retryable; successful frames are permanent.
    const endScroll=Reflect.get(globalThis,"__OMNI_END_SCROLL__");
    if(typeof endScroll==="function") try {await endScroll(jobId);} catch(error) {dbg("scroll.end.fail",{message:String(error)},"warn");}
    const clearPreview=Reflect.get(globalThis,"__OMNI_CLEAR_SPINNER_PREVIEW__");
    if(typeof clearPreview==='function') await clearPreview(jobId);
    setJobContext(prevCtx);
  }
}
