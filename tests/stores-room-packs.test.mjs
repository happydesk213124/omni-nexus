import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';

import { CARD_PACK_KEY, ROOM_INDEX_KEY, isRetiredStorageKey } from '../.test-build/char-ref-keys.mjs';
import {
  cardsForSession,
  flushPersist,
  idbDelete,
  idbPut,
  resetStores,
  roomRows,
  storeSize,
} from '../.test-build/stores.mjs';

function createKv() {
  const map = new Map();
  const reads = [];
  return {
    map,
    reads,
    async getItem(key) {
      reads.push(key);
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

function installHost(kv) {
  const host = {
    async getLocalPluginStorage() {
      return kv;
    },
    pluginStorage: kv,
    async requestPluginPermission() {},
  };
  globalThis.risuai = host;
  return host;
}

function card(id, sessionId, extra = {}) {
  return { id, session_id: sessionId, shot_index: 0, created_at: 1000, ...extra };
}

/** The pack as stored, parsed however the kv chose to keep it. */
function pack(kv, sid) {
  const raw = kv.map.get(CARD_PACK_KEY(sid));
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

afterEach(() => {
  resetStores();
  delete globalThis.risuai;
});

test('cards live in memory and never touch the save file', async () => {
  resetStores();
  const kv = createKv();
  installHost(kv);

  await idbPut('cards', card('c1', 'risu_aaaa'));
  await idbPut('cards', card('c2', 'risu_aaaa'));
  await idbPut('cards', card('c3', 'risu_bbbb'));
  await flushPersist();

  // No per-room pack and no room index may be written: gallery data is
  // memory + Risu assets only. The whole-gallery row must not grow back either.
  assert.equal(kv.map.has(CARD_PACK_KEY('risu_aaaa')), false);
  assert.equal(kv.map.has(CARD_PACK_KEY('risu_bbbb')), false);
  assert.equal(kv.map.has(ROOM_INDEX_KEY), false);
  assert.equal(kv.map.has('onx_nxstore_cards'), false);
  assert.equal(storeSize('cards'), 3);
});

// There is no pack to open any more: reading a room touches no pack keys,
// because card rows are already in memory and pixels live in Risu assets.
test('opening a room reads no pack keys', async () => {
  const kv = createKv();
  installHost(kv);
  await idbPut('cards', card('c1', 'risu_aaaa'));
  await idbPut('cards', card('c2', 'risu_bbbb'));
  await flushPersist();

  kv.reads.length = 0;
  const rows = await cardsForSession('risu_aaaa');

  assert.deepEqual(rows.map((r) => r.id), ['c1']);
  assert.equal(kv.reads.includes(CARD_PACK_KEY('risu_aaaa')), false);
  assert.equal(kv.reads.includes(CARD_PACK_KEY('risu_bbbb')), false);
});

test('the in-memory folder list needs no index row', async () => {
  const kv = createKv();
  installHost(kv);
  await idbPut('cards', card('c1', 'risu_aaaa'));
  await idbPut('cards', card('c2', 'risu_bbbb'));
  await idbPut('cards', card('c3', 'risu_bbbb'));
  await flushPersist();

  await cardsForSession('risu_zzzz');

  assert.equal(storeSize('cards'), 3);
  assert.deepEqual(roomRows().map((r) => r.session_id).sort(), ['risu_aaaa', 'risu_bbbb']);
  assert.equal(kv.map.has(ROOM_INDEX_KEY), false);
});

// Deleting a card only touches memory now: there is no pack to rewrite and
// no half-loaded room to lose.
test('deleting one card leaves no save-file trace', async () => {
  const kv = createKv();
  installHost(kv);
  await idbPut('cards', card('c1', 'risu_aaaa'));
  await idbPut('cards', card('c2', 'risu_aaaa'));
  await idbPut('cards', card('c3', 'risu_aaaa'));
  await flushPersist();

  await idbDelete('cards', 'c2');
  await flushPersist();

  assert.equal(kv.map.has(CARD_PACK_KEY('risu_aaaa')), false);
  assert.equal(storeSize('cards'), 2);
});

test('an emptied room leaves nothing behind', async () => {
  const kv = createKv();
  installHost(kv);
  await idbPut('cards', card('c1', 'risu_aaaa'));
  await flushPersist();

  await idbDelete('cards', 'c1');
  await flushPersist();

  assert.equal(kv.map.has(CARD_PACK_KEY('risu_aaaa')), false);
  assert.deepEqual(roomRows(), []);
});

// Existing installs have everything in the two old rows. They are loaded into
// memory once, then left alone: the originals stay as a read-only backup and
// no pack or index row is ever written.
test('the old gallery-wide rows load into memory without writing packs', async () => {
  const kv = createKv();
  installHost(kv);
  kv.map.set('onx_nxstore_cards', {
    c1: { id: 'c1', session_id: 'risu_aaaa', created_at: 10 },
    c2: { id: 'c2', session_id: 'risu_bbbb', created_at: 20 },
  });
  kv.map.set('onx_nxstore_images', {
    c1: { id: 'c1', location: { session_id: 'risu_aaaa', character_id: 'ch1', chat_id: 'k1' }, has_png: true, png_bytes: 40 },
    c2: { id: 'c2', location: { session_id: 'risu_bbbb' }, has_png: true, png_bytes: 60 },
  });

  const rows = await cardsForSession('risu_aaaa');

  assert.deepEqual(rows.map((r) => r.id), ['c1']);
  assert.equal(kv.map.has(CARD_PACK_KEY('risu_aaaa')), false);
  assert.equal(kv.map.has(CARD_PACK_KEY('risu_bbbb')), false);
  assert.equal(kv.map.has(ROOM_INDEX_KEY), false);
  assert.equal(storeSize('images'), 2);

  const room = roomRows().find((r) => r.session_id === 'risu_aaaa');
  assert.equal(room.png_bytes, 40);
  assert.equal(room.character_id, 'ch1');
  assert.equal(room.chat_id, 'k1');

  // Preserve original rows as a read-only recovery backup. No split marker:
  // legacy rows load straight into memory, nothing is rewritten.
  assert.equal(kv.map.has('onx_nxstore_cards'), true);
  assert.deepEqual(Object.keys(kv.map.get('onx_nxstore_cards')), ['c1', 'c2']);
  assert.equal(kv.map.has('onx_chat_legacy_packs_split'), false);
});

test('a second open loads memory only and writes nothing new', async () => {
  const kv = createKv();
  installHost(kv);
  kv.map.set('onx_nxstore_cards', { c1: { id: 'c1', session_id: 'risu_aaaa', created_at: 10 } });
  await cardsForSession('risu_aaaa');
  await flushPersist();

  resetStores();
  installHost(kv);
  await idbPut('cards', card('c9', 'risu_cccc'));
  await flushPersist();

  // Legacy rows load straight into memory on demand (even with no pack),
  // and nothing new is written to the save file.
  assert.equal(kv.map.has(CARD_PACK_KEY('risu_aaaa')), false);
  assert.equal(kv.map.has(CARD_PACK_KEY('risu_cccc')), false);
  assert.equal(storeSize('cards'), 2);
});

test('retired storage keys are old inx_ rows and the IDB copy stamp', () => {
  assert.equal(isRetiredStorageKey('inx_nxcards_risu_aaa'), true);
  assert.equal(isRetiredStorageKey('onx_ps_from_idb'), true);
  assert.equal(isRetiredStorageKey('onx_native_settings'), false);
  assert.equal(isRetiredStorageKey('onx_nxcards_risu_aaa'), false);
});
