import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

// 옴니 뷰어's 요소 over a restricted SafeDOM (as tests/omni-viewer-host.test.mjs has it): a chat of the bot's replies
// and the reader's messages, the newest reply with the bot's status panel in it.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';
const reply = ['문이 열렸다.', '오미선 (cheerful): "왔어?"', '오미선: "자리 맡아놨어. 오늘은 창가 쪽이 제일 따뜻하더라, 얼른 앉아."', '하린: "응, 늦었지."'].join('\n');
const MESSAGES = [
  { role: 'char', chatId: 'a0', data: '전날 밤은 조용했다.' }, { role: 'user', data: '안녕' },
  { role: 'char', chatId: 'a2', data: '바람이 불었다.' }, { role: 'user', data: '가자' },
  { role: 'char', chatId: 'a4', data: '길이 젖어 있었다.' }, { role: 'user', data: '들어가자' },
  { role: 'char', chatId: 'a6', data: reply },
];
const replyHtml = '<p>문이 열렸다.</p><p>오미선: “왔어?”</p><p>오미선: “자리 맡아놨어. 오늘은 창가 쪽이 제일 따뜻하더라, 얼른 앉아.”</p><p>하린: “응, 늦었지.”</p>'
  + '<div class="x-risu-status" style="width:180px;height:60px;background:#335">HP 3 <span>MP 2</span></div>';

