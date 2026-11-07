import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

// The tagger never rewrites a saved costume by drawing in it. Clothes on a shot are that picture's.
const bundle = await build({
  stdin: { contents: `export {replaceCharacters,listCharacters,mergeRosterFromTagged} from './src/services/characters';
export {resolveCostumeWear} from './src/domain/character/costume';`, resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, write: false, format: 'esm', platform: 'node', loader: { '.txt': 'text' },
  define: { __PLUGIN_ID__: '"omni-nexus"', __PLUGIN_VERSION__: '"test"' },
});
const api = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const MAID = { name: 'maid', note: 'maid outfit', attire: 'maid dress, white apron', bottoms: 'black skirt', accessories: 'tray' };
let bots;
beforeEach(async () => {
  bots = [{ chaId: 'a', globalLore: [], chats: [] }];
  globalThis.risuai = {
    getDatabase: async () => ({ characters: structuredClone(bots) }),
    getCharacterFromIndex: async i => structuredClone(bots[i]),
    setCharacterToIndex: async (i, value) => { bots[i] = structuredClone(value); },
  };
  await api.replaceCharacters('a', [{
    id: 'hana', name: 'Hana', appearance: 'girl, black hair', attire: 'school uniform', bottoms: 'pleated skirt',
    costumes: [{ name: 'default', attire: 'school uniform', bottoms: 'pleated skirt', accessories: '' }, MAID],
  }], { prune: true });
});
const merge = (tagged, shotChars = []) => api.mergeRosterFromTagged({ sessionId: 'a', characterId: 'a', tagged: { new_characters: [], scenes: [], ...tagged }, shotChars });
const saved = async name => {
  const [row] = await api.listCharacters('a');
  const costume = row.costumes.find(c => c.name === name);
  return costume && [costume.attire, costume.bottoms, costume.accessories];
};
const untouched = [MAID.attire, MAID.bottoms, MAID.accessories];

test('clothes written on a shot leave the saved costume as it is, however the shot picks it', async () => {
  for (const costume of ['maid', 'Maid', 'maid[1]', '1', 1, { name: 'maid', attire: 'bikini' }]) {
    await merge({}, [{ name: 'Hana', costume, bottoms: 'torn black skirt' }]);
    assert.deepEqual(await saved('maid'), untouched, `picked as ${JSON.stringify(costume)}`);
  }
  await merge({}, [{ name: 'Hana', costume: 'maid', attire: '', bottoms: '', accessories: '' }]);
  await merge({}, [{ name: 'Hana', costume: 'maid', age: '20' }]);
  await merge({}, [{ name: 'Hana', costume: 'maid', attire: '[base], ribbon' }]);
  assert.deepEqual(await saved('maid'), untouched, 'blank, look-only and added clothes alike');
  const [row] = await api.listCharacters('a');
  assert.deepEqual(row.costumes.map(c => c.name), ['default', 'maid'], 'and no second costume from a pick by index');
});

test('a costume nobody has is still registered from a shot, the first shot saying what it is', async () => {
  await merge({}, [
    { name: 'Hana', costume: 'bikini', attire: 'white bikini', bottoms: 'bikini bottom' },
    { name: 'Hana', costume: 'bikini', attire: 'torn bikini' },
  ]);
  assert.deepEqual(await saved('bikini'), ['white bikini', 'bikini bottom', '']);
});

test('new_costumes under a saved name changes only the fields it wrote', async () => {
  await merge({ new_costumes: [{ name: 'Hana', costumes: [{ name: 'maid', bottoms: 'long black skirt' }] }] });
  assert.deepEqual(await saved('maid'), [MAID.attire, 'long black skirt', MAID.accessories]);
  await merge({ new_costumes: [{ name: 'Hana', costumes: [{ name: 'maid', attire: '[base], ribbon', accessories: '' }] }] });
  assert.deepEqual(await saved('maid'), [`${MAID.attire}, ribbon`, 'long black skirt', MAID.accessories], 'it adds to what is saved');
  await merge({ new_costumes: [{ name: 'Hana', costumes: [{ name: 'maid', attire: 'black maid dress' }] }] });
  assert.equal((await saved('maid'))[0], 'black maid dress', 'and bare tags in a written field replace it');
});

test('new_costumes in the same reply wins over a shot wearing it', async () => {
  await merge(
    { new_costumes: [{ name: 'Hana', costumes: [{ name: 'idol', attire: 'idol dress', bottoms: 'frilled skirt' }] }] },
    [{ name: 'Hana', costume: 'idol', bottoms: 'torn skirt' }],
  );
  assert.deepEqual(await saved('idol'), ['idol dress', 'frilled skirt', '']);
});
