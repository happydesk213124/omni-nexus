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
test('an age field says under 18 by a number or a word', () => {
  for (const age of ['17', 17, '17살', '10대', '고등학생', '중학생', '고딩', 'high school student', 'teenager', 'child']) assert.equal(api.isUnderageAge(age), true, String(age));
  for (const age of ['18', 18, '24 years old', '20대', '', null, undefined]) assert.equal(api.isUnderageAge(age), false, String(age));
  assert.equal(api.hasUnderageLook('girl, loli'), true);
  assert.equal(api.hasUnderageLook('school uniform, childlike smile'), false, 'a uniform or a smile says nothing');
});

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

test('the scene\'s own tags go too, and only those', () => {
  assert.equal(api.withoutExposureTags('classroom, nsfw, 2::nude::, sex, window, masterpiece'), 'classroom, window, masterpiece');
  assert.equal(api.characterIsUnderage({ age: '16' }, {}), true);
  assert.equal(api.characterIsUnderage({ age: '26' }, {}), false);
});
// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ [여기까지] 위 테스트는 절대 빼거나 약하게 바꾸지 말 것.
// ╚══════════════════════════════════════════════════════════════════════════╝
