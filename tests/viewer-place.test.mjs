import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundle = await build({ stdin: { contents: "export {streamingPlace} from './src/domain/viewer/place';export {rememberReplyPlace,replyPlace,resetViewerPlaces} from './src/storage/viewer-places';export {resetDeviceStore} from './src/storage/device-store';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node' });
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
