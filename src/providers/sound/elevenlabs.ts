import { ttsBytes, ttsFetch, ttsJson } from '../tts/http';
import { sniffAudioMime } from '../../domain/sound/audio';

/** ElevenLabs text-to-sound-effect. Returns mp3 bytes. */
export async function generateSoundEffect(text: string, options: { key: string; durationSeconds?: number; promptInfluence?: number }): Promise<{ bytes: ArrayBuffer; mime: string }> {
  const key = options.key.trim();
  if (!key) throw new Error('소리 모델 설정에 ElevenLabs API 키를 넣어 주세요.');
  const prompt = text.trim().slice(0, 450);
  if (!prompt) throw new Error('효과음 설명(프롬프트)을 넣어 주세요.');
  const body: Record<string, unknown> = { text: prompt, prompt_influence: options.promptInfluence ?? .4 };
  // Unset lets ElevenLabs pick a length that fits the prompt.
  if (options.durationSeconds && options.durationSeconds > 0) body.duration_seconds = Math.max(.5, Math.min(30, options.durationSeconds));
  const bytes = await ttsBytes(await ttsFetch('https://api.elevenlabs.io/v1/sound-generation', {
    method: 'POST', headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' }, body: JSON.stringify(body),
  }));
  const mime = sniffAudioMime(bytes);
  if (!mime) throw new Error('ElevenLabs 응답이 오디오가 아닙니다.');
  return { bytes, mime };
}

/** English wording for a prompt (the effect models work best in English); the original on any failure. */
export async function englishText(text: string): Promise<string> {
  if (!/[^\x00-\x7f]/.test(text)) return text;
  try {
    const query = new URLSearchParams({ client: 'gtx', sl: 'auto', tl: 'en', dt: 't', q: text.slice(0, 300) });
    const data = await ttsJson(await ttsFetch(`https://translate.googleapis.com/translate_a/single?${query}`));
    const out = Array.isArray(data) && Array.isArray(data[0]) ? data[0].map((row: unknown) => Array.isArray(row) && typeof row[0] === 'string' ? row[0] : '').join('').trim() : '';
    return out || text;
  } catch { return text; }
}
