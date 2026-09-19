/**
 * NovelAI HTTP transport.
 *
 * The body reader is the most fragile code in the plugin. Risu's `nativeFetch`
 * proxies responses across an iframe boundary, and the resulting object is
 * sometimes a real `Response`, sometimes `{ ok, data }`, sometimes already raw
 * bytes — and when it *is* a stream, `done: true` frequently never arrives. Every
 * branch below exists because one of those shapes was observed in the wild.
 */
import { API_URL } from '../../core/constants.ts';
import { dbg, dbgSpan, getFocusStage } from '../../core/debug.ts';
import { hostHas, risuHost } from '../../core/host.ts';
import { base64ToBytes, concatChunks, u8ToArrayBuffer } from '../../core/util/bytes.ts';
import { zipHasEocd } from '../../core/util/zip.ts';

/** The union of response shapes `nativeFetch`, `globalFetch` and DOM `fetch` return. */
export interface FetchLikeResponse {
  readonly status?: number;
  readonly ok?: boolean;
  readonly headers?: { get?(name: string): string | null };
  readonly body?: { getReader?(): ReadableStreamDefaultReader<Uint8Array> } | null;
  /** Present on the `globalFetch`-like `{ ok, data }` shape. */
  readonly data?: unknown;
  arrayBuffer?(): Promise<ArrayBuffer>;
  bytes?(): Promise<Uint8Array>;
  text?(): Promise<string>;
  json?(): Promise<unknown>;
}

export interface NetworkFetchOptions extends RequestInit {
  /** Risu-specific routing hint; dropped when unset so the host uses its default. */
  networkRoute?: unknown;
  /** Risu-specific per-request timeout honoured by `nativeFetch`. */
  requestTimeoutMs?: number;
}

export interface ReadBytesOptions {
  /** Absolute wall-clock deadline; takes precedence over `timeoutMs`. */
  deadline?: number;
  timeoutMs?: number;
  signal?: AbortSignal | null;
  onProgress?: (received: number, contentLength: number | null) => void;
  /** Idle gap after which a partially-read body counts as complete. */
  idleMs?: number;
}

export interface NaiPostOptions {
  timeoutMs?: number;
  signal?: AbortSignal | null;
}

interface NaiBodyControl {
  forceFinish(reason?: string): void;
}

interface ReadPacket {
  done?: boolean;
  value?: Uint8Array | ArrayBuffer | undefined;
  __forced?: boolean;
  __idle?: boolean;
  __length?: boolean;
}

/** Byte-shaped responses carried as a typed-array-like object rather than a stream. */
interface BufferViewLike {
  buffer?: unknown;
  byteOffset?: number;
  byteLength?: number;
}

// ── in-flight body state ──────────────────────────────────────────────────
// Module-level on purpose: the job heartbeat polls progress and force-finishes a
// stalled read, and the storage layer suspends disk flushes while a read is live.
let naiBodyBytesReceived = 0;
let naiBodyBytesExpected = 0;
let naiLastByteAt = 0;
let naiBodyControl: NaiBodyControl | null = null;
let pauseDiskPersist = false;
let naiInflight = 0;

/** How many NovelAI generate POSTs are in flight (parallel keys). */
export const getNaiInflight = (): number => naiInflight;

/** Bytes of the in-flight NAI response body received so far. */
export const getNaiBodyBytesReceived = (): number => naiBodyBytesReceived;

/** Content-Length announced for the in-flight NAI response body, 0 if unknown. */
export const getNaiBodyBytesExpected = (): number => naiBodyBytesExpected;

/** `Date.now()` of the last received body chunk, 0 if none has arrived. */
export const getNaiLastByteAt = (): number => naiLastByteAt;

/** True while a NAI body read is active and can be force-finished. */
export const hasNaiBodyControl = (): boolean => naiBodyControl !== null;

/** Ends the in-flight NAI body read early; false when no read is active. */
export function forceFinishNaiBody(reason = 'force'): boolean {
  if (!naiBodyControl) return false;
  naiBodyControl.forceFinish(reason);
  return true;
}

/** True while a NAI body read is in flight — the storage layer skips disk flushes. */
export const isDiskPersistPaused = (): boolean => pauseDiskPersist;

/** Suspends or resumes disk persistence around a NAI body read. */
export const setDiskPersistPaused = (value: boolean): void => {
  pauseDiskPersist = value;
};

