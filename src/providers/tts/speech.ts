import type { TtsSettings } from '../../core/tts-types';
import { fishSpeechReady, synthesizeFish } from './fish';
import { irodoriReady, synthesizeIrodori } from './irodori';
import { geminiReady, synthesizeGemini } from './gemini';
import { elevenReady, synthesizeEleven } from './eleven';
import { geminiVoiceTags, voiceTagMode } from '../../domain/tts/voice-tags';

/** Whether the chosen engine can make speech at all (a key for Fish; an address and a voice for Irodori). */
export function speechReady(settings: TtsSettings): boolean {
  return settings.engine === 'irodori' ? irodoriReady(settings) : settings.engine === 'gemini' ? geminiReady(settings) : settings.engine === 'elevenlabs' ? elevenReady(settings) : fishSpeechReady(settings);
}
/**
 * One line to audio, by the engine in `settings`. `tone` is Fish's delivery cues; Irodori has no such tags (its
 * style goes in the text as emoji), so it is not sent there.
 */
const gemini = (text: string, settings: TtsSettings): string => { const tags = voiceTagMode(settings); return tags ? geminiVoiceTags(text, tags) : text; };
export function synthesizeSpeech(text: string, tone: string, voice: string, settings: TtsSettings): Promise<ArrayBuffer> {
  // Gemini takes the delivery as its style, in words (Fish's cues are words too), and 대사 중간 감정 태그 in its own
  // angle brackets: the line keeps Fish's [sobbing] up to here, as the chat could not hold <sobbing>.
  // ElevenLabs takes Fish's [tags] as they are on a model that acts on them, and none at all on the others (eleven.ts).
  if (settings.engine === 'elevenlabs') return synthesizeEleven(text, tone, voice, settings);
  return settings.engine === 'irodori' ? synthesizeIrodori(text, voice, settings) : settings.engine === 'gemini' ? synthesizeGemini(gemini(text, settings), tone, voice, settings) : synthesizeFish(text, tone, voice, settings);
}
