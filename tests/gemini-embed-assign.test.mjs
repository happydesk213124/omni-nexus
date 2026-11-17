import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

// Gemini › Google 목록에서 바로 고르기: a speaker still on the default voice gets a listed voice of their gender and
// pitch, the one nearest their first-line emoji by the embedding (whatever the 음성 선택 모델 is), or with no embedding
// set the one whose words their tags share. Nothing is designed and no model asked.
const built = await build({ stdin: { contents: `export * from './src/services/tts-characters';export * from './src/storage/tts-store';export * from './src/storage/sound-store';export * from './src/config/tts-defaults';export * from './src/domain/tts/voice-fit';export { geminiListedVoice } from './src/domain/tts/gemini-voices';export { loadGeminiVoiceList } from './src/services/gemini-voices';`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'browser', logLevel: 'silent' });
const api = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));

const context = { scope: 'g', rosterScope: 'bot:g', characterId: 'g', chatId: 'c', sessionId: 's', character: {}, chat: {}, messages: [] };
// A toy embedding: "bright" lights one axis, "calm" another; everything has a little of a third.
const vector = text => [/bright|cheerful/i.test(text) ? 1 : 0, /calm|low-pitched/i.test(text) ? 1 : 0, 0.1];

async function setUp({ embedKey }) {
  const saved = new Map(), asked = [];
  globalThis.risuai = {
    pluginStorage: { getItem: async k => saved.get(k), setItem: async (k, v) => saved.set(k, v) },
    getLocalPluginStorage: async () => ({ getItem: async k => saved.get('local:' + k), setItem: async (k, v) => saved.set('local:' + k, v), removeItem: async k => saved.delete('local:' + k) }),
    getCurrentLorebookEntries: async () => [], getDatabase: async () => ({ personas: [] }),
    runLLMModel: async () => { throw Error('no model is asked'); },
    nativeFetch: async (url, options) => {
      const body = options.body ? JSON.parse(options.body) : null;
      asked.push({ url, method: options.method, body });
      if (/embeddings/.test(url)) return { ok: true, status: 200, json: async () => ({ data: body.input.map((t, index) => ({ index, embedding: vector(t) })) }) };
      if (/\/voices/.test(url) && options.method === 'POST') return { ok: true, status: 200, json: async () => ({ id: 'voice_made' }) };
      return { ok: false, status: 404, json: async () => ({}) };
    },
  };
  const data = await api.loadTtsData();
  Object.assign(data.settings, { enabled: true, autoAssign: true, cueEmoji: true, engine: 'gemini', selector: 'llm' });
  Object.assign(data.settings.gemini, { key: 'AIza-test', assign: 'embedding', listed: true });
  data.geminiVoices = [
    { key: 'gemini:calm1', name: 'Calm', fishId: 'calm1', tags: ['calm', 'low-pitched'], gender: 'female', folder: '' },
    { key: 'gemini:bright1', name: 'Bright', fishId: 'bright1', tags: ['bright', 'cheerful'], gender: 'female', folder: '' },
  ];
  const mina = api.blankTtsCharacter('bot:g', 'Mina');
  data.characters = [mina];
  const sound = await api.loadSoundData();
  sound.settings.embed.provider = 'openai'; sound.settings.embed.key = embedKey; sound.settings.embed.endpoint = 'https://api.openai.com/v1/embeddings';
  return { data, asked };
}

test('Google 목록에서 바로 고르기: the default-voiced speaker gets the listed voice nearest their emoji, nothing designed, no model', async () => {
  const { data, asked } = await setUp({ embedKey: 'sk-test' });
  try {
    await api.ensureTtsSpeakers(context, ['Mina'], () => true, [], new Map([['Mina', '👩😊']]));
    const mina = data.characters.find(c => c.name === 'Mina');
    assert.equal(mina.geminiKey, 'gemini:bright1', '😊 (bright, friendly) is nearest the bright voice');
    assert.equal(mina.gender, 'female', 'the emoji gave her gender');
    assert.equal(asked.some(a => /\/voices/.test(a.url) && a.method === 'POST'), false, 'nothing designed');
    assert.ok(asked.some(a => /embeddings/.test(a.url)), 'picked by the embedding');
  } finally { delete globalThis.risuai; }
});

test('with no embedding set: the listed voice whose words their tags share, no key and no call, nothing designed', async () => {
  const { data, asked } = await setUp({ embedKey: '' });
  try {
    await api.ensureTtsSpeakers(context, ['Mina'], () => true, [], new Map([['Mina', '👩😊']]));
    assert.equal(data.characters.find(c => c.name === 'Mina').geminiKey, 'gemini:bright1', '😊 is 밝은 (bright): the voice listed as bright');
    assert.deepEqual(asked, [], 'nothing asked of anyone');
  } finally { delete globalThis.risuai; }
});

