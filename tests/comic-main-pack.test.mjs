import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { build } from 'esbuild';

const built = await build({ entryPoints: ['src/domain/comic/main-pack.ts'], bundle: true, write: false, format: 'esm', platform: 'node' });
const api = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));
const norm = line => line.trim().replace(/\s+/g, ' ');

test('the shipped comic prompt still carries every line the main tagger shortens, so the saving cannot lapse unseen', () => {
  const shipped = fs.readFileSync('prompts/comic.txt', 'utf8').split(/\r?\n/).map(norm);
  assert.ok(api.COMIC_MAIN_REPLACEMENTS.length >= 5);
  for (const [from] of api.COMIC_MAIN_REPLACEMENTS) assert.ok(shipped.includes(norm(from)), `prompts/comic.txt lost: ${from.slice(0, 60)}`);
});

test('beside the main tagger the comic prompt says each shared rule once; the separate call keeps all of it', () => {
  const shipped = fs.readFileSync('prompts/comic.txt', 'utf8');
  const main = api.comicPackForMainTagger(shipped);
  assert.ok(main.length < shipped.length - 400, `only ${shipped.length - main.length} characters saved`);
  assert.doesNotMatch(main, /Ignore <img>|never passive voice|ending in exactly one indoor\/outdoor|Return raw JSON with pages/);
  assert.match(main, /source\/target\/mutual: as for shot characters/);
  assert.match(main, /wear_state: as for shot characters, earlier cuts counted/);
  // What only the comic prompt says stays.
  for (const kept of [/cut_kind/, /2::no humans::/, /Never emit Nkoma/, /bubble = speech\/thought\/narration/, /center_x\/center_y/, /"pages":\[/]) assert.match(main, kept);
});

test('a line the user rewrote goes as written, and CRLF text is read the same', () => {
  const mine = 'Ignore <img> and my own <Status> block.\r\n- wear_state = clothed/torn/topless/bottomless/nude/completely; only on change from previous state or earlier entries for that person.';
  const out = api.comicPackForMainTagger(mine);
  assert.match(out, /my own <Status> block/, 'an edited line is the user\'s');
  assert.match(out, /wear_state: as for shot characters/, 'a default line is shortened even under CRLF');
});
