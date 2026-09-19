import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { IMAGE_KEY, LEGACY_IMAGE_KEY } from '../.test-build/char-ref-keys.mjs';
import { bytesToBase64Async } from '../.test-build/bytes-util.mjs';
// Everything comes from the one bundle on purpose: the engine, the stores it
// mutates, and the device store all have to be the same instances.
import {
  getMigrateStatus,
  imagePng,
  openDb,
  resetStores,
  saveFileRemove,
  startStorageMigration,
  storageMigrateInfo,
  storageMigratedVersion,
  storeSize,
} from '../.test-build/storage-migrate.mjs';

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

/**
 * Device store and save file are deliberately separate maps here. Sharing one
 * would hide the whole point of the purge guard.
 */
function installHost({ device, saveFile, module = true, idb = true } = {}) {
  const stored = new Map();
  const host = {
    saveAssetCalls: 0,
    setDatabaseCalls: 0,
    db: { modules: [], enabledModules: [] },
    pluginStorage: saveFile,
    async requestPluginPermission() {},
    async getLocalPluginStorage() {
      return device;
    },
    async getDatabase() {
      return structuredClone(host.db);
    },
    async setDatabase(next) {
      host.setDatabaseCalls += 1;
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
      if (!stored.has(path)) throw new Error('missing asset');
      return stored.get(path);
    },
  };
  if (!idb) delete host.getLocalPluginStorage;
  if (!module) {
    delete host.saveAsset;
    delete host.readImage;
    delete host.getDatabase;
    delete host.setDatabase;
  }
  globalThis.risuai = host;
  return host;
}

/** Seeds `n` legacy images: index rows with pixels only in `onx_nximg_*`. */
async function seedLegacyImages(device, saveFile, n) {
  const b64 = await bytesToBase64Async(pngBytes);
  const index = {};
  for (let i = 0; i < n; i += 1) {
    const id = `card-${i}`;
    index[id] = { id, location: {}, has_png: true, png_bytes: pngBytes.byteLength };
    device.map.set(IMAGE_KEY(id), b64);
    saveFile.map.set(LEGACY_IMAGE_KEY(id), b64);
  }
  device.map.set('onx_nxstore_images', index);
}

async function runMigration() {
  const started = await startStorageMigration();
  for (let i = 0; i < 2000 && getMigrateStatus().running; i += 1) {
    await new Promise((r) => setTimeout(r, 5));
  }
  return { started, status: getMigrateStatus() };
}

// The engine's write-behind flush is debounced, so a run's last snapshot can
// still be in flight when the test body returns. Let it land before swapping
// the host out from under it, or it writes into the next test's storage.
afterEach(async () => {
  await new Promise((r) => setTimeout(r, 60));
  resetStores();
  delete globalThis.risuai;
});

