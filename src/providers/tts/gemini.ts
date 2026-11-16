import type { TtsSettings, TtsVoice } from '../../core/tts-types';
import { base64ToBytes } from '../../core/util/bytes';
import { GEMINI_DEFAULT_VOICE, geminiListedVoice } from '../../domain/tts/gemini-voices';
import { objectValue, ttsFetch, ttsJson, TtsHttpError } from './http';

/**
 * Gemini TTS, by an AI Studio key (the Gemini API) or a Vertex AI service account (its JSON key: an access token is
 * made from it here and kept until it runs out). One line a request; the voice is a prebuilt name (Kore …), a voice of
 * the Extended Voice Library or one designed or replicated (`voice_…`). The style of a line (its tone) goes with it.
 *
 * Two request shapes are in use: the Gemini 3.8 models take the voice as `voiceConfig.voice` and the style as the
 * part's `speech_metadata.style`; the older ones (2.5, 3.1) take `prebuiltVoiceConfig.voiceName` and read a style
 * written before the line. The model name says which is tried first; refused as malformed, the other is tried once.
 */
type Gemini = Pick<TtsSettings, 'gemini'>;
const STUDIO = 'https://generativelanguage.googleapis.com/v1beta';
const SCOPE = 'https://www.googleapis.com/auth/cloud-platform';

/** The model that speaks; empty, the newest Flash TTS. */
export const GEMINI_DEFAULT_MODEL = 'gemini-3.8-flash-tts';
const modelOf = (s: Gemini) => s.gemini.model.trim() || GEMINI_DEFAULT_MODEL;
/** The 3.8 models (and anything after them) take the newer request shape. */
export const geminiNewShape = (model: string): boolean => { const m = /gemini-(\d+)\.(\d+)/.exec(model); return !m || Number(m[1]) > 3 || (Number(m[1]) === 3 && Number(m[2]) >= 8); };
export const geminiDefaultVoice = (s: Gemini): string => s.gemini.voice.trim() || GEMINI_DEFAULT_VOICE;

interface ServiceAccount { client_email: string; private_key: string; project_id: string; token_uri: string }
export function parseServiceAccount(json: string): ServiceAccount | null {
  try {
    const raw = objectValue(JSON.parse(json));
    const text = (k: string) => typeof raw[k] === 'string' ? (raw[k] as string).trim() : '';
    const account = { client_email: text('client_email'), private_key: text('private_key'), project_id: text('project_id'), token_uri: text('token_uri') || 'https://oauth2.googleapis.com/token' };
    return account.client_email && account.private_key.includes('PRIVATE KEY') && account.project_id ? account : null;
  } catch { return null; }
}
/** An AI Studio key, or a Vertex service account JSON that reads as one. */
export function geminiReady(s: Gemini): boolean {
  return s.gemini.via === 'vertex' ? !!parseServiceAccount(s.gemini.serviceAccountJson) : !!s.gemini.key.trim();
}

