import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import fs from 'node:fs';
import { chromium } from 'playwright';

/**
 * A `[[bgm:mood,place,tempo]]` cue: its tags leave a pool of tracks (the ones sharing the most, ten at most), and the
 * scene after the cue picks in it — by the embedding against each track's 상황 when one is set up, by a draw when not.
 * Before, the three tracks that came first in the list took every cue: with thirty tags and 187 example tracks a dozen
 * share the most tags, and the rest of them never played.
 */
const built = await build({ stdin: { contents: `export * from './src/domain/sound/tags';export * from './src/domain/sound/match';export {parseTtsMessage} from './src/domain/tts/segment';export {normalizeSoundData,upgradeSampleBgm} from './src/storage/sound-store';export {sampleSoundData,sampleBgmFor} from './src/config/sound-samples';`, resolveDir: process.cwd() }, bundle: true, write: false, format: 'esm', platform: 'node', loader: { '.txt': 'text' }, logLevel: 'silent' });
const api = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text + '\n//# sourceURL=bgm-scene-pick.mjs').toString('base64'));
const shipped = JSON.parse(fs.readFileSync('src/config/sound-samples/bgm.json', 'utf8'));
const item = (key, tags, note) => ({ key, kind: 'bgm', name: key, tags, folder: '', source: 'url', url: `https://x.test/${key}.mp3`, ...(note ? { note } : {}) });
/** A seeded random source (mulberry32): the same draws every run. */
const walk = (seed = 7) => () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

test('the pool: every track that shares the most tags can play, ten at a time; one a tag short joins only with the mood', () => {
  const ties = Array.from({ length: 13 }, (_, i) => item('t' + i, ['calm', 'night', 'slow']));
  const many = [...ties, item('other', ['happy', 'daily', 'fast'])];
  const pool = api.bgmPool(['calm', 'night', 'slow'], many, walk());
  assert.equal(pool.best, 3);
  assert.equal(pool.rows.length, api.BGM_POOL);
  assert.equal(api.BGM_POOL, 10);
  // Over many cues each of the thirteen is picked: the first three of the list no longer take them all.
  const random = walk(), drawn = new Set();
  for (let i = 0; i < 400; i++) drawn.add(api.pickBgm(['calm', 'night', 'slow'], many, '', random).key);
  assert.equal(drawn.size, 13, [...drawn].sort().join(','));
  // Ten or fewer: all of them, in the list's order, nothing drawn.
  assert.deepEqual(api.bgmPool(['calm', 'night', 'slow'], ties.slice(0, 4), () => { throw new Error('no draw needed'); }).rows.map(row => row.item.key), ['t0', 't1', 't2', 't3']);

  // One track has all three; the ones a tag short fill the pool, but only with the mood the cue asks for.
  const mood = [item('exact', ['romantic', 'night', 'slow']), item('near', ['romantic', 'night', 'mid']), item('place', ['romantic', 'cafe', 'slow']),
    item('scary', ['scary', 'night', 'slow']), item('one', ['romantic', 'city', 'fast'])];
  assert.deepEqual(api.bgmPool(['romantic', 'night', 'slow'], mood).rows.map(row => [row.item.key, row.score]), [['exact', 3], ['near', 2], ['place', 2]], 'scary night slow shares two tags and is left out; one tag in common is no candidate');
  // No track has all three: the ones sharing two are the pool, and those sharing one are not near.
  assert.deepEqual(api.bgmPool(['romantic', 'night', 'slow'], mood.slice(1)).rows.map(row => row.item.key), ['near', 'place', 'scary']);
  // Korean words for the tags reach the same pool.
  assert.deepEqual(api.bgmPool(['로맨틱', '밤', '느린'], mood).rows.map(row => row.item.key), ['exact', 'near', 'place']);
  assert.deepEqual(api.bgmPool(['festival'], mood), { best: 0, rows: [] });
});

