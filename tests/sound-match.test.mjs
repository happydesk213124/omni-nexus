import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';

/**
 * 「자동」 matching order for an effect word: the glossary, then JEV, then
 * embedding, then a free guess from names and tags. Driven through the real
 * runtime with the JEV and embedding endpoints mocked.
 */
test('자동 matching: glossary → JEV → embedding → guess; JEV "none" is final; only JEV answers are learned', { timeout: 90000 }, async () => {
  const built = await build({ stdin: { contents: `import {soundData,updateSoundSettings,saveSoundData} from './src/storage/sound-store';import {omniSound} from './src/services/sound-runtime';import {ttsData,updateTtsSettings,loadTtsData} from './src/storage/tts-store';Object.assign(window,{soundData,updateSoundSettings,saveSoundData,omniSound,ttsData,updateTtsSettings,loadTtsData});`, resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife', loader: { '.txt': 'text' } });
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  try {
    const page = await browser.newPage(), errors = [];
    page.setDefaultTimeout(8000); page.on('pageerror', error => errors.push(error.message));
    await page.route('https://match.test/', route => route.fulfill({ contentType: 'text/html', body: '<html><body></body></html>' }));
    await page.goto('https://match.test/');
    await page.evaluate(() => {
      const save = new Map([['omnisound.data', JSON.stringify({ sfx: [
        { key: 'door', name: '문 쾅', tags: ['쾅쾅'], folder: '', source: 'url', url: 'https://snd.test/door.mp3' },
        { key: 'thunder', name: '천둥', tags: ['우르릉'], folder: '', source: 'url', url: 'https://snd.test/thunder.mp3' },
        { key: 'glass', name: '유리 깨짐', tags: ['쨍그랑'], folder: '', source: 'url', url: 'https://snd.test/glass.mp3' },
      ], settings: { sfxEnabled: true } })]]);
      window.jevAsked = []; window.embedAsked = []; window.jevChoice = '2'; window.jevDown = false;
      // A toy embedding: one axis per effect, lit by words that belong to it.
      const axes = [['문', '쾅', '쿵'], ['천둥', '우르릉', '쿠구궁', '번개'], ['유리', '쨍', '와장창']];
      window.vector = text => [...axes.map(words => words.some(w => text.includes(w)) ? 1 : 0), 0.05];
      window.risuai = {
        pluginStorage: { getItem: async k => save.get(k), setItem: async (k, v) => save.set(k, v) },
        getDatabase: async () => ({ modules: [], enabledModules: [] }), setDatabase: async () => {}, requestPluginPermission: async () => true,
        nativeFetch: async (url, options = {}) => {
          if (url.includes('decisions')) {
            const body = JSON.parse(options.body); window.jevAsked.push(body);
            if (window.jevDown) return { ok: false, status: 503, json: async () => ({ error: 'down' }), text: async () => 'down' };
            return { ok: true, json: async () => ({ answers: Object.fromEntries(Object.keys(body.questions).map(k => [k, { choice: window.jevChoice }])) }) };
          }
          if (url.includes('/embeddings')) {
            const body = JSON.parse(options.body); window.embedAsked.push({ url, key: options.headers?.Authorization, input: body.input });
            return { ok: true, status: 200, json: async () => ({ data: body.input.map((text, index) => ({ index, embedding: window.vector(text) })) }) };
          }
          return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
        },
      };
    });
    await page.addScriptTag({ content: built.outputFiles[0].text });
    await page.evaluate(async () => { await window.loadTtsData(); await window.omniSound.init(); await window.updateTtsSettings({ jev: { ...window.ttsData().settings.jev, key: 'jev-key' } }); });
    const plan = word => page.evaluate(async w => (await window.omniSound.sfxPlan(w, '')).map(row => row.item.key), word);
    const counts = () => page.evaluate(() => [window.jevAsked.length, window.embedAsked.length]);
    const glossary = () => page.evaluate(() => Object.fromEntries(window.soundData().glossary.flatMap(row => row.terms.map(term => [term, row.sfxKey]))));

    // JEV before the guess: 「쾅쾅」 is the door's own tag word, but a new spelling 「쾅쾅쾅」 goes to JEV, which picks 2 (천둥).
    assert.deepEqual(await plan('쾅쾅쾅'), ['thunder'], 'JEV decides before the name/tag guess');
    assert.equal((await glossary())['쾅쾅쾅'], 'thunder', 'and its answer is learned');
    // The glossary first: now it plays without asking.
    const [jev1] = await counts();
    assert.deepEqual(await plan('쾅쾅쾅'), ['thunder']); assert.equal((await counts())[0], jev1, 'a known word asks nothing');
    // JEV "none fits" is an answer: no guess, no embedding.
    await page.evaluate(() => { window.jevChoice = 'new'; });
    // ElevenLabs generation on: "none fits" makes a new effect (here it cannot: no ElevenLabs), never a guess.
    await page.evaluate(async () => { await window.updateSoundSettings({ sfxAutoCreate: true, elevenKey: 'el-key' }); });
    assert.deepEqual(await plan('쨍그랑쨍'), [], 'generation on: a "none fits" word waits for its own effect');
    assert.equal((await counts())[1], 0, 'and embedding is not asked');
    // Generation off: the closest effect plays anyway.
    await page.evaluate(async () => { await window.updateSoundSettings({ sfxAutoCreate: false, elevenKey: '' }); });
    assert.deepEqual(await plan('쨍쨍쨍'), ['glass'], 'generation off: JEV said none, the nearest effect still plays');
    assert.equal((await counts())[1], 1, 'found by the embedding');
    // JEV down: embedding next, borrowing the JEV key on OpenRouter; its pick is remembered, not learned.
    await page.evaluate(() => { window.jevDown = true; });
    assert.deepEqual(await plan('쿠구궁'), ['thunder'], 'embedding finds the nearest effect');
    const asked = await page.evaluate(() => window.embedAsked[0]);
    assert.match(asked.url, /openrouter\.ai\/api\/v1\/embeddings/); assert.equal(asked.key, 'Bearer jev-key', 'an empty OpenRouter key uses the JEV key');
    assert.equal((await glossary())['쿠구궁'], undefined, 'an embedding pick is not written into the glossary');
    const before = await counts();
    assert.deepEqual(await plan('쿠구궁'), ['thunder']); assert.deepEqual(await counts(), before, 'but it is remembered: the next play asks nothing');
    // JEV down and nothing near in the embedding: the free guess from names and tags.
    assert.deepEqual(await plan('우르릉쾅'), ['thunder'], 'guess: the effect whose tag the word contains');
    // No JEV key and no embedding key: only the guess, no requests at all.
    await page.evaluate(async () => { await window.updateTtsSettings({ jev: { ...window.ttsData().settings.jev, key: '' } }); });
    const quiet = await counts();
    assert.deepEqual(await plan('쨍그랑!'), ['glass']); assert.deepEqual(await counts(), quiet, 'nothing set up: free, local');
    // Another embedding provider uses its own key and address.
    await page.evaluate(async () => { await window.updateSoundSettings({ embed: { provider: 'voyage', model: 'voyage-3-lite', endpoint: '', key: 'vo-key' } }); });
    assert.deepEqual(await plan('번개침'), ['thunder']);
    const voyage = await page.evaluate(() => window.embedAsked.at(-1));
    assert.match(voyage.url, /api\.voyageai\.com\/v1\/embeddings/); assert.equal(voyage.key, 'Bearer vo-key');
    // BGM from a reply's text: JEV first; when it is down, the embedding picks the nearest track.
    await page.evaluate(async () => {
      window.soundData().bgm.push({ key: 'storm', kind: 'bgm', name: 'Storm', tags: ['천둥', 'dark'], folder: '', source: 'url', url: 'https://snd.test/storm.mp3' },
        { key: 'cafe', kind: 'bgm', name: 'Cafe', tags: ['유리', 'calm'], folder: '', source: 'url', url: 'https://snd.test/cafe.mp3' });
      await window.updateTtsSettings({ jev: { ...window.ttsData().settings.jev, key: 'jev-key' } });
      await window.updateSoundSettings({ bgmMatcher: 'auto', embed: { provider: 'openrouter', model: 'openai/text-embedding-3-small', endpoint: '', key: '' } });
      window.jevChoice = '1'; window.jevDown = false;
    });
    const track = text => page.evaluate(async t => (await window.omniSound.bgmForText(t, [], true)).key, text);
    const jevBefore = (await counts())[0];
    assert.equal(await track('번개가 치고 천둥이 울렸다.'), 'storm', 'JEV picks track 1');
    assert.equal((await counts())[0], jevBefore + 1);
    await page.evaluate(() => { window.jevDown = true; });
    assert.equal(await track('유리잔이 와장창 깨졌다.'), 'cafe', 'JEV down: the embedding picks the nearest track');
    await page.evaluate(async () => { await window.updateSoundSettings({ bgmMatcher: 'embedding', embed: { provider: 'openrouter', model: 'x', endpoint: '', key: '' } }); await window.updateTtsSettings({ jev: { ...window.ttsData().settings.jev, key: '' } }); });
    await assert.rejects(page.evaluate(() => window.omniSound.bgmForText('천둥', [], true)), /임베딩이 설정되지 않았습니다/, '「임베딩」 with no key says so');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
