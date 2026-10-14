import { risuHost } from '../../core/host';
import { base64ToBytes } from '../../core/util/bytes';

export interface TtsResponse {
  ok?: boolean;
  status?: number;
  data?: unknown;
  json?: () => Promise<unknown>;
  arrayBuffer?: () => Promise<ArrayBuffer>;
  headers?: { get: (key: string) => string | null };
  finish?: () => void;
}
/** Fish's own reading of the common failures, so the toast says what to fix. */
function ttsStatusHint(status: number | undefined): string {
  const hints: Record<number, string> = {
    401: ' · API 키를 확인해 주세요',
    402: ' · Fish API 잔액이 없습니다. 웹 구독(Plus 등)과 별개로 API 크레딧을 충전해야 합니다. 무료로 쓰려면 모델을 s2.1-pro-free로 바꿔 주세요',
    403: ' · 이 키로는 쓸 수 없는 요청입니다',
    429: ' · 동시 요청 한도에 걸렸습니다. 잠시 뒤 다시 시도됩니다',
    503: ' · Fish 서버가 바쁩니다. 잠시 뒤 다시 시도해 주세요',
  };
  return status ? hints[status] || '' : '';
}
export class TtsHttpError extends Error {
  constructor(readonly status: number | undefined) {
    super(`음성 API 요청 실패 (${status || 'network'})${ttsStatusHint(status)}`);
    this.name = 'TtsHttpError';
  }
}
export async function ttsFetch(url: string, options: RequestInit = {}): Promise<TtsResponse> {
  const endpoint = new URL(url);
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password) throw new Error('API 주소는 인증 정보가 없는 HTTPS URL이어야 합니다.');
  const host = risuHost();
  if (!host?.nativeFetch) throw new Error('Risu nativeFetch API를 사용할 수 없습니다.');
  const controller = new AbortController();
  const relay = () => controller.abort();
  options.signal?.addEventListener('abort', relay, { once: true });
  if (options.signal?.aborted) controller.abort();
  const timer = setTimeout(() => controller.abort(), 90_000);
  const finish = () => { clearTimeout(timer); options.signal?.removeEventListener('abort', relay); };
  try {
    // No race that releases a Fish slot before the transport has actually settled.
    // Risu nativeFetch defaults to POST, unlike browser fetch. Metadata and free
    // translation must explicitly use GET or Risu rejects the missing body.
    const request:RequestInit & {requestTimeoutMs:number}={method:'GET',...options,signal:controller.signal,requestTimeoutMs:90_000};
    const response: TtsResponse = await host.nativeFetch(url, request);
    if (response.ok === false || (response.status != null && response.status >= 400)) throw new TtsHttpError(response.status);
    return { ok:response.ok, status:response.status, data:response.data, headers:response.headers,
      json:response.json ? () => response.json!() : undefined, arrayBuffer:response.arrayBuffer ? () => response.arrayBuffer!() : undefined, finish };
  } catch(error) { finish(); throw error; }
}
export async function ttsJson(response: TtsResponse): Promise<unknown> {
  try {
  if (response.json) return await response.json();
  if (typeof response.data === 'string') return JSON.parse(response.data);
  if (response.data && typeof response.data === 'object') return response.data;
  throw new Error('API JSON 응답이 올바르지 않습니다.');
  } finally { response.finish?.(); }
}
export async function ttsBytes(response: TtsResponse): Promise<ArrayBuffer> {
  // Keep this reader independent of the image transport's progress/force-finish globals.
  try {
  if (response.arrayBuffer) return await response.arrayBuffer();
  if (response.data instanceof ArrayBuffer) return response.data;
  if (response.data instanceof Uint8Array) return response.data.slice().buffer as ArrayBuffer;
  if (typeof response.data === 'string') return base64ToBytes(response.data).slice().buffer as ArrayBuffer;
  throw new Error('Risu에서 음성 바이너리 응답을 읽지 못했습니다.');
  } finally { response.finish?.(); }
}
export function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
