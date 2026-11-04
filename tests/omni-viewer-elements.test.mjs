import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

// 옴니 뷰어's 요소 over a restricted SafeDOM (as tests/omni-viewer-host.test.mjs has it): a chat of the bot's replies
// and the reader's messages, the newest reply with the bot's status panel in it.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';
const reply = ['문이 열렸다.', '오미선 (cheerful): "왔어?"', '오미선: "자리 맡아놨어. 오늘은 창가 쪽이 제일 따뜻하더라, 얼른 앉아."', '하린: "응, 늦었지."'].join('\n');
const messages = [
  { role: 'char', chatId: 'a0', data: '전날 밤은 조용했다.' }, { role: 'user', data: '안녕' },
  { role: 'char', chatId: 'a2', data: '바람이 불었다.' }, { role: 'user', data: '가자' },
  { role: 'char', chatId: 'a4', data: '길이 젖어 있었다.' }, { role: 'user', data: '들어가자' },
  { role: 'char', chatId: 'a6', data: reply },
];
const replyHtml = '<p>문이 열렸다.</p><p>오미선: “왔어?”</p><p>오미선: “자리 맡아놨어. 오늘은 창가 쪽이 제일 따뜻하더라, 얼른 앉아.”</p><p>하린: “응, 늦었지.”</p>'
  + '<div class="x-risu-status" style="width:180px;height:60px;background:#335">HP 3 <span>MP 2</span></div>';