const b64url = (bytes: Uint8Array | string) => {
  const raw = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes;
  let bin = ''; for (const b of raw) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const tokens = new Map<string, { token: string; until: number }>();
/** A Vertex access token from the service account (a signed JWT traded at Google's token endpoint), reused until near its end. */
async function vertexToken(account: ServiceAccount): Promise<string> {
  const held = tokens.get(account.client_email);
  if (held && held.until > Date.now() + 60_000) return held.token;
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('이 환경에서는 Vertex 서비스 계정 서명을 할 수 없습니다. AI Studio 키를 써 주세요.');
  const pem = account.private_key.replace(/\\n/g, '\n').replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\s+/g, '');
  let key: CryptoKey;
  try { key = await subtle.importKey('pkcs8', base64ToBytes(pem) as unknown as ArrayBuffer, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']); }
  catch { throw new Error('Vertex 서비스 계정 JSON의 private_key를 읽지 못했습니다. 받은 JSON 파일 내용을 그대로 넣어 주세요.'); }
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify({ iss: account.client_email, scope: SCOPE, aud: account.token_uri, iat: now, exp: now + 3600 }))}`;
  const signature = new Uint8Array(await subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned)));
  const body = `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${unsigned}.${b64url(signature)}`;
  const answer = objectValue(await ttsJson(await ttsFetch(account.token_uri, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body }, 'gemini')));
  const token = typeof answer.access_token === 'string' ? answer.access_token : '';
  if (!token) throw new Error('Vertex 액세스 토큰을 받지 못했습니다. 서비스 계정에 Vertex AI 사용자 권한이 있는지 확인해 주세요.');
  tokens.set(account.client_email, { token, until: Date.now() + (Number(answer.expires_in) || 3600) * 1000 });
  return token;
}

async function endpoint(s: Gemini, model: string): Promise<{ url: string; headers: Record<string, string> }> {
  if (s.gemini.via !== 'vertex') {
    const key = s.gemini.key.trim();
    if (!key) throw new Error('TTS 모델 설정에 Gemini API 키(AI Studio)를 넣어 주세요.');
    return { url: `${STUDIO}/models/${encodeURIComponent(model)}:generateContent`, headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' } };
  }
  const account = parseServiceAccount(s.gemini.serviceAccountJson);
  if (!account) throw new Error('TTS 모델 설정에 Vertex 서비스 계정 JSON을 넣어 주세요.');
  const location = s.gemini.location.trim() || 'global', host = location === 'global' ? 'aiplatform.googleapis.com' : `${location}-aiplatform.googleapis.com`;
  return { url: `https://${host}/v1/projects/${encodeURIComponent(account.project_id)}/locations/${encodeURIComponent(location)}/publishers/google/models/${encodeURIComponent(model)}:generateContent`,
    headers: { Authorization: `Bearer ${await vertexToken(account)}`, 'Content-Type': 'application/json' } };
}

/** The request for one line, in the shape a model takes (see the file's note). */
export function geminiBody(text: string, style: string, voice: string, newShape: boolean): Record<string, unknown> {
  const part: Record<string, unknown> = newShape ? { text, ...(style ? { speech_metadata: { style } } : {}) } : { text: style ? `Say ${style}: ${text}` : text };
  const voiceConfig = newShape ? { voice } : { prebuiltVoiceConfig: { voiceName: voice } };
  return { contents: [{ role: 'user', parts: [part] }], generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig } } };
}

/** 16-bit mono PCM with a WAV header before it, so the player takes it as any file. */
export function wavOf(pcm: Uint8Array, rate = 24000): ArrayBuffer {
  const out = new ArrayBuffer(44 + pcm.byteLength), view = new DataView(out), put = (at: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(at + i, s.charCodeAt(i)); };
  put(0, 'RIFF'); view.setUint32(4, 36 + pcm.byteLength, true); put(8, 'WAVE'); put(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); put(36, 'data'); view.setUint32(40, pcm.byteLength, true);
  new Uint8Array(out, 44).set(pcm);
  return out;
}
/** The audio in an answer: a WAV as it comes, raw PCM (`audio/L16;rate=24000`) given a header. */
export function geminiAudio(answer: unknown): ArrayBuffer {
  const candidates = objectValue(answer).candidates, first = Array.isArray(candidates) ? objectValue(candidates[0]) : {};
  const parts = objectValue(first.content).parts, list = Array.isArray(parts) ? parts : [];
  for (const raw of list) {
    const part = objectValue(raw), inline = objectValue(part.inlineData ?? part.inline_data), data = inline.data;
    if (typeof data !== 'string' || !data) continue;
    const bytes = base64ToBytes(data), mime = String(inline.mimeType ?? inline.mime_type ?? '');
    const riff = bytes.length > 12 && String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF';
    if (riff) return bytes.slice().buffer as ArrayBuffer;
    const rate = Number(/rate=(\d+)/i.exec(mime)?.[1]) || 24000;
    return wavOf(bytes, rate);
  }
  const reason = String(first.finishReason || objectValue(objectValue(answer).promptFeedback).blockReason || '');
  throw new Error(reason ? `Gemini가 음성을 만들지 않았습니다 (${reason}).` : 'Gemini 응답에 음성이 없습니다.');
}

