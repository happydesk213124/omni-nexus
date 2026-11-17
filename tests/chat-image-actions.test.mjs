import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { inrayDisplayOut } from '../.test-build/inray-display.mjs';
const runtime = readFileSync(new URL('../tools/vendor-patches/chat-image-actions.js', import.meta.url), 'utf8');

test('a chat picture: ⭐ makes it a favourite and back; ✕ asks once, then takes it out of the chat; unasked again after a while', { timeout: 60000 }, async () => {
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 1000 } });
    await page.addScriptTag({ content: readFileSync('node_modules/dompurify/dist/purify.min.js', 'utf8') });
    // Risu's sanitizer, as the history runtime test has it: classes and their rules get x-risu-.
    await page.evaluate(() => {
      DOMPurify.addHook('uponSanitizeAttribute', (_n, data) => { if (data.attrName === 'class') data.attrValue = data.attrValue.split(' ').map(v => v.startsWith('x-risu-') ? v : 'x-risu-' + v).join(' '); });
      DOMPurify.addHook('uponSanitizeElement', node => { if (node.tagName === 'STYLE') node.textContent = node.textContent.replace(/\.(inray-[\w-]+|omni-spinner)(?![\w-])/g, '.x-risu-$1'); });
      window.risuSanitize = html => DOMPurify.sanitize(html, { FORCE_BODY: true });
    });
    const html = inrayDisplayOut().replaceAll('$1', 'shot').replaceAll('$2', 'inxshot_shot.webp').replaceAll('$3', '832').replaceAll('$4', '1216');
    await page.evaluate(html => { document.body.innerHTML = risuSanitize(html); document.querySelector('img').src = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="832" height="1216"><rect width="100%" height="100%" fill="#725a91"/></svg>'); }, html);
    await page.evaluate(runtime => {
      class Safe {
        constructor(node) { this.node = node; }
        async querySelectorAll(s) { return [...this.node.querySelectorAll(s)].map(n => new Safe(n)); }
        async querySelector(s) { const n = this.node.querySelector(s); return n ? new Safe(n) : null; }
        async getAttribute(k) { if (!k.startsWith('x-')) throw Error('Can only get x- attributes'); return this.node.getAttribute(k); }
        async setAttribute(k, v) { if (!k.startsWith('x-')) throw Error('Can only set x- attributes'); this.node.setAttribute(k, v); }
        async getOuterHTML() { return this.node.outerHTML; }
      }
      // As the history runtime reads a button's picture: its x- attribute, else the data- one in its markup.
      const nxFloatHtmlAttr = (html, name) => new RegExp('(?:^|\\s)' + name + '=["\']([^"\']*)["\']', 'i').exec(html)?.[1] || '';
      const omniHistoryAttr = async (el, name) => await el.getAttribute('x-' + name) || nxFloatHtmlAttr(await el.getOuterHTML(), 'data-' + name);
      const doc = new Safe(document);
      const t = {}, explorer = { favorites: [] }, saved = { favorites: [] }, calls = [], errors = [];
      const K = async (path, opts) => {
        calls.push([opts?.method || 'GET', path, opts?.body]);
        if (path === '/v1/gallery/favorites') { if (opts?.method === 'POST') saved.favorites = opts.body.ids; return { ok: true, ids: saved.favorites }; }
        return { ok: true };
      };
      const hitEl = async (el, x, y) => { const r = el.node.getBoundingClientRect(); return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; };
      const nxUnwrapSafeNodes = async n => n, omniRelease = async () => {}, ensureExplorerState = () => explorer;
      const Pe = (title, error) => errors.push(title + ': ' + error.message);
      const api = new Function('t', 'K', 'hitEl', 'nxUnwrapSafeNodes', 'omniRelease', 'ensureExplorerState', 'Pe', 'omniHistoryAttr', runtime + '\nreturn { omniChatImageAction, omniPaintFavoriteIn };')(t, K, hitEl, nxUnwrapSafeNodes, omniRelease, ensureExplorerState, Pe, omniHistoryAttr);
      window.fixture = { doc, api, calls, errors, explorer, saved };
    }, runtime);
    const press = async selector => {
      const box = await page.locator(selector).boundingBox();
      const x = box.x + box.width / 2, y = box.y + box.height / 2;
      await page.mouse.move(x, y);
      return page.evaluate(([x, y]) => fixture.api.omniChatImageAction(fixture.doc, { clientX: x, clientY: y }), [x, y]);
    };
    const star = '.x-risu-inray-fav', cross = '.x-risu-inray-del';
    // Hovered, the bar and ✕ show; ⭐ is grey until it is a favourite.
    await page.mouse.move(450, 300);
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.x-risu-inray-del')).opacity === '1', null, { timeout: 2000 });
    assert.match(await page.locator(star).evaluate(n => getComputedStyle(n).filter), /grayscale\(1\)/);
    assert.equal(await press(star), true);
    assert.deepEqual(await page.evaluate(() => [fixture.saved.favorites, fixture.explorer.favorites]), [['shot'], ['shot']], 'the one list, and 이미지 탐색\'s copy of it');
    assert.equal(await page.locator(star).getAttribute('x-inray-fav-on'), '1');
    assert.equal(await page.locator(star).evaluate(n => getComputedStyle(n).filter), 'none', 'lit');
    assert.equal(await press(star), true);
    assert.deepEqual(await page.evaluate(() => fixture.saved.favorites), [], 'pressed again, not a favourite');
    assert.equal(await page.locator(star).getAttribute('x-inray-fav-on'), '0');
    // ✕: the first press asks, and says what a second one does.
    const unbakes = () => page.evaluate(() => fixture.calls.filter(row => row[1] === '/v1/cards/shot/unbake').length);
    const plainWidth = await page.locator(cross).evaluate(n => n.getBoundingClientRect().width);
    assert.equal(await press(cross), true);
    assert.equal(await unbakes(), 0, 'one press takes nothing out');
    assert.equal(await page.locator(cross).getAttribute('x-inray-del-armed'), '1');
    assert.equal(await page.locator(cross).evaluate(n => getComputedStyle(n, '::before').content), '"✕ 한 번 더 누르면 채팅에서 빠져요"');
    assert.ok(await page.locator(cross).evaluate(n => n.getBoundingClientRect().width) > plainWidth * 2, 'the question has room');
    assert.equal(await press(cross), true);
    assert.equal(await unbakes(), 1, 'the second press takes it out');
    // Asked and left: four seconds later it asks again.
    assert.equal(await press(cross), true);
    await page.waitForFunction(() => document.querySelector('.x-risu-inray-del').getAttribute('x-inray-del-armed') === '0', null, { timeout: 6000 });
    assert.equal(await press(cross), true);
    assert.equal(await unbakes(), 1, 'a press after the question lapsed asks again');
    // Somewhere else on the picture: not ours.
    await page.mouse.move(450, 500);
    assert.equal(await page.evaluate(() => fixture.api.omniChatImageAction(fixture.doc, { clientX: 450, clientY: 500 })), false);
    assert.deepEqual(await page.evaluate(() => fixture.errors), []);
  } finally { await browser.close(); }
});
