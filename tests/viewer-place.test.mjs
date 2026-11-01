import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundle = await build({ stdin: { contents: "export {streamingPlace,placeMarkers,placeAt,backgroundName,backgroundPlace,hashedPlace,placeModule,PLACE_MARKER_SOURCE} from './src/domain/viewer/place';export {parseTtsMessage} from './src/domain/tts/segment';export {rememberReplyPlace,replyPlace,resetViewerPlaces} from './src/storage/viewer-places';export {resetDeviceStore} from './src/storage/device-store';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node' });
const api = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

test('a streaming reply says where it is as its blocks close: the cast block, else the first picture with a location', () => {
  const cast = '[[inxc]]{"new_characters":[{"name":"하린"}],"place":"cafe, window"}[[/inxc]]\n문이 열렸다.';
  assert.equal(api.streamingPlace(cast), 'cafe, window');
  const shots = '문이 열렸다.\n[[inx1]]{"characters":[{"name":"하린"}],"camera":"cowboy shot"}[[/inx1]]\n하린: "왔어?"\n[[inx2]]{"characters":[{"name":"하린"}],"location":"park, bench, outdoors"}[[/inx2]]';
  assert.equal(api.streamingPlace(shots), 'park, bench, outdoors', 'a picture that keeps the last place says none of its own');
  assert.equal(api.streamingPlace(cast.replace('"place":"cafe, window"', '"place":""') + '\n' + shots), 'park, bench, outdoors', 'a cast block naming no place: the picture says it');
  assert.equal(api.streamingPlace('[[inxc]]{"new_characters":[],"place":"cafe"'), '', 'still being written: nothing yet');
  assert.equal(api.streamingPlace('<think>[[inx1]]{"characters":[{"name":"A"}],"location":"draft"}[[/inx1]]</think>\n본문'), '', "the model's thoughts are not the story");
});

test("a reply's place: where its cast block opens it stands; a picture fills in for it, the earliest picture first", async () => {
  const saved = new Map();
  globalThis.risuai = { pluginStorage: { getItem: async k => structuredClone(saved.get(k)), setItem: async (k, v) => saved.set(k, structuredClone(v)), removeItem: async k => saved.delete(k) } };
  api.resetDeviceStore(); api.resetViewerPlaces();
  await api.rememberReplyPlace('bot', 'chat', 'm1', 'park, bench', 2);
  assert.equal(await api.replyPlace('bot', 'chat', 'm1'), 'park, bench');
  await api.rememberReplyPlace('bot', 'chat', 'm1', 'street, night', 3);
  assert.equal(await api.replyPlace('bot', 'chat', 'm1'), 'park, bench', 'a later picture never moves it');
  await api.rememberReplyPlace('bot', 'chat', 'm1', 'cafe, window', 1);
  assert.equal(await api.replyPlace('bot', 'chat', 'm1'), 'cafe, window', 'an earlier picture does');
  await api.rememberReplyPlace('bot', 'chat', 'm1', 'library', 0);
  assert.equal(await api.replyPlace('bot', 'chat', 'm1'), 'library', 'the cast block: where the reply opens');
  await api.rememberReplyPlace('bot', 'chat', 'm1', 'park, bench', 1);
  assert.equal(await api.replyPlace('bot', 'chat', 'm1'), 'library');
  await api.rememberReplyPlace('bot', 'chat', 'm1', 'library, night', 0);
  assert.equal(await api.replyPlace('bot', 'chat', 'm1'), 'library, night', 'the cast block written again');
});

test('[[place:…]] marks: where each stands, the place a line is in, never read aloud', () => {
  const reply = '[[place:Cafe, indoors, cafe]]\n하린: "커피 다 마셨어?"\n[[place:street, night]]\n밤거리는 조용했다.';
  const marks = api.placeMarkers(reply);
  assert.deepEqual(marks.map(m => m.place), ['cafe, indoors', 'street, night'], 'its tags: lowercased, no repeats');
  assert.equal(api.placeAt(marks, reply.indexOf('하린')), 'cafe, indoors');
  assert.equal(api.placeAt(marks, reply.indexOf('밤거리')), 'street, night');
  assert.equal(api.placeAt(marks, 0), 'cafe, indoors', 'the mark itself is where it stands');
  assert.equal(api.placeAt([], 10), '');
  const read = api.parseTtsMessage(reply).map(seg => seg.text);
  assert.deepEqual(read, ['커피 다 마셨어?', '밤거리는 조용했다.'], 'TTS never reads a mark');
});

test("a background's name on the bot: omni_bg_ and its tags; the place read back from any background name", () => {
  assert.equal(api.backgroundName('Cafe, indoors, cafe', 'webp'), 'omni_bg_cafe, indoors.webp');
  const long = Array.from({ length: 16 }, (_, i) => 'a long place tag ' + i).join(', ');
  assert.match(api.backgroundName(long, 'webp'), /^omni_bg_[0-9a-f]{1,8}-[0-9a-f]+\.webp$/, 'a very long place: its hash');
  assert.equal(api.hashedPlace(api.backgroundPlace(api.backgroundName(long, 'webp'))), true);
  assert.equal(api.hashedPlace('classroom'), false, 'one word is a place, not a hash');
  assert.equal(api.backgroundPlace('omni_bg_cafe, indoors.webp'), 'cafe, indoors');
  assert.equal(api.backgroundPlace('bg_street, night.png'), 'street, night', 'the older name');
  assert.equal(api.backgroundPlace('omni_하린_happy.png'), '', 'a sprite is no background');
  assert.equal(api.backgroundPlace('background music'), '');
});

test('⚛️ omni place: the writer is asked for marks on lines of their own; the chat hides them', () => {
  const module = api.placeModule();
  assert.equal(module.name, '⚛️ omni place');
  assert.match(module.lorebook[0].content, /\[\[place:cafe, indoors, window, daytime\]\]/);
  // It goes with every reply: cut down from 570 characters, every rule kept.
  for (const rule of [/at the start of every reply and whenever the scene moves/, /on a line of its own/, /at most three per reply/]) assert.match(module.lorebook[0].content, rule);
  assert.ok(module.lorebook[0].content.length <= 480, `the place prompt grew to ${module.lorebook[0].content.length} characters`);
  assert.equal(module.lorebook[0].alwaysActive, true);
  const hide = module.regex[0];
  assert.equal(hide.type, 'editdisplay');
  const shown = '[[place:cafe, indoors]]\n하린: "안녕"\n밖은 [[place:street]] 조용했다.'.replace(new RegExp(hide.in, 'gi'), hide.out);
  assert.equal(shown, '하린: "안녕"\n밖은 조용했다.');
});
