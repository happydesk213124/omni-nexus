import test from 'node:test';
import assert from 'node:assert/strict';
import { installHost } from '../tools/parity/host.mjs';
import { unifiedSessionIdForCharacter } from '../.test-build/text-util.mjs';

let instance = 0;
const misun = { id: 't-misun', scope: 'global', name: '오미선', surname: '오', givenName: '미선', surnameAliases: ['Oh'], givenAliases: ['Misun'], triggers: [], tags: [], gender: 'female', voiceKey: '', fishId: '', fixed: false, gain: 0 };
async function fixture(assets = []) {
  const host = installHost({ promptsDir: 'prompts' });
  const api = await import(`../.test-build/emotion-services.mjs?instance=${++instance}`);
  await api.openDb();
  const config = api.getConfig();
  config.nai = { ...config.nai, api_key: 'test', model: 'nai-diffusion-4-5-full' };
  api.setConfig(config);
  await risuai.setCharacterToIndex(0, { chaId: 'bot', name: 'Bot', additionalAssets: assets, emotionImages: [['Misun happy', 'assets/emotion-happy.png']], globalLore: [], chats: [{ id: 'chat', message: [] }] });
  await api.loadTtsData();
  api.ttsData().characters.push({ ...misun });
  await api.loadEmotionData();
  api.emotionData().settings.family = 'v4';
  const bot = await api.currentEmotionBot();
  return { api, host, bot, person: api.ttsData().characters.at(-1) };
}

test("the bot's own images are found under any of the person's names; Omni's own sprite comes first", async () => {
  const f = await fixture([['미선_sad', 'assets/sad.png', 'png'], ['하린_sad', 'assets/harin.png', 'png']]);
  assert.equal(f.bot.id, 'bot');
  assert.deepEqual(await f.api.findSprite(f.person, 'sad', f.bot), { face: 'sad', name: '미선_sad', path: 'assets/sad.png', source: 'bot' });
  assert.equal((await f.api.findSprite(f.person, 'happy', f.bot))?.path, 'assets/emotion-happy.png', 'Risu emotion images count too');
  assert.equal(await f.api.findSprite(f.person, 'angry', f.bot), null);
  f.api.emotionData().settings.useExisting = false;
  assert.equal(await f.api.findSprite(f.person, 'sad', f.bot), null, 'off: the bot\'s images are not used');
  f.api.emotionData().made.push({ bot: 'bot', person: 't-misun', face: 'sad', name: 'omni_오미선_sad.png', path: 'assets/mine.png', registered: true, at: 1 });
  assert.equal((await f.api.findSprite(f.person, 'sad', f.bot))?.source, 'omni');
});

test('a sprite is drawn from the roster looks with fixed tags, saved, and registered only once no reply streams', async () => {
  const f = await fixture([['오미선_sad.png', 'assets/old.png', 'png']]);
  await f.api.upsertCharacter(unifiedSessionIdForCharacter('bot'), { name: '오미선', aliases: ['미선', 'Misun'], gender: 'girl', appearance: 'girl, black hair, short hair, blue eyes, nipples, 1.2::penis::, large breasts' });
  let streaming = true;
  globalThis.__OMNI_REPLY_STREAMING__ = () => streaming;
  try {
    const before = f.host.naiRequests.length, llmBefore = f.host.llmRequests.length;
    const sprite = await f.api.makeSprite(f.person, 'sad', f.bot);
    assert.equal(sprite.name, 'omni_오미선_sad.png');
    assert.equal(f.host.naiRequests.length - before, 1, 'one NovelAI call');
    assert.equal(f.host.llmRequests.length - llmBefore, 0, 'no LLM');
    const prompt = JSON.stringify(f.host.naiRequests.at(-1).body);
    assert.match(prompt, /black hair, short hair, blue eyes/);
    assert.match(prompt, /2::sad::, frown, downcast eyes/);
    assert.match(prompt, /2::cowboy shot::/);
    const sent = f.host.naiRequests.at(-1).body, body = typeof sent === 'string' ? JSON.parse(sent) : sent;
    assert.doesNotMatch(String(body.input || ''), /nipples|penis/, 'no sexual anatomy in a portrait shown on every line');
    assert.match(JSON.stringify(f.host.naiRequests.at(-1).body), /nude, naked, nipples, penis/, 'and it is kept out by the negative prompt too');
    const listed = async () => (await risuai.getCharacterFromIndex(0)).additionalAssets;
    await new Promise(r => setTimeout(r, 2000));
    assert.deepEqual((await listed()).map(a => a[1]), ['assets/old.png'], 'not while a reply streams');
    streaming = false;
    for (let i = 0; i < 40 && !(await listed()).some(a => a[1] === sprite.path); i++) await new Promise(r => setTimeout(r, 100));
    const rows = await listed();
    // Omni's picture is `omni_…`: the bot's own asset of that face stays as it was, beside it.
    assert.deepEqual(rows.map(a => a.slice(0, 2)), [['오미선_sad.png', 'assets/old.png'], ['omni_오미선_sad.png', sprite.path]]);
    assert.equal(f.api.emotionData().made.at(-1).registered, true);
  } finally { delete globalThis.__OMNI_REPLY_STREAMING__; }
});

