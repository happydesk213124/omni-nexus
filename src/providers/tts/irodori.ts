import type { TtsSettings } from '../../core/tts-types';
import { objectValue, ttsBytes, ttsFetch, ttsJson, TtsHttpError } from './http';

/**
 * Irodori-TTS-Server (github.com/Aratako/Irodori-TTS-Server): the user's own server speaking the OpenAI speech API.
 * Japanese only; a voice is a reference recording kept on the server, named by its id. There is no hosted service,
 * so the address is whatever the user runs: this PC (http://127.0.0.1:8088), a LAN machine, or a rented GPU.
 */
type Irodori = Pick<TtsSettings, 'irodori'>;

/** The server's root, however the address was typed: bare, with /v1, or the full speech path. */
export function irodoriBase(url: string): string {
  return String(url || '').trim().replace(/\/+$/, '').replace(/\/v1(\/audio(\/(speech|voices))?)?$/i, '');
}
/**
 * The server's own voice with no reference recording behind it: it reads at once, on a server holding no voice yet,
 * though each line may come out in another timbre. What a default voice left empty means.
 */
export const IRODORI_NO_REF = 'none';
// Every spelling the server takes for it (its NO_REF_IDS): none of them is a voice to make a preset of.
const NO_REF = new Set(['none', 'no_ref', 'no-ref', 'null', 'text-only']);
export const irodoriNoRef = (id: string): boolean => NO_REF.has(String(id || '').trim().toLowerCase());
/** The voice a line with no preset speaks with. */
export const irodoriDefaultVoice = (settings: Irodori): string => settings.irodori.voice.trim() || IRODORI_NO_REF;
/** The server needs no key unless it was started with one, and has a voice of its own: an address is all speech takes. */
export function irodoriReady(settings: Irodori): boolean {
  return !!irodoriBase(settings.irodori.url);
}
function headers(settings: Irodori, json = false): Record<string, string> {
  const key = settings.irodori.key.trim();
  return { ...(key ? { Authorization: `Bearer ${key}` } : {}), ...(json ? { 'Content-Type': 'application/json' } : {}) };
}
/** `voice`: a server voice id; left empty, the settings' own. */
export async function synthesizeIrodori(text: string, voice: string, settings: Irodori): Promise<ArrayBuffer> {
  const base = irodoriBase(settings.irodori.url), id = voice.trim() || irodoriDefaultVoice(settings);
  if (!base) throw new Error('TTS 모델 설정에 Irodori 서버 주소를 입력해 주세요.');
  if (!text.trim() || text.length > 8000) throw new Error('재생 구간은 1~8000자여야 합니다.');
  const response = await ttsFetch(`${base}/v1/audio/speech`, {
    method: 'POST', headers: headers(settings, true),
    body: JSON.stringify({ model: settings.irodori.model.trim() || 'irodori-tts', input: text, voice: id, response_format: settings.irodori.format }),
  }, 'irodori');
  const audio = await ttsBytes(response);
  // A wav of a long line is far larger than Fish's mp3, still well under this.
  if (audio.byteLength < 16 || audio.byteLength > 60 * 1024 * 1024) throw new Error('Irodori 음성 응답의 크기가 올바르지 않습니다.');
  return audio;
}
/**
 * The voices the server holds. Its README gives the path and not the answer's shape, so every likely one is read:
 * a list (or one under data / voices / items) of names or of rows with an id, voice_id or name; or a map by id.
 */
export function irodoriVoiceIds(answer: unknown): string[] {
  const root = objectValue(answer);
  const listed: unknown[] | undefined = Array.isArray(answer) ? answer : [root.data, root.voices, root.items].find(Array.isArray);
  const rows: unknown[] = listed ?? (root.voices && typeof root.voices === 'object' ? Object.keys(root.voices) : []);
  const ids = rows.map(row => typeof row === 'string' ? row : [objectValue(row).id, objectValue(row).voice_id, objectValue(row).name].find(value => typeof value === 'string') as string | undefined);
  return [...new Set(ids.filter((id): id is string => !!id?.trim()).map(id => id.trim()))].slice(0, 500);
}
/** The words a designed voice is first heard saying, and the recording it is kept as. */
export const IRODORI_SAMPLE_TEXT = 'こんにちは。この声でお話しします。今日はどんな一日でしたか？';
/**
 * Voice design: no reference recording, the voice comes from `caption` (a description in Japanese). Every call makes
 * another voice, so the one liked is kept by sending its recording back as a server voice (uploadIrodoriVoice).
 * wav: the server writes it without FFmpeg, and reads it back as a reference.
 */