test('the scene picks in the pool: the nearest tracks are drawn among, a track a tag short gives a little away', () => {
  const pool = { best: 3, rows: [{ item: item('a', []), score: 3 }, { item: item('b', []), score: 3 }, { item: item('c', []), score: 3 }, { item: item('d', []), score: 2 }] };
  const all = scores => { const random = walk(), seen = new Set(); for (let i = 0; i < 200; i++) seen.add(api.drawBgmByScene(pool, scores, random)); return [...seen].sort(); };
  assert.deepEqual(all([0.50, 0.30, 0.20, 0.10]), ['a'], 'one track clearly nearest: that one');
  assert.deepEqual(all([0.50, 0.48, 0.20, 0.10]), ['a', 'b'], 'two within BGM_NEAR: either');
  assert.deepEqual(all([0.50, 0.46, 0.20, 0.10]), ['a'], 'further than BGM_NEAR: not drawn');
  // d shares one tag fewer: the same scene score is not enough, a clearly better one is.
  assert.deepEqual(all([0.40, 0.10, 0.10, 0.42]), ['a', 'd']);
  assert.deepEqual(all([0.40, 0.10, 0.10, 0.40]), ['a', 'd'], '0.40 − 0.03 is still within 0.03 of the best');
  assert.deepEqual(all([0.40, 0.10, 0.10, 0.36]), ['a']);
  assert.deepEqual(all([0.10, 0.10, 0.10, 0.50]), ['d'], 'the scene can outweigh a tag');
  assert.equal(api.drawBgmByScene({ best: 0, rows: [] }, []), '');
});

test('a music cue carries the scene after it, 400 characters at most; at the end of a reply it takes what came before', () => {
  const cues = text => api.parseTtsMessage(text, [], 1, true, { bgm: true, sfxRules: [{ id: 's', name: 's', open: '§', close: '§', enabled: true }] }).filter(row => row.kind === 'bgm');
  const long = '창밖에는 비가 내리고 있었다. '.repeat(40);
  const [first] = cues(`도입 문단입니다.\n\n[[bgm:calm,night,slow]]\n${long}\n\n"괜찮아?" §똑똑§ 그가 물었다.`);
  assert.deepEqual(first.tags, ['calm', 'night', 'slow']);
  assert.equal(first.context.length, api.BGM_CUE_SCENE_MAX);
  assert.equal(api.BGM_CUE_SCENE_MAX, 400);
  assert.ok(first.context.startsWith('창밖에는 비가 내리고 있었다.'), first.context.slice(0, 40));
  assert.doesNotMatch(first.context, /도입 문단|bgm|§/, 'what follows the cue, without sound marks');
  // Two cues in one reply: each has its own scene.
  const [calm, chase] = cues('[[bgm:calm,cafe,slow]]\n카페는 조용했다. 잔이 부딪히는 소리만 들렸다. 두 사람은 한참 말이 없었다. 창가 자리에는 햇살이 길게 들어와 있었고, 식은 커피에서 김이 오르지 않았다.\n\n[[bgm:tense,chase,fast]]\n갑자기 문이 부서지며 사내들이 들이닥쳤다. 그는 그녀의 손을 잡고 뒷문으로 내달렸다. 골목을 돌 때마다 발소리가 가까워졌다. 숨이 턱까지 차올랐다.');
  assert.ok(calm.context.startsWith('카페는 조용했다.') && chase.context.startsWith('갑자기 문이 부서지며'), `${calm.context} | ${chase.context}`);
  assert.doesNotMatch(chase.context, /카페는 조용했다/);
  // A cue with nothing after it: the end of what came before.
  const [last] = cues('그녀는 편지를 접어 서랍에 넣었다. 다시는 꺼내 보지 않을 것이다.\n\n[[bgm:sad,home,slow]]');
  assert.match(last.context, /편지를 접어 서랍에 넣었다/);
  // HTML and Risu marks are not scene text.
  const [tagged] = cues('[[bgm:happy,daily,mid]]\n<span class="x">아침 햇살이</span> 방 안으로 쏟아졌다. {{user}}는 기지개를 켰다. 오늘은 아무 일정도 없는 날이었다. 부엌에서 고소한 빵 냄새가 났고, 고양이가 발치에서 몸을 비볐다.');
  assert.doesNotMatch(tagged.context, /[<>{}]/);
  assert.match(tagged.context, /아침 햇살이 방 안으로/);
});

