import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const built = await build({ stdin: { contents: "export * from './src/domain/character/tags'; export * from './src/domain/character/underage';", resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'error' });
const api = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);

const seen = { genitals_when_visible: true };
const woman = { name: 'A', gender: 'girl', age: '24', appearance: 'girl, long hair, pussy juice', attire: 'dress', accessories: 'pussy piercing, nipples piercing' };
const man = { name: 'B', gender: 'boy', age: '30', appearance: 'boy', attire: 'shirt', penis_size: 'huge penis' };
const compose = (who, shot, options) => api.composeCharacterCaptionTags(who, shot, options);

test('off: the wear state adds them, as ever', () => {
  assert.match(compose(woman, { wear_state: 'bottomless' }), /\bpussy\b/);
  assert.match(compose(man, { wear_state: 'completely' }), /\bhuge penis\b/);
});

test('on: no wear state adds them; what else the state says stays', () => {
  for (const wear_state of ['torn', 'bottomless', 'nude', 'completely']) {
    assert.doesNotMatch(compose(woman, { wear_state }, seen), /pussy/, `girl, ${wear_state}`);
    assert.doesNotMatch(compose(man, { wear_state }, seen), /penis/, `boy, ${wear_state}`);
  }
  assert.match(compose(woman, { wear_state: 'nude' }, seen), /2::nipples::/);
  assert.match(compose(woman, { wear_state: 'bottomless' }, seen), /2::bottomless::/);
  assert.match(compose(man, { wear_state: 'completely' }, seen), /2\.5::completely nude::/);
});

test('on: saved looks hold them back too; a saved look stays as saved', () => {
  const caption = compose(woman, { wear_state: 'nude' }, seen);
  assert.doesNotMatch(caption, /pussy juice|pussy piercing/);
  assert.match(caption, /nipples piercing/, 'only those two');
  assert.match(woman.appearance, /pussy juice/);
});

test('on: the tagger\'s word stands, and a plain penis becomes the saved size', () => {
  assert.match(compose(woman, { wear_state: 'bottomless', action: 'spread legs, pussy' }, seen), /\bpussy\b/);
  const caption = compose(man, { wear_state: 'bottomless', action: 'standing, penis' }, seen);
  assert.match(caption, /standing, huge penis/);
  assert.equal(caption.match(/penis/g).length, 1, 'once');
  assert.match(compose({ ...man, penis_size: '' }, { action: 'penis' }, seen), /\bpenis\b/, 'no size saved: as written');
  assert.match(compose(man, { action: 'penis' }), /(^|, )penis(,|$)/, 'off: nothing is swapped');
});

// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ [여기부터] 절대 빼거나 약하게 바꾸지 말 것: 미성년으로 그려지는 캐릭터의 노출 막기를 지키는 테스트 (AGENTS.md 8번).
// ╚══════════════════════════════════════════════════════════════════════════╝
// 테스트가 막는 방법: npm test가 이 파일을 돌린다. 막기 코드가 빠지거나 약해지면 아래 assert가 틀려서 빨간불(✖)이 뜬다.
// 빨간불이면 "커밋하지 말라"는 뜻이다. 테스트를 고쳐서 초록불로 만들지 말고, 막기 코드를 되돌린다.

// 나이 칸 읽기: 17, '17살', '고등학생', 'teen'은 미성년, 18·'24 years old'·빈칸은 아니라고 읽어야 한다.
// 외형 태그는 loli는 미성년, school uniform은 아님(어른도 입음).
test('an age field says under 18 by a number or a word', () => {
  for (const age of ['17', 17, '17살', '10대', '고등학생', '중학생', '고딩', 'high school student', 'teenager', 'child']) assert.equal(api.isUnderageAge(age), true, String(age));
  for (const age of ['18', 18, '24 years old', '20대', '', null, undefined]) assert.equal(api.isUnderageAge(age), false, String(age));
  assert.equal(api.hasUnderageLook('girl, loli'), true);
  assert.equal(api.hasUnderageLook('school uniform, childlike smile'), false, 'a uniform or a smile says nothing');
});