export async function designIrodoriVoice(caption: string, settings: Irodori, text = IRODORI_SAMPLE_TEXT): Promise<ArrayBuffer> {
  const base = irodoriBase(settings.irodori.url), words = caption.trim();
  if (!base) throw new Error('TTS 모델 설정에 Irodori 서버 주소를 입력해 주세요.');
  if (!words || words.length > 2000) throw new Error('목소리 설명은 1~2000자여야 합니다.');
  const response = await ttsFetch(`${base}/v1/audio/speech`, {
    method: 'POST', headers: headers(settings, true),
    body: JSON.stringify({ model: settings.irodori.model.trim() || 'irodori-tts', input: text, voice: 'none', response_format: 'wav', irodori: { caption: words } }),
  }, 'irodori');
  const audio = await ttsBytes(response);
  if (audio.byteLength < 16 || audio.byteLength > 60 * 1024 * 1024) throw new Error('Irodori 음성 응답의 크기가 올바르지 않습니다.');
  return audio;
}
/** A voice id the server can name a file by: letters, digits, - and _. A name with none of them gets a dated one. */
export function irodoriVoiceSlug(name: string, now = Date.now()): string {
  const slug = name.normalize('NFKC').trim().replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return slug || `voice-${now.toString(36)}`;
}
/**
 * Registers a recording as a server voice (`POST /v1/audio/voices`, a multipart form: `file`, `voice_id`) and answers
 * the id the server gave it. The form is built as bytes: Risu's nativeFetch takes a body of bytes, not a FormData.
 * An id the server already holds is refused there (409) and replaced with PUT, which in turn refuses a new one (404):
 * a voice made again under its own name takes the old one's place.
 */
export async function uploadIrodoriVoice(audio: ArrayBuffer, fileName: string, voiceId: string, settings: Irodori): Promise<string> {
  const base = irodoriBase(settings.irodori.url), id = irodoriVoiceSlug(voiceId);
  if (!base) throw new Error('TTS 모델 설정에 Irodori 서버 주소를 입력해 주세요.');
  // The server reads up to two minutes of reference; a recording that long is far under this.
  if (audio.byteLength < 16 || audio.byteLength > 40 * 1024 * 1024) throw new Error('참조 음성 파일은 40 MB 이하여야 합니다.');
  const boundary = `----omni${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`, encode = new TextEncoder();
  const safeName = (fileName.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80) || 'voice.wav');
  const head = encode.encode(`--${boundary}\r\nContent-Disposition: form-data; name="voice_id"\r\n\r\n${id}\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${safeName}"\r\nContent-Type: application/octet-stream\r\n\r\n`);
  const tail = encode.encode(`\r\n--${boundary}--\r\n`);
  const body = new Uint8Array(head.length + audio.byteLength + tail.length);
  body.set(head, 0); body.set(new Uint8Array(audio), head.length); body.set(tail, head.length + audio.byteLength);
  const send = (method: 'POST' | 'PUT') => ttsFetch(`${base}/v1/audio/voices${method === 'PUT' ? `/${encodeURIComponent(id)}` : ''}`, { method, headers: { ...headers(settings), 'Content-Type': `multipart/form-data; boundary=${boundary}` }, body }, 'irodori');
  const sent = await send('POST').catch(error => { if (error instanceof TtsHttpError && error.status === 409) return send('PUT'); throw error; });
  // Registered, with an answer that is no JSON or names no id: the id asked for is the one it has.
  const answer: unknown = await ttsJson(sent).catch(() => null);
  return irodoriVoiceIds([answer])[0] || irodoriVoiceIds([objectValue(answer).voice])[0] || id;
}
export async function listIrodoriVoices(settings: Irodori): Promise<string[]> {
  const base = irodoriBase(settings.irodori.url);
  if (!base) throw new Error('TTS 모델 설정에 Irodori 서버 주소를 입력해 주세요.');
  return irodoriVoiceIds(await ttsJson(await ttsFetch(`${base}/v1/audio/voices`, { method: 'GET', headers: headers(settings) }, 'irodori')));
}
