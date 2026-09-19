import assert from 'node:assert/strict';
import test from 'node:test';

import { isOfficialNaiGenerateUrl } from '../.test-build/char-ref-keys.mjs';
import { naiConnectionProbeKind } from '../.test-build/nai-connection-probe.mjs';

test('empty and official generate URLs are NovelAI', () => {
  assert.equal(isOfficialNaiGenerateUrl(''), true);
  assert.equal(isOfficialNaiGenerateUrl(null), true);
  assert.equal(isOfficialNaiGenerateUrl('https://image.novelai.net/ai/generate-image'), true);
  assert.equal(isOfficialNaiGenerateUrl('https://image.novelai.net/ai/generate-image/'), true);
});

test('mirrors and junk are not official NovelAI', () => {
  assert.equal(isOfficialNaiGenerateUrl('https://inference.square1.dev/v1/images/nai/generate-image'), false);
  assert.equal(isOfficialNaiGenerateUrl('https://image.novelai.net/user/subscription'), false);
  assert.equal(isOfficialNaiGenerateUrl('not a url'), false);
});

test('probe kind skips Comfy and mirrors', () => {
  assert.equal(naiConnectionProbeKind({ backend: 'comfy' }), 'comfy-skip');
  assert.equal(
    naiConnectionProbeKind({
      backend: 'nai',
      request_url: 'https://inference.square1.dev/v1/images/nai/generate-image',
    }),
    'mirror-skip',
  );
  assert.equal(naiConnectionProbeKind({ backend: 'nai', request_url: '' }), 'official-anlas');
});
