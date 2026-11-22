import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

// 폴더 (캐릭터 · 스타일 프리셋): members by id beside the rosters, never in them. A character folder's shared looks
// (폴더 공통 태그) join a member only as a shot is built; the character LLM is shown the folders and may file a new person.
const built = await build({ stdin: { contents: "export * from './src/domain/character/folders';export * from './src/services/folders';export {characterCreateMessages,parseCharacterCreateReply,characterFolderNote} from './src/domain/character/create';export {GLOBAL_SCOPE,FOLDERS_KEY} from './src/core/constants';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node' });
const api = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));

// One store for the file: the plugin opens Risu's storage once and keeps it.
const kv = new Map();
globalThis.risuai = { pluginStorage: { getItem: async k => kv.get(k), setItem: async (k, v) => { kv.set(k, structuredClone(v)); }, removeItem: async k => kv.delete(k) } };
function host() { kv.clear(); api.resetFolderCache(); return kv; }

test('a folder list keeps what it can hold: named folders, each member in one folder, looks on character folders only', () => {
  const list = api.normalizeFolderList([
    { id: 'f1', name: ' 네일샵 ', members: ['a', 'b', 'a', 7], attire: 'black apron', junk: 1 },
    { id: 'f2', name: '학교', members: ['b', 'c'] },
    { id: 'f1', name: 'same id again', members: ['z'] }, { id: '', name: 'no id' }, { id: 'f3' }, null,
  ], true);
  assert.deepEqual(list, [{ id: 'f1', name: '네일샵', members: ['a', 'b'], attire: 'black apron' }, { id: 'f2', name: '학교', members: ['c'] }]);
  assert.deepEqual(api.normalizeFolderList([{ id: 'p', name: '실사', members: ['x'], attire: 'no looks on a preset folder' }], false), [{ id: 'p', name: '실사', members: ['x'] }]);
  assert.deepEqual(api.normalizeFolderData(undefined), { version: 1, characters: {}, presets: [] });
});

test('moving files a member in one folder only, and out of all with no target', () => {
  const folders = [{ id: 'f1', name: 'A', members: ['a', 'b'] }, { id: 'f2', name: 'B', members: ['c'] }];
  assert.deepEqual(api.moveToFolder(folders, ['a', 'c'], 'f2')[0].members, ['b']);
  assert.deepEqual(new Set(api.moveToFolder(folders, ['a', 'c'], 'f2')[1].members), new Set(['a', 'c']));
  assert.deepEqual(api.moveToFolder(folders, ['a'], '').map(f => f.members), [['b'], ['c']]);
  assert.equal(api.folderOf(folders, 'c').id, 'f2');
  assert.equal(api.folderOf(folders, 'nobody'), undefined);
  assert.equal(api.folderNamed(folders, ' a ').id, 'f1', 'by name, case and spacing aside');
  assert.equal(api.folderNamed(folders, 'C'), undefined);
});

test('an order of tiles: set down before or after another, several keeping their own order; kept per roster and absent until made', async () => {
  const ids = ['a', 'b', 'c', 'd'];
  assert.deepEqual(api.reorderIds(ids, ['d'], 'a', 'before'), ['d', 'a', 'b', 'c']);
  assert.deepEqual(api.reorderIds(ids, ['a'], 'c', 'after'), ['b', 'c', 'a', 'd']);
  assert.deepEqual(api.reorderIds(ids, ['d', 'b'], 'a', 'after'), ['a', 'b', 'd', 'c'], 'the moved keep the order they stood in');
  assert.deepEqual(api.reorderIds(ids, ['a'], 'a', 'before'), ids, 'onto itself: nothing');
  assert.deepEqual(api.reorderIds(ids, ['a'], 'nobody', 'before'), ids);
  assert.deepEqual(api.normalizeOrder(['a', 'a', '', 3, ' b ']), ['a', 'b']);
  assert.equal('order' in api.normalizeFolderData({}), false, 'no order saved: no key');
  const kv = host();
  assert.deepEqual(await api.characterOrder('s1', 'bot'), []);
  await api.saveCharacterOrder('s1', 'bot', ['b', 'a']);
  assert.deepEqual(kv.get(api.FOLDERS_KEY), { version: 1, characters: {}, presets: [], order: { bot: ['b', 'a'] } });
  api.resetFolderCache();
  assert.deepEqual(await api.characterOrder('s1', 'bot'), ['b', 'a']);
  assert.deepEqual(await api.characterOrder('s1', 'other-bot'), []);
  await api.saveCharacterOrder('s1', 'bot', []);
  assert.equal('order' in kv.get(api.FOLDERS_KEY), false, 'cleared: the key goes');
});

test('폴더 공통 태그: look tags are joined (folder first, each once); every other field fills only what the member left empty', () => {
  const folder = { id: 'f', name: '네일샵', members: ['a'], appearance: 'slim, friendly look', hair_color: 'brown hair', attire: 'black nail salon apron', age: '20s' };
  const member = { id: 'a', name: '진우', appearance: '1girl, Slim', hair_color: 'black hair', attire: '', bottoms: 'black pants' };
  assert.deepEqual(api.withFolderLooks(member, folder), { id: 'a', name: '진우', appearance: 'slim, friendly look, 1girl', hair_color: 'black hair', attire: 'black nail salon apron', bottoms: 'black pants', age: '20s' });
  assert.equal(member.attire, '', 'the saved row is not touched');
  assert.equal(api.withFolderLooks(member, undefined), member);
  assert.equal(api.withFolderLooks(member, { id: 'e', name: '빈 폴더', members: ['a'] }), member, 'a folder with no looks changes nothing');
});

test('the roster a shot is built from: members get their folder\'s looks; with no folder the rows come back as they were', async () => {
  host();
  const rows = [{ id: 'a', name: '진우', scope: 's1', appearance: '1girl' }, { id: 'g', name: '유나', scope: api.GLOBAL_SCOPE, appearance: '1girl' }, { id: 'x', name: '경비원', scope: 's1', appearance: '1boy' }];
  assert.equal(await api.rosterWithFolderLooks(rows, 'bot'), rows, 'no folder anywhere: the same array');
  await api.saveCharacterFolders('s1', 'bot', [{ id: 'f1', name: '네일샵', members: ['a', 'g'], attire: 'apron' }]);
  await api.saveCharacterFolders(api.GLOBAL_SCOPE, '', [{ id: 'f2', name: '학교', members: ['g'], attire: 'school uniform' }]);
  const seen = await api.rosterWithFolderLooks(rows, 'bot');
  assert.deepEqual(seen.map(r => r.attire), ['apron', 'school uniform', undefined], 'a bot row by the bot\'s folders, a 전역 row by 전역 로스터\'s');
  assert.equal(rows[0].attire, undefined, 'a copy: the rows given are untouched');
  assert.equal((await api.rosterWithFolderLooks(rows, 'other-bot'))[0].attire, undefined, 'another bot has its own folders');
});

test('folders are kept in plugin storage under one key and read back', async () => {
  const kv = host();
  await api.saveCharacterFolders('s1', 'bot', [{ id: 'f1', name: '네일샵', members: ['a'], attire: 'apron' }]);
  await api.savePresetFolders([{ id: 'p1', name: '실사', members: ['preset-1'] }]);
  assert.deepEqual(kv.get(api.FOLDERS_KEY), { version: 1, characters: { bot: [{ id: 'f1', name: '네일샵', members: ['a'], attire: 'apron' }] }, presets: [{ id: 'p1', name: '실사', members: ['preset-1'] }] });
  api.resetFolderCache();
  assert.deepEqual(await api.characterFolders('s1', 'bot'), [{ id: 'f1', name: '네일샵', members: ['a'], attire: 'apron' }]);
  assert.deepEqual(await api.presetFolders(), [{ id: 'p1', name: '실사', members: ['preset-1'] }]);
  await api.saveCharacterFolders('s1', 'bot', []);
  assert.deepEqual(kv.get(api.FOLDERS_KEY).characters, {}, 'the last folder gone: no empty list left behind');
  let told = 0; const off = api.onFoldersChange(() => told++);
  await api.savePresetFolders([]); off(); await api.savePresetFolders([]);
  assert.equal(told, 1, 'a change is told while listening');
});

test('the character LLM: no folder, the request is word for word as before; with folders it is shown them and may file a new person', async () => {
  const base = { instruction: '네일샵 직원 유나를 추가', sharedPrompt: 'RULES', notes: [], roster: [], lore: [] };
  const before = api.characterCreateMessages(base);
  assert.deepEqual(api.characterCreateMessages({ ...base, folders: [] }), before);
  const withFolders = api.characterCreateMessages({ ...base, folders: [{ name: '네일샵', looks: 'black apron' }, { name: '학교' }] });
  assert.equal(withFolders.length, before.length + 1);
  const note = withFolders.at(-2).content;
  assert.match(note, /^# Reference: character folders\n\[\{"name":"네일샵","looks":"black apron"\},\{"name":"학교"\}\]/);
  assert.match(note, /add "folder": "<that folder's name>"/);
  assert.match(note, /Never invent a folder/);
  assert.equal(withFolders.at(-1).content, before.at(-1).content, 'the request itself stays last');
  assert.deepEqual(withFolders.slice(0, -2), before.slice(0, -1));
  // The reply's folder rides with the row, to be filed after the save.
  const [row] = api.parseCharacterCreateReply('{"new_characters":[{"name":"유나","appearance":"1girl, brown hair","folder":" 네일샵 "}]}');
  assert.equal(row.folder, '네일샵');
  assert.equal('folder' in api.parseCharacterCreateReply('{"new_characters":[{"name":"유나","appearance":"1girl, brown hair"}]}')[0], false);

  host();
  await api.saveCharacterFolders('s1', 'bot', [{ id: 'f1', name: '네일샵', members: [], attire: 'apron' }, { id: 'f2', name: '학교', members: ['old'] }]);
  assert.deepEqual(await api.folderListForLlm('s1', 'bot'), [{ name: '네일샵', looks: 'apron' }, { name: '학교' }]);
  assert.deepEqual(await api.folderListForLlm('s1', 'another-bot'), []);
  await api.fileNewCharacter('s1', 'bot', 'yuna', '네일 샵');
  await api.fileNewCharacter('s1', 'bot', 'old', '네일샵');
  await api.fileNewCharacter('s1', 'bot', 'ghost', '없는 폴더');
  assert.deepEqual((await api.characterFolders('s1', 'bot')).map(f => f.members), [['yuna'], ['old']], 'filed by name; someone already filed stays; an unknown folder files nobody');
});
