import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

// 생각 에코: a thought (`이름: '생각'`, a nameless `'혼잣말'`) plays with an echo laid over it in the browser. The audio
// itself is the same, so nothing is synthesized again; a spoken line and narration get none.
const built = await build({ stdin: { contents: "export {parseTtsMessage} from './src/domain/tts/segment';export {TtsPlayer} from './src/providers/tts/player';export {ttsDefaults} from './src/config/tts-defaults';export {normalizeTtsSettings} from './src/storage/tts-store';export {OmniTtsRuntime} from './src/services/tts-runtime';export {loadTtsData,ttsData} from './src/storage/tts-store';export {blankTtsCharacter} from './src/services/tts-characters';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node' });
const api = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));
const tick = () => new Promise(r => setImmediate(r));

test('off by default; a save with anything else in it is off', () => {
  assert.equal(api.ttsDefaults().thoughtEcho, 'off');
  assert.equal(api.normalizeTtsSettings({}).thoughtEcho, 'off');
  assert.equal(api.normalizeTtsSettings({ thoughtEcho: 'strong' }).thoughtEcho, 'strong');
  assert.equal(api.normalizeTtsSettings({ thoughtEcho: 'loud' }).thoughtEcho, 'off');
});

test("a named cue in single quotes is a thought; double quotes and narration are not", () => {
  const flags = text => api.parseTtsMessage(text).map(s => [s.kind, s.speaker, !!s.thought, !!s.monologue]);
  assert.deepEqual(flags("하린 (sad): '왜 저러지?'"), [['dialogue', '하린', true, false]]);
  assert.deepEqual(flags('하린 (sad): ‘왜 저러지?’'), [['dialogue', '하린', true, false]]);
  assert.deepEqual(flags('하린 (sad): "왜 그래?"'), [['dialogue', '하린', false, false]]);
  assert.deepEqual(flags("하린 (sad):\n'왜 저러지?'"), [['dialogue', '하린', true, false]], 'the quote on the line below');
  assert.deepEqual(flags("'바보 같다.'"), [['dialogue', '', false, true]], 'nobody named: the monologue card (echoed as a thought too)');
  assert.deepEqual(flags('하린은 고개를 숙였다.'), [['narration', '', false, false]]);
  assert.equal('thought' in api.parseTtsMessage('하린 (sad): "왜 그래?"')[0], false, 'no field on a spoken line: its shape is as before');
});

/** A Web Audio graph that records its connections and gains. */
function audioWorld(withDelay = true) {
  const nodes = [];
  const node = kind => { const n = { kind, gain: { value: 1 }, delayTime: { value: 0 }, to: [], connect(next) { n.to.push(next.kind); return next; } }; nodes.push(n); return n; };
  globalThis.Audio = class { src = ''; pause() {} load() {} removeAttribute() {} async play() {} };
  globalThis.AudioContext = class { state = 'running'; destination = { kind: 'out' }; createGain() { return node(`gain${nodes.filter(n => n.kind.startsWith('gain')).length}`); } createMediaElementSource() { return node('source'); } };
  if (withDelay) globalThis.AudioContext.prototype.createDelay = function () { return node('delay'); };
  globalThis.URL.createObjectURL = () => 'blob:x'; globalThis.URL.revokeObjectURL = () => {};
  return nodes;
}

test('the echo is a send beside the dry path; only the send is switched, so a tail rings out', async () => {
  const nodes = audioWorld();
  const player = new api.TtsPlayer();
  player.echo('medium');
  await player.play('k', async () => new ArrayBuffer(64));
  const by = kind => nodes.find(n => n.kind === kind);
  const [dry, send, feedback] = ['gain0', 'gain1', 'gain2'].map(by), delay = by('delay');
  assert.deepEqual(by('source').to, ['gain0']);
  assert.deepEqual(dry.to, ['out', 'gain1'], 'the voice goes out dry and into the send');
  assert.deepEqual(send.to, ['delay']);
  assert.deepEqual(delay.to.sort(), ['gain2', 'out'], 'the delay feeds back and goes out');
  assert.deepEqual(feedback.to, ['delay']);
  assert.ok(delay.delayTime.value > .1 && delay.delayTime.value < .3);
  const levels = {};
  for (const level of ['light', 'medium', 'strong']) { player.echo(level); levels[level] = [send.gain.value, feedback.gain.value]; }
  assert.ok(levels.light[0] < levels.medium[0] && levels.medium[0] < levels.strong[0], 'stronger sends more');
  assert.ok(levels.light[1] < levels.medium[1] && levels.medium[1] < levels.strong[1] && levels.strong[1] < .7, 'and repeats longer, never building up');
  player.echo('off');
  assert.equal(send.gain.value, 0, 'off: nothing new goes in');
  assert.equal(feedback.gain.value, levels.strong[1], 'what is ringing dies away by itself');
});

test('an engine with no delay node plays as before', async () => {
  const nodes = audioWorld(false);
  delete globalThis.AudioContext.prototype.createDelay;
  const player = new api.TtsPlayer();
  player.echo('strong');
  await player.play('k', async () => new ArrayBuffer(64));
  assert.equal(player.status, 'playing');
  assert.equal(nodes.some(n => n.kind === 'delay'), false);
});

test('a thought plays with the echo setting, a spoken line and narration without', async () => {
  const nodes = audioWorld();
  const saved = new Map(), local = new Map(), voice = '0123456789abcdef0123456789abcdef';
  globalThis.risuai = { pluginStorage: { getItem: async k => saved.get(k), setItem: async (k, v) => saved.set(k, v) },
    getLocalPluginStorage: async () => ({ getItem: async k => local.get(k), setItem: async (k, v) => local.set(k, v), removeItem: async k => local.delete(k), keys: async () => [...local.keys()] }),
    getDatabase: async () => ({ modules: [], enabledModules: [], personas: [] }), setDatabase: async () => {}, getCurrentLorebookEntries: async () => [],
    nativeFetch: async () => ({ ok: true, data: new Uint8Array(32) }) };
  try {
    const data = await api.loadTtsData();
    Object.assign(data.settings, { enabled: true, autoAssign: false, continuous: false, thoughtEcho: 'strong', narrationVoice: 'v' });
    data.settings.translation.provider = 'off'; data.settings.fish.key = 'fake';
    data.voices = [{ key: 'v', name: 'v', fishId: voice, gender: 'female', tags: [], folder: '' }];
    data.characters = [{ ...api.blankTtsCharacter('global', '하린'), fishId: voice }];
    const runtime = new api.OmniTtsRuntime(); await runtime.init();
    const context = { scope: 'echo', rosterScope: 'global', characterId: 'c', chatId: 'chat', sessionId: 's', character: {}, chat: {}, messages: [] };
    const say = async text => { const [segment] = api.parseTtsMessage(text); await runtime.play([{ context, messageId: text, segment }], 0); for (let i = 0; i < 20 && runtime.player.status !== 'playing'; i++) await tick(); return nodes.find(n => n.kind === 'gain1').gain.value; };
    assert.ok(await say("하린 (sad): '왜 저러지?'") > .4, 'a thought: the strong send');
    assert.equal(await say('하린 (sad): "왜 그래?"'), 0, 'a spoken line: none');
    assert.equal(await say('하린은 고개를 숙였다.'), 0, 'narration: none');
    data.settings.thoughtEcho = 'off';
    assert.equal(await say("하린 (calm): '역시 이상해.'"), 0, 'the setting off: none on a thought either');
  } finally { delete globalThis.risuai; }
});
