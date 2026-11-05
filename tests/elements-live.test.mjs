import test from 'node:test';
import assert from 'node:assert/strict';
import { liveCss, liveTargets } from '../.test-build/elements-live.mjs';

// 작동's sheet is pure text from where each window is; the browser test proves it works on a page, this pins its shape.
const frame = { left: 10, top: 20, width: 300, height: 500 };
const entry = (over = {}) => ({
  targets: liveTargets(6, '.x-risu-status', 2), scale: 1, below: 90,
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

test('elements-live: nothing open writes nothing', () => {
  assert.equal(liveCss([], frame), '');
});

test('elements-live: never lifted out of its place, no room made in the list (in sight is enough); the bar under the viewer is not sight', () => {
  const css = liveCss([entry()], frame);
  const [first, second] = liveTargets(6, '.x-risu-status', 2);
  assert.doesNotMatch(css, /position:fixed|transform:none|z-index/, 'nothing of Risu\'s page is changed to lift it');
  assert.doesNotMatch(css, /padding/, 'no room under the list: half a screen of nothing when Risu took the chat to its foot');
  assert.ok(css.includes(`:is(${first},${second}){scroll-margin-bottom:90px!important}`), css);
});

test('elements-live: a hole where each window is, in the frame\'s own terms; one not read cuts none', () => {
  const css = liveCss([entry()], frame);
  // The frame, then the one window read (at 30,60 on the screen: 20,40 in the frame); the unread one cuts no hole.
  assert.ok(css.includes('[x-omni-vn]{clip-path:path(evenodd,"M0 0H300V500H0ZM20 40h180v60h-180Z")!important}'), css);
  assert.equal(css.split('h180v60h-180Z').length - 1, 1);
  assert.doesNotMatch(liveCss([entry({ rects: [null, null] })], frame), /clip-path:path/, 'none read: the viewer stays whole');
});

test('elements-live: a spot kept inside the window is the viewer\'s again (the ✕); with no window, none is cut', () => {
  const keep = { left: 170, top: 72, width: 28, height: 28 };
  assert.ok(liveCss([entry({ keep })], frame).includes('M0 0H300V500H0ZM20 40h180v60h-180ZM160 52h28v28h-28Z'), 'even-odd: the third square filled again');
  assert.doesNotMatch(liveCss([entry({ keep, rects: [null, null] })], frame), /clip-path/, 'no window: the spot would be a hole of its own');
});

test('elements-live: its 크기 in place, about its middle (the chat\'s layout as it was)', () => {
  assert.match(liveCss([entry({ scale: 0.8 })], frame), /scroll-margin-bottom:90px!important;transform:scale\(0\.8\)!important;transform-origin:50% 50%!important\}/);
  assert.doesNotMatch(liveCss([entry()], frame), /transform:scale/, 'at its own size, nothing');
});
