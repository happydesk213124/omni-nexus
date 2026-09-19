import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  dropShotAsset,
  listShotAssets,
  putShotAsset,
  putShotAssetsBatch,
  readShotAssetBytes,
  resetShotModuleState,
  setKnownShotCount,
  shotModuleAvailable,
} from "../.test-build/shot-module.mjs";

const webpBytes = Uint8Array.from([
  0x52, 0x49, 0x46, 0x46, 0x20, 0x00, 0x00, 0x00,
  0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20,
  0x14, 0x00, 0x00, 0x00, 0x2f, 0x00, 0x00, 0x00,
  0x10, 0x07, 0x10, 0x11, 0x11, 0x88, 0x88, 0xfe,
  0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]);

function createHost({ readback = true } = {}) {
  const stored = new Map();
  const host = {
    saveAssetCalls: 0,
    setDatabaseCalls: 0,
    db: { modules: [], enabledModules: [] },
    async requestPluginPermission() {},
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
      if (!readback || !stored.has(path)) throw new Error("missing asset");
      return stored.get(path);
    },
  };
  return host;
}

describe("shot module", { concurrency: 1 }, () => {
// Tuples held back by the unloaded-list guard live in module scope on purpose —
// they are meant to survive until a write lands. Each test states its own
// preconditions instead of inheriting the previous one's.
beforeEach(() => resetShotModuleState());

test("shot module is unavailable without host asset APIs", () => {
  const prev = globalThis.risuai;
  globalThis.risuai = {};
  try {
    assert.equal(shotModuleAvailable(), false);
  } finally {
    globalThis.risuai = prev;
  }
});

test("putShotAsset writes a gallery module tuple and readback matches", async () => {
  const host = createHost();
  globalThis.risuai = host;

  const saved = await putShotAsset("card-9", webpBytes);

  assert.ok(saved?.path);
  assert.equal(saved.name, "inxshot_card-9.webp");
  assert.equal(host.db.modules[0].id, "inlay-gallery");
  assert.equal(host.db.modules[0].name, "⚛️Omni Nexus 갤러리");
  assert.equal(host.db.modules[0].namespace, "inlay.gallery");
  assert.deepEqual(host.db.modules[0].assets[0], [saved.name, saved.path, saved.name]);
  assert.deepEqual(host.db.enabledModules, ["inlay-gallery"]);
  assert.deepEqual(new Uint8Array(await readShotAssetBytes(saved.path)), webpBytes);
});

test("putShotAsset does not write the character-reference module", async () => {
  const host = createHost();
  host.db.modules = [{
    id: "inlay-char-ref",
    name: "Inlay 참고이미지",
    namespace: "inlay.char_ref",
    assets: [["inxref_aa.webp", "assets/ref.webp", "inxref_aa.webp"]],
  }];
  globalThis.risuai = host;

  await putShotAsset("card-9", webpBytes);

  assert.equal(host.db.modules.length, 2);
  assert.equal(host.db.modules[0].id, "inlay-char-ref");
  assert.equal(host.db.modules[0].assets.length, 1);
  assert.equal(host.db.modules[1].id, "inlay-gallery");
});

test("putShotAsset returns null when readback fails", async () => {
  const host = createHost({ readback: false });
  globalThis.risuai = host;

  assert.equal(await putShotAsset("card-9", webpBytes), null);
  assert.equal(host.db.modules.length, 0);
});

test("same card id replaces the module tuple", async () => {
  const host = createHost();
  globalThis.risuai = host;
  const first = await putShotAsset("card-9", webpBytes);
  const secondBytes = Uint8Array.from([...webpBytes.slice(0, -1), 0x01]);
  const second = await putShotAsset("card-9", secondBytes);

  assert.equal(host.db.modules[0].assets.length, 1);
  assert.equal(host.db.modules[0].assets[0][1], second.path);
  assert.notEqual(second.path, first.path);
  assert.deepEqual(new Uint8Array(await readShotAssetBytes(second.path)), secondBytes);
});

// The whole point of the batch is that a gallery migration costs one DB
// round-trip per batch, not one per image. A regression here is invisible
// except as "migration takes forever", so assert the call count.
test("putShotAssetsBatch commits every tuple with one setDatabase", async () => {
  const host = createHost();
  globalThis.risuai = host;

  const saved = await putShotAssetsBatch([
    { id: "card-1", bytes: webpBytes },
    { id: "card-2", bytes: webpBytes },
    { id: "card-3", bytes: webpBytes },
  ]);

  assert.equal(saved.length, 3);
  assert.equal(host.setDatabaseCalls, 1);
  assert.equal(host.saveAssetCalls, 3);
  assert.equal(host.db.modules[0].assets.length, 3);
  assert.deepEqual(saved.map((row) => row.name).sort(), [
    "inxshot_card-1.webp",
    "inxshot_card-2.webp",
    "inxshot_card-3.webp",
  ]);
});

test("putShotAssetsBatch skips unreadable shots and writes nothing", async () => {
  const host = createHost({ readback: false });
  globalThis.risuai = host;

  assert.deepEqual(await putShotAssetsBatch([{ id: "card-1", bytes: webpBytes }]), []);
  assert.equal(host.setDatabaseCalls, 0);
  assert.equal(host.db.modules.length, 0);
});

test("the room reaches the asset name and comes back out of the list", async () => {
  const host = createHost();
  globalThis.risuai = host;

  await putShotAssetsBatch([
    { id: "card-1", bytes: webpBytes, session_id: "risu_aaaa" },
    { id: "card-2", bytes: webpBytes, session_id: "risu_bbbb" },
    { id: "card-3", bytes: webpBytes },
  ]);

  assert.deepEqual(await listShotAssets(), [
    { id: "card-1", session: "risu_aaaa", path: "assets/shot-1.webp", name: "inxshot_card-1.srisu_aaaa.webp" },
    { id: "card-2", session: "risu_bbbb", path: "assets/shot-2.webp", name: "inxshot_card-2.srisu_bbbb.webp" },
    { id: "card-3", session: "", path: "assets/shot-3.webp", name: "inxshot_card-3.webp" },
  ]);
});

// The room now lives in the name, so replacing a shot must still find the old
// tuple by card id rather than by an exact name match.
test("a re-generated shot replaces its tuple even when the room changed", async () => {
  const host = createHost();
  globalThis.risuai = host;
  await putShotAsset("card-1", webpBytes, "risu_aaaa");
  await putShotAsset("card-1", webpBytes, "risu_bbbb");

  const rows = await listShotAssets();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].session, "risu_bbbb");
});