/** Fetches via Risu's `nativeFetch` when present, otherwise the global `fetch`. */
export async function networkFetch(url: string, options: NetworkFetchOptions = {}): Promise<FetchLikeResponse> {
  const native = risuHost()?.nativeFetch;
  const nf = (native || globalThis.fetch) as
    | ((url: string, options?: NetworkFetchOptions) => Promise<FetchLikeResponse>)
    | undefined;
  const via = native ? 'nativeFetch' : 'fetch';
  if (typeof nf !== 'function') throw new Error('fetch를 사용할 수 없습니다');
  const opts: NetworkFetchOptions = { ...options };
  if (opts.networkRoute == null) delete opts.networkRoute;
  const span = dbgSpan('net.fetch');
  dbg('net.fetch.start', { message: via, url: String(url).slice(0, 120), has_signal: Boolean(opts.signal) });
  try {
    const resp = await nf(url, opts);
    const status = Number(resp?.status || (resp?.ok === false ? 0 : 200));
    span.end({ message: via, status, url: String(url).slice(0, 80) });
    return resp;
  } catch (err) {
    span.fail(err, { message: via, url: String(url).slice(0, 80) });
    throw err;
  }
}

/** Reads a response body to raw bytes, tolerating every shape Risu can hand back. */
export async function readResponseBytes(resp: unknown, opts: ReadBytesOptions = {}): Promise<ArrayBuffer> {
  if (!resp) throw new Error('빈 응답');
  const deadline = Number(opts.deadline || Date.now() + Number(opts.timeoutMs || 90000));
  const signal = opts.signal || null;
  const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;
  const idleMs = Number(opts.idleMs || 2500);

  const throwIfTimedOut = (got = 0): void => {
    if (signal?.aborted) throw new Error(`NAI 본문 읽기 중단 (abort, ${got}B)`);
    if (Date.now() >= deadline) throw new Error(`NAI 본문 읽기 타임아웃 (${got}B received)`);
  };

  // Already-bytes shapes (risuFetch rawResponse / some polyfills)
  if (resp instanceof ArrayBuffer) return resp;
  if (resp instanceof Uint8Array) return u8ToArrayBuffer(resp);
  if (typeof resp === 'string') {
    const s = resp.replace(/\s+/g, '');
    if (s.length > 64 && /^[A-Za-z0-9+/=]+$/.test(s)) {
      dbg('nai.read_bytes', { message: 'string base64 body', bytes: s.length, focus: true });
      return u8ToArrayBuffer(base64ToBytes(s));
    }
  }
  const view = resp as BufferViewLike;
  if (view.buffer instanceof ArrayBuffer && typeof view.byteLength === 'number') {
    return view.buffer.slice(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength);
  }
  const r = resp as FetchLikeResponse;
  if (resp && typeof resp === 'object' && 'data' in resp && !r.arrayBuffer && !r.body) {
    return readResponseBytes(r.data, opts);
  }

  let contentLen: number | null = null;
  try {
    const h = r.headers;
    const raw = h?.get?.('content-length') || h?.get?.('Content-Length') || null;
    if (raw) contentLen = Number(raw);
  } catch { /* headers may be a plain object with no get() */ }
  // Expected size for UI (not counted as received until chunks arrive).
  if (contentLen != null && contentLen > 0) naiBodyBytesExpected = contentLen;
  dbg('nai.read_bytes.start', {
    message: 'begin body',
    content_length: contentLen,
    has_arrayBuffer: typeof r.arrayBuffer === 'function',
    has_body_reader: Boolean(r.body && typeof r.body.getReader === 'function'),
    keys: resp && typeof resp === 'object' ? Object.keys(resp).slice(0, 12).join(',') : typeof resp,
    focus: true,
  });

  // Prefer streaming — finish early when Content-Length / ZIP EOCD satisfied (Risu often never sends done).
  if (r.body && typeof r.body.getReader === 'function') {
    const reader = r.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    let lastChunkAt = Date.now();
    let lastLog = Date.now();
    let forceFinish = false;
    let settleRead: ((packet: ReadPacket) => void) | null = null;

    naiBodyControl = {
      forceFinish: (reason = 'force') => {
        forceFinish = true;
        dbg('nai.read_bytes.force', { message: reason, bytes: total || contentLen || 0, focus: true });
        try {
          reader.cancel();
        } catch { /* already closed */ }
        if (settleRead) settleRead({ done: true, value: undefined, __forced: true });
      },
    };

    try {
      for (;;) {
        throwIfTimedOut(total);
        if (forceFinish) break;
        // Idle with enough bytes → treat as complete (done:true often never arrives).
        if (total >= 64 && Date.now() - lastChunkAt >= idleMs) {
          dbg('nai.read_bytes.idle_complete', { message: `${idleMs}ms idle`, bytes: total, focus: true });
          break;
        }
        if (contentLen != null && contentLen > 0 && total >= contentLen) {
          dbg('nai.read_bytes.length_complete', { bytes: total, content_length: contentLen, focus: true });
          break;
        }

        const packet = await new Promise<ReadPacket>((resolve, reject) => {
          let settled = false;
          const finish = (v: ReadPacket | null, err: unknown): void => {
            if (settled) return;
            settled = true;
            clearInterval(iv);
            settleRead = null;
            if (err) reject(err);
            else resolve(v as ReadPacket);
          };
          settleRead = (v: ReadPacket) => finish(v, null);
          const iv = setInterval(() => {
            if (settled) return;
            if (forceFinish) return finish({ done: true, value: undefined, __forced: true }, null);
            if (total >= 64 && Date.now() - lastChunkAt >= idleMs) {
              return finish({ done: true, value: undefined, __idle: true }, null);
            }
            if (contentLen != null && contentLen > 0 && total >= contentLen) {
              return finish({ done: true, value: undefined, __length: true }, null);
            }
            if (signal?.aborted || Date.now() >= deadline) {
              reader.cancel().catch(() => {});
              return finish(null, new Error(`NAI 본문 읽기 타임아웃 (${total}B received)`));
            }
          }, 200);
          reader.read().then(
            (result) => finish(result as ReadPacket, null),
            (err: unknown) => finish(null, err),
          );
        });

        if (packet?.__forced || packet?.__idle || packet?.__length) break;
        const { done, value } = packet;
        if (done) break;
        if (!value) continue;
        const part = value instanceof Uint8Array ? value : new Uint8Array(value);
        chunks.push(part);
        total += part.length;
        lastChunkAt = Date.now();
        naiLastByteAt = lastChunkAt;
        naiBodyBytesReceived = total;
        if (onProgress) onProgress(total, contentLen);
        if (Date.now() - lastLog >= 2000) {
          lastLog = Date.now();
          dbg('nai.read_bytes.progress', {
            message: `${Math.round(total / 1024)}KB`,
            bytes: total,
            content_length: contentLen,
            focus: true,
          });
        }
        // Early exit only after brief idle — EOCD alone can false-positive mid-stream.
        if (zipHasEocd(concatChunks(chunks, total)) && Date.now() - lastChunkAt >= 600) {
          dbg('nai.read_bytes.zip_eocd', { bytes: total, focus: true });
          break;
        }
        if (contentLen != null && contentLen > 0 && total >= contentLen) break;
      }
    } catch (err) {
      // If we already have a full ZIP, prefer success over throw.
      if (total >= 64) {
        const maybe = concatChunks(chunks, total);
        if (zipHasEocd(maybe) || (contentLen != null && contentLen > 0 && total >= contentLen * 0.98)) {
          dbg('nai.read_bytes.recover', { message: String((err as Error)?.message || err), bytes: total, focus: true }, 'warn');
          naiBodyControl = null;
          return u8ToArrayBuffer(maybe);
        }
      }
      try {
        await reader.cancel();
      } catch { /* already closed */ }
      naiBodyControl = null;
      throw err;
    }
    naiBodyControl = null;
    if (!total) throw new Error('NAI 본문이 비어 있습니다');
    const out = concatChunks(chunks, total);
    dbg('nai.read_bytes.done', { bytes: total, focus: true });
    return u8ToArrayBuffer(out);
  }

  const readArrayBuffer = r.arrayBuffer;
  if (typeof readArrayBuffer === 'function') {
    dbg('nai.read_bytes', { message: 'fallback arrayBuffer() — no body stream', focus: true });
    let settled = false;
    let resolveBuf!: (value: ArrayBuffer) => void;
    let rejectBuf!: (reason: unknown) => void;
    const bufPromise = new Promise<ArrayBuffer>((resolve, reject) => {
      resolveBuf = resolve;
      rejectBuf = reject;
    });
    naiBodyControl = {
      forceFinish: (reason = 'force') => {
        // Cannot extract partial arrayBuffer — abort so job errors instead of hanging forever.
        dbg('nai.read_bytes.force', { message: `${reason} (arrayBuffer)`, content_length: contentLen, focus: true }, 'warn');
        if (!settled) {
          settled = true;
          clearInterval(iv);
          rejectBuf(new Error(`NAI arrayBuffer 강제중단 (${reason}, content-length=${contentLen})`));
        }
      },
    };
    const iv = setInterval(() => {
      if (settled) return;
      if (signal?.aborted || Date.now() >= deadline) {
        settled = true;
        clearInterval(iv);
        naiBodyControl = null;
        rejectBuf(
          new Error(
            `NAI arrayBuffer 타임아웃 (content-length=${contentLen}). 본문 ~${contentLen ? Math.round(contentLen / 1024) : '?'}KB를 플러그인이 받지 못했습니다.`,
          ),
        );
      } else {
        dbg('nai.read_bytes.wait', {
          message: `arrayBuffer pending · expect ${contentLen ? Math.round(contentLen / 1024) : '?'}KB`,
          content_length: contentLen,
          focus: true,
        }, 'warn');
      }
    }, 3000);
    readArrayBuffer.call(r)
      .then((b) => {
        if (settled) return;
        settled = true;
        clearInterval(iv);
        naiBodyControl = null;
        resolveBuf(b);
      })
      .catch((err: unknown) => {
        if (settled) return;
        settled = true;
        clearInterval(iv);
        naiBodyControl = null;
        rejectBuf(err);
      });
    const buf = await bufPromise;
    if (buf && buf.byteLength) {
      naiBodyBytesReceived = buf.byteLength;
      dbg('nai.read_bytes.done', { bytes: buf.byteLength, focus: true });
      return buf;
    }
  }
  if (typeof r.bytes === 'function') {
    const u8 = await r.bytes();
    if (u8?.length) return u8ToArrayBuffer(u8);
  }
  if (typeof r.text === 'function') {
    const text = await r.text();
    if (/^[A-Za-z0-9+/=\s]+$/.test(text) && text.replace(/\s+/g, '').length > 64) {
      try {
        return u8ToArrayBuffer(base64ToBytes(text.replace(/\s+/g, '')));
      } catch { /* not base64 after all */ }
    }
    throw new Error(`바이너리 본문을 읽지 못함 (text head=${String(text).slice(0, 120)})`);
  }
  throw new Error('바이너리 본문을 읽지 못함');
}

