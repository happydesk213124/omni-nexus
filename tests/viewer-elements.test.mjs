import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';

// DOMParser lives in a browser: the finder runs where the viewer does.
const built = await build({ stdin: { contents: "import {findElementKinds,kindLabel} from './src/domain/viewer/elements';window.findElementKinds=findElementKinds;window.kindLabel=kindLabel;", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'iife' });
const BODY = [
  '<p>문이 열렸다.</p>',
  '<div class="x-risu-status">HP 3 <span>MP 2</span><span>호감 42</span><span data-omnitts-tail="1"><button data-omnitts-play="1">▶</button></span></div>',
  '<div class="x-risu-choices"><p>1. <b>창가</b>에 앉는다</p><p>2. 카운터로 간다</p></div>',
  '<div class="x-risu-card">하나</div><div class="x-risu-card">둘</div>',
  '<div class="inray-shot" data-inlay-inline-shot="c1" data-inray-asset="inxshot_a"><div class="inray-bar"><button>🎲</button></div><img src="data:,"></div>',
  '<div class="x-risu-wrap"><p>감싼 글</p><div data-inray-asset="inxshot_b"><img src="data:,"></div><div class="x-risu-inner">안쪽 패널</div></div>',
  '<div class="상태 창">한글 클래스</div>',
  '<style>.x-risu-status{color:red}</style><div class="x-risu-empty"> </div>',
].join('');

test('요소: a bot\'s own elements by kind — ours, wrappers around our pictures and empty ones are not', async () => {
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  try {
    const page = await browser.newPage();
    await page.addScriptTag({ content: built.outputFiles[0].text });
    const kinds = await page.evaluate(body => {
      const root = new DOMParser().parseFromString(`<div>${body}</div>`, 'text/html').body.firstElementChild;
      document.body.innerHTML = `<div class="chattext">${body}</div>`;
      return window.findElementKinds(root).map(k => ({ ...k, live: document.querySelectorAll(`.chattext ${k.selector}`).length, named: window.kindLabel(k.sig) }));
    }, BODY);
    // A kind registered and absent from a message is named from its signature alone, as it is when found.
    for (const k of kinds) assert.equal(k.named, k.label, `${k.sig}: named from its signature`);
    assert.equal(await page.evaluate(() => window.kindLabel('div#board.x-risu-a.x-risu-b')), 'a', 'its first class before its id');
    assert.equal(await page.evaluate(() => window.kindLabel('details#log')), 'log');
    assert.deepEqual(kinds.map(k => k.label), ['status', 'choices', 'card', 'inner', '상태'], 'in reading order; no inray shot or bar, no wrapper holding a picture, no empty one');
    const [status, choices, card, , hangul] = kinds;
    assert.equal(status.text, 'HP 3 MP 2 호감 42', 'cells side by side are words apart; a TTS ▶ inside is no part of the panel');
    assert.deepEqual(choices.options, ['1. 창가에 앉는다', '2. 카운터로 간다'], 'a list of several: each child an option, an inline <b> no word break');
    assert.equal(card.count, 2);
    assert.deepEqual(card.options, ['하나', '둘'], 'several of a kind: each its own option');
    for (const k of kinds) assert.equal(k.live, k.count, `${k.label}: its selector finds it in the live chat (${k.selector})`);
    assert.match(hangul.selector, /^div\.\\/, 'a class that is no CSS identifier is escaped');
  } finally { await browser.close(); }
});