async function openViewerPage({ messages, html, touch = false } = { messages: MESSAGES, html: i => (i === MESSAGES.length - 1 ? replyHtml : `<p>${MESSAGES[i].data}</p>`) }) {
  const built = await build({ stdin: { contents: "import {installOmniViewer,viewerOpen} from './src/viewer/omni-viewer';import {loadTtsData,ttsData} from './src/storage/tts-store';import {loadEmotionData,emotionData} from './src/storage/emotion-store';import {viewerPrefs} from './src/storage/viewer-prefs';Object.assign(window,{installOmniViewer,viewerOpen,loadTtsData,ttsData,loadEmotionData,emotionData,viewerPrefs});", resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife' });
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  // touch: a finger as a phone's (touch-action decides whether a move is the page's pan or the page's own).
  const page = await browser.newPage({ viewport: { width: 400, height: 900 }, hasTouch: touch }), errors = [];
  page.setDefaultTimeout(8000); page.on('pageerror', e => errors.push(e.message));
  await page.route('https://vn.test/', r => r.fulfill({ contentType: 'text/html', body: '<html><head></head><body style="margin:0"></body></html>' })); await page.goto('https://vn.test/');
  await page.addScriptTag({ content: readFileSync('node_modules/dompurify/dist/purify.min.js', 'utf8') });
  const bodies = messages.map((_, i) => html(i));
  await page.evaluate(({ png, messages, bodies }) => {
    const saved = new Map(), local = new Map(); window.buttons = {};
    class Safe {
      constructor(node) { this.node = node; this.listeners = new Map(); }
      release() {}
      // window.slowQuery / slowCreate: a bridge slow for the chat's messages, or for every element made (optimism's tests).
      async querySelector(s) { if (window.slowQuery && s.includes('.risu-chat[')) await new Promise(r => setTimeout(r, window.slowQuery)); const n = this.node.querySelector(s); return n ? new Safe(n) : null; }
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
      async createElement(tag) { if (window.slowCreate) await new Promise(r => setTimeout(r, window.slowCreate)); if (!['div', 'button', 'style'].includes(tag)) throw Error('Unsupported host element ' + tag); return new Safe(document.createElement(tag)); }
    }
    // Risu's chat: newest first (a column drawn bottom up), each message in its own container.
    const body = i => bodies[i];
    const list = messages.map((m, i) => `<div class="chat-message-container"><div class="risu-chat" data-chat-index="${i}"><div class="chattext">${body(i)}</div></div></div>`).reverse().join('');
    document.body.innerHTML = `<div class="default-chat-screen" style="position:fixed;inset:0;z-index:30;overflow:auto;display:flex;flex-direction:column-reverse"><div style="height:90px">입력창</div><div class="flex-col-reverse">${list}</div></div>`;
    const bytes = Uint8Array.from(atob(png), c => c.charCodeAt(0));
    const bot = { chaId: 'bot', name: 'Bot', additionalAssets: [['오미선_happy', 'assets/h.png', 'png'], ['하린_neutral', 'assets/n.png', 'png']], chats: [{ id: 'chat', message: messages }], chatPage: 0 };
    window.risuai = { pluginStorage: { getItem: async k => saved.get(k), setItem: async (k, v) => saved.set(k, v) }, getLocalPluginStorage: async () => ({ getItem: async k => local.get(k), setItem: async (k, v) => local.set(k, v), removeItem: async k => local.delete(k) }),
      getDatabase: async () => ({ modules: [], enabledModules: [] }), getCurrentCharacterIndex: async () => 0, getCurrentChatIndex: async () => 0, getCharacterFromIndex: async () => structuredClone(bot), getCharacter: async () => structuredClone(bot),
      showContainer: async () => { throw new Error('no container in the test'); }, hideContainer: async () => {},
      readImage: async () => bytes, getRootDocument: async () => new Safe(document), registerButton: async (arg, fn) => { window.buttons[arg.id] = fn; return { id: arg.id }; },
      addRisuChatListener: async () => {} };
  }, { png: PNG, messages, bodies });
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
  // As a reader would: scrolled into sight in the panel first (a tall list scrolls), then tapped where it is.
  const tapChip = async (row, label) => { const c = chip(row, label); await c.scrollIntoViewIfNeeded(); const b = await c.boundingBox(); await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); };
  const shownMessages = () => page.evaluate(() => [...document.querySelectorAll('.flex-col-reverse > .chat-message-container')]
    .filter(c => getComputedStyle(c).display !== 'none').map(c => Number(c.querySelector('.risu-chat').dataset.chatIndex)).sort((a, b) => a - b));
  return { browser, page, errors, open, press, chip, tapChip, shownMessages };
}

test('요소: a sticker over the people and under the box, the 요소 button kept, the chat folded to the bot\'s newest three and the reader\'s between them', async () => {
  const { browser, page, errors, open, press, tapChip, shownMessages } = await openViewerPage();
  try {
    await open();
    // Behind the viewer: from the bot's third newest message on, the reader's between them too (their panels can be
    // 요소); the older folded away.
    await page.waitForFunction(() => /:has\(/.test(document.querySelector('[x-omni-vn-style="fold"]')?.textContent || ''));
    assert.deepEqual(await shownMessages(), [2, 3, 4, 5, 6]);
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

// A bot that sends its status panel in a message of its own, after each reply: 편집's 다음 메시지 1 tab finds it
// there, and a sticker made from it comes from the bot's next message, whichever reply is on stage.
test('요소: 다음 메시지 1 brings the status message\'s panel to the reply; 접기 gives it a bar that folds and moves it', async () => {
  // The reader's message between them is passed over: the bot's next message is the board.
  const withBoard = [...MESSAGES, { role: 'user', data: '(잠깐)' }, { role: 'char', chatId: 'a8', data: '보드가 갱신되었다.' }];
  const { browser, page, errors, open, press, tapChip, chip } = await openViewerPage({ messages: withBoard,
    html: i => i === 6 ? replyHtml : i === 8 ? '<p>보드가 갱신되었다.</p><div class="x-risu-board" style="width:160px;height:50px;background:#533">호감 42</div>' : `<p>${withBoard[i].data}</p>` });
  try {
    await open();
    // On the status message (the newest of the bot's), one step back is the reply before it.
    await page.waitForFunction(() => /보드가 갱신/.test(document.querySelector('[x-omni-vn] [data-vn-text]')?.textContent || ''));
    await page.keyboard.press('ArrowLeft');
    await page.waitForFunction(() => /늦었지/.test(document.querySelector('[x-omni-vn] [data-vn-text]')?.textContent || ''));
    await press('elems');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[x-omni-vn] [data-vn-act="eledit"]')).visibility === 'visible');
    await press('eledit');
    // The tabs in the chat's order: the reply, the reader's message after it, the bot's next two.
    await page.waitForFunction(() => [...document.querySelectorAll('[x-omni-vn] [data-vn-edit] [data-vn-tabs] i')].map(i => i.textContent).join('|') === '이 답장|다음 유저 메시지|다음 메시지 1|다음 메시지 2');
    await page.waitForTimeout(400);
    // 이 답장 has the reply's own status panel; 다음 메시지 1 the board of the message after it.
    assert.equal(await chip('status', '스티커').count(), 1);
    const tabAt = async i => { const b = await page.locator('[x-omni-vn] [data-vn-tabs] i').nth(i).boundingBox(); await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); };
    await tabAt(2);
    await page.waitForFunction(() => document.querySelector('[x-omni-vn] [data-vn-tabs] i:nth-child(3)')?.hasAttribute('data-on') && !!document.querySelector('[x-omni-vn] [data-vn-el] b'));
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('[x-omni-vn] [data-vn-el] b')].map(b => b.textContent)), ['board']);
    await page.waitForTimeout(300);
    await tapChip('board', '스티커');
    await page.waitForFunction(() => !!document.querySelector('[x-omni-vn] [x-vn-st] .x-risu-board'));
    await page.waitForTimeout(400);
    await tapChip('board', '접기');
    await page.waitForFunction(() => document.querySelector('[x-omni-vn] [x-vn-st] [x-vn-st-bar]')?.textContent === 'board');
    const saved = await page.evaluate(async () => { const raw = await window.risuai.pluginStorage.getItem('omniviewer.elements'); const all = typeof raw === 'string' ? JSON.parse(raw) : raw || {}; return Object.values(all.bot || {}); });
    assert.deepEqual(saved.map(r => [r.role, r.from, r.fold]), [['sticker', 1, true]], 'kept as the next message\'s, with its bar');
    await press('eledit');
    await page.waitForTimeout(400);
    // A tap on the bar folds it, and the story stays where it was; another opens it.
    const text = () => page.evaluate(() => document.querySelector('[x-omni-vn] [data-vn-text]')?.textContent || '');
    const before = await text(), bodyShown = () => page.evaluate(() => getComputedStyle(document.querySelector('[x-omni-vn] [x-vn-st] [x-vn-st-body]')).display !== 'none');
    const bar = await page.locator('[x-omni-vn] [x-vn-st-bar]').boundingBox();
    await page.mouse.click(bar.x + 20, bar.y + bar.height / 2);
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[x-omni-vn] [x-vn-st] [x-vn-st-body]')).display === 'none');
    assert.equal(await text(), before, 'folding moved no story on');
    await page.waitForTimeout(300);
    await page.mouse.click(bar.x + 20, bar.y + bar.height / 2);
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[x-omni-vn] [x-vn-st] [x-vn-st-body]')).display !== 'none');
    assert.equal(await bodyShown(), true);
    // Dragged by its bar, outside 편집: it follows, stays open, and the story stays.
    await page.waitForTimeout(300);
    await page.mouse.move(bar.x + 20, bar.y + 10); await page.mouse.down();
    await page.mouse.move(bar.x + 60, bar.y + 60, { steps: 5 }); await page.mouse.move(bar.x + 90, bar.y + 110, { steps: 5 }); await page.mouse.up();
    await page.waitForFunction(was => Math.abs(document.querySelector('[x-omni-vn] [x-vn-st]').getBoundingClientRect().top - was - 100) < 8, bar.y);
    await page.waitForTimeout(400);
    assert.equal(await bodyShown(), true, 'the drag was no tap: still open');
    assert.equal(await text(), before, 'nor a step of the story');
    // On the status message itself the bot has no message after it: the next message's sticker is not there.
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => /보드가 갱신/.test(document.querySelector('[x-omni-vn] [data-vn-text]')?.textContent || ''));
    await page.waitForFunction(() => !document.querySelector('[x-omni-vn] [x-vn-st]'));
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

// 작동: a tile on the stage; a tap shows the chat's own panel in the middle of the viewer: the chat behind is scrolled
// until it stands there, where Risu drew it, and it is seen through a hole, so that its button is Risu's (Risu takes a
// button's click on the message: here a capture listener stands for it, and draws the message anew with the result,
// as Risu does). The chat screen here makes a stacking context of its own (fixed, z-index 30): a window over the
// viewer by z-index could never be, a hole can.
const savedRule = page => page.evaluate(async () => { const raw = await window.risuai.pluginStorage.getItem('omniviewer.elements'); const all = typeof raw === 'string' ? JSON.parse(raw) : raw || {}; return Object.values(all.bot || {}); });
test('요소 작동: a tile of its own (never a sticker as well); a tap opens the chat\'s own panel in the viewer\'s middle, its button Risu\'s; a tap elsewhere folds it; an older reply opens a copy', async () => {
  const oldPanel = '<p>전날 밤은 조용했다.</p><div class="x-risu-status" style="width:180px;height:60px;background:#353">HP 9</div>';
  const nowPanel = replyHtml.replace('HP 3 <span>MP 2</span>', 'HP 3 <button risu-btn="hit" style="width:70px;height:32px">맞기</button>');
  const { browser, page, errors, open, press, chip, tapChip } = await openViewerPage({ messages: MESSAGES, html: i => i === 0 ? oldPanel : i === 6 ? nowPanel : `<p>${MESSAGES[i].data}</p>` });
  try {
    await page.evaluate(() => {
      document.addEventListener('click', e => {
        const chat = e.target.closest?.('.risu-chat'), button = e.target.closest?.('[risu-btn]');
        if (!chat || !button) return;
        window.risuClicks = (window.risuClicks || []).concat(button.getAttribute('risu-btn'));
        const text = chat.querySelector('.chattext');
        setTimeout(() => { text.innerHTML = text.innerHTML.replace('HP 3', 'HP 2'); }, 60);
      }, true);
    });
    // Seen: the point at its middle is the chat's panel itself (through the viewer's hole), where Risu drew it.
    const seen = () => page.evaluate(() => {
      const n = document.querySelector('.risu-chat[data-chat-index="6"] .x-risu-status');
      if (!n) return false;
      const r = n.getBoundingClientRect(), at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!at && n.contains(at);
    });
    const holeCut = () => /evenodd/.test(document.querySelector('[x-omni-vn-style="live"]')?.textContent || '');
    const text = () => page.evaluate(() => document.querySelector('[x-omni-vn] [data-vn-text]')?.textContent || '');
    const lit = label => chip('status', label).evaluate(el => el.hasAttribute('data-on'));
    const tileBox = () => page.locator('[x-omni-vn] [data-vn-tile]').boundingBox();
    const tapTile = async () => { const b = await tileBox(); await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); };
    const popShown = () => page.evaluate(() => getComputedStyle(document.querySelector('[x-omni-vn] [data-vn-pop]')).display !== 'none');
    const isFixed = index => page.evaluate(i => getComputedStyle(document.querySelector(`.risu-chat[data-chat-index="${i}"] .x-risu-status`)).position === 'fixed', index);
    await open();
    await press('elems');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[x-omni-vn] [data-vn-act="eledit"]')).visibility === 'visible');
    await press('eledit');
    await page.waitForFunction(() => document.querySelectorAll('[x-omni-vn] [data-vn-edit] [data-vn-el]').length > 0);
    await page.waitForTimeout(400);
    // 작동 is a kind of its own: a sticker made 작동 is a sticker no more.
    await tapChip('status', '스티커');
    await page.waitForFunction(() => !!document.querySelector('[x-omni-vn] [data-vn-el] i[data-on]'));
    await page.waitForTimeout(400);
    // Optimistic: the list shows the tap at once, a spinner turning until the stage catches up (slow here: every
    // element the stage makes waits 0.7 s).
    const spinning = () => page.evaluate(() => getComputedStyle(document.querySelector('[x-omni-vn] [data-vn-edit] h4'), '::after').content !== 'none');
    await page.evaluate(() => { window.slowCreate = 700; });
    await tapChip('status', '작동');
    await page.waitForTimeout(300);
    assert.deepEqual([await lit('스티커'), await lit('작동')], [false, true], 'lit at once');
    assert.equal(await spinning(), true, 'the spinner turns while the stage catches up');
    assert.equal(await page.evaluate(() => !!document.querySelector('[x-omni-vn] [data-vn-tile]')), false, 'the stage not there yet');
    await page.evaluate(() => { window.slowCreate = 0; });
    await page.waitForFunction(() => !!document.querySelector('[x-omni-vn] [data-vn-tile]'));
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[x-omni-vn] [data-vn-edit] h4'), '::after').content === 'none');
    assert.deepEqual([await lit('스티커'), await lit('작동')], [false, true]);
    for (let i = 0; i < 30 && (await savedRule(page))[0]?.role !== 'live'; i++) await page.waitForTimeout(100);
    assert.deepEqual((await savedRule(page)).map(r => r.role), ['live']);
    await press('eledit');
    await page.waitForTimeout(400);
    // A tile on the stage, as small as an icon; nothing seen through yet, no hole.
    const tile = await tileBox();
    assert.ok(tile && tile.width <= 64 && tile.height <= 64, `a tile, not a bar: ${JSON.stringify(tile)}`);
    assert.equal(await seen(), false);
    assert.equal(await popShown(), false);
    // Tapped: the stage dims at once, a spinner where it opens, while the panel is read (slow here: 0.6 s a read)...
    const before = await text();
    await page.evaluate(() => { window.slowQuery = 600; });
    await tapTile();
    await page.waitForTimeout(250);
    assert.equal(await popShown(), true, 'dimmed at once');
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('[x-omni-vn] [data-vn-pop] [data-vn-spin]')).display), 'block', 'its spinner');
    assert.equal(await seen(), false, 'no hole while it is read');
    await page.evaluate(() => { window.slowQuery = 0; });
    // ...then the chat scrolled until the panel stands in the viewer's middle (the bar under it left out), where Risu
    // drew it, never lifted out; seen through a hole there, the stage dimmed around it; one sheet.
    await page.waitForFunction(holeCut);
    assert.equal(await seen(), true);
    assert.equal(await isFixed(6), false, 'never lifted out of its place');
    assert.equal(await page.evaluate(() => document.querySelectorAll('[x-omni-vn-style="live"]').length), 1, 'one live sheet');
    const middle = await page.evaluate(() => {
      const r = document.querySelector('.risu-chat[data-chat-index="6"] .x-risu-status').getBoundingClientRect(), v = document.querySelector('[x-omni-vn]').getBoundingClientRect();
      return Math.round(r.top + r.height / 2 - (v.top + v.height / 2));
    });
    assert.ok(Math.abs(middle) <= 2, `in the viewer's middle, up and down: ${middle}`);
    assert.equal(await popShown(), true);
    // Its button is Risu's, and the story stays; Risu draws the message anew, and the new panel is seen in its place.
    const button = await page.locator('.risu-chat[data-chat-index="6"] [risu-btn="hit"]').boundingBox();
    await page.mouse.click(button.x + button.width / 2, button.y + button.height / 2);
    await page.waitForFunction(() => (window.risuClicks || []).includes('hit'));
    await page.waitForFunction(() => /HP 2/.test(document.querySelector('.risu-chat[data-chat-index="6"] .x-risu-status')?.textContent || ''));
    await page.waitForTimeout(400);
    assert.equal(await seen(), true, 'drawn anew, still seen through its hole');
    assert.equal(await text(), before, 'the tap moved no story on');
    // A tap anywhere else folds it, and is only that.
    const frame = await page.locator('[x-omni-vn]').boundingBox(), pop = await page.evaluate(() => document.querySelector('.risu-chat[data-chat-index="6"] .x-risu-status').getBoundingClientRect().toJSON());
    await page.mouse.click(frame.x + frame.width / 2, pop.top - 40);
    await page.waitForFunction(() => !/evenodd/.test(document.querySelector('[x-omni-vn-style="live"]')?.textContent || ''));
    assert.equal(await seen(), false);
    assert.equal(await popShown(), false);
    assert.doesNotMatch(await page.evaluate(() => document.querySelector('[x-omni-vn-style="live"]')?.textContent || ''), /clip-path/);
    assert.equal(await text(), before, 'the folding tap moved no story on');
    // The tile is dragged anywhere, outside 편집 too, and keeps its place; a drag opens nothing.
    await page.waitForTimeout(300);
    const t0 = await tileBox(), was = (await savedRule(page))[0];
    await page.mouse.move(t0.x + 20, t0.y + 20); await page.mouse.down();
    await page.mouse.move(t0.x + 60, t0.y + 60, { steps: 5 }); await page.mouse.move(t0.x + 100, t0.y + 120, { steps: 5 }); await page.mouse.up();
    await page.waitForFunction(y => Math.abs(document.querySelector('[x-omni-vn] [data-vn-tile]').getBoundingClientRect().top - y - 100) < 8, t0.y);
    for (let i = 0; i < 30 && (await savedRule(page))[0]?.y === was.y; i++) await page.waitForTimeout(100);
    assert.notEqual((await savedRule(page))[0].y, was.y, 'its place kept');
    await page.waitForTimeout(300);
    assert.equal(await seen(), false, 'the drag opened nothing');
    // A button of the viewer's folds it and does its own: 기록 opens.
    await tapTile();
    await page.waitForFunction(holeCut);
    await press('log');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[x-omni-vn] [data-vn-log]')).display !== 'none');
    await page.waitForFunction(() => !/evenodd/.test(document.querySelector('[x-omni-vn-style="live"]')?.textContent || ''));
    await press('log');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[x-omni-vn] [data-vn-log]')).display === 'none');
    await page.waitForTimeout(300);
    assert.equal(await seen(), false, 'folded for good: closing 기록 does not open it again');
    // Escape folds it too.
    await tapTile();
    await page.waitForFunction(holeCut);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !/evenodd/.test(document.querySelector('[x-omni-vn-style="live"]')?.textContent || ''));
    // A box of Risu's page around it moved (an inline !important transform on the list): it is scrolled to the
    // middle all the same, and seen through its hole there.
    await page.evaluate(() => document.querySelector('.flex-col-reverse').style.setProperty('transform', 'translate(12px, 30px)', 'important'));
    await tapTile();
    await page.waitForFunction(holeCut);
    await page.waitForFunction(() => {
      const r = document.querySelector('.risu-chat[data-chat-index="6"] .x-risu-status').getBoundingClientRect(), v = document.querySelector('[x-omni-vn]').getBoundingClientRect();
      return Math.abs(r.top + r.height / 2 - (v.top + v.height / 2)) <= 2;
    });
    assert.equal(await seen(), true, 'through its hole, where it stands now');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !/evenodd/.test(document.querySelector('[x-omni-vn-style="live"]')?.textContent || ''));
    await page.evaluate(() => document.querySelector('.flex-col-reverse').style.removeProperty('transform'));
    // An older reply, folded away behind the viewer: its tile opens a copy (its buttons are not Risu's there), said so.
    for (let i = 0; i < 10 && !/전날 밤은 조용했다/.test(await text()); i++) { await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(350); }
    await page.waitForFunction(() => !!document.querySelector('[x-omni-vn] [data-vn-tile]'));
    await page.waitForTimeout(300);
    await tapTile();
    await page.waitForFunction(() => /HP 9/.test(document.querySelector('[x-omni-vn] [data-vn-pop]')?.textContent || ''));
    assert.equal(await isFixed(0), false);
    assert.match(await page.evaluate(() => document.querySelector('[x-omni-vn] [data-vn-pop] [x-vn-pop-note]')?.textContent || ''), /복사본/);
    // Closed: the chat as it was, none of the viewer's sheets left.
    await press('close');
    await page.waitForFunction(() => !document.querySelector('[x-omni-vn]'));
    assert.equal(await isFixed(6), false);
    assert.equal(await page.evaluate(() => document.querySelectorAll('[x-omni-vn-style]').length), 0);
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.flex-col-reverse')).paddingTop), '0px', 'the room made in the list gone with it');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

// On a phone a finger must land on what it drags, and the move must not be taken for a pan (the phone would cancel
// the press a few pixels on, and the drag stop there). The sticker layer lets presses through, so what is dragged
// takes them itself: the title bar and the tile at any time, a sticker in 편집.
test('요소 on a phone: a finger lands on the title bar, the 작동 tile and, in 편집, a sticker, never panning, and drags them', async () => {
  const twoKinds = replyHtml + '<div class="x-risu-card" style="width:120px;height:40px;background:#533">카드</div>';
  const { browser, page, errors, open, press, tapChip } = await openViewerPage({ messages: MESSAGES, html: i => i === 6 ? twoKinds : `<p>${MESSAGES[i].data}</p>`, touch: true });
  try {
    const cdp = await page.context().newCDPSession(page);
    const touchDrag = async (x, y, dx, dy) => {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      for (let i = 1; i <= 10; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx * i / 10, y: y + dy * i / 10 }] }); await page.waitForTimeout(20); }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };
    // What the finger lands on, and the touch-action it gets: not inherited, but what a touch may do is all of its
    // boxes' at once (the element's and every one around it), so one 'none' on the way up forbids the pan.
    const landsOn = (x, y) => page.evaluate(([x, y]) => {
      const el = document.elementFromPoint(x, y);
      let touch = 'auto';
      for (let n = el; n && n.nodeType === 1; n = n.parentElement) { const t = getComputedStyle(n).touchAction; if (t === 'none') { touch = 'none'; break; } if (touch === 'auto') touch = t; }
      return { what: el?.closest('[x-vn-st-bar]') ? 'bar' : el?.closest('[data-vn-tile]') ? 'tile' : el?.closest('[x-vn-st]') ? 'sticker' : String(el?.tagName), touch };
    }, [x, y]);
    await open();
    await press('elems');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[x-omni-vn] [data-vn-act="eledit"]')).visibility === 'visible');
    await press('eledit');
    await page.waitForFunction(() => document.querySelectorAll('[x-omni-vn] [data-vn-edit] [data-vn-el]').length === 2);
    await page.waitForTimeout(400);
    await tapChip('status', '스티커');
    await page.waitForFunction(() => !!document.querySelector('[x-omni-vn] [x-vn-st] .x-risu-status'));
    await page.waitForTimeout(400);
    await tapChip('status', '접기');
    await page.waitForFunction(() => !!document.querySelector('[x-omni-vn] [x-vn-st-bar]'));
    await page.waitForTimeout(400);
    await tapChip('card', '작동');
    await page.waitForFunction(() => !!document.querySelector('[x-omni-vn] [data-vn-tile]'));
    await page.waitForTimeout(400);
    // 편집: a finger on a sticker lands on it (none of what is in it), and does not pan. (Its left edge: the panel
    // covers the rest of it on a phone-wide stage.)
    const st = await page.locator('[x-omni-vn] [x-vn-st]:has(.x-risu-status)').boundingBox();
    assert.deepEqual(await landsOn(st.x + 12, st.y + st.height - 12), { what: 'sticker', touch: 'none' });
    await press('eledit');
    await page.waitForTimeout(500);
    // Out of 편집 the bar and the tile take the finger themselves.
    const bar = await page.locator('[x-omni-vn] [x-vn-st-bar]').boundingBox(), tile = await page.locator('[x-omni-vn] [data-vn-tile]').boundingBox();
    assert.deepEqual(await landsOn(bar.x + 20, bar.y + bar.height / 2), { what: 'bar', touch: 'none' });
    assert.deepEqual(await landsOn(tile.x + tile.width / 2, tile.y + tile.height / 2), { what: 'tile', touch: 'none' });
    // And a finger drags each of them all the way.
    await touchDrag(tile.x + tile.width / 2, tile.y + tile.height / 2, 80, 120);
    await page.waitForFunction(y => Math.abs(document.querySelector('[x-omni-vn] [data-vn-tile]').getBoundingClientRect().top - y - 120) < 10, tile.y);
    await page.waitForTimeout(400);
    await touchDrag(bar.x + 20, bar.y + bar.height / 2, 60, 100);
    await page.waitForFunction(y => Math.abs(document.querySelector('[x-omni-vn] [x-vn-st-bar]').getBoundingClientRect().top - y - 100) < 10, bar.y);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

