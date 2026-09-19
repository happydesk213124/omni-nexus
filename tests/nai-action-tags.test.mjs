import assert from 'node:assert/strict';
import test from 'node:test';

import { applyInteractionKeys } from '../.test-build/nai-action-tags.mjs';
import { composeCharacterCaptionTags } from '../.test-build/character-tags.mjs';

test('keys translate to prefixed tags, lowercased and trimmed', () => {
  const out = applyInteractionKeys({
    source: 'Hug from behind,  licking nipples ',
    target: 'being hugged',
    mutual: 'Hug',
  });
  assert.equal(out.tags, 'source#hug from behind, source#licking nipples, target#being hugged, mutual#hug');
});

test('empties, null/none and duplicates are dropped across keys', () => {
  const out = applyInteractionKeys({
    source: 'hug, hug, , null, none',
    target: 'HUG',
    mutual: '',
  });
  assert.equal(out.tags, 'source#hug');
});

test('a verb in both action and keys is emitted once, prefixed', () => {
  const out = applyInteractionKeys({ action: 'hug, smiling, standing', source: 'hug' });
  assert.equal(out.tags, 'source#hug');
  assert.equal(out.action, 'smiling, standing');
});

test('stray inline prefixes in action survive untouched', () => {
  const out = applyInteractionKeys({ action: 'source#hug, smiling', source: 'hug, kiss' });
  assert.equal(out.tags, 'source#kiss');
  assert.equal(out.action, 'source#hug, smiling');
});

test('a prefixed form typed into a key never doubles the prefix', () => {
  const out = applyInteractionKeys({ source: 'source#hug' });
  assert.equal(out.tags, 'source#hug');
});

test('no keys means no tags and action passes through', () => {
  const out = applyInteractionKeys({ action: 'smiling, standing' });
  assert.equal(out.tags, '');
  assert.equal(out.action, 'smiling, standing');
  assert.deepEqual(applyInteractionKeys(null), { action: '', tags: '' });
  assert.deepEqual(applyInteractionKeys({}), { action: '', tags: '' });
});

test('compose appends interaction tags to the character caption', () => {
  const caption = composeCharacterCaptionTags(null, {
    action: 'smiling',
    source: 'hug from behind',
    target: 'being hugged',
    sex: 'girl',
  });
  assert.match(caption, /source#hug from behind/);
  assert.match(caption, /target#being hugged/);
  assert.match(caption, /smiling/);
});

test('compose emits no prefixed tags without keys', () => {
  const caption = composeCharacterCaptionTags(null, { action: 'smiling', sex: 'girl' });
  assert.doesNotMatch(caption, /source#|target#|mutual#/);
});
