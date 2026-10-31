import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The shipped pointerdown head (tools/vendor-patches/runtime-rebuild.mjs). With 옴니 뷰어 over
// the chat, a press on it never reaches the illustration presses beneath (double-tap and hold
// open 크게보기, the history arrows): the viewer kept being covered by an image it hid.
const source = readFileSync(new URL('../dist/omninexus.js', import.meta.url), 'utf8');
const OPEN = 'resolvePointerDown = async (f,physical) => {';

test('옴니 뷰어 covers the chat: a press on it never reaches an illustration beneath', async () => {
  const start = source.indexOf(OPEN), end = source.indexOf('// Middle-click message jump removed', start);
  assert.ok(start >= 0 && end > start, 'the pointerdown head is where it was');
  const head = source.slice(start + OPEN.length, end);
  const reached = [];
  const press = covers => {
    const physical = {};
    const run = new Function('t', 'nxPhysical', 'nxFloatHitSurface', 'omniHistoryTouch', 'globalThis', `return async (f, physical) => {${head} return 'beneath'; };`)(
      {}, physical, async () => { reached.push('float'); return false; }, async () => { reached.push('history'); return false; },
      { __OMNI_VIEWER_COVERS__: (x, y) => covers && x === 120 && y === 340 });
    return run({ clientX: 120, clientY: 340, button: 0 }, physical);
  };
  assert.equal(await press(true), undefined, 'covered: the press stops at the viewer');
  assert.deepEqual(reached, []);
  assert.equal(await press(false), 'beneath', 'uncovered: the chat gets its press as before');
  assert.deepEqual(reached, ['float', 'history']);
});
