import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  INRAY_DISPLAY_IN,
  INRAY_DISPLAY_MODULE_ID,
  INRAY_DISPLAY_MODULE_NAME,
  INRAY_DISPLAY_OUT,
  inrayDisplayOut,
  inrayDisplayRegexScript,
} from '../.test-build/inray-display.mjs';

test('display regex rewrites Inray tokens to centered gallery assets', () => {
  const token = '[[@inray::card-1::inxshot_card-1.sroom.webp]]';
  const re = new RegExp(INRAY_DISPLAY_IN, 'g');
  const out = token.replace(re, INRAY_DISPLAY_OUT);
  assert.match(out, /data-inlay-inline-shot="card-1"/);
  assert.match(out, /data-inray-bake="1"/);
  assert.match(out, /data-inray-fs="card-1"/);
  assert.match(out, /data-inray-refresh="card-1"/);
  assert.equal(/data-inray-tag/.test(out), false);
  assert.equal(/data-inray-regen/.test(out), false);
  assert.equal(/>태그</.test(out), false);
  assert.equal(/>재생성</.test(out), false);
  assert.match(out, /src="\{\{raw::inxshot_card-1\.sroom\.webp\}\}"/);
  assert.match(out, /width:100%/);
  assert.match(out, /max-height:min\(70vh/);
  assert.equal(/aspect-ratio:2\/3/.test(out), false);
  assert.match(out, /inray-fold-card-1/);
  assert.match(out, /content:"▼"/);
  assert.match(out, /content:"▲"/);
  assert.match(out, /inray-clip/);
  assert.match(out, /max-height:4\.5em/);
  assert.equal(/checked~img\{display:none/.test(out), false);
  assert.match(out, /margin:10px auto/);
  assert.equal(inrayDisplayRegexScript().type, 'editdisplay');
  assert.equal(INRAY_DISPLAY_MODULE_ID, 'inlay-inray-display');
  assert.equal(INRAY_DISPLAY_MODULE_NAME, '⚛️Omni Nexus 디스플레이');
  assert.equal(/ checked/.test(INRAY_DISPLAY_OUT), false);
  assert.match(inrayDisplayOut(true), /id="inray-fold-\$1" checked/);
});

test('spinner exposes a stable preview slot independent of Risu class prefixes', async () => {
  const { spinnerDisplayRegexScript } = await import('../.test-build/inray-display.mjs');
  const script = spinnerDisplayRegexScript();
  const out = '[[@inrayspinner::job_0::1024::1024]]'.replace(new RegExp(script.in, script.flag), script.out);
  assert.match(out, /data-inray-spinner="job_0"/);
  assert.match(out, /data-inray-preview-slot="job_0"/);
});

 test('baked size follows dashboard scale including clamping', () => {
  for (const [scale, width, height] of [[25,20,18],[50,39,35],[100,78,70],[200,100,140],[999,100,140]]) {
    const out = inrayDisplayOut(false, scale);
    assert.ok(out.includes(`max-width:min(${width}%,100%)`));
    assert.ok(out.includes(`max-height:min(${height}vh,`));
  }
});

// Fullscreen is the frozen sticky inspect: the fs chip is a plain button,
// the shot div carries the asset name so the tap handler can read the `.c`
// cast segment, resolve chips via /v1/shots/resolve-cast, and show the
// hovered chat file URL instead of a base64 re-decode.
test('fullscreen is a button and exposes the asset name for cast chips', () => {
  const token = '[[@inray::card-1::inxshot_card-1.sroom.ca51b-e456.webp]]';
  const re = new RegExp(INRAY_DISPLAY_IN, 'g');
  const out = token.replace(re, INRAY_DISPLAY_OUT);
  assert.match(out, /x-inray-asset="inxshot_card-1\.sroom\.ca51b-e456\.webp"/);
  assert.match(out, /<button[^>]*data-inray-fs="card-1"/);
  assert.equal(/inray-ov-card-1/.test(out), false);
  assert.equal(/inray-chips/.test(out), false);
});
