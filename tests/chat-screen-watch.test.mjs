import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

// Risu's page as the bridge hands it over: every call answers a turn later. `calls` counts what is asked of it.
// The bridge's turns run on setImmediate, which is left real; the watcher's own clock (its second, its 0.3 s) is mocked.
const calls = { root: 0, lookups: 0, sizes: 0, releases: 0 };
const page = { screen: null };
const later = value => new Promise(resolve => setImmediate(resolve, value));
function screenNode(rect) {
  const node = {
    rect, attached: true,
    async getBoundingClientRect() { calls.sizes++; return later(node.attached ? { left: 0, top: 0, ...node.rect } : { left: 0, top: 0, width: 0, height: 0 }); },
    async release() { calls.releases++; },
  };
  return node;
}
const doc = { async querySelector(selector) { calls.lookups++; assert.equal(selector, '.default-chat-screen'); return later(page.screen); } };
globalThis.risuai = { async getRootDocument() { calls.root++; return later(doc); } };
const { watchChatScreen, checkChatScreenSoon, setViewerCovering } = await import('../.test-build/chat-screen-watch.mjs');

mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
const reset = () => Object.assign(calls, { root: 0, lookups: 0, sizes: 0, releases: 0 });
const asked = () => ({ ...calls });
const settle = async () => { for (let i = 0; i < 12; i++) await new Promise(resolve => setImmediate(resolve)); };
const second = async () => { mock.timers.tick(1000); await settle(); };
const told = () => { const seen = []; return { seen, fn: screen => seen.push({ ...screen }) }; };

test('with nobody listening, nothing is asked of Risu', async () => {
  reset();
  for (let i = 0; i < 5; i++) await second();
  checkChatScreenSoon();
  mock.timers.tick(1000); await settle();
  assert.deepEqual(asked(), { root: 0, lookups: 0, sizes: 0, releases: 0 });
});

test('three listeners share one check a second: the screen is kept, and only its size is read', async () => {
  reset();
  page.screen = screenNode({ width: 400, height: 800 });
  const tts = told(), tag = told(), viewer = told();
  // Each comes at its own moment, as they do on the page: one second of its own each would not line up.
  const stops = [watchChatScreen(tts.fn)];
  await settle();
  mock.timers.tick(300); stops.push(watchChatScreen(tag.fn)); await settle();
  mock.timers.tick(300); stops.push(watchChatScreen(viewer.fn)); await settle();
  assert.deepEqual(asked(), { root: 1, lookups: 1, sizes: 1, releases: 0 }, 'the first check finds the screen; the others are told it');
  for (const l of [tts, tag, viewer]) assert.deepEqual(l.seen, [{ present: true, left: 0, top: 0, width: 400, height: 800, drawn: 0 }]);
  reset();
  for (let i = 0; i < 5; i++) await second();
  assert.deepEqual(asked(), { root: 0, lookups: 0, sizes: 5, releases: 0 }, 'five seconds, five sizes: one each, for all three');
  for (const l of [tts, tag, viewer]) assert.equal(l.seen.length, 1, 'nothing changed, nobody told again');

  // A turned phone: everyone hears the new size.
  page.screen.rect = { width: 800, height: 400 };
  await second();
  for (const l of [tts, tag, viewer]) assert.deepEqual(l.seen.at(-1), { present: true, left: 0, top: 0, width: 800, height: 400, drawn: 0 });

  // Risu draws its settings in place of the chat: the kept screen has no size, so it is looked for once, not found.
  reset();
  const gone = page.screen; gone.attached = false; page.screen = null;
  await second();
  assert.deepEqual(asked(), { root: 0, lookups: 1, sizes: 1, releases: 1 }, 'its size, then one look for it');
  for (const l of [tts, tag, viewer]) assert.equal(l.seen.at(-1).present, false);
  reset();
  await second();
  assert.deepEqual(asked(), { root: 0, lookups: 1, sizes: 0, releases: 0 }, 'while it is gone, one look a second');

  // Back: found again, and kept again.
  page.screen = gone; gone.attached = true;
  await second();
  for (const l of [tts, tag, viewer]) assert.equal(l.seen.at(-1).present, true);
  reset();
  await second(); await second();
  assert.deepEqual(asked(), { root: 0, lookups: 0, sizes: 2, releases: 0 });

  // Drawn anew at the same size (another bot's chat): no news by its place or size, so it is told by the count.
  // What was put on the old one (the floating viewer's watcher and marker) went with it.
  const before = tts.seen.length;
  gone.attached = false; page.screen = screenNode({ width: 800, height: 400 });
  reset();
  await second();
  assert.deepEqual(asked(), { root: 0, lookups: 1, sizes: 2, releases: 1 }, 'the old one has no size: the new one is found');
  for (const l of [tts, tag, viewer]) assert.deepEqual(l.seen.slice(before), [{ present: true, left: 0, top: 0, width: 800, height: 400, drawn: 1 }]);
  for (const stop of stops) stop();
});

