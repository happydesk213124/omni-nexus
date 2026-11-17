import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

// Gemini › Google 목록에서 임베딩으로 고르기: a speaker still on the default voice gets the listed voice nearest their
// first-line emoji, by the embedding alone (whatever the 음성 선택 모델 is), with nothing designed and no model asked.
const built = await build({ stdin: { contents: `export * from './src/services/tts-characters';export * from './src/storage/tts-store';export * from './src/storage/sound-store';export * from './src/config/tts-defaults';`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'browser', logLevel: 'silent' });
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

test('Google 목록에서 임베딩으로 고르기: the default-voiced speaker gets the listed voice nearest their emoji, nothing designed, no model', async () => {
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

test('Google 목록에서 임베딩으로 고르기 with no embedding set: the voice of their tags is made, as by default', async () => {
  const { data, asked } = await setUp({ embedKey: '' });
  try {
    await api.ensureTtsSpeakers(context, ['Mina'], () => true, [], new Map([['Mina', '👩😊']]));
    assert.equal(data.characters.find(c => c.name === 'Mina').geminiKey, 'gemini:voice_made');
    assert.equal(asked.some(a => /embeddings/.test(a.url)), false);
  } finally { delete globalThis.risuai; }
});

test('a new install picks voices by the embedding, not a model (an LLM call per speaker is a bill nobody chose)', () => {
  assert.equal(api.ttsDefaults().selector, 'embedding');
  assert.equal(api.ttsDefaults().gemini.assign, 'design', 'Gemini still makes the voice of the tags by default');
});
