import type { TtsSettings } from '../../core/tts-types';
import { objectValue, ttsBytes, ttsFetch, ttsJson } from './http';

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
/** The server needs no key unless it was started with one; an address and a voice are what speech takes. */
export function irodoriReady(settings: Irodori): boolean {
  return !!irodoriBase(settings.irodori.url) && !!settings.irodori.voice.trim();
}
function headers(settings: Irodori, json = false): Record<string, string> {
  const key = settings.irodori.key.trim();
  return { ...(key ? { Authorization: `Bearer ${key}` } : {}), ...(json ? { 'Content-Type': 'application/json' } : {}) };
}
/** `voice`: a server voice id; left empty, the settings' own. */
export async function synthesizeIrodori(text: string, voice: string, settings: Irodori): Promise<ArrayBuffer> {
  const base = irodoriBase(settings.irodori.url), id = (voice || settings.irodori.voice).trim();
  if (!base) throw new Error('TTS 모델 설정에 Irodori 서버 주소를 입력해 주세요.');
  if (!id) throw new Error('TTS 모델 설정에서 Irodori 목소리를 골라 주세요.');
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
export async function listIrodoriVoices(settings: Irodori): Promise<string[]> {
  const base = irodoriBase(settings.irodori.url);
  if (!base) throw new Error('TTS 모델 설정에 Irodori 서버 주소를 입력해 주세요.');
  return irodoriVoiceIds(await ttsJson(await ttsFetch(`${base}/v1/audio/voices`, { method: 'GET', headers: headers(settings) }, 'irodori')));
}