/** POSTs a JSON payload to NAI and returns the raw response bytes. */
export async function naiPost(
  token: string,
  payload: Record<string, unknown>,
  apiUrl: string,
  opts: NaiPostOptions = {},
): Promise<ArrayBuffer> {
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const timeoutMs = Number(opts.timeoutMs || 75000);
  const externalSignal = opts.signal || null;
  const bodyStr = JSON.stringify(payload);
  dbg('nai.payload', {
    message: `body ${Math.round(bodyStr.length / 1024)}KB`,
    bytes: bodyStr.length,
    model: payload?.['model'],
    timeout_ms: timeoutMs,
    url: String(apiUrl || API_URL).slice(0, 100),
    has_nativeFetch: hostHas('nativeFetch'),
  });
  if (bodyStr.length > 2_500_000) {
    dbg('nai.payload', { message: 'too large', bytes: bodyStr.length }, 'error');
    throw new Error(`NAI 페이로드가 너무 큼 (${Math.round(bodyStr.length / 1024)}KB). 참조 이미지/프롬프트를 줄이세요.`);
  }

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const onExternalAbort = (): void => {
    dbg('nai.abort', { message: 'external signal' }, 'warn');
    controller?.abort();
  };
  if (externalSignal) {
    if (externalSignal.aborted) throw new Error('NAI 요청이 취소되었습니다.');
    externalSignal.addEventListener('abort', onExternalAbort, { once: true });
  }

  // Wall-clock abort — plugin iframe setTimeout is heavily throttled when hidden.
  const started = Date.now();
  naiBodyBytesReceived = 0;
  naiBodyBytesExpected = 0;
  naiLastByteAt = 0;
  naiInflight += 1;
  pauseDiskPersist = true;
  const watchdog = setInterval(() => {
    const elapsed = Date.now() - started;
    if (elapsed >= timeoutMs) {
      dbg('nai.watchdog', { message: `abort after ${elapsed}ms · body=${naiBodyBytesReceived}B`, ms: elapsed, bytes: naiBodyBytesReceived }, 'warn');
      controller?.abort();
    } else if (elapsed > 0 && elapsed % 10000 < 1100) {
      dbg('nai.wait', {
        message: `waiting ${Math.round(elapsed / 1000)}s · body=${naiBodyBytesReceived}B · ${getFocusStage()}`,
        ms: elapsed,
        bytes: naiBodyBytesReceived,
        focus: true,
      }, 'warn');
    }
  }, 1000);

  let lastError: string | null = null;
  try {
    try {
      dbg('nai.fetch.start', { message: 'POST generate-image', timeout_ms: timeoutMs, focus: true });
      const resp = await networkFetch(apiUrl || API_URL, {
        method: 'POST',
        headers,
        body: bodyStr,
        signal: controller?.signal,
        requestTimeoutMs: timeoutMs,
      });
      dbg('nai.fetch.returned', { message: 'nativeFetch resolved', ms: Date.now() - started, status: Number(resp?.status || 0), focus: true });

      if (externalSignal?.aborted || controller?.signal?.aborted) {
        dbg('nai.fetch.aborted', { ms: Date.now() - started }, 'error');
        throw new Error(`NAI 타임아웃 (${Math.round(timeoutMs / 1000)}s) — nativeFetch가 응답하지 않습니다. Models에서 NAI Test를 확인하세요.`);
      }

      const readOpts: ReadBytesOptions = {
        signal: controller?.signal,
        deadline: started + timeoutMs,
        onProgress: (got) => {
          naiBodyBytesReceived = got;
        },
      };

      // globalFetch-like shape
      if (resp && typeof resp === 'object' && 'ok' in resp && 'data' in resp && !resp.arrayBuffer) {
        const status = Number(resp.status || (resp.ok ? 200 : 0));
        dbg('nai.resp.shape', { message: 'ok/data shape', status, focus: true });
        if (status === 401) throw new Error('인증 실패 (401). NovelAI API 토큰(pst-...)을 확인하세요.');
        if (status === 429) throw new Error('Rate limited (429). 잠시 후 다시 시도하세요.');
        if (status >= 400) {
          const detail =
            typeof resp.data === 'string'
              ? resp.data
              : resp.data instanceof Uint8Array
                ? new TextDecoder().decode(resp.data.subarray(0, 220))
                : JSON.stringify(resp.data || {}).slice(0, 220);
          throw new Error(`NAI HTTP ${status}: ${detail}`);
        }
        const spanRead = dbgSpan('nai.read_bytes');
        const buf = await readResponseBytes(resp.data, readOpts);
        spanRead.end({ bytes: buf?.byteLength || 0, focus: true });
        if (!buf || buf.byteLength < 32) throw new Error(`NAI 응답이 너무 짧음 (${buf?.byteLength || 0} bytes)`);
        return buf;
      }

      const status = Number(resp?.status || 0);
      dbg('nai.resp.shape', {
        message: 'Response-like',
        status,
        has_arrayBuffer: typeof resp?.arrayBuffer === 'function',
        has_body: Boolean(resp?.body),
        focus: true,
      });
      if (status === 401) throw new Error('인증 실패 (401). NovelAI API 토큰(pst-...)을 확인하세요.');
      if (status === 429) throw new Error('Rate limited (429). 잠시 후 다시 시도하세요.');
      if (status >= 400) {
        let detail = '';
        try {
          detail = await (resp as { text(): Promise<string> }).text();
        } catch { /* body may not be readable as text */ }
        throw new Error(`NAI HTTP ${status}: ${detail.slice(0, 220)}`);
      }
      const spanRead = dbgSpan('nai.read_bytes');
      const buf = await readResponseBytes(resp, readOpts);
      spanRead.end({ bytes: buf?.byteLength || 0, status, focus: true });
      if (!buf || buf.byteLength < 32) throw new Error(`NAI 응답이 너무 짧음 (${buf?.byteLength || 0} bytes)`);
      return buf;
    } catch (err) {
      lastError = String((err as Error)?.message || err);
      dbg('nai.fetch.error', { message: lastError, ms: Date.now() - started, bytes: naiBodyBytesReceived }, 'error');
      if (/abort|timeout|타임아웃|취소|본문 읽기/i.test(lastError)) {
        throw new Error(
          `NAI 타임아웃/본문실패 (${Math.round(timeoutMs / 1000)}s, body=${naiBodyBytesReceived}B). ${lastError.slice(0, 180)}`,
        );
      }
      throw err instanceof Error ? err : new Error(lastError);
    }
  } finally {
    naiInflight = Math.max(0, naiInflight - 1);
    pauseDiskPersist = naiInflight > 0;
    clearInterval(watchdog);
    if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort);
  }
}
