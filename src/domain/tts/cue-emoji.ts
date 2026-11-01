import type { TtsCharacter } from '../../core/tts-types';

/**
 * 첫 대사 이모지: with the TTS switch on, each character's first cue in a reply carries two emoji before
 * the name, `👩🥺 하린 (soft tone): "…"`: age and gender, then personality. They are read
 * here into what a new character's voice is chosen by: the gender outright, the age and
 * personality as mood tags in the words the sample voices are tagged with (청년, 소심한…).
 *
 * The prompt only names the six age-gender emoji; the model picks the personality one
 * itself, and the table below knows the common ones. One it does not know says nothing.
 */
export interface CueHint { gender?: 'female' | 'male'; tags: string[] }

const ZWJ = String.fromCodePoint(0x200d), VS16 = String.fromCodePoint(0xfe0f);
const MODIFIER = /\p{Emoji_Modifier}/u;

// The voice library's three ages: 어린이, 청년 (teens to adults), 중년.
const PEOPLE: Record<string, readonly [CueHint['gender'], string]> = {
  '👧': ['female', '어린이'], '👦': ['male', '어린이'], '🧒': [undefined, '어린이'], '👶': [undefined, '어린이'],
  '👩': ['female', '청년'], '👨': ['male', '청년'], '🧑': [undefined, '청년'], '👱': [undefined, '청년'],
  '👵': ['female', '중년'], '👴': ['male', '중년'], '🧓': [undefined, '중년'],
};
const PERSONALITY: Record<string, readonly string[]> = {
  '😊': ['밝은', '친근한'], '🙂': ['차분함', '친근한'], '😄': ['명랑한', '활기찬'], '😁': ['명랑한', '활기찬'],
  '😆': ['활기찬', '장난기 있는'], '🤩': ['텐션 높은', '활기찬'], '🤗': ['친근한', '따뜻한'], '🥰': ['귀여운', '따뜻한'],
  '😍': ['귀여운', '감정 표현이 풍부한'], '😘': ['친밀한', '섹시한'], '😇': ['순진한', '부드러운'], '😌': ['차분함', '편안한'],
  '😈': ['장난기 있는', '자신감 있는'], '😏': ['장난기 있는', '여유로운'], '😎': ['쿨함', '자신감 있는'], '🤓': ['지적인'],
  '🧐': ['지적인', '진지한'], '🤔': ['지적인', '차분함'], '😐': ['무덤덤한', '단조로운'], '😑': ['무덤덤한', '단조로운'],
  '😶': ['무덤덤한', '차분함'], '🙄': ['귀찮은', '도도한'], '😒': ['툴툴대는', '도도한'], '😤': ['츤데레', '툴툴대는'],
  '😠': ['거친 목소리', '툴툴대는'], '😡': ['거친 목소리', '열정적인'], '🤬': ['거친 목소리', '광기'], '🥶': ['냉철한', '차분함'],
  '🥺': ['소심한', '부드러운'], '😳': ['소심한', '귀여운'], '😰': ['소심한'], '😨': ['소심한'],
  '🤭': ['귀여운', '장난기 있는'], '😋': ['장난기 있는', '귀여운'], '🙃': ['엉뚱한', '장난기 있는'], '🤪': ['엉뚱한', '텐션 높은'],
  '🤡': ['엉뚱한', '드라마틱'], '😴': ['나른한', '느림'], '😪': ['나른한', '느림'], '🥱': ['나른한', '귀찮은'],
  '😢': ['슬픈', '부드러운'], '😭': ['찡찡대는', '감정 표현이 풍부한'], '🥹': ['감정 표현이 풍부한', '부드러운'], '🫡': ['진지한', '권위 있는'],
  '👑': ['오만한', '권위 있는'], '💅': ['도도한', '자신감 있는'], '🔥': ['열정적인', '활기찬'], '🧊': ['냉철한', '무덤덤한'],
  '🌸': ['부드러운', '귀여운'], '🖤': ['어두운'], '🌑': ['어두운', '신비로운'], '🔮': ['신비로운'],
  '🌙': ['신비로운', '차분함'], '🎤': ['아이돌', '밝은'], '🔪': ['얀데레', '광기'], '💀': ['어두운', '광기'],
  '🦊': ['장난기 있는', '여유로운'], '🐱': ['도도한', '귀여운'], '🐶': ['친근한', '활기찬'], '🐰': ['귀여운', '소심한'],
  '🦁': ['자신감 있는', '권위 있는'], '📚': ['지적인', '차분함'], '💼': ['전문가', '진지한'], '🍷': ['우아한', '성숙한'],
  '🎩': ['고풍스러운', '우아한'], '💋': ['섹시한'],
};
const MOST_TAGS = 4;

/** The emoji one by one: a ZWJ sequence, its variation selector and skin tone stay with it. */
function graphemes(marks: string): string[] {
  const out: string[] = [];
  for (const ch of marks) {
    const last = out.length - 1;
    if (last >= 0 && (ch === ZWJ || out[last]!.endsWith(ZWJ) || ch === VS16 || MODIFIER.test(ch))) out[last] += ch;
    else out.push(ch);
  }
  return out;
}
/** Without skin tone or variation selector: 👩🏻 is 👩. */
const bare = (emoji: string): string => [...emoji].filter(ch => ch !== VS16 && !MODIFIER.test(ch)).join('');

export function cueHint(marks: string | undefined): CueHint | null {
  if (!marks) return null;
  let gender: CueHint['gender'], age = '';
  const tags: string[] = [];
  for (const emoji of graphemes(marks)) {
    const parts = bare(emoji).split(ZWJ), person = PEOPLE[parts[0]!];
    if (person && !age) {
      // 👩‍🦳: white hair; 👱‍♀️: the sign says who.
      age = parts.includes('🦳') ? '중년' : person[1];
      gender = person[0] ?? (parts.includes('♀') ? 'female' : parts.includes('♂') ? 'male' : undefined);
      continue;
    }
    for (const tag of PERSONALITY[parts[0]!] ?? []) if (!tags.includes(tag)) tags.push(tag);
  }
  if (!age && !tags.length) return null;
  return { ...(gender ? { gender } : {}), tags: [...(age ? [age] : []), ...tags].slice(0, MOST_TAGS) };
}

/**
 * The hint written into a character. `fresh`, one being made now: it takes the hint's gender (the
 * writer said so) and its tags first. One the reader already has keeps what it holds: only an unknown
 * gender and empty tags are filled.
 */
export function applyCueHint(character: Pick<TtsCharacter, 'gender' | 'tags'>, hint: CueHint, fresh: boolean): boolean {
  const before = JSON.stringify([character.gender, character.tags]);
  if (hint.gender && (fresh || character.gender === 'unknown')) character.gender = hint.gender;
  if (fresh) character.tags = [...new Set([...hint.tags, ...character.tags])].slice(0, 30);
  else if (!character.tags.length) character.tags = [...hint.tags];
  return JSON.stringify([character.gender, character.tags]) !== before;
}
