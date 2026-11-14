import type { TtsSettings } from '../../core/tts-types';
import { fishSpeechReady, synthesizeFish } from './fish';
import { irodoriReady, synthesizeIrodori } from './irodori';

/** Whether the chosen engine can make speech at all (a key for Fish; an address and a voice for Irodori). */
export function speechReady(settings: TtsSettings): boolean {
  return settings.engine === 'irodori' ? irodoriReady(settings) : fishSpeechReady(settings);
}
/**
 * One line to audio, by the engine in `settings`. `tone` is Fish's delivery cues; Irodori has no such tags (its
 * style goes in the text as emoji), so it is not sent there.
 */
export function synthesizeSpeech(text: string, tone: string, voice: string, settings: TtsSettings): Promise<ArrayBuffer> {
  return settings.engine === 'irodori' ? synthesizeIrodori(text, voice, settings) : synthesizeFish(text, tone, voice, settings);
}
