import assert from 'node:assert/strict';
import test from 'node:test';

import { lookBytesForTarget, refSeedTargets } from '../.test-build/char-ref-seed.mjs';

const bytes = Uint8Array.from([1, 2, 3]);

test('ref seed skips rows that already have a hash or no usable name', () => {
  assert.deepEqual(
    refSeedTargets([
      { id: 'a', scope: 'chat-1', name: '세나', ref_hash: 'ab'.repeat(32) },
      { id: '', scope: 'chat-1', name: '한진우' },
      { id: 'b', scope: 'chat-1', name: 'x' },
    ]),
    [],
  );
});

test('ref seed keeps empty slots and matches alias or name to look trigger', () => {
  const targets = refSeedTargets([
    { id: 'sena', scope: 'chat-1', name: '세나', aliases: ['Sena'] },
    { id: 'jin', scope: '__global__', name: '한진우' },
  ]);
  assert.equal(targets.length, 2);
  assert.deepEqual(
    new Uint8Array(lookBytesForTarget(targets[0], [{ trigger: 'Sena', bytes }])),
    bytes,
  );
  assert.equal(lookBytesForTarget(targets[1], [{ trigger: '세나', bytes }]), null);
  assert.deepEqual(
    new Uint8Array(lookBytesForTarget(targets[1], [{ trigger: '한진우', bytes }])),
    bytes,
  );
});
