import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

// Six replies with the reader's turns between them; 세라 first speaks in the fifth.
const REPLIES = [
  ['오미선: "R0 첫 번째 §쾅§ 답장이야."', '하린: "R0 응, 들었어."'],
  ['하린: "R1 오늘은 비가 오네."', '오미선: "R1 우산 챙겼어?"'],
  ['오미선: "R2 카페로 가자."', '하린: "R2 좋아, 창가 자리로."'],
  ['하린: "R3 나도 끼워 줘."', '오미선: "R3 물론이지."'],
  ['세라: "R4 나 왔어."', '하린: "R4 벌써 저녁이네."'],
  ['오미선: "R5 내일 또 보자."', '하린: "R5 잘 가."'],
];

test('옴니 뷰어 over a restricted SafeDOM gets out of its own way: opened at the chat\'s middle, the chat read once, each line first, 메시지 a few at a time, 👨‍👩‍👧‍👦 to the people', async () => {
  const built = await build({ stdin: { contents: "import {installOmniViewer,viewerOpen} from './src/viewer/omni-viewer';import {loadTtsData,ttsData} from './src/storage/tts-store';import {loadEmotionData,emotionData} from './src/storage/emotion-store';import {viewerCovering} from './src/services/viewer-presence';import {soundPage,soundFocus} from './src/sound-ui/page';import {loadSoundData,soundData} from './src/storage/sound-store';import {viewerPrefs,saveViewerPrefs} from './src/storage/viewer-prefs';import {omniSound} from './src/services/sound-runtime';Object.assign(window,{omniSound,installOmniViewer,viewerOpen,loadTtsData,ttsData,loadEmotionData,emotionData,viewerCovering,soundPage,soundFocus,loadSoundData,soundData,viewerPrefs,saveViewerPrefs});", resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife' });
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 400, height: 900 } }), errors = [];
    page.setDefaultTimeout(8000); page.on('pageerror', e => errors.push(e.message));
    await page.route('https://vn.test/', r => r.fulfill({ contentType: 'text/html', body: '<html><head></head><body style="margin:0"></body></html>' })); await page.goto('https://vn.test/');
    await page.addScriptTag({ content: readFileSync('node_modules/dompurify/dist/purify.min.js', 'utf8') });
    await page.evaluate(({ replies }) => {
      // Every call in order: what it was and on what (the box, a person's place).
      window.log = []; window.reads = { getCharacter: 0, getCharacterFromIndex: 0 }; window.storageSets = []; window.scrolls = []; window.names = {}; window.buttons = {};
      const what = node => node.matches?.('[data-vn-box]') ? 'box' : node.matches?.('[data-vn-msgs]') ? 'msgs' : node.tagName?.toLowerCase() || '';
      class Safe {
        constructor(node) { this.node = node; }
        release() {}
        async querySelector(s) { window.log.push(['querySelector', s]); const n = this.node.querySelector(s); return n ? new Safe(n) : null; }
        async querySelectorAll(s) { window.log.push(['querySelectorAll', s]); return [...this.node.querySelectorAll(s)].map(n => new Safe(n)); }
        async setAttribute(k, v) { if (!k.startsWith('x-')) throw Error('Forbidden attribute write ' + k); window.log.push(['setAttribute', k]); this.node.setAttribute(k, v); }
        async getAttribute(k) { if (!k.startsWith('x-')) throw Error('Forbidden attribute read ' + k); return this.node.getAttribute(k); }
        async setTextContent(v) { window.log.push(['setTextContent', what(this.node)]); this.node.textContent = v; }
        async getOuterHTML() { window.log.push(['getOuterHTML', '']); return this.node.outerHTML; }
        async innerText() { window.log.push(['innerText', '']); return this.node.innerText; }
        async scrollIntoView(o) { window.scrolls.push(o); this.node.scrollIntoView(o); }
        async setInnerHTML(v) { const target = what(this.node); window.log.push(['setInnerHTML', target]); if (target === 'msgs' && window.slowList) await new Promise(r => setTimeout(r, window.slowList)); this.node.innerHTML = DOMPurify.sanitize(v); }
        async setStyleAttribute(v) { this.node.style.cssText = v; }
        async appendChild(child) { window.log.push(['appendChild', '']); this.node.append(child.node); }
        async remove() { this.node.remove(); }
        async cloneNode(deep) { return new Safe(this.node.cloneNode(deep)); }
        async getBoundingClientRect() { window.log.push(['rect', '']); return this.node.getBoundingClientRect().toJSON(); }
        async addEventListener(type, fn) { const cb = e => fn({ clientX: e.clientX, clientY: e.clientY, key: e.key, repeat: e.repeat }); document.addEventListener(type, cb); return String(Math.random()); }
        async removeEventListener() {}
        async createElement(tag) { window.log.push(['createElement', tag]); return new Safe(document.createElement(tag)); }
      }
      const messages = [];
      replies.forEach((lines, r) => { messages.push({ role: 'char', chatId: `r${r}`, data: lines.join('\n') }); if (r < replies.length - 1) messages.push({ role: 'user', chatId: `u${r}`, data: '응, 계속해.' }); });
      // Tall messages, newest first in the page as Risu draws them: the middle of the screen is one of them.
      const row = (m, i) => `<div class="chat-message-container"><div class="risu-chat" data-chat-index="${i}" style="height:300px"><div class="chattext">${m.data.split('\n').map(l => `<p>${l}</p>`).join('')}</div></div></div>`;
      document.body.innerHTML = `<div class="default-chat-screen" style="position:fixed;inset:0;overflow:auto;display:flex;flex-direction:column-reverse"><div style="height:90px;flex:none">입력창</div><div class="flex-col-reverse" style="display:flex;flex-direction:column-reverse;flex:none">${messages.map(row).reverse().join('')}</div></div>`;
      const bot = { chaId: 'bot', name: 'Bot', additionalAssets: [['오미선_neutral', 'assets/a.png', 'png'], ['하린_neutral', 'assets/b.png', 'png'], ['세라_neutral', 'assets/c.png', 'png']], chats: [{ id: 'chat', message: messages }], chatPage: 0 };
      const saved = new Map(), local = new Map(); window.local = local;
      const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), c => c.charCodeAt(0));
      window.risuai = { pluginStorage: { getItem: async k => saved.get(k), setItem: async (k, v) => { window.storageSets.push(k); saved.set(k, v); } }, getLocalPluginStorage: async () => ({ getItem: async k => local.get(k), setItem: async (k, v) => local.set(k, v), removeItem: async k => local.delete(k) }),
        getDatabase: async () => ({ modules: [], enabledModules: [] }), getCurrentCharacterIndex: async () => 0, getCurrentChatIndex: async () => 0,
        getCharacterFromIndex: async () => { window.reads.getCharacterFromIndex++; return structuredClone(bot); },
        getCharacter: async () => { window.reads.getCharacter++; if (window.charDelay) await new Promise(r => setTimeout(r, window.charDelay)); return structuredClone(bot); },
        readImage: async () => png, getRootDocument: async () => new Safe(document), registerButton: async (arg, fn) => { window.buttons[arg.id] = fn; window.names[arg.id] = arg.name; (window.places ||= {})[arg.id] = arg.location; (window.icons ||= {})[arg.id] = arg.icon; return { id: arg.id }; },
        unregisterUIPart: async id => { for (const map of [window.buttons, window.names, window.places, window.icons]) delete map[id]; } };
    }, { replies: REPLIES });
    await page.evaluate(() => { window.crypto.randomUUID = undefined; });
    await page.addScriptTag({ content: built.outputFiles[0].text });
    await page.evaluate(async () => {
      await window.loadTtsData(); const d = window.ttsData(); d.settings.enabled = false;
      for (const [id, name] of [['t-misun', '오미선'], ['t-harin', '하린'], ['t-sera', '세라']]) d.characters.push({ id, scope: 'global', name, surname: '', givenName: name, surnameAliases: [], givenAliases: [], triggers: [], tags: [], gender: 'female', voiceKey: '', fishId: '', fixed: false, gain: 0 });
      await window.loadEmotionData(); window.emotionData().settings.autoGenerate = false;
      await window.loadSoundData(); window.soundData().settings.sfxEnabled = true;
      // Effects heard, as words: no clip is made in the test.
      window.sfxPlayed = []; window.omniSound.playSfxWord = async word => { window.sfxPlayed.push(word); return true; };
      await window.installOmniViewer();
    });
    const text = () => page.evaluate(() => document.querySelector('[x-omni-vn] [data-vn-text]')?.textContent || '');
    const scene = () => page.evaluate(() => document.querySelector('[x-omni-vn-style="scene"]')?.textContent || '');
    const shows = re => page.waitForFunction(source => new RegExp(source).test(document.querySelector('[x-omni-vn] [data-vn-text]')?.textContent || ''), re.source);

    // 바로가기: two ways in, each an entry of the chat's menu beside ⚛️Omni Nexus (on unless switched off) and a floating
    // button (off unless switched on); the side bar's menu (hamburger) has none of it. 보던 곳 wears 📽️, 화면 중앙 🎯.
    const shortcuts = () => page.evaluate(() => Object.keys(window.names).sort().map(id => [id, window.places[id], window.names[id], /🎯/.test(window.icons[id]) ? '🎯' : /📽️/.test(window.icons[id]) ? '📽️' : window.icons[id]]));
    const all = [['omni-viewer-action', 'action', '⚛️Omni 뷰어 · 보던 곳', '📽️'], ['omni-viewer-action-center', 'action', '⚛️Omni 뷰어 · 화면 중앙', '🎯'],
      ['omni-viewer-chat', 'chat', '⚛️Omni 뷰어 · 보던 곳', '📽️'], ['omni-viewer-chat-center', 'chat', '⚛️Omni 뷰어 · 화면 중앙', '🎯']];
    assert.deepEqual(await shortcuts(), [all[2], all[3]]);
    // Each switch puts its own button up or takes it down, at once; the others stay.
    await page.evaluate(() => window.saveViewerPrefs({ floatResume: true, floatCenter: true, menuResume: false }));
    await page.waitForFunction(() => Object.keys(window.buttons).length === 3 && !('omni-viewer-chat' in window.buttons));
    assert.deepEqual(await shortcuts(), [all[0], all[1], all[3]]);
    await page.evaluate(() => window.saveViewerPrefs({ floatResume: false, floatCenter: false, menuResume: true }));
    await page.waitForFunction(() => Object.keys(window.buttons).length === 2 && 'omni-viewer-chat' in window.buttons);
    assert.deepEqual(await shortcuts(), [all[2], all[3]]);

    // 화면 중앙: the chat scrolled so the reader's turn after R2 is in the middle; that turn's next reply opens, from its top.
    await page.evaluate(() => document.querySelector('.risu-chat[data-chat-index="5"]').scrollIntoView({ block: 'center' }));
    await page.evaluate(() => { window.log = []; window.charDelay = 500; window.buttons['omni-viewer-chat-center'](); });
    // Never a blank frame: the spinner turns while the chat is read.
    await page.waitForFunction(() => /\[data-vn-busy\]\{display:block\}/.test(document.querySelector('[x-omni-vn-style="scene"]')?.textContent || ''));
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('[x-omni-vn] [data-vn-busy]')).display), 'block');
    await shows(/R3 나도 끼워 줘/);
    assert.doesNotMatch(await scene(), /data-vn-busy/, 'the first line came: the spinner went');
    await page.evaluate(() => { window.charDelay = 0; });
    assert.equal(await page.evaluate(() => window.viewerCovering()), true, 'open, it covers the chat (its TTS buttons rest behind it)');
    // Once each: the chat, and (the first time this session) the TTS roster its bot's lorebook. The viewer reads no second copy for the bot.
    assert.deepEqual(await page.evaluate(() => ({ ...window.reads })), { getCharacter: 1, getCharacterFromIndex: 1 }, 'opening read the character once');
    // Turning to the next reply: its line goes out before anything else of its scene, 세라's place (new on stage) after it.
    const step = async (key, until) => { for (let i = 0; i < 8 && !until.test(await text()); i++) { await page.keyboard.press(key); await page.waitForTimeout(350); } await shows(until); };
    await step('ArrowRight', /R3 물론이지/);
    await page.waitForTimeout(600);
    await page.evaluate(() => { window.log = []; });
    await page.keyboard.press('ArrowRight');
    await shows(/R4 나 왔어/);
    await page.waitForFunction(() => window.log.some(([name, on]) => name === 'setAttribute' && on === 'x-vn-p'));
    const order = await page.evaluate(() => window.log.map(([name, on]) => name + ':' + on));
    const boxAt = order.indexOf('setInnerHTML:box'), placeAt = order.indexOf('createElement:div');
    assert.ok(boxAt >= 0 && placeAt > boxAt, "the line before the new person's place: " + order.slice(0, placeAt + 2).join(' '));

    // Back to R2 and on into R4 again: turning to another reply reads nothing.
    await step('ArrowLeft', /R2 /);
    await step('ArrowRight', /R4 나 왔어/);
    assert.deepEqual(await page.evaluate(() => ({ ...window.reads })), { getCharacter: 1, getCharacterFromIndex: 1 }, 'no reply turned to read the character again');
    await step('ArrowLeft', /R3 물론이지/);

    // Where the reader is goes to the device, never the save file (each write there made Risu rewrite its whole store).
    await page.waitForFunction(() => !!window.local.get('omniviewer.marks'), null, { timeout: 4000 });
    assert.equal(await page.evaluate(() => window.storageSets.includes('omniviewer.marks')), false);

    // The line can be copied: a drag across it selects its letters and moves nothing on; a tap still goes on.
    await page.waitForTimeout(900);
    const line = await page.locator('[x-omni-vn] [data-vn-text]').boundingBox(), was = await text();
    await page.mouse.move(line.x + 3, line.y + 14); await page.mouse.down();
    await page.mouse.move(line.x + line.width - 8, line.y + 16, { steps: 8 }); await page.mouse.up();
    await page.waitForTimeout(500);
    assert.equal(await text(), was, 'a drag on the line is no tap');
    assert.ok((await page.evaluate(() => String(getSelection()))).length >= 4, 'its letters are selected: ' + await page.evaluate(() => String(getSelection())));
    // Down across the line (more lines, or a long one scrolled): still a selection, never a swipe back.
    // (From a fresh press: one on the selection would drag the selected text instead.)
    await page.evaluate(() => getSelection().removeAllRanges());
    await page.mouse.move(line.x + 3, line.y + 6); await page.mouse.down();
    await page.mouse.move(line.x + 40, line.y + 90, { steps: 8 }); await page.mouse.up();
    await page.waitForTimeout(500);
    assert.equal(await text(), was, 'a drag down the line is no swipe');
    // 메시지: the reply on stage and one either side, ▲ ▼ for more; nothing scrolled.
    const press = async act => { const b = await page.locator(`[x-omni-vn] [data-vn-act="${act}"]`).boundingBox(); await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); };
    // 효과음 off: the viewer's own switch, dimmed, as VOICE is.
    const sfxShown = () => page.evaluate(() => getComputedStyle(document.querySelector('[x-omni-vn] [data-vn-act="sfx"]')).opacity);
    assert.equal(await sfxShown(), '1');
    await page.waitForTimeout(300);
    await press('sfx');
    await page.waitForFunction(() => window.viewerPrefs().sfx === false && getComputedStyle(document.querySelector('[x-omni-vn] [data-vn-act="sfx"]')).opacity === '0.4');
    await page.waitForTimeout(300);
    await press('msgs');
    const rows = () => page.locator('[x-omni-vn] [data-vn-msgs] [data-vn-msg]').allTextContents();
    await page.waitForFunction(() => document.querySelectorAll('[x-omni-vn] [data-vn-msgs] [data-vn-msg]').length === 5);
    const listed = await rows();
    assert.match(listed[0], /▲ 이전 답장 2개 더 보기/);
    assert.deepEqual(listed.slice(1, 4).map(t => t.match(/^#\d+/)?.[0]), ['#5', '#7', '#9'], 'R2, R3 (on stage), R4');
    assert.match(listed[4], /▼ 다음 답장 1개 더 보기/);
    assert.equal(await page.locator('[x-omni-vn] [data-vn-msg][data-now]').count(), 1);
    await page.waitForTimeout(500);
    // ▲: its row turns while the older ones come in.
    await page.evaluate(() => { window.slowList = 600; });
    const more = await page.locator('[x-omni-vn] [data-vn-msg][data-more="before"]').boundingBox();
    await page.mouse.click(more.x + more.width / 2, more.y + more.height / 2);
    await page.waitForFunction(() => /\[data-vn-msg\]\[data-more="before"\]::after\{content:""/.test(document.querySelector('[x-omni-vn-style="scene"]')?.textContent || ''));
    await page.waitForFunction(() => document.querySelectorAll('[x-omni-vn] [data-vn-msgs] [data-vn-msg]').length === 6);
    await page.waitForFunction(() => !/data-more="before"\]::after/.test(document.querySelector('[x-omni-vn-style="scene"]')?.textContent || ''));
    assert.deepEqual((await rows()).slice(0, 5).map(t => t.match(/^#\d+/)?.[0]), ['#1', '#3', '#5', '#7', '#9'], 'every older reply in, no ▲ left');
    await page.evaluate(() => { window.slowList = 0; });
    assert.deepEqual(await page.evaluate(() => window.scrolls), [], 'the list was not scrolled (on a phone that moved the whole screen)');
    // A tile jumps to its reply: the list goes at once.
    await page.waitForTimeout(300);
    const oldest = await page.locator('[x-omni-vn] [data-vn-msg]').first().boundingBox();
    await page.mouse.click(oldest.x + oldest.width / 2, oldest.y + oldest.height / 2);
    await shows(/R0 첫 번째/);
    assert.doesNotMatch(await scene(), /\[data-vn-msgs\]\{translate:0 0\}/);
    await page.waitForTimeout(400);
    assert.deepEqual(await page.evaluate(() => window.sfxPlayed), [], "off, the line's effect is passed over");

    // 기록 scrolls its own list only: never the page around it.
    await page.waitForTimeout(400);
    await press('log');
    await page.waitForFunction(() => window.scrolls.length > 0);
    for (const o of await page.evaluate(() => window.scrolls)) assert.ok(o.container === 'nearest' || o.block === 'nearest', 'a list scroll that keeps to its list: ' + JSON.stringify(o));
    await press('log');

    // On again: back at that reply (away and back), its effect sounds.
    await press('sfx');
    await page.waitForFunction(() => window.viewerPrefs().sfx === true && getComputedStyle(document.querySelector('[x-omni-vn] [data-vn-act="sfx"]')).opacity === '1');
    await step('ArrowRight', /R1 /);
    await step('ArrowLeft', /R0 /);
    await page.waitForFunction(() => window.sfxPlayed.includes('쾅'));
    // 👨‍👩‍👧‍👦: TTS 캐릭터, this reply's people searched (two of them: the list, no one's sheet); the viewer closes
    // once the page says it is up, as for ⚙.
    await page.evaluate(() => { window.__OMNI_OPEN_TTS__ = () => { const f = window.soundFocus(); window.ttsOpened = { page: window.soundPage(), focus: { panel: f.panel, search: f.search, sheet: f.sheet ?? null, shown: typeof f.shown } }; setTimeout(() => f.shown(), 200); }; });
    await page.waitForTimeout(300);
    await press('cast');
    await page.waitForFunction(() => !!window.ttsOpened);
    assert.deepEqual(await page.evaluate(() => window.ttsOpened), { page: 'people', focus: { panel: 'tts-characters', search: '오미선, 하린', sheet: null, shown: 'function' } });
    await page.waitForFunction(() => !window.viewerOpen());
    assert.equal(await page.evaluate(() => window.viewerCovering()), false);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('the bottom row keeps every button on a phone, 효과음, 배속 and |◀ ▶| among them, from 320 px wide on', async () => {
  const built = await build({ stdin: { contents: "import {FRAME,STATIC_CSS,stageCss} from './src/viewer/look';Object.assign(window,{FRAME,STATIC_CSS,stageCss});", resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife' });
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  try {
    for (const width of [320, 360, 375, 380, 381, 393, 412, 421, 430, 480]) {
      // A phone: a finger's pointer, so the bigger buttons.
      const page = await browser.newPage({ viewport: { width, height: 780 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
      // As Risu's page: laid out at the phone's own width (without this a phone lays a page out 980 px wide).
      await page.setContent('<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0"></body></html>');
      await page.addScriptTag({ content: built.outputFiles[0].text });
      const row = await page.evaluate(() => {
        // 배속 as wide as it commonly gets, written as the stage writes it.
        const stage = window.stageCss({ cast: [], narration: false, bg: '', cg: '', revealed: false, log: false, auto: false, voice: true, rate: 1.75 });
        const style = document.createElement('style'); style.textContent = window.STATIC_CSS + stage; document.head.append(style);
        const root = document.createElement('div'); root.setAttribute('x-omni-vn', '1'); root.style.cssText = 'left:0;top:0;width:100vw;height:calc(100dvh - 96px)'; root.innerHTML = window.FRAME; document.body.append(root);
        const menu = root.querySelector('[data-vn-menu]'), box = root.querySelector('[data-vn-box]').getBoundingClientRect();
        const buttons = [...menu.children].filter(b => getComputedStyle(b).display !== 'none'), rects = buttons.map(b => b.getBoundingClientRect());
        const name = b => b.textContent || getComputedStyle(b, '::after').content.replace(/"/g, '');
        // Each button at its own width too: a row out of room squeezes its buttons (over their words, into their padding)
        // rather than overflowing, so none may give way here.
        const hold = document.createElement('style'); hold.textContent = '[x-omni-vn] [data-vn-menu] button{flex-shrink:0!important}'; document.head.append(hold);
        const roomy = menu.scrollWidth <= menu.clientWidth + 1;
        hold.remove();
        // Every button whole (its label inside it, none squeezed over the next), the row inside the box.
        return { coarse: matchMedia('(pointer:coarse)').matches, fits: roomy && menu.scrollWidth <= menu.clientWidth + 1 && buttons.every(b => b.scrollWidth <= b.clientWidth + 1), left: Math.min(...rects.map(r => r.left)), right: Math.max(...rects.map(r => r.right)), boxLeft: box.left, box: box.right, names: buttons.map(name), gaps: [rects.at(-3).left - rects.at(-4).right, rects.at(-1).left - rects.at(-2).right] };
      });
      assert.equal(row.coarse, true);
      assert.ok(row.box <= width, 'laid out at the phone width: ' + row.box);
      // Under 360 px there is no room for |◀ ▶|: ◀ ▶ alone. Up to 380 px 배속 drops its ×.
      assert.deepEqual(row.names, ['최신', '기록', '나레이션', 'BGM', '효과음', width > 380 ? '1.75×' : '1.75', ...(width >= 360 ? ['◀', '◀', '▶', '▶'] : ['◀', '▶'])]);
      // |◀ and ▶| stand off from ◀ ▶: a slip of the finger is never a jump.
      if (width >= 360) assert.ok(row.gaps[0] >= 8 && row.gaps[1] >= 8, width + 'px, the ends stood off: ' + JSON.stringify(row.gaps));
      assert.ok(row.fits && row.right <= row.box && row.left >= row.boxLeft, width + 'px: ' + JSON.stringify(row));
      await page.close();
    }
  } finally { await browser.close(); }
});

test('옴니 뷰어 over a restricted SafeDOM: while the line\'s voice is being made, a spinner turns at the box\'s corner; it stops once it speaks', async () => {
  const built = await build({ stdin: { contents: "import {installOmniViewer} from './src/viewer/omni-viewer';import {omniTts} from './src/services/tts-runtime';import {loadTtsData,ttsData} from './src/storage/tts-store';import {loadEmotionData,emotionData} from './src/storage/emotion-store';Object.assign(window,{installOmniViewer,omniTts,loadTtsData,ttsData,loadEmotionData,emotionData});", resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife' });
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 400, height: 900 } }), errors = [];
    page.setDefaultTimeout(8000); page.on('pageerror', e => errors.push(e.message));
    await page.route('https://vn.test/', r => r.fulfill({ contentType: 'text/html', body: '<html><head></head><body style="margin:0"></body></html>' })); await page.goto('https://vn.test/');
    await page.addScriptTag({ content: readFileSync('node_modules/dompurify/dist/purify.min.js', 'utf8') });
    await page.evaluate(() => {
      class Safe {
        constructor(node) { this.node = node; }
        release() {}
        async querySelector(s) { const n = this.node.querySelector(s); return n ? new Safe(n) : null; }
        async querySelectorAll(s) { return [...this.node.querySelectorAll(s)].map(n => new Safe(n)); }
        async setAttribute(k, v) { this.node.setAttribute(k, v); }
        async getAttribute(k) { return this.node.getAttribute(k); }
        async setTextContent(v) { this.node.textContent = v; }
        async innerText() { return this.node.innerText; }
        async setInnerHTML(v) { this.node.innerHTML = DOMPurify.sanitize(v); }
        async setStyleAttribute(v) { this.node.style.cssText = v; }
        async appendChild(child) { this.node.append(child.node); }
        async remove() { this.node.remove(); }
        async getBoundingClientRect() { return this.node.getBoundingClientRect().toJSON(); }
        async addEventListener(type, fn) { const cb = e => fn({ clientX: e.clientX, clientY: e.clientY, key: e.key }); document.addEventListener(type, cb); return String(Math.random()); }
        async removeEventListener() {}
        async createElement(tag) { return new Safe(document.createElement(tag)); }
      }
      const reply = '하린: "목소리가 오는 중이야."\n하린: "이제 들리지?"';
      document.body.innerHTML = '<div class="default-chat-screen" style="position:fixed;inset:0;display:flex;flex-direction:column-reverse"><div style="height:90px">입력창</div><div class="flex-col-reverse"><div class="chat-message-container"><div class="risu-chat" data-chat-index="0"><div class="chattext"><p>하린: "목소리가 오는 중이야."</p><p>하린: "이제 들리지?"</p></div></div></div></div></div>';
      const bot = { chaId: 'bot', name: 'Bot', additionalAssets: [], chats: [{ id: 'chat', message: [{ role: 'char', chatId: 'm0', data: reply }] }], chatPage: 0 };
      const saved = new Map(), local = new Map(); window.buttons = {}; window.voiceDelay = 900;
      window.risuai = { pluginStorage: { getItem: async k => saved.get(k), setItem: async (k, v) => saved.set(k, v) }, getLocalPluginStorage: async () => ({ getItem: async k => local.get(k), setItem: async (k, v) => local.set(k, v), removeItem: async k => local.delete(k) }),
        getDatabase: async () => ({ modules: [], enabledModules: [] }), setDatabase: async () => {}, getCurrentCharacterIndex: async () => 0, getCharacterFromIndex: async () => structuredClone(bot), getCharacter: async () => structuredClone(bot),
        // The voice comes back after a while: meanwhile it is being made.
        nativeFetch: async () => new Promise(resolve => setTimeout(() => resolve({ ok: true, arrayBuffer: async () => new Uint8Array(64).buffer }), window.voiceDelay)),
        readImage: async () => null, getRootDocument: async () => new Safe(document), registerButton: async (arg, fn) => { window.buttons[arg.id] = fn; return { id: arg.id }; } };
      window.Audio = class { src = ''; currentTime = 0; duration = 2; async play() {} pause() {} load() {} removeAttribute() { this.src = ''; } addEventListener() {} removeEventListener() {} };
      window.AudioContext = class { state = 'running'; destination = {}; async resume() {} createGain() { return { gain: { value: 1 }, connect() { return this; } }; } createMediaElementSource() { return { connect(node) { return node; } }; } };
    });
    await page.evaluate(() => { window.crypto.randomUUID = undefined; });
    await page.addScriptTag({ content: built.outputFiles[0].text });
    await page.evaluate(async () => {
      await window.loadTtsData(); const d = window.ttsData();
      d.settings.enabled = true; d.settings.translation.provider = 'off'; d.settings.autoAssign = false; d.settings.fish.key = 'test-key'; d.settings.continuous = false; d.settings.prefetch = 0;
      d.characters.push({ id: 't-harin', scope: 'global', name: '하린', surname: '', givenName: '하린', surnameAliases: [], givenAliases: [], triggers: ['하린'], tags: [], gender: 'female', voiceKey: d.voices[0].key, fishId: d.voices[0].fishId, fixed: false, gain: 0 });
      await window.loadEmotionData(); window.emotionData().settings.enabled = false;
      await window.omniTts.player.unlock();
      await window.installOmniViewer();
      window.buttons['omni-viewer-chat']();
    });
    const spinner = () => page.evaluate(() => { const n = document.querySelector('[x-omni-vn] [data-vn-voicewait]'); return n ? getComputedStyle(n).display : 'gone'; });
    await page.waitForFunction(() => /목소리가 오는 중/.test(document.querySelector('[x-omni-vn] [data-vn-text]')?.textContent || ''));
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[x-omni-vn] [data-vn-voicewait]')).display === 'block');
    const corner = await page.evaluate(() => { const box = document.querySelector('[x-omni-vn] [data-vn-box]').getBoundingClientRect(), s = document.querySelector('[x-omni-vn] [data-vn-voicewait]').getBoundingClientRect(); return { right: box.right - s.right, bottom: box.bottom - s.bottom }; });
    assert.ok(corner.right < 60 && corner.bottom < 80, 'at the box\'s bottom right: ' + JSON.stringify(corner));
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[x-omni-vn] [data-vn-voicewait]')).display === 'none');
    assert.equal(await page.evaluate(() => window.omniTts.player.status), 'playing', 'it stopped once the voice played');
    assert.equal(await spinner(), 'none');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
