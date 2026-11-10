import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundle = await build({ stdin: { contents: `export * from './src/services/chat-output';
  export { currentTtsContext, forgetOpenBot, noteStreamText, ttsCharacterSources } from './src/services/tts-context';
  export { resetDeviceStore } from './src/storage/device-store';`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node', loader: { '.txt': 'text' }, logLevel: 'silent' });
const load = tag => import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text + `\n//${tag}`).toString('base64')}`);

// Two bots in Risu's list; the second is open, on its second chat. `calls` counts what Risu is asked for.
let bots, open, calls, hostListeners, removed;
const chat = (id, lines) => ({ id, name: id, message: lines.map((data, i) => ({ role: i % 2 ? 'char' : 'user', data, chatId: `${id}-${i}` })) });
beforeEach(() => {
  bots = [
    { chaId: 'bot-a', name: 'A', desc: 'about A', chatPage: 0, chats: [chat('a1', ['hi', 'hello'])], additionalAssets: [] },
    { chaId: 'bot-b', name: 'B', desc: 'about B', chatPage: 1, chats: [chat('b1', ['x', 'y']), chat('b2', ['one', 'two', 'three', 'four'])], additionalAssets: [['face', 'path', 'png']] },
  ];
  open = 1; calls = { whole: 0, chat: 0, index: 0, all: 0 }; hostListeners = []; removed = 0;
  const save = new Map();
  globalThis.risuai = {
    pluginStorage: { getItem: async k => structuredClone(save.get(k)), setItem: async (k, v) => { save.set(k, structuredClone(v)); }, removeItem: async k => { save.delete(k); } },
    getDatabase: async keys => { if (keys.includes('characters')) calls.all++; return Object.fromEntries(keys.map(key => [key, key === 'characters' ? structuredClone(bots) : undefined])); },
    getCharacter: async () => { calls.whole++; return structuredClone(bots[open]); },
    getCharacterFromIndex: async i => { calls.whole++; return structuredClone(bots[i]); },
    getChatFromIndex: async (i, c) => { calls.chat++; return structuredClone(bots[i]?.chats[c] ?? null); },
    getCurrentCharacterIndex: async () => { calls.index++; return open; },
    getCurrentChatIndex: async () => { calls.index++; return bots[open].chatPage; },
    addRisuChatListener: async (mode, fn) => { hostListeners.push([mode, fn]); },
    removeRisuChatListener: async (mode, fn) => { removed++; hostListeners = hostListeners.filter(row => row[1] !== fn); },
  };
});
const tick = () => new Promise(resolve => setTimeout(resolve, 5));
const outputOf = i => ({ char: structuredClone(bots[i]), chat: structuredClone(bots[i].chats[bots[i].chatPage]), characterIndex: i, chatIndex: bots[i].chatPage, messageIndex: 1 });

test('Risu has one output listener for everyone, and it answers at once', async () => {
  const api = await load('hub');
  const heard = [];
  let release;
  const slow = async arg => { heard.push(['slow', arg.messageIndex]); await new Promise(resolve => { release = resolve; }); heard.push(['slow done']); };
  const failing = () => { heard.push(['failing']); throw new Error('one of them fails'); };
  const quick = arg => { heard.push(['quick', arg.char.chaId]); };
  await api.addChatOutputListener(slow); await api.addChatOutputListener(failing); await api.addChatOutputListener(quick);
  // The frozen UI's goes through the same one.
  await globalThis.__OMNI_CHAT_OUTPUT__.add(arg => { heard.push(['frozen', arg.chatIndex]); });
  assert.equal(hostListeners.length, 1, 'four listeners here, one for Risu: the bot is copied over the bridge once a reply');
  assert.equal(hostListeners[0][0], 'output');

  const answered = hostListeners[0][1](outputOf(1));
  assert.equal(answered, undefined, 'Risu is not kept waiting: the reply is over for it at once');
  // Each told in the order it asked, none held up by another's wait or failure.
  assert.deepEqual(heard, [['slow', 1], ['failing'], ['quick', 'bot-b'], ['frozen', 1]]);
  let settled = false; void api.chatOutputSettled().then(() => { settled = true; });
  await tick();
  assert.equal(settled, false, 'the slow one is still at it');
  release(); await api.chatOutputSettled();
  assert.deepEqual(heard.at(-1), ['slow done']);

  // The last one gone: Risu's listener goes too; someone asking again brings it back.
  await api.removeChatOutputListener(slow); await api.removeChatOutputListener(failing); await api.removeChatOutputListener(quick);
  assert.equal(removed, 0, 'the frozen UI still listens');
  for (const fn of [...hostListeners]) void fn; // (nothing to do: kept for the next assertion's count)
  const frozen = arg => { heard.push(['again', arg.chatIndex]); };
  await api.addChatOutputListener(frozen);
  assert.equal(hostListeners.length, 1);
});

test('a reader of the messages gets the open chat alone once the bot is known; anyone else the whole bot', async () => {
  const api = await load('context');
  api.forgetOpenBot();
  const first = await api.currentTtsContext({ chatOnly: true });
  assert.deepEqual([first.characterId, first.chatId, first.messages.length], ['bot-b', 'b2', 4]);
  assert.deepEqual([calls.whole, calls.chat], [1, 0], 'who is open is learned by one whole read');

  calls.whole = 0; calls.chat = 0;
  for (let i = 0; i < 5; i++) {
    const again = await api.currentTtsContext({ chatOnly: true });
    assert.deepEqual([again.characterId, again.chatId, again.sessionId, again.rosterScope, again.messages.length], [first.characterId, first.chatId, first.sessionId, first.rosterScope, 4]);
    assert.equal(again.character.name, 'B');
    assert.equal('chats' in again.character, false, 'the bot is known by name: its other chats are not carried along');
  }
  assert.deepEqual([calls.whole, calls.chat], [0, 5], 'five more reads: the open chat five times, the bot never');

  // A message added: the next read has it (nothing of the chat is kept between reads).
  bots[1].chats[1].message.push({ role: 'user', data: 'five', chatId: 'b2-4' });
  assert.equal((await api.currentTtsContext({ chatOnly: true })).messages.length, 5);

  // Who needs the bot itself gets it, by a whole read.
  calls.whole = 0;
  const whole = await api.currentTtsContext();
  assert.equal(Array.isArray(whole.character.chats) && whole.character.chats.length, 2);
  assert.equal(calls.whole, 1);

  // Who the bot is goes along with its description, for a voice pick, and no more of it.
  calls.whole = 0;
  const sources = await api.ttsCharacterSources(await api.currentTtsContext({ chatOnly: true }), { lore: false, persona: false, illustration: false });
  assert.deepEqual(sources.character, ['B', 'about B']);
  assert.equal(calls.whole, 0);
});

test('another chat of the bot is read alone; a chat it has not heard of, or another bot at its place, by a whole read', async () => {
  const api = await load('other');
  api.forgetOpenBot();
  await api.currentTtsContext({ chatOnly: true });
  calls.whole = 0; calls.chat = 0;
  // The reader turns to the bot's first chat.
  bots[1].chatPage = 0;
  assert.equal((await api.currentTtsContext({ chatOnly: true })).chatId, 'b1');
  assert.deepEqual([calls.whole, calls.chat], [0, 1]);
  // A chat made since: its id is news, so the bot is read (and the chat is known from then on).
  bots[1].chats.push(chat('b3', ['new'])); bots[1].chatPage = 2;
  assert.equal((await api.currentTtsContext({ chatOnly: true })).chatId, 'b3');
  assert.equal(calls.whole, 1);
  calls.whole = 0;
  assert.equal((await api.currentTtsContext({ chatOnly: true })).chatId, 'b3');
  assert.equal(calls.whole, 0);
  // Another bot is opened: its place in the list is another, so it is read whole, never taken for the one known.
  open = 0;
  const other = await api.currentTtsContext({ chatOnly: true });
  assert.deepEqual([other.characterId, other.chatId], ['bot-a', 'a1']);
  assert.equal(calls.whole, 1);
  // The known bot deleted, another now at its place in the list: the chat there is not one of the known bot's.
  open = 1; calls.whole = 0;
  await api.currentTtsContext({ chatOnly: true });
  bots[1] = { chaId: 'bot-c', name: 'C', chatPage: 0, chats: [chat('c1', ['z'])] };
  calls.whole = 0;
  const moved = await api.currentTtsContext({ chatOnly: true });
  assert.deepEqual([moved.characterId, moved.chatId], ['bot-c', 'c1'], 'never the deleted bot\'s id over another bot\'s chat');
  assert.equal(calls.whole, 1);
});

test('Risu\'s output event says who is open: the first read after a reply is already of the chat alone', async () => {
  const api = await load('event');
  api.forgetOpenBot();
  await api.addChatOutputListener(() => {});
  hostListeners[0][1](outputOf(1));
  const context = await api.currentTtsContext({ chatOnly: true });
  assert.deepEqual([context.characterId, context.chatId], ['bot-b', 'b2']);
  assert.equal(calls.chat, 1, 'who is open came with the event: the chat alone is asked for');
  // (One read of the bot is its TTS characters' own, once a bot: storage/tts-store.)
  assert.ok(calls.whole <= 1);
  calls.whole = 0; calls.chat = 0;
  await api.currentTtsContext({ chatOnly: true }); await api.currentTtsContext({ chatOnly: true });
  assert.deepEqual([calls.whole, calls.chat], [0, 2]);
  // A reply of a bot that is not the open one teaches nothing about the open one.
  api.forgetOpenBot(); calls.whole = 0;
  hostListeners[0][1](outputOf(0));
  assert.equal((await api.currentTtsContext({ chatOnly: true })).characterId, 'bot-b');
  assert.equal(calls.whole, 1, 'the open bot is read: what the event taught is another bot\'s place');
});
