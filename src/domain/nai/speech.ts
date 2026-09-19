/**
 * V5 speech → per-character caption tags. Default presets suppress bubbles
 * (`-3::spoken bubble, text::`); strip that on speech shots or the bubble never shows.
 *
 * The tag names no one: it rides the caption of the character who speaks, so the
 * speaker is already established and re-describing hair/height there would only
 * fight that character's own look tags.
 */
import { cleanText } from '../../core/util/text.ts';

const SPEECH_SUPPRESS_RE = /spoken\s*bubble|speech\s*bubble|speechbubble|\btext\b/i;

/** Drop emphasis groups that exist only to hide speech bubbles. */
export function stripSpokenBubbleSuppression(positive: string): string {
  const src = String(positive || '');
  if (!src) return src;
  return src
    .replace(/(-?\d+(?:\.\d+)?)::([^:]*?)::/g, (full, weight: string, inner: string) => {
      const tokens = inner.split(',').map((t) => t.trim()).filter(Boolean);
      const kept = tokens.filter((t) => !SPEECH_SUPPRESS_RE.test(t));
      if (kept.length === tokens.length) return full;
      if (!kept.length) return '';
      return `${weight}::${kept.join(', ')}::`;
    })
    .replace(/,\s*,/g, ',')
    .replace(/^\s*,\s*|\s*,\s*$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function speechLangTag(text: string, langRaw: unknown): string {
  const lang = cleanText(langRaw, 40).toLowerCase().replace(/\s+/g, '');
  if (lang === 'ja' || lang === 'jp' || lang === 'japanese' || lang === 'japanesetext') {
    return 'japanese text';
  }
  if (lang === 'en' || lang === 'english' || lang === 'englishtext') return 'english text';
  if (lang === 'ko' || lang === 'kr' || lang === 'korean' || lang === 'koreantext') {
    return 'korean text';
  }
  if (/[\u3040-\u30ff]/.test(text)) return 'japanese text';
  if (/[\uac00-\ud7a3]/.test(text)) return 'korean text';
  return 'english text';
}

/** `speechbubble, korean text:안돼!!` — appended to the speaker's own caption. */
export function speechCaptionTag(speech: unknown, speechLang?: unknown): string {
  const text = cleanText(speech, 200);
  if (!text) return '';
  return `speechbubble, ${speechLangTag(text, speechLang)}:${text}`;
}

/** True once a caption already carries a bubble, so a reroll cannot stack a second one. */
export function captionHasSpeech(prompt: unknown): boolean {
  return /speechbubble/i.test(String(prompt || ''));
}

export type SpeechCharacter = { speech?: unknown; speech_lang?: unknown; name?: unknown };

/**
 * One tag per cast slot, index-aligned with `chars` so each caption gets its own
 * line. Character `speech` wins; a shot-level `speech` is a fallback that speaks
 * for its named speaker, or for char1 when it is a bare string.
 */
export function speechCaptionTagsForShot(
  shot: { speech?: unknown } & Record<string, unknown>,
  chars: SpeechCharacter[],
): string[] {
  const out = chars.map((ch) => speechCaptionTag(ch.speech, ch.speech_lang));
  if (out.some(Boolean) || !chars.length) return out;
  const raw = shot.speech;
  if (raw == null || raw === '') return out;
  if (typeof raw === 'string') {
    out[0] = speechCaptionTag(raw);
    return out;
  }
  if (typeof raw === 'object') {
    const obj = raw as { speaker?: unknown; text?: unknown; lang?: unknown; speech_lang?: unknown };
    const speaker = cleanText(obj.speaker, 200);
    const at = speaker ? chars.findIndex((c) => cleanText(c.name, 200) === speaker) : -1;
    const idx = at >= 0 ? at : 0;
    out[idx] = speechCaptionTag(obj.text, obj.lang ?? obj.speech_lang ?? chars[idx]?.speech_lang);
  }
  return out;
}

/** Appends a bubble to one caption. Dialogue commas must survive, so no `joinTags`. */
export function captionWithSpeech(prompt: string, tag: string): string {
  if (!tag || captionHasSpeech(prompt)) return prompt;
  return prompt ? `${prompt}, ${tag}` : tag;
}
