import type { TtsSegment } from '../../core/tts-types';

/**
 * risu64 난독: a prompt that has the writer hide words in base64 between brackets
 * (`[7IKs6rO8]` for 사과). 옴니 뷰어 and the voice read them as the words they are.
 *
 * A bracket is a word only when it decodes to whole UTF-8 text with no control
 * characters: `[Date]` or `[TIME]` are base64-shaped too, but their bytes are no
 * UTF-8, and the strict decoder costs nothing more (the bytes are checked either way).
 * `[DD_STATUS]` and `[[bgm:…]]` are no base64 at all.
 */
const HIDDEN = /\[([A-Za-z0-9+/]{4,}={0,2})\]/g;
const CONTROL = /\p{Cc}/u;
let strict: TextDecoder | null = null;

function word(code: string): string | null {
  if (code.length % 4) return null;
  try {
    const binary = atob(code), bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const text = (strict ??= new TextDecoder('utf-8', { fatal: true })).decode(bytes);
    return text.trim() && !CONTROL.test(text) ? text : null;
  } catch { return null; }
}

export function revealBase64(text: string): string {
  if (!text.includes('[')) return text;
  return text.replace(HIDDEN, (whole, code: string) => word(code) ?? whole);
}

/**
 * The words read aloud revealed. `text` stays as the chat shows it (it is what a line is
 * matched by) unless `shown` too: 옴니 뷰어 puts the words on its own screen.
 */
export function revealSegments(segments: TtsSegment[], shown = false): TtsSegment[] {
  return segments.map(segment => {
    const said = segment.spoken ?? segment.text, spoken = revealBase64(said), text = shown ? revealBase64(segment.text) : segment.text;
    return spoken === said && text === segment.text ? segment : { ...segment, text, spoken };
  });
}
