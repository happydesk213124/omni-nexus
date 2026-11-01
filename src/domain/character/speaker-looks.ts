import { cleanText } from '../../core/util/text';

/** What a reply shows of one speaker: their own lines, and the narration just before each (where they are described). */
export interface SpeakerSeen { said: string[]; story: string[] }

/**
 * 외형 없음 · 눌러서 만들기 (옴니 뷰어): what the character LLM is asked for a TTS speaker no illustration character
 * draws. Their name is kept exactly as the TTS character has it, since that is how their faces find them again;
 * the looks come from the lorebook, the voice card (gender, and the age and personality 첫 대사 이모지 left in its
 * tags) and what the story shows of them.
 */
export function speakerLooksInstruction(input: { name: string; gender?: string; tags?: readonly string[] } & Partial<SpeakerSeen>): string {
  const name = cleanText(input.name, 200).replace(/"/g, '');
  const gender = input.gender === 'female' || input.gender === 'male' ? input.gender : '';
  const tags = [...new Set((input.tags || []).map(tag => cleanText(tag, 60)).filter(Boolean))].slice(0, 20);
  const said = (input.said || []).map(line => cleanText(line, 300)).filter(Boolean).slice(0, 6);
  const story = (input.story || []).map(line => cleanText(line, 600)).filter(Boolean).slice(0, 6);
  const card = [gender && `gender ${gender}`, tags.length && `tags ${tags.join(', ')}`].filter(Boolean).join('; ');
  return [
    `Create exactly one character, "${name}". Keep "${name}" as their name, exactly as written.`,
    card ? `Their voice card: ${card}.` : '',
    said.length ? `What they say in the story:\n${said.map(line => `- ${line}`).join('\n')}` : '',
    story.length ? `The story around their lines:\n${story.map(line => `- ${line}`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n');
}