describe('storage migration', { concurrency: 1 }, () => {
  test('a legacy image moves into the module and both originals are deleted', async () => {
    resetStores();
    const device = createKv();
    const saveFile = createKv();
    const host = installHost({ device, saveFile });
    await seedLegacyImages(device, saveFile, 1);

    const { started, status } = await runMigration();

    assert.equal(started.started, true);
    assert.equal(started.total, 1);
    assert.equal(status.phase, 'done');
    assert.equal(status.failed, 0);
    assert.equal(status.done, 1);
    assert.equal(status.freed_bytes, pngBytes.byteLength);

    assert.match(String(host.db.modules[0].assets[0][0]), /^inxshot_card-0\./);
    // Live store is the save file; leftover IDB pixels are unused after the copy.
    assert.equal(saveFile.map.has(IMAGE_KEY('card-0')), false);
    assert.equal(saveFile.map.has(LEGACY_IMAGE_KEY('card-0')), false);
    // And the image is still readable, now from the module.
    const png = await imagePng('card-0');
    assert.equal(png?.byteLength, pngBytes.byteLength);
    assert.equal(await storageMigratedVersion(), 3);
  });

  test('the run commits one DB write per batch, not per image', async () => {
    resetStores();
    const device = createKv();
    const saveFile = createKv();
    const host = installHost({ device, saveFile });
    await seedLegacyImages(device, saveFile, 30);

    const { status } = await runMigration();

    assert.equal(status.done, 30);
    assert.equal(status.failed, 0);
    assert.equal(host.saveAssetCalls, 30);
    // 30 images at 25 per batch = 2 commits. Anything near 30 means the batch
    // collapsed back to a per-image read-modify-write.
    assert.equal(host.setDatabaseCalls, 2);
  });

  test('a second run has nothing left to do', async () => {
    resetStores();
    const device = createKv();
    const saveFile = createKv();
    installHost({ device, saveFile });
    await seedLegacyImages(device, saveFile, 2);

    await runMigration();
    const info = await storageMigrateInfo();

    assert.equal(info.migrated_version, 3);
    assert.equal(info.pending_images, 0);
    const second = await runMigration();
    assert.equal(second.started.total, 0);
  });

  test('without the module the images are reported failed and keep their originals', async () => {
    resetStores();
    const device = createKv();
    const saveFile = createKv();
    installHost({ device, saveFile, module: false });
    await seedLegacyImages(device, saveFile, 2);

    const { status } = await runMigration();

    assert.equal(status.failed, 2);
    assert.equal(device.map.has(IMAGE_KEY('card-0')), true);
    assert.equal(saveFile.map.has(LEGACY_IMAGE_KEY('card-0')), true);
    // Failures must not stamp: the stamp is what stops the lazy read path from
    // looking in the legacy rows these images still live in.
    assert.equal(await storageMigratedVersion(), 0);
  });

  test('legacy save-file keys survive when the save file IS the device store', async () => {
    resetStores();
    const saveFile = createKv();
    installHost({ device: saveFile, saveFile, idb: false });
    saveFile.map.set('nxstore_images', { 'card-0': { id: 'card-0' } });

    assert.equal(await saveFileRemove('nxstore_images'), false);
    assert.equal(saveFile.map.has('nxstore_images'), true);
  });

  test('legacy save-file store copies are purged on IndexedDB hosts', async () => {
    resetStores();
    const device = createKv();
    const saveFile = createKv();
    installHost({ device, saveFile });
    device.map.set('onx_nxstore_images', {});
    for (const key of ['nxstore_images', 'nxstore_cards', 'native_settings', 'nxref_image']) {
      saveFile.map.set(key, 'legacy');
    }

    await runMigration();

    assert.equal(saveFile.map.has('nxstore_images'), false);
    assert.equal(saveFile.map.has('nxstore_cards'), false);
    assert.equal(saveFile.map.has('native_settings'), false);
    assert.equal(saveFile.map.has('nxref_image'), false);
  });

  test('completed job history is ignored on boot because jobs are runtime-only', async () => {
    const jobs = {};
    for (let i = 0; i < 10; i += 1) {
      jobs[`job-${i}`] = { id: `job-${i}`, state: 'done', created_at: 1000 + i, updated_at: 1000 + i };
    }

    resetStores();
    const unstamped = createKv();
    installHost({ device: unstamped, saveFile: createKv() });
    unstamped.map.set('onx_nxstore_jobs', structuredClone(jobs));
    await openDb();
    const prunedSize = storeSize('jobs');

    resetStores();
    delete globalThis.risuai;
    const stamped = createKv();
    installHost({ device: stamped, saveFile: createKv() });
    stamped.map.set('onx_nxstore_jobs', structuredClone(jobs));
    stamped.map.set('onx_nxstore_meta', {
      'storage:__migrated__': { key: 'storage:__migrated__', version: 3, at: 1 },
    });
    await openDb();

    assert.equal(prunedSize, 0);
    assert.equal(storeSize('jobs'), 0);
  });

  test('a fresh install stamps itself so it never scans', async () => {
    resetStores();
    installHost({ device: createKv(), saveFile: createKv() });

    await openDb();

    assert.equal(await storageMigratedVersion(), 3);
  });
});