test('a tap asks once, 0.3 s later; with nobody listening, a tap asks nothing', async () => {
  page.screen = screenNode({ width: 400, height: 800 });
  const l = told(), stop = watchChatScreen(l.fn);
  await settle();
  reset();
  checkChatScreenSoon(); checkChatScreenSoon();
  mock.timers.tick(299); await settle();
  assert.equal(calls.sizes, 0, 'not yet');
  mock.timers.tick(1); await settle();
  assert.equal(calls.sizes, 1, 'two taps, one check');
  stop();
  reset();
  checkChatScreenSoon();
  mock.timers.tick(1000); await settle();
  assert.deepEqual(asked(), { root: 0, lookups: 0, sizes: 0, releases: 0 });
});

test('a listener is told after it subscribes, never during the call; the last to leave stops the check', async () => {
  page.screen = screenNode({ width: 400, height: 800 });
  const first = told(), stopFirst = watchChatScreen(first.fn);
  await settle();
  let during = true, stopLater = null;
  const late = [];
  stopLater = watchChatScreen(screen => { late.push({ during, subscribed: typeof stopLater === 'function', present: screen.present }); });
  during = false;
  await settle();
  assert.deepEqual(late, [{ during: false, subscribed: true, present: true }], 'told what is known, once the call has returned');
  stopLater(); stopFirst();
  reset();
  for (let i = 0; i < 3; i++) await second();
  assert.deepEqual(asked(), { root: 0, lookups: 0, sizes: 0, releases: 0 }, 'nobody left: nothing asked');

  // What was known is not kept to be told as news: a new listener hears from a new check.
  page.screen = null;
  const fresh = told(), stopFresh = watchChatScreen(fresh.fn);
  await settle();
  assert.deepEqual(fresh.seen.map(s => s.present), [false], 'the page as it is now, not as it was');
  stopFresh();
});

test('behind 옴니 뷰어 nothing is asked, taps neither; it closes and one check catches up', async () => {
  page.screen = screenNode({ width: 400, height: 800 });
  const l = told(), stop = watchChatScreen(l.fn);
  await settle();
  setViewerCovering(true);
  reset();
  for (let i = 0; i < 4; i++) await second();
  checkChatScreenSoon(); mock.timers.tick(300); await settle();
  assert.deepEqual(asked(), { root: 0, lookups: 0, sizes: 0, releases: 0 }, 'quiet behind the viewer');
  page.screen.rect = { width: 300, height: 600 };
  setViewerCovering(false);
  await settle();
  assert.deepEqual(asked(), { root: 0, lookups: 0, sizes: 1, releases: 0 }, 'one check as it closes');
  const { drawn, ...now } = l.seen.at(-1);
  assert.deepEqual([now, drawn], [{ present: true, left: 0, top: 0, width: 300, height: 600 }, l.seen[0].drawn], 'and what changed meanwhile is told');
  stop();
  reset();
  setViewerCovering(true); setViewerCovering(false);
  await settle();
  assert.deepEqual(asked(), { root: 0, lookups: 0, sizes: 0, releases: 0 }, 'nobody listening: its closing asks nothing');
});
