import type { TtsSettings } from '../../core/tts-types';
import { fishVoiceId, voiceGender } from '../../domain/tts/library';
import { fishText } from '../../domain/tts/segment';
import { objectValue, ttsBytes, ttsFetch, ttsJson } from './http';

export async function synthesizeFish(text: string, tone: string, voice: string, settings: TtsSettings): Promise<ArrayBuffer> {
  if (!settings.fish.key.trim()) throw new Error('TTS 모델 설정에 Fish API 키를 입력해 주세요.');
  const reference = fishVoiceId(voice);
  if (!reference) throw new Error('유효한 Fish 음성 ID가 필요합니다.');
  if (!text.trim() || text.length > 8000) throw new Error('재생 구간은 1~8000자여야 합니다.');
  const response = await ttsFetch(settings.fish.url, {
    method: 'POST', headers: { Authorization: `Bearer ${settings.fish.key.trim()}`, 'Content-Type': 'application/json', model: settings.fish.model },
    body: JSON.stringify({ text: fishText(text, tone), reference_id: reference, format: 'mp3', latency: 'normal', normalize: true,
      prosody: { speed: 1, volume: 0, normalize_loudness: settings.normalize } }),
  });
  const audio = await ttsBytes(response);
  if (audio.byteLength < 16 || audio.byteLength > 30 * 1024 * 1024) throw new Error('Fish 음성 응답의 크기가 올바르지 않습니다.');
  return audio;
}
export async function fetchFishVoice(input: string, settings: TtsSettings) {
  const id = fishVoiceId(input);
  if (!id) throw new Error('Fish 음성 ID 또는 fish.audio 링크를 입력해 주세요.');
  const origin = new URL(settings.fish.url).origin;
  const data = objectValue(await ttsJson(await ttsFetch(`${origin}/model/${id}`, { headers: { Authorization: `Bearer ${settings.fish.key.trim()}` } })));
  const tags = (Array.isArray(data.tags) ? data.tags : []).filter((v): v is string => typeof v === 'string');
  return { fishId: id, name: typeof data.title === 'string' ? data.title : '', tags, gender: voiceGender(tags) };
}