test('the pitch is matched outright: 🎻 (low) gets the low voice though the embedding is nearer the bright one; a child a high one', async () => {
  const { data } = await setUp({ embedKey: 'sk-test' });
  try {
    data.geminiVoices.push({ key: 'gemini:high1', name: 'High', fishId: 'high1', tags: ['calm', 'high-pitched'], gender: 'female', folder: '' });
    data.characters.push(api.blankTtsCharacter('bot:g', 'Yuna'));
    await api.ensureTtsSpeakers(context, ['Mina', 'Yuna'], () => true, [], new Map([['Mina', '👩😊🎻'], ['Yuna', '👧😊']]));
    assert.equal(data.characters.find(c => c.name === 'Mina').geminiKey, 'gemini:calm1', 'low-pitched, whatever else is near');
    assert.equal(data.characters.find(c => c.name === 'Yuna').geminiKey, 'gemini:high1', 'a child: the high voice (the list has no children)');
  } finally { delete globalThis.risuai; }
});

test('with no embedding and nothing shared: free and less used voices first, so a cast is not one voice', async () => {
  const { data } = await setUp({ embedKey: '' });
  try {
    data.geminiVoices = ['a', 'b', 'c'].map(id => ({ key: 'gemini:' + id, name: id.toUpperCase(), fishId: id, tags: ['conversational'], gender: 'female', folder: '' }));
    data.characters.push(api.blankTtsCharacter('bot:g', 'Yuna'), api.blankTtsCharacter('bot:g', 'Sora'));
    await api.ensureTtsSpeakers(context, ['Mina', 'Yuna', 'Sora'], () => true, [], new Map([['Mina', '👩🥺'], ['Yuna', '👩🥺'], ['Sora', '👩🥺']]));
    const keys = ['Mina', 'Yuna', 'Sora'].map(name => data.characters.find(c => c.name === name).geminiKey);
    assert.equal(new Set(keys).size, 3, keys.join(' '));
  } finally { delete globalThis.risuai; }
});

test('a listed voice: its pitch kept as the tag a character has (high-pitched), persona and context read', () => {
  const voice = api.geminiListedVoice({ id: 'en-us-fola', display_name: 'Fola', gender: 'female', pitch: 'high', persona: 'Warm, Friendly', context: 'Conversational', accent: 'American', description: 'A warm voice', language_code: 'en-US' });
  assert.deepEqual(voice.tags, ['Warm', 'Friendly', 'high-pitched', 'A warm voice', 'Conversational', 'American']);
  assert.equal(api.voicePitch(voice.tags), 'high');
  assert.equal(api.voicePitch(['low']), 'low', 'a list saved before: the bare word Google gives');
  assert.equal(api.wantedPitch(['child', 'bright']), 'high');
  assert.equal(api.wantedPitch(['high-pitched', 'deep']), '', 'both asked: neither');
  assert.deepEqual(api.ofPitch(['l', 'm'], 'high', row => row === 'l' ? 'low' : 'medium'), ['m'], 'no high voice: any but the low ones');
});

test('shared words: a tag every word of which the voice holds counts one, a twin half', () => {
  assert.equal(api.sharedWords(['young adult', 'friendly', 'timid'], 'Fola: Warm, Friendly, young adult female'), 2);
  assert.equal(api.sharedWords(['young adult'], 'adult narrator'), 0, 'both words, or none');
  assert.equal(api.sharedWords(['cheerful'], 'Puck · upbeat'), 0.5);
  assert.equal(api.sharedWords(['calm'], 'calming, soothing'), 1);
});

test('the list read in is kept even: as many of each gender and pitch, taken through the list and not off its top', async () => {
  const { data } = await setUp({ embedKey: '' });
  try {
    const rows = [...Array.from({ length: 400 }, (_, i) => ({ id: 'f' + i, gender: 'female', pitch: 'medium' })), ...Array.from({ length: 100 }, (_, i) => ({ id: 'm' + i, gender: 'male', pitch: 'low' })), ...Array.from({ length: 5 }, (_, i) => ({ id: 'h' + i, gender: 'female', pitch: 'high' }))];
    globalThis.risuai.nativeFetch = async () => ({ ok: true, status: 200, json: async () => ({ voices: rows }) });
    data.geminiVoices = [];
    await api.loadGeminiVoiceList('', 130);
    const count = prefix => data.geminiVoices.filter(v => v.key.startsWith('gemini:' + prefix) && Number.isInteger(Number(v.key.slice(8)))).length;
    assert.equal(data.geminiVoices.length, 130);
    assert.equal(count('h'), 5, 'the few high voices are all kept');
    assert.ok(count('m') > 40 && count('f') > 40, count('f') + ' female, ' + count('m') + ' male');
    assert.ok(data.geminiVoices.some(v => v.key.startsWith('gemini:f') && Number(v.key.slice(8)) > 300), 'from the far end of the list too');
  } finally { delete globalThis.risuai; }
});

test('a new install picks voices by the embedding, not a model (an LLM call per speaker is a bill nobody chose)', () => {
  assert.equal(api.ttsDefaults().selector, 'embedding');
  assert.equal(api.ttsDefaults().gemini.assign, 'design', 'Gemini still makes the voice of the tags by default');
});
