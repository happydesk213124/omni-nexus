// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ [여기부터] 절대 빼거나 약하게 바꾸지 말 것. 이 플러그인에서 가장 중요한 코드다.
// ║ 나이는 그림의 외형을 정한다: 15로 적으면 15살로 그려진다.
// ║ 설정상 나이가 몇 살이든, 미성년으로 그려지는 캐릭터의 노출 그림은 만들지 않는다.
// ╚══════════════════════════════════════════════════════════════════════════╝
/**
 * Someone written as under 18 is never drawn exposed, whatever a shot or a saved look asks for. Only what is written
 * can be told: an age left empty says nothing here.
 */
import { cleanText, splitTagTokens } from '../../core/util/text.ts';
import { parseAgeYears } from './looks-fields.ts';

const AGE_WORDS = /초등학생|중학생|고등학생|초딩|중딩|고딩|미성년|어린이|유아|아동|\b(?:elementary|middle|junior high|high)[ -]?school|\bhighschool|\bunderage\b|\bminor\b|\bchild\b|\bkid\b|\bteen(?:age|ager)?\b|\bloli\b|\bshota\b|\btoddler\b/i;
const LOOK_WORDS = /\b(?:loli|shota|child|toddler)\b/i;
const EXPOSURE = /\b(?:nude|naked|topless|bottomless|nsfw|pussy|vagina|vulva|penis|testicles?|nipples?|areolae?|breasts? out|sex|fellatio|paizuri|cunnilingus|handjob|footjob|fingering|masturbation|orgasm|ejaculation|cum|anal|vaginal|oral|x-ray|cross-section)\b/i;

/** An age field that says under 18: a number below it, or a word for it. */
export function isUnderageAge(raw: unknown): boolean {
  const years = parseAgeYears(raw);
  return AGE_WORDS.test(cleanText(raw, 80)) || (years !== null && years < 18);
}

/** Look tags that say so. A school uniform does not: adults wear them too. */
export function hasUnderageLook(raw: unknown): boolean {
  return LOOK_WORDS.test(cleanText(raw, 4000));
}

export function withoutExposureTags(tags: unknown): string {
  return splitTagTokens(tags).filter(tag => !EXPOSURE.test(tag)).join(', ');
}
// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ [여기까지] 위 코드는 절대 빼거나 약하게 바꾸지 말 것.
// ╚══════════════════════════════════════════════════════════════════════════╝
