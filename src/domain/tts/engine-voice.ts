import type { TtsCharacter, TtsSettings, TtsVoice } from '../../core/tts-types';

export type TtsEngine = TtsSettings['engine'];
/**
 * A card keeps one voice per engine: its Fish voice (`voiceKey`, `fishId`) and its Irodori preset (`irodoriKey`).
 * Switching the engine and back finds each as it was left.
 */
export function boundVoiceKey(character: Pick<TtsCharacter, 'voiceKey' | 'irodoriKey' | 'geminiKey'>, engine: TtsEngine): string {
  return engine === 'irodori' ? character.irodoriKey || '' : engine === 'gemini' ? character.geminiKey || '' : character.voiceKey;
}
/** Engines whose voices are presets of their own (Irodori's, Gemini's), not Fish's library. */
export const ownVoiceEngine = (engine: TtsEngine): engine is 'irodori' | 'gemini' => engine === 'irodori' || engine === 'gemini';
/** Gives the card the voice under that engine alone; `null` takes it away. */
export function bindVoice(character: Pick<TtsCharacter, 'voiceKey' | 'fishId' | 'irodoriKey' | 'geminiKey'>, voice: Pick<TtsVoice, 'key' | 'fishId'> | null, engine: TtsEngine): void {
  if (engine === 'irodori') { if (voice) character.irodoriKey = voice.key; else delete character.irodoriKey; return; }
  if (engine === 'gemini') { if (voice) character.geminiKey = voice.key; else delete character.geminiKey; return; }
  character.voiceKey = voice?.key || ''; character.fishId = voice?.fishId || '';
}
