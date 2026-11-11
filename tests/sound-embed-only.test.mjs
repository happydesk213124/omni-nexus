import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';

/**
 * 「임베딩만」: an effect word is matched by the embedding alone, with the paragraphs around it, against each effect's
 * name, sound words and 상황. The glossary is neither read nor taught, so the same 「쾅」 is a door, a gun or thunder by
 * its scene. Also: each word of a reply asked ahead goes with its own scene, and JEV is shown the nearest effects of a
 * long list, not its first sixty. Driven through the real runtime with JEV and the embedding mocked.
 */
test('임베딩만: the scene decides which 쾅; the glossary is not read or taught; JEV sees the nearest of a long list', { timeout: 90000 }, async () => {
  const built = await build({ stdin: { contents: `import {soundData,updateSoundSettings,saveSoundData} from './src/storage/sound-store';import {omniSound} from './src/services/sound-runtime';import {ttsData,updateTtsSettings,loadTtsData} from './src/storage/tts-store';Object.assign(window,{soundData,updateSoundSettings,saveSoundData,omniSound,ttsData,updateTtsSettings,loadTtsData});`, resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife', loader: { '.txt': 'text' }, logLevel: 'silent' });
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  try {
    const page = await browser.newPage(), errors = [];
    page.setDefaultTimeout(8000); page.on('pageerror', error => errors.push(error.message));
    await page.route('https://embed.test/', route => route.fulfill({ contentType: 'text/html', body: '<html><body></body></html>' }));
    await page.goto('https://embed.test/');
    await page.evaluate(() => {
      // Three effects all heard as 쾅; only their 상황 tells them apart. The glossary says 쾅 is the door.
      const save = new Map([['omnisound.data', JSON.stringify({ version: 3, sfx: [
        { key: 'door', name: '문 쾅', tags: ['쾅'], note: '문을 세게 닫음', folder: '', source: 'url', url: 'https://snd.test/door.mp3' },
        { key: 'gun', name: '총성', tags: ['쾅'], note: '총을 쏨', folder: '', source: 'url', url: 'https://snd.test/gun.mp3' },
        { key: 'thunder', name: '천둥', tags: ['쾅'], note: '하늘에서 번개가 침', folder: '', source: 'url', url: 'https://snd.test/thunder.mp3' },
      ], glossary: [{ id: 'g', terms: ['쾅'], sfxKey: 'door', enabled: true }], settings: { sfxEnabled: true, sfxMatcher: 'embedding-only' } })]]);
      window.jevAsked = []; window.embedAsked = []; window.jevChoice = '1';
      const axes = [['문', '닫'], ['총', '쏘', '쐈', '쏨'], ['천둥', '번개', '하늘'], ['드럼', '두구']];
      window.vector = text => [...axes.map(words => words.some(w => text.includes(w)) ? 1 : 0), 0.05];
      window.risuai = {
        pluginStorage: { getItem: async k => save.get(k), setItem: async (k, v) => save.set(k, v) },
        getDatabase: async () => ({ modules: [], enabledModules: [] }), setDatabase: async () => {}, requestPluginPermission: async () => true,
        nativeFetch: async (url, options = {}) => {
          if (url.includes('decisions')) { const body = JSON.parse(options.body); window.jevAsked.push(body); return { ok: true, json: async () => ({ answers: Object.fromEntries(Object.keys(body.questions).map(k => [k, { choice: window.jevChoice }])) }) }; }
          if (url.includes('/embeddings')) { const body = JSON.parse(options.body); window.embedAsked.push(...body.input); return { ok: true, status: 200, json: async () => ({ data: body.input.map((text, index) => ({ index, embedding: window.vector(text) })) }) }; }
          return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
        },
      };
    });
    await page.addScriptTag({ content: built.outputFiles[0].text });
    await page.evaluate(async () => { await window.loadTtsData(); await window.omniSound.init(); await window.updateTtsSettings({ jev: { ...window.ttsData().settings.jev, key: 'jev-key' } }); });
    const plan = (word, story) => page.evaluate(async ([w, s]) => (await window.omniSound.sfxPlan(w, s)).map(row => row.item.key), [word, story]);
    const glossary = () => page.evaluate(() => window.soundData().glossary.flatMap(row => row.terms.map(term => `${term}>${row.sfxKey}`)));

    assert.deepEqual(await plan('쾅', '그가 방아쇠를 당겼다.\n총을 쐈다.'), ['gun'], 'a gun scene: the gun, though the glossary says the door');
    assert.deepEqual(await plan('쾅', '먹구름이 몰려왔다.\n하늘이 갈라지며 번개가 쳤다.'), ['thunder']);
    assert.deepEqual(await plan('쾅', '그녀가 방을 나가며 문을 닫았다.'), ['door']);
    assert.equal(await page.evaluate(() => window.jevAsked.length), 0, 'JEV is never asked');
    assert.deepEqual(await glossary(), ['쾅>door'], 'nothing is taught to the glossary');
    assert.ok(await page.evaluate(() => window.embedAsked.some(t => t.startsWith('장면: ') && t.includes('방아쇠'))), 'the scene went to the embedding');
    assert.ok(await page.evaluate(() => window.embedAsked.some(t => t.includes('상황: 총을 쏨'))), 'and each effect with its 상황');
    // The same word in the same scene is remembered: no request the second time.
    const before = await page.evaluate(() => window.embedAsked.length);
    assert.deepEqual(await plan('쾅', '그가 방아쇠를 당겼다.\n총을 쐈다.'), ['gun']);
    assert.equal(await page.evaluate(() => window.embedAsked.length), before);

    // A reply's effects asked ahead: each goes with its own scene (they all once went with the first one's).
    await page.evaluate(() => window.omniSound.prepareEffects([{ text: '쾅', context: '천둥 번개가 하늘을 갈랐다.' }, { text: '쾅', context: '그는 총을 쏘았다.' }]));
    const asked = await page.evaluate(() => window.embedAsked.filter(t => t.startsWith('장면: ')));
    assert.ok(asked.some(t => t.includes('천둥')) && asked.some(t => t.includes('총을 쏘았다')), asked.join(' | '));

    // 맞춰 보기 shows the ranking and plays nothing.
    const tried = await page.evaluate(() => window.omniSound.tryEffectMatch('쾅', '총을 쐈다'));
    assert.equal(tried[0].name, '총성'); assert.ok(tried.slice(1).every(row => row.score < tried[0].score), JSON.stringify(tried));

    // 「용어집 → 임베딩」: the glossary decides first, as before.
    await page.evaluate(() => window.updateSoundSettings({ sfxMatcher: 'embedding' }));
    assert.deepEqual(await plan('쾅', '그가 방아쇠를 당겼다.\n총을 쐈다.'), ['door'], 'with the glossary: its answer');

    // JEV with a long list: the effect that fits is the 70th, and JEV is shown it among the nearest.
    await page.evaluate(async () => {
      const filler = Array.from({ length: 70 }, (_, i) => ({ key: `f${i}`, kind: 'sfx', name: `소리 ${i}`, tags: [`잡음${i}`], folder: '', source: 'url', url: `https://snd.test/f${i}.mp3` }));
      filler[69] = { key: 'drum', kind: 'sfx', name: '드럼롤', tags: ['두구두구'], folder: '', source: 'url', url: 'https://snd.test/drum.mp3' };
      window.soundData().sfx.push(...filler); window.jevAsked = [];
      await window.updateSoundSettings({ sfxMatcher: 'jev' });
    });
    await plan('두구두구둥', '드럼이 울렸다');
    const shown = await page.evaluate(() => Object.values(window.jevAsked[0].questions[0].criteria));
    assert.ok(shown.length <= 61, `at most sixty effects and "new": ${shown.length}`);
    assert.ok(shown.some(line => line.startsWith('드럼롤')), 'the 70th effect is among them');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
