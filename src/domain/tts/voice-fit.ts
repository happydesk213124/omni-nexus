/**
 * A voice chosen from a list by what is plainly stated of it, no model and no embedding asked: its pitch (Google's
 * list gives each voice one of low, medium, high) and the words its description shares with the character's tags.
 * Everything here reads English: tags go through voice-words.ts first.
 */
export type VoicePitch = 'low' | 'medium' | 'high' | '';

const lower = (tags: readonly string[]) => tags.map(tag => tag.trim().toLowerCase());
/** The pitch a voice is listed with: Google's bare `low`, or the tag it is kept as (`low-pitched`). */
export function voicePitch(tags: readonly string[]): VoicePitch {
  const have = new Set(lower(tags));
  if (have.has('high') || have.has('high-pitched')) return 'high';
  if (have.has('low') || have.has('low-pitched')) return 'low';
  if (have.has('medium') || have.has('mid-pitched')) return 'medium';
  return '';
}
/** The pitch a character's tags ask for. A child's voice is a high one: the list holds no children. Both asked, none. */
export function wantedPitch(tags: readonly string[]): 'low' | 'high' | '' {
  const have = new Set(lower(tags));
  const high = have.has('high-pitched') || have.has('child'), low = have.has('low-pitched') || have.has('deep');
  return high === low ? '' : high ? 'high' : 'low';
}
/**
 * The voices of the pitch asked for; with none so listed, every voice but those of the opposite pitch; with nothing
 * left, all of them (a pitch nobody has must not leave a character voiceless).
 */
export function ofPitch<T>(rows: readonly T[], want: 'low' | 'high' | '', pitchOf: (row: T) => VoicePitch): T[] {
  if (!want) return [...rows];
  const same = rows.filter(row => pitchOf(row) === want);
  if (same.length) return same;
  const other = want === 'high' ? 'low' : 'high', rest = rows.filter(row => pitchOf(row) !== other);
  return rest.length ? rest : [...rows];
}

/**
 * Words of ours a voice list says another way: Google's prebuilt voices are each one word (upbeat, firm, even,
 * easy-going, gravelly …) and the library's personas are a handful more. A twin counts half a word of our own.
 */
const TWINS: Record<string, readonly string[]> = {
  bright: ['upbeat', 'cheerful'], cheerful: ['upbeat', 'bright'], energetic: ['lively', 'upbeat', 'excitable'], hyper: ['excitable', 'lively'],
  excited: ['excitable', 'upbeat'], calm: ['even', 'relaxed', 'composed'], relaxed: ['easy', 'casual', 'calm'], easygoing: ['easy', 'casual', 'relaxed'],
  gentle: ['soft', 'smooth'], soft: ['gentle', 'smooth'], kind: ['gentle', 'warm'], affectionate: ['warm', 'friendly'], friendly: ['warm', 'casual'],
  warm: ['friendly'], confident: ['firm', 'forward', 'assured'], bold: ['firm', 'forward', 'confident'], authoritative: ['firm', 'commanding'],
  serious: ['firm', 'professional'], professional: ['informative'], intelligent: ['knowledgeable', 'informative'], rough: ['gravelly'],
  husky: ['gravelly', 'breathy'], youthful: ['young'], child: ['youthful', 'young'], teen: ['youthful', 'young'], 'young adult': ['youthful'],
  clear: ['crisp'], mature: ['adult'], storytelling: ['narrator', 'storyteller'], narration: ['narrator'],
};
const SKIPPED = new Set(['and', 'the', 'voice', 'with']);
const wordsOf = (text: string): string[] => text.toLowerCase().split(/[^a-z]+/).filter(word => word.length >= 3 && !SKIPPED.has(word));
/** One word, or one the other begins (friend, friendly): four letters at least, or 「even」 is 「evening」. */
const alike = (a: string, b: string): boolean => a === b || (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a)));
/**
 * How much of what a character is the voice is said to be: one for each tag every word of which the voice's text
 * holds (「young adult」 needs both), half for a tag only a twin of which it holds.
 */
export function sharedWords(tags: readonly string[], voiceText: string): number {
  const held = wordsOf(voiceText), has = (word: string) => held.some(h => alike(h, word));
  let score = 0;
  for (const tag of new Set(lower(tags))) {
    const words = wordsOf(tag);
    if (words.length && words.every(has)) score += 1;
    else if (TWINS[tag]?.some(has)) score += 0.5;
  }
  return score;
}

/**
 * `room` of the voices, kept even: as many of each kind (`kindOf`: a gender and a pitch) as of any other, and within
 * a kind taken at even steps through the list rather than off its top. A list comes sorted (one accent after
 * another, 「Storyteller 1 … 9」), and its first 300 are whatever it happens to open with.
 */
export function spreadEvenly<T>(rows: readonly T[], room: number, kindOf: (row: T) => string): T[] {
  if (room <= 0) return [];
  if (rows.length <= room) return [...rows];
  const kinds = new Map<string, T[]>();
  for (const row of rows) { const kind = kindOf(row), group = kinds.get(kind); if (group) group.push(row); else kinds.set(kind, [row]); }
  const groups = [...kinds.values()], quota = groups.map(() => 0);
  for (let left = room; left > 0;) {
    let gave = false;
    for (let i = 0; i < groups.length && left > 0; i++) if (quota[i]! < groups[i]!.length) { quota[i] = quota[i]! + 1; left--; gave = true; }
    if (!gave) break;
  }
  const chosen = new Set<T>();
  groups.forEach((group, i) => { for (let k = 0; k < quota[i]!; k++) chosen.add(group[Math.floor(k * group.length / quota[i]!)]!); });
  return rows.filter(row => chosen.has(row));
}