/** One line to audio. `voice` empty: the settings' default voice. */
export async function synthesizeGemini(text: string, tone: string, voice: string, s: Gemini): Promise<ArrayBuffer> {
  if (!text.trim() || text.length > 8000) throw new Error('재생 구간은 1~8000자여야 합니다.');
  const model = modelOf(s), id = voice.trim() || geminiDefaultVoice(s), style = tone.trim().slice(0, 300), first = geminiNewShape(model);
  const send = async (newShape: boolean) => {
    const { url, headers } = await endpoint(s, model);
    return ttsJson(await ttsFetch(url, { method: 'POST', headers, body: JSON.stringify(geminiBody(text, style, id, newShape)) }, 'gemini'));
  };
  let answer: unknown;
  // A shape the model does not know is refused as a bad request: the other one, once.
  try { answer = await send(first); }
  catch (error) { if (!(error instanceof TtsHttpError) || error.status !== 400) throw error; answer = await send(!first); }
  const audio = geminiAudio(answer);
  // A WAV header with nothing after it is no speech.
  if (audio.byteLength <= 44 || audio.byteLength > 60 * 1024 * 1024) throw new Error('Gemini 음성 응답의 크기가 올바르지 않습니다.');
  return audio;
}

/**
 * The voices resource, by either way in: the Gemini API's (`/v1beta/voices`, snake_case, the key) or Vertex AI's
 * (`/v1beta1/projects/…/locations/…/voices`, camelCase, the service account's token). `location`: Vertex's, when
 * another than the settings' is tried.
 */
