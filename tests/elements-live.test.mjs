import test from 'node:test';
import assert from 'node:assert/strict';
import { LIVE_STEP, liveCss, liveTargets } from '../.test-build/elements-live.mjs';

// 작동's sheet is pure text from where each window is; the browser test proves it works on a page, this pins its shape.
const frame = { left: 10, top: 20, width: 300, height: 500 };
const entry = (over = {}) => ({
  index: 6, selector: '.x-risu-status', targets: liveTargets(6, '.x-risu-status', 2),
  left: 30, top: 60, width: 180, maxHeight: 300, scale: 1,
  rects: [{ left: 30, top: 60, width: 180, height: 60 }, null], ...over,
});

test('elements-live: a kind held once is named by its message and selector; held more, each by its place, six at most', () => {
  assert.deepEqual(liveTargets(6, '.x-risu-status', 1), ['.risu-chat[data-chat-index="6"] .chattext .x-risu-status']);
  assert.deepEqual(liveTargets(6, '.x-risu-status', 0), ['.risu-chat[data-chat-index="6"] .chattext .x-risu-status']);
  assert.deepEqual(liveTargets(2, 'div.card', 2), [
    '.risu-chat[data-chat-index="2"] .chattext div.card:nth-child(1 of div.card)',
    '.risu-chat[data-chat-index="2"] .chattext div.card:nth-child(2 of div.card)',
  ]);
  assert.equal(liveTargets(2, 'div.card', 9).length, 6);
});

test('elements-live: nothing lifted writes nothing', () => {
  assert.equal(liveCss([], frame), '');
});

test('elements-live: each window where it goes, the next a step on; a hole only where a window was read, in the frame\'s own terms', () => {
  const css = liveCss([entry()], frame);
  const [first, second] = liveTargets(6, '.x-risu-status', 2);
  assert.match(css, new RegExp(`${escape(first)}\\{position:fixed!important;left:30px!important;top:60px!important;`));
  assert.match(css, new RegExp(`${escape(second)}\\{position:fixed!important;left:${30 + LIVE_STEP}px!important;top:${60 + LIVE_STEP}px!important;`));
  assert.match(css, /width:180px!important;max-width:none!important;max-height:300px!important;overflow:auto!important/);
  // The frame, then the one window read (at 30,60 on the screen: 20,40 in the frame); the unread one cuts no hole.
  assert.ok(css.includes('[x-omni-vn]{clip-path:path(evenodd,"M0 0H300V500H0ZM20 40h180v60h-180Z")!important}'), css);
  assert.equal(css.split('h180v60h-180Z').length - 1, 1);
});

test('elements-live: what keeps a fixed box in is undone up to the page; z-index and isolation only inside the chat screen', () => {
  const lines = liveCss([entry()], frame).split('\n');
  const free = lines.find(l => l.includes('transform:none!important'));
  const stack = lines.find(l => l.includes('z-index:auto!important'));
  assert.ok(free && free.startsWith(':is(body,body :has(.default-chat-screen),.default-chat-screen,'), free);
  assert.match(free, /opacity:1!important/);
  assert.ok(stack && !/[(,]body[ ,)]/.test(stack.slice(0, stack.indexOf('{'))), stack);
  assert.ok(stack.includes('.default-chat-screen :has(.risu-chat[data-chat-index="6"])'), stack);
  assert.ok(stack.includes('.risu-chat[data-chat-index="6"] :has(.x-risu-status)'), stack);
});

test('elements-live: no window read yet, the viewer stays whole; its scale goes with each window', () => {
  const css = liveCss([entry({ rects: [null, null], scale: 0.8 })], frame);
  assert.doesNotMatch(css, /clip-path:path/);
  assert.equal(css.split('transform:scale(0.8)!important').length - 1, 2);
});

function escape(text) { return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