test('a failed draw is tried again after a wait (not on every redraw, not never); 만들기 tries at once', async () => {
  const f = await fixture();
  await f.api.upsertCharacter(unifiedSessionIdForCharacter('bot'), { name: '오미선', aliases: ['미선'], gender: 'girl', appearance: 'girl, black hair, blue eyes' });
  const config = f.api.getConfig(), key = config.nai.api_key;
  f.api.setConfig({ ...config, nai: { ...config.nai, api_key: '' } });
  await assert.rejects(f.api.makeSprite(f.person, 'happy', f.bot), /API 키/);
  assert.deepEqual(f.api.spriteStatus('bot', f.person.id, 'happy'), { state: 'failed', message: 'NovelAI API 키를 먼저 넣어 주세요.' }, 'the viewer can say why');
  f.api.setConfig({ ...f.api.getConfig(), nai: { ...f.api.getConfig().nai, api_key: key } });
  const before = f.host.naiRequests.length;
  await assert.rejects(f.api.makeSprite(f.person, 'happy', f.bot), /API 키/, 'within the wait: the last failure, nothing asked');
  assert.equal(f.host.naiRequests.length, before);
  const sprite = await f.api.makeSprite(f.person, 'happy', f.bot, true);
  assert.equal(f.host.naiRequests.length, before + 1, '만들기: drawn at once');
  assert.equal(f.api.spriteStatus('bot', f.person.id, 'happy').state, '', 'done: no failure left');
  // A picture that cannot be read back is forgotten, so it is drawn again.
  assert.ok(await f.api.findSprite(f.person, 'happy', f.bot));
  await f.api.forgetMade('bot', f.person.id, 'happy');
  assert.equal((await f.api.findSprite(f.person, 'happy', f.bot))?.path === sprite.path, false);
});

test('a place background: V5 at medium effort, nobody in it, the place tags', async () => {
  const f = await fixture();
  const before = f.host.naiRequests.length;
  await f.api.makeBackground('cafe, window, afternoon', f.bot);
  assert.equal(f.host.naiRequests.length, before + 1);
  const sent = f.host.naiRequests.at(-1).body, body = typeof sent === 'string' ? JSON.parse(sent) : sent;
  assert.match(String(body.input), /2::no humans::/);
  assert.match(String(body.input), /cafe, window, afternoon/);
  assert.match(String(body.model), /^nai-diffusion-5.*medium/, `the cheaper pass: ${body.model}`);
  assert.ok(await f.api.findBackground('cafe, window, afternoon', f.bot));
});

test('a background is saved as WebP at 50 (it is blurred behind the cast)', async () => {
  const f = await fixture();
  // A stand-in canvas: it "encodes" a small WebP and keeps the quality it was asked for.
  const asked = [], webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 4, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20]);
  const was = { createImageBitmap: globalThis.createImageBitmap, OffscreenCanvas: globalThis.OffscreenCanvas };
  globalThis.createImageBitmap = async () => ({ width: 1216, height: 832, close() {} });
  globalThis.OffscreenCanvas = class { constructor(w, h) { this.width = w; this.height = h; } getContext() { return { drawImage() {} }; } async convertToBlob(o) { asked.push(o); return new Blob([webp], { type: 'image/webp' }); } };
  try {
    const made = await f.api.makeBackground('library, night', f.bot);
    assert.match(made.name, /\.webp$/);
    assert.deepEqual(asked, [{ type: 'image/webp', quality: 0.5 }]);
  } finally { Object.assign(globalThis, was); }
});