test('every example track has its 상황, and a save from before takes it', () => {
  for (const row of shipped.items) assert.ok(row.note && row.note.length >= 8, `${row.key}: 상황`);
  assert.equal(new Set(shipped.items.map(row => row.note)).size, shipped.items.length, 'no 상황 twice: it is what tells tied tracks apart');
  assert.equal(shipped.items.length, 187);
  assert.ok(api.sampleSoundData().bgm.every(row => row.note), 'a first run starts with them');
  // The complaint this answers: calm, night, slow on the shipped list once played three tracks only.
  const list = api.normalizeSoundData(api.sampleSoundData()).bgm, random = walk(), drawn = new Set();
  for (let i = 0; i < 600; i++) drawn.add(api.pickBgm(['calm', 'night', 'slow'], list, '', random).key);
  assert.ok(drawn.size >= 12, `${drawn.size} tracks for calm, night, slow`);

  const gym = shipped.items.find(row => row.key === 'bgm_calm_gymnopedie'), carefree = shipped.items.find(row => row.key === 'bgm_daily_carefree');
  const old = { version: 3, bgm: [
    { key: 'a', kind: 'bgm', name: 'Gymnopedie No 1', tags: ['calm'], folder: '잔잔', source: 'youtube', url: `https://www.youtube.com/watch?v=${gym.youtube}`, fallbackUrl: gym.url },
    { key: 'b', kind: 'bgm', name: 'Carefree', tags: ['happy'], folder: '일상', source: 'url', url: carefree.url, note: '내가 쓴 상황' },
    { key: 'c', kind: 'bgm', name: '내 곡', tags: ['calm'], folder: '', source: 'url', url: 'https://example.com/mine.mp3' },
  ] };
  const data = api.normalizeSoundData(old);
  assert.equal(data.version, 4);
  assert.equal(api.upgradeSampleBgm(data), true);
  assert.equal(data.bgm.find(row => row.key === 'a').note, gym.note);
  assert.equal(data.bgm.find(row => row.key === 'b').note, '내가 쓴 상황', 'the reader\'s own 상황 stays');
  assert.equal('note' in data.bgm.find(row => row.key === 'c'), false, 'a track of their own gets nothing');
  assert.equal(api.upgradeSampleBgm(data), false, 'once is enough');
  assert.equal(api.sampleBgmFor(undefined, gym.url).key, gym.key);
});

