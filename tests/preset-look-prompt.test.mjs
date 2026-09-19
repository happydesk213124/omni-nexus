import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EXAMPLE_SHOT_TAIL,
  joinCharacterPreviewPrompt,
  joinExampleShotPrompt,
  joinPresetLookPrompt,
  PRESET_LOOK_TAIL,
} from '../.test-build/preset-look-prompt.mjs';

test('joinCharacterPreviewPrompt does not append 1girl, smile', () => {
  assert.equal(joinCharacterPreviewPrompt('best quality, long hair'), 'best quality, long hair');
  assert.equal(joinCharacterPreviewPrompt('best quality,'), 'best quality,');
  assert.doesNotMatch(joinCharacterPreviewPrompt('best quality'), /1girl,\s*smile/);
  assert.doesNotMatch(joinCharacterPreviewPrompt(''), /1girl|smile/);
});

test('joinExampleShotPrompt appends weighted solo portrait without forcing gender', () => {
  assert.equal(joinExampleShotPrompt(''), EXAMPLE_SHOT_TAIL);
  assert.equal(joinExampleShotPrompt('best quality'), `best quality, ${EXAMPLE_SHOT_TAIL}`);
  assert.equal(joinExampleShotPrompt('best quality,'), `best quality, ${EXAMPLE_SHOT_TAIL}`);
  assert.match(joinExampleShotPrompt('best quality, 2::solo::, extra'), /2::solo::/);
});

test('joinPresetLookPrompt appends weighted 1girl solo once', () => {
  assert.equal(joinPresetLookPrompt(''), PRESET_LOOK_TAIL);
  assert.equal(joinPresetLookPrompt('best quality'), `best quality, ${PRESET_LOOK_TAIL}`);
  assert.equal(joinPresetLookPrompt('best quality,'), `best quality, ${PRESET_LOOK_TAIL}`);
  assert.equal(joinPresetLookPrompt('best quality, 1girl, smile, extra'), 'best quality, 1girl, smile, extra, 4::1girl, solo::');
  assert.equal(joinPresetLookPrompt('4::1girl, solo::'), '4::1girl, solo::');
  assert.equal(PRESET_LOOK_TAIL, '4::1girl, solo::');
  assert.equal(EXAMPLE_SHOT_TAIL, '4::solo, portrait, white background::');
  assert.equal(joinExampleShotPrompt(joinExampleShotPrompt('1boy')), '1boy, 4::solo, portrait, white background::');
});
