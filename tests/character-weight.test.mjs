import test from 'node:test';
import assert from 'node:assert/strict';
import { weightCharacterPrompt, stripCharacterEmphasis, readCharacterWeightGroup, normalizeCharacterWeight } from '../.test-build/character-weight.mjs';

test('half mode strips existing numeric and bracket emphasis across the whole caption', () => {
  const source = 'boy, 2::muscular male::, 1.7::gyaruo::, 1.4::faceless male::, {blonde hair}, [short hair], 2::shirt, jeans::, smile';
  assert.equal(weightCharacterPrompt(source), '0.5::boy, muscular male, gyaruo, faceless male, blonde hair, short hair, shirt, jeans, smile::');
  assert.equal(weightCharacterPrompt(''), '');
  assert.equal(weightCharacterPrompt('0.5::boy, smile::'), '0.5::boy, smile::');
  assert.equal(stripCharacterEmphasis('2::a, 1.4::b::::'), 'a, b');
  assert.equal(stripCharacterEmphasis('\\{literal\\}, blue eyes'), '\\{literal\\}, blue eyes');
});

test('image weight groups round-trip zero and decimals without changing tail weights', () => {
  for (const weight of [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 1]) {
    const prompt = weightCharacterPrompt('boy, 2::white hair::', weight) + ', 2::shirt::, 1.7::smile::';
    assert.equal(prompt, `${weight}::boy, white hair::, 2::shirt::, 1.7::smile::`);
    assert.deepEqual(readCharacterWeightGroup(prompt), { weight, body: 'boy, white hair, 2::shirt::, 1.7::smile::' });
  }
  assert.deepEqual(readCharacterWeightGroup('0.50::boy::'), { weight: 0.5, body: 'boy' });
  for (const source of ['0.5::boy, 2::smile::::', '2::boy::', 'boy']) {
    assert.equal(readCharacterWeightGroup(source), null, source);
  }
  for (const value of [undefined, null, '', 'garbage']) assert.equal(normalizeCharacterWeight(value), 0.5);
  assert.equal(normalizeCharacterWeight('0'), 0);
});
