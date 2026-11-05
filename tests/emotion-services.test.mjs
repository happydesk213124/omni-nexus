import test from 'node:test';
import assert from 'node:assert/strict';
import { installHost } from '../tools/parity/host.mjs';
import { sessionIdHash, unifiedSessionIdForCharacter } from '../.test-build/text-util.mjs';

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

test('외형 없음 · 눌러서 만들기: the character LLM makes them from their voice card and lines, into the bot roster, and every failed face of theirs goes again at once', async () => {
  const f = await fixture();
  f.person.tags = ['20대', '밝은'];
  await assert.rejects(f.api.makeSprite(f.person, 'happy', f.bot), /외형 태그가 없습니다/);
  await assert.rejects(f.api.makeSprite(f.person, 'sad', f.bot), /외형 태그가 없습니다/);
  assert.equal(f.api.spriteStatus('bot', f.person.id, 'happy').noLooks, true, 'failed for want of looks, and the viewer can tell');
  f.host.setLlmReply(JSON.stringify({ new_characters: [{ name: '오미선', aliases: ['미선', 'Misun'], gender: 'girl', appearance: 'girl, black hair, short hair, blue eyes', attire: 'white blouse' }] }));
  const before = f.host.llmRequests.length;
  await f.api.makeSpeakerLooks(f.person, f.bot, { said: ['안녕, 오늘도 왔네?'], story: ['카페 문이 열리고 단발머리 여자가 들어왔다.'] });
  const asked = JSON.stringify(f.host.llmRequests.slice(before));
  assert.equal(f.host.llmRequests.length - before, 1, 'one call');
  assert.match(asked, /Create exactly one character, \\"오미선\\"/);
  assert.match(asked, /gender female; tags 20대, 밝은/);
  assert.match(asked, /안녕, 오늘도 왔네\?/);
  assert.match(asked, /단발머리 여자가 들어왔다/);
  const saved = (await f.api.listCharacters(unifiedSessionIdForCharacter('bot'))).find(c => c.name === '오미선');
  assert.match(saved?.appearance || '', /black hair/, 'in the roster their faces are looked for in');
  assert.deepEqual(['happy', 'sad'].map(face => f.api.spriteStatus('bot', f.person.id, face).state), ['', ''], 'no failure left to wait out');
  const naiBefore = f.host.naiRequests.length;
  assert.equal((await f.api.makeSprite(f.person, 'sad', f.bot)).name, 'omni_오미선_sad.png');
  assert.equal(f.host.naiRequests.length - naiBefore, 1);
  assert.match(JSON.stringify(f.host.naiRequests.at(-1).body), /black hair, short hair, blue eyes/);
});

