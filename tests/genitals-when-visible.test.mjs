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

