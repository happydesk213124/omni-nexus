import type { TtsSettings } from '../../core/tts-types';
import { ttsSpokenText } from './filter';

/**
 * 대사 중간 감정 태그: `[sad]`, `[sobbing]`, `[whispering softly]` inside a line. A tag is English words in
 * square brackets, whatever the words are: the model makes up more of them than any list could hold, and Fish
 * reads any of them. Brackets holding other letters (`[속마음]`, `[メモ]`) are the story's and are read out.
 */
export const VOICE_TAG_SOURCE = String.raw`\[[A-Za-z][A-Za-z ,'\-]{0,59}\]`;
const VOICE_TAG = new RegExp(VOICE_TAG_SOURCE, 'g');

/** Fish and Gemini take the tags; Irodori has its own voice emoji instead. */
export const voiceTagsOn = (settings: Pick<TtsSettings, 'inlineTags' | 'engine'>): boolean => settings.inlineTags !== false && settings.engine !== 'irodori';

/** The line as shown or translated without its tags. */
export function withoutVoiceTags(text: string): string {
  // The space before a tag goes with it, so `정말 [giggle].` is `정말.`; one opening the line leaves its space to trim.
  return text.replace(new RegExp(String.raw`[ \t]*${VOICE_TAG_SOURCE}`, 'g'), '').replace(/[ \t]{2,}/g, ' ').trim();
}

/**
 * The omitted characters out of everything but the tags: 「생략할 문자들」 holds `[` and `]` by default, which
 * turned `[sobbing]` into the word "sobbing". Each tag stands aside as a private-use mark while the rest is cut.
 */
export function spokenWithVoiceTags(text: string, omissions: string): string {
  const tags: string[] = [];
  const masked = text.replace(VOICE_TAG, tag => String.fromCharCode(0xe010, 0xe100 + tags.push(tag) - 1));
  return ttsSpokenText(masked, omissions).replace(/([-])/g, (_, i: string) => tags[i.charCodeAt(0) - 0xe100] ?? '');
}

/** Gemini writes its tags in angle brackets (`<sob>`); the chat cannot hold those, so they change on the way out. */
export const geminiVoiceTags = (text: string): string => text.replace(VOICE_TAG, tag => `<${tag.slice(1, -1).trim()}>`);