test('the runtime: the scene after the cue picks among the tied tracks; one small request, remembered; a draw with no embedding', { timeout: 90000 }, async () => {
  const bundle = await build({ stdin: { contents: `import {soundData,updateSoundSettings} from './src/storage/sound-store';import {omniSound} from './src/services/sound-runtime';import {loadTtsData} from './src/storage/tts-store';Object.assign(window,{soundData,updateSoundSettings,omniSound,loadTtsData});`, resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife', loader: { '.txt': 'text' }, logLevel: 'silent' });
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  try {
    const page = await browser.newPage(), errors = [];
    page.setDefaultTimeout(8000); page.on('pageerror', error => errors.push(error.message));
    await page.route('https://bgm.test/', route => route.fulfill({ contentType: 'text/html', body: '<html><body></body></html>' }));
    await page.goto('https://bgm.test/');
    await page.evaluate(() => {
      // Three tracks with the same tags; only their 상황 tells them apart. A fourth is another mood altogether.
      const track = (key, tags, note) => ({ key, kind: 'bgm', name: key.toUpperCase(), tags, note, folder: '잔잔', source: 'url', url: `https://snd.test/${key}.mp3` });
      const save = new Map([['omnisound.data', JSON.stringify({ version: 4, bgm: [
        track('rain', ['calm', 'night', 'slow'], '창밖 빗소리를 듣는 밤'), track('bar', ['calm', 'night', 'slow'], '술잔을 기울이는 늦은 밤'),
        track('star', ['calm', 'night', 'slow'], '별빛 아래 누워 있는 밤'), track('fight', ['tense', 'battle', 'fast'], '칼이 부딪히는 전투'),
      ], settings: { bgmEnabled: true, bgmMatcher: 'auto', embed: { provider: 'openrouter', model: 'toy', endpoint: '', key: 'embed-key' } } })]]);
      window.embedAsked = []; window.embedCalls = 0;
      const axes = [['빗소리'], ['술잔'], ['별빛'], ['칼']];
      window.vector = text => [...axes.map(words => words.some(w => text.includes(w)) ? 1 : 0), 0.05];
      window.risuai = {
        pluginStorage: { getItem: async k => save.get(k), setItem: async (k, v) => save.set(k, v) },
        getDatabase: async () => ({ modules: [], enabledModules: [] }), setDatabase: async () => {}, requestPluginPermission: async () => true,
        nativeFetch: async (url, options = {}) => {
          if (url.includes('/embeddings')) { const body = JSON.parse(options.body); window.embedCalls++; window.embedAsked.push(...body.input); return { ok: true, status: 200, json: async () => ({ data: body.input.map((text, index) => ({ index, embedding: window.vector(text) })) }) }; }
          return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
        },
      };
    });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(async () => { await window.loadTtsData(); await window.omniSound.init(); });
    const pick = (tags, scene, current = '') => page.evaluate(([t, s, c]) => window.omniSound.bgmForTags(t, s, c), [tags, scene, current]);
    const calm = ['calm', 'night', 'slow'];

    assert.equal(await pick(calm, '그는 창가에 앉아 빗소리를 들었다.'), 'rain');
    assert.equal(await pick(calm, '두 사람은 말없이 술잔을 채웠다.'), 'bar');
    assert.equal(await pick(calm, '옥상에 누워 별빛을 올려다보았다.'), 'star');
    const asked = await page.evaluate(() => window.embedAsked);
    assert.ok(asked.includes('장면: 그는 창가에 앉아 빗소리를 들었다.'), asked.join(' | '));
    assert.ok(asked.includes('RAIN · 잔잔 · calm, night, slow · 상황: 창밖 빗소리를 듣는 밤'), 'each track of the pool with its 상황');
    assert.equal(asked.some(text => text.startsWith('FIGHT')), false, 'a track the tags leave out is never sent');
    // The tracks' own vectors are asked once; a new scene is one short text.
    assert.equal(asked.filter(text => text.startsWith('RAIN')).length, 1);
    // The same cue again (fetched ahead, then played; or its ♪ pressed twice): the same song, nothing asked.
    const calls = await page.evaluate(() => window.embedCalls);
    for (let i = 0; i < 5; i++) assert.equal(await pick(calm, '그는 창가에 앉아 빗소리를 들었다.'), 'rain');
    assert.equal(await page.evaluate(() => window.embedCalls), calls);
    // No more than 400 characters of the scene go out, however long it is.
    await pick(calm, '별빛 '.repeat(500));
    assert.ok(await page.evaluate(() => window.embedAsked.filter(text => text.startsWith('장면: ')).every(text => text.length <= 4 + 400)));
    // The track that is playing stays while no other shares more tags: nothing is asked.
    const before = await page.evaluate(() => window.embedCalls);
    assert.equal(await pick(calm, '옥상에서 본 별빛은 처음이었다.', 'bar'), 'bar');
    assert.equal(await page.evaluate(() => window.embedCalls), before);
    // One track for the tags: it plays, and the embedding has nothing to decide.
    assert.equal(await pick(['tense', 'battle', 'fast'], '칼을 뽑아 들었다.'), 'fight');
    assert.equal(await page.evaluate(() => window.embedCalls), before);

    // 곡 고르는 방식 「글자만」 (or no embedding key): no request; the tied tracks are drawn among, and a cue keeps its draw.
    await page.evaluate(() => window.updateSoundSettings({ bgmMatcher: 'tag' }));
    const drawn = new Set();
    for (let i = 0; i < 40; i++) drawn.add(await pick(calm, `장면 ${i}: 빗소리가 들렸다.`));
    assert.equal(drawn.size, 3, [...drawn].join(','));
    const again = await pick(calm, '장면 7: 빗소리가 들렸다.');
    for (let i = 0; i < 5; i++) assert.equal(await pick(calm, '장면 7: 빗소리가 들렸다.'), again);
    assert.equal(await page.evaluate(() => window.embedCalls), before, 'nothing was asked');
    // A failing embedding request is no failure to play: a draw from the pool.
    await page.evaluate(() => { window.updateSoundSettings({ bgmMatcher: 'embedding' }); const real = window.risuai.nativeFetch; window.risuai.nativeFetch = async (url, options) => url.includes('/embeddings') && JSON.parse(options.body).input.some(text => text.includes('고장')) ? { ok: false, status: 500, json: async () => ({}), text: async () => 'down' } : real(url, options); });
    assert.ok(['rain', 'bar', 'star'].includes(await pick(calm, '고장 난 시계가 멈춰 있었다.')));
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
