import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const built = await build({ stdin: { contents: "import {installOmniViewer} from './src/viewer/omni-viewer';import {loadTtsData,ttsData} from './src/storage/tts-store';import {loadEmotionData,emotionData} from './src/storage/emotion-store';import {messageBaked} from './src/services/bake-events';Object.assign(window,{installOmniViewer,loadTtsData,ttsData,loadEmotionData,emotionData,messageBaked});", resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife' });

/**
 * A chat whose newest reply the viewer opens on, drawn as Risu draws it: a reply's lines as paragraphs, a baked
 * picture as its asset's image, a picture block (still unbaked) not at all. The chat screen sits in the page's flow,
 * so a pushed page moves it, as Risu's does.
 */
async function viewerPage(browser) {
  const page = await browser.newPage({ viewport: { width: 420, height: 860 } }), errors = [];
  page.setDefaultTimeout(8000); page.on('pageerror', e => errors.push(e.message));
  await page.route('https://vn.test/', r => r.fulfill({ contentType: 'text/html', body: '<html><head></head><body style="margin:0"></body></html>' })); await page.goto('https://vn.test/');
  await page.addScriptTag({ content: readFileSync('node_modules/dompurify/dist/purify.min.js', 'utf8') });
  await page.evaluate(({ png }) => {
    window.buttons = {};
    // Risu's document object stands for its root element: where the page sits, and how it is scrolled back.
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
    const messages = [{ role: 'user', chatId: 'u0', data: '시작하자.' }, { role: 'char', chatId: 'r0', data: '하린: "옛 답장이야."' }];
    const bot = { chaId: 'bot', name: 'Bot', additionalAssets: [['하린_neutral', 'assets/h.png', 'png']], chats: [{ id: 'chat', message: messages }], chatPage: 0 };
    window.bot = bot;
    const line = l => /^\[\[@inray::[^:]+::([^:\]]+)/.test(l) ? `<div data-inray-asset="${/^\[\[@inray::[^:]+::([^:\]]+)/.exec(l)[1]}"><img src="data:image/png;base64,${png}"></div>` : /^\[\[inx/.test(l) ? '' : `<p>${l}</p>`;
    const row = (m, i) => `<div class="chat-message-container"><div class="risu-chat" data-chat-index="${i}"><div class="chattext">${m.data.split('\n').map(line).join('')}</div></div></div>`;
    window.renderChat = () => { document.querySelector('.flex-col-reverse').innerHTML = bot.chats[0].message.map(row).reverse().join(''); };
    document.body.innerHTML = `<div class="default-chat-screen" style="position:absolute;left:0;top:0;width:100%;height:100vh;overflow:auto;display:flex;flex-direction:column-reverse"><div style="height:90px;flex:none"><textarea id="risu-input"></textarea></div><div class="flex-col-reverse" style="display:flex;flex-direction:column-reverse;flex:none"></div></div>`;
    window.renderChat();
    const saved = new Map(), local = new Map(), bytes = Uint8Array.from(atob(png), c => c.charCodeAt(0));
    window.risuai = { pluginStorage: { getItem: async k => saved.get(k), setItem: async (k, v) => saved.set(k, v) }, getLocalPluginStorage: async () => ({ getItem: async k => local.get(k), setItem: async (k, v) => local.set(k, v), removeItem: async k => local.delete(k) }),
      getDatabase: async () => ({ characters: [structuredClone(bot)], modules: [], enabledModules: [] }), getCurrentCharacterIndex: async () => 0, getCurrentChatIndex: async () => 0,
      getCharacterFromIndex: async () => structuredClone(bot), getCharacter: async () => structuredClone(bot),
      readImage: async () => bytes, getRootDocument: async () => new Safe(document), registerButton: async (arg, fn) => { window.buttons[arg.id] = fn; return { id: arg.id }; },
      addRisuChatListener: async (mode, fn) => { if (mode === 'output') window.output = async arg => { await fn(arg); await window.__OMNI_CHAT_OUTPUT__?.settled(); }; } };
  }, { png: PNG });
  await page.evaluate(() => { window.crypto.randomUUID = undefined; });
  await page.addScriptTag({ content: built.outputFiles[0].text });
  await page.evaluate(async () => {
    await window.loadTtsData(); const d = window.ttsData(); d.settings.enabled = false;
    d.characters.push({ id: 't-harin', scope: 'global', name: '하린', surname: '', givenName: '하린', surnameAliases: [], givenAliases: [], triggers: [], tags: [], gender: 'female', voiceKey: '', fishId: '', fixed: false, gain: 0 });
    await window.loadEmotionData(); window.emotionData().settings.autoGenerate = false;
    await window.installOmniViewer();
    await window.buttons['omni-viewer-chat']();
  });
  await page.waitForFunction(() => /옛 답장이야/.test(document.querySelector('[x-omni-vn] [data-vn-text]')?.textContent || ''));
  const text = () => page.evaluate(() => document.querySelector('[x-omni-vn] [data-vn-text]')?.textContent || '');
  const shows = re => page.waitForFunction(source => new RegExp(source).test(document.querySelector('[x-omni-vn] [data-vn-text]')?.textContent || ''), re.source);
  const lineDone = () => page.waitForFunction(() => { const cue = document.querySelector('[x-omni-vn] [data-vn-next],[x-omni-vn] [data-vn-end]'); return !cue || getComputedStyle(cue).opacity !== '0'; });
  const tick = t => page.evaluate(t => window.__OMNI_STREAM_TICK__(t), t);
  return { page, errors, text, shows, lineDone, tick };
}

test('옴니 뷰어 over a restricted SafeDOM, a reply baked after its stream ends: read again once, its picture\'s 🎲 works without the viewer opened again', async () => {
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  try {
    const { page, errors, shows, tick } = await viewerPage(browser);
    await page.evaluate(() => { window.__OMNI_SHOT_ACTION__ = async () => true; });
    // The new reply streams with a picture block, and the picture is done before the reply: the chat paints it.
    const streamed = '하린: "첫 줄이야."\n[[inx1]]{"shot":1}[[/inx1]]\n하린: "그림 다음 줄이야."\n하린: "마지막 줄."\n';
    await tick(streamed);
    await shows(/첫 줄이야/);
    await page.evaluate(png => window.__OMNI_VIEWER_PREVIEW__({ messageIndex: 2, inlineSlot: 1, url: 'data:image/png;base64,' + png }), PNG);
    // Saved, and Risu says so: its picture is still the block (it is baked a moment later).
    await page.evaluate(t => { window.bot.chats[0].message.push({ role: 'char', chatId: 'r1', data: t.trim() }); window.renderChat(); window.output({ messageIndex: 2 }); }, streamed);
    const roll = () => page.evaluate(() => { const b = document.querySelector('[x-omni-vn] [data-vn-act="cgroll"]'); return getComputedStyle(b).display === 'none' ? 'hidden' : getComputedStyle(b).opacity; });
    for (let i = 0; i < 8 && await roll() === 'hidden'; i++) { await page.keyboard.press('ArrowRight'); await page.waitForTimeout(400); }
    assert.equal(await roll(), '0.35', 'on its picture, 🎲 waits: not saved yet');
    // Baked into it, and the bake says so: the reply is read again, and the picture is the chat's own.
    await page.evaluate(() => {
      const m = window.bot.chats[0].message[2];
      m.data = m.data.replace(/\[\[inx1\]\][^\n]*\[\[\/inx1\]\]/, '[[@inray::card1::inxshot_abc::832::1216]]');
      window.renderChat();
      window.messageBaked({ charIndex: 0, chatIndex: 0, messageIndex: 2 });
    });
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[x-omni-vn] [data-vn-act="cgroll"]')).opacity === '1');
    assert.equal(await roll(), '1', 'still on its picture, 🎲 ready');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('옴니 뷰어 over a restricted SafeDOM, a stream that pauses past 4 s and goes on: the same reply, read on from where it was', async () => {
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  try {
    const { page, errors, text, shows, lineDone, tick } = await viewerPage(browser);
    const part = '하린: "하나야."\n하린: "둘이야."\n하린: "셋이야."\n하린: "넷이야."\n';
    // Risu keeps the reply in the chat while it streams.
    await page.evaluate(t => { window.bot.chats[0].message.push({ role: 'char', chatId: 'r1', data: t.trim() }); window.renderChat(); }, part);
    await tick(part);
    await shows(/하나야/);
    for (const next of [/둘이야/, /셋이야/]) { await lineDone(); await page.keyboard.press('ArrowRight'); await shows(next); }
    // The writer pauses past four seconds: the viewer takes the reply as ended, for now.
    await page.waitForTimeout(5600);
    assert.match(await text(), /셋이야/);
    // It goes on: no new reply, the same one, and the line read stays.
    const more = part + '하린: "다섯이야."\n하린: "여섯이야."\n';
    await page.evaluate(t => { window.bot.chats[0].message[2].data = t.trim(); window.renderChat(); }, more);
    await tick(more);
    await page.waitForTimeout(1600);
    assert.match(await text(), /셋이야/, 'not back to its first line');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('옴니 뷰어 over a restricted SafeDOM, Risu\'s page pushed up under it: put back, but left alone while Risu\'s input takes typing', async () => {
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  try {
    const { page, errors } = await viewerPage(browser);
    await page.waitForTimeout(2200);
    const frameTop = () => page.evaluate(() => Math.round(document.querySelector('[x-omni-vn]').getBoundingClientRect().top));
    assert.equal(await frameTop(), 0);
    // As a scroll into view in a chat too short to scroll does it: the whole page, the chat screen with it.
    await page.evaluate(() => { document.body.style.height = '3000px'; window.scrollTo(0, 150); });
    assert.equal(await page.evaluate(() => window.scrollY), 150);
    await page.waitForFunction(() => window.scrollY === 0, null, { timeout: 5000 });
    await page.waitForTimeout(2300);
    assert.equal(await frameTop(), 0, 'the frame stays over the chat screen, not moved up with the page');
    // Typing in Risu's input: on a phone the keyboard moves the page on purpose.
    await page.evaluate(() => { document.getElementById('risu-input').focus({ preventScroll: true }); window.scrollTo(0, 150); });
    await page.waitForTimeout(2600);
    assert.equal(await page.evaluate(() => window.scrollY), 150, 'left alone while typing');
    await page.evaluate(() => document.getElementById('risu-input').blur());
    await page.waitForFunction(() => window.scrollY === 0, null, { timeout: 5000 });
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
// Without AUTO a line that comes while the reader is at the newest one is not gone to: 15/15 became 16/16 at once,
// before the 15th was read (the reader's report). They stay (15/16) and go on with a tap.
test('옴니 뷰어 over a restricted SafeDOM, AUTO off while a reply streams in: at the newest line, a line that comes is not gone to', async () => {
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  try {
    const { page, errors, text, shows, lineDone, tick } = await viewerPage(browser);
    const part = '하린: "하나야."\n하린: "둘이야."\n';
    await page.evaluate(t => { window.bot.chats[0].message.push({ role: 'char', chatId: 'r1', data: t.trim() }); window.renderChat(); }, part);
    await tick(part);
    await shows(/하나야/);
    await lineDone(); await page.keyboard.press('ArrowRight'); await shows(/둘이야/);
    const more = part + '하린: "셋이야."\n';
    await page.evaluate(t => { window.bot.chats[0].message[2].data = t.trim(); window.renderChat(); }, more);
    await tick(more);
    await page.waitForTimeout(1800);
    assert.match(await text(), /둘이야/, 'stays on the line being read');
    await lineDone(); await page.keyboard.press('ArrowRight'); await shows(/셋이야/);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

// AUTO while a reply streams in: each chunk brings a look a second, which draws the line on screen again. That look
// cleared AUTO's step to come and never set it again, so AUTO stood still while a reply streamed (the reader's report).
test('옴니 뷰어 over a restricted SafeDOM, AUTO while a reply streams in: it reads on as the lines come, waits at the newest, and reads the last once the reply ends', async () => {
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  try {
    const { page, errors, text, shows, tick } = await viewerPage(browser);
    await page.locator('[x-omni-vn] [data-vn-act="auto"]').click();
    await page.waitForTimeout(400);
    const settled = ['하나야', '둘이야', '셋이야', '넷이야'].map(word => `하린: "${word}."`).join('\n') + '\n';
    // Risu keeps the reply in the chat while it streams; its last line is still being written.
    await page.evaluate(t => { window.bot.chats[0].message.push({ role: 'char', chatId: 'r1', data: t }); window.renderChat(); }, settled + '하린: "다섯이');
    let flowing = true;
    const chunks = (async () => { for (let n = 0; flowing; n++) { await tick(settled + '하린: "다섯이' + '.'.repeat(n % 3)); await page.waitForTimeout(300); } })();
    await shows(/하나야/);
    // On by itself, through each line that has come, the chunks still coming.
    for (const word of ['둘이야', '셋이야', '넷이야']) await page.waitForFunction(w => (document.querySelector('[x-omni-vn] [data-vn-text]')?.textContent || '').includes(w), word, { timeout: 7000 });
    // At the newest line that has ended it waits (the one being written is no line yet).
    await page.waitForTimeout(2500);
    assert.match(await text(), /넷이야/);
    // The reply ends, saved with its last line, and Risu says so: AUTO reads it.
    flowing = false;
    await chunks;
    await page.evaluate(t => { window.bot.chats[0].message[2].data = t; window.renderChat(); window.output({ messageIndex: 2 }); }, settled + '하린: "다섯이야."');
    await shows(/다섯이야/);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

// The same look drew a picture again, and a picture's step started over each time: 2.6 s never passed at a look a
// second, so AUTO stood on it until the reply ended or the reader tapped (the reader's report). Left at the newest
// picture, the picture stays folded: the look opened it again.
test('옴니 뷰어 over a restricted SafeDOM, AUTO while a reply streams in: a picture is gone past in its time and stays folded, and the line after it is read on to', async () => {
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  try {
    const { page, errors, tick } = await viewerPage(browser);
    await page.locator('[x-omni-vn] [data-vn-act="auto"]').click();
    await page.waitForTimeout(400);
    let settled ='하린: "하나야."\n[[@inray::card1::inxshot_pic::832::1216]]\n', flowing = true;
    await page.evaluate(t => { window.bot.chats[0].message.push({ role: 'char', chatId: 'r1', data: t }); window.renderChat(); }, settled);
    const chunks = (async () => { for (let n = 0; flowing; n++) { await tick(settled + '.'.repeat(n % 3)); await page.waitForTimeout(300); } })();
    try {
      // This 1×1 picture is smaller open (a few px) than folded (the top's fixed 84 px thumbnail).
      const height = () => page.evaluate(() => Math.round(document.querySelector('[x-omni-vn] img[x-vn-cg]')?.getBoundingClientRect().height ?? 0));
      await page.waitForFunction(() => { const h = document.querySelector('[x-omni-vn] img[x-vn-cg]')?.getBoundingClientRect().height ?? 0; return h > 0 && h < 40; }, null, { timeout: 7000 });
      await page.waitForFunction(() => (document.querySelector('[x-omni-vn] img[x-vn-cg]')?.getBoundingClientRect().height ?? 0) > 40, null, { timeout: 6000 });
      await page.waitForTimeout(2200);
      assert.ok(await height() > 40, 'the looks that came after it did not open it again');
      // A line comes after it: AUTO is done with the picture, so it goes on by itself.
      settled += '하린: "둘이야."\n';
      await page.evaluate(t => { window.bot.chats[0].message[2].data = t; window.renderChat(); }, settled);
      await page.waitForFunction(() => (document.querySelector('[x-omni-vn] [data-vn-text]')?.textContent || '').includes('둘이야'), null, { timeout: 6000 });
    } finally { flowing = false; await chunks; }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
