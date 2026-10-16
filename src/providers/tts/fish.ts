import type { TtsSettings } from '../../core/tts-types';
import { fishVoiceId, voiceGender } from '../../domain/tts/library';
import { fishText } from '../../domain/tts/segment';
import { objectValue, ttsBytes, ttsFetch, ttsJson } from './http';

export const OPENROUTER_SPEECH_URL = 'https://openrouter.ai/api/v1/audio/speech';
/** The OpenRouter key for Fish: its own, else JEV's when JEV goes through OpenRouter. */
export function fishRouterKey(settings: Pick<TtsSettings, 'fish' | 'jev'>): string {
  return settings.fish.routerKey.trim() || (settings.jev.url.includes('openrouter.ai') ? settings.jev.key.trim() : '');
}
/** Whether speech can be made at all over the chosen route: Fish's own key, or an OpenRouter one. */
export function fishSpeechReady(settings: Pick<TtsSettings, 'fish' | 'jev'>): boolean {
  return settings.fish.via === 'openrouter' ? !!fishRouterKey(settings) : !!settings.fish.key.trim();
}
/** OpenRouter names Fish models fish-audio/<model>; a full id is kept as typed. */
export const fishRouterModel = (model: string): string => model.includes('/') ? model : `fish-audio/${model}`;
export async function synthesizeFish(text: string, tone: string, voice: string, settings: TtsSettings): Promise<ArrayBuffer> {
  const router = settings.fish.via === 'openrouter';
  if (!fishSpeechReady(settings)) throw new Error(router ? 'TTS 모델 설정에 OpenRouter API 키를 입력해 주세요.' : 'TTS 모델 설정에 Fish API 키를 입력해 주세요.');
  const reference = fishVoiceId(voice);
  if (!reference) throw new Error('유효한 Fish 음성 ID가 필요합니다.');
  if (!text.trim() || text.length > 8000) throw new Error('재생 구간은 1~8000자여야 합니다.');
  // The same voice, tone and loudness either way: OpenRouter takes Fish's own
  // options under provider.options["fish-audio"]; tone stays in the text.
  const fish = { latency: 'normal', normalize: true, prosody: { speed: 1, volume: 0, normalize_loudness: settings.normalize } };
  const response = router ? await ttsFetch(OPENROUTER_SPEECH_URL, {
    method: 'POST', headers: { Authorization: `Bearer ${fishRouterKey(settings)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: fishRouterModel(settings.fish.model), input: fishText(text, tone), voice: reference, response_format: 'mp3', provider: { options: { 'fish-audio': fish } } }),
  }) : await ttsFetch(settings.fish.url, {
    method: 'POST', headers: { Authorization: `Bearer ${settings.fish.key.trim()}`, 'Content-Type': 'application/json', model: settings.fish.model },
    body: JSON.stringify({ text: fishText(text, tone), reference_id: reference, format: 'mp3', latency: 'normal', normalize: true,
      prosody: { speed: 1, volume: 0, normalize_loudness: settings.normalize } }),
  });
  const audio = await ttsBytes(response);
  if (audio.byteLength < 16 || audio.byteLength > 30 * 1024 * 1024) throw new Error('Fish 음성 응답의 크기가 올바르지 않습니다.');
  return audio;
}
/** Fallback when Fish lists no language: the script of the voice's title and description. */
export function guessVoiceLanguages(text: string): string[] {
  const found: string[] = [];
  if (/[\u3040-\u30ff]/.test(text)) found.push('ja');
  if (/[\uac00-\ud7a3]/.test(text)) found.push('ko');
  if (!found.length && /[\u4e00-\u9fff]/.test(text)) found.push('zh');
  if (!found.length && /[a-z]/i.test(text)) found.push('en');
  return found;
}
export async function fetchFishVoice(input: string, settings: TtsSettings) {
  const id = fishVoiceId(input);
  if (!id) throw new Error('Fish 음성 ID 또는 fish.audio 링크를 입력해 주세요.');
  const origin = new URL(settings.fish.url).origin;
  // A public voice's details need no key, so this works with only an OpenRouter key too.
  const key = settings.fish.key.trim();
  const data = objectValue(await ttsJson(await ttsFetch(`${origin}/model/${id}`, key ? { headers: { Authorization: `Bearer ${key}` } } : {})));
  const tags = (Array.isArray(data.tags) ? data.tags : []).filter((v): v is string => typeof v === 'string');
  const name = typeof data.title === 'string' ? data.title : '';
  const listed = (Array.isArray(data.languages) ? data.languages : []).filter((v): v is string => typeof v === 'string' && !!v.trim()).map(v => v.trim().toLowerCase());
  return { fishId: id, name, tags, gender: voiceGender(tags), languages: listed.length ? [...new Set(listed)] : guessVoiceLanguages(`${name} ${typeof data.description === 'string' ? data.description : ''}`) };
}
