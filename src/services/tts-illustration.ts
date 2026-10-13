import { getImageBytes } from './gallery';
import { readGenerationImageData, sceneFromNaiMetadata } from '../domain/nai-meta';
import type { TtsRequest } from './tts-runtime';
import type { TtsChatContext } from './tts-context';
import { allowedTtsText, ttsExcludeTerms } from '../domain/tts/filter';
import { ttsData } from '../storage/tts-store';

export async function illustrationTtsRequests(id: string, context: TtsChatContext): Promise<TtsRequest[]> {
  // Reading bytes is intentional here: only an explicit image-play action reads its embedded metadata.
  const bytes = await getImageBytes(id);
  if (!bytes) throw new Error('삽화 메타데이터를 읽을 수 없습니다.');
  const data = readGenerationImageData(bytes);
  const scene = data?.recipe ? sceneFromNaiMetadata(data.recipe) : null;
  const cast = data?.characters || [];
  const requests: TtsRequest[] = [];
  const excluded = ttsExcludeTerms(ttsData().settings.excludeText);
  for (const [index, character] of (scene?.characters || []).entries()) {
    const marker = /(?:korean|japanese|english)\s+text\s*:/i.exec(character.prompt);
    const name = cast[index]?.name;
    if (!marker || !name) continue;
    // Dialogue is appended to the caption by Omni after the other tags.
    const text = character.prompt.slice(marker.index + marker[0].length).trim();
    if (text.length <= 8000 && allowedTtsText(text,excluded,ttsData().settings.skipChars)) requests.push({ context, messageId:`illustration:${id}`, segment:{ id:String(index), speaker:name, text, tone:'', kind:'illustration', start:0,end:0 } });
  }
  if (!requests.length) throw new Error('이 삽화에는 읽을 대사가 없습니다. NAI5 대사삽입으로 만든 삽화만 캐릭터 이름과 대사가 함께 저장됩니다.');
  return requests;
}
