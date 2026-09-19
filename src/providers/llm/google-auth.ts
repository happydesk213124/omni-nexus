/**
 * Vertex AI OAuth: signs a service-account JWT with `crypto.subtle` and exchanges
 * it for an access token. Risu has no server side, so the RS256 assertion is
 * minted in the plugin; hosts without WebCrypto must paste a token instead.
 */
import { asU8, bytesToBase64 } from '../../core/util/bytes.ts';
import { cleanText } from '../../core/util/text.ts';
import { networkFetch } from '../nai/http.ts';

export interface GoogleAccessToken {
  accessToken: string;
  /** From the service account's `project_id`; the request URL needs it. */
  projectId: string;
}

interface ServiceAccount {
  client_email?: string;
  private_key?: string;
  project_id?: string;
}

const toB64Url = (b64: string): string => b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');

/** Base64url-encodes a JWT segment, taking either an object or pre-serialised JSON. */
export function b64urlJson(value: unknown): string {
  const json = typeof value === 'string' ? value : JSON.stringify(value);
  return toB64Url(bytesToBase64(new TextEncoder().encode(json)));
}

/** Base64url-encodes raw bytes (the JWT signature). */
export function b64urlBytes(buf: ArrayBuffer | ArrayBufferView): string {
  const bytes = ArrayBuffer.isView(buf)
    ? new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
    : asU8(buf);
  return toB64Url(bytesToBase64(bytes));
}

/** Mints a `cloud-platform` access token from Service Account JSON. */
export async function googleAccessTokenFromServiceAccount(
  saJson: string | Record<string, unknown>,
): Promise<GoogleAccessToken> {
  let sa: ServiceAccount;
  try {
    sa = (typeof saJson === 'string' ? JSON.parse(saJson) : saJson) as ServiceAccount;
  } catch {
    throw new Error('Vertex Service Account JSON 파싱 실패');
  }
  if (!sa?.client_email || !sa?.private_key) {
    throw new Error('Service Account JSON에 client_email/private_key가 필요합니다.');
  }
  if (!globalThis.crypto?.subtle) {
    throw new Error('이 환경에서는 Vertex Service Account(JWT) 서명을 지원하지 않습니다. API key 칸에 OAuth access token을 넣거나 Google AI Studio를 쓰세요.');
  }
  const now = Math.floor(Date.now() / 1000);
  const input = `${b64urlJson({ alg: 'RS256', typ: 'JWT' })}.${b64urlJson({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  })}`;
  const pem = String(sa.private_key).replace(/\\n/g, '\n');
  const pemBody = pem.replace(/-----BEGIN [^-]+-----/, '').replace(/-----END [^-]+-----/, '').replace(/\s+/g, '');
  const raw = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    'pkcs8',
    raw,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(input));
  const jwt = `${input}.${b64urlBytes(sig)}`;
  const resp = await networkFetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${encodeURIComponent(jwt)}`,
  });
  let data: { access_token?: unknown } = {};
  try {
    data = (await (resp as { json(): Promise<unknown> }).json()) as { access_token?: unknown };
  } catch {
    data = {};
  }
  if (!data?.access_token) {
    throw new Error(`Vertex 토큰 발급 실패: ${JSON.stringify(data).slice(0, 240)}`);
  }
  return {
    accessToken: String(data.access_token),
    projectId: cleanText(sa.project_id || ''),
  };
}