test('외형 없음 · 눌러서 만들기: someone made under another name is not taken for them', async () => {
  const f = await fixture();
  await assert.rejects(f.api.makeSprite(f.person, 'happy', f.bot), /외형 태그가 없습니다/);
  f.host.setLlmReply(JSON.stringify({ new_characters: [{ name: 'Gym Referee', gender: 'boy', appearance: 'boy, short hair, whistle' }] }));
  await assert.rejects(f.api.makeSpeakerLooks(f.person, f.bot, {}), /오미선\(으\)로 이어지지 않았습니다/);
  assert.equal(f.api.spriteStatus('bot', f.person.id, 'happy').noLooks, true, 'their face still waits for looks');
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

test('a sprite wears the default costume, whichever one the roster has on', async () => {
  const f = await fixture();
  await f.api.upsertCharacter(unifiedSessionIdForCharacter('bot'), { name: '오미선', aliases: ['미선'], gender: 'girl', appearance: 'girl, black hair', costumes: [{ name: 'default', attire: 'school uniform, pleated skirt' }, { name: 'swim', attire: 'red bikini' }], active_costume: 1 });
  globalThis.__OMNI_REPLY_STREAMING__ = () => false;
  try {
    await f.api.makeSprite(f.person, 'happy', f.bot);
    const prompt = JSON.stringify(f.host.naiRequests.at(-1).body);
    assert.match(prompt, /school uniform, pleated skirt/);
    assert.doesNotMatch(prompt, /bikini/, "the costume on now is not the face's");
  } finally { delete globalThis.__OMNI_REPLY_STREAMING__; }
});

test('a cue naming a costume by its name (미선_melony_form): its number read from the illustration character, and nobody new made of it', async () => {
  const f = await fixture();
  await f.api.upsertCharacter(unifiedSessionIdForCharacter('bot'), { name: '오미선', aliases: ['미선'], gender: 'girl', appearance: 'girl, black hair', costumes: [{ name: 'default', attire: 'school uniform' }, { name: 'melony_form', attire: 'melon dress, leaf hair ornament' }] });
  await f.api.upsertCharacter(unifiedSessionIdForCharacter('bot'), { name: '메타몽', gender: 'girl', appearance: 'pink hair', costumes: [{ name: 'default', attire: 'pink dress' }, { name: 'melony_form', attire: 'melon dress' }] });
  await f.api.refreshCostumeNames('bot', 'bot:bot');
  const worn = f.api.costumesOf('bot:bot', 'bot');
  assert.deepEqual(worn('오미선'), ['default', 'melony_form']);
  assert.deepEqual(worn('미선'), ['default', 'melony_form'], 'by any of her names');
  assert.equal(worn('유나'), undefined, 'no one');
  assert.deepEqual(worn('메타몽'), ['default', 'melony_form'], 'one who speaks before they are a TTS character: their illustration character says who');
  // TTS: with the names known, the cue is 오미선 and no "미선_Melony Form" is added to the roster.
  const tts = f.api.ttsData();
  tts.settings.enabled = true; tts.settings.autoAssign = true; f.person.fishId = '4e118bfbb83e401c84699c09b5f08257';
  // A TTS character made of such a cue before (as TTS once did) does not stand in the way.
  tts.characters.push({ ...misun, id: 't-made', name: '오미선_melony_form', surname: '', givenName: '', surnameAliases: [], givenAliases: [], triggers: ['오미선_melony_form'], gender: 'unknown', fishId: '' });
  const before = tts.characters.length;
  await f.api.ensureTtsSpeakers({ scope: 'emo', rosterScope: 'bot:bot', characterId: 'bot', chatId: 'chat', sessionId: 's', character: {}, chat: {}, messages: [] }, ['오미선_melony_form'], () => true);
  assert.equal(tts.characters.length, before, 'no voice chosen for it, and nobody new');
  await f.api.ensureTtsSpeakers({ scope: 'emo', rosterScope: 'bot:bot', characterId: 'bot', chatId: 'chat', sessionId: 's', character: {}, chat: {}, messages: [] }, ['미선_Melony Form'], () => true);
  assert.equal(tts.characters.length, before);
});

test('a cast block registers an outfit worn in this reply before its first line, and its name is a costume at once', async () => {
  const f = await fixture();
  await f.api.upsertCharacter(unifiedSessionIdForCharacter('bot'), { name: '오미선', aliases: ['미선'], gender: 'girl', appearance: 'girl, black hair', costumes: [{ name: 'default', attire: 'school uniform' }] });
  await f.api.refreshCostumeNames('bot', 'bot:bot');
  assert.deepEqual(f.api.costumesOf('bot:bot', 'bot')('오미선'), ['default']);
  const res = await f.api.registerInlineCast({ character_id: 'bot', chat_id: 'chat', stream_id: 's1', host_message_id: 'm1', body: JSON.stringify({ place: 'stage', new_characters: [], new_costumes: [{ name: '오미선', costumes: [{ name: 'idol_dress', note: 'stage idol outfit', attire: 'idol dress, frills' }] }] }) });
  assert.equal(res.ok, true);
  assert.deepEqual(res.costumes, ['오미선']);
  assert.deepEqual((await f.api.spriteCostumes(f.person, f.bot)).map(c => c.name), ['default', 'idol_dress'], 'her costume list has it, mid-reply (the write is buffered, the roster reads it)');
  await f.api.refreshCostumeNames('bot', 'bot:bot');
  assert.deepEqual(f.api.costumesOf('bot:bot', 'bot')('오미선'), ['default', 'idol_dress'], 'read again at once, not 30 s later');
});

test('a costume named in a cue (이름_2) has its own sprites: drawn in that costume, saved and found apart from the default ones', async () => {
  const f = await fixture();
  await f.api.upsertCharacter(unifiedSessionIdForCharacter('bot'), { name: '오미선', aliases: ['미선'], gender: 'girl', appearance: 'girl, black hair', costumes: [{ name: 'default', attire: 'school uniform, pleated skirt' }, { name: 'swim', attire: 'red bikini' }] });
  globalThis.__OMNI_REPLY_STREAMING__ = () => false;
  try {
    assert.deepEqual((await f.api.spriteCostumes(f.person, f.bot)).map(c => [c.index, c.name]), [[0, 'default'], [1, 'swim']]);
    const swim = await f.api.makeSprite(f.person, 'happy', f.bot, true, 1);
    assert.equal(swim.name, 'omni_c1_오미선_happy.png');
    assert.equal(swim.costume, 1);
    const prompt = JSON.stringify(f.host.naiRequests.at(-1).body);
    assert.match(prompt, /red bikini/);
    assert.doesNotMatch(prompt, /school uniform/);
    assert.equal((await f.api.findSprite(f.person, 'happy', f.bot))?.path, 'assets/emotion-happy.png', "the default costume's face is the bot's own, not the swimsuit's");
    assert.equal((await f.api.findSprite(f.person, 'happy', f.bot, 1))?.path, swim.path);
    assert.equal(f.api.emotionData().made.at(-1).costume, 1);
    await f.api.makeSprite(f.person, 'happy', f.bot, true);
    assert.match(JSON.stringify(f.host.naiRequests.at(-1).body), /school uniform/);
    assert.notEqual((await f.api.findSprite(f.person, 'happy', f.bot))?.path, swim.path);
    assert.equal(f.api.spriteJobKey('bot', 't-misun', 'happy'), 'bot\u0000t-misun\u0000happy', "the default costume's job as ever");
    await assert.rejects(f.api.makeSprite(f.person, 'happy', f.bot, true, 5), /5번 코스튬이 없습니다/);
  } finally { delete globalThis.__OMNI_REPLY_STREAMING__; }
});

test('고아 메모 정리: records of a bot gone from Risu or a person gone from TTS 캐릭터 go, never the files; a shared background and a place stay', async () => {
  const f = await fixture();
  const made = (bot, person, face, name) => ({ bot, person, face, name, path: `assets/${name}.png`, registered: true, at: 1 });
  f.api.emotionData().made.push(made('bot', 't-misun', 'happy', 'kept'), made('bot', 't-gone', 'sad', 'person-gone'), made('gone-bot', 't-misun', 'happy', 'bot-gone'),
    made('bot', '__place__', 'cafe', 'place'), made('*', '__place__', 'park', 'shared'));
  const found = await f.api.orphanMade();
  assert.deepEqual(found.records.map(m => m.name).sort(), ['bot-gone', 'person-gone']);
  assert.deepEqual([found.bots, found.people], [1, 1]);
  assert.ok(found.bytes > 50, 'its size, to be told before');
  assert.equal(await f.api.forgetOrphans(found.records), 2);
  assert.deepEqual(f.api.emotionData().made.map(m => m.name), ['kept', 'place', 'shared']);
  // Risu's bot list unreadable: nothing counts as gone.
  risuai.getDatabase = async () => { throw new Error('busy'); };
  assert.equal(await f.api.orphanMade(), null);
});

// 감정 에셋 and 배경 drew with Omni's preset (스타일 프리셋) whatever the bot or its session was bound to: they draw with
// the one rule now, the session's choice, else the bot's, else Omni's; a background every bot shares, with Omni's.
test('감정 에셋 and a bot\'s background draw with the session\'s preset, else the bot\'s, else Omni\'s; a shared background with Omni\'s', async () => {
  const f = await fixture();
  await f.api.upsertCharacter(unifiedSessionIdForCharacter('bot'), { name: '오미선', aliases: ['미선', 'Misun'], gender: 'girl', appearance: 'girl, black hair, short hair, blue eyes' });
  const config = f.api.getConfig();
  config.card = { ...config.card, active_preset_id: 'p-omni', presets: [{ id: 'p-omni', name: 'Omni', positive: 'omnistyle' }, { id: 'p-bot', name: 'Bot', positive: 'botstyle' }, { id: 'p-session', name: 'Session', positive: 'sessionstyle' }] };
  f.api.setConfig(config);
  const drawn = () => JSON.stringify(f.host.naiRequests.at(-1).body);
  await f.api.makeSprite(f.person, 'sad', f.bot, true);
  assert.match(drawn(), /omnistyle/, 'no binding: Omni\'s');
  assert.equal((await f.api.savePresetBindings({ character_id: 'bot', character: 'p-bot' })).ok, true);
  await f.api.makeSprite(f.person, 'happy', f.bot, true);
  assert.match(drawn(), /botstyle/, 'the bot\'s (이 캐릭터)');
  assert.doesNotMatch(drawn(), /omnistyle/);
  // The session of the chat open in the bot (세션 작가 노트's own): first.
  const session = `risu_${sessionIdHash('bot|chat')}`;
  assert.equal((await f.api.savePresetBindings({ session_id: session, session: 'p-session' })).ok, true);
  await f.api.makeSprite(f.person, 'angry', f.bot, true);
  assert.match(drawn(), /sessionstyle/, 'the session\'s first');
  await f.api.makeBackground('library, indoors', f.bot, true);
  assert.match(drawn(), /sessionstyle/, 'the bot\'s own background too');
  await f.api.makeBackground('cafe, indoors, window, daytime', null, true);
  assert.match(drawn(), /omnistyle/, 'one every bot shares: Omni\'s');
});

// 감정 에셋 비우기: to draw them again in another style, every face Omni made for the bot's people goes from the
// records and the bot's assets; the bot's own pictures and the backgrounds stay.
test('감정 에셋 비우기: Omni\'s faces of the bot go from the records and from its assets, so they are drawn again; its own pictures and backgrounds stay', async () => {
  const f = await fixture([['미선_sad', 'assets/own-sad.png', 'png']]);
  await f.api.upsertCharacter(unifiedSessionIdForCharacter('bot'), { name: '오미선', aliases: ['미선', 'Misun'], gender: 'girl', appearance: 'girl, black hair, short hair, blue eyes' });
  const made = await f.api.makeSprite(f.person, 'happy', f.bot, true);
  await f.api.makeBackground('library, indoors', f.bot, true);
  const listed = async () => (await risuai.getCharacterFromIndex(0)).additionalAssets.map(a => a[1]);
  for (let i = 0; i < 40 && !(await listed()).includes(made.path); i++) await new Promise(r => setTimeout(r, 100));
  assert.ok((await listed()).includes(made.path), 'registered on the bot first');
  assert.equal(await f.api.madeSpriteCount('bot'), 1, 'one face (the background is no face)');
  assert.equal(await f.api.clearMadeSprites(await f.api.currentEmotionBot()), 1);
  assert.equal(await f.api.madeSpriteCount('bot'), 0);
  assert.ok(!(await listed()).includes(made.path), 'out of the bot\'s assets');
  assert.ok((await listed()).includes('assets/own-sad.png'), 'the bot\'s own picture stays');
  assert.equal((await f.api.findSprite(f.person, 'happy', f.bot))?.source, 'bot', 'happy is no longer Omni\'s');
  assert.ok(f.api.emotionData().made.some(m => m.person === f.api.PLACE_PERSON), 'the background stays');
  // Drawn again on asking, as a new one.
  const again = await f.api.makeSprite(f.person, 'happy', f.bot, true);
  assert.notEqual(again.path, made.path);
});
