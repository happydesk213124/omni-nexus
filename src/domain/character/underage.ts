// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ [여기부터] 절대 빼거나 약하게 바꾸지 말 것. 이 플러그인에서 가장 중요한 코드다.
// ║ 나이는 그림의 외형을 정한다: 15로 적으면 15살로 그려진다.
// ║ 설정상 나이가 몇 살이든, 미성년으로 그려지는 캐릭터의 노출 그림은 만들지 않는다.
// ╚══════════════════════════════════════════════════════════════════════════╝
/**
 * Someone written as under 18 is never drawn exposed, whatever a shot or a saved look asks for. Only what is written
 * can be told: an age left empty says nothing here.
 *
 * 생성 옵션 › 나이 제한 can only add to this: a higher age, more words. Under 18 and the words below count whatever it
 * says, switched off included, and its age never goes under 18.
 */
import { cleanText, splitTagTokens } from '../../core/util/text.ts';

// ┌──────────────────────────────────────────────────────────────────────────┐
// │ 아래 기본 단어 목록(AGE_WORDS, LOOK_WORDS)은 절대 지우거나 줄이지 말 것.
// │ 설정 칸(나이 제한)은 여기에 더하기만 한다. 칸에서 지워도 이 단어들은 항상 막는다.
// │ 엉뚱한 걸 막는 단어가 있으면 그 경우만 좁히고, 목록 자체를 빼지 않는다.
// └──────────────────────────────────────────────────────────────────────────┘
const AGE_WORDS =/초등학생|중학생|고등학생|초딩|중딩|고딩|미성년|어린이|유아|아동|\b(?:elementary|middle|junior high|high)[ -]?school|\bhighschool|\bunderage\b|\bminor\b|\bchild\b|\bkid\b|\bteen(?:age|ager)?\b|\bloli\b|\bshota\b|\btoddler\b/i;
const LOOK_WORDS = /\b(?:loli|shota|child|toddler)\b/i;
const EXPOSURE = /\b(?:nude|naked|topless|bottomless|nsfw|pussy|vagina|vulva|penis|testicles?|nipples?|areolae?|breasts? out|sex|fellatio|paizuri|cunnilingus|handjob|footjob|fingering|masturbation|orgasm|ejaculation|cum|anal|vaginal|oral|x-ray|cross-section)\b/i;

export const UNDERAGE_FLOOR = 18;
/**
 * 미성년으로 볼 단어 as it starts: every word above, written as the box reads them, so more can be written beside them.
 * The words above count whatever the box says: one taken out of it still counts.
 */
export const UNDERAGE_TAGS_DEFAULT = 'loli, shota, child, toddler, kid, teen, teenage, teenager, minor, underage, elementary school, middle school, junior high school, high school, highschool, 초등학생, 중학생, 고등학생, 초딩, 중딩, 고딩, 미성년, 어린이, 유아, 아동';
/** The box's first value, before it showed every word above: a save still holding it is moved on (schema.ts). */
export const UNDERAGE_TAGS_FIRST = 'loli, shota, child, toddler';
/**
 * What 생성 옵션 › 나이 제한 adds: the age under which someone counts as under it, and the box's words. Looks are written
 * as tags or as plain sentences, commas or none, so a word is looked for in the whole field: `child` where it stands
 * alone, `*loli` inside other words too.
 */
export interface UnderageRules { age: number; words: RegExp | null }

/** The age 나이 제한 asks for: 18 to 99, 18 when it says nothing readable. */
export function normalizeUnderageAge(raw: unknown): number {
  const n = raw == null || raw === '' ? NaN : Math.round(Number(raw));
  return Number.isFinite(n) ? Math.min(99, Math.max(UNDERAGE_FLOOR, n)) : UNDERAGE_FLOOR;
}

const escapeRegex = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const plain = (text: string): string => text.normalize('NFKC').toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
/** A word of the box as written, emphasis aside (`2::Loli::` and `{loli}` are loli). */
function bareWord(word: string): string {
  let text = word.trim();
  for (let i = 0; i < 3; i++) text = text.replace(/^-?\d+(?:\.\d+)?::([\s\S]*?)::$/, '$1').replace(/^[{[(]+([\s\S]*?)[}\])]+$/, '$1').trim();
  return plain(text);
}
/**
 * The box's words, commas or lines between them. A Latin word is found where it stands alone (child: cute child, a
 * child, not children or childrencafe); `*` finds it inside other words too (*loli: lolicon, loligirl). A Korean word is
 * found inside a word either way, for it takes its particles: 중학생이다.
 */
function boxPattern(raw: unknown): RegExp | null {
  const rules = [...new Set(String(raw ?? '').split(/[,\n]/).map(rule => rule.trim()).filter(Boolean))].slice(0, 400);
  const parts = new Set(rules.map(rule => {
    const anywhere = rule.startsWith('*'), word = bareWord(anywhere ? rule.slice(1) : rule);
    if (!word) return '';
    return anywhere || !/^[\x20-\x7e]+$/.test(word) ? escapeRegex(word) : `(?<![a-z0-9])${escapeRegex(word)}(?![a-z0-9])`;
  }).filter(Boolean));
  return parts.size ? new RegExp([...parts].join('|'), 'i') : null;
}

export function underageRules(card?: { underage_strict?: unknown; underage_age?: unknown; underage_tags?: unknown } | null): UnderageRules {
  if (!card || card.underage_strict === false) return { age: UNDERAGE_FLOOR, words: null };
  return { age: normalizeUnderageAge(card.underage_age), words: boxPattern(card.underage_tags) };
}

const saysWord = (text: string, rules?: UnderageRules): boolean => !!rules?.words?.test(plain(text));
/** Every number an age field holds, 15~16 and 100 (looks 15) alike: any one under the limit says so. */
const ageNumbers = (text: string): number[] => (text.match(/\d+(?:\.\d+)?/g) || []).map(Number).filter(n => n >= 1);

/** An age field that says under 18 (or under 나이 제한's age): a number below it, or a word for it. */
export function isUnderageAge(raw: unknown, rules?: UnderageRules): boolean {
  const text = cleanText(raw, 80), limit = Math.max(UNDERAGE_FLOOR, rules?.age ?? UNDERAGE_FLOOR);
  return AGE_WORDS.test(text) || ageNumbers(text).some(n => n < limit) || saysWord(text, rules);
}

/** Look tags that say so. A school uniform does not: adults wear them too. */
export function hasUnderageLook(raw: unknown, rules?: UnderageRules): boolean {
  const text = cleanText(raw, 4000);
  return LOOK_WORDS.test(text) || saysWord(text, rules);
}

export function withoutExposureTags(tags: unknown): string {
  return splitTagTokens(tags).filter(tag => !EXPOSURE.test(tag)).join(', ');
}
// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ [여기까지] 위 코드는 절대 빼거나 약하게 바꾸지 말 것.
// ╚══════════════════════════════════════════════════════════════════════════╝
