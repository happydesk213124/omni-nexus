import type { LlmSettings } from '../core/types';
import { parseVoiceDraft, voiceDraftMessages, voiceDraftSources, type IrodoriVoiceDraft } from '../domain/tts/irodori-voice-draft';
import { callLlm } from '../providers/llm/client';
import { parseLlmJson } from '../providers/tts/translation';
import { ttsCharacterSources, type TtsChatContext } from './tts-context';

/**
 * `who`: the character the voice is for (its name first, then what else it is called); empty for a voice written
 * from the request alone, which reads no source. `context`: the open chat, null when there is none.
 */
export async function writeIrodoriVoice(context: TtsChatContext | null, who: readonly string[], request: string, llm: LlmSettings): Promise<IrodoriVoiceDraft> {
  const names = who.map(name => name.trim()).filter(Boolean);
  if (!names.length && !request.trim()) throw new Error('캐릭터를 고르거나, 어떤 목소리인지 요청을 적어 주세요.');
  // Named: the lorebook is asked for these names' entries only (and the always-active ones), then cut down again.
  const sources = context && names.length ? voiceDraftSources(await ttsCharacterSources(context, { lore: true, persona: false, illustration: true }, [...names]), names) : {};
  return parseVoiceDraft(parseLlmJson(await callLlm(llm, voiceDraftMessages(names[0] || '', request, sources))));
}
