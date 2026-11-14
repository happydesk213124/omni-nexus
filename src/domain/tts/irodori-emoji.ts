/**
 * Irodori's voice emoji: written inside a line, each colours the delivery or adds a sound where it stands
 * (`あははっ🤭、それ本当に言ってるの？…😮‍💨まぁ、君らしいけどね。`), and doubled it is stronger. The 39 the model was
 * trained on, as its EMOJI_ANNOTATIONS.md lists them, by code point: two of them (pause, heavy breathing) carry the
 * variation selector there, the rest do not, and a reply writes either form.
 */
const ROWS: readonly (readonly [string, string])[] = [
  ['1f442', 'whisper'], ['1f62e 200d 1f4a8', 'sigh'], ['23f8 fe0f', 'pause'], ['1f92d', 'chuckle'], ['1f975', 'panting/moan'],
  ['1f4e2', 'echo'], ['1f60f', 'teasing'], ['1f97a', 'trembling/timid'], ['1f32c fe0f', 'heavy breathing'], ['1f62e', 'gasp'],
  ['1f445', 'licking/wet sound'], ['1f48b', 'lip smack'], ['1faf6', 'gently'], ['1f62d', 'sobbing'], ['1f631', 'scream'],
  ['1f62a', 'sleepy'], ['23e9', 'fast'], ['1f4de', 'over the phone'], ['1f422', 'slowly'], ['1f964', 'gulp'],
  ['1f927', 'cough/sniffle'], ['1f612', 'tut'], ['1f630', 'nervous/stutter'], ['1f606', 'joyful'], ['1f620', 'angry/sulking'],
  ['1f632', 'surprise'], ['1f971', 'yawn'], ['1f616', 'in pain'], ['1f61f', 'worried'], ['1fae3', 'shy'],
  ['1f644', 'exasperated'], ['1f60a', 'cheerful'], ['1f44c', 'mm-hm'], ['1f64f', 'pleading'], ['1f974', 'drunk'],
  ['1f3b5', 'humming'], ['1f910', 'muffled'], ['1f60c', 'relieved'], ['1f914', 'wondering'],
];
const VS16 = String.fromCodePoint(0xfe0f);
const glyph = (hex: string): string => String.fromCodePoint(...hex.split(' ').map(code => parseInt(code, 16)));
const bare = (emoji: string): string => emoji.split(VS16).join('');
export interface IrodoriEmoji { emoji: string; label: string }
/** Each as Irodori's own list writes it. */
export const IRODORI_EMOJI: readonly IrodoriEmoji[] = ROWS.map(([hex, label]) => ({ emoji: glyph(hex), label }));
/** By the emoji without its variation selector: the form a reply wrote it in does not matter. */
const KNOWN = new Map(IRODORI_EMOJI.map(row => [bare(row.emoji), row.emoji]));
/** The list as the prompt gives it: `👂 whisper, 😮‍💨 sigh, …`. */
export const irodoriEmojiList = (): string => IRODORI_EMOJI.map(row => `${row.emoji} ${row.label}`).join(', ');
/**
 * A regex source matching any of them, the selector optional, longest first (😮‍💨 before 😮). For the display
 * rule that hides them in the chat; the engines the rule runs in take the emoji as written.
 */
export const IRODORI_EMOJI_SOURCE = `(?:${[...KNOWN.keys()].sort((a, b) => b.length - a.length).join('|')})${VS16}?`;

// One emoji as written: a pictograph with whatever joins or modifies it.
const SEQUENCE = /\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier}|‍\p{Extended_Pictographic}️?)*/gu;
/** The voice emoji in a text, in order, each in Irodori's own form. */
export function irodoriEmojiIn(text: string): string[] {
  return [...text.matchAll(SEQUENCE)].flatMap(match => { const known = KNOWN.get(bare(match[0])); return known ? [known] : []; });
}
/**
 * What Irodori is sent: its own emoji in the form it knows, every other one taken out (a ❤️ or 👩 it was never
 * trained on is read as noise or not at all).
 */
export function irodoriSpeech(text: string): string {
  return text.replace(SEQUENCE, found => KNOWN.get(bare(found)) ?? '').replace(/[ \t]{2,}/g, ' ').trim();
}
/**
 * A translation may drop an emoji. Whatever the line had and its translation lost is put back at the line's start,
 * where it still colours the delivery; one that came through stays where the translator left it.
 */
export function keepIrodoriEmoji(source: string, translated: string): string {
  const left = irodoriEmojiIn(translated), lost: string[] = [];
  for (const emoji of irodoriEmojiIn(source)) { const at = left.indexOf(emoji); if (at >= 0) left.splice(at, 1); else lost.push(emoji); }
  return lost.length ? lost.join('') + translated : translated;
}

/**
 * A line written for Fish (`Name (whispering): "…"`) read by Irodori: the delivery's nearest voice emoji, two at
 * most. calm and neutral have none. Words are matched by their stem, as a model varies them (whisper, whispering).
 */
const TONES: readonly (readonly [RegExp, string])[] = [
  [/whisper|hushed/, '1f442'], [/sigh/, '1f62e 200d 1f4a8'], [/laugh|chuckl|giggl/, '1f92d'], [/moan|pant|groan/, '1f975'],
  [/teas|playful|flirt|coax|seduct/, '1f60f'], [/trembl|timid|shak|quiver/, '1f97a'], [/breath/, '1f32c fe0f'], [/gasp/, '1f62e'],
  [/soft|gentl|tender|warm|kind|lov/, '1faf6'], [/sad|cry|sob|tear|grie|sorrow/, '1f62d'], [/scream|shout|yell|shriek/, '1f631'],
  [/sleep|tired|drows|lazy|languid/, '1f62a'], [/fast|hurr|rush|rapid/, '23e9'], [/slow/, '1f422'],
  [/nervous|panic|anxious|stutter|fluster|agitat/, '1f630'], [/happy|joy|excit|delight/, '1f606'], [/angr|anger|annoy|irritat|sulk|furious/, '1f620'],
  [/surpris|shock|amaz|astonish/, '1f632'], [/pain|hurt|agon/, '1f616'], [/worr|concern/, '1f61f'], [/shy|embarrass|bashful/, '1fae3'],
  [/exasperat|sarcas|deadpan/, '1f644'], [/cheer|glad|bright/, '1f60a'], [/plead|beg/, '1f64f'], [/drunk/, '1f974'],
  [/relie|content|satisf/, '1f60c'], [/curious|question|wonder|confus|puzzl/, '1f914'],
];
/**
 * A line as Irodori is sent it. `source`: the line as written; `spoken`: what is about to be read (its translation).
 * A line with no voice emoji of its own takes its delivery's (`tone`), when it was written for Fish.
 */
export function irodoriLine(source: string, spoken: string, tone = ''): string {
  const text = irodoriSpeech(keepIrodoriEmoji(source, spoken));
  return irodoriEmojiIn(text).length ? text : irodoriToneEmoji(tone) + text;
}
export function irodoriToneEmoji(tone: string): string {
  const found: string[] = [];
  for (const word of String(tone || '').toLowerCase().split(',').map(part => part.trim()).filter(Boolean)) {
    const hit = TONES.find(([stem]) => stem.test(word));
    if (hit && !found.includes(hit[1])) found.push(hit[1]);
  }
  return found.slice(0, 2).map(glyph).join('');
}
