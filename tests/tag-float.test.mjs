import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const pure = await build({ stdin: { contents: "export {replyAt,readingReply} from './src/domain/viewer/reply-at';export {stepImageCount} from './src/domain/image-count';export {messageControlsOf} from './src/domain/message-controls';", resolveDir: process.cwd() }, bundle: true, write: false, format: 'esm' });
const { replyAt, readingReply, stepImageCount, messageControlsOf } = await import('data:text/javascript;base64,' + Buffer.from(pure.outputFiles[0].text).toString('base64'));

test('the reply a place stands for: itself, else the next reply, else the last before; the 🟪 bar takes the newest at the bottom', () => {
  const roles = ['user', 'char', 'user', 'char', 'user'];
  assert.equal(replyAt(roles, 1), 1);
  assert.equal(replyAt(roles, 2), 3, "a reader's message: the reply after it");
  assert.equal(replyAt(roles, 4), 3, 'none after: the one before');
  assert.equal(replyAt(roles, 9), 3, 'past the end: the newest');
  assert.equal(replyAt(['user'], 0), -1);
  assert.equal(readingReply(roles, { center: 1, atBottom: true }), 3, 'at the bottom: the newest, wherever the middle is');
  assert.equal(readingReply(roles, { center: 0, atBottom: false }), 1, 'scrolled up: the middle');
  assert.equal(readingReply(roles, { center: -1, atBottom: false }), 3, 'nothing drawn: the newest');
});

test('생성 장수 a step: never under 1, the least never past the most, a step to nowhere is null', () => {
  assert.deepEqual(stepImageCount('max-up', 1, 3), { min: 1, max: 4 });
  assert.deepEqual(stepImageCount('min-up', 1, 3), { min: 2, max: 3 });
  assert.equal(stepImageCount('min-down', 1, 3), null);
  assert.equal(stepImageCount('min-up', 3, 3), null);
  assert.equal(stepImageCount('max-down', 3, 3), null);
  assert.deepEqual(stepImageCount('max-down', '2', '5'), { min: 2, max: 4 }, 'read off inputs as text');
  assert.deepEqual(stepImageCount('max-up', '', ''), { min: 1, max: 2 }, 'empty inputs read as one');
  assert.equal(stepImageCount('min-up', '', ''), null, 'the least never pushes the most up (the chat\'s 🔢 refuses it too)');
  assert.equal(stepImageCount('sideways', 1, 3), null);
});

test('the message row as the settings ask for it, folded to 🟪 only with its own switch', () => {
  assert.deepEqual(messageControlsOf({ inline_msg_fan: true, userchat: false }), { enabled: true, userchat: false, folded: false });
  assert.deepEqual(messageControlsOf({ inline_msg_fan: true, userchat: true, inline_msg_fan_folded: true }), { enabled: true, userchat: true, folded: true });
  assert.deepEqual(messageControlsOf(undefined), { enabled: false, userchat: false, folded: false });
});

