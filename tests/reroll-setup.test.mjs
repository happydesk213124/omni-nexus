import test from 'node:test';
import assert from 'node:assert/strict';

import {
  collectStylePositives,
  recoverSceneFromMain,
  resolveRerollLockedSetup,
} from '../.test-build/reroll-setup.mjs';

test('scene-only setup rebuilds against the active preset path', () => {
  const d = resolveRerollLockedSetup({
    setup: 'forge, holding hammer, sparks',
    main: '1boy, style_a, forge, holding hammer, sparks, best quality',
    person: '1boy',
    stylePositives: ['style_a', 'style_b'],
    qualitySuffixes: [', best quality, ...'],
  });
  assert.equal(d.rebuildMain, true);
  assert.equal(d.lockedSetup, 'forge, holding hammer, sparks');
});

test('hand-edited main mirrored into setup is kept verbatim', () => {
  const d = resolveRerollLockedSetup({
    setup: 'PARITY EDITED PROMPT',
    main: 'PARITY EDITED PROMPT',
    person: '1boy',
    stylePositives: ['style_a'],
    qualitySuffixes: [', very aesthetic, ...'],
  });
  assert.equal(d.rebuildMain, false);
  assert.equal(d.lockedSetup, '');
});

test('polluted setup===main recovers scene and rebuilds', () => {
  const person = '1boy';
  const style = 'oil painting, warm light';
  const scene = 'forge, holding hammer';
  const quality = ', very aesthetic, absurdres';
  const main = `${person}, ${style}, ${scene}${quality}`;
  const recovered = recoverSceneFromMain(main, person, [style, 'other style'], [quality]);
  assert.equal(recovered, scene);

  const d = resolveRerollLockedSetup({
    setup: main,
    main,
    person,
    stylePositives: [style, 'other style'],
    qualitySuffixes: [quality],
  });
  assert.equal(d.rebuildMain, true);
  assert.equal(d.lockedSetup, scene);
});

test('collectStylePositives reads presets and custom_pos', () => {
  const tags = collectStylePositives({
    custom_pos: 'custom vibe',
    presets: [
      { id: 'p1', positive: 'best quality' },
      { id: 'p2', pos: 'masterpiece' },
      { id: 'p3' },
    ],
  });
  assert.deepEqual(tags, ['custom vibe', 'best quality', 'masterpiece']);
});

test('empty main with setup still rebuilds', () => {
  const d = resolveRerollLockedSetup({
    setup: 'outdoor, rain',
    main: '',
  });
  assert.equal(d.rebuildMain, true);
  assert.equal(d.lockedSetup, 'outdoor, rain');
});
