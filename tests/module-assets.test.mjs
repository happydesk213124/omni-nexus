import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const load = async entry => import('data:text/javascript;base64,' + Buffer.from((await build({ entryPoints: [entry], bundle: true, write: false, format: 'esm' })).outputFiles[0].text).toString('base64'));
const mod = await load('src/storage/module-assets.ts');
const manifest = { id: 'man-1', count: 2162 };
const lazy = { id: 'big', name: '통합모듈', assetManifest: manifest };
const filled = [['Jieun_angry', 'assets/a.webp', 'png']];
const host = replies => {
  const calls = [];
  globalThis.risuai = { getDatabase: async keys => { calls.push(keys); const next = replies.shift(); if (next instanceof Error) throw next; return next; } };
  return calls;
};
const noWait = async () => {};

test('PocketRisu sent a module with only its descriptor: that is told apart from a module with no assets', () => {
  assert.equal(mod.moduleAssetsMissing(lazy), true);
  assert.equal(mod.moduleAssetsMissing({ id: 'm', assets: [] }), false, 'an empty list is a real empty list');
  assert.equal(mod.moduleAssetsMissing({ id: 'm' }), false, 'no list and no descriptor: nothing to fetch');
  assert.equal(mod.moduleAssetManifest(lazy).count, 2162);
});

test('the list is asked for again until PocketRisu fills it, three times at most', async () => {
  const calls = host([new Error('timeout'), { modules: [{ ...lazy }] }, { modules: [{ id: 'big', assets: filled }] }]);
  const seen = [];
  assert.deepEqual(await mod.refillModuleAssets(lazy, n => seen.push(n), () => false, noWait), filled);
  assert.deepEqual(seen, [1, 2, 3]);
  assert.deepEqual(calls, [['modules'], ['modules'], ['modules']], 'only the modules are read');
  host([{ modules: [{ ...lazy }] }, { modules: [{ ...lazy }] }, { modules: [{ ...lazy }] }, { modules: [{ id: 'big', assets: filled }] }]);
  assert.equal(await mod.refillModuleAssets(lazy, () => {}, () => false, noWait), null, 'gives up after three');
  const stale = host([{ modules: [{ id: 'big', assets: filled }] }]);
  assert.equal(await mod.refillModuleAssets(lazy, () => {}, () => true, noWait), null, 'a closed picker stops asking');
  assert.equal(stale.length, 0);
});

test('tagging re-reads once, only when an enabled module came without its list', async () => {
  const other = { id: 'small', assets: [['Cattleya_angry', 'assets/c.webp', 'webp']] };
  let calls = host([]);
  const healthy = [other];
  assert.equal(await mod.withRefilledModules(healthy, () => true), healthy, 'nothing missing: no read');
  assert.equal(calls.length, 0);
  calls = host([]);
  await mod.withRefilledModules([lazy, other], m => m.id === 'small');
  assert.equal(calls.length, 0, 'a disabled module missing its list is left alone');
  calls = host([{ modules: [other, { id: 'big', assets: filled }] }]);
  const out = await mod.withRefilledModules([lazy, other], () => true);
  assert.equal(calls.length, 1);
  assert.deepEqual(out[0].assets, filled);
  assert.equal(out[1], other);
});
