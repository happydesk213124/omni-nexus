import type { TtsSettings } from '../../core/tts-types';
import { ttsSpokenText } from './filter';

/**
 * 대사 중간 감정 태그: `[sad]`, `[sobbing]`, `[whispering softly]` inside a line. A tag is English words in
 * square brackets, whatever the words are: the model makes up more of them than any list could hold, and Fish
 * reads any of them. Brackets holding other letters (`[속마음]`) are the story's and are read out.
 *
 * With the TTS translation going to Japanese the model writes them in Japanese (`[すすり泣き]`): a translation
 * service leaves words already in the target language alone, where it would turn English ones into words.
 */
export type VoiceTagLanguage = 'en' | 'ja';
const EN = String.raw`\[[A-Za-z][A-Za-z ,'\-]{0,59}\]`;
const KANA = String.raw`\p{sc=Hiragana}\p{sc=Katakana}\p{sc=Han}`;
const JA = String.raw`\[[${KANA}][${KANA}ー・、 ]{0,29}\]`;
/** The tags of one language, as a regex source for the `u` flag. Japanese mode takes English ones too. */
export const voiceTagSource = (language: VoiceTagLanguage = 'en'): string => language === 'ja' ? `(?:${EN}|${JA})` : EN;
const pattern = (language: VoiceTagLanguage, flags = 'gu') => new RegExp(voiceTagSource(language), flags);

/** Fish and Gemini take the tags; Irodori has its own voice emoji instead. */
export const voiceTagsOn = (settings: Pick<TtsSettings, 'inlineTags' | 'engine'>): boolean => settings.inlineTags !== false && settings.engine !== 'irodori';
const JAPANESE = /^(?:ja|jp|jpn|japanese|日本語|일본어)$/i;
export const japaneseTarget = (language: string): boolean => JAPANESE.test(language.trim());
/** The language the tags are written in: the TTS translation's target when that is Japanese. */
export const voiceTagLanguage = (settings: Pick<TtsSettings, 'translation'>): VoiceTagLanguage =>
  settings.translation.provider !== 'off' && japaneseTarget(settings.translation.language) ? 'ja' : 'en';
/** The tag language in use, or null with the switch off (or on Irodori). */
export const voiceTagMode = (settings: Pick<TtsSettings, 'inlineTags' | 'engine' | 'translation'>): VoiceTagLanguage | null => voiceTagsOn(settings) ? voiceTagLanguage(settings) : null;

/** The line as shown or translated without its tags. */
export function withoutVoiceTags(text: string, language: VoiceTagLanguage = 'en'): string {
  // The space before a tag goes with it, so `정말 [giggle].` is `정말.`; one opening the line leaves its space to trim.
  return text.replace(new RegExp(String.raw`[ \t]*${voiceTagSource(language)}`, 'gu'), '').replace(/[ \t]{2,}/g, ' ').trim();
}

/**
 * The omitted characters out of everything but the tags: 「생략할 문자들」 holds `[` and `]` by default, which
 * turned `[sobbing]` into the word "sobbing". Each tag stands aside as a private-use mark while the rest is cut.
 */
export function spokenWithVoiceTags(text: string, omissions: string, language: VoiceTagLanguage = 'en'): string {
  const tags: string[] = [];
  const masked = text.replace(pattern(language), tag => String.fromCharCode(0xe010, 0xe100 + tags.push(tag) - 1));
  return ttsSpokenText(masked, omissions).replace(/([-])/g, (_, i: string) => tags[i.charCodeAt(0) - 0xe100] ?? '');
}

/** Gemini writes its tags in angle brackets (`<sob>`); the chat cannot hold those, so they change on the way out. */
export const geminiVoiceTags = (text: string, language: VoiceTagLanguage = 'en'): string => text.replace(pattern(language), tag => `<${tag.slice(1, -1).trim()}>`);

/**
 * A line going to a translation service: the tags already in the target's language stay (it leaves those alone),
 * every other one goes, as the service would make words of it that are then read out. An LLM is told to keep them.
 */
export function voiceTagsForTarget(text: string, language: VoiceTagLanguage, target: string): string {
  const keep = japaneseTarget(target) && language === 'ja' ? new RegExp(`^${JA}$`, 'u') : /^en(?:glish)?$/i.test(target.trim()) ? new RegExp(`^${EN}$`) : null;
  if (!keep) return withoutVoiceTags(text, language);
  return text.replace(new RegExp(String.raw`[ \t]*(${voiceTagSource(language)})`, 'gu'), (all, tag: string) => keep.test(tag) ? all : '').replace(/[ \t]{2,}/g, ' ').trim();
}

const OPENING = `["“‘'「『]`, CLOSING = `["”’'」』]`;
const SLIPPED_BEFORE = new RegExp(String.raw`([:：][ \t]*)((?:${voiceTagSource('ja')}[ \t]*)+)(${OPENING})`, 'u');
const SLIPPED_AFTER = new RegExp(String.raw`(${CLOSING})((?:[ \t]*${voiceTagSource('ja')})+)([ \t]*)$`, 'u');
const NAME_TAG = /^([^\n"“”‘’「」『』:：()[\]]{1,80}?[^\s"“”‘’「」『』:：()[\]])([ \t]*)\[([A-Za-z][A-Za-z ,-]{0,59})\](?=[ \t]*[:：])/;
/**
 * Tags a model put just outside the quotes, as its habit of action before speech has it: before the opening quote
 * (`하린 (sad): [sigh] "응."`) or after the closing one (`"응." [sigh]`) they move inside; one standing for the
 * parentheses (`하린 [sad]: "응."`) becomes them. Left as written the first was read as narration, name and all, and
 * the others not at all. Only characters move, so every offset into the line still holds.
 */
export function settleVoiceTags(line: string): string {
  if (!line.includes('[')) return line;
  return line
    .replace(NAME_TAG, (_, name: string, gap: string, tag: string) => `${name}${gap}(${tag})`)
    .replace(SLIPPED_BEFORE, (_, colon: string, tags: string, quote: string) => `${colon}${quote}${tags}`)
    .replace(SLIPPED_AFTER, (_, quote: string, tags: string, tail: string) => `${tags}${quote}${tail}`);
}
