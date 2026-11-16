import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The frozen UI's 🎲 and ⛶ answer a pointerdown by its point (vite.config.ts patch). Where taps focus what they land
// on, the press counts only for the button the browser focused: one under a panel is not pressed by a tap on the panel.
const dist = readFileSync(new URL('../dist/omninexus.js', import.meta.url), 'utf8');
const from = dist.indexOf('const nxPressedOn = async (node) => {');
const to = dist.indexOf('\n      };', from) + '\n      };'.length;
const pressedOn = new Function(dist.slice(from, to) + ';return nxPressedOn;')();

test('🎲 and ⛶ each wait for their own focused press before acting', () => {
  assert.ok(from > 0, 'the check is in the bundle');
  assert.equal(dist.split('if (!await nxPressedOn(node)) return;').length - 1, 2, '🎲 and ⛶ both ask it');
  const dice = dist.indexOf('if (!await nxPressedOn(node)) return;', dist.indexOf('[x-inray-refresh],[data-inray-refresh]', from));
  assert.ok(dice > 0 && dice < dist.indexOf('bake.refresh', from), 'the dice asks before it restamps');
});

test('where taps never focus (an iPhone) the point acts at once; once taps are known to focus, only the focused button does', async () => {
  delete globalThis.__OMNI_FOCUS_TAPS__;
  let focus = false;
  const node = { async matches(selector) { return selector === ':focus' && focus; } };
  const started = Date.now();
  assert.equal(await pressedOn(node), true, 'nothing learned: acts on the point');
  assert.ok(Date.now() - started < 30, 'and at once, with no wait');
  // A moment later the browser has focused it: taps here focus, and that is learned.
  focus = true; await new Promise(r => setTimeout(r, 500));
  assert.equal(globalThis.__OMNI_FOCUS_TAPS__, true);
  // A tap on a panel lying over the button: the button never takes the focus.
  focus = false;
  const waited = Date.now();
  assert.equal(await pressedOn(node), false, 'a covered button is not pressed');
  assert.ok(Date.now() - waited >= 1000, 'the lift is waited for before giving up');
  // A finger that lifts a little after pointerdown: the focus comes then.
  setTimeout(() => { focus = true; }, 200);
  assert.equal(await pressedOn(node), true, 'the button the tap focused is pressed');
  delete globalThis.__OMNI_FOCUS_TAPS__;
});
