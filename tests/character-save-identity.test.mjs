import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundle = await build({
  stdin: { contents: `export {upsertCharacter,replaceCharacters,listCharacters} from './src/services/characters'; export {mutateCharacterRoster} from './src/storage/character-roster';`, resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, write: false, format: 'esm', platform: 'node', loader: { '.txt': 'text' },
  define: { __PLUGIN_ID__: '"omni-nexus"', __PLUGIN_VERSION__: '"test"' },
});
const api = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
let bots;
beforeEach(() => {
  bots = ['a','b'].map(chaId => ({ chaId, globalLore: [], chats: [] }));
  globalThis.risuai = {
    getDatabase: async () => ({ characters: structuredClone(bots) }),
    getCharacterFromIndex: async i => structuredClone(bots[i]),
    setCharacterToIndex: async (i, value) => { bots[i] = structuredClone(value); },
  };
});
const row = (id, given_name, given_name_variants = []) => ({ id, name: id, given_name, given_name_variants, aliases: ['shared trigger'], surname: '김', appearance: 'blue eyes' });

test('Korean or English names merge across surnames, commas, case and spaces', async () => {
  for (const pair of [
    [row('one','유나',['Yuna']), row('two','유나',['Yoona'])],
    [row('one','유나',['Yuna']), row('two','윤아',['Yuna'])],
    [row('one','유나',['Yuna, Yoona']), row('two','윤아',['YO ONA','Yunah'])],
    [row('one','유나, 윤아'), row('two','윤아')],
  ]) {
    await api.mutateCharacterRoster('a', () => []);
    await api.upsertCharacter('a', pair[0]);
    await api.upsertCharacter('a', { ...pair[1], surname: '박' });
    assert.equal((await api.listCharacters('a')).length, 1);
  }
});

test('triggers, display names and surnames alone never merge; scopes stay separate', async () => {
  await api.replaceCharacters('a', [row('one',''), { ...row('two',''), name: 'one' }, row('three','민아'), row('four','유나')], { prune: true });
  assert.equal((await api.listCharacters('a')).length, 4);
  await api.upsertCharacter('b', row('other','유나'));
  assert.equal((await api.listCharacters('a')).length, 4);
  assert.equal((await api.listCharacters('b')).length, 1);
});

test('saving a bridge absorbs all existing rows regardless of order and deduplicates spellings', async () => {
  await api.mutateCharacterRoster('a', () => [row('a','',['Yuna']), row('c','',['Yoona']), row('b','',['Yuna','Yoona'])]);
  await api.upsertCharacter('a', { ...row('a','',['YUNA']), appearance: 'green eyes', costumes: [{name:'new',attire:'coat'}] });
  const saved = await api.listCharacters('a');
  assert.equal(saved.length, 1);
  assert.deepEqual(saved[0].given_name_variants.map(x=>x.toLowerCase()), ['yuna','yoona']);
  assert.equal(saved[0].appearance, 'green eyes');
  assert.equal(saved[0].costumes[0].name, 'new');
  assert.equal((await api.listCharacters('a')).length, 1);
});

test('batch save closes transitive groups and returns only persisted survivors', async () => {
  const result = await api.replaceCharacters('a', [row('a','',['Yuna']), row('c','',['Yoona']), row('b','',['Yuna','Yoona'])], { prune: true });
  assert.equal(result.length, 1);
  assert.equal((await api.listCharacters('a')).length, 1);
  assert.deepEqual(new Set(result[0].given_name_variants.map(x=>x.toLowerCase())), new Set(['yuna','yoona']));
});

test('same-row edits can remove a spelling without resurrecting it', async () => {
  await api.upsertCharacter('a', row('a','유나',['Yuna','Yoona']));
  await api.upsertCharacter('a', row('a','유나',['Yuna']));
  assert.deepEqual((await api.listCharacters('a'))[0].given_name_variants, ['Yuna']);
});

test('empty given-name fields never fall back to an uppercase display name', async () => {
  await api.replaceCharacters('a', [
    {...row('a',''), name:'HAN YUNA'}, {...row('b',''), name:'HAN YUNA'},
  ], {prune:true});
  const saved = await api.listCharacters('a');
  assert.equal(saved.length, 2);
  assert.ok(saved.every(row=>row.given_name === '' && row.given_name_variants.length === 0));
});

test('batch order cannot erase spellings when the surviving ID is saved last', async () => {
  const a = row('a','',['Yuna']);
  const b = row('b','',['Yoona']);
  const c = row('c','',['Yuna','Yoona']);
  await api.mutateCharacterRoster('a', () => [a,b,c]);
  await api.replaceCharacters('a', [c,b,a], { prune: true });
  const saved = await api.listCharacters('a');
  assert.equal(saved.length, 1);
  assert.deepEqual(new Set(saved[0].given_name_variants.map(x=>x.toLowerCase())), new Set(['yuna','yoona']));
});
