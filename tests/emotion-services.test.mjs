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
  f.api.emotionData().made.push({ bot: 'bot', person: 't-misun', face: 'sad', name: '오미선_sad.png', path: 'assets/mine.png', registered: true, at: 1 });
  assert.equal((await f.api.findSprite(f.person, 'sad', f.bot))?.source, 'omni');
});

test('a sprite is drawn from the roster looks with fixed tags, saved, and registered only once no reply streams', async () => {
  const f = await fixture([['오미선_sad.png', 'assets/old.png', 'png']]);
  await f.api.upsertCharacter(unifiedSessionIdForCharacter('bot'), { name: '오미선', aliases: ['미선', 'Misun'], gender: 'girl', appearance: 'girl, black hair, short hair, blue eyes' });
  let streaming = true;
  globalThis.__OMNI_REPLY_STREAMING__ = () => streaming;
  try {
    const before = f.host.naiRequests.length, llmBefore = f.host.llmRequests.length;
    const sprite = await f.api.makeSprite(f.person, 'sad', f.bot);
    assert.equal(sprite.name, '오미선_sad.png');
    assert.equal(f.host.naiRequests.length - before, 1, 'one NovelAI call');
    assert.equal(f.host.llmRequests.length - llmBefore, 0, 'no LLM');
    const prompt = JSON.stringify(f.host.naiRequests.at(-1).body);
    assert.match(prompt, /black hair, short hair, blue eyes/);
    assert.match(prompt, /2::sad::, frown, downcast eyes/);
    assert.match(prompt, /2::cowboy shot::/);
    const listed = async () => (await risuai.getCharacterFromIndex(0)).additionalAssets;
    await new Promise(r => setTimeout(r, 2000));
    assert.deepEqual((await listed()).map(a => a[1]), ['assets/old.png'], 'not while a reply streams');
    streaming = false;
    for (let i = 0; i < 40 && (await listed()).some(a => a[1] === 'assets/old.png'); i++) await new Promise(r => setTimeout(r, 100));
    const rows = await listed();
    assert.equal(rows.length, 1, 'made again, it replaces the same name');
    assert.deepEqual(rows[0].slice(0, 2), ['오미선_sad.png', sprite.path]);
    assert.equal(f.api.emotionData().made.at(-1).registered, true);
  } finally { delete globalThis.__OMNI_REPLY_STREAMING__; }
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
