import assert from 'node:assert/strict';
import test from 'node:test';

import { remountChatCardChrome } from '../.test-build/chat-chrome.mjs';

test('remountChatCardChrome flips then restores largePortrait on char and persona', async () => {
  const char = { name: '야스파티', image: 'assets/bot.png', largePortrait: false };
  const personas = [{ name: '유저', icon: 'assets/me.png', largePortrait: true }];
  const host = {
    char,
    personas: structuredClone(personas),
    selectedPersona: 0,
    setCharacterCalls: [],
    setDatabaseCalls: [],
    async getChar() {
      return structuredClone(host.char);
    },
    async setChar(next) {
      host.setCharacterCalls.push({ at: Date.now(), ...structuredClone(next) });
      host.char = structuredClone(next);
    },
    async requestPluginPermission() {},
    async getDatabase() {
      return { personas: structuredClone(host.personas), selectedPersona: host.selectedPersona };
    },
    async setDatabase(next) {
      host.setDatabaseCalls.push({ at: Date.now(), ...structuredClone(next) });
      if (Array.isArray(next.personas)) host.personas = structuredClone(next.personas);
    },
  };
  globalThis.risuai = host;

  const out = await remountChatCardChrome();

  assert.equal(out.ok, true);
  assert.equal(out.remounted, true);
  assert.equal(host.setCharacterCalls.length, 2);
  assert.equal(host.setCharacterCalls[0].largePortrait, true);
  assert.equal(host.setCharacterCalls[1].largePortrait, false);
  assert.ok(
    host.setCharacterCalls[1].at - host.setCharacterCalls[0].at >= 40,
    'flip and restore must not share a tick or PocketRisu reuses the smashed card',
  );
  assert.equal(host.char.image, 'assets/bot.png');
  assert.equal(host.char.name, '야스파티');
  assert.equal(host.setDatabaseCalls.length, 2);
  assert.equal(host.setDatabaseCalls[0].personas[0].largePortrait, false);
  assert.equal(host.setDatabaseCalls[1].personas[0].largePortrait, true);
  assert.ok(
    host.setDatabaseCalls[1].at - host.setDatabaseCalls[0].at >= 40,
    'persona flip and restore must not share a tick',
  );
  assert.equal(host.personas[0].icon, 'assets/me.png');
});

test('remountChatCardChrome is a no-op without host character APIs', async () => {
  globalThis.risuai = {};
  const out = await remountChatCardChrome();
  assert.deepEqual(out, { ok: true, remounted: false });
});
