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

// 생성 옵션 › 나이 제한은 더 세게만: 숫자를 10으로 해도 18로 막고, 20으로 하면 19도 막는다.
// 토글을 끄거나 칸을 비워도 18세 미만과 기본 단어(loli 등)는 계속 막는다. 칸 단어의 *, 쉼표 없는 문장, 한글 조사도 확인한다.
test('나이 제한 only adds: a higher age, more words; off or cleared, under 18 and the built-in words still count', () => {
  const rules = card => api.underageRules(card);
  assert.equal(api.normalizeUnderageAge(5), 18, 'never under 18');
  assert.equal(api.normalizeUnderageAge(150), 99);
  assert.equal(api.normalizeUnderageAge(''), 18);
  assert.equal(api.isUnderageAge('17', rules({ underage_age: 10 })), true, 'an age under 18 asked for is 18');
  assert.equal(api.isUnderageAge('17', { age: 10, words: null }), true, 'even handed straight in');
  assert.equal(api.isUnderageAge('19', rules({ underage_age: 20 })), true, 'a higher age counts');
  assert.equal(api.isUnderageAge('20', rules({ underage_age: 20 })), false);
  assert.equal(api.isUnderageAge('19', rules({ underage_strict: false, underage_age: 20 })), false, 'off: back to 18');
  assert.equal(api.isUnderageAge('17', rules({ underage_strict: false })), true, 'off: under 18 still counts');
  // A word is looked for in the whole field, tags or sentences, commas or none: alone, or with * inside other words too.
  const more = rules({ underage_tags: 'petite, *tiny, 꼬마' });
  assert.equal(api.hasUnderageLook('girl, petite, smile', more), true, 'a word written counts');
  assert.equal(api.hasUnderageLook('a very petite girl with long hair', more), true, 'in a sentence, no commas');
  assert.equal(api.hasUnderageLook('girl, 2::Petite::', more), true, 'emphasis and case aside');
  assert.equal(api.hasUnderageLook('girl, petiteness', more), false, 'a Latin word stands alone');
  assert.equal(api.hasUnderageLook('girl, tinybody', more), true, '*: inside other words too');
  assert.equal(api.isUnderageAge('설정상 꼬마다', more), true, 'a Korean word is found with its particles');
  assert.equal(api.hasUnderageLook('girl, loli', rules({ underage_tags: '' })), true, 'cleared: the built-in words still count');
  assert.equal(api.hasUnderageLook('girl, loli', rules({ underage_strict: false, underage_tags: 'petite' })), true, 'off: likewise');
  assert.equal(api.hasUnderageLook('girl, petite', rules({ underage_strict: false, underage_tags: 'petite' })), false, 'off: the added words rest');
  const nineteen = { ...woman, age: '19' };
  assert.match(compose(nineteen, { wear_state: 'nude' }), /nsfw/, 'at 18 as ever');
  assert.doesNotMatch(compose(nineteen, { wear_state: 'nude' }, { underage_age: 20 }), /nsfw|nipples/, 'a caption follows it');
  assert.doesNotMatch(compose({ ...woman, appearance: 'girl, petite' }, { wear_state: 'nude' }, { underage_tags: 'petite' }), /nsfw|nipples/);
});

// 칸 기본값의 모든 단어가 코드 기본 막기에도 있어야 한다(칸에서 지워도 막힌다는 말이 거짓이 되지 않게).
// child는 children·childrencafe를, loli는 lolipop을 막지 않는다. 기본값 목록은 설정 파일·저장 코드·설정 화면에서 같아야 한다.
test('the box starts with every built-in word, each counting with it switched off; a word alone keeps clear of children, childrencafe and lolipop', async () => {
  const off = api.underageRules({ underage_strict: false });
  const words = api.UNDERAGE_TAGS_DEFAULT.split(', ');
  assert.ok(words.length >= 20 && words.every(word => !word.startsWith('*')));
  for (const word of words) assert.equal(api.isUnderageAge(word, off) || api.hasUnderageLook(word, off), true, word);
  const box = api.underageRules({ underage_tags: api.UNDERAGE_TAGS_DEFAULT });
  for (const look of ['children', 'childrencafe', 'childish smile', 'holding lolipop', 'school uniform', 'teenage mutant']) assert.equal(api.hasUnderageLook(`girl, ${look}`, box), look === 'teenage mutant', look);
  assert.equal(api.hasUnderageLook('girl, holding lolipop', off), false, 'the built-in words alone neither');
  assert.equal(api.hasUnderageLook('girl, holding lolipop', api.underageRules({ underage_tags: '*loli' })), true, '*loli is the user\'s to write');
  assert.equal(api.hasUnderageLook('girl, childrencafe', api.underageRules({ underage_tags: '*child' })), true);
  // One list everywhere it is written down: the defaults, the factory reset, the save when the box is not on screen, the preview.
  const fs = await import('node:fs');
  for (const file of ['src/config/default-settings.json', 'src/config/reset-factory.json']) assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).card.underage_tags, api.UNDERAGE_TAGS_DEFAULT, file);
  assert.ok(fs.readFileSync('tools/vendor-patches/runtime-rebuild.mjs', 'utf8').includes(JSON.stringify(api.UNDERAGE_TAGS_DEFAULT)), 'runtime-rebuild.mjs');
  assert.ok(fs.readFileSync('docs/settings-ux-preview.html', 'utf8').includes(`>${api.UNDERAGE_TAGS_DEFAULT}</textarea>`), 'settings-ux-preview.html');
});

// 감정 에셋 nude 허락 판정: 모르는 사람(삽화 캐릭터 없음)은 안 됨, 성인은 됨, 빈 나이는 18로 침.
// 15살이거나 코스튬 하나라도 12살·loli면 안 됨. 나이 제한을 20으로 올리면 19도 안 됨.
test('기본 nude and 천박모드 draw nobody unknown, and nobody under 18 in any costume', () => {
  assert.equal(api.nudeForbidden(null), true, 'unknown');
  assert.equal(api.nudeForbidden(woman), false, 'an adult may be');
  assert.equal(api.nudeForbidden({ ...woman, age: '' }), false, 'an empty age says nothing: as 18');
  assert.equal(api.nudeForbidden({ ...woman, age: '15' }), true);
  assert.equal(api.nudeForbidden({ ...woman, costumes: [{ name: 'default' }, { name: 'young', age: '12' }] }), true, 'one costume written young keeps them all clothed');
  assert.equal(api.nudeForbidden({ ...woman, costumes: [{ name: 'default', appearance: 'girl, loli' }] }), true);
  assert.equal(api.nudeForbidden({ ...woman, age: '19' }, api.underageRules({ underage_age: 20 })), true, '나이 제한 likewise');
});
// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ [여기까지] 위 테스트는 절대 빼거나 약하게 바꾸지 말 것.
// ╚══════════════════════════════════════════════════════════════════════════╝
