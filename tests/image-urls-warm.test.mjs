import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';

import { IMAGE_KEY } from '../.test-build/char-ref-keys.mjs';
import { bytesToBase64Async } from '../.test-build/bytes-util.mjs';
import {
  ensureBlobUrl,
  enqueueWarm,
  imageUrlStats,
  prioritizeWarmFocus,
  resetImageUrlStats,
  resetStores,
  retainImageUrls,
  subscribeImageUrl,
  warmImages,
  warmProgress,
} from '../.test-build/image-urls.mjs';

const pngBytes = Uint8Array.from({ length: 64 }, (_, i) => (i * 13) & 0xff);

/**
 * Bytes live in plugin storage rather than in memory, so warming has to hydrate
 * them. That is the only way the encodes take measurable time and overlap —
 * seeding through `idbPut` leaves the pixels resident and every warm is a
 * cache hit that finishes before the next one starts.
 */
function installHost() {
  const map = new Map();
  const host = {
    map,
    reads: 0,
    readActive: 0,
    readPeak: 0,
    slowReads: false,
    pluginStorage: {
      async getItem(key) {
        if (!String(key).startsWith('onx_nximg_')) return map.has(key) ? map.get(key) : null;
        host.reads += 1;
        host.readActive += 1;
        host.readPeak = Math.max(host.readPeak, host.readActive);
        try {
          if (host.slowReads) await new Promise((r) => setTimeout(r, 5));
          return map.has(key) ? map.get(key) : null;
        } finally {
          host.readActive -= 1;
        }
      },
      async setItem(key, value) {
        map.set(key, value);
      },
      async removeItem(key) {
        map.delete(key);
      },
    },
    async getLocalPluginStorage() {
      return host.pluginStorage;
    },
    async requestPluginPermission() {},
  };
  globalThis.risuai = host;
  return host;
}

/** Index rows plus legacy pixel keys, exactly as an un-migrated gallery looks. */
async function seed(host, ids) {
  const index = {};
  const b64 = await bytesToBase64Async(pngBytes);
  for (const id of ids) {
    index[id] = { id, location: {}, has_png: true, png_bytes: pngBytes.byteLength };
    host.map.set(IMAGE_KEY(id), b64);
  }
  host.map.set('onx_nxstore_images', index);
}

afterEach(() => {
  resetStores();
  resetImageUrlStats();
  delete globalThis.risuai;
});

test('warmImages resolves for an id that has no bytes', async () => {
  // ensureBlobUrl returns '' and never notifies a URL for a missing image. When
  // warmImages awaited its own encode that was fine; now that it waits on the
  // shared queue, the pump has to release the waiter or this hangs forever.
  resetStores();
  installHost();

  const urls = await warmImages(['ghost-1', 'ghost-2']);

  assert.deepEqual(urls, []);
  assert.equal(warmProgress().busy, false);
});

test('warmImages resolves ids that retainImageUrls drops from the queue', async () => {
  // An explorer folder hop evicts everything outside the new window. Those ids
  // leave the queue without ever being encoded, so their waiters need releasing
  // on that path too.
  //
  // More ids than encode slots on purpose: the first few are pulled out of the
  // queue into flight immediately and would be settled by the pump no matter
  // what, so only a backlog actually reaches the eviction path.
  resetStores();
  const host = installHost();
  const drops = Array.from({ length: 12 }, (_, i) => `drop-${i}`);
  await seed(host, ['keep-1', ...drops]);

  const pending = warmImages(drops);
  retainImageUrls(['keep-1']);

  // Resolving at all is the guard. The ids still in flight when the eviction
  // landed do finish, so the result is short of the request rather than empty —
  // which also proves the backlog really was dropped and not quietly encoded.
  const urls = await pending;
  assert.ok(urls.length < drops.length, `evicted ids were encoded anyway (${urls.length})`);
});

test('every caller shares one encode budget', async () => {
  // The regression this exists for: warmImages used to encode in its own parallel
  // chunks, bypassing the queue. Two independent pools meant the explorer strip,
  // the viewer strip and the inline bubble each got slots of their own, so the
  // total ran well over budget and prioritizeWarmFocus reordered a queue the
  // busiest callers never read.
  resetStores();
  const host = installHost();
  const bulk = Array.from({ length: 14 }, (_, i) => `bulk-${i}`);
  await seed(host, [...bulk, 'focus-a', 'focus-b']);
  host.slowReads = true;

  await Promise.all([warmImages(bulk), warmImages(['focus-a', 'focus-b'])]);

  assert.ok(host.readPeak > 1, 'the pump must actually run in parallel');
  // WARM_CONCURRENCY. Raising it there should raise it here, deliberately.
  assert.ok(host.readPeak <= 4, `two callers exceeded one budget (${host.readPeak})`);
});

test('prioritizeWarmFocus jumps the backlog of an in-flight bulk warm', async () => {
  resetStores();
  const host = installHost();
  const bulk = Array.from({ length: 14 }, (_, i) => `bulk-${i}`);
  await seed(host, [...bulk, 'focus-me']);
  host.slowReads = true;

  const order = [];
  const stop = subscribeImageUrl([...bulk, 'focus-me'], (id) => order.push(id));

  const bulkDone = warmImages(bulk);
  prioritizeWarmFocus(['focus-me']);
  await Promise.all([bulkDone, warmImages(['focus-me'])]);
  stop();

  const at = order.indexOf('focus-me');
  assert.ok(at >= 0, 'the focus id must be encoded');
  // It cannot be first — the queue was already pumping when focus arrived — but
  // it must jump the ids still waiting rather than land at the end.
  assert.ok(at < bulk.length, `focus landed at ${at} of ${order.length}`);
});

test('concurrent ensureBlobUrl calls for one id encode once', async () => {
  // The viewer arrow path asks for the main image directly (ensureImageUrl) while
  // warmVisibleImages queues the same id. The queue dedupes itself, but a direct
  // call used to start its own FileReader encode — two multi-MB strings for one
  // id, one of which is garbage the moment the other lands in the cache.
  resetStores();
  const host = installHost();
  await seed(host, ['same']);
  host.slowReads = true;

  const urls = await Promise.all([ensureBlobUrl('same'), ensureBlobUrl('same'), warmImages(['same'])]);

  assert.equal(urls[0], urls[1]);
  assert.equal(urls[2][0], urls[0]);
  const stats = imageUrlStats();
  assert.equal(stats.encodes, 1, `encoded ${stats.encodes} times for one id`);
  assert.equal(stats.encode_joins, 2, 'the two late callers must join the in-flight encode');
  assert.equal(stats.encode_inflight, 0);
});

test('enqueueWarm and warmImages share one queue', async () => {
  resetStores();
  const host = installHost();
  await seed(host, ['a', 'b']);

  enqueueWarm('a');
  const urls = await warmImages(['a', 'b']);

  assert.equal(urls.length, 2);
  // One queue means one encode per id, no matter how many callers asked.
  assert.equal(host.reads, 2);
  assert.equal(warmProgress().busy, false);
});
