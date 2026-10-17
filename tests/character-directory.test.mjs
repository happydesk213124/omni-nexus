import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

// The directory exists to cut host reads, so every assertion here counts them.
// RisuNest streams every message for one getDatabase(['characters']); PocketRisu
// deep-copies them. Neither may ever see more of these calls than before.
const bundle = await build({ stdin: { contents: `export * from './src/storage/character-directory.ts';
export { readCharacterRoster } from './src/storage/character-roster.ts';`, resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, write: false, format: 'esm', platform: 'node' });
let serial = 0;
async function fixture() {
  const api = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64') + '#' + serial++);
  const characters = [{ chaId: 'bot', name: 'Bot', chats: [{ id: 'one', name: 'One', message: [] }], globalLore: [] }];
  let reads = 0, gate = null;
  globalThis.risuai = {
    async getDatabase(keys) { reads++; assert.deepEqual(keys, ['characters']); if (gate) await gate; return { characters: structuredClone(characters) }; },
    async getCharacterFromIndex(index) { return structuredClone(characters[index]); },
  };
  return { api, characters, reads: () => reads, hold(promise) { gate = promise; } };
}

test('calls in flight share one read, and a finished read is reused', async () => {
  const f = await fixture();
  let release; f.hold(new Promise(resolve => { release = resolve; }));
  const both = Promise.all([f.api.characterDirectory(), f.api.characterDirectory(), f.api.characterDirectory({ fresh: true })]);
  release(); const [a, b, c] = await both;
  assert.equal(f.reads(), 1, 'three concurrent callers, one host read');
  assert.equal(a, b); assert.equal(a, c);
  assert.deepEqual(a[0].chats.map(chat => chat.id), ['one']);
  assert.equal(a[0].chats[0].message, undefined, 'no message bodies are kept');
  assert.ok(f.api.directoryWarm());
  await f.api.characterDirectory();
  assert.equal(f.reads(), 1, 'reused');
  await f.api.characterDirectory({ fresh: true });
  assert.equal(f.reads(), 2, 'fresh reads again');
});

test('a roster miss reads again only when the list it missed in was reused', async () => {
  const f = await fixture();
  assert.deepEqual(await f.api.readCharacterRoster('risu_nobody'), []);
  assert.equal(f.reads(), 1, 'a miss in a read just made is final: one read, as before');
  // A chat opened after the reused read is found by reading once more.
  f.characters[0].chats.push({ id: 'two', name: 'Two', message: [] });
  const { sessionIdHash } = await import('../.test-build/text-util.mjs');
  const scope = 'risu_' + sessionIdHash('bot|two');
  assert.deepEqual(await f.api.readCharacterRoster(scope), []);
  assert.equal(f.reads(), 2, 'the stale list missed, one fresh read found the new chat');
  assert.deepEqual(await f.api.readCharacterRoster(scope), []);
  assert.equal(f.reads(), 2, 'and the next lookup reuses that read');
});

test('a different host never sees another host\'s directory', async () => {
  const f = await fixture();
  await f.api.characterDirectory();
  const first = globalThis.risuai;
  globalThis.risuai = { ...first, async getDatabase() { return { characters: [{ chaId: 'other', chats: [] }] }; } };
  assert.equal(f.api.directoryWarm(), false);
  assert.equal((await f.api.characterDirectory())[0].chaId, 'other');
});