// 핵심: 17살 캐릭터를 알몸·성행위로 요청하고 어떤 설정을 켜도, 캡션에 nude·pussy·nipple 같은 노출 태그가 하나도 없어야 한다.
// 옷(dress)과 나머지 행동(standing)은 그대로 남아야 한다. 외형 loli, 그 컷의 나이, 입은 코스튬의 나이도 똑같이 막는다.
test('someone written as under 18 is never captioned exposed, whatever is asked or switched on', () => {
  const minor = { name: 'C', gender: 'girl', age: '17', appearance: 'girl, pussy juice', attire: 'dress', accessories: 'nipple rings' };
  for (const options of [{}, seen]) for (const wear_state of ['torn', 'topless', 'bottomless', 'nude', 'completely']) {
    const caption = compose(minor, { wear_state, action: 'standing, pussy', sex: 'vaginal' }, options);
    assert.doesNotMatch(caption, /nude|topless|bottomless|nsfw|pussy|penis|nipple|vaginal/i, `${wear_state}: ${caption}`);
    assert.match(caption, /\bdress\b/, 'dressed as usual');
    assert.match(caption, /\bstanding\b/, 'the rest of the action stays');
  }
  assert.doesNotMatch(compose({ ...minor, age: '', appearance: 'girl, loli' }, { wear_state: 'nude' }), /nsfw|nipples/);
  assert.doesNotMatch(compose({ ...minor, age: '24' }, { wear_state: 'nude', age: '고등학생' }), /nsfw|nipples/, 'what the shot says counts too');
  const costumed = { ...minor, age: '24', costumes: [{ name: 'default' }, { name: 'young', age: '12' }] };
  assert.doesNotMatch(compose(costumed, { wear_state: 'nude', costume: 'young' }), /nsfw|nipples/, 'the costume worn counts');
  assert.match(compose(costumed, { wear_state: 'nude', costume: 'default' }), /nsfw/, 'an adult is not touched');
});

// 장면 태그(컷 전체 프롬프트)에서도 nsfw·nude·sex만 빠지고 classroom·window 같은 건 남아야 한다.
test('the scene\'s own tags go too, and only those', () => {
  assert.equal(api.withoutExposureTags('classroom, nsfw, 2::nude::, sex, window, masterpiece'), 'classroom, window, masterpiece');
  assert.equal(api.characterIsUnderage({ age: '16' }, {}), true);
  assert.equal(api.characterIsUnderage({ age: '26' }, {}), false);
});

// 나이 칸 구멍 막기: '15~16', '100 (looks 15)', '17.5'처럼 숫자가 여럿이거나 소수여도 하나라도 18 미만이면 막는다.
test('every number in an age field counts: a range, a look beside a lore age, a half year', () => {
  for (const age of ['15~16', '100 (looks 15)', '17.5', '1000살, 외형 16']) assert.equal(api.isUnderageAge(age), true, age);
  for (const age of ['1000살', '18~19', '24 (160cm)']) assert.equal(api.isUnderageAge(age), false, age);
});