async function openViewerPage() {
  const built = await build({ stdin: { contents: "import {installOmniViewer,viewerOpen} from './src/viewer/omni-viewer';import {loadTtsData,ttsData} from './src/storage/tts-store';import {loadEmotionData,emotionData} from './src/storage/emotion-store';import {viewerPrefs} from './src/storage/viewer-prefs';Object.assign(window,{installOmniViewer,viewerOpen,loadTtsData,ttsData,loadEmotionData,emotionData,viewerPrefs});", resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife' });
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  const page = await browser.newPage({ viewport: { width: 400, height: 900 } }), errors = [];
  page.setDefaultTimeout(8000); page.on('pageerror', e => errors.push(e.message));
  await page.route('https://vn.test/', r => r.fulfill({ contentType: 'text/html', body: '<html><head></head><body style="margin:0"></body></html>' })); await page.goto('https://vn.test/');
  await page.addScriptTag({ content: readFileSync('node_modules/dompurify/dist/purify.min.js', 'utf8') });
  await page.evaluate(({ png, messages, replyHtml }) => {
    const saved = new Map(), local = new Map(); window.buttons = {};
    class Safe {
      constructor(node) { this.node = node; this.listeners = new Map(); }
      release() {}
      async querySelector(s) { const n = this.node.querySelector(s); return n ? new Safe(n) : null; }
      async querySelectorAll(s) { return [...this.node.querySelectorAll(s)].map(n => new Safe(n)); }
      async setAttribute(k, v) { if (!k.startsWith('x-')) throw Error('Forbidden attribute write ' + k); this.node.setAttribute(k, v); }
      async getAttribute(k) { if (!k.startsWith('x-')) throw Error('Forbidden attribute read ' + k); return this.node.getAttribute(k); }
      async setTextContent(v) { this.node.textContent = v; }
      async getOuterHTML() { return this.node.outerHTML; }
      async innerText() { return this.node.innerText; }
      async scrollIntoView(o) { this.node.scrollIntoView(o); }
      async getInnerHTML() { return this.node.innerHTML; }
      async setClassName(v) { this.node.className = v; }
      async setInnerHTML(v) { this.node.innerHTML = DOMPurify.sanitize(v); }
      async setStyleAttribute(v) { this.node.style.cssText = v; }
      async appendChild(child) { this.node.append(child.node); }
      async remove() { this.node.remove(); }
      async cloneNode(deep) { return new Safe(this.node.cloneNode(deep)); }
      async getBoundingClientRect() { return this.node.getBoundingClientRect().toJSON(); }
      async addEventListener(type, fn) { const id = String(Math.random()); const cb = e => fn({ clientX: e.clientX, clientY: e.clientY, key: e.key, repeat: e.repeat }); this.listeners.set(id, [type, cb]); document.addEventListener(type, cb); return id; }
      async removeEventListener(type, id) { const x = this.listeners.get(id); if (x) { document.removeEventListener(type, x[1]); this.listeners.delete(id); } }
      async createElement(tag) { if (!['div', 'button', 'style'].includes(tag)) throw Error('Unsupported host element ' + tag); return new Safe(document.createElement(tag)); }
    }
    // Risu's chat: newest first (a column drawn bottom up), each message in its own container.
    const body = i => i === messages.length - 1 ? replyHtml : `<p>${messages[i].data}</p>`;
    const list = messages.map((m, i) => `<div class="chat-message-container"><div class="risu-chat" data-chat-index="${i}"><div class="chattext">${body(i)}</div></div></div>`).reverse().join('');
    document.body.innerHTML = `<div class="default-chat-screen" style="position:fixed;inset:0;z-index:30;overflow:auto;display:flex;flex-direction:column-reverse"><div style="height:90px">입력창</div><div class="flex-col-reverse">${list}</div></div>`;
    const bytes = Uint8Array.from(atob(png), c => c.charCodeAt(0));
    const bot = { chaId: 'bot', name: 'Bot', additionalAssets: [['오미선_happy', 'assets/h.png', 'png'], ['하린_neutral', 'assets/n.png', 'png']], chats: [{ id: 'chat', message: messages }], chatPage: 0 };
    window.risuai = { pluginStorage: { getItem: async k => saved.get(k), setItem: async (k, v) => saved.set(k, v) }, getLocalPluginStorage: async () => ({ getItem: async k => local.get(k), setItem: async (k, v) => local.set(k, v), removeItem: async k => local.delete(k) }),
      getDatabase: async () => ({ modules: [], enabledModules: [] }), getCurrentCharacterIndex: async () => 0, getCurrentChatIndex: async () => 0, getCharacterFromIndex: async () => structuredClone(bot), getCharacter: async () => structuredClone(bot),
      showContainer: async () => { throw new Error('no container in the test'); }, hideContainer: async () => {},
      readImage: async () => bytes, getRootDocument: async () => new Safe(document), registerButton: async (arg, fn) => { window.buttons[arg.id] = fn; return { id: arg.id }; },
      addRisuChatListener: async () => {} };
  }, { png: PNG, messages, replyHtml });
  await page.evaluate(() => { window.crypto.randomUUID = undefined; });
  await page.addScriptTag({ content: built.outputFiles[0].text });
  await page.evaluate(async () => {
    await window.loadTtsData(); const d = window.ttsData(); d.settings.enabled = false;
    d.characters.push({ id: 't-misun', scope: 'global', name: '오미선', surname: '오', givenName: '미선', surnameAliases: [], givenAliases: [], triggers: [], tags: [], gender: 'female', voiceKey: '', fishId: '', fixed: false, gain: 0 });
    d.characters.push({ id: 't-harin', scope: 'global', name: '하린', surname: '', givenName: '하린', surnameAliases: [], givenAliases: [], triggers: [], tags: [], gender: 'female', voiceKey: '', fishId: '', fixed: false, gain: 0 });
    await window.loadEmotionData(); window.emotionData().settings.autoGenerate = false;
    await window.installOmniViewer();
  });
  const open = async () => { await page.evaluate(() => window.buttons['omni-viewer-chat']()); await page.waitForFunction(() => !!document.querySelector('[x-omni-vn] [data-vn-text]')?.textContent); };
  const press = async act => { const b = await page.locator(`[x-omni-vn] [data-vn-act="${act}"]`).boundingBox(); await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); };
  const chip = (row, label) => page.locator(`[x-omni-vn] [data-vn-el]:has(b:text-is("${row}")) i`, { hasText: label });
  const tapChip = async (row, label) => { const b = await chip(row, label).boundingBox(); await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); };
  const shownMessages = () => page.evaluate(() => [...document.querySelectorAll('.flex-col-reverse > .chat-message-container')]
    .filter(c => getComputedStyle(c).display !== 'none').map(c => Number(c.querySelector('.risu-chat').dataset.chatIndex)).sort((a, b) => a - b));
  return { browser, page, errors, open, press, chip, tapChip, shownMessages };
}

test('요소: a sticker over the people and under the box, the 요소 button kept, the chat folded to the bot\'s newest three', async () => {
  const { browser, page, errors, open, press, tapChip, shownMessages } = await openViewerPage();
  try {
    await open();
    // Behind the viewer: the bot's newest three messages and the newest of any; the reader's own folded away.
    await page.waitForFunction(() => /:has\(/.test(document.querySelector('[x-omni-vn-style="fold"]')?.textContent || ''));
    assert.deepEqual(await shownMessages(), [2, 4, 6]);
    // 요소 on, the status panel a sticker.
    await press('elems');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[x-omni-vn] [data-vn-act="eledit"]')).visibility === 'visible');
    await press('eledit');
    await page.waitForFunction(() => document.querySelectorAll('[x-omni-vn] [data-vn-edit] [data-vn-el]').length > 0);
    await page.waitForTimeout(400);
    await tapChip('status', '스티커');
    await page.waitForFunction(() => { const st = document.querySelector('[x-omni-vn] [x-vn-st]'); return !!st && getComputedStyle(st).display === 'block'; });
    await press('eledit');
    // On 오미선's line she speaks, in front: the sticker put over her is still on top, and the box over the sticker.
    for (let i = 0; i < 4 && !/왔어/.test(await page.evaluate(() => document.querySelector('[x-omni-vn] [data-vn-text]')?.textContent || '')); i++) { await page.keyboard.press('ArrowRight'); await page.waitForTimeout(400); }
    await page.waitForFunction(() => /z-index:3/.test([...document.querySelectorAll('[x-omni-vn] [x-vn-p]')].map(p => getComputedStyle(p).zIndex === '3' && getComputedStyle(p).display !== 'none' ? 'z-index:3' : '').join('')));
    const top = await page.evaluate(() => {
      const person = [...document.querySelectorAll('[x-omni-vn] [x-vn-p]')].find(p => getComputedStyle(p).display !== 'none' && getComputedStyle(p).zIndex === '3');
      const sticker = document.querySelector('[x-omni-vn] [x-vn-st]'), boxEl = document.querySelector('[x-omni-vn] [data-vn-box]');
      // Hit-testing sees through pointer-events:none: the test lets both be hit, to ask which is drawn on top.
      const probe = document.createElement('style'); probe.textContent = '[x-omni-vn] [x-vn-p],[x-omni-vn] [x-vn-p] *,[x-omni-vn] [x-vn-st],[x-omni-vn] [x-vn-st] *{pointer-events:auto!important}'; document.head.append(probe);
      const frame = document.querySelector('[x-omni-vn]').getBoundingClientRect(), p = person.getBoundingClientRect();
      const at = (x, y) => { sticker.style.left = `${x - frame.left - 20}px`; sticker.style.top = `${y - frame.top - 20}px`; return document.elementFromPoint(x, y); };
      const overPerson = at(p.left + p.width / 2, p.top + p.height * 0.3), b = boxEl.getBoundingClientRect(), overBox = at(b.left + 60, b.top + 30);
      probe.remove();
      return { person: !!overPerson?.closest('[x-vn-st]'), box: !!overBox?.closest('[data-vn-box]') && !overBox?.closest('[x-vn-st]') };
    });
    assert.deepEqual(top, { person: true, box: true }, 'the sticker above the speaker, the box above the sticker');
    // Closed and opened again, 요소 is still on, its sticker up.
    assert.equal(await page.evaluate(() => window.viewerPrefs().elements), true);
    await press('close');
    await page.waitForFunction(() => !document.querySelector('[x-omni-vn]'));
    await open();
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[x-omni-vn] [data-vn-act="eledit"]')).visibility === 'visible');
    await page.waitForFunction(() => { const st = document.querySelector('[x-omni-vn] [x-vn-st]'); return !!st && getComputedStyle(st).display === 'block'; });
    await press('elems');
    await page.waitForFunction(() => window.viewerPrefs().elements === false);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
