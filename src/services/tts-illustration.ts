import { getImageBytes } from './gallery';
import { readGenerationImageData, sceneFromNaiMetadata } from '../domain/nai-meta';
import type { TtsRequest } from './tts-runtime';
import type { TtsChatContext } from './tts-context';

export async function illustrationTtsRequests(id: string, context: TtsChatContext): Promise<TtsRequest[]> {
  // Reading bytes is intentional here: only an explicit image-play action reads its embedded metadata.
  const bytes = await getImageBytes(id);
  if (!bytes) throw new Error('삽화 메타데이터를 읽을 수 없습니다.');
  const data = readGenerationImageData(bytes);
  const scene = data?.recipe ? sceneFromNaiMetadata(data.recipe) : null;
  const cast = data?.characters || [];
  const requests: TtsRequest[] = [];
  for (const [index, character] of (scene?.characters || []).entries()) {
    const marker = /korean\s+text\s*:/i.exec(character.prompt);
    const name = cast[index]?.name;
    if (!marker || !name) continue;
    // Dialogue is appended to the caption by Omni after the other tags.
    const text = character.prompt.slice(marker.index + marker[0].length).trim();
    if (text && text.length <= 8000) requests.push({ context, messageId:`illustration:${id}`, segment:{ id:String(index), speaker:name, text, tone:'', kind:'illustration', start:0,end:0 } });
  }
  if (!requests.length) throw new Error('이 삽화에 이름과 korean text 대사가 함께 저장되어 있지 않습니다.');
  return requests;
}
