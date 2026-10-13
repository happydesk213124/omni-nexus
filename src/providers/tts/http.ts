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
    if (response.ok === false || (response.status != null && response.status >= 400)) throw new Error(`음성 API 요청 실패 (${response.status || 'network'})`);
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
