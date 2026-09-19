import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';

import { IMAGE_KEY } from '../.test-build/char-ref-keys.mjs';
import { bytesToBase64Async } from '../.test-build/bytes-util.mjs';
import {
  flushPersist,
  idbPut,
  imageMeta,
  imagePng,
  resetStores,
} from '../.test-build/stores.mjs';

const pngBytes = Uint8Array.from({ length: 48 }, (_, i) => (i * 17) & 0xff);

function createKv() {
  const map = new Map();
  return {
    map,
    async getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    async setItem(key, value) {
      map.set(key, value);
    },
    async removeItem(key) {
      map.delete(key);
    },
  };
}

function installHost({ kv, module = false, readback = true } = {}) {
  const stored = new Map();
  const host = {
    saveAssetCalls: 0,
    db: { modules: [], enabledModules: [], characters:[{chaId:"bot",additionalAssets:[],chats:[]}] },
    async getCurrentCharacterIndex(){return 0;},
    async getCharacterFromIndex(i){return structuredClone(host.db.characters[i]);},
    async setCharacterToIndex(i,c){host.db.characters[i]=structuredClone(c);},
    async getLocalPluginStorage() {
      return kv;
    },
    pluginStorage: kv,
    async requestPluginPermission() {},
    async getDatabase() {
      return structuredClone(host.db);
    },
    async setDatabase(next) {
      host.db = structuredClone(next);
    },
    async saveAsset(bytes) {
      host.saveAssetCalls += 1;
      const path = `assets/shot-${host.saveAssetCalls}.webp`;
      const u8 = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : Uint8Array.from(bytes);
      stored.set(path, u8);
      return path;
    },
    async readImage(path) {
      if (!readback || !stored.has(path)) throw new Error('missing asset');
      return stored.get(path);
    },
  };
  if (!module) {
    delete host.saveAsset;
    delete host.readImage;
    delete host.getDatabase;
    delete host.setDatabase;
  }
  globalThis.risuai = host;
  return host;
}

afterEach(() => {
  resetStores();
  delete globalThis.risuai;
});

test('an unavailable character does not park shot pixels in plugin storage', async () => {
  // One try at the gallery module. If that fails the shot is gone — the 3.8 MB
  // onx_nximg_* strings were the old fallback and they do not come back.
  resetStores();
  const kv = createKv();
  installHost({ kv, module: false });

  await assert.rejects(()=>idbPut('images', { id: 'card-miss', png: pngBytes.buffer, location: {} }),/target character/);
  await flushPersist();

  assert.equal(kv.map.has(IMAGE_KEY('card-miss')), false);
  for (const key of kv.map.keys()) {
    assert.equal(String(key).startsWith('onx_nximg_'), false, key);
  }
  assert.equal(await imagePng('card-miss'), null);
  const meta = await imageMeta('card-miss');
  assert.ok(!meta?.has_png);
});

test('a character asset save still never writes onx_nximg_*', async () => {
  resetStores();
  const kv = createKv();
  const host = installHost({ kv, module: true });

  await idbPut('images', { id: 'card-hit', png: pngBytes.buffer, location: {} });
  await flushPersist();

  assert.equal(host.saveAssetCalls, 1);
  assert.equal(host.db.characters[0].additionalAssets.length,1);
  assert.deepEqual(host.db.enabledModules,[]);
  assert.deepEqual(host.db.modules,[]);
  assert.equal(kv.map.has(IMAGE_KEY('card-hit')), false);
  assert.ok(await imagePng('card-hit'));
  const meta = await imageMeta('card-hit');
  assert.equal(meta?.has_png, true);
});

test('legacy onx_nximg_* bytes still hydrate so old galleries stay visible', async () => {
  resetStores();
  const kv = createKv();
  installHost({ kv, module: false });
  kv.map.set(IMAGE_KEY('card-old'), await bytesToBase64Async(pngBytes));
  kv.map.set('onx_nxstore_images', {
    'card-old': { id: 'card-old', location: {}, has_png: true, png_bytes: pngBytes.byteLength },
  });

  const png = await imagePng('card-old');
  assert.ok(png);
  assert.equal(png.byteLength, pngBytes.byteLength);
});
