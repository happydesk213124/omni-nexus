import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const code = (await build({ stdin: { contents: `export {characterSource} from './src/services/character-source';export {forgetCharacterDirectory} from './src/storage/character-directory';`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node' })).outputFiles[0].text;
const api = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));

// A host that counts how often every bot is copied and how often one is.
function host(bots) {
  const calls = { all: 0, one: [] };
  globalThis.risuai = {
    getDatabase: async keys => { if (keys?.includes('characters')) calls.all++; return { characters: structuredClone(bots) }; },
    getCharacterFromIndex: async i => { calls.one.push(i); return bots[i] ? structuredClone(bots[i]) : null; },
    getCharacter: async () => structuredClone(bots[0]),
  };
  api.forgetCharacterDirectory();
  return calls;
}
const bots = () => [{ chaId: 'a', name: 'A', chats: [] }, { chaId: 'b', name: 'B', chats: [], additionalAssets: [['B_smile', 'assets/b.png', 'png']] }];

test('a tagging pass reads its bot alone: the bot list once, then that one bot by index', async () => {
  const list = bots(), calls = host(list);
  assert.deepEqual(await api.characterSource('b'), list[1]);
  assert.deepEqual(await api.characterSource('b'), list[1]);
  assert.equal(calls.all, 1, 'every bot is copied once for the directory, then reused');
  assert.deepEqual(calls.one, [1, 1]);
  assert.equal(await api.characterSource('missing'), null);
  assert.deepEqual((await api.characterSource('')).chaId, 'a', 'no id: the live bot');
});

test('a bot that moved since the directory was read is found again, never a stranger', async () => {
  const list = bots(), calls = host(list);
  await api.characterSource('b');
  list.reverse();
  assert.equal((await api.characterSource('b')).chaId, 'b');
  assert.equal(calls.all, 2, 'one fresh directory read');
});

test('a host without getCharacterFromIndex keeps the old whole-list lookup', async () => {
  const list = bots(); host(list);
  delete globalThis.risuai.getCharacterFromIndex;
  assert.equal((await api.characterSource('b')).chaId, 'b');
});
