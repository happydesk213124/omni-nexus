import type { TtsCharacter, TtsSettings, TtsVoice } from '../../core/tts-types';

export type TtsEngine = TtsSettings['engine'];
/**
 * A card keeps one voice per engine: its Fish voice (`voiceKey`, `fishId`) and its Irodori preset (`irodoriKey`).
 * Switching the engine and back finds each as it was left.
 */
export function boundVoiceKey(character: Pick<TtsCharacter, 'voiceKey' | 'irodoriKey'>, engine: TtsEngine): string {
  return engine === 'irodori' ? character.irodoriKey || '' : character.voiceKey;
}
/** Gives the card the voice under that engine alone; `null` takes it away. */
export function bindVoice(character: Pick<TtsCharacter, 'voiceKey' | 'fishId' | 'irodoriKey'>, voice: Pick<TtsVoice, 'key' | 'fishId'> | null, engine: TtsEngine): void {
  if (engine === 'irodori') { if (voice) character.irodoriKey = voice.key; else delete character.irodoriKey; return; }
  character.voiceKey = voice?.key || ''; character.fishId = voice?.fishId || '';
}