test('a background is found again: after a reload (a long place), its tags in any order, by its asset name on the bot', async () => {
  const f = await fixture([['bg_park, bench, night', 'assets/bg-park.png', 'png']]);
  const long = 'cafe, indoor, window, afternoon, wooden table, sunlight, potted plant';
  const made = await f.api.makeBackground(long, f.bot);
  assert.equal(made.name, `omni_bg_${long}.${made.name.split('.').pop()}`, 'named by its tags, omni_ first');
  // A reload: the record comes back from storage, its whole place kept (it was cut to 40 characters, and never matched).
  await new Promise(r => setTimeout(r, 50));
  f.api.resetEmotionStore(); await f.api.loadEmotionData();
  assert.equal(f.api.emotionData().made.find(m => m.person === '__place__')?.face, long, 'the whole place, as saved');
  assert.equal((await f.api.findBackground(long, f.bot))?.path, made.path);
  assert.equal((await f.api.findBackground('potted plant, sunlight, Cafe, indoor, window, afternoon, wooden table', f.bot))?.path, made.path, 'the same tags in another order');
  // A record saved before the fix holds the first 40 characters: it is still that place's.
  const legacy = 'street, night, neon lights, rain, puddle, umbrella';
  f.api.emotionData().made.push({ bot: f.bot.id, person: '__place__', face: legacy.slice(0, 40), name: 'bg_0123456789ab.png', path: 'assets/bg-legacy.png', registered: true, at: 1 });
  assert.equal((await f.api.findBackground(legacy, f.bot))?.path, 'assets/bg-legacy.png');
  // Not in Omni's records at all: the bot's asset named by its tags.
  const bot = await f.api.findBackground('night, park, bench', f.bot);
  assert.equal(bot?.source, 'bot'); assert.equal(bot?.name, 'bg_park, bench, night');
  assert.equal(await f.api.findBackground('park, bench', f.bot), null, 'fewer tags is another place');
});

test('without looks no image is drawn, and faces seen in replies are remembered per TTS character', async () => {
  const f = await fixture();
  const before = f.host.naiRequests.length;
  await assert.rejects(f.api.makeSprite(f.person, 'happy', f.bot), /외형 태그가 없습니다/);
  assert.equal(f.host.naiRequests.length, before);
  const found = f.api.collectFaces(['오미선 (cheerful, whispering): "안녕!"\n미선 (sobbing): "흑흑, 미안해"\n누군가 (angry): "누구?"'], 'chat');
  assert.deepEqual([...found.get('t-misun')].sort(), ['cry', 'happy']);
  assert.deepEqual(f.api.emotionData().seen['t-misun'].sort(), ['cry', 'happy']);
});

test('a sample place is drawn once for every chat: kept in the 참고이미지 module, found from another bot, drawn again, deleted', async () => {
  const f = await fixture();
  const sample = 'cafe, indoors, window, daytime';
  const made = await f.api.makeBackground(sample, null);
  assert.equal(made.shared, true, 'no bot needed');
  assert.equal(f.api.emotionData().made.at(-1).bot, '*');
  await f.api.registerMadeSprites();
  const shared = async () => ((await risuai.getDatabase(['modules'])).modules.find(m => m.id === 'inlay-char-ref')?.assets || []).filter(a => /^omni_bg_/.test(a[0]));
  assert.deepEqual((await shared()).map(a => a.slice(0, 2)), [[made.name, made.path]]);
  assert.ok((await risuai.getDatabase(['enabledModules'])).enabledModules.includes('inlay-char-ref'));
  assert.deepEqual((await risuai.getCharacterFromIndex(0)).additionalAssets.filter(a => /omni_bg_/.test(a[0])), [], 'not in any bot');
  assert.deepEqual(await f.api.backgroundPlaces(await f.api.currentEmotionBot()), [], "nor listed as the bot's own (its enabled module lists it among the bot's images)");
  assert.deepEqual(await f.api.sharedBackgroundPlaces(), [sample]);
  // Another bot (another chat): the same background, its tags in any order.
  const other = { ...f.bot, id: 'other-bot' };
  assert.equal((await f.api.findBackground('window, cafe, indoors, daytime', other))?.path, made.path);
  // Omni's record gone (another device) and the module switched off: its row still finds it.
  f.api.emotionData().made = f.api.emotionData().made.filter(m => m.bot !== '*'); f.api.resetSharedBackgrounds(); f.api.forgetEmotionPool();
  const enabled = (await risuai.getDatabase(['enabledModules'])).enabledModules;
  await risuai.setDatabase({ enabledModules: enabled.filter(id => id !== 'inlay-char-ref') });
  assert.equal((await f.api.findBackground(sample, other))?.path, made.path);
  assert.equal(await f.api.findBackground('cafe, indoors', other), null, 'another place is not it');
  // Drawn again: the new picture under the same name, one row. Deleted: gone for every chat.
  const again = await f.api.redrawBackground(sample, null, true);
  await f.api.registerMadeSprites();
  assert.deepEqual((await shared()).map(a => a[1]), [again.path]);
  await f.api.deleteBackground(sample, null, true);
  assert.deepEqual(await shared(), []);
  f.api.resetSharedBackgrounds();
  assert.equal(await f.api.findBackground(sample, other), null);
});

