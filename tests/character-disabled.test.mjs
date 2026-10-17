import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

// 비활성화: kept in the roster, left out of tagging. And the roster command's reply parser.
const bundle = await build({
  stdin: { contents: `export {upsertCharacter,replaceCharacters,listCharacters,mergeRosterFromTagged,loadTaggerRoster} from './src/services/characters';
export {mutateCharacterRoster} from './src/storage/character-roster';
export {parseRosterCommandReply,rosterAddsInstruction} from './src/domain/character/roster-command';`, resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, write: false, format: 'esm', platform: 'node', loader: { '.txt': 'text' },
  define: { __PLUGIN_ID__: '"omni-nexus"', __PLUGIN_VERSION__: '"test"' },
});
const api = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
let bots;
beforeEach(() => {
  bots = [{ chaId: 'a', globalLore: [], chats: [] }];
  globalThis.risuai = {
    getDatabase: async () => ({ characters: structuredClone(bots) }),
    getCharacterFromIndex: async i => structuredClone(bots[i]),
    setCharacterToIndex: async (i, value) => { bots[i] = structuredClone(value); },
  };
});
const seed = async () => {
  await api.replaceCharacters('a', [
    { id: 'harin', name: '하린', aliases: ['Harin'], appearance: 'girl, black hair', attire: 'school uniform' },
    { id: 'minji', name: '민지', aliases: ['Minji'], appearance: 'girl, blue hair', attire: 'hoodie' },
  ], { prune: true });
  await api.mutateCharacterRoster('a', rows => rows.map(row => row.id === 'minji' ? { ...row, disabled: true } : row));
};

test('비활성화 survives a form save that never sends it, and an explicit enable clears it', async () => {
  await seed();
  // The settings form saves fields it knows; `disabled` is not one of them.
  await api.replaceCharacters('a', [{ id: 'harin', name: '하린', appearance: 'girl, black hair' }, { id: 'minji', name: '민지', appearance: 'girl, blue hair, smile' }]);
  let minji = (await api.listCharacters('a')).find(row => row.id === 'minji');
  assert.equal(minji.disabled, true);
  assert.match(minji.appearance, /smile/, 'the edit itself still saves');
  await api.upsertCharacter('a', { id: 'minji', name: '민지', disabled: false });
  minji = (await api.listCharacters('a')).find(row => row.id === 'minji');
  assert.equal(minji.disabled, undefined);
});

test('the tagger never sees a disabled character, and its results never write to one', async () => {
  await seed();
  const offered = await api.loadTaggerRoster({ sessionId: 'a', characterId: 'a' });
  assert.deepEqual(offered.map(row => row.name), ['하린'], 'left out of what the tagger is offered');
  const before = (await api.listCharacters('a')).find(row => row.id === 'minji');
  // An empty-looks row is the one tagging would otherwise fill in.
  await api.upsertCharacter('a', { id: 'jisu', name: '지수', aliases: ['Jisu'], appearance: '', disabled: true });
  const roster = await api.mergeRosterFromTagged({ sessionId: 'a', characterId: 'a',
    tagged: { new_characters: [{ name: '민지', appearance: 'boy, red hair', attire: 'armor' }, { name: '지수', appearance: 'girl, green hair', attire: 'dress' }], scenes: [] },
    shotChars: [{ name: 'Minji', appearance: 'boy, red hair' }, { name: 'Jisu', appearance: 'girl, green hair' }] });
  const rows = await api.listCharacters('a');
  assert.equal(rows.filter(row => row.name === '민지').length, 1, 'no second 민지 is made');
  const after = rows.find(row => row.id === 'minji');
  assert.equal(after.appearance, before.appearance, 'her saved looks are untouched');
  assert.equal(after.attire, before.attire);
  const jisu = rows.filter(row => row.name === '지수');
  assert.equal(jisu.length, 1);
  assert.equal(jisu[0].appearance, '', 'an empty disabled row is not filled by tagging');
  assert.ok(!roster.some(row => row.id === 'minji' || row.id === 'jisu'), 'the roster images are drawn from leaves them out');
});

test('a roster command reply keeps only listed ids; a delete beats an edit of the same person', () => {
  const listed = new Set(['harin', 'minji']);
  const reply = api.parseRosterCommandReply({
    edit: [{ id: 'harin', deltas: { remove_costumes: ['school'] } }, { id: 'ghost', deltas: { appearance: { add: ['x'] } } }, { id: 'minji', deltas: {} }, { id: 'harin', deltas: {} }],
    delete: ['minji', 'ghost', { id: 'minji' }],
    add: [{ name: '지수', description: '파란 단발' }, { name: '지수' }, { description: 'nameless' }],
  }, listed);
  assert.deepEqual(reply.edits, [{ id: 'harin', deltas: { remove_costumes: ['school'] } }]);
  assert.deepEqual(reply.deletes, ['minji']);
  assert.deepEqual(reply.adds, [{ name: '지수', description: '파란 단발' }]);
  assert.equal(api.rosterAddsInstruction(reply.adds), '지수 파란 단발');
  assert.throws(() => api.parseRosterCommandReply('not json', listed), /JSON/);
});
