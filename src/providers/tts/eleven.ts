import type { TtsSettings, TtsVoice } from '../../core/tts-types';
import { elevenListedVoice, elevenVoiceId } from '../../domain/tts/eleven-voices';
import { fishText } from '../../domain/tts/segment';
import { withoutVoiceTags } from '../../domain/tts/voice-tags';
import { objectValue, ttsBytes, ttsFetch, ttsJson } from './http';

/**
 * ElevenLabs text to speech: one line a request, by an API key (`xi-api-key`), mp3 back. The voice is one of the
 * account's own (its id). The delivery goes in the text: the v3 and v4 models act on [audio tags] ([whispers],
 * [sighs] …), the multilingual and flash ones read a bracket aloud, so nothing in brackets is sent to those.
 */
type Eleven = Pick<TtsSettings, 'eleven'>;
const API = 'https://api.elevenlabs.io';
export const ELEVEN_DEFAULT_MODEL = 'eleven_v3';
/** The models offered; any other id may be typed. */
export const ELEVEN_MODELS: ReadonlyArray<readonly [string, string]> = [
  ['eleven_v3', 'v3 · 감정 태그 · 5,000자'], ['eleven_v4', 'v4 · 감정 태그 · 최고 품질'], ['eleven_v4_turbo', 'v4 Turbo · 감정 태그 · 빠름'],
  ['eleven_multilingual_v2', 'Multilingual v2 · 태그 없음'], ['eleven_flash_v2_5', 'Flash v2.5 · 태그 없음 · 가장 빠름'],
];
export const elevenModel = (s: Eleven): string => s.eleven.model.trim() || ELEVEN_DEFAULT_MODEL;
export const elevenDefaultVoice = (s: Eleven): string => s.eleven.voice.trim();
/** A key is all it takes to ask; which voice speaks is checked when a line is made. */
export const elevenReady = (s: Eleven): boolean => !!s.eleven.key.trim();
/** v3 and everything numbered after it (v4, v4_turbo, v3_conversational) act on [audio tags]. */
export const elevenTagModel = (model: string): boolean => { const m = /^eleven_v(\d+)/.exec(model.trim()); return !!m && Number(m[1]) >= 3; };
/** What one request may hold: ElevenLabs's own limit for the model, never more than a line is here (8,000). */
export const elevenTextLimit = (model: string): number => /^eleven_v3/.test(model.trim()) ? 5000 : 8000;

/**
 * The words as that model takes them. A model that acts on tags gets the line's own tags as written and the base
 * delivery in front as [cue]s (Fish's form: ElevenLabs's tags are free words too). Any other model gets neither:
 * it would say "sad" out loud.
 */
export function elevenText(text: string, tone: string, model: string): string {
  // Japanese mode covers English tags too: whichever language the line's tags were written in, none is left.
  return elevenTagModel(model) ? fishText(text, tone) : withoutVoiceTags(text, 'ja');
}
/** The language told to a 2.5 model (it otherwise guesses, and reads numbers the wrong way): only when the script says so. */
function languageOf(text: string, model: string): string {
  if (!/_v2_5$/.test(model.trim())) return '';
  return /[぀-ヿ]/.test(text) ? 'ja' : /[가-힣]/.test(text) ? 'ko' : '';
}
/** The request for one line. No voice settings are sent: the voice keeps the ones set for it at ElevenLabs. */
export function elevenBody(text: string, tone: string, model: string): Record<string, unknown> {
  const spoken = elevenText(text, tone, model), language = languageOf(spoken, model);
  return { text: spoken, model_id: model, ...(language ? { language_code: language } : {}) };
}
const headers = (s: Eleven): Record<string, string> => {
  const key = s.eleven.key.trim();
  if (!key) throw new Error('TTS 모델 설정에 ElevenLabs API 키를 넣어 주세요.');
  return { 'xi-api-key': key, 'Content-Type': 'application/json' };
};

/** One line to audio. `voice` empty: the settings' default voice. */
export async function synthesizeEleven(text: string, tone: string, voice: string, s: Eleven): Promise<ArrayBuffer> {
  const model = elevenModel(s), id = elevenVoiceId(voice) || elevenVoiceId(elevenDefaultVoice(s));
  if (!id) throw new Error('ElevenLabs 목소리를 먼저 골라 주세요. 「ElevenLabs 목소리」 탭에서 목록을 불러와 기본 목소리로 지정할 수 있습니다.');
  const body = elevenBody(text, tone, model), spoken = String(body.text);
  if (!spoken.trim()) throw new Error('읽을 내용이 없습니다.');
  if (spoken.length > elevenTextLimit(model)) throw new Error(`재생 구간이 너무 깁니다. ${model} 모델은 한 번에 ${elevenTextLimit(model).toLocaleString('en-US')}자까지 읽습니다.`);
  const response = await ttsFetch(`${API}/v1/text-to-speech/${encodeURIComponent(id)}?output_format=mp3_44100_128`, { method: 'POST', headers: headers(s), body: JSON.stringify(body) }, 'elevenlabs');
  const audio = await ttsBytes(response);
  if (audio.byteLength < 16 || audio.byteLength > 60 * 1024 * 1024) throw new Error('ElevenLabs 음성 응답의 크기가 올바르지 않습니다.');
  return audio;
}

/**
 * The account's voices (its own, cloned, designed, and those added from the library), a hundred a page until the list
 * says there is no more. Up to `max`.
 */
export async function listElevenVoices(s: Eleven, max = 1000): Promise<TtsVoice[]> {
  const out: TtsVoice[] = [], seen = new Set<string>();
  let page = '';
  for (let i = 0; i < 20 && out.length < max; i++) {
    const query = new URLSearchParams({ page_size: '100', include_total_count: 'false', ...(page ? { next_page_token: page } : {}) });
    const answer = objectValue(await ttsJson(await ttsFetch(`${API}/v2/voices?${query}`, { method: 'GET', headers: headers(s) }, 'elevenlabs')));
    const rows = Array.isArray(answer.voices) ? answer.voices : [];
    for (const row of rows) { const voice = elevenListedVoice(objectValue(row)); if (voice && !seen.has(voice.key)) { seen.add(voice.key); out.push(voice); } }
    page = typeof answer.next_page_token === 'string' ? answer.next_page_token : '';
    if (answer.has_more !== true || !page || !rows.length) break;
  }
  return out.slice(0, max);
}
/** One voice by its id (or a link ending in it): how a voice not in the list read is added by hand. */
export async function fetchElevenVoice(input: string, s: Eleven): Promise<TtsVoice> {
  const id = elevenVoiceId(input);
  if (!id) throw new Error('ElevenLabs 목소리 ID를 입력해 주세요. (20자 안팎의 영문·숫자)');
  const voice = elevenListedVoice(objectValue(await ttsJson(await ttsFetch(`${API}/v1/voices/${encodeURIComponent(id)}`, { method: 'GET', headers: headers(s) }, 'elevenlabs'))));
  if (!voice) throw new Error('ElevenLabs가 그 목소리의 정보를 주지 않았습니다.');
  return voice;
}
