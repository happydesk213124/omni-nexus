import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';

const built = await build({ stdin: { contents: `
  export { buildComicGenerationForShot } from './src/services/generation.ts';
  export { getConfig, setConfig } from './src/services/context.ts';
`, resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife', globalName: 'Subject' });

async function plan(names, settings = {}) {
  const ctx = { console, TextEncoder, TextDecoder, URL, setTimeout, clearTimeout,
    risuai: { pluginStorage: { getItem: async () => null, setItem: async () => {} } } };
  runInNewContext(built.outputFiles[0].text, ctx);
  const f = ctx.Subject;
  const config = f.getConfig();
  f.setConfig({ ...config, card: { ...config.card, person_tag_mode: 'gender',
    person_tag_solo: false, person_tag_weight: 1, character_max: 1, ...settings } });
  return f.buildComicGenerationForShot({
    shot: { kind: 'comic', characters: names.map(name => ({ name })), comic_page: { koma: 3 } },
    roster: [{ id: 'a', name: 'Alice', aliases: ['앨리스'], gender: 'girl' },
      { id: 'b', name: 'Bob', gender: 'boy' }],
  });
}

test('comic counts identities once without removing repeated panel captions or capping cast', async () => {
  const p = await plan(['Alice', 'Bob', '앨리스', 'Bob']);
  assert.equal(p.meta.person, '1::1girl, 1boy::');
  assert.equal(p.meta.characters.length, 4);
});

test('comic respects solo, disabled count, people mode, and weight', async () => {
  assert.equal((await plan(['Alice', '앨리스'], { person_tag_solo: true })).meta.person, '1::solo::');
  assert.equal((await plan(['Alice', 'Bob'], { person_tag_mode: 'off' })).meta.person, '');
  assert.equal((await plan(['Alice', 'Bob', 'Alice'], { person_tag_mode: 'people', person_tag_weight: 2 })).meta.person, '2::2people::');
  assert.equal((await plan([])).meta.person, '');
});