// 나이 제한 설정은 없다(1.4.13에 제거). 설정에 무엇이 남아 있든(옛 저장: 꺼짐, 10살, 단어 비움) 18세 미만과 기본 단어는 항상 막고,
// 19살은 그릴 수 있다. 어떤 설정도 가드를 약하게 만들지 못한다.
test('the under-18 guard has no setting: whatever a card says, under 18 and the built-in words count, and 18 is the line', () => {
  const left = [{}, { underage_strict: false }, { underage_age: 10 }, { underage_age: 30 }, { underage_tags: '' }, { underage_strict: false, underage_age: 5, underage_tags: '' }];
  for (const card of left) {
    const rules = api.underageRules(card), what = JSON.stringify(card);
    assert.equal(rules.age, 18, what);
    assert.equal(api.isUnderageAge('17', rules), true, `17 · ${what}`);
    assert.equal(api.isUnderageAge('19', rules), false, `19 · ${what}`);
    assert.equal(api.hasUnderageLook('girl, loli', rules), true, `loli · ${what}`);
    assert.doesNotMatch(compose({ ...woman, age: '15' }, { wear_state: 'nude' }, card), /nsfw|nipples/, `15 · ${what}`);
    assert.match(compose({ ...woman, age: '19' }, { wear_state: 'nude' }, card), /nsfw/, `19 · ${what}`);
  }
  assert.equal(api.isUnderageAge('17', { age: 10 }), true, 'an age under 18 handed straight in is 18');
  assert.equal(api.UNDERAGE_FLOOR, 18);
});

// 기본 단어는 전부 막고, child는 children·childrencafe를, loli는 lolipop을, 교복은 막지 않는다.
// 설정 파일·저장 코드·설정 화면 어디에도 나이 제한 칸이 다시 생기지 않았는지도 본다.
test('every built-in word counts; a word alone keeps clear of children, childrencafe and lolipop; no 나이 제한 box anywhere', async () => {
  const words = ['loli', 'shota', 'child', 'toddler', 'kid', 'teen', 'teenage', 'teenager', 'minor', 'underage', 'elementary school', 'middle school', 'junior high school', 'high school', 'highschool', '초등학생', '중학생', '고등학생', '초딩', '중딩', '고딩', '미성년', '어린이', '유아', '아동'];
  for (const word of words) assert.equal(api.isUnderageAge(word) || api.hasUnderageLook(word), true, word);
  for (const look of ['children', 'childrencafe', 'childish smile', 'holding lolipop', 'school uniform']) assert.equal(api.hasUnderageLook(`girl, ${look}`), false, look);
  const fs = await import('node:fs');
  for (const file of ['src/config/default-settings.json', 'src/config/reset-factory.json']) assert.equal(/underage_/.test(fs.readFileSync(file, 'utf8')), false, file);
  for (const file of ['tools/vendor-patches/runtime-rebuild.mjs', 'docs/settings-ux-preview.html', 'src/settings-ux/tab-html.ts']) assert.equal(/nx-underage|underage_(?:strict|age|tags)/.test(fs.readFileSync(file, 'utf8')), false, file);
});

// 감정 에셋 nude 허락 판정: 모르는 사람(삽화 캐릭터 없음)은 안 됨, 성인은 됨, 빈 나이는 18로 침.
// 15살이거나 코스튬 하나라도 12살·loli면 안 됨. 옛 저장에 남은 나이 제한 값(꺼짐, 10살)도 풀어 주지 못함.
test('기본 nude and 천박모드 draw nobody unknown, and nobody under 18 in any costume', () => {
  assert.equal(api.nudeForbidden(null), true, 'unknown');
  assert.equal(api.nudeForbidden(woman), false, 'an adult may be');
  assert.equal(api.nudeForbidden({ ...woman, age: '' }), false, 'an empty age says nothing: as 18');
  assert.equal(api.nudeForbidden({ ...woman, age: '15' }), true);
  assert.equal(api.nudeForbidden({ ...woman, costumes: [{ name: 'default' }, { name: 'young', age: '12' }] }), true, 'one costume written young keeps them all clothed');
  assert.equal(api.nudeForbidden({ ...woman, costumes: [{ name: 'default', appearance: 'girl, loli' }] }), true);
  assert.equal(api.nudeForbidden({ ...woman, age: '15' }, api.underageRules({ underage_strict: false, underage_age: 10 })), true, 'no saved value loosens it');
});
// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ [여기까지] 위 테스트는 절대 빼거나 약하게 바꾸지 말 것.
// ╚══════════════════════════════════════════════════════════════════════════╝