// The reader's message has its own panel (다음 유저 메시지), and the bot's panels come in the reply or in the message
// after it: each registered as 작동 from both tabs, picked with 선택 and grouped twice (A, B); a group is one tile
// opening the newest one there is.
test('요소: 다음 유저 메시지 finds the reader\'s panel; 선택 picks tiles, 그룹화 makes group A then B, each opens only the newest there is; 분리 lets go', async () => {
  const card = label => `<div class="x-risu-card" style="width:150px;height:44px;background:#533">${label}</div>`;
  const chat = [
    { role: 'char', chatId: 'a0', data: '전날 밤은 조용했다.' }, { role: 'user', data: '안녕' },
    { role: 'char', chatId: 'a2', data: '바람이 불었다.' }, { role: 'user', data: '가자' },
    { role: 'char', chatId: 'a4', data: reply }, { role: 'user', data: '(나의 상태)' },
    { role: 'char', chatId: 'a6', data: '상태가 갱신되었다.' },
  ];
  const html = i => i === 4 ? replyHtml + card('카드 4')
    : i === 5 ? '<p>(나의 상태)</p><div class="x-risu-mine" style="width:150px;height:40px;background:#535">나 HP 7</div>'
    : i === 6 ? '<p>상태가 갱신되었다.</p><div class="x-risu-status" style="width:180px;height:60px;background:#355">HP 1 갱신</div>' + card('카드 6')
    : `<p>${chat[i].data}</p>`;
  const { browser, page, errors, open, press, tapChip } = await openViewerPage({ messages: chat, html });
  try {
    const text = () => page.evaluate(() => document.querySelector('[x-omni-vn] [data-vn-text]')?.textContent || '');
    const tabAt = async i => { const b = await page.locator('[x-omni-vn] [data-vn-tabs] i').nth(i).boundingBox(); await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); await page.waitForTimeout(400); };
    // What the popup shows: the chat's element at its frame's middle, through the hole ("message:kind").
    const seenIn = () => page.evaluate(() => {
      const f = document.querySelector('[x-omni-vn] [data-vn-pop]');
      if (!f || getComputedStyle(f).display === 'none') return '';
      const r = f.getBoundingClientRect(), at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2), chat = at?.closest('.risu-chat');
      return chat ? `${chat.dataset.chatIndex}:${at.closest('.x-risu-status') ? 'status' : at.closest('.x-risu-card') ? 'card' : '?'}` : '';
    });
    const centre = async locator => { const b = await locator.boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
    const tap = async locator => { const c = await centre(locator); await page.mouse.click(c.x, c.y); await page.waitForTimeout(150); };
    const tiles = label => page.locator('[x-omni-vn] [x-vn-st] [data-vn-tile]:not([data-vn-group])', { hasText: label });
    const button = name => page.locator(`[x-omni-vn] [data-vn-gb="${name}"]`);
    const badges = letter => page.evaluate(l => [...document.querySelectorAll('[x-omni-vn] [x-vn-st] [data-vn-tile]:not([data-vn-group]) i')].filter(i => i.textContent === l).length, letter);
    const opened = async () => { await page.waitForFunction(() => /evenodd/.test(document.querySelector('[x-omni-vn-style="live"]')?.textContent || '')); return seenIn(); };
    const fold = async () => { await page.keyboard.press('Escape'); await page.waitForFunction(() => !/evenodd/.test(document.querySelector('[x-omni-vn-style="live"]')?.textContent || '')); };
    await open();
    await page.waitForFunction(() => /갱신되었다/.test(document.querySelector('[x-omni-vn] [data-vn-text]')?.textContent || ''));
    await page.keyboard.press('ArrowLeft');
    await page.waitForFunction(() => /늦었지/.test(document.querySelector('[x-omni-vn] [data-vn-text]')?.textContent || ''));
    await press('elems');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[x-omni-vn] [data-vn-act="eledit"]')).visibility === 'visible');
    await press('eledit');
    await page.waitForFunction(() => document.querySelectorAll('[x-omni-vn] [data-vn-edit] [data-vn-el]').length > 0);
    await page.waitForTimeout(400);
    // 이 답장: the status panel and the card, 작동.
    await tapChip('status', '작동');
    await page.waitForFunction(() => document.querySelectorAll('[x-omni-vn] [data-vn-tile]').length === 1);
    await page.waitForTimeout(300);
    await tapChip('card', '작동');
    await page.waitForFunction(() => document.querySelectorAll('[x-omni-vn] [data-vn-tile]').length === 2);
    // 다음 유저 메시지: the reader's own panel, as a sticker from that message.
    await tabAt(1);
    await page.waitForFunction(() => [...document.querySelectorAll('[x-omni-vn] [data-vn-el] b')].map(b => b.textContent).join() === 'mine');
    await tapChip('mine', '스티커');
    await page.waitForFunction(() => /나 HP 7/.test(document.querySelector('[x-omni-vn] [x-vn-st] [x-vn-st-body]')?.textContent || ''));
    // 다음 메시지 1: the same two, registered again from there (rules of their own), 작동.
    await tabAt(2);
    await page.waitForFunction(() => /갱신/.test(document.querySelector('[x-omni-vn] [data-vn-el] span')?.textContent || ''));
    await tapChip('status', '작동');
    await page.waitForFunction(() => document.querySelectorAll('[x-omni-vn] [data-vn-tile]').length === 3);
    await page.waitForTimeout(300);
    await tapChip('card', '작동');
    await page.waitForFunction(() => document.querySelectorAll('[x-omni-vn] [data-vn-tile]').length === 4);
    await page.waitForTimeout(500);
    // 선택 on, the two status tiles picked (✓), 그룹화: group A. The two cards picked, 그룹화: group B.
    await tap(button('select'));
    await page.waitForFunction(() => /data-vn-gb="select"\]\{color:#1a1408/.test(document.querySelector('[x-omni-vn-style="scene"]')?.textContent || ''));
    await tap(tiles('status').nth(0));
    await tap(tiles('status').nth(1));
    await page.waitForFunction(() => [...document.querySelectorAll('[x-omni-vn] [data-vn-tile]')].filter(t => getComputedStyle(t, '::after').content.includes('✓')).length === 2);
    await tap(button('group'));
    await page.waitForFunction(() => [...document.querySelectorAll('[x-omni-vn] [x-vn-st] [data-vn-tile] i')].filter(i => i.textContent === 'A').length === 2);
    await page.waitForTimeout(400);
    await tap(tiles('card').nth(0));
    await tap(tiles('card').nth(1));
    await tap(button('group'));
    await page.waitForFunction(() => [...document.querySelectorAll('[x-omni-vn] [x-vn-st] [data-vn-tile] i')].filter(i => i.textContent === 'B').length === 2);
    for (let i = 0; i < 30 && (await savedRule(page)).filter(r => r.group).length !== 4; i++) await page.waitForTimeout(100);
    let saved = await savedRule(page);
    assert.deepEqual(saved.filter(r => r.role === 'live').map(r => [r.group, r.from]).sort(), [['A', 0], ['A', 1], ['B', 0], ['B', 1]], 'each panel from two tabs, a group each');
    for (const g of ['A', 'B']) assert.equal(new Set(saved.filter(r => r.group === g).map(r => `${r.gx},${r.gy}`)).size, 1, `one place for group ${g}`);
    await press('eledit');
    await page.waitForTimeout(500);
    // Out of 편집: a tile per group, no member tile, the reader's sticker as it was.
    assert.equal(await tiles('status').count() + await tiles('card').count(), 0);
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('[x-omni-vn] [data-vn-group]')].map(t => t.getAttribute('data-vn-group')).sort()), ['A', 'B']);
    assert.match(await page.evaluate(() => document.querySelector('[x-omni-vn] [x-vn-st] [x-vn-st-body]')?.textContent || ''), /나 HP 7/);
    // Each opens only the newest there is: the bot's next message's (6), not the reply's (4).
    const before = await text();
    await tap(page.locator('[x-omni-vn] [data-vn-group="A"]'));
    assert.equal(await opened(), '6:status');
    assert.equal(await text(), before);
    await fold();
    await tap(page.locator('[x-omni-vn] [data-vn-group="B"]'));
    assert.equal(await opened(), '6:card');
    await fold();
    // On the reply before (2): none in it, its next message (4) has both: only those are there, and they open.
    for (let i = 0; i < 10 && !/바람이 불었다/.test(await text()); i++) { await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(350); }
    await page.waitForFunction(() => document.querySelectorAll('[x-omni-vn] [data-vn-group]').length === 2);
    await page.waitForTimeout(300);
    await tap(page.locator('[x-omni-vn] [data-vn-group="A"]'));
    assert.equal(await opened(), '4:status');
    await fold();
    await tap(page.locator('[x-omni-vn] [data-vn-group="B"]'));
    assert.equal(await opened(), '4:card');
    await fold();
    // 분리: in 편집 the members are tiles again; 선택, one of A's picked, 분리: A left with one is no group; B stays.
    for (let i = 0; i < 10 && !/늦었지/.test(await text()); i++) { await page.keyboard.press('ArrowRight'); await page.waitForTimeout(350); }
    await press('eledit');
    await page.waitForFunction(() => document.querySelectorAll('[x-omni-vn] [x-vn-st] [data-vn-tile]:not([data-vn-group])').length === 4);
    await page.waitForTimeout(500);
    await tap(button('select'));
    await tap(tiles('status').nth(0));
    await tap(button('split'));
    await page.waitForFunction(() => ![...document.querySelectorAll('[x-omni-vn] [x-vn-st] [data-vn-tile] i')].some(i => i.textContent === 'A'));
    assert.equal(await badges('B'), 2);
    for (let i = 0; i < 30 && (await savedRule(page)).filter(r => r.group).length !== 2; i++) await page.waitForTimeout(100);
    saved = await savedRule(page);
    assert.deepEqual(saved.filter(r => r.role === 'live').map(r => r.group).sort(), ['', '', 'B', 'B'], 'A undone, B as it was');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
