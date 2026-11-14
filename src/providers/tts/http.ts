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
/** The user's own Irodori-TTS server reads the same codes differently: a key is optional, a voice is a file on it. */
const IRODORI_HINTS: Record<number, string> = {
  400: ' · Irodori 서버가 요청을 거절했습니다. 목소리 ID와 모델 이름을 확인해 주세요',
  401: ' · Irodori 서버의 API 키(IRODORI_API_KEY)와 같은 값을 넣어 주세요',
  404: ' · Irodori 서버에 그 목소리가 없거나 주소가 다릅니다. 서버 주소와 목소리 ID를 확인해 주세요',
  500: ' · Irodori 서버 안에서 오류가 났습니다. mp3는 서버에 FFmpeg가 있어야 합니다(없으면 출력 형식을 wav로)',
  503: ' · Irodori 서버가 앞선 생성을 기다리다 시간을 넘겼습니다. 잠시 뒤 다시 시도해 주세요',
};
export type TtsService = 'fish' | 'irodori';
/** Fish's own reading of the common failures, so the toast says what to fix. */
function ttsStatusHint(status: number | undefined, service: TtsService = 'fish'): string {
  if (service === 'irodori') return status ? IRODORI_HINTS[status] || '' : ' · Irodori 서버에 닿지 못했습니다. 서버가 켜져 있는지, 주소가 맞는지 확인해 주세요. 브라우저에서 여는 Risu라면 서버를 IRODORI_CORS_ORIGINS=["*"] 설정으로 띄워야 합니다';
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
  constructor(readonly status: number | undefined, readonly service: TtsService = 'fish') {
    super(`음성 API 요청 실패 (${status || 'network'})${ttsStatusHint(status, service)}`);
    this.name = 'TtsHttpError';
  }
}
/**
 * `service` 'irodori': the user's own server, usually this PC or one on the LAN, so plain http is allowed (as for
 * ComfyUI and Ollama) and a failure is read as that server's. Every other call stays HTTPS only.
 */
export async function ttsFetch(url: string, options: RequestInit = {}, service: TtsService = 'fish'): Promise<TtsResponse> {
  let endpoint: URL;
  try { endpoint = new URL(url); } catch { throw new Error('API 주소가 올바른 URL이 아닙니다.'); }
  const own = service === 'irodori';
  if (!(endpoint.protocol === 'https:' || (own && endpoint.protocol === 'http:')) || endpoint.username || endpoint.password) throw new Error(own ? 'Irodori 서버 주소는 인증 정보가 없는 http(s) URL이어야 합니다.' : 'API 주소는 인증 정보가 없는 HTTPS URL이어야 합니다.');
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
    if (response.ok === false || (response.status != null && response.status >= 400)) throw new TtsHttpError(response.status, service);
    return { ok:response.ok, status:response.status, data:response.data, headers:response.headers,
      json:response.json ? () => response.json!() : undefined, arrayBuffer:response.arrayBuffer ? () => response.arrayBuffer!() : undefined, finish };
  } catch(error) {
    finish();
    // A server that is off or unreachable throws from the transport with no status: say whose it was.
    if (own && !(error instanceof TtsHttpError) && !controller.signal.aborted) throw new TtsHttpError(undefined, service);
    throw error;
  }
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
