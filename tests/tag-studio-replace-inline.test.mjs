import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  REPLACE_INLINE_PHOTO_KEY,
  replaceInlinePhotoAfterSave,
} from '../.test-build/tag-studio-replace-inline.mjs';

test('tag-studio save flips the inline slot to the new card id; save-then-reroll is gone', () => {
  const mount = fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'tag-studio', 'mount.ts'),
    'utf8',
  );
  assert.match(mount, /async function commitAndClose[\s\S]*replaceInlinePhotoAfterSave\(/);
  assert.match(mount, /cleanText\(card\.id, 80\) \|\| state\.cardId/, 'swap targets the committed card id');
  assert.doesNotMatch(mount, /saveThenReroll/, 'save-then-reroll removed');
  assert.doesNotMatch(mount, /id="reroll"/, 'save-then-reroll button removed');
});

test('replaceInlinePhotoAfterSave no-ops without a hook or card id', async () => {
  delete globalThis[REPLACE_INLINE_PHOTO_KEY];
  assert.equal(await replaceInlinePhotoAfterSave('', 'data:image/webp;base64,AA'), false);
  assert.equal(await replaceInlinePhotoAfterSave('card-1', 'data:image/webp;base64,AA'), false);
});

test('replaceInlinePhotoAfterSave calls the vendor swap with same card id', async () => {
  const calls = [];
  globalThis[REPLACE_INLINE_PHOTO_KEY] = async (cardId, src, prevId) => {
    calls.push({ cardId, src, prevId });
    return true;
  };
  try {
    assert.equal(await replaceInlinePhotoAfterSave('card-1', 'data:image/webp;base64,ZZ'), true);
    assert.deepEqual(calls, [{
      cardId: 'card-1',
      src: 'data:image/webp;base64,ZZ',
      prevId: 'card-1',
    }]);
  } finally {
    delete globalThis[REPLACE_INLINE_PHOTO_KEY];
  }
});
