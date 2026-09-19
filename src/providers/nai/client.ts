/** NovelAI generate-image and account endpoints. */
import { ANLAS_URL, USER_DATA_URL, USER_PRIORITY_URL } from '../../core/constants.ts';
import { parseJsonBody, parseNaiQuota, type NaiQuotaParsed } from '../../domain/nai/quota.ts';
import { dbg, dbgSpan } from '../../core/debug.ts';
import { Mutex } from '../../core/util/async.ts';
import { isPngBytes } from '../../core/util/bytes.ts';
import { unzipFirstEntry } from '../../core/util/zip.ts';
import { naiPost, networkFetch, readResponseBytes, type NaiPostOptions } from './http.ts';
import { buildBaseParameters, resolveModel, type T2iRequest } from './payload.ts';

/**
 * NovelAI rejects overlapping generations, so this lane serialises every one we
 * make. It lives here rather than in a caller because it is a property of the
 * upstream API: two callers generate images — the job pipeline and the
 * diagnostics probe — and a lane owned by either would leave the other
 * unserialised, letting a "test generation" collide with the image a user is
 * waiting on.
 *
 * 1.x shared one lock with the ComfyUI lane and stole it after 8s of contention,
 * which is shorter than a normal generation, so under load that lock did nothing.
 * This lane is NovelAI-only and never stolen; `naiPost` carries its own wall-clock
 * watchdog, so a wedged request cannot hold it open.
 */
const naiLanes = new Map<string, Mutex>();

function laneForToken(token: string): Mutex {
  const key = token.trim();
  let lane = naiLanes.get(key);
  if (!lane) {
    lane = new Mutex();
    naiLanes.set(key, lane);
  }
  return lane;
}

export interface T2iResult {
  raw_bytes: ArrayBuffer;
  seed: number;
}

export type AnlasBalance = NaiQuotaParsed;

/**
 * Runs one text-to-image generation and unzips the single image NAI returns.
 *
 * The lane only covers the HTTP round-trip — NovelAI rejects overlapping
 * generations, but unzip is local CPU and must not delay the next request.
 */
export async function generateT2i(
  token: string,
  req: T2iRequest,
  apiUrl: string,
  opts: NaiPostOptions = {},
): Promise<T2iResult> {
  const payload = {
    input: req.prompt,
    model: resolveModel(req.model),
    action: 'generate',
    parameters: buildBaseParameters(req),
  };
  dbg('nai.generate.start', {
    message: payload.model,
    prompt_len: String(req.prompt || '').length,
    chars: (req.characters || []).length,
    has_char_refs: Boolean(req.character_refs?.length),
    has_vibes: Boolean(req.vibes?.length),
  });
  const zipBytes = await laneForToken(token).run(() => naiPost(token, payload, apiUrl, opts));
  const spanUnzip = dbgSpan('nai.unzip');
  try {
    const rawBytes = await unzipFirstEntry(new Uint8Array(zipBytes));
    const isPng = isPngBytes(new Uint8Array(rawBytes));
    spanUnzip.end({ bytes: rawBytes?.byteLength || 0, is_png: isPng, zip_bytes: zipBytes?.byteLength || 0 });
    if (!isPng) dbg('nai.unzip', { message: 'unzipped but not PNG magic', bytes: rawBytes?.byteLength || 0 }, 'warn');
    return { raw_bytes: rawBytes, seed: req.seed || 0 };
  } catch (err) {
    spanUnzip.fail(err, { zip_bytes: zipBytes?.byteLength || 0 });
    throw err;
  }
}

async function fetchNaiJson(token: string, url: string): Promise<unknown> {
  const resp = await networkFetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });
  const rawStatus = Number(resp?.status);
  const status = Number.isFinite(rawStatus) && rawStatus > 0
    ? rawStatus
    : (resp?.ok === false ? 0 : 200);
  if (status === 401) throw new Error('인증 실패 (401). API 토큰을 확인하세요.');
  if (status >= 400) {
    let detail = '';
    try {
      if (typeof resp?.text === 'function') detail = String(await resp.text()).slice(0, 180);
    } catch { /* body may already be consumed */ }
    if (!detail && resp && typeof resp === 'object' && 'data' in resp) {
      detail = String((resp as { data?: unknown }).data ?? '').slice(0, 180);
    }
    throw new Error(`Anlas 조회 실패: HTTP ${status}${detail ? ` · ${detail}` : ''}`);
  }
  const looksLikeAccount = (raw: unknown): boolean => {
    const rec = raw && typeof raw === 'object' && !Array.isArray(raw)
      ? raw as Record<string, unknown>
      : null;
    return Boolean(rec && (rec.trainingStepsLeft || rec.perks || rec.tier != null));
  };
  try {
    if (typeof resp.json === 'function') {
      const viaJson = await resp.json();
      if (looksLikeAccount(viaJson)) return viaJson;
    }
  } catch {
    // nativeFetch Response-likes often throw or return the wrapper
  }
  try {
    if (typeof resp.text === 'function') {
      const viaText = parseJsonBody(await resp.text());
      if (looksLikeAccount(viaText)) return viaText;
    }
  } catch {
    // continue
  }
  try {
    const fromShape = parseJsonBody(resp);
    if (looksLikeAccount(fromShape)) return fromShape;
  } catch {
    // Fall through to bytes — some host shapes have no .json()/.text().
  }
  const bytes = await readResponseBytes(resp, { timeoutMs: 20000 });
  return parseJsonBody(bytes);
}

/** Subscription Anlas only — used by the model-tab token check. */
export async function getAnlas(token: string): Promise<AnlasBalance> {
  return parseNaiQuota(await fetchNaiJson(token, ANLAS_URL));
}

/** Anlas plus `/user/data` extras (V5 usage-like fields) for the quota tab. */
export async function getNaiQuotaDetail(token: string): Promise<AnlasBalance> {
  const subscription = await fetchNaiJson(token, ANLAS_URL);
  let accountData: unknown;
  try {
    accountData = await fetchNaiJson(token, USER_DATA_URL);
  } catch {
    accountData = undefined;
  }
  if (!accountData) {
    try {
      accountData = { priority: await fetchNaiJson(token, USER_PRIORITY_URL) };
    } catch {
      accountData = undefined;
    }
  }
  return parseNaiQuota(subscription, accountData);
}
