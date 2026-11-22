import type { TtsCharacter, TtsData, TtsSettings, TtsVoice } from '../../core/tts-types';

export type TtsEngine = TtsSettings['engine'];
/** Engines whose voices are presets of their own (Irodori's, Gemini's, ElevenLabs's), not Fish's library. */
export type OwnVoiceEngine = Exclude<TtsEngine, 'fish'>;
type OwnKeys = Pick<TtsCharacter, 'irodoriKey' | 'geminiKey' | 'elevenKey'>;
const OWN_KEY: Record<OwnVoiceEngine, keyof OwnKeys> = { irodori: 'irodoriKey', gemini: 'geminiKey', elevenlabs: 'elevenKey' };
const OWN_LIST: Record<OwnVoiceEngine, 'irodoriVoices' | 'geminiVoices' | 'elevenVoices'> = { irodori: 'irodoriVoices', gemini: 'geminiVoices', elevenlabs: 'elevenVoices' };
export const OWN_ENGINE_NAME: Record<OwnVoiceEngine, string> = { irodori: 'Irodori', gemini: 'Gemini', elevenlabs: 'ElevenLabs' };
/**
 * A card keeps one voice per engine: its Fish voice (`voiceKey`, `fishId`) and a preset of each other engine
 * (`irodoriKey`, `geminiKey`, `elevenKey`). Switching the engine and back finds each as it was left.
 */
export function boundVoiceKey(character: Pick<TtsCharacter, 'voiceKey'> & OwnKeys, engine: TtsEngine): string {
  return ownVoiceEngine(engine) ? character[OWN_KEY[engine]] || '' : character.voiceKey;
}
export const ownVoiceEngine = (engine: TtsEngine): engine is OwnVoiceEngine => engine === 'irodori' || engine === 'gemini' || engine === 'elevenlabs';
/** The presets of an engine of its own. */
export const ownVoices = (data: Pick<TtsData, 'irodoriVoices' | 'geminiVoices' | 'elevenVoices'>, engine: OwnVoiceEngine): TtsVoice[] => data[OWN_LIST[engine]];
/** Gives the card the voice under that engine alone; `null` takes it away. */
export function bindVoice(character: Pick<TtsCharacter, 'voiceKey' | 'fishId'> & OwnKeys, voice: Pick<TtsVoice, 'key' | 'fishId'> | null, engine: TtsEngine): void {
  if (ownVoiceEngine(engine)) { if (voice) character[OWN_KEY[engine]] = voice.key; else delete character[OWN_KEY[engine]]; return; }
  character.voiceKey = voice?.key || ''; character.fishId = voice?.fishId || '';
}