async function voicesEndpoint(s: Gemini, location = ''): Promise<{ url: string; headers: Record<string, string>; camel: boolean }> {
  if (s.gemini.via !== 'vertex') {
    const key = s.gemini.key.trim();
    if (!key) throw new Error('TTS 모델 설정에 Gemini API 키(AI Studio)를 넣어 주세요.');
    return { url: `${STUDIO}/voices`, headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' }, camel: false };
  }
  const account = parseServiceAccount(s.gemini.serviceAccountJson);
  if (!account) throw new Error('TTS 모델 설정에 Vertex 서비스 계정 JSON을 넣어 주세요.');
  const where = location || s.gemini.location.trim() || 'global', host = where === 'global' ? 'aiplatform.googleapis.com' : `${where}-aiplatform.googleapis.com`;
  return { url: `https://${host}/v1beta1/projects/${encodeURIComponent(account.project_id)}/locations/${encodeURIComponent(where)}/voices`,
    headers: { Authorization: `Bearer ${await vertexToken(account)}`, 'Content-Type': 'application/json' }, camel: true };
}
/** Vertex's voices may not be served from `global`: refused there (not found, or a bad request), a region is tried once. */
async function withVoices<T>(s: Gemini, work: (at: { url: string; headers: Record<string, string>; camel: boolean }) => Promise<T>): Promise<T> {
  try { return await work(await voicesEndpoint(s)); }
  catch (error) {
    if (s.gemini.via !== 'vertex' || (s.gemini.location.trim() || 'global') !== 'global' || !(error instanceof TtsHttpError) || (error.status !== 404 && error.status !== 400)) throw error;
    // The region's own refusal says less than the first one: that is the one told.
    try { return await work(await voicesEndpoint(s, 'us-central1')); } catch { throw error; }
  }
}

/**
 * The voices this key or account can speak with: its own designed or replicated ones first, then Google's catalog.
 * Up to `max`, a page of 1000 at a time. `language`: a code to narrow it to (ko, ja …).
 */
export async function listGeminiVoices(s: Gemini, language = '', max = 1000): Promise<TtsVoice[]> {
  return withVoices(s, async ({ url, headers, camel }) => {
    const out: TtsVoice[] = [], seen = new Set<string>();
    let page = '';
    for (let i = 0; i < 10 && out.length < max; i++) {
      const query = new URLSearchParams(camel ? { pageSize: '1000', ...(language ? { languageCode: language } : {}), ...(page ? { pageToken: page } : {}) } : { page_size: '1000', ...(language ? { language_code: language } : {}), ...(page ? { page_token: page } : {}) });
      const answer = objectValue(await ttsJson(await ttsFetch(`${url}?${query}`, { method: 'GET', headers }, 'gemini')));
      const rows = Array.isArray(answer.voices) ? answer.voices : [];
      for (const row of rows) { const voice = geminiListedVoice(objectValue(row)); if (voice && !seen.has(voice.key)) { seen.add(voice.key); out.push(voice); } }
      page = String(answer.next_page_token ?? answer.nextPageToken ?? '');
      if (!page || !rows.length) break;
    }
    return out.slice(0, max);
  });
}

export interface GeminiVoiceDesign { name: string; description: string; gender?: 'female' | 'male'; language?: string }
/**
 * Voice design: a new voice from a description in words, kept by Google under this project (`store`: a designed voice
 * must be; 200 at most, each a year from its last use) and named by the id that comes back (`voice_…`). Its sample,
 * when one comes with it, is the voice heard at once. No model is named: Google refuses one on a voice it stores
 * ("Model should not be set when store is true") and designs it with its own; any 3.8 model speaks with it after.
 */
export async function designGeminiVoice(s: Gemini, design: GeminiVoiceDesign): Promise<{ voice: TtsVoice; sample?: ArrayBuffer }> {
  const input = design.description.trim(), name = design.name.trim().slice(0, 80) || 'Omni voice';
  if (!input || input.length > 2000) throw new Error('목소리 설명은 1~2000자여야 합니다.');
  return withVoices(s, async ({ url, headers, camel }) => {
    // What a voice is asked with, from all that is known of it down to the least a design takes (its type, its name,
    // the description), then with its type as an enum's name (Vertex's JSON may want that): a field one side refuses
    // (a language, a gender's spelling) is left out and the voice asked for again.
    const base: Record<string, unknown> = { type: 'prompted', [camel ? 'displayName' : 'display_name']: name, prompted: { input } };
    const extras = { ...(design.gender ? { gender: design.gender } : {}), ...(design.language ? { [camel ? 'languageCode' : 'language_code']: design.language } : {}), description: input.slice(0, 300) };
    const bodies = [{ ...base, ...extras }, base, { ...base, type: 'PROMPTED' }];
    let made: Record<string, unknown> | undefined;
    const refusals: TtsHttpError[] = [];
    for (const voice of bodies) {
      try { made = objectValue(await ttsJson(await ttsFetch(url, { method: 'POST', headers, body: JSON.stringify({ store: true, voice }) }, 'gemini'))); break; }
      catch (error) { if (!(error instanceof TtsHttpError) || error.status !== 400) throw error; refusals.push(error); }
    }
    // Every form refused: each one's own reason is told (each may be refused for another field), once each.
    if (!made) throw new TtsHttpError(400, 'gemini', [...new Set(refusals.map(r => r.detail).filter(Boolean))].join(' | ').slice(0, 600));
    const row = objectValue(made.voice ?? made), listed = geminiListedVoice({ ...row, display_name: name, description: '' });
    if (!listed) throw new Error('Gemini가 만든 목소리의 ID를 받지 못했습니다.');
    const audio = objectValue(row.sample_audio ?? row.sampleAudio), data = typeof audio.data === 'string' ? audio.data : '';
    let sample: ArrayBuffer | undefined;
    if (data) { const bytes = base64ToBytes(data); sample = bytes.length > 12 && String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' ? bytes.slice().buffer as ArrayBuffer : wavOf(bytes); }
    return { voice: { ...listed, name, gender: design.gender ?? listed.gender, caption: input }, ...(sample ? { sample } : {}) };
  });
}
/** A stored voice let go (a designed one no card speaks with): its place in the project's 200 is free again. */
export async function deleteGeminiVoice(s: Gemini, id: string): Promise<void> {
  if (!/^voice(key)?_/.test(id)) return;
  await withVoices(s, async ({ url, headers }) => { (await ttsFetch(`${url}/${encodeURIComponent(id)}`, { method: 'DELETE', headers }, 'gemini')).finish?.(); });
}
