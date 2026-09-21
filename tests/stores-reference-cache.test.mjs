import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { idbGet, idbGetAll, idbPut, idbDelete, openDb, flushPersist, resetStores } from '../.test-build/stores.mjs';

const key = 'char_ref_vibe_abc123';
const dataKey = 'onx_nxcrefd_vibe_abc123';
const metaKey = 'onx_nxstore_meta';
const payload = { key, encoded: 'A'.repeat(100_000), model: 'test-model', information_extracted: 0.7 };
function host(initial = {}) {
  const map = new Map(Object.entries(initial));
  const reads = [];
  const kv = {
    async getItem(k) { reads.push(k); return map.get(k) ?? null; },
    async setItem(k, v) { map.set(k, structuredClone(v)); },
    async removeItem(k) { map.delete(k); },
  };
  globalThis.risuai = { pluginStorage: kv, async getLocalPluginStorage() { return kv; } };
  return { map, reads, kv };
}
afterEach(() => { resetStores(); delete globalThis.risuai; });

test('reference cache survives reload without embedding or eagerly reading its payload', async () => {
  const { map, reads } = host();
  await idbPut('meta', payload);
  await flushPersist();
  assert.deepEqual(map.get(dataKey), payload);
  assert.ok(JSON.stringify(map.get(metaKey)).length < 1000);
  resetStores();
  reads.length = 0;
  await openDb();
  assert.equal(reads.includes(dataKey), false);
  assert.deepEqual(await idbGet('meta', key), payload);
  assert.ok((await idbGetAll('meta')).some(row => row.encoded === payload.encoded));
  await idbPut('meta', { key: 'prompt:test', text: 'keep' });
  await flushPersist();
  assert.equal(JSON.stringify(map.get(metaKey)).includes(payload.encoded), false);
  await idbDelete('meta', key);
  await flushPersist();
  assert.equal(map.has(dataKey), false);
  assert.equal(map.get(metaKey)[key], undefined);
});

test('legacy inline cache stays intact without boot-time cleanup or migration', async () => {
  const prompt = { key: 'prompt:test', text: 'keep' };
  const { map } = host({ [metaKey]: { [key]: payload, [prompt.key]: prompt } });
  await openDb();
  assert.equal(map.has(dataKey), false);
  assert.deepEqual(map.get(metaKey)[key], payload);
  assert.deepEqual(map.get(metaKey)[prompt.key], prompt);
  assert.deepEqual(await idbGet('meta', key), payload);
  await idbPut('meta', { key: 'prompt:other', text: 'new' });
  await flushPersist();
  assert.deepEqual(map.get(metaKey)[key], payload);
  assert.equal(map.has(dataKey), false);
});

test('existing separate cache keys remain readable without re-encoding', async () => {
  const { key: ignored, ...oldPayload } = payload;
  host({ [metaKey]: { [key]: { key, has_encoded: true } }, [dataKey]: oldPayload });
  assert.deepEqual(await idbGet('meta', key), payload);
});

test('failed separate write preserves the existing cache', async () => {
  const { map, kv } = host({ [metaKey]: { [key]: payload } });
  const set = kv.setItem;
  kv.setItem = async (k, v) => { if (k === dataKey) throw new Error('disk full'); return set(k, v); };
  await openDb();
  assert.deepEqual(await idbGet('meta', key), payload);
  await idbPut('meta', { key: 'prompt:test', text: 'keep' });
  await flushPersist();
  assert.deepEqual(map.get(metaKey)[key], payload);
  await assert.rejects(idbPut('meta', { ...payload, encoded: 'replacement' }), /disk full/);
  assert.deepEqual(await idbGet('meta', key), payload);
  assert.equal(map.has(dataKey), false);
});