test("a bot's own background: drawn again it replaces the old one; deleted it leaves the bot's assets", async () => {
  const f = await fixture();
  const place = 'library, indoors, night';
  const first = await f.api.makeBackground(place, f.bot);
  assert.equal(first.shared, false);
  await f.api.registerMadeSprites();
  const listed = async () => (await risuai.getCharacterFromIndex(0)).additionalAssets.filter(a => /^omni_bg_/.test(a[0])).map(a => a[1]);
  assert.deepEqual(await listed(), [first.path]);
  const again = await f.api.redrawBackground(place, f.bot, false);
  await f.api.registerMadeSprites();
  assert.deepEqual(await listed(), [again.path]);
  await f.api.deleteBackground(place, f.bot, false);
  assert.deepEqual(await listed(), []);
  assert.equal(await f.api.findBackground(place, f.bot), null);
  assert.equal(f.api.emotionData().made.some(m => m.person === '__place__'), false);
});

test('the 참고이미지 module sent without its list (PocketRisu): a shared background is not written over it', { timeout: 30000 }, async () => {
  const f = await fixture();
  // The module as PocketRisu sends it when its list failed to load: a descriptor, no assets.
  const db = await risuai.getDatabase(['modules', 'enabledModules']);
  await risuai.setDatabase({ modules: [...db.modules, { id: 'inlay-char-ref', namespace: 'inlay.char_ref', name: '⚛️Omni Nexus 참고이미지', assetManifest: { id: 'm1', count: 12 } }], enabledModules: db.enabledModules });
  await f.api.makeBackground('beach, outdoors, ocean, sunset', null);
  await f.api.registerMadeSprites();
  const mod = (await risuai.getDatabase(['modules'])).modules.find(m => m.id === 'inlay-char-ref');
  assert.equal('assets' in mod, false, 'its twelve reference images were not traded for one background');
  assert.deepEqual(mod.assetManifest, { id: 'm1', count: 12 });
  assert.equal(f.api.emotionData().made.find(m => m.bot === '*').registered, false, 'left to register once the list reads');
});

test("the bot's images are read once, then again behind: a lookup never waits on the re-read", async () => {
  const f = await fixture([['미선_sad', 'assets/sad.png', 'png']]);
  assert.equal(f.api.spriteNow(f.person, 'sad', f.bot), undefined, 'never read yet: not known');
  assert.equal((await f.api.findSprite(f.person, 'sad', f.bot))?.path, 'assets/sad.png');
  assert.equal(f.api.spriteNow(f.person, 'sad', f.bot)?.path, 'assets/sad.png', 'read once: known with no wait');
  // Five minutes on, the bot's assets changed and their read stalled: the old list answers at once, the new one comes behind.
  const realNow = Date.now, read = risuai.getDatabase;
  let stalled = 0, release = () => {};
  risuai.getDatabase = async (...args) => { stalled++; await new Promise(r => { release = r; }); return read.apply(risuai, args); };
  Date.now = () => realNow() + 6 * 60_000;
  try {
    f.bot.character.additionalAssets = [['미선_sad', 'assets/sad2.png', 'png']];
    const found = await Promise.race([f.api.findSprite(f.person, 'sad', f.bot), new Promise(r => setTimeout(() => r('waited'), 1000))]);
    assert.equal(found?.path, 'assets/sad.png', 'the list known answers: no wait on the re-read');
    assert.equal(f.api.spriteNow(f.person, 'sad', f.bot)?.path, 'assets/sad.png');
    assert.equal(stalled, 1, 'read again behind, once for both lookups');
    release();
    await new Promise(r => setTimeout(r, 50));
    assert.equal(f.api.spriteNow(f.person, 'sad', f.bot)?.path, 'assets/sad2.png', 'and the new list serves from then on');
  } finally { Date.now = realNow; risuai.getDatabase = read; }
});
