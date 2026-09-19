import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CHAR_REF_ASSET_PREFIX,
  CHAR_REF_STORE_MAX_WIDTH,
  charRefAssetName,
  charRefStoreSize,
  hashFromCharRefAssetName,
  isCharRefAssetName,
  parseCharRefModuleAssets,
  sanitizeHash,
} from '../.test-build/char-ref-store.mjs';

test('charRefStoreSize keeps aspect and caps width at 400', () => {
  assert.deepEqual(charRefStoreSize(400, 600), { w: 400, h: 600 });
  assert.deepEqual(charRefStoreSize(200, 300), { w: 200, h: 300 });
  assert.deepEqual(charRefStoreSize(800, 1200), { w: 400, h: 600 });
  assert.equal(CHAR_REF_STORE_MAX_WIDTH, 400);
});

test('inxref_ names are isolated from look-asset matching', () => {
  const hash = 'a'.repeat(64);
  const name = charRefAssetName(hash);
  assert.ok(name.startsWith(CHAR_REF_ASSET_PREFIX));
  assert.equal(isCharRefAssetName(name), true);
  assert.equal(isCharRefAssetName('senoy_default.webp'), false);
  assert.equal(hashFromCharRefAssetName(name), hash);
  assert.equal(hashFromCharRefAssetName(`${CHAR_REF_ASSET_PREFIX}${hash}.png`), hash);
  assert.equal(sanitizeHash('A1b2-ZZ'), 'a1b2');
});

test('parseCharRefModuleAssets accepts tuples, objects, and array-likes', () => {
  const hash = 'b'.repeat(64);
  const name = charRefAssetName(hash, 'png');
  const fromTuples = parseCharRefModuleAssets([[name, 'assets/abc.png', 'png']]);
  assert.deepEqual(fromTuples, [[name, 'assets/abc.png', 'png']]);
  const fromObj = parseCharRefModuleAssets([{ name, path: 'assets/abc.png', ext: 'png' }]);
  assert.deepEqual(fromObj, [[name, 'assets/abc.png', 'png']]);
  const like = { 0: [name, 'xyz.webp', 'webp'], length: 1 };
  const fromLike = parseCharRefModuleAssets(like);
  assert.equal(fromLike[0][0], name);
  assert.equal(hashFromCharRefAssetName(fromLike[0][0]), hash);
});
