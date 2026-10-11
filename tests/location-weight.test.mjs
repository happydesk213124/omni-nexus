import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';

const built = await build({ stdin: { contents: `
  export { buildGenerationForShot, buildComicGenerationForShot } from './src/services/generation.ts';
  export { getConfig, setConfig } from './src/services/context.ts';
  export { normalizeLocationWeight, weightLocationTags } from './src/domain/prompt/location-weight.ts';
`, resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife', globalName: 'Subject' });
const ctx = { console, TextEncoder, TextDecoder, URL, setTimeout, clearTimeout,
  risuai: { pluginStorage: { getItem: async () => null, setItem: async () => {} } } };
runInNewContext(built.outputFiles[0].text, ctx);
const api = ctx.Subject;

test('location weight keeps neutral/empty tags and wraps decimal/zero weights without nesting', () => {
  for (const value of [undefined, null, '', 'invalid', Infinity]) assert.equal(api.normalizeLocationWeight(value), 1);
  assert.equal(api.normalizeLocationWeight(-1), 0);
  assert.equal(api.normalizeLocationWeight(8), 5);
  assert.equal(api.weightLocationTags('', 0.5), '');
  assert.equal(api.weightLocationTags('indoor, hotel, bed', 1), 'indoor, hotel, bed');
  assert.equal(api.weightLocationTags('indoor, 2::hotel::, {bed}', 0.5), '0.5::indoor, hotel, bed::');
  assert.equal(api.weightLocationTags('indoor, hotel, bed', 0), '0::indoor, hotel, bed::');
});

test('illustration and comic generation weight only the place while retaining location metadata', async () => {
  const initial = api.getConfig();
  try {
    for (const weight of [1, 0.5, 2, 0]) {
      api.setConfig({ ...initial, card: { ...initial.card, location_tag_weight: weight } });
      for (const comic of [false, true]) {
        const shot = { kind: comic ? 'comic' : 'illustration', location: 'indoor, hotel, bed',
          natural: 'Quiet room.', characters: [],
          ...(comic ? { comic_page: { koma: 2, layout: 'cut 1 is scene. window' } } : {}) };
        const buildPlan = comic ? api.buildComicGenerationForShot : api.buildGenerationForShot;
        const plan = await buildPlan({ shot, roster: [] });
        const expected = weight === 1 ? shot.location : `${weight}::${shot.location}::`;
        assert.ok(plan.main.includes(expected), `${comic ? 'comic' : 'illustration'} place weight ${weight}`);
        assert.equal(shot.location, 'indoor, hotel, bed');
        if (comic) assert.ok(plan.main.includes('2koma'));
      }
    }
  } finally { api.setConfig(initial); }
});