test("dropShotAsset finds a shot whose name carries a room", async () => {
  const host = createHost();
  globalThis.risuai = host;
  await putShotAsset("card-1", webpBytes, "risu_aaaa");

  assert.equal(await dropShotAsset("card-1"), true);
  assert.deepEqual(await listShotAssets(), []);
});

// PocketRisu 1.11 lazy-loads module assets, so a read can hand back an empty
// list for a module that has hundreds. Writing that back is what erased
// AssetGod users' assets. The bytes are already stored and readable here, so
// the saved row must still come back — `idbPut` discards the image it just
// generated when this returns null (stores.ts, the `else if` after putShotAsset).
test("an empty asset list while our index holds shots skips the module write", async () => {
  const host = createHost();
  host.db.modules = [{
    id: "inlay-gallery",
    name: "Inlay 갤러리",
    namespace: "inlay.gallery",
    assets: [],
  }];
  host.db.enabledModules = ["inlay-gallery"];
  globalThis.risuai = host;
  setKnownShotCount(() => 12);
  try {
    const saved = await putShotAsset("card-9", webpBytes);

    assert.ok(saved?.path, "the shot must still report its stored path");
    assert.deepEqual(new Uint8Array(await readShotAssetBytes(saved.path)), webpBytes);
    assert.equal(host.setDatabaseCalls, 0, "a one-item list must not replace the module");
    assert.deepEqual(host.db.modules[0].assets, []);
  } finally {
    setKnownShotCount(() => 0);
  }
});

// The mirror image: a list that is merely shorter than our index is a deletion
// the user actually made. Refusing those writes would strand the module.
test("a shorter but non-empty asset list still writes", async () => {
  const host = createHost();
  globalThis.risuai = host;
  await putShotAsset("card-1", webpBytes);
  setKnownShotCount(() => 5);
  try {
    await putShotAsset("card-2", webpBytes);

    assert.equal(host.db.modules[0].assets.length, 2);
  } finally {
    setKnownShotCount(() => 0);
  }
});

test("a shot skipped by the guard is registered by the next successful write", async () => {
  const host = createHost();
  host.db.modules = [{
    id: "inlay-gallery",
    name: "Inlay 갤러리",
    namespace: "inlay.gallery",
    assets: [],
  }];
  host.db.enabledModules = ["inlay-gallery"];
  globalThis.risuai = host;
  setKnownShotCount(() => 12);
  try {
    const skipped = await putShotAsset("card-9", webpBytes);
    assert.equal(host.setDatabaseCalls, 0);

    // The host recovers: the next read carries the real list again.
    host.db.modules[0].assets = [["inxshot_old.webp", "assets/old.webp", "inxshot_old.webp"]];
    await putShotAsset("card-10", webpBytes);

    const names = host.db.modules[0].assets.map((row) => row[0]).sort();
    assert.deepEqual(names, ["inxshot_card-10.webp", "inxshot_card-9.webp", "inxshot_old.webp"]);
    assert.ok(host.db.modules[0].assets.some((row) => row[1] === skipped.path));
  } finally {
    setKnownShotCount(() => 0);
  }
});

test("dropShotAsset removes only that shot tuple", async () => {
  const host = createHost();
  globalThis.risuai = host;
  await putShotAsset("card-9", webpBytes);
  await putShotAsset("card-8", webpBytes);

  assert.equal(await dropShotAsset("card-9"), true);
  assert.equal(host.db.modules[0].assets.length, 1);
  assert.equal(host.db.modules[0].assets[0][0], "inxshot_card-8.webp");
});
});
