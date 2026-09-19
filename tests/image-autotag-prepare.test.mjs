import assert from 'node:assert/strict';
import test from 'node:test';

import { isPngBytes, isWebpBytes } from '../.test-build/bytes-util.mjs';
import { prepareAutotagImage } from '../.test-build/image-util.mjs';

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const WEBP = Uint8Array.from([
  0x52, 0x49, 0x46, 0x46, 20, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
]);

test('prepareAutotagImage keeps a PNG when decode/canvas is unavailable', async () => {
  const out = await prepareAutotagImage(PNG);
  assert.equal(out.mime, 'image/png');
  assert.equal(out.filename, 'image.png');
  assert.equal(isPngBytes(out.bytes), true);
});

test('prepareAutotagImage keeps WebP only when it cannot re-encode (no canvas)', async () => {
  const out = await prepareAutotagImage(WEBP);
  assert.equal(isWebpBytes(out.bytes) || out.mime === 'image/png', true);
  if (out.mime === 'image/webp') assert.equal(out.filename, 'image.webp');
  if (out.mime === 'image/png') assert.equal(out.filename, 'image.png');
});
