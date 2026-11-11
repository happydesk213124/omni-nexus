import type { TtsCharacter } from '../../core/tts-types';

/**
 * 첫 대사 이모지: with the TTS switch on, each character's first cue in a reply carries two emoji before
 * the name, `👩🥺 하린 (soft tone): "…"`: age and gender, then personality. They are read
 * here into what a new character's voice is chosen by: the gender outright, the age and
 * personality as mood tags in the words the sample voices are tagged with (청년, 소심한…).
 *
 * The prompt only names the six age-gender emoji; the model picks the personality one
 * itself. The table below knows the faces, hearts, animals and things a model reaches for; one it
 * does not know is kept as it is, a tag of its own: a model that picks the voice reads an emoji
 * well (only the embedding leaves it out, see voice-words.ts). Tags are the Korean words shown;
 * they go out to a model in English.
 */
export interface CueHint { gender?: 'female' | 'male'; tags: string[] }

const ZWJ = String.fromCodePoint(0x200d), VS16 = String.fromCodePoint(0xfe0f);
const MODIFIER = /\p{Emoji_Modifier}/u;

// The voice library's ages are six since 1.4.14: 어린이, 10대, 청년, 성인, 중년, 노인. A grown-up with red hair
// (👩‍🦰 👨‍🦰) is a mature adult; white hair (👩‍🦳) and 👵 👴 🧓 are elderly.
const CHILD = ['어린이'], YOUNG = ['청년'], ADULT = ['성인'], MATURE = ['성인', '성숙한'], ELDERLY = ['노인'];
const PEOPLE: Record<string, readonly [CueHint['gender'], readonly string[]]> = {
  '👧': ['female', CHILD], '👦': ['male', CHILD], '🧒': [undefined, CHILD], '👶': [undefined, CHILD],
  '👩': ['female', YOUNG], '👨': ['male', YOUNG], '🧑': [undefined, YOUNG], '👱': [undefined, YOUNG],
  '👵': ['female', ELDERLY], '👴': ['male', ELDERLY], '🧓': [undefined, ELDERLY],
  '🧔': ['male', ADULT], '🤵': ['male', ADULT], '👸': ['female', YOUNG], '🤴': ['male', YOUNG], '👰': ['female', YOUNG],
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
  // More faces.
  '😀': ['밝은', '명랑한'], '😃': ['밝은', '활기찬'], '😅': ['소심한', '친근한'], '🤣': ['텐션 높은', '장난기 있는'],
  '😂': ['명랑한', '감정 표현이 풍부한'], '😉': ['장난기 있는', '능글맞은'], '🥲': ['슬픈', '부드러운'], '☺': ['수줍은', '상냥한'],
  '😚': ['다정한', '귀여운'], '😙': ['다정한', '부드러운'], '😗': ['장난기 있는', '귀여운'], '😛': ['장난기 있는', '엉뚱한'],
  '😜': ['장난기 있는', '엉뚱한'], '😝': ['장난기 있는', '텐션 높은'], '🤑': ['능글맞은', '자신감 있는'], '🤫': ['신비로운', '장난기 있는'],
  '🤐': ['과묵한', '무덤덤한'], '🤨': ['냉철한', '도도한'], '😬': ['소심한', '엉뚱한'], '🤥': ['능글맞은'], '😔': ['우울한', '차분함'],
  '🤤': ['엉뚱한', '나른한'], '😷': ['피곤한', '차분함'], '🤒': ['피곤한'], '🤕': ['피곤한'], '🤢': ['피곤한'], '🤮': ['피곤한'],
  '🥵': ['섹시한', '열정적인'], '🥴': ['엉뚱한', '나른한'], '😵': ['엉뚱한', '허당'], '🤯': ['텐션 높은', '드라마틱'],
  '🤠': ['당당한', '친근한'], '🥳': ['신난', '활기찬'], '🥸': ['엉뚱한', '능글맞은'], '😕': ['소심한'], '🫤': ['무덤덤한'],
  '😟': ['소심한', '다정한'], '🙁': ['슬픈'], '☹': ['슬픈', '우울한'], '😮': ['순진한'], '😯': ['순진한', '차분함'],
  '😲': ['감정 표현이 풍부한'], '😦': ['겁먹은'], '😧': ['겁먹은'], '😥': ['울먹이는', '부드러운'], '😱': ['겁먹은', '드라마틱'],
  '😖': ['찡찡대는'], '😣': ['찡찡대는'], '😞': ['우울한'], '😓': ['피곤한', '소심한'], '😩': ['찡찡대는', '피곤한'], '😫': ['피곤한'],
  '👿': ['악당', '광기'], '☠': ['어두운', '악당'], '💩': ['엉뚱한'], '👹': ['거친 목소리', '악당'], '👺': ['거친 목소리', '악당'],
  '👻': ['장난기 있는', '신비로운'], '👽': ['신비로운', '기계적인'], '🤖': ['기계적인', '단조로운'],
  '😺': ['명랑한', '귀여운'], '😸': ['명랑한', '장난기 있는'], '😹': ['장난기 있는'], '😻': ['다정한', '귀여운'], '😼': ['능글맞은', '도도한'],
  '😽': ['다정한'], '🙀': ['겁먹은'], '😿': ['슬픈'], '😾': ['툴툴대는'], '🫠': ['나른한', '수줍은'], '🫢': ['수줍은', '귀여운'],
  '🫣': ['수줍은', '소심한'], '🫥': ['무덤덤한', '과묵한'], '🫨': ['겁먹은', '텐션 높은'],
  // Hearts, signs and things.
  '🫶': ['다정한', '따뜻한'], '❤': ['다정한', '따뜻한'], '💕': ['다정한', '귀여운'], '💖': ['다정한', '귀여운'], '💗': ['다정한', '애교'],
  '💓': ['다정한', '귀여운'], '💔': ['슬픈', '우울한'], '💙': ['차분함', '상냥한'], '💜': ['신비로운', '우아한'], '💚': ['친근한', '편안한'],
  '💛': ['밝은', '명랑한'], '🧡': ['따뜻한', '친근한'], '🤍': ['순수한', '부드러운'], '✨': ['밝은', '아이돌'], '⭐': ['밝은', '자신감 있는'],
  '🌟': ['밝은', '자신감 있는'], '⚡': ['활기찬', '텐션 높은'], '❄': ['차가운', '냉철한'], '☀': ['밝은', '활기찬'], '🌈': ['밝은', '순수한'],
  '🌹': ['우아한', '요염한'], '🌷': ['상냥한', '부드러운'], '🍀': ['순수한', '친근한'], '🍭': ['귀여운', '애교'], '🍬': ['귀여운', '애교'],
  '🧸': ['귀여운', '순진한'], '🎀': ['귀여운', '애교'], '🗡': ['진지한', '냉철한'], '⚔': ['진지한', '영웅적인'], '🛡': ['진지한', '위엄 있는'],
  '🏹': ['냉철한', '차분함'], '🔫': ['냉철한', '쿨함'], '💣': ['텐션 높은', '광기'], '🎮': ['엉뚱한', '신난'], '🎸': ['쿨함', '열정적인'],
  '🎨': ['몽환적인', '감정 표현이 풍부한'], '🎭': ['드라마틱', '감정 표현이 풍부한'], '📖': ['지적인', '차분함'], '🔬': ['지적인', '전문가'],
  '🧪': ['지적인', '엉뚱한'], '💻': ['지적인', '무뚝뚝한'], '☕': ['차분함', '편안한'], '🍺': ['친근한', '수다스러운'], '🍻': ['친근한', '수다스러운'],
  '🚬': ['허스키', '피곤한'], '💤': ['나른한', '피곤한'], '💢': ['화난', '툴툴대는'], '💦': ['소심한', '허당'], '🙏': ['상냥한', '존댓말'],
  '👍': ['친근한', '당당한'], '💪': ['활기찬', '당당한'], '🫦': ['요염한', '섹시한'], '👅': ['장난기 있는', '요염한'], '👀': ['엉뚱한', '수다스러운'],
  // Animals.
  '🐺': ['거친 목소리', '쿨함'], '🐍': ['능글맞은', '요염한'], '🐉': ['위엄 있는', '권위 있는'], '🐲': ['위엄 있는', '권위 있는'],
  '🦋': ['몽환적인', '우아한'], '🐻': ['다정한', '느릿느릿'], '🐼': ['귀여운', '나른한'], '🐹': ['귀여운', '소심한'], '🦄': ['몽환적인', '순수한'],
  '🐯': ['당당한', '자신감 있는'], '🦅': ['위엄 있는', '냉철한'], '🐧': ['귀여운', '허당'], '🐸': ['엉뚱한'], '🐷': ['귀여운', '애교'],
  '🐮': ['느릿느릿', '편안한'], '🦉': ['지적인', '차분함'], '🐦': ['명랑한', '수다스러운'], '🐟': ['무덤덤한'],
};
const MOST_TAGS = 4;
/** Every tag word the table can give (each must have its English: tests/voice-variety). */
export function cueEmojiWords(): string[] { return [...new Set([...Object.values(PEOPLE).flatMap(([, tags]) => tags), ...Object.values(PERSONALITY).flat()])]; }

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
  let gender: CueHint['gender'], age: readonly string[] = [];
  const mood: string[] = [];
  for (const emoji of graphemes(marks)) {
    const parts = bare(emoji).split(ZWJ), person = PEOPLE[parts[0]!];
    if (person && !age.length) {
      // 👩‍🦳: white hair, elderly; 👩‍🦰: red hair on a grown-up, mature; 👱‍♀️: the sign says who.
      age = parts.includes('🦳') ? ELDERLY : parts.includes('🦰') && person[1] === YOUNG ? MATURE : person[1];
      gender = person[0] ?? (parts.includes('♀') ? 'female' : parts.includes('♂') ? 'male' : undefined);
      continue;
    }
    const known = PERSONALITY[parts[0]!];
    // One the table does not know goes as it is: whoever picks the voice reads it.
    for (const tag of known ?? [bare(emoji)]) if (tag && !mood.includes(tag)) mood.push(tag);
  }
  // The age first, whichever emoji came first; a mood word the age already says (🍷's 성숙한) once.
  const tags = [...age, ...mood.filter(tag => !age.includes(tag))];
  if (!tags.length) return null;
  return { ...(gender ? { gender } : {}), tags: tags.slice(0, MOST_TAGS) };
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
