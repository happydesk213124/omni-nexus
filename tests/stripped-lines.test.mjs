import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterTaggerContextMessages } from '../.test-build/chat-bake.mjs';
import {
  insertSnippetAtStrippedLine,
  rawLineIndexForStrippedLine,
} from '../.test-build/viewer-core.mjs';

const SPINNER = '[[@inrayspinner::job-old_0::832::1216]]';
const BAKE = '[[@inray::old-card::inxshot_old-card.webp::832::1216]]';

test('context strips our tokens but keeps the prose line', () => {
  const out = filterTaggerContextMessages(
    [{ role: 'char', content: `맹약도 과분했다.${SPINNER}${BAKE}\n태양은 자비를 두지 않았다.` }],
    '현재글이다.',
  );
  assert.deepEqual(out, [{
    role: 'char',
    body: '맹약도 과분했다.\n태양은 자비를 두지 않았다.',
  }]);
});

test('context drops token-only rows and the current message', () => {
  const current = '태양은 자비를 두지 않았다.';
  const out = filterTaggerContextMessages(
    [
      { role: 'char', content: BAKE },
      { role: 'char', content: current },
      { role: 'char', content: `${current}${BAKE}` },
      { role: 'user', content: '이전 질문?' },
    ],
    current,
  );
  assert.deepEqual(out, [{ role: 'user', body: '이전 질문?' }]);
});

test('context defaults missing role to char', () => {
  const out = filterTaggerContextMessages([{ content: '안녕' }], '다른글');
  assert.deepEqual(out, [{ role: 'char', body: '안녕' }]);
});

test('stripped line maps past token-only rows', () => {
  const raw = `${BAKE}\n맹약도 과분했다.\n태양은 자비를 두지 않았다.`;
  assert.equal(rawLineIndexForStrippedLine(raw, 1), 2);
  assert.equal(rawLineIndexForStrippedLine(raw, 2), 3);
  assert.equal(rawLineIndexForStrippedLine(raw, 0), null);
  assert.equal(rawLineIndexForStrippedLine(raw, 3), null);
});

test('stripped insert lands on the prose line, tokens preserved', () => {
  const raw = `${BAKE}\n맹약도 과분했다.\n태양은 자비를 두지 않았다.`;
  const next = insertSnippetAtStrippedLine(raw, 2, 'before', '[[@inrayspinner::job-n_0::832::1216]]');
  const lines = next.split('\n');
  assert.equal(lines.length, 4);
  assert.equal(lines[0], BAKE);
  assert.equal(lines[1], '맹약도 과분했다.');
  assert.equal(lines[2], '[[@inrayspinner::job-n_0::832::1216]]');
  assert.equal(lines[3], '태양은 자비를 두지 않았다.');
});