const bundle = await build({ stdin: { contents: "import {installTagFloat} from './src/image-ui/tag-float';import {getConfig} from './src/services/context';import {setViewerCovering} from './src/services/viewer-presence';Object.assign(window,{installTagFloat,getConfig,setViewerCovering});", resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife' });

test('플로팅 태그 over a restricted SafeDOM: 🟪 at the right edge only while switched on and the chat is in sight; its row runs on the reply on screen; 🔢 opens − + 1~3 − +', async () => {
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } }), errors = [];
    page.setDefaultTimeout(8000); page.on('pageerror', e => errors.push(e.message));
    await page.route('https://risu.test/', r => r.fulfill({ contentType: 'text/html', body: '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"></body></html>' }));
    await page.goto('https://risu.test/');
    await page.addScriptTag({ content: readFileSync('node_modules/dompurify/dist/purify.min.js', 'utf8') });
    await page.evaluate(() => {
      window.messageCalls = []; window.countCalls = []; window.counts = { min: 1, max: 3 }; window.blocked = false; window.streamingNow = false;
      class Safe {
        constructor(n) { this.node = n; }
        release() {}
        async querySelector(s) { const n = this.node.querySelector(s); return n ? new Safe(n) : null; }
        async querySelectorAll(s) { return [...this.node.querySelectorAll(s)].map(n => new Safe(n)); }
        async setAttribute(k, v) { if (!k.startsWith('x-')) throw Error('Forbidden attribute write ' + k); this.node.setAttribute(k, v); }
        async getAttribute(k) { if (!k.startsWith('x-')) throw Error('Forbidden attribute read ' + k); return this.node.getAttribute(k); }
        async setTextContent(v) { this.node.textContent = v; }
        async getOuterHTML() { return this.node.outerHTML; }
        async setInnerHTML(v) { this.node.innerHTML = DOMPurify.sanitize(v); }
        async setStyleAttribute(v) { this.node.style.cssText = v; }
        async appendChild(child) { this.node.append(child.node); }
        async remove() { this.node.remove(); }
        async getBoundingClientRect() { return this.node.getBoundingClientRect().toJSON(); }
        async addEventListener(type, fn) { const cb = e => fn({ clientX: e.clientX, clientY: e.clientY }); document.addEventListener(type, cb); return String(Math.random()); }
        async removeEventListener() {}
        async createElement(tag) { return new Safe(document.createElement(tag)); }
      }
      const messages = [];
      for (let r = 0; r < 4; r++) { messages.push({ role: 'user', chatId: `u${r}`, data: '계속해.' }); messages.push({ role: 'char', chatId: `r${r}`, data: `하린: "답장 ${r}"` }); }
      const bot = { chaId: 'bot', name: 'Bot', chats: [{ id: 'chat', message: messages }], chatPage: 0 };
      const row = (m, i) => `<div class="chat-message-container"><div class="risu-chat" data-chat-index="${i}" style="height:${m.role === 'char' ? 420 : 60}px"><div class="chattext"><p>${m.data}</p></div></div></div>`;
      document.body.innerHTML = `<div class="default-chat-screen" style="position:absolute;left:0;top:0;width:100%;height:100vh;overflow:auto;display:flex;flex-direction:column-reverse"><div style="height:90px;flex:none">입력창</div><div class="flex-col-reverse" style="display:flex;flex-direction:column-reverse;flex:none">${messages.map(row).reverse().join('')}</div></div>`;
      const saved = new Map(), local = new Map();
      window.risuai = { pluginStorage: { getItem: async k => saved.get(k), setItem: async (k, v) => saved.set(k, v) }, getLocalPluginStorage: async () => ({ getItem: async k => local.get(k), setItem: async (k, v) => local.set(k, v), removeItem: async k => local.delete(k) }),
        getDatabase: async () => ({ characters: [structuredClone(bot)], modules: [], enabledModules: [] }), getCurrentCharacterIndex: async () => 0, getCurrentChatIndex: async () => 0,
        getCharacterFromIndex: async () => structuredClone(bot), getCharacter: async () => structuredClone(bot), getRootDocument: async () => new Safe(document) };
      // The frozen UI's side, as the vendor patches answer: the screen's state, the chat's buttons, its counts.
      window.__OMNI_TTS_HOST_BLOCKED__ = () => window.blocked;
      window.__OMNI_REPLY_STREAMING__ = () => window.streamingNow;
      window.__OMNI_MESSAGE_ACTION__ = async (...args) => { window.messageCalls.push(args); return true; };
      window.__OMNI_IMAGE_COUNTS__ = async kind => {
        window.countCalls.push(kind ?? null);
        const c = window.counts;
        if (kind === 'max-up') c.max++; else if (kind === 'min-up' && c.min < c.max) c.min++; else if (kind === 'min-down' && c.min > 1) c.min--; else if (kind === 'max-down' && c.max > c.min) c.max--;
        return { ...c };
      };
    });
    await page.evaluate(() => { window.crypto.randomUUID = undefined; });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(() => window.installTagFloat());
    const bar = () => page.evaluate(() => { const n = document.querySelector('[x-omni-tagfloat]'); return n ? getComputedStyle(n).display : 'absent'; });
    const shown = sel => page.waitForFunction(s => { const n = document.querySelector(`[x-omni-tagfloat] ${s}`); return !!n && getComputedStyle(n).display !== 'none'; }, sel);
    const hidden = sel => page.waitForFunction(s => { const n = document.querySelector(`[x-omni-tagfloat] ${s}`); return !n || getComputedStyle(n).display === 'none'; }, sel);
    const tap = async sel => { const b = await page.locator(`[x-omni-tagfloat] ${sel}`).boundingBox(); await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); };
    const note = () => page.evaluate(() => document.querySelector('[x-omni-tagfloat] [data-tf-note]')?.textContent || '');

    // Off (the default): nothing of it in Risu's page.
    await page.waitForTimeout(1300);
    assert.equal(await bar(), 'absent');
    // Switched on: 🟪 alone at the right edge.
    await page.evaluate(() => { window.getConfig().card.floating_tag_bar = true; });
    await page.waitForFunction(() => { const n = document.querySelector('[x-omni-tagfloat]'); return n && getComputedStyle(n).display !== 'none'; });
    const handle = await page.locator('[x-omni-tagfloat] [data-tf-act="toggle"]').boundingBox();
    assert.equal(await page.locator('[x-omni-tagfloat] [data-tf-act="toggle"]').textContent(), '🟪');
    const [edge, ...edgeSide] = await page.evaluate(() => { const s = getComputedStyle(document.querySelector('[x-omni-tagfloat] [data-tf-act="toggle"]')); return [document.documentElement.clientWidth, s.borderRightWidth, s.borderTopRightRadius, s.borderBottomRightRadius]; });
    assert.ok(Math.abs(handle.x + handle.width - edge) < 1, 'flush against the right edge, as 옴니 뷰어\'s 태그 is against its left');
    assert.deepEqual(edgeSide, ['0px', '0px', '0px'], 'no border or rounding on the edge\'s side');    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('[x-omni-tagfloat] [data-tf-row]')).display), 'none', 'folded at first');
    // A press on it is no press on the chat beneath; a press beside it is.
    await page.waitForTimeout(1100);
    assert.equal(await page.evaluate(([x, y]) => window.__OMNI_VIEWER_COVERS__(x, y), [handle.x + 5, handle.y + 5]), true);
    assert.equal(await page.evaluate(([x, y]) => window.__OMNI_VIEWER_COVERS__(x, y), [40, handle.y + 5]), false);

    // Out: the chat's seven, in its order, beside it and within the screen.
    await tap('[data-tf-act="toggle"]');
    await shown('[data-tf-row]');
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('[x-omni-tagfloat] [data-tf-row] button')].map(b => b.textContent)), ['⚛️', '🔃', '👨‍👩‍👧‍👦', '🟥', '📚', '✒️', '🔢']);
    const row = await page.locator('[x-omni-tagfloat] [data-tf-row]').boundingBox();
    assert.ok(row.x >= 0 && row.x + row.width <= handle.x, 'beside 🟪, inside the screen');
    // At the chat's bottom: ⚛️ on the newest reply (#8), and the row goes back.
    await tap('[data-tf-act="tag"]');
    await page.waitForFunction(() => window.messageCalls.length === 1);
    assert.deepEqual(await page.evaluate(() => window.messageCalls), [['tag', 7]]);
    await hidden('[data-tf-row]');
    await page.waitForFunction(() => /태그 생성을 시작했어요 · #8/.test(document.querySelector('[x-omni-tagfloat] [data-tf-note]')?.textContent || ''));
    // Scrolled up: the reply in the middle of the screen.
    await page.evaluate(() => { document.querySelector('.default-chat-screen').scrollTop = -980; });
    const middle = await page.evaluate(() => {
      const y = (innerHeight - 90) / 2;
      const hit = [...document.querySelectorAll('.risu-chat')].find(n => { const r = n.getBoundingClientRect(); return r.top <= y && r.bottom >= y; });
      return Number(hit?.getAttribute('data-chat-index'));
    });
    assert.ok(middle >= 0 && middle < 7, 'an older message is in the middle');
    const expected = middle % 2 === 1 ? middle : middle + 1;
    await tap('[data-tf-act="toggle"]');
    await shown('[data-tf-row]');
    await tap('[data-tf-act="regen"]');
    await page.waitForFunction(() => window.messageCalls.length === 2);
    assert.deepEqual((await page.evaluate(() => window.messageCalls))[1], ['regen', expected], 'the reply in the middle (a message of the reader\'s: the reply after it)');

    // 🔢: the counts row under it, − + 1~3 − +, the row kept out; a step is the chat's own.
    await tap('[data-tf-act="toggle"]');
    await shown('[data-tf-row]');
    await tap('[data-tf-act="counts"]');
    await shown('[data-tf-counts]');
    await page.waitForFunction(() => document.querySelector('[x-omni-tagfloat] [data-tf-range]')?.textContent === '1~3');
    assert.deepEqual(await page.evaluate(() => [...document.querySelector('[x-omni-tagfloat] [data-tf-counts]').children].map(n => n.textContent)), ['−', '+', '1~3', '−', '+']);
    const counts = await page.locator('[x-omni-tagfloat] [data-tf-counts]').boundingBox(), out = await page.locator('[x-omni-tagfloat] [data-tf-bar]').boundingBox();
    assert.ok(counts.y >= out.y + out.height, 'on the line under it');
    assert.ok(Math.abs(counts.x + counts.width - edge) < 1, 'against the edge too');    await tap('[data-tf-act="max-up"]');
    await page.waitForFunction(() => document.querySelector('[x-omni-tagfloat] [data-tf-range]')?.textContent === '1~4');
    await tap('[data-tf-act="min-down"]');
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => document.querySelector('[x-omni-tagfloat] [data-tf-range]')?.textContent), '1~4', 'never under one');
    assert.deepEqual(await page.evaluate(() => window.countCalls), [null, 'max-up', 'min-down']);
    assert.equal(await page.evaluate(() => window.messageCalls.length), 2, '🔢 is no message action');
    // A tap off it puts it all away, and is still the chat's.
    await page.mouse.click(60, 300);
    await hidden('[data-tf-row]');
    await hidden('[data-tf-counts]');

    // While a reply arrives, ⚛️ waits for it.
    await page.evaluate(() => { window.streamingNow = true; });
    await tap('[data-tf-act="toggle"]');
    await shown('[data-tf-row]');
    await tap('[data-tf-act="tag"]');
    await page.waitForFunction(() => /답장을 다 받은 뒤에/.test(document.querySelector('[x-omni-tagfloat] [data-tf-note]')?.textContent || ''));
    assert.equal(await page.evaluate(() => window.messageCalls.length), 2);
    await page.evaluate(() => { window.streamingNow = false; });

    // The settings window (the frozen UI's block) or 옴니 뷰어 over the chat: out of sight, and covering nothing.
    await page.evaluate(() => { window.blocked = true; });
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[x-omni-tagfloat]')).display === 'none');
    assert.equal(await page.evaluate(([x, y]) => window.__OMNI_VIEWER_COVERS__(x, y), [handle.x + 5, handle.y + 5]), false);
    await page.evaluate(() => { window.blocked = false; });
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[x-omni-tagfloat]')).display !== 'none');
    await page.evaluate(() => window.setViewerCovering(true));
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[x-omni-tagfloat]')).display === 'none');
    await page.evaluate(() => window.setViewerCovering(false));
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[x-omni-tagfloat]')).display !== 'none');
    // No chat screen (Risu's other pages): out of sight.
    await page.evaluate(() => { const s = document.querySelector('.default-chat-screen'); window.chatScreen = s; s.remove(); });
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[x-omni-tagfloat]')).display === 'none', null, { timeout: 4000 });
    await page.evaluate(() => document.body.prepend(window.chatScreen));
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[x-omni-tagfloat]')).display !== 'none', null, { timeout: 4000 });

    // Switched off: gone from the page.
    await page.evaluate(() => { window.getConfig().card.floating_tag_bar = false; });
    await page.waitForFunction(() => !document.querySelector('[x-omni-tagfloat],[x-omni-tagfloat-style]'));
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
