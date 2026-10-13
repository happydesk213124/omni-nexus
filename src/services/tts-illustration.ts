import { readCardNaiPrompts } from './cards';
import type { TtsRequest } from './tts-runtime';
import type { TtsChatContext } from './tts-context';
import { allowedTtsText, ttsExcludeTerms } from '../domain/tts/filter';
import { illustrationSpeech } from '../domain/tts/illustration';
import { ttsData } from '../storage/tts-store';

export async function illustrationTtsRequests(id: string, context: TtsChatContext): Promise<TtsRequest[]> {
  // Same reader as the shot-tag editor: NovelAI metadata in the pixels plus the
  // card's cast, so images without Omni's own chunk still yield their lines.
  // Reading bytes is intentional here: only an explicit image-play action reads them.
  const result = await readCardNaiPrompts(id) as { ok?: boolean; error?: { message?: string }; characters?: { name?: unknown; prompt?: unknown }[] };
  if (result.ok === false) throw new Error(`삽화 메타데이터를 읽지 못했습니다: ${result.error?.message || '알 수 없는 오류'}`);
  const requests: TtsRequest[] = [];
  const excluded = ttsExcludeTerms(ttsData().settings.excludeText);
  for (const [index, character] of (result.characters || []).entries()) {
    const text = illustrationSpeech(String(character.prompt || ''));
    if (!text || text.length > 8000 || !allowedTtsText(text, excluded, ttsData().settings.skipChars)) continue;
    requests.push({ context, messageId: `illustration:${id}`, segment: { id: String(index), speaker: String(character.name || '').trim(), text, tone: '', kind: 'illustration', start: 0, end: 0 } });
  }
  if (!requests.length) throw new Error('이 삽화의 캐릭터 프롬프트에 대사(speechbubble, … text:)가 없습니다.');
  return requests;
}
