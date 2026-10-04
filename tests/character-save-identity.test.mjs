import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';

const bundle = await build({
  stdin: { contents: `export {upsertCharacter,replaceCharacters,listCharacters,mergeRosterFromTagged} from './src/services/characters'; export {mutateCharacterRoster} from './src/storage/character-roster';`, resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, write: false, format: 'esm', platform: 'node', loader: { '.txt': 'text' },
  define: { __PLUGIN_ID__: '"omni-nexus"', __PLUGIN_VERSION__: '"test"' },
  plugins: process.env.BREAK_COSTUME_SAVE_GUARD ? [{ name:'break-costume-preservation', setup(builder) {
    builder.onLoad({filter:/services[\\/]characters\.ts$/}, args=>({loader:'ts',contents:readFileSync(args.path,'utf8').replace('const survivor = sameRow || dup || rec;', 'const survivor = rec;')}));
  }}] : [],
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

test('new tagger character preserves identity in the default costume used by the editor', async () => {
  const looks = { appearance: 'boy, pale skin', hair_color: 'silver hair, white hair', hair_style: 'short hair, messy hair, bangs', eye_color: 'orange eyes, amber eyes' };
  for (const costumes of [undefined, [{ name: 'default', attire: 'white shirt', bottoms: 'black pants' }], [{ name: 'uniform', attire: 'white shirt' }]]) {
    await api.mutateCharacterRoster('a', () => []);
    await api.mergeRosterFromTagged({ sessionId: 'a', characterId: 'a', tagged: { new_characters: [{ name: '윤지호', given_name: '지호', gender: 'boy', ...looks, attire: 'white shirt', costumes }] }, shotChars: [] });
    const saved = (await api.listCharacters('a'))[0];
    assert.ok(saved);
    for (const [key, value] of Object.entries(looks)) {
      assert.equal(saved[key], value, key);
      assert.equal(saved.costumes[0][key], value, `editor default ${key}`);
    }
  }
});

test('reading legacy costumes inherits missing look slots but preserves explicit empty slots', async () => {
  for (const explicitEmpty of [false, true]) {
    await api.mutateCharacterRoster('a', () => [{ id: 'legacy', name: 'Legacy', hair_color: 'silver hair', appearance: 'boy', costumes: [{ name: 'default', attire: 'shirt', ...(explicitEmpty ? { hair_color: '' } : {}) }] }]);
    const saved = (await api.listCharacters('a'))[0];
    assert.equal(saved.costumes[0].hair_color, explicitEmpty ? '' : 'silver hair');
  }
});

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

test('saving a bridge keeps the survivor identity and appends every other design', async () => {
  await api.mutateCharacterRoster('a', () => [row('a','',['Yuna']), row('c','',['Yoona']), row('b','',['Yuna','Yoona'])]);
  await api.upsertCharacter('a', { ...row('a','',['YUNA']), appearance: 'green eyes', costumes: [{name:'new',attire:'coat'}] });
  const saved = await api.listCharacters('a');
  assert.equal(saved.length, 1);
  assert.deepEqual(saved[0].given_name_variants, ['Yuna']);
  assert.equal(saved[0].appearance, 'blue eyes');
  assert.equal(saved[0].costumes[0].name, 'default');
  assert.ok(saved[0].costumes.some(c=>c.appearance==='green eyes' && c.attire==='coat'));
  assert.ok(saved[0].costumes.some(c=>c.note.startsWith('c · ')));
  assert.ok(saved[0].costumes.some(c=>c.note.startsWith('b · ')));
  assert.equal((await api.listCharacters('a')).length, 1);
});

test('batch save closes transitive groups and returns only persisted survivors', async () => {
  const result = await api.replaceCharacters('a', [row('a','',['Yuna']), row('c','',['Yoona']), row('b','',['Yuna','Yoona'])], { prune: true });
  assert.equal(result.length, 1);
  assert.equal((await api.listCharacters('a')).length, 1);
  assert.deepEqual(result[0].given_name_variants, ['Yuna']);
  assert.ok(result[0].costumes.some(c=>c.note.startsWith('c · ')));
  assert.ok(result[0].costumes.some(c=>c.note.startsWith('b · ')));
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

test('batch order preserves the existing survivor and all donor costumes', async () => {
  const a = row('a','',['Yuna']);
  const b = row('b','',['Yoona']);
  const c = row('c','',['Yuna','Yoona']);
  await api.mutateCharacterRoster('a', () => [a,b,c]);
  await api.replaceCharacters('a', [c,b,a], { prune: true });
  const saved = await api.listCharacters('a');
  assert.equal(saved.length, 1);
  assert.equal(saved[0].id,'a');
  assert.deepEqual(saved[0].given_name_variants,['Yuna']);
  for (const owner of ['a','b','c']) assert.ok(saved[0].costumes.some(costume=>costume.note.startsWith(owner+' · ')),owner);
});

test('same given name preserves existing names, triggers, looks, images and selection', async () => {
  const old={id:'kim',name:'김지수',surname:'김',given_name:'지수',given_name_variants:['Jisu'],aliases:['지수','Kim Jisu'],gender:'girl',appearance:'girl, pale skin',hair_color:'black hair',hair_style:'long hair',eye_color:'blue eyes',age:'21',height:'160',attire:'shirt',bottoms:'skirt',accessories:'bag',ref_hash:'abc123',example_hash:'def456',cast_id:'a1b2',costumes:[{name:'default',note:'직접 적은 설명',attire:'shirt',bottoms:'skirt',accessories:'bag'},{name:'school',note:'기존 교복',attire:'uniform',bottoms:'skirt',accessories:''}],active_costume:1};
  await api.upsertCharacter('a',old);
  const before=(await api.listCharacters('a'))[0];
  assert.equal(before.cast_id,'a1b2');assert.equal(before.ref_hash,'abc123');assert.equal(before.example_hash,'def456');
  const incoming={id:'han',name:'한지수',surname:'한',given_name:'지수',given_name_variants:['Han Jisu'],aliases:['한지수','Han'],gender:'boy',appearance:'boy',hair_color:'red hair',hair_style:'short hair',eye_color:'green eyes',age:'30',attire:'coat',bottoms:'pants',accessories:'',ref_hash:'abcdef',example_hash:'012345',cast_id:'c3d4',costumes:[{name:'default',attire:'coat',bottoms:'pants',accessories:''},{name:'school',note:'교복',appearance:'[base]',hair_color:'[base]',hair_style:'[base]',eye_color:'[base]',age:'[base]',attire:'uniform',bottoms:'pants',accessories:''}]};
  await api.upsertCharacter('a',incoming);
  const saved=(await api.listCharacters('a'))[0];
  for(const key of ['id','name','surname','given_name','given_name_variants','aliases','appearance','hair_color','hair_style','eye_color','age','height','attire','bottoms','accessories','gender','ref_hash','example_hash','cast_id','active_costume']) assert.deepEqual(saved[key],before[key],key);
  assert.deepEqual(saved.costumes.slice(0,before.costumes.length),before.costumes);
  const extra=saved.costumes.filter(c=>c.note.startsWith('한지수 · '));
  assert.equal(extra.length,2);
  for(const costume of extra) {
    assert.equal(costume.hair_color,'red hair'); assert.equal(costume.eye_color,'green eyes'); assert.equal(costume.age,'30');
    assert.ok(!JSON.stringify(costume).includes('[base]'));
  }
  assert.equal(new Set(saved.costumes.map(c=>c.name)).size,saved.costumes.length);
  await api.upsertCharacter('a',incoming);
  assert.deepEqual((await api.listCharacters('a'))[0].costumes,saved.costumes,'repeat import does not accumulate costumes');
});

test('an unconfigured survivor never inherits the absorbed character images or cast id',async()=>{
  await api.upsertCharacter('a',{id:'kim',name:'김지수',given_name:'지수',appearance:'girl, pale skin'});
  await api.upsertCharacter('a',{id:'han',name:'한지수',given_name:'지수',appearance:'girl, dark skin',ref_hash:'abcdef',example_hash:'012345',cast_id:'c3d4'});
  const saved=(await api.listCharacters('a'))[0];
  assert.equal(saved.id,'kim');assert.ok(!saved.ref_hash);assert.ok(!saved.example_hash);assert.ok(!saved.cast_id);
});

test('default descriptions use the full name without asking the LLM', async () => {
  await api.upsertCharacter('a',{id:'kim',name:'지수',surname:'김',given_name:'지수',appearance:'girl'});
  assert.match((await api.listCharacters('a'))[0].costumes[0].note,/^김지수 · /);
  await api.mutateCharacterRoster('a',()=>[{id:'legacy',name:'한지수',given_name:'지수',appearance:'girl',costumes:[{name:'default',note:'',attire:'shirt',accessories:''}]}]);
  assert.match((await api.listCharacters('a'))[0].costumes[0].note,/^한지수 · /);
  await api.mutateCharacterRoster('a',()=>[]);
  await api.upsertCharacter('a',{id:'manual',name:'New Character'});
  await api.upsertCharacter('a',{id:'manual',name:'김한영',surname:'김',given_name:'한영'});
  assert.match((await api.listCharacters('a'))[0].costumes[0].note,/^김한영 · /);
});

test('given names require full equality, not substrings: 한영 never matches 한', async () => {
  await api.upsertCharacter('a',{id:'lee',name:'이한',surname:'이',given_name:'한',appearance:'boy'});
  await api.upsertCharacter('a',{id:'kim',name:'김한영',surname:'김',given_name:'한영',appearance:'boy'});
  assert.equal((await api.listCharacters('a')).length,2);
});

test('tagger character imports cannot overwrite an existing named costume in a second merge pass', async () => {
  await api.upsertCharacter('a',{id:'kim',name:'김지수',surname:'김',given_name:'지수',appearance:'girl, pale skin',costumes:[{name:'default',attire:'shirt'},{name:'school',note:'원래 교복',attire:'blue uniform'}]});
  const before=(await api.listCharacters('a'))[0];
  await api.mergeRosterFromTagged({sessionId:'a',characterId:'a',tagged:{new_characters:[{name:'김지수',given_name:'지수',appearance:'girl, dark skin',costumes:[{name:'school',note:'새 교복',attire:'red uniform'}]}]},shotChars:[]});
  const after=(await api.listCharacters('a'))[0];
  assert.deepEqual(after.costumes.slice(0,before.costumes.length),before.costumes);
  assert.ok(after.costumes.some(costume=>costume.note.startsWith('김지수 · ') && costume.attire==='red uniform'));
});
