import type { TtsCharacter } from '../core/tts-types';
import { cleanText, unifiedSessionIdForCharacter } from '../core/util/text';
import { speakerLooksInstruction, type SpeakerSeen } from '../domain/character/speaker-looks';
import { createCharactersFromDescription } from './character-create';
import { forgetSpriteFailures, spriteLooks, type EmotionBot } from './emotion-assets';

/**
 * 외형 없음 · 눌러서 만들기 (옴니 뷰어): the illustration character a TTS speaker lacks, made by the character LLM
 * (the 보조 모델, unless 캐릭터용 LLM is set apart) as 캐릭터's LLM 추가 makes one, into this bot's roster, where
 * their faces are looked for. Once their looks are there, every face of theirs that failed may be drawn at once.
 */
export async function makeSpeakerLooks(person: TtsCharacter, bot: EmotionBot, seen: Partial<SpeakerSeen> & { sessionId?: string } = {}): Promise<void> {
  const instruction = speakerLooksInstruction({ name: person.name, gender: person.gender, tags: person.tags, said: seen.said, story: seen.story });
  await createCharactersFromDescription({ character_id: bot.id, scope: unifiedSessionIdForCharacter(bot.id), session_id: seen.sessionId || '', instruction });
  // Made under another name (the model did not keep it), nobody their faces can find: said, not drawn as if done.
  if (!cleanText(await spriteLooks(person, bot).catch(() => ''))) throw new Error(`만든 캐릭터가 ${person.name}(으)로 이어지지 않았습니다. 삽화 캐릭터 탭에서 이름을 확인해 주세요.`);
  forgetSpriteFailures(bot.id, person.id);
}
