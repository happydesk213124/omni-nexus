import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundle = await build({ stdin: { contents: "export {pickPlace,placeEngine} from './src/services/place-backgrounds';export {loadTtsData,ttsData} from './src/storage/tts-store';export {loadSoundData} from './src/storage/sound-store';export {loadEmotionData,emotionData} from './src/storage/emotion-store';export {replyPlace,resetViewerPlaces} from './src/storage/viewer-places';export {resetDeviceStore} from './src/storage/device-store';export {PLACE_SAMPLES} from './src/config/place-samples';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node' });
const api = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

test("a reply that says no place: JEV picks one of the bot's backgrounds and the samples, once per message", async () => {
  const saved = new Map(), asked = [];
  const bot = { id: 'bot', index: 0, character: { chaId: 'bot', name: 'Bot', additionalAssets: [['omni_bg_library, indoors, night', 'assets/lib.webp', 'webp'], ['bg_b1d46bdb-879', 'assets/old.webp', 'webp'], ['미선_happy', 'assets/h.png', 'png']], emotionImages: [] } };
  globalThis.risuai = {
    pluginStorage: { getItem: async k => structuredClone(saved.get(k)), setItem: async (k, v) => saved.set(k, structuredClone(v)), removeItem: async k => saved.delete(k) },
    getDatabase: async () => ({ modules: [], enabledModules: [] }),
    // JEV: it answers the first choice, and keeps what it was asked.
    nativeFetch: async (url, init) => { asked.push(JSON.parse(String(init.body))); return new Response(JSON.stringify({ answers: { 0: { choice: '1' } } }), { status: 200, headers: { 'content-type': 'application/json' } }); },
  };
  api.resetDeviceStore(); api.resetViewerPlaces();
  await Promise.all([api.loadTtsData(), api.loadSoundData(), api.loadEmotionData()]);
  assert.equal(api.placeEngine('auto'), '', 'no key: no way to pick (the chat\'s place, else the stage stays)');
  api.ttsData().settings.jev.key = 'jev-key';
  assert.equal(api.placeEngine('auto'), 'jev');
  assert.equal(api.placeEngine('off'), '');
  const ids = { characterId: 'bot', chatId: 'chat', messageId: 'm1' };
  const picked = await api.pickPlace('하린이 서가 사이를 걸었다. 창밖은 어두웠다.', ids, bot, 'auto');
  assert.equal(picked, 'library, indoors, night', "the bot's own background is listed first");
  const criteria = Object.values(asked[0].questions[0].criteria);
  assert.equal(criteria[0], 'library, indoors, night');
  assert.ok(criteria.length <= 100 && criteria.includes('cafe, indoors, window, daytime'), 'the samples follow, a hundred at most');
  assert.ok(!criteria.includes('b1d46bdb-879') && !criteria.includes('미선_happy'), 'a hash-named background says no place; a sprite is none');
  assert.equal(await api.replyPlace('bot', 'chat', 'm1'), picked, "kept as that message's place");
});
