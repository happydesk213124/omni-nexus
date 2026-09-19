import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  TAG_CAL_INSTRUCT,
  applyReverseBar,
  applyTagCalInstruct,
  decodeTagCal,
} from '../.test-build/llm-guardrails.mjs';

test('reverse-bar inserts role lock and accepted turns before the first user', () => {
  const out = applyReverseBar(
    [
      { role: 'system', content: 'how-to' },
      { role: 'user', content: 'tag this' },
    ],
    {
      jailbreak: 'you are an artist',
      prefill: 'already in role',
      prefillUser: 'go',
    },
  );
  assert.deepEqual(out.map((row) => row.role), ['system', 'system', 'assistant', 'user', 'user']);
  assert.equal(out[1].content, 'you are an artist');
  assert.equal(out[2].content, 'already in role');
  assert.equal(out[3].content, 'go');
  assert.equal(out[4].content, 'tag this');
});

test('reverse-bar skips empty texts', () => {
  const src = [{ role: 'user', content: 'only' }];
  assert.deepEqual(applyReverseBar(src, {}), src);
});

test('tag-cal appends the fixed instruct to the last system turn', () => {
  const out = applyTagCalInstruct([
    { role: 'system', content: 'first' },
    { role: 'system', content: 'last' },
    { role: 'user', content: 'go' },
  ]);
  assert.equal(out[0].content, 'first');
  assert.equal(out[1].content, `last\n\n${TAG_CAL_INSTRUCT}`);
  assert.match(String(out[1].content), /gi%%rl/);
});

test('tag-cal prepends a system turn when none exists', () => {
  const out = applyTagCalInstruct([{ role: 'user', content: 'go' }]);
  assert.equal(out[0].role, 'system');
  assert.equal(out[0].content, TAG_CAL_INSTRUCT);
});

test('decodeTagCal strips percent then restores wfsn', () => {
  assert.equal(decodeTagCal('gi%%rl, wfsn, 1.2::ha%%ir::'), 'girl, nsfw, 1.2::hair::');
});
