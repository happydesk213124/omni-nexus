import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
// 40 × 60: a portrait illustration, so the folded picture is narrower than its box.
const TALL = 'iVBORw0KGgoAAAANSUhEUgAAACgAAAA8CAIAAACb22+3AAAAOElEQVR4nO3NQQkAAAgEsMtpEiMayxgiDPZfputExGKxWCwWi8VisVgsFovFYrFYLBaLxWLxp3gBypUEov8J6RgAAAAASUVORK5CYII=';
const built = await build({ stdin: { contents: "import {installOmniViewer} from './src/viewer/omni-viewer';import {loadTtsData,ttsData} from './src/storage/tts-store';import {loadEmotionData,emotionData} from './src/storage/emotion-store';Object.assign(window,{installOmniViewer,loadTtsData,ttsData,loadEmotionData,emotionData});", resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife' });

// The newest reply: a picture whose file name carries two cast ids (the roster names one of them), and a pink slot.
const reply = ['하린: "그림 보여 줄게."', '[[@inray::card1::inxshot_abc.c1a2b-3c4d.webp]]', '하린: "어때?"', '[[@inraywait::w1::832::1216]]', '하린: "다음 장도 있어."'].join('\n');

/** A chat the viewer opens on its newest reply, drawn as Risu draws it, with Omni's own window answering as a stand-in. */
async function viewerPage(browser, { width = 420, height = 860, mobile = false } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, ...(mobile ? { isMobile: true, hasTouch: true } : {}) });
  const page = await context.newPage(), errors = [];
  page.setDefaultTimeout(8000); page.on('pageerror', e => errors.push(e.message));
  // Risu's page is laid out at the device's width (a phone's page without this is 980 px wide).
  await page.route('https://vn.test/', r => r.fulfill({ contentType: 'text/html', body: '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"></body></html>' })); await page.goto('https://vn.test/');
  await page.addScriptTag({ content: readFileSync('node_modules/dompurify/dist/purify.min.js', 'utf8') });
  await page.evaluate(({ png, tall, reply }) => {
    window.buttons = {}; window.shotCalls = []; window.messageCalls = [];
    const node = n => n === document ? document.documentElement : n;
    class Safe {
      constructor(n) { this.node = n; }
      release() {}
      async querySelector(s) { const n = this.node.querySelector(s); return n ? new Safe(n) : null; }
      async querySelectorAll(s) { return [...this.node.querySelectorAll(s)].map(n => new Safe(n)); }
      async setAttribute(k, v) { if (!k.startsWith('x-')) throw Error('Forbidden attribute write ' + k); this.node.setAttribute(k, v); }
      async getAttribute(k) { if (!k.startsWith('x-')) throw Error('Forbidden attribute read ' + k); return this.node.getAttribute(k); }
      async setTextContent(v) { this.node.textContent = v; }
      async getOuterHTML() { return this.node.outerHTML; }
      async innerText() { return this.node.innerText; }
      async scrollIntoView(o) { node(this.node).scrollIntoView(o); }
      async setInnerHTML(v) { this.node.innerHTML = DOMPurify.sanitize(v); }
      async setStyleAttribute(v) { this.node.style.cssText = v; }
      async appendChild(child) { this.node.append(child.node); }
      async remove() { this.node.remove(); }
      async cloneNode(deep) { return new Safe(this.node.cloneNode(deep)); }
      async getBoundingClientRect() { return node(this.node).getBoundingClientRect().toJSON(); }
      async addEventListener(type, fn) { const cb = e => fn({ clientX: e.clientX, clientY: e.clientY, key: e.key, repeat: e.repeat }); document.addEventListener(type, cb); return String(Math.random()); }
      async removeEventListener() {}
      async createElement(tag) { return new Safe(document.createElement(tag)); }
    }
    const roster = { comment: 'omni.nexus.data.global', key: '', alwaysActive: false, mode: 'normal', content: JSON.stringify({ version: 1, characterId: 'bot', roster: [{ id: 'c-haku', name: '하쿠키', cast_id: '1a2b' }] }) };
    const messages = [{ role: 'user', chatId: 'u0', data: '시작하자.' }, { role: 'char', chatId: 'r0', data: '하린: "옛 답장이야."' }, { role: 'user', chatId: 'u1', data: '보여 줘.' }, { role: 'char', chatId: 'r1', data: reply }];
    const bot = { chaId: 'bot', name: 'Bot', globalLore: [roster], additionalAssets: [['하린_neutral', 'assets/h.png', 'png']], chats: [{ id: 'chat', message: messages }], chatPage: 0 };
    window.bot = bot;
    const line = l => /^\[\[@inray::/.test(l) ? `<div data-inray-asset="${/^\[\[@inray::[^:]+::([^:\]]+)/.exec(l)[1]}"><img src="data:image/png;base64,${tall}"></div>`
      : /^\[\[@inraywait::/.test(l) ? `<div data-inray-wait="${/^\[\[@inraywait::([^:]+)/.exec(l)[1]}" style="width:60px;height:90px"></div>` : `<p>${l}</p>`;
    const row = (m, i) => `<div class="chat-message-container"><div class="risu-chat" data-chat-index="${i}"><div class="chattext">${m.data.split('\n').map(line).join('')}</div></div></div>`;
    document.body.innerHTML = `<div class="default-chat-screen" style="position:absolute;left:0;top:0;width:100%;height:100vh;overflow:auto;display:flex;flex-direction:column-reverse"><div style="height:90px;flex:none"><textarea id="risu-input"></textarea></div><div class="flex-col-reverse" style="display:flex;flex-direction:column-reverse;flex:none"></div></div>`;
    document.querySelector('.flex-col-reverse').innerHTML = bot.chats[0].message.map(row).reverse().join('');
    const saved = new Map(), local = new Map(), bytes = Uint8Array.from(atob(png), c => c.charCodeAt(0));
    window.risuai = { pluginStorage: { getItem: async k => saved.get(k), setItem: async (k, v) => saved.set(k, v) }, getLocalPluginStorage: async () => ({ getItem: async k => local.get(k), setItem: async (k, v) => local.set(k, v), removeItem: async k => local.delete(k) }),
      getDatabase: async () => ({ characters: [structuredClone(bot)], modules: [], enabledModules: [] }), getCurrentCharacterIndex: async () => 0, getCurrentChatIndex: async () => 0,
      getCharacterFromIndex: async () => structuredClone(bot), getCharacter: async () => structuredClone(bot),
      // Risu says the chat still streams: a pink slot of its last reply is not made then (inline-waits.ts).
      getChatFromIndex: async () => ({ ...structuredClone(bot.chats[0]), isStreaming: true }), setChatToIndex: async () => {},
      readImage: async () => bytes, getRootDocument: async () => new Safe(document), registerButton: async (arg, fn) => { window.buttons[arg.id] = fn; return { id: arg.id }; },
      addRisuChatListener: async () => {} };
    // Omni's own window, as the vendor patches answer the viewer: true once done.
    window.__OMNI_SHOT_ACTION__ = async (...args) => { window.shotCalls.push(args); return true; };
    window.__OMNI_SHOT_TAGS_OPEN__ = () => true;
    window.__OMNI_MESSAGE_ACTION__ = async (...args) => { window.messageCalls.push(args); return true; };
    // The chat's counts (message-runtime.js): a step by its rule, the counts read back.
    window.countCalls = []; window.counts = { min: 1, max: 3 };
    window.__OMNI_IMAGE_COUNTS__ = async kind => {
      window.countCalls.push(kind ?? null);
      const c = window.counts;
      if (kind === 'max-up') c.max++; else if (kind === 'min-up' && c.min < c.max) c.min++; else if (kind === 'min-down' && c.min > 1) c.min--; else if (kind === 'max-down' && c.max > c.min) c.max--;
      return { ...c };
    };
  }, { png: PNG, tall: TALL, reply });
  await page.evaluate(() => { window.crypto.randomUUID = undefined; });
  await page.addScriptTag({ content: built.outputFiles[0].text });
  await page.evaluate(async () => {
    await window.loadTtsData(); const d = window.ttsData(); d.settings.enabled = false;
    d.characters.push({ id: 't-harin', scope: 'global', name: '하린', surname: '', givenName: '하린', surnameAliases: [], givenAliases: [], triggers: [], tags: [], gender: 'female', voiceKey: '', fishId: '', fixed: false, gain: 0 });
    await window.loadEmotionData(); window.emotionData().settings.autoGenerate = false;
    await window.installOmniViewer();
    await window.buttons['omni-viewer-chat']();
  });
  await page.waitForFunction(() => /그림 보여 줄게/.test(document.querySelector('[x-omni-vn] [data-vn-text]')?.textContent || ''));
  const box = selector => page.locator(`[x-omni-vn] ${selector}`).boundingBox();
  const tap = async selector => { const b = await box(selector); await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); };
  const style = (selector, prop, pseudo = null) => page.evaluate(([s, p, x]) => { const n = document.querySelector(`[x-omni-vn] ${s}`); return n ? getComputedStyle(n, x)[p] : ''; }, [selector, prop, pseudo]);
  const shown = selector => page.waitForFunction(s => { const n = document.querySelector(`[x-omni-vn] ${s}`); return !!n && getComputedStyle(n).display !== 'none'; }, selector);
  const text = () => page.evaluate(() => document.querySelector('[x-omni-vn] [data-vn-text]')?.textContent || '');
  const note = () => page.evaluate(() => { const n = document.querySelector('[x-omni-vn] [data-vn-note]'); return getComputedStyle(n).display === 'none' ? '' : getComputedStyle(n, '::after').content; });
  // 태그's row: pressed, slid all the way out, and its buttons read where they ended up.
  const tagsOut = async () => {
    await tap('[data-vn-act="tags"]');
    await page.waitForFunction(() => document.querySelector('[x-omni-vn] [data-vn-tagbar]').getBoundingClientRect().left >= -1);
    await page.waitForTimeout(450);
  };
  return { page, errors, box, tap, style, shown, text, note, tagsOut, close: () => context.close() };
}
const launch = () => chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });

test('옴니 뷰어 · 배속 in the bottom menu, as the floating TTS viewer\'s: its list over the menu, a speed picked is the voice\'s', async () => {
  const browser = await launch();
  try {
    const { page, errors, tap, style, shown, text } = await viewerPage(browser);
    assert.equal(await style('[data-vn-act="rate"]', 'content', '::after'), '"1×"');
    await tap('[data-vn-act="rate"]');
    await shown('[data-vn-rates]');
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('[x-omni-vn] [data-vn-rates] button')].map(b => b.textContent + (b.hasAttribute('data-on') ? '*' : ''))),
      ['0.5×', '0.75×', '1×*', '1.25×', '1.5×', '1.75×', '2×', '2.5×', '3×', '3.5×']);
    const fast = await page.locator('[x-omni-vn] [data-vn-rates] button', { hasText: /^1\.5×$/ }).boundingBox();
    await page.mouse.click(fast.x + fast.width / 2, fast.y + fast.height / 2);
    await page.waitForFunction(() => window.ttsData().settings.rate === 1.5);
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[x-omni-vn] [data-vn-rates]')).display === 'none');
    assert.equal(await style('[data-vn-act="rate"]', 'content', '::after'), '"1.5×"');
    // Open again, and a tap off it: put away, and that tap is only that (the line stays).
    await tap('[data-vn-act="rate"]');
    await shown('[data-vn-rates]');
    await page.mouse.click(210, 300);
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[x-omni-vn] [data-vn-rates]')).display === 'none');
    await page.waitForTimeout(300);
    assert.match(await text(), /그림 보여 줄게/);
    assert.equal(await page.evaluate(() => window.ttsData().settings.rate), 1.5);
    // Over a big picture the list lies on its bar: a speed there is the list's, never the bar button under it.
    await page.keyboard.press('ArrowRight');
    await shown('[data-vn-cgbar] [data-vn-act="cgfull"]');
    await page.waitForTimeout(300);
    await tap('[data-vn-act="rate"]');
    await shown('[data-vn-rates]');
    const over = await page.evaluate(() => {
      const bar = [...document.querySelectorAll('[x-omni-vn] [data-vn-cgbar] button')].map(b => b.getBoundingClientRect());
      for (const b of document.querySelectorAll('[x-omni-vn] [data-vn-rates] button')) {
        const r = b.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
        if (bar.some(q => x >= q.left && x <= q.right && y >= q.top && y <= q.bottom)) return { x, y, rate: Number.parseFloat(b.textContent) };
      }
      return null;
    });
    assert.ok(over, 'a speed lies on the bar here');
    await page.mouse.click(over.x, over.y);
    await page.waitForFunction(rate => window.ttsData().settings.rate === rate, over.rate);
    await page.waitForTimeout(300);
    assert.deepEqual(await page.evaluate(() => window.shotCalls), [], 'no bar button under it pressed');
    assert.notEqual(await style('[data-vn-cgbar] [data-vn-act="cgfull"]', 'display'), 'none', 'the picture still big');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('옴니 뷰어 · 태그 under 메시지 slides out the message\'s own controls, each run on the reply on stage; 전체 생성 makes its pink slots', async () => {
  const browser = await launch();
  try {
    const { page, errors, box, tap, style, text, note, tagsOut } = await viewerPage(browser);
    const out = async () => (await box('[data-vn-tagbar]')).x >= -1;
    assert.equal(await out(), false, 'tucked away at first');
    await tagsOut();
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('[x-omni-vn] [data-vn-tagbar] > button')].map(b => b.textContent)), ['⚛️', '🔃', '👨‍👩‍👧‍👦', '🟥', '📚', '✒️', '🔢']);
    assert.equal(await style('[data-vn-counts]', 'display'), 'none', 'its 🔢 line only once 🔢 is pressed');
    assert.equal(await style('[data-vn-act="tags"]', 'opacity'), '0', 'its tab lies under it');
    await tap('[data-vn-tagbar] [data-vn-act="mtag"]');
    await page.waitForFunction(() => window.messageCalls.length === 1);
    assert.deepEqual(await page.evaluate(() => window.messageCalls), [['tag', 3]], '⚛️ on the reply on stage (its place in the chat)');
    await page.waitForFunction(() => /태그 생성을 시작했어요/.test(getComputedStyle(document.querySelector('[x-omni-vn] [data-vn-note]'), '::after').content));
    await page.waitForTimeout(400);
    assert.equal(await out(), false, 'pressed, it goes back');
    // Out again: a tap off it puts it away, and steps nowhere.
    await tagsOut();
    await page.mouse.click(300, 250);
    await page.waitForTimeout(450);
    assert.equal(await out(), false);
    assert.match(await text(), /그림 보여 줄게/);
    // 🟥 goes whatever the reply: a stop.
    await tagsOut();
    await tap('[data-vn-tagbar] [data-vn-act="mstop"]');
    await page.waitForFunction(() => window.messageCalls.length === 2);
    assert.deepEqual((await page.evaluate(() => window.messageCalls))[1], ['stop', 3]);
    // The reply has a pink slot and is not streaming: 전체 생성 is in the top bar, and makes it as a held press would.
    // (Risu still says the chat streams here, so the run stops there and says why.)
    assert.notEqual(await style('[data-vn-act="pink"]', 'display'), 'none');
    await tap('[data-vn-act="pink"]');
    await page.waitForFunction(() => /분홍 칸 만들기 멈춤 · 답변이 끝난 뒤/.test(getComputedStyle(document.querySelector('[x-omni-vn] [data-vn-note]'), '::after').content));
    assert.match(await note(), /답변이 끝난 뒤 다시 눌러 주세요/);
    // The reply before has none: no 전체 생성 there.
    await page.keyboard.press('ArrowLeft');
    await page.waitForFunction(() => /옛 답장이야/.test(document.querySelector('[x-omni-vn] [data-vn-text]')?.textContent || ''));
    assert.equal(await style('[data-vn-act="pink"]', 'display'), 'none');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('옴니 뷰어 · 태그\'s 🔢 opens − + 1~3 − + under its row (no settings window), steps the chat\'s own counts, and goes with the row', async () => {
  for (const viewport of [{}, { width: 360, height: 740, mobile: true }]) {
    const browser = await launch();
    try {
      const { page, errors, box, tap, style, tagsOut } = await viewerPage(browser, viewport);
      const range = () => style('[data-vn-range]', 'content', '::after');
      await tagsOut();
      assert.equal(await style('[data-vn-counts]', 'display'), 'none', 'not until 🔢');
      const before = await box('[data-vn-tagbar]');
      await tap('[data-vn-tagbar] [data-vn-act="mcounts"]');
      await page.waitForFunction(() => getComputedStyle(document.querySelector('[x-omni-vn] [data-vn-counts]')).display !== 'none');
      assert.equal(await range(), '"1~3"');
      assert.deepEqual(await page.evaluate(() => window.messageCalls), [], 'no window opened for it');
      const bar = await box('[data-vn-tagbar]'), counts = await box('[data-vn-counts]'), frame = await box('');
      const buttons = await page.evaluate(() => [...document.querySelectorAll('[x-omni-vn] [data-vn-tagbar] > button')].map(b => b.getBoundingClientRect().toJSON()));
      assert.equal(new Set(buttons.map(r => Math.round(r.top))).size, 1, 'the seven in one line');
      // A drawer of its own, as the floating 태그's: a line inside the row made the row twice as tall, mostly gap.
      assert.ok(Math.abs(bar.height - before.height) < 1 && Math.abs(bar.width - before.width) < 1, 'the row keeps its size');
      assert.ok(counts.y >= bar.y + bar.height && counts.y <= bar.y + bar.height + 10, 'just under the row');
      assert.ok(Math.abs(counts.x - bar.x) < 1 && counts.width < bar.width, 'against the row\'s edge, as wide as its five');
      assert.ok(counts.x + counts.width <= frame.x + frame.width && counts.y + counts.height <= frame.y + frame.height, 'inside the frame');
      assert.ok(bar.x >= -1, '태그\'s row stays out');      await tap('[data-vn-counts] [data-vn-act="cmaxup"]');
      await page.waitForFunction(() => getComputedStyle(document.querySelector('[x-omni-vn] [data-vn-range]'), '::after').content === '"1~4"');
      await tap('[data-vn-counts] [data-vn-act="cminup"]');
      await page.waitForFunction(() => getComputedStyle(document.querySelector('[x-omni-vn] [data-vn-range]'), '::after').content === '"2~4"');
      assert.deepEqual(await page.evaluate(() => window.countCalls), [null, 'max-up', 'min-up']);
      assert.ok((await box('[data-vn-tagbar]')).x >= -1, 'a step keeps both out');
      // 🔢 again: only its row goes.
      await tap('[data-vn-tagbar] [data-vn-act="mcounts"]');
      await page.waitForFunction(() => getComputedStyle(document.querySelector('[x-omni-vn] [data-vn-counts]')).display === 'none');
      assert.ok((await box('[data-vn-tagbar]')).x >= -1);
      // Open again, then a tap off: both away, and its buttons take no tap where they were.
      await tap('[data-vn-tagbar] [data-vn-act="mcounts"]');
      await page.waitForFunction(() => getComputedStyle(document.querySelector('[x-omni-vn] [data-vn-counts]')).display !== 'none');
      const where = await box('[data-vn-counts] [data-vn-act="cmaxup"]');
      await page.mouse.click(300, 250);
      await page.waitForFunction(() => getComputedStyle(document.querySelector('[x-omni-vn] [data-vn-counts]')).display === 'none');
      await page.waitForTimeout(450);
      const calls = (await page.evaluate(() => window.countCalls)).length;
      await page.mouse.click(where.x + where.width / 2, where.y + where.height / 2);
      await page.waitForTimeout(300);
      assert.equal((await page.evaluate(() => window.countCalls)).length, calls, 'hidden, its + is pressed by nobody');
      assert.deepEqual(errors, []);
    } finally { await browser.close(); }
  }
});

test('옴니 뷰어 · a picture shown big has its cast chips (c1·하쿠키), each that person\'s tags; folded, its + is inside it at the bottom-left and shows under the mouse', async () => {
  const browser = await launch();
  try {
    const { page, errors, box, tap, style, shown } = await viewerPage(browser);
    await page.keyboard.press('ArrowRight');
    await shown('[data-vn-cgbar] [data-vn-act="cgfull"]');
    await shown('[data-vn-act="cgc1"]');
    assert.equal(await style('[data-vn-act="cgc1"]', 'content', '::after'), '"c1·하쿠키"');
    assert.equal(await style('[data-vn-act="cgc2"]', 'content', '::after'), '"c2"', 'a cast id the roster does not name: its place alone');
    assert.equal(await style('[data-vn-act="cgc3"]', 'display'), 'none');
    const chips = await box('[data-vn-cgchips]'), bar = await box('[data-vn-cgbar]');
    assert.ok(chips.y + chips.height <= bar.y, 'over the bar');
    await page.waitForTimeout(200);
    await tap('[data-vn-act="cgc1"]');
    await page.waitForFunction(() => window.shotCalls.length === 1);
    assert.deepEqual(await page.evaluate(() => window.shotCalls), [['char', 'card1', { index: 0, name: '하쿠키' }]]);
    await tap('[data-vn-act="cgc2"]');
    await page.waitForFunction(() => window.shotCalls.length === 2);
    assert.deepEqual((await page.evaluate(() => window.shotCalls))[1], ['base', 'card1'], 'no name to open: the picture\'s own tags, as 크게보기 does');

    // On past it: it folds, and its + stands inside it, at its bottom-left corner, 4 px in.
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => /어때/.test(document.querySelector('[x-omni-vn] [data-vn-text]')?.textContent || ''));
    await shown('[data-vn-act="zoom"]');
    assert.equal(await style('[data-vn-act="cgc1"]', 'display'), 'none', 'folded: no chips');
    const corner = async () => {
      const [img, plus] = await page.evaluate(() => [document.querySelector('[x-omni-vn] img[x-vn-cg]:not([style*="display: none"])'), document.querySelector('[x-omni-vn] [data-vn-act="zoom"]')].map(n => n.getBoundingClientRect().toJSON()));
      return { dx: Math.round(plus.left - img.left), dy: Math.round(img.bottom - plus.bottom), inside: plus.right <= img.right && plus.top >= img.top, img };
    };
    const folded = await corner();
    assert.ok(Math.abs(folded.dx - 4) <= 1 && Math.abs(folded.dy - 4) <= 1 && folded.inside, JSON.stringify(folded));
    // A mouse screen: hidden until the pointer is over the picture.
    await page.mouse.move(5, 500);
    await page.waitForTimeout(250);
    assert.equal(await style('[data-vn-act="zoom"]', 'opacity'), '0');
    await page.mouse.move(folded.img.x + folded.img.width / 2, folded.img.y + folded.img.height / 3);
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[x-omni-vn] [data-vn-act="zoom"]')).opacity === '1');
    // Bigger: the + goes with the picture's new corner.
    await tap('[data-vn-act="zoom"]');
    await page.waitForFunction(was => document.querySelector('[x-omni-vn] img[x-vn-cg]:not([style*="display: none"])').getBoundingClientRect().height > was + 20, folded.img.height);
    await page.waitForFunction(() => { const img = document.querySelector('[x-omni-vn] img[x-vn-cg]:not([style*="display: none"])').getBoundingClientRect(), plus = document.querySelector('[x-omni-vn] [data-vn-act="zoom"]').getBoundingClientRect(); return Math.abs(img.bottom - plus.bottom - 4) <= 1 && Math.abs(plus.left - img.left - 4) <= 1; });
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('옴니 뷰어 on a 360 px phone: the bottom row fits 배속 beside the rest, the top bar keeps ✕ with 전체 생성 and the spinner, the + shows with no mouse', async () => {
  const browser = await launch();
  try {
    const { page, errors, box, style, shown, tagsOut } = await viewerPage(browser, { width: 360, height: 740, mobile: true });
    const frame = await box('');
    assert.equal(Math.round(frame.width), 360);
    const row = await page.evaluate(() => [...document.querySelectorAll('[x-omni-vn] [data-vn-menu] button')].filter(b => getComputedStyle(b).display !== 'none').map(b => b.getBoundingClientRect().toJSON()));
    assert.equal(row.length, 10);
    for (const [i, r] of row.entries()) {
      assert.ok(r.left >= frame.x - 0.5 && r.right <= frame.x + frame.width + 0.5, `menu button ${i} inside the frame: ${JSON.stringify(r)}`);
      if (i) assert.ok(r.left >= row[i - 1].right - 0.5, `menu buttons ${i - 1} and ${i} side by side`);
    }
    // Room to spare between 배속 and |◀ (its auto margin): a row out of room squeezes its buttons over their words instead.
    assert.ok(row[6].left - row[5].right > 0.5, `room left in the row: ${Math.round(row[6].left - row[5].right)} px`);
    // Busy and with pink slots at once, the widest the top bar gets.
    await page.evaluate(() => { document.querySelector('[x-omni-vn] [data-vn-busy]').style.display = 'block'; });
    assert.notEqual(await style('[data-vn-act="pink"]', 'display'), 'none');
    const shut = await box('[data-vn-act="close"]');
    assert.ok(shut.x + shut.width <= frame.x + frame.width - 4, `✕ whole: ${JSON.stringify(shut)} in ${JSON.stringify(frame)}`);
    // And none of them squeezed: only the clock gave way (out of room, the row narrows VOICE and AUTO over their words).
    assert.ok((await box('[data-vn-clock]')).width > 0, 'the clock still has room, so the buttons have theirs');
    // 태그's row stays inside the frame; a tap off it puts it away (its tab is under it then).
    await tagsOut();
    const bar = await box('[data-vn-tagbar]');
    assert.ok(bar.x >= frame.x - 1 && bar.x + bar.width <= frame.x + frame.width, JSON.stringify(bar));
    await page.mouse.click(250, 160);
    await page.waitForFunction(() => document.querySelector('[x-omni-vn] [data-vn-tagbar]').getBoundingClientRect().right <= 0);
    // No mouse to hover with: the folded picture's + is always shown.
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await shown('[data-vn-act="zoom"]');
    assert.equal(await style('[data-vn-act="zoom"]', 'opacity'), '1');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
