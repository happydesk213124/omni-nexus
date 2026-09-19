import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundle = await build({ stdin: { contents: `export * from './src/storage/device-store';
  export * from './src/core/util/text'; export * from './src/core/constants';
  export {buildTaggerMessages, buildCharacterLooksMessages} from './src/services/tagger';
  export {fillComicPagesForShots} from './src/services/comic'; export {setConfig} from './src/services/context';
  export * from './src/services/session-author-note'; export {writeChatNote} from './src/storage/chat-session-store';`, resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, write: false, format: 'esm', platform: 'node', plugins: [{name:'capture-llm', setup(b) {
    b.onLoad({filter:/[\\/]services[\\/]llm-call\.ts$/}, () => ({loader:'ts', contents:'export async function callLlm(config,messages) { globalThis.__noteTestMessages = messages; return JSON.stringify({pages:[]}); }'}));
  }}] });
const api = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const sid = id => `risu_${api.sessionIdHash(`char-a|${id}`)}`;
let chars, legacy, writes, rejectSave, discardSave;
beforeEach(() => {
  chars = [{ chaId: 'char-a', globalLore: [{ content: 'character fixed' }], chats: [
    { id: 'one', message: [{ data: 'hello' }], localLore: [{ comment: 'unrelated', content: 'keep' }], note: 'keep note' },
    { id: 'two', message: [], localLore: [] },
  ] }];
  legacy = new Map(); writes = 0; rejectSave = false; discardSave = false;
  globalThis.risuai = {
    pluginStorage: { getItem: async k => structuredClone(legacy.get(k)), setItem: async (k,v) => legacy.set(k, structuredClone(v)), removeItem: async k => legacy.delete(k) },
    getDatabase: async () => ({ characters: structuredClone(chars) }),
    getCharacterFromIndex: async i => structuredClone(chars[i]),
    getChatFromIndex: async (i,j) => structuredClone(chars[i]?.chats[j]),
    setChatToIndex: async (i,j,v) => { writes++; if (rejectSave) throw new Error('save failed'); if (!discardSave) chars[i].chats[j] = structuredClone(v); },
  };
  api.resetDeviceStore();
});
const data = (i = 0) => JSON.parse(chars[0].chats[i].localLore.find(e => e.comment === 'omni.nexus.data').content);

test('pack reads never seed chat lore; writes and removes touch nothing', async () => {
  const key = api.CARD_PACK_KEY(sid('one'));
  const value = { cards: { a: { session_id: sid('one') } }, images: {} };
  legacy.set(key, value);
  // A legacy pack stays readable, but nothing is copied into the chat lorebook.
  assert.deepEqual(await api.psGet(key), value);
  assert.equal(chars[0].chats[0].localLore.some(e => e.comment === 'omni.nexus.data'), false);
  assert.deepEqual(legacy.get(key), value);
  // Pack writes are dropped everywhere: no lorebook entry, no legacy change.
  await api.psSet(key, { cards: {}, images: {} });
  assert.equal(chars[0].chats[0].localLore.some(e => e.comment === 'omni.nexus.data'), false);
  assert.deepEqual(legacy.get(key), value);
  // Removes are hands-off too: the user clears old values by hand.
  await api.psRemove(key);
  assert.deepEqual(await api.psGet(key), value);
  assert.deepEqual(legacy.get(key), value);
});

test('parallel updates merge separate keys; pack writes leave no lorebook trace', async () => {
  const key = api.CARD_PACK_KEY(sid('one'));
  await Promise.all([
    api.psSet(key, { cards: {}, images: {} }),
    api.setSessionAuthorNote(sid('one'), { prefix: 'prefix', suffix: 'suffix', character_id: 'char-a' }),
    api.persistSessionLocation(sid('one'), 'forest'),
  ]);
  // Notes and locations still land in chat lore; the pack key must not.
  const entries = chars[0].chats[0].localLore.filter(e => e.comment === 'omni.nexus.data');
  for (const e of entries) assert.ok(!Object.prototype.hasOwnProperty.call(JSON.parse(e.content).records, key));
  const note = await api.getSessionAuthorNote(sid('one'));
  assert.equal(note.prefix, 'prefix'); assert.equal(note.suffix, 'suffix'); assert.equal(note.location, 'forest');
});

test('mixed rows migrate only exact chat scope; globals and unified rows keep their backend', async () => {
  const key = api.STORE_KEY('characters');
  const unified = api.unifiedSessionIdForCharacter('char-a');
  const rows = { [`${sid('one')}\ta`]: { scope: sid('one'), id: 'a', name: 'old' },
    [`${unified}\tb`]: { scope: unified, id: 'b' }, '__global__\tc': { scope: '__global__', id: 'c' } };
  legacy.set(key, rows);
  assert.deepEqual(await api.psGet(key), rows);
  assert.equal(Object.keys(data().records[key]).length, 1);
  const next = structuredClone(rows); next[`${sid('one')}\ta`].name = 'new'; next['__global__\tc'].name = 'fixed';
  await api.psSet(key, next);
  assert.equal(legacy.get(key)[`${sid('one')}\ta`].name, 'old');
  assert.equal(legacy.get(key)['__global__\tc'].name, 'fixed');
  assert.deepEqual(await api.psGet(key), next);
  delete next[`${sid('one')}\ta`];
  await api.psSet(key, next);
  assert.deepEqual(await api.psGet(key), next);
});

test('pack writes are dropped for every sid shape, legacy or not', async () => {
  for (const id of [sid('one'), api.unifiedSessionIdForCharacter('char-a'), 'risu_unknown']) {
    const key = api.CARD_PACK_KEY(id);
    await api.psSet(key, { cards: {}, images: {} });
    assert.equal(legacy.has(key), false);
  }
  assert.equal(writes, 0);
});

test('rejected or silently discarded roster writes fail, retain backup, and queue recovers', async () => {
  const key = api.STORE_KEY('characters');
  const rowId = `${sid('one')}\ta`;
  legacy.set(key, { [rowId]: { scope: sid('one'), id: 'a', name: 'backup' } });
  rejectSave = true;
  await assert.rejects(api.psGet(key), /save failed/);
  rejectSave = false; discardSave = true;
  const next = { [rowId]: { scope: sid('one'), id: 'a', name: 'new' } };
  await assert.rejects(api.psSet(key, next), /verification failed/);
  assert.equal(legacy.get(key)[rowId].name, 'backup');
  discardSave = false;
  await api.psSet(key, next);
  assert.deepEqual(await api.psGet(key), next);
});

test('foreign or malformed lore is not touched by pack writes', async () => {
  chars[0].chats[0].localLore.push({ comment: 'omni.nexus.data', content: '{bad' });
  // Nothing is written, so there is nothing to protect: the write resolves
  // and the broken entry is left exactly as it was.
  await api.psSet(api.CARD_PACK_KEY(sid('one')), {});
  assert.equal(writes, 0);
  assert.equal(chars[0].chats[0].localLore.at(-1).content, '{bad');
});

test('duplicate chat identities do not pick a destination', async () => {
  chars[0].chats[1].id = 'one';
  await api.psSet(api.CARD_PACK_KEY(sid('one')), {});
  assert.equal(writes, 0);
});


test('a legacy unified pack stays readable while its writes are dropped', async () => {
  const key = api.CARD_PACK_KEY(api.unifiedSessionIdForCharacter('char-a'));
  const value = { cards: {a:{id:'a'},b:{id:'b'}}, images: {
    a:{id:'a',location:{character_id:'char-a',chat_id:'one'}},
    b:{id:'b',location:{character_id:'char-a',chat_id:'two'}}} };
  legacy.set(key, structuredClone(value));
  // Reads still merge the legacy rows; chat lorebooks gain nothing.
  assert.deepEqual(await api.psGet(key), value);
  assert.equal(chars[0].chats[0].localLore.some(e => e.comment === 'omni.nexus.data'), false);
  assert.equal(chars[0].chats[1].localLore.some(e => e.comment === 'omni.nexus.data'), false);
  // Writes are dropped: the legacy copy keeps its old label.
  value.cards.a.label = 'updated';
  await api.psSet(key, value);
  assert.equal(legacy.get(key).cards.a.label, undefined);
  assert.deepEqual(await api.psGet(key), legacy.get(key));
  await api.psSet(key, {cards:{},images:{}});
  assert.deepEqual(Object.keys(legacy.get(key).cards), ['a','b']);
});

test('author note has its own disabled chat lore and never reads old keys',async()=> {
 legacy.set(api.SESSION_AUTHOR_NOTE_KEY(sid('one')),{prefix:'old secret note'});
 assert.equal((await api.getSessionAuthorNote(sid('one'))).prefix,'');
 await api.setSessionAuthorNote(sid('one'),{prefix:'new note',suffix:'tail',location:'garden'});
 const entry=chars[0].chats[0].localLore.find(e=>e.comment==='omni.nexus.note');
 assert.equal(entry.key,'');assert.equal(entry.alwaysActive,false);assert.equal(JSON.parse(entry.content).note.prefix,'new note');
 assert.equal((await api.getSessionAuthorNote(sid('two'))).prefix,'');
 assert.equal(legacy.get(api.SESSION_AUTHOR_NOTE_KEY(sid('one'))).prefix,'old secret note');
 discardSave=true;await assert.rejects(()=>api.setSessionAuthorNote(sid('one'),{prefix:'lost'}),/verification/);
 discardSave=false;chars[0].chats[0].localLore.push(structuredClone(entry));
 await assert.rejects(()=>api.setSessionAuthorNote(sid('one'),{prefix:'bad'}),/Duplicate/);
});


test('note identity resolves actual chat while unified scope remains separate', async () => {
  const unified = api.unifiedSessionIdForCharacter('char-a');
  for (const chat of ['one', 'two']) {
    const identity = { character_id: 'char-a', chat_id: chat, unified_session_id: unified };
    const saved = await api.setSessionAuthorNote(unified, { ...identity, prefix: chat });
    assert.equal(saved.session_id, sid(chat));
    assert.equal((await api.getSessionAuthorNote(unified, identity)).prefix, chat);
  }
  assert.equal((await api.getSessionAuthorNote(unified)).prefix, '');
  await assert.rejects(api.setSessionAuthorNote(unified, {prefix: 'ambiguous'}), /Chat required/);
});

test('partial note saves preserve location and other omitted fields across direct concurrent writes', async () => {
  await api.setSessionAuthorNote(sid('one'), {prefix:'before',suffix:'tail',preset_id:'preset',location:'old'});
  await Promise.all([
    api.setSessionAuthorNote(sid('one'), {prefix:'after'}),
    api.writeChatNote(sid('one'), {location:'new'}),
  ]);
  assert.deepEqual(await api.getSessionAuthorNote(sid('one')), {
    ok:true, session_id:sid('one'), prefix:'after',suffix:'tail',preset_id:'preset',location:'new',text:'after\ntail',
  });
  await api.setSessionAuthorNote(sid('one'), {location:''});
  const note = await api.getSessionAuthorNote(sid('one'));
  assert.equal(note.location,''); assert.equal(note.prefix,'after');
});


test('session wear persists id-keyed, drops clothed and bogus, omits empty wear from GET', async () => {
  await api.persistSessionWearStates(sid('one'), [
    { id: 'a', name: 'A', wear: 'nude' },
    { id: 'b', name: 'B', wear: 'clothed' },
    { id: '', name: 'X', wear: 'nude' },
    { id: 'c', name: 'C', wear: 'flying' },
  ]);
  const note = await api.getSessionAuthorNote(sid('one'));
  assert.deepEqual(note.wear, [{ id: 'a', name: 'A', wear: 'nude' }]);
  await api.persistSessionWearStates(sid('one'), []);
  const cleared = await api.getSessionAuthorNote(sid('one'));
  assert.ok(!('wear' in cleared));
});

test('main, asset and comic taggers inject the actual chat note under unified scope', async () => {
  const unified = api.unifiedSessionIdForCharacter('char-a');
  await api.setSessionAuthorNote(sid('one'), {prefix:'FIRST_CHAT_ONLY',location:'garden'});
  await api.setSessionAuthorNote(sid('two'), {prefix:'SECOND_CHAT_ONLY'});
  api.setConfig({card:{lorebook:false,asset_nai_tags:'off',comic_llm_batch:'batch'},nai:{},llm:{}});
  const request = {session_id:unified,unified_session_id:unified,character_id:'char-a',chat_id:'one',assistant_text:'A quiet garden.'};
  const main = await api.buildTaggerMessages(request);
  const asset = await api.buildCharacterLooksMessages(request,'');
  await api.fillComicPagesForShots({shots:[{kind:'comic',characters:[],line:1}],roster:[],assistantText:request.assistant_text,
    sessionId:unified,chatSessionId:api.chatNoteSessionId(unified,request)});
  for (const messages of [main,asset,globalThis.__noteTestMessages]) {
    assert.match(JSON.stringify(messages), /FIRST_CHAT_ONLY/);
    assert.doesNotMatch(JSON.stringify(messages), /SECOND_CHAT_ONLY/);
  }
  assert.match(JSON.stringify(main), /prev_location: garden/);
  delete globalThis.__noteTestMessages;
});
