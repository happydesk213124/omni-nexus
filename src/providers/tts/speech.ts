import type { TtsSettings } from '../../core/tts-types';
import { fishSpeechReady, synthesizeFish } from './fish';
import { irodoriReady, synthesizeIrodori } from './irodori';
import { geminiReady, synthesizeGemini } from './gemini';

/** Whether the chosen engine can make speech at all (a key for Fish; an address and a voice for Irodori). */
export function speechReady(settings: TtsSettings): boolean {
  return settings.engine === 'irodori' ? irodoriReady(settings) : settings.engine === 'gemini' ? geminiReady(settings) : fishSpeechReady(settings);
}
/**
 * One line to audio, by the engine in `settings`. `tone` is Fish's delivery cues; Irodori has no such tags (its
 * style goes in the text as emoji), so it is not sent there.
 */
export function synthesizeSpeech(text: string, tone: string, voice: string, settings: TtsSettings): Promise<ArrayBuffer> {
  // Gemini takes the delivery as its style, in words (Fish's cues are words too).
  return settings.engine === 'irodori' ? synthesizeIrodori(text, voice, settings) : settings.engine === 'gemini' ? synthesizeGemini(text, tone, voice, settings) : synthesizeFish(text, tone, voice, settings);
}
