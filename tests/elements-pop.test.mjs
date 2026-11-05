import test from 'node:test';
import assert from 'node:assert/strict';

// 작동's popup over Risu's page as the bridge hands it over: every call answers a turn later. `made` counts the style
// sheets made, `texts` what each says; the stage restyles on its own meanwhile (popSync), as the viewer does on a line.
const later = value => new Promise(resolve => setImmediate(resolve, value));
const made = [];
function node(rect = { left: 110, top: 370, width: 180, height: 60 }) {
  const el = {
    text: '', removed: false, rect,
    async getBoundingClientRect() { return later({ ...el.rect }); },
    async setAttribute() { await later(); }, async setStyleAttribute() { await later(); }, async setInnerHTML() { await later(); },
    async setTextContent(text) { await later(); el.text = text; }, async appendChild() { await later(); }, async remove() { await later(); el.removed = true; },
    async release() {},
  };
  return el;
}
// The chat screen 90 px taller than the frame (Risu's bar under the viewer); every element of the chat where it is.
const doc = {
  async querySelector(selector) { return later(selector === '.default-chat-screen' ? node({ left: 0, top: 0, width: 400, height: 890 }) : node()); },
  async querySelectorAll() { return later([]); },
  async createElement(tag) { const el = node(); if (tag === 'style') made.push(el); return later(el); },
};
// `centred`: what the popup asked the chat to scroll to the middle, and what its sheet said by then.
const centred = [];
// `lostCount`: how often the popup said its element was not where it was.
let lostCount = 0;
const host = { doc: () => doc, frame: () => ({ left: 0, top: 0, width: 400, height: 800 }), drawn: () => true, hideLive: () => false, say() {}, restyle: () => later(),
  async centre(target) { centred.push({ target, sheet: made[0]?.text ?? '' }); await later(); }, lost() { lostCount++; } };
const tile = { index: 6, selector: '.x-risu-status', targets: ['.risu-chat[data-chat-index="6"] .chattext .x-risu-status'] };
const rule = { role: 'live', x: 4, y: 12, scale: 1, hidden: false, always: false, from: 0, fold: false, folded: false };
const { popAttach, popClose, popDetach, popOpen, popOpenSig, popRelay, popSync } = await import('../.test-build/elements-pop.mjs');

test('elements-pop: the stage restyling every turn while it opens, one sheet is made: the room and the margin before the scroll, then the hole', async () => {
  made.length = 0; centred.length = 0;
  popAttach(host, node());
  const opening = popOpen('sig', tile, rule);
  let restyling = true;
  // The viewer's own writes as it goes (a line, a measure): each asks for the sheet as things stand.
  const stage = (async () => { while (restyling) { void popSync(); await later(); } })();
  await opening;
  restyling = false;
  await stage;
  await popSync();
  assert.equal(popOpenSig(), 'sig');
  assert.equal(made.length, 1, 'one sheet: writes go one at a time, so none finds no sheet while another makes one');
  // Scrolled to the middle once, the list's room and the bar's margin (90) already written; the hole after, where it is.
  assert.deepEqual(centred.map(c => c.target), [tile.targets[0]]);
  assert.match(centred[0].sheet, /padding-block:50vh!important/);
  assert.match(centred[0].sheet, /scroll-margin-bottom:90px!important/);
  assert.doesNotMatch(centred[0].sheet, /clip-path/, 'no hole before it is there');
  // A window as wide as it and as tall as the viewer, the ✕'s spot at its top right kept the viewer's.
  assert.match(made[0].text, /clip-path:path\(evenodd,"M0 0H400V800H0ZM110 0h180v800h-180ZM256 52h28v28h-28Z"\)/, 'a window where it is, the viewer\'s height');
  await popClose(false);
  assert.equal(made[0].text, '', 'folded: back in its message');
  await popDetach();
  assert.equal(made[0].removed, true, 'the viewer gone: the sheet with it');
});

test('elements-pop: its element gone, the window stays; back elsewhere, it is scrolled to again; gone a while, its group is asked for; only the reader folds it', async () => {
  made.length = 0; centred.length = 0; lostCount = 0;
  const at = node();
  const gone = { ...doc, async querySelector(selector) { return later(selector === '.default-chat-screen' ? node({ left: 0, top: 0, width: 400, height: 890 }) : at); } };
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  popAttach({ ...host, doc: () => gone }, node());
  await popOpen('sig', tile, rule);
  const open = made[0].text;
  assert.match(open, /M110 0h180v800h-180Z/);
  assert.equal(centred.length, 1);
  // Drawn anew without it (no size): read again, nothing moves, nothing scrolls, its group not asked for yet (drawn
  // anew, it is gone only a moment).
  at.rect = { left: 0, top: 0, width: 0, height: 0 };
  await popRelay();
  assert.equal(made[0].text, open, 'the window as it was');
  assert.equal(popOpenSig(), 'sig', 'still open');
  assert.equal(lostCount, 0, 'not asked for at once');
  // Back, elsewhere (its message drawn anew taller): found by the watch, scrolled to the middle again, the window
  // following it.
  at.rect = { left: 130, top: 300, width: 160, height: 90 };
  await wait(700);
  assert.equal(centred.length, 2, 'scrolled to it again');
  assert.match(made[0].text, /M130 0h160v800h-160Z/);
  // There: read again, no scroll (the reader's own scroll is theirs).
  await popRelay();
  assert.equal(centred.length, 2);
  // Gone a while: its group is asked for, once.
  at.rect = { left: 0, top: 0, width: 0, height: 0 };
  await popRelay();
  await wait(2300);
  assert.equal(lostCount, 1, 'asked for once, gone a while');
  assert.equal(made[0].text.includes('M130 0h160v800h-160Z'), true, 'the window still where it was');
  await popDetach();
});

test('elements-pop: the viewer closed at any moment while it opens, no sheet is left on the page', async () => {
  let afterSheet = 0;
  for (let n = 0; n < 24; n++) {
    made.length = 0;
    popAttach(host, node());
    const opening = popOpen('sig', tile, rule).catch(() => {});
    for (let i = 0; i < n; i++) await later();
    await popDetach();
    await opening;
    for (let i = 0; i < 30; i++) await later();
    if (made.length) afterSheet++;
    assert.ok(made.every(s => s.removed), `closed ${n} turns in: ${made.length} sheet(s), ${made.filter(s => !s.removed).length} left on the page`);
  }
  // Some of the closes came once a sheet was made (or this proved nothing).
  assert.ok(afterSheet > 0, 'no close came after a sheet was made');
});
