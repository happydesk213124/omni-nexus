import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { safeList, SAFE_LIST_WAVE } from '../.test-build/safe-list.mjs';

// A SafeClassArray as Risu's bridge hands it over: every call answers a turn later, like a postMessage round trip.
// `peak` is how many item requests were in flight at once; `waves` how many times the caller had to wait for them.
function remoteList(items) {
  const seen = { inFlight: 0, peak: 0, waves: 0, calls: 0 };
  let waveOpen = false;
  const later = value => new Promise(resolve => setTimeout(() => resolve(value), 1));
  return {
    seen,
    list: {
      async length() { seen.calls++; return later(items.length); },
      async at(i) {
        seen.calls++;
        if (!waveOpen) { waveOpen = true; seen.waves++; queueMicrotask(() => { waveOpen = false; }); }
        seen.inFlight++; seen.peak = Math.max(seen.peak, seen.inFlight);
        const value = await later(items[i]);
        seen.inFlight--;
        return value;
      },
    },
  };
}

// Risu's own unwarpSafeArray (apiV3/factory.ts), the way it asks: the length, then each item in turn.
async function risuUnwarp(list) {
  const out = [];
  for (let i = 0, n = await list.length(); i < n; i++) out.push(await list.at(i));
  return out;
}

// The vendor closure's copy (vite.config.ts cannot import src/): its source, as the build injects it.
function vendorUnwrap() {
  const source = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8');
  const start = source.indexOf('  async function nxUnwrapSafeNodes(raw) {');
  assert.ok(start >= 0, 'the vendor closure still defines nxUnwrapSafeNodes');
  let depth = 0, end = source.indexOf('{', start);
  for (; end < source.length; end++) { if (source[end] === '{') depth++; else if (source[end] === '}' && --depth === 0) break; }
  return new Function(`${source.slice(start, end + 1)}; return nxUnwrapSafeNodes;`)();
}

for (const [name, unwrap] of [['safeList', safeList], ['the vendor closure\'s nxUnwrapSafeNodes', vendorUnwrap()]]) {
  test(`${name} asks for a list's items together: two waits, not one per item`, async () => {
    const { list, seen } = remoteList(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']);
    assert.deepEqual(await unwrap(list), ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'], 'in the list\'s order');
    assert.equal(seen.peak, 10, 'every item asked at once');
    assert.equal(seen.waves, 1);
    assert.equal(seen.calls, 11, 'the length and each item once');
  });

  test(`${name} takes a long list in waves, drops holes, and passes arrays and nothing through`, async () => {
    const items = Array.from({ length: SAFE_LIST_WAVE * 2 + 5 }, (_, i) => (i === 3 ? undefined : i === 7 ? null : i));
    const { list, seen } = remoteList(items);
    const out = await unwrap(list);
    assert.equal(out.length, items.length - 2);
    assert.deepEqual(out.slice(0, 6), [0, 1, 2, 4, 5, 6]);
    assert.equal(seen.peak, SAFE_LIST_WAVE, 'no more than a wave in flight');
    assert.equal(seen.waves, 3);
    const plain = [1, 2];
    assert.equal(await unwrap(plain), plain, 'PocketRisu\'s plain arrays as they are');
    assert.deepEqual(await unwrap(null), []);
  });
}

test('the measure tells the two apart: Risu\'s own unwrap waits once per item', async () => {
  const { list, seen } = remoteList(['a', 'b', 'c', 'd']);
  assert.deepEqual(await risuUnwarp(list), ['a', 'b', 'c', 'd']);
  assert.equal(seen.peak, 1);
  assert.equal(seen.waves, 4);
});
