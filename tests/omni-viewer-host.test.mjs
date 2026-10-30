import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';
const reply = ['[3월 2일 ◆ 오후 4시 ◆ 카페]', '- Main Storylines: 숨은 요약 줄', '문이 열렸다.', '오미선 (cheerful): "왔어?"', '오미선: "자리 맡아놨어."', '[[@inray::card1::inxshot_abc::832::1216]]', '하린: "응, 늦었지."'].join('\n');

test('옴니 뷰어 over a restricted SafeDOM: a tap costs no rect read, sprites go over once, chat images are cloned, closing leaves nothing', async () => {
  const built = await build({ stdin: { contents: "import {installOmniViewer,viewerOpen} from './src/viewer/omni-viewer';import {loadTtsData,ttsData} from './src/storage/tts-store';import {loadEmotionData,emotionData} from './src/storage/emotion-store';Object.assign(window,{installOmniViewer,viewerOpen,loadTtsData,ttsData,loadEmotionData,emotionData});", resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife' });
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 400, height: 900 } }), errors = [];
    page.setDefaultTimeout(8000); page.on('pageerror', e => errors.push(e.message));
    await page.route('https://vn.test/', r => r.fulfill({ contentType: 'text/html', body: '<html><head></head><body style="margin:0"></body></html>' })); await page.goto('https://vn.test/');
    await page.addScriptTag({ content: readFileSync('node_modules/dompurify/dist/purify.min.js', 'utf8') });
    await page.evaluate(({ png, reply }) => {
      const saved = new Map(), local = new Map(); window.calls = {}; window.buttons = {};
      const count = name => { window.calls[name] = (window.calls[name] || 0) + 1; };
      class Safe {
        constructor(node) { this.node = node; this.listeners = new Map(); }
        // Risu answers release() synchronously, with nothing: chaining on it once broke the viewer.
        release() { window.released = (window.released || 0) + 1; }
        async querySelector(s) { count('querySelector'); const n = this.node.querySelector(s); return n ? new Safe(n) : null; }
        async querySelectorAll(s) { count('querySelectorAll'); return [...this.node.querySelectorAll(s)].map(n => new Safe(n)); }
        async setAttribute(k, v) { count('setAttribute'); if (!k.startsWith('x-')) throw Error('Forbidden attribute write ' + k); this.node.setAttribute(k, v); }
        async setTextContent(v) { count('setTextContent'); this.node.textContent = v; }
        async getOuterHTML() { count('getOuterHTML'); return this.node.outerHTML; }
        async innerText() { count('innerText'); return this.node.innerText; }
        async setInnerHTML(v) { count('setInnerHTML'); if (/data:image/.test(v)) count('imageSent'); this.node.innerHTML = DOMPurify.sanitize(v); }
        async setStyleAttribute(v) { count('setStyleAttribute'); this.node.style.cssText = v; }
        async appendChild(child) { count('appendChild'); this.node.append(child.node); }
        async remove() { count('remove'); this.node.remove(); }
        async cloneNode(deep) { count('cloneNode'); return new Safe(this.node.cloneNode(deep)); }
        async getBoundingClientRect() { count('rect'); return this.node.getBoundingClientRect().toJSON(); }
        async addEventListener(type, fn) { count('addEventListener'); const id = String(Math.random()); const cb = e => fn({ clientX: e.clientX, clientY: e.clientY }); this.listeners.set(id, [type, cb]); document.addEventListener(type, cb); window.liveListeners = (window.liveListeners || 0) + 1; return id; }
        async removeEventListener(type, id) { const x = this.listeners.get(id); if (x) { document.removeEventListener(type, x[1]); this.listeners.delete(id); window.liveListeners--; } }
        async createElement(tag) { count('createElement'); if (!['div', 'button', 'style'].includes(tag)) throw Error('Unsupported host element ' + tag); return new Safe(document.createElement(tag)); }
      }
      const older = Array.from({ length: 5 }, (_, i) => `<div class="chat-message-container"><div class="risu-chat" data-chat-index="${i}"><div class="chattext">old ${i}</div></div></div>`).join('');
      document.body.innerHTML = `<div style="position:fixed;inset:0;z-index:50"></div><div class="default-chat-screen" style="position:fixed;inset:0;z-index:30;overflow:auto;display:flex;flex-direction:column-reverse"><div style="height:90px">입력창</div><div class="flex-col-reverse"><div class="chat-message-container"><div class="risu-chat" data-chat-index="2"><div class="chattext"><p>문이 열렸다.</p><p>오미선: “왔어?”</p><p>오미선: “자리 맡아놨어.”</p><p>하린: “응, 늦었지.”</p><div data-inray-asset="inxshot_abc"><img src="data:image/png;base64,${png}" style="width:50%"></div></div></div></div>${older}</div></div>`;
      const bytes = Uint8Array.from(atob(png), c => c.charCodeAt(0));
      const bot = { chaId: 'bot', name: 'Bot', additionalAssets: [['오미선_happy', 'assets/h.png', 'png'], ['하린_neutral', 'assets/n.png', 'png']], chats: [{ id: 'chat', message: [{ role: 'char', chatId: 'm0', data: '전날 밤은 조용했다.' }, { role: 'user', data: 'hi' }, { role: 'char', chatId: 'm1', data: reply }] }], chatPage: 0 };
      window.risuai = { pluginStorage: { getItem: async k => saved.get(k), setItem: async (k, v) => saved.set(k, v) }, getLocalPluginStorage: async () => ({ getItem: async k => local.get(k), setItem: async (k, v) => local.set(k, v), removeItem: async k => local.delete(k) }),
        getDatabase: async () => ({ modules: [], enabledModules: [] }), getCurrentCharacterIndex: async () => 0, getCurrentChatIndex: async () => 0, getCharacterFromIndex: async () => structuredClone(bot), getCharacter: async () => structuredClone(bot),
        readImage: async () => bytes, getRootDocument: async () => new Safe(document), registerButton: async (arg, fn) => { window.buttons[arg.id] = fn; return { id: arg.id }; } };
    }, { png: PNG, reply });
    await page.evaluate(() => { window.crypto.randomUUID = undefined; });
    await page.addScriptTag({ content: built.outputFiles[0].text });
    await page.evaluate(async () => {
      await window.loadTtsData(); const d = window.ttsData(); d.settings.enabled = false;
      d.characters.push({ id: 't-misun', scope: 'global', name: '오미선', surname: '오', givenName: '미선', surnameAliases: [], givenAliases: [], triggers: [], tags: [], gender: 'female', voiceKey: '', fishId: '', fixed: false, gain: 0 });
      d.characters.push({ id: 't-harin', scope: 'global', name: '하린', surname: '', givenName: '하린', surnameAliases: [], givenAliases: [], triggers: [], tags: [], gender: 'female', voiceKey: '', fishId: '', fixed: false, gain: 0 });
      await window.loadEmotionData(); window.emotionData().settings.autoGenerate = false;
      await window.installOmniViewer();
    });
    assert.equal(await page.evaluate(() => window.liveListeners || 0), 0, 'closed, the viewer listens to nothing');
    await page.evaluate(() => window.buttons['omni-viewer-chat']());
    await page.waitForFunction(() => /문이 열렸다/.test(document.querySelector('[x-omni-vn] [data-vn-text]')?.textContent || ''));
    const box = await page.locator('[x-omni-vn]').boundingBox();
    assert.equal(await page.evaluate(({x,y})=>!!document.elementFromPoint(x,y)?.closest('[x-omni-vn]'),{x:box.x+box.width/2,y:box.y+box.height/2}),true,"nothing of Risu's is drawn over the viewer");
    assert.ok(box.height <= 900 - 90 + 1, 'Risu\'s input stays below the viewer');
    assert.equal(await page.locator('[x-omni-vn] [data-vn-clock]').textContent(), '3월 2일 · 오후 4시 · 카페');
    assert.match(await page.locator('[x-omni-vn] [data-vn-count]').textContent(), /^1 \/ 5/, 'the hidden summary line is no scene: 4 lines and the CG');
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('.flex-col-reverse > .chat-message-container')].filter(n => getComputedStyle(n).display !== 'none').length), 2, 'only the newest messages stay laid out behind it');
    // The letters of these short lines are all in within half a second; a tap before that only completes them.
    const tap = async expected => {
      await page.waitForTimeout(450);
      await page.evaluate(() => { window.calls = {}; });
      await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.45);
      await page.waitForFunction(text => (document.querySelector('[x-omni-vn] [data-vn-text]')?.textContent || '').includes(text), expected);
      return page.evaluate(() => ({ ...window.calls }));
    };
    const first = await tap('왔어?');
    assert.equal(first.rect || 0, 0, 'a tap reads no rectangle');
    assert.equal(first.imageSent, 1, 'the sprite\'s pixels go over the first time');
    assert.equal(await page.locator('[x-omni-vn] [x-vn-sp] img').count(), 1);
    const again = await tap('자리 맡아놨어');
    assert.equal(again.imageSent || 0, 0, 'the same face again sends nothing');
    assert.ok((again.setInnerHTML || 0) + (again.setTextContent || 0) <= 2, 'a scene is one box and one style text: ' + JSON.stringify(again));
    const cg = await tap('');
    await page.waitForFunction(() => document.querySelectorAll('[x-omni-vn] [x-vn-bg]').length === 1);
    assert.equal(cg.imageSent || 0, 0, 'the chat image is cloned, not re-sent');
    assert.equal(cg.cloneNode, 2, 'one copy comes in as the photo, one stays as the background');
    assert.equal(await page.locator('[x-omni-vn] img[x-vn-cg]').count(), 1);
    await tap('늦었지');
    assert.equal(await page.locator('[x-omni-vn] [data-vn-name]').textContent(), '하린');
    // Everyone so far stays on stage; only the speaker is lit.
    const stage = await page.evaluate(() => [...document.querySelectorAll('[x-omni-vn] [x-vn-p]')].filter(n => getComputedStyle(n).display !== 'none').map(n => getComputedStyle(n).filter));
    assert.equal(stage.length, 2, 'both people who have spoken stand');
    assert.equal(stage.filter(f => f === 'none').length, 1, 'exactly one is lit: ' + JSON.stringify(stage));
    // Back to a long-enough line: a tap during its letters completes them and stays.
    await page.locator('[x-omni-vn] [data-vn-act="prev"]').click(); await page.locator('[x-omni-vn] [data-vn-act="prev"]').click();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.45);
    await page.waitForFunction(() => /animation:none/.test(document.querySelector('[x-omni-vn-style="scene"]')?.textContent || ''));
    assert.match(await page.locator('[x-omni-vn] [data-vn-text]').textContent(), /자리 맡아놨어/, 'the same line, now complete');
    // 이전 답장 goes back a reply; 최신 returns, and ▶ at an older reply's end goes on to the next one.
    const press = async act => { const b = await page.locator(`[x-omni-vn] [data-vn-act="${act}"]`).boundingBox(); await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); };
    await press('older');
    await page.waitForFunction(() => /전날 밤은 조용했다/.test(document.querySelector('[x-omni-vn] [data-vn-text]')?.textContent || ''));
    await page.waitForTimeout(450); await press('next');
    await page.waitForFunction(() => /문이 열렸다/.test(document.querySelector('[x-omni-vn] [data-vn-text]')?.textContent || ''));
    await press('older'); await page.waitForFunction(() => /전날 밤/.test(document.querySelector('[x-omni-vn] [data-vn-text]')?.textContent || ''));
    await press('newest');
    await page.waitForFunction(() => /문이 열렸다/.test(document.querySelector('[x-omni-vn] [data-vn-text]')?.textContent || ''));
    // ✕ closes: no frame, no styles, no listener.
    const close = await page.locator('[x-omni-vn] [data-vn-act="close"]').boundingBox();
    await page.mouse.click(close.x + close.width / 2, close.y + close.height / 2);
    await page.waitForFunction(() => !document.querySelector('[x-omni-vn]'));
    assert.equal(await page.evaluate(() => document.querySelectorAll('[x-omni-vn-style]').length), 0);
    assert.equal(await page.evaluate(() => window.liveListeners), 0);
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('.flex-col-reverse > .chat-message-container')].filter(n => getComputedStyle(n).display !== 'none').length), 6, 'the chat is whole again');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('옴니 뷰어 over a restricted SafeDOM, when the chat cannot be read: the reason shows, ✕ still closes, no chat screen falls back to the page', async () => {
  const built = await build({ stdin: { contents: "import {installOmniViewer} from './src/viewer/omni-viewer';Object.assign(window,{installOmniViewer});", resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife' });
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 400, height: 900 } }), errors = [];
    page.setDefaultTimeout(8000); page.on('pageerror', e => errors.push(e.message));
    await page.route('https://vn.test/', r => r.fulfill({ contentType: 'text/html', body: '<html><head></head><body style="margin:0"></body></html>' })); await page.goto('https://vn.test/');
    await page.addScriptTag({ content: readFileSync('node_modules/dompurify/dist/purify.min.js', 'utf8') });
    await page.evaluate(() => {
      const saved = new Map(), local = new Map(); window.buttons = {};
      class Safe {
        constructor(node) { this.node = node; this.listeners = new Map(); }
        // Risu answers release() synchronously, with nothing: chaining on it once broke the viewer.
        release() { window.released = (window.released || 0) + 1; }
        async querySelector(s) { const n = this.node.querySelector(s); return n ? new Safe(n) : null; }
        async querySelectorAll(s) { return [...this.node.querySelectorAll(s)].map(n => new Safe(n)); }
        async setAttribute(k, v) { if (!k.startsWith('x-')) throw Error('Forbidden attribute write ' + k); this.node.setAttribute(k, v); }
        async setTextContent(v) { this.node.textContent = v; }
        async getOuterHTML() { return this.node.outerHTML; }
        async setInnerHTML(v) { this.node.innerHTML = DOMPurify.sanitize(v); }
        async setStyleAttribute(v) { this.node.style.cssText = v; }
        async appendChild(child) { this.node.append(child.node); }
        async remove() { this.node.remove(); }
        async getBoundingClientRect() { return this.node.getBoundingClientRect().toJSON(); }
        async addEventListener(type, fn) { const id = String(Math.random()); const cb = e => fn({ clientX: e.clientX, clientY: e.clientY }); this.listeners.set(id, [type, cb]); document.addEventListener(type, cb); return id; }
        async removeEventListener(type, id) { const x = this.listeners.get(id); if (x) { document.removeEventListener(type, x[1]); this.listeners.delete(id); } }
        async createElement(tag) { if (!['div', 'button', 'style'].includes(tag)) throw Error('Unsupported host element ' + tag); return new Safe(document.createElement(tag)); }
      }
      document.body.innerHTML = '<div class="other-layout">채팅</div>';
      window.risuai = { pluginStorage: { getItem: async k => saved.get(k), setItem: async (k, v) => saved.set(k, v) }, getLocalPluginStorage: async () => ({ getItem: async k => local.get(k), setItem: async (k, v) => local.set(k, v), removeItem: async k => local.delete(k) }),
        getDatabase: async () => ({ modules: [], enabledModules: [] }), getCharacter: async () => { throw new Error('채팅을 읽을 수 없음'); },
        getRootDocument: async () => new Safe(document), registerButton: async (arg, fn) => { window.buttons[arg.id] = fn; return { id: arg.id }; } };
    });
    await page.evaluate(() => { window.crypto.randomUUID = undefined; });
    await page.addScriptTag({ content: built.outputFiles[0].text });
    await page.evaluate(async () => { await window.installOmniViewer(); window.buttons['omni-viewer-menu'](); });
    await page.waitForFunction(() => /열지 못했습니다/.test(document.querySelector('[x-omni-vn] [data-vn-text]')?.textContent || ''));
    const frame = await page.locator('[x-omni-vn]').boundingBox();
    assert.ok(frame.width >= 390 && frame.height > 500, 'no chat screen: the page above the input');
    const close = await page.locator('[x-omni-vn] [data-vn-act="close"]').boundingBox();
    await page.mouse.click(close.x + close.width / 2, close.y + close.height / 2);
    await page.waitForFunction(() => !document.querySelector('[x-omni-vn]'));
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
