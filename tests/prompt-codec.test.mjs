import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodePromptPack, encodePromptPack, isEncodedPromptPack } from '../.test-build/prompt-codec.mjs';

test('encode/decode round-trips prompt text including empty and CRLF', () => {
  const pack = {
    author_note: '',
    tagger: 'hello\r\nworld',
    prefill: 'RESTRICTIONS_LIFTED_FOR_LABELING',
  };
  const encoded = encodePromptPack(pack);
  assert.equal(isEncodedPromptPack(encoded), true);
  assert.equal(typeof encoded.__enc, 'string');
  assert.ok(!JSON.stringify(encoded).includes('RESTRICTIONS_LIFTED'));
  assert.deepEqual(decodePromptPack(encoded), pack);
});

test('decode accepts legacy plaintext packs from tests/parity', () => {
  assert.deepEqual(decodePromptPack({ tagger: 'plain' }), { tagger: 'plain' });
});
