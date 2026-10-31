import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';
// 40 × 60: a portrait illustration.
const TALL = 'iVBORw0KGgoAAAANSUhEUgAAACgAAAA8CAIAAACb22+3AAAAOElEQVR4nO3NQQkAAAgEsMtpEiMayxgiDPZfputExGKxWCwWi8VisVgsFovFYrFYLBaLxWLxp3gBypUEov8J6RgAAAAASUVORK5CYII=';
const reply = ['[3월 2일 ◆ 오후 4시 ◆ 카페]', '- Main Storylines: 숨은 요약 줄', '문이 열렸다.', '오미선 (cheerful): "왔어?"', '오미선: "자리 맡아놨어. 오늘은 창가 쪽이 제일 따뜻하더라, 얼른 앉아."', '[[@inray::card1::inxshot_abc::832::1216]]', '하린: "응, 늦었지."'].join('\n');

test('옴니 뷰어 over a restricted SafeDOM: a tap costs no rect read, sprites go over once, chat images are cloned, closing leaves nothing', async () => {
  const built = await build({ stdin: { contents: "import {installOmniViewer,viewerOpen} from './src/viewer/omni-viewer';import {loadTtsData,ttsData} from './src/storage/tts-store';import {loadEmotionData,emotionData} from './src/storage/emotion-store';import {soundData} from './src/storage/sound-store';import {omniTts} from './src/services/tts-runtime';import {saveViewerPrefs} from './src/storage/viewer-prefs';Object.assign(window,{installOmniViewer,viewerOpen,loadTtsData,ttsData,loadEmotionData,emotionData,soundData,saveViewerPrefs,omniTts});", resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife' });
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 400, height: 900 } }), errors = [];
    page.setDefaultTimeout(8000); page.on('pageerror', e => errors.push(e.message));
    await page.route('https://vn.test/', r => r.fulfill({ contentType: 'text/html', body: '<html><head></head><body style="margin:0"></body></html>' })); await page.goto('https://vn.test/');
    await page.addScriptTag({ content: readFileSync('node_modules/dompurify/dist/purify.min.js', 'utf8') });
    await page.evaluate(({ png, tall, reply }) => {
      const saved = new Map(), local = new Map(); window.calls = {}; window.buttons = {};
      const count = name => { window.calls[name] = (window.calls[name] || 0) + 1; };
      class Safe {
        constructor(node) { this.node = node; this.listeners = new Map(); }
        // Risu answers release() synchronously, with nothing: chaining on it once broke the viewer.
        release() { window.released = (window.released || 0) + 1; }
        async querySelector(s) { count('querySelector'); const n = this.node.querySelector(s); return n ? new Safe(n) : null; }
        async querySelectorAll(s) { count('querySelectorAll'); return [...this.node.querySelectorAll(s)].map(n => new Safe(n)); }
        async setAttribute(k, v) { count('setAttribute'); if (!k.startsWith('x-')) throw Error('Forbidden attribute write ' + k); this.node.setAttribute(k, v); }
        async getAttribute(k) { count('getAttribute'); if (!k.startsWith('x-')) throw Error('Forbidden attribute read ' + k); return this.node.getAttribute(k); }
        async setTextContent(v) { count('setTextContent'); this.node.textContent = v; }
        async getOuterHTML() { count('getOuterHTML'); return this.node.outerHTML; }
        async innerText() { count('innerText'); return this.node.innerText; }
        async scrollIntoView(o) { count('scrollIntoView'); this.node.scrollIntoView(o); }
        async getInnerHTML() { window.htmlReads = (window.htmlReads || 0) + 1; return this.node.innerHTML; }
        async setClassName(v) { count('setClassName'); this.node.className = v; }
        async setInnerHTML(v) { count('setInnerHTML'); if (/data:image/.test(v)) count('imageSent'); this.node.innerHTML = DOMPurify.sanitize(v); }
        async setStyleAttribute(v) { count('setStyleAttribute'); this.node.style.cssText = v; }
        async appendChild(child) { count('appendChild'); this.node.append(child.node); }
        async remove() { count('remove'); this.node.remove(); }
        async cloneNode(deep) { count('cloneNode'); return new Safe(this.node.cloneNode(deep)); }
        async getBoundingClientRect() { count('rect'); return this.node.getBoundingClientRect().toJSON(); }
        async addEventListener(type, fn) { count('addEventListener'); const id = String(Math.random()); const cb = e => fn({ clientX: e.clientX, clientY: e.clientY, key: e.key, repeat: e.repeat }); this.listeners.set(id, [type, cb]); document.addEventListener(type, cb); window.liveListeners = (window.liveListeners || 0) + 1; return id; }
        async removeEventListener(type, id) { const x = this.listeners.get(id); if (x) { document.removeEventListener(type, x[1]); this.listeners.delete(id); window.liveListeners--; } }
        async createElement(tag) { count('createElement'); if (!['div', 'button', 'style'].includes(tag)) throw Error('Unsupported host element ' + tag); return new Safe(document.createElement(tag)); }
      }
      const older = Array.from({ length: 5 }, (_, i) => `<div class="chat-message-container"><div class="risu-chat" data-chat-index="${i}"><div class="chattext">old ${i}</div></div></div>`).join('');
      document.body.innerHTML = `<div style="position:fixed;inset:0;z-index:30"></div><div id="risu-popup" style="position:fixed;left:20px;top:300px;width:120px;height:80px;z-index:50"></div><div class="default-chat-screen" style="position:fixed;inset:0;z-index:30;overflow:auto;display:flex;flex-direction:column-reverse"><div style="height:90px">입력창</div><div class="flex-col-reverse"><div class="chat-message-container"><div class="risu-chat" data-chat-index="2"><div class="chattext"><p>문이 열렸다.</p><p>오미선: “왔어?”</p><p>오미선: “자리 맡아놨어. 오늘은 창가 쪽이 제일 따뜻하더라, 얼른 앉아.”</p><p>하린: “응, 늦었지.”</p><div class="x-risu-status" style="width:180px;background:#335">HP 3 <span>MP 2</span><details><summary>더보기</summary>호감 42</details></div><div class="x-risu-choices"><p>1. 창가에 앉는다</p><p>2. 카운터로 간다</p></div><div data-inray-asset="inxshot_abc"><img src="data:image/png;base64,${tall}" style="width:50%"></div></div></div></div>${older}</div></div>`;
      const bytes = Uint8Array.from(atob(png), c => c.charCodeAt(0));
      const bot = { chaId: 'bot', name: 'Bot', additionalAssets: [['오미선_happy', 'assets/h.png', 'png'], ['하린_neutral', 'assets/n.png', 'png']], chats: [{ id: 'chat', message: [{ role: 'char', chatId: 'm0', data: '전날 밤은 조용했다.' }, { role: 'user', data: 'hi' }, { role: 'char', chatId: 'm1', data: reply }] }], chatPage: 0 };
      window.bot = bot;
      window.risuai = { pluginStorage: { getItem: async k => saved.get(k), setItem: async (k, v) => saved.set(k, v) }, getLocalPluginStorage: async () => ({ getItem: async k => local.get(k), setItem: async (k, v) => local.set(k, v), removeItem: async k => local.delete(k) }),
        getDatabase: async () => ({ modules: [], enabledModules: [] }), getCurrentCharacterIndex: async () => 0, getCurrentChatIndex: async () => 0, getCharacterFromIndex: async () => structuredClone(bot), getCharacter: async () => structuredClone(bot),
        sendChat: async text => { window.sent = text; },
        showContainer: async () => { window.containerShown = (window.containerShown || 0) + 1; throw new Error('no container in the test'); }, hideContainer: async () => {},
        readImage: async () => { if (window.imageDelay) await new Promise(r => setTimeout(r, window.imageDelay)); return bytes; }, getRootDocument: async () => new Safe(document), registerButton: async (arg, fn) => { window.buttons[arg.id] = fn; return { id: arg.id }; } };
    }, { png: PNG, tall: TALL, reply });
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
    await page.evaluate(() => { window.imageDelay = 1500; window.ttsData().settings.enabled = true; });
    await page.evaluate(() => window.buttons['omni-viewer-chat']());
    await page.waitForFunction(() => /문이 열렸다/.test(document.querySelector('[x-omni-vn] [data-vn-text]')?.textContent || ''));
    const box = await page.locator('[x-omni-vn]').boundingBox();
    assert.equal(await page.evaluate(({x,y})=>!!document.elementFromPoint(x,y)?.closest('[x-omni-vn]'),{x:box.x+box.width/2,y:box.y+box.height/2}),true,"Risu's chat chrome is under the viewer");
    assert.equal(await page.evaluate(() => document.elementFromPoint(60, 340)?.id), 'risu-popup', "Risu's own popups (its permission prompt) and toasts stay above it");
    assert.ok(box.height <= 900 - 90 + 1, 'Risu\'s input stays below the viewer');
    assert.equal(await page.locator('[x-omni-vn] [data-vn-clock]').textContent(), '3월 2일 · 오후 4시 · 카페');
    // Sound not yet allowed: opening asks for it (the voice/music prompt), once.
    await page.waitForFunction(() => window.containerShown === 1);
    await page.evaluate(() => { window.ttsData().settings.enabled = false; });
    assert.equal(await page.locator('#omnitts-chat-activation').count(), 0, 'refused, the prompt went again');
    // No background, and why, after the clock: no place has been said.
    assert.match(await page.evaluate(() => document.querySelector('[x-omni-vn-style="scene"]').textContent), /\[data-vn-clock\]::after\{content:"배경: 장소 태그 없음"\}/);
    // The counter is drawn by the scene's style text (::after), costing no call of its own.
    assert.match(await page.evaluate(() => getComputedStyle(document.querySelector('[x-omni-vn] [data-vn-box]'), '::after').content), /^"1 \/ 5/, 'the hidden summary line is no scene: 4 lines and the CG');
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('.flex-col-reverse > .chat-message-container')].filter(n => getComputedStyle(n).display !== 'none').length), 2, 'only the newest messages stay laid out behind it');
    // A tap while the letters still come in only completes them: wait out the longest line (about a second).
    const tap = async expected => {
      await page.waitForTimeout(1300);
      await page.evaluate(() => { window.calls = {}; });
      await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.45);
      await page.waitForFunction(text => (document.querySelector('[x-omni-vn] [data-vn-text]')?.textContent || '').includes(text), expected);
      return page.evaluate(() => ({ ...window.calls }));
    };
    // The line never waits on a picture: → goes on at once, the face follows when it has gone over.
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => /왔어\?/.test(document.querySelector('[x-omni-vn] [data-vn-text]')?.textContent || ''), null, { timeout: 900 });
    assert.equal(await page.locator('[x-omni-vn] [x-vn-sp] img').count(), 0, 'the line is up before its face');
    await page.waitForFunction(() => document.querySelectorAll('[x-omni-vn] [x-vn-sp] img').length === 1);
    await page.waitForFunction(() => /\[x-vn-sp="[^"]+"\]\{opacity:1\}/.test(document.querySelector('[x-omni-vn-style="scene"]').textContent));
    await page.evaluate(() => { window.imageDelay = 0; });
    await page.keyboard.press('ArrowLeft');
    await page.waitForFunction(() => /문이 열렸다/.test(document.querySelector('[x-omni-vn] [data-vn-text]')?.textContent || ''));
    const first = await tap('왔어?');
    assert.equal(first.rect || 0, 0, 'a tap reads no rectangle');
    assert.equal(first.imageSent || 0, 0, 'the sprite\'s pixels went over once, before: a step back to it sends nothing');
    assert.equal(await page.locator('[x-omni-vn] [x-vn-sp] img').count(), 1);
    const again = await tap('자리 맡아놨어');
    assert.equal(again.imageSent || 0, 0, 'the same face again sends nothing');
    // The lines ahead have their faces sent while this one is read: 하린, two lines on.
    await page.waitForFunction(() => document.querySelectorAll('[x-omni-vn] [x-vn-sp] img').length === 2);
    assert.ok((again.setInnerHTML || 0) + (again.setTextContent || 0) <= 2, 'a scene is one box and one style text: ' + JSON.stringify(again));
    const cg = await tap('');
    await page.waitForFunction(() => document.querySelectorAll('[x-omni-vn] img[x-vn-cg]').length === 1);
    assert.equal(await page.locator('[x-omni-vn] [x-vn-bg]').count(), 0, 'an illustration is a photo, never the stage');
    assert.equal(cg.imageSent || 0, 0, 'the chat image is cloned, not re-sent');
    assert.equal(cg.cloneNode, 1, 'one copy, as the photo');
    // The photo's frame hugs the picture (no band of white inside the border), in the middle of the stage.
    await page.waitForTimeout(700);
    const photo = await page.evaluate(() => { const img = document.querySelector('[x-omni-vn] img[x-vn-cg]'), r = img.getBoundingClientRect(); return { ratio: img.clientWidth / img.clientHeight, natural: img.naturalWidth / img.naturalHeight, mid: r.left + r.width / 2 }; });
    assert.ok(Math.abs(photo.ratio - photo.natural) < 0.02, 'the frame is the picture\'s own shape: ' + JSON.stringify(photo));
    assert.ok(Math.abs(photo.mid - (box.x + box.width / 2)) < 3, 'centred: ' + JSON.stringify(photo));
    await tap('늦었지');
    // Back to the picture before its folded rect was read (it came up big meanwhile), and on:
    // the folded thumb still takes a tap later (it once kept the big picture's rect).
    await page.keyboard.press('ArrowLeft');
    await page.waitForFunction(() => /^"4 \//.test(getComputedStyle(document.querySelector('[x-omni-vn] [data-vn-box]'), '::after').content));
    await page.waitForTimeout(700);
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => /^"5 \//.test(getComputedStyle(document.querySelector('[x-omni-vn] [data-vn-box]'), '::after').content));
    // The cast eases back out of the picture's dim.
    await page.waitForTimeout(600);
    assert.equal(await page.locator('[x-omni-vn] [data-vn-name]').textContent(), '하린');
    // Everyone so far stays on stage; only the speaker is lit.
    const stage = await page.evaluate(() => [...document.querySelectorAll('[x-omni-vn] [x-vn-p]')].filter(n => getComputedStyle(n).display !== 'none').map(n => getComputedStyle(n).filter));
    assert.equal(stage.length, 2, 'both people who have spoken stand');
    assert.equal(stage.filter(f => f === 'none').length, 1, 'exactly one is lit: ' + JSON.stringify(stage));
    // Back to the long line: one deliberate tap during its letters completes them and stays.
    const shown = re => page.waitForFunction(source => new RegExp(source).test(document.querySelector('[x-omni-vn] [data-vn-text]')?.textContent || ''), re.source);
    const center = () => page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.45);
    for (const name of ['prev', 'prev']) { await page.waitForTimeout(600); const b = await page.locator(`[x-omni-vn] [data-vn-act="${name}"]`).boundingBox(); await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); }
    await page.waitForFunction(() => /^"3 \//.test(getComputedStyle(document.querySelector('[x-omni-vn] [data-vn-box]'), '::after').content));
    await shown(/자리 맡아놨어/);
    await page.waitForTimeout(450); await center();
    await page.waitForFunction(() => /animation:none/.test(document.querySelector('[x-omni-vn-style="scene"]')?.textContent || ''));
    assert.match(await page.locator('[x-omni-vn] [data-vn-text]').textContent(), /자리 맡아놨어/, 'the same line, now complete');
    // A tap right after moving on completes the new line at once (it used to count as 광클 and skip it).
    const press = async act => { const b = await page.locator(`[x-omni-vn] [data-vn-act="${act}"]`).boundingBox(); await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); };
    const count = () => page.evaluate(() => getComputedStyle(document.querySelector('[x-omni-vn] [data-vn-box]'), '::after').content);
    await page.waitForTimeout(450); await press('prev');
    await page.waitForFunction(() => /^"2 \//.test(getComputedStyle(document.querySelector('[x-omni-vn] [data-vn-box]'), '::after').content));
    await page.waitForTimeout(900); await center(); await page.waitForTimeout(120); await center();
    await page.waitForFunction(() => /animation:none/.test(document.querySelector('[x-omni-vn-style="scene"]')?.textContent || ''));
    await page.waitForTimeout(300);
    assert.match(await count(), /^"3 \//, 'the second tap completed the long line, it did not skip past it');
    assert.match(await page.locator('[x-omni-vn] [data-vn-text]').textContent(), /자리 맡아놨어/);
    assert.equal(await page.locator('[x-omni-vn] [data-vn-end]').count(), 0, 'mid-reply, the arrow; no end cue');
    // 메시지: every reply in order as tiles (number, story clock, first line); a tile jumps to its reply.
    await press('msgs');
    await page.waitForFunction(() => document.querySelectorAll('[x-omni-vn] [data-vn-msgs] [data-vn-msg]').length === 2);
    assert.match(await page.locator('[x-omni-vn] [data-vn-msg][data-now]').textContent(), /^#3.*3월 2일 · 오후 4시 · 카페.*문이 열렸다/, 'the reply on screen: no hidden summary line as its gist');
    assert.match(await page.locator('[x-omni-vn] [data-vn-msg]').first().textContent(), /^#1전날 밤은 조용했다/);
    await page.waitForTimeout(500);
    const oldest = await page.locator('[x-omni-vn] [data-vn-msg]').first().boundingBox();
    assert.ok(oldest.x >= box.x - 1 && oldest.width > 60, 'the list slid in from the left');
    await page.mouse.click(oldest.x + oldest.width / 2, oldest.y + oldest.height / 2);
    await page.waitForFunction(() => /전날 밤은 조용했다/.test(document.querySelector('[x-omni-vn] [data-vn-text]')?.textContent || ''));
    assert.equal((await page.evaluate(() => document.querySelector('[x-omni-vn-style="scene"]').textContent)).includes('[data-vn-msgs]{translate:0 0}'), false, 'a jump closes the list');
    assert.equal(await page.locator('[x-omni-vn] [data-vn-end]').count(), 0, 'an older reply is not the end');
    // ▶ at an older reply's end goes on to the next one; 최신 returns to the newest.
    await page.waitForTimeout(450); await press('next');
    await page.waitForFunction(() => /문이 열렸다/.test(document.querySelector('[x-omni-vn] [data-vn-text]')?.textContent || ''));
    await press('newest');
    await page.waitForFunction(() => /문이 열렸다/.test(document.querySelector('[x-omni-vn] [data-vn-text]')?.textContent || ''));
    // 삽화 strip: the chat's own image cloned as a tile; tapping it jumps to that scene.
    await press('strip');
    await page.waitForFunction(() => document.querySelectorAll('[x-omni-vn] [data-vn-strip] img[x-vn-thumb]').length === 1);
    await page.waitForTimeout(500);
    const tile = await page.locator('[x-omni-vn] [data-vn-strip] img[x-vn-thumb]').boundingBox();
    assert.ok(tile.x + tile.width <= box.x + box.width + 1 && tile.width > 20, 'the strip slid in');
    await page.mouse.click(tile.x + tile.width / 2, tile.y + tile.height / 2);
    await page.waitForFunction(() => (document.querySelector('[x-omni-vn-style="scene"]')?.textContent || '').includes(':is(img,div)[x-vn-cg='));
    assert.equal((await page.evaluate(() => document.querySelector('[x-omni-vn-style="scene"]').textContent)).includes('[data-vn-strip]{translate:0 0}'), false, 'a jump closes the strip');
    // A streaming reply re-reads every tick: the line on screen keeps its letters (it once restarted them each time).
    await press('newest');
    await page.waitForFunction(() => /문이 열렸다/.test(document.querySelector('[x-omni-vn] [data-vn-text]')?.textContent || ''));
    await page.evaluate(text => window.__OMNI_STREAM_TICK__(text), reply + '\n');
    await page.waitForTimeout(700);
    await page.evaluate(() => { window.calls = {}; });
    await page.evaluate(text => window.__OMNI_STREAM_TICK__(text), reply + '\n');
    await page.waitForTimeout(700);
    assert.equal((await page.evaluate(() => window.calls.setInnerHTML)) || 0, 0, 'the same line is not written again');
    // The reply's cast block closes mid-stream: its place is the stage from then (its background was drawn before).
    await page.evaluate(() => { const d = window.emotionData(); d.settings.placeBackgrounds = true; d.made.push({ bot: 'bot', person: '__place__', face: 'cafe, window', name: 'bg_cafe.png', path: 'assets/bg.png', registered: false, at: 1 }); });
    assert.equal(await page.locator('[x-omni-vn] [x-vn-bg]').count(), 0);
    await page.evaluate(text => window.__OMNI_STREAM_TICK__(text), '[[inxc]]{"new_characters":[],"place":"Cafe, window"}[[/inxc]]\n' + reply + '\n');
    await page.waitForFunction(() => document.querySelectorAll('[x-omni-vn] [x-vn-bg] img').length === 1);
    await page.waitForFunction(() => /\[x-vn-bg="[^"]+"\]\{display:block\}/.test(document.querySelector('[x-omni-vn-style="scene"]').textContent));
    assert.doesNotMatch(await page.evaluate(() => document.querySelector('[x-omni-vn-style="scene"]').textContent), /\[data-vn-clock\]::after/, 'a background up: nothing to say');
    await page.evaluate(() => { const box = document.createElement('div'); box.setAttribute('data-inx-slot', '1'); box.innerHTML = '<img src="data:image/png;base64,iVBORw0KGgo=">'; document.querySelector('.flex-col-reverse .chattext').append(box); window.calls = {}; });
    const slotted = '[[inx1]]{"shot":1}[[/inx1]]\n' + reply + '\n';
    for (let i = 0; i < 3; i++) { await page.evaluate(text => window.__OMNI_STREAM_TICK__(text), slotted); await page.waitForTimeout(500); }
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[x-omni-vn] div[x-vn-cg="pending"]')).display === 'block');
    assert.equal(await page.locator('[x-omni-vn] [x-vn-cg="pending"]').textContent(), '삽화 그리는 중…');
    assert.equal(await page.evaluate(() => window.calls.cloneNode || 0), 0, 'the streaming preview is never cloned');
    assert.equal(await page.locator('[x-omni-vn] [x-vn-cg]').count(), 2, 'one frame for it, made once (and the reply\'s own baked CG from before)');
    // The slot's picture is done (the chat shows it, base64, before the reply is baked): the viewer shows it too.
    await page.evaluate(tall => window.__OMNI_VIEWER_PREVIEW__({ messageIndex: 2, url: 'data:image/png;base64,' + tall, inlineSlot: 1 }), TALL);
    await page.waitForFunction(() => { const pv = document.querySelector('[x-omni-vn] img[x-vn-cg^="pv"]'); return !!pv && getComputedStyle(pv).display === 'block'; });
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('[x-omni-vn] div[x-vn-cg="pending"]')).display), 'none', 'the frame gave way to the picture');
    await page.evaluate(tall => window.__OMNI_VIEWER_PREVIEW__({ messageIndex: 2, url: 'data:image/png;base64,' + tall, inlineSlot: 1 }), TALL);
    await page.waitForTimeout(200);
    assert.equal(await page.locator('[x-omni-vn] img[x-vn-cg^="pv"]').count(), 1, 'sent once');
    await page.evaluate(() => document.querySelector('[data-inx-slot]').remove());
    // A drag up runs on through several scenes; the click that ends it is no tap.
    await page.waitForTimeout(4300);
    await press('newest');
    await page.waitForFunction(() => /문이 열렸다/.test(document.querySelector('[x-omni-vn] [data-vn-text]')?.textContent || ''));
    const cx = box.x + box.width / 2;
    await page.mouse.move(cx, box.y + box.height * 0.6); await page.mouse.down();
    await page.mouse.move(cx, box.y + box.height * 0.4, { steps: 4 }); await page.mouse.move(cx, box.y + box.height * 0.3, { steps: 4 }); await page.mouse.up();
    await page.waitForFunction(() => /^"[3-5] \//.test(getComputedStyle(document.querySelector('[x-omni-vn] [data-vn-box]'), '::after').content));
    // Rapid taps: the scene at the end of them is drawn once, a jump (each tap used to draw its own).
    await press('newest');
    await page.waitForFunction(() => /문이 열렸다/.test(document.querySelector('[x-omni-vn] [data-vn-text]')?.textContent || ''));
    await page.waitForTimeout(450);
    await page.evaluate(() => { window.calls = {}; });
    const mid = { x: box.x + box.width / 2, y: box.y + box.height * 0.45 };
    for (let i = 0; i < 5; i++) await page.mouse.click(mid.x, mid.y);
    await page.waitForFunction(() => /^"5 \//.test(getComputedStyle(document.querySelector('[x-omni-vn] [data-vn-box]'), '::after').content));
    await page.waitForTimeout(400);
    assert.ok((await page.evaluate(() => window.calls.setInnerHTML || 0)) <= 2, 'five taps, at most two boxes drawn');
    // The newest reply's last line asks for the next message, blinking: the story so far has plainly ended.
    assert.match(await page.locator('[x-omni-vn] [data-vn-end]').textContent(), /메시지를 입력해 주세요/);
    assert.equal(await page.locator('[x-omni-vn] [data-vn-next]').count(), 0, 'no arrow promising more');
    // A CG passed folds up at the top of the stage.
    assert.match(await page.evaluate(() => document.querySelector('[x-omni-vn-style="scene"]').textContent), /:is\(img,div\)\[x-vn-cg="[^"]+"\]\{display:block;left:auto!important;right:12px;top:60px;height:84px/, 'the CG waits folded');
    // The viewer covers the chat for every other tap handler.
    assert.equal(await page.evaluate(({ x, y }) => window.__OMNI_VIEWER_COVERS__(x, y), mid), true);
    // 나레이션 is TTS 나레이션 itself (narration still shown, not voiced). BGM only pauses: it never
    // switches BGM off, which would rewrite Risu's sound module and redraw the chat.
    const narration = await page.evaluate(() => window.ttsData().settings.narration);
    await press('narr');
    await page.waitForFunction(was => window.ttsData().settings.narration === !was, narration);
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[x-omni-vn] [data-vn-act="narr"]')).opacity === '0.4');
    await press('narr');
    await page.waitForFunction(was => window.ttsData().settings.narration === was, narration);
    const bgmOn = await page.evaluate(() => window.soundData().settings.bgmEnabled);
    await press('bgm'); await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => window.soundData().settings.bgmEnabled), bgmOn, 'BGM 사용 is never switched by the BGM button');
    // 기록 now sits by 최신 and stays reachable while open; its rows read as buttons (the pointer, a light under it).
    await press('log');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[x-omni-vn] [data-vn-log]')).display === 'block');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[x-omni-vn] [data-vn-act="log"]')).color === 'rgb(227, 194, 122)');
    const row = page.locator('[x-omni-vn] [data-vn-log] p').first();
    assert.equal(await row.evaluate(n => getComputedStyle(n).cursor), 'pointer');
    const unlit = await row.evaluate(n => getComputedStyle(n).backgroundColor);
    await row.hover(); await page.waitForTimeout(250);
    assert.notEqual(await row.evaluate(n => getComputedStyle(n).backgroundColor), unlit, 'hovered, a row lights up');
    await press('log');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[x-omni-vn] [data-vn-log]')).display === 'none');
    // Keys: ← back, Enter on; ↑ opens 기록 under this reply's number and clock, the line on screen lit;
    // there ↑ ↓ pick a line and Enter goes to it.
    const sceneCss = () => page.evaluate(() => document.querySelector('[x-omni-vn-style="scene"]').textContent);
    const at = n => page.waitForFunction(n => new RegExp('^"' + n + ' /').test(getComputedStyle(document.querySelector('[x-omni-vn] [data-vn-box]'), '::after').content), n);
    await page.waitForTimeout(400);
    await page.keyboard.press('ArrowLeft'); await at(4);
    await page.waitForTimeout(400);
    await page.keyboard.press('Enter'); await at(5);
    await page.waitForTimeout(1300);
    await page.keyboard.press('ArrowUp');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[x-omni-vn] [data-vn-log]')).display === 'block');
    assert.equal(await page.locator('[x-omni-vn] [data-vn-log] h5').textContent(), '#3 · 3월 2일 · 오후 4시 · 카페');
    assert.match(await page.locator('[x-omni-vn] [data-vn-log] [data-now]').textContent(), /늦었지/);
    assert.notEqual(await page.locator('[x-omni-vn] [data-vn-log] [data-now]').evaluate(n => getComputedStyle(n).backgroundColor), await page.locator('[x-omni-vn] [data-vn-log] p').first().evaluate(n => getComputedStyle(n).backgroundColor), 'the line on screen is lit');
    assert.match(await sceneCss(), /\[data-vn-log\] p:nth-of-type\(4\)\{outline/, 'picked: the line on screen (the photo is no line)');
    await page.keyboard.press('ArrowUp');
    await page.waitForFunction(() => /\[data-vn-log\] p:nth-of-type\(3\)\{outline/.test(document.querySelector('[x-omni-vn-style="scene"]').textContent));
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[x-omni-vn] [data-vn-log]')).display === 'none');
    await at(3);
    assert.doesNotMatch(await sceneCss(), /p:nth-of-type\(\d+\)\{outline/);
    // → goes on at once, the line's letters still coming in (Enter completes them first, as a tap does).
    await page.keyboard.press('ArrowRight'); await at(4);
    await page.waitForTimeout(300);
    await page.keyboard.press('ArrowRight'); await at(5);
    // Held (Risu passes `repeat`): a line per beat, never the whole backlog at once.
    await page.waitForTimeout(400);
    await page.evaluate(() => { for (let i = 0; i < 12; i++) document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', repeat: true })); });
    await page.waitForTimeout(700);
    assert.match(await count(), /^"4 \//, 'twelve repeats at once: one line back');
    await page.keyboard.press('ArrowRight'); await at(5);
    // A press outside the viewer (Risu's input, to type) hands the keys back: Enter there moves nothing here.
    await page.mouse.click(box.x + box.width / 2, 900 - 30);
    await page.waitForTimeout(200);
    await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(500);
    assert.match(await count(), /^"5 \//, 'the keys were Risu\'s');
    // 전체화면 opens Omni's own 크게보기 (stubbed): the viewer steps down under it, takes no tap, and comes back when it closes.
    await page.evaluate(() => {
      window.__OMNI_INSPECT_SHOT__ = async (card, asset) => { window.inspected = [card, asset]; window.inspecting = true; return true; };
      window.__OMNI_INSPECT_OPEN__ = () => window.inspecting === true;
    });
    const thumb = await page.locator('[x-omni-vn] img[x-vn-cg]:not([x-vn-cg^="pv"])').boundingBox();
    await page.mouse.click(thumb.x + thumb.width / 2, thumb.y + thumb.height / 2);
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[x-omni-vn] [data-vn-act="cgfull"]')).display !== 'none');
    await page.waitForTimeout(300);
    await press('cgfull');
    await page.waitForFunction(() => window.inspecting === true && !document.querySelector('[x-omni-vn-style="fold"]').textContent.includes('.inlay-nx-overlay-root'));
    assert.deepEqual(await page.evaluate(() => window.inspected), ['card1', 'inxshot_abc'], 'the card and file name the chat\'s ⛶ opens');
    assert.equal(await page.evaluate(() => document.querySelector('[x-omni-vn-style="fold"]').textContent.includes('.inlay-nx-overlay-root')), false, "Omni's layer shows while its 크게보기 is open");
    const under = await count();
    await center(); await page.waitForTimeout(300);
    assert.equal(await count(), under, 'the viewer takes no tap meant for 크게보기');
    await page.evaluate(() => { window.inspecting = false; });
    await page.waitForFunction(() => document.querySelector('[x-omni-vn-style="fold"]').textContent.includes('.inlay-nx-overlay-root'));
    assert.equal(await page.evaluate(() => document.querySelector('[x-omni-vn-style="fold"]').textContent.includes('.inlay-nx-overlay-root')), true);
    // Without Omni's 크게보기, the viewer's own full screen has the same bottom sheet: ◀ 🔍 ▶ 닫기.
    await page.evaluate(() => { delete window.__OMNI_INSPECT_SHOT__; delete window.__OMNI_INSPECT_OPEN__; });
    await page.waitForTimeout(300);
    await press('cgfull');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[x-omni-vn] [data-vn-dock]')).display === 'grid');
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('[x-omni-vn] img[x-vn-cg]:not([x-vn-cg^="pv"])')).objectFit), 'contain');
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('[x-omni-vn] [data-vn-act="cgnext"]')).opacity), '0.3', 'one illustration: nothing after it');
    await press('cgfit');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[x-omni-vn] img[x-vn-cg]:not([x-vn-cg^="pv"])')).objectFit === 'cover');
    await press('cgback');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[x-omni-vn] [data-vn-dock]')).display === 'none');
    // 요소: nothing registered, nothing read (the reply's HTML is not even fetched).
    assert.equal(await page.evaluate(() => window.htmlReads || 0), 0, 'every reply loaded so far: a bot with nothing registered costs nothing');
    await press('elems');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[x-omni-vn] [data-vn-act="eledit"]')).visibility === 'visible');
    assert.equal(await page.locator('[x-omni-vn] [x-vn-st]').count(), 0, 'only registered kinds come up');
    // 편집 lists the bot's own elements (not ours): the status panel, its fold (a kind of its own), the choice list.
    await press('eledit');
    await page.waitForFunction(() => document.querySelectorAll('[x-omni-vn] [data-vn-edit] [data-vn-el]').length === 3);
    await page.waitForTimeout(500);
    const chip = (row, label) => page.locator(`[x-omni-vn] [data-vn-el]:has(b:text-is("${row}")) i`, { hasText: label });
    const tapChip = async (row, label) => { const b = await chip(row, label).boundingBox(); await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); };
    await tapChip('status', '스티커');
    await page.waitForFunction(() => { const st = document.querySelector('[x-omni-vn] [x-vn-st]'); return !!st?.querySelector('.x-risu-status') && getComputedStyle(st).display === 'block'; });
    assert.equal(await page.evaluate(() => document.querySelector('[x-omni-vn] [x-vn-st]').className), 'chattext', "inside a .chattext the bot's chat CSS still reaches it");
    // Dragged in 편집, it stays where it was put (a share of the frame, so any screen keeps it).
    await page.waitForTimeout(300);
    const sticker = await page.locator('[x-omni-vn] [x-vn-st]').boundingBox();
    const before = await page.evaluate(() => document.querySelector('[x-omni-vn] [x-vn-st]').style.left);
    await page.mouse.move(sticker.x + 20, sticker.y + 8); await page.mouse.down();
    await page.mouse.move(sticker.x + 60, sticker.y + 60, { steps: 5 }); await page.mouse.move(sticker.x + 100, sticker.y + 110, { steps: 5 }); await page.mouse.up();
    await page.waitForFunction(was => { const left = document.querySelector('[x-omni-vn] [x-vn-st]').style.left; return /%$/.test(left) && left !== was; }, before);
    const moved = await page.locator('[x-omni-vn] [x-vn-st]').boundingBox();
    assert.ok(Math.abs(moved.x - sticker.x - 80) < 6 && Math.abs(moved.y - sticker.y - 102) < 6, `the sticker followed the drag: ${JSON.stringify([sticker, moved])}`);
    assert.equal(await page.evaluate(() => window.liveListeners), 4, 'the move listener lasted only as long as the drag');
    // The choice list as 선택지: at the newest reply's end, its options come up instead of the end cue.
    await tapChip('choices', '선택지');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[x-omni-vn] [data-vn-choices]')).display === 'flex');
    assert.deepEqual(await page.locator('[x-omni-vn] [data-vn-ch]').allTextContents(), ['1. 창가에 앉는다', '2. 카운터로 간다']);
    await press('eledit');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[x-omni-vn] [x-vn-st]')).outlineStyle === 'none');
    // A sticker's <details> folds by its summary, as in the chat; the tap moves no story on.
    await page.waitForTimeout(300);
    const scene = await count();
    const summary = await page.locator('[x-omni-vn] [x-vn-st] summary').boundingBox();
    await page.mouse.click(summary.x + summary.width / 2, summary.y + summary.height / 2);
    await page.waitForFunction(() => document.querySelector('[x-omni-vn] [x-vn-st] details').open);
    await page.waitForTimeout(300);
    assert.equal(await count(), scene, 'the tap was the sticker\'s');
    await press('elems');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[x-omni-vn] [x-vn-st]')).display === 'none', null, { timeout: 3000 });
    // One tap picks a choice; a second on it sends it as the user's message.
    await page.waitForTimeout(300);
    const option = await page.locator('[x-omni-vn] [data-vn-ch]').first().boundingBox();
    await page.mouse.click(option.x + option.width / 2, option.y + option.height / 2);
    await page.waitForFunction(() => document.querySelector('[x-omni-vn] [data-vn-ch]')?.hasAttribute('data-sel'));
    assert.equal(await page.evaluate(() => window.sent), undefined, 'one tap sends nothing');
    await page.waitForTimeout(200);
    const picked = await page.locator('[x-omni-vn] [data-vn-ch]').first().boundingBox();
    await page.mouse.click(picked.x + picked.width / 2, picked.y + picked.height / 2);
    await page.waitForFunction(() => window.sent === '1. 창가에 앉는다');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[x-omni-vn] [data-vn-choices]')).display === 'none');
    // Voices ahead (TTS on): the lines after the one on screen are made while it is read, the picture skipped.
    await page.evaluate(() => { window.prefetched = []; window.omniTts.prefetch = async list => { window.prefetched.push(list.map(q => q.segment.text)); }; window.played = []; window.omniTts.play = async (list, i) => { window.played.push(list[i].segment.text); }; window.ttsData().settings.enabled = true; });
    await press('newest');
    await page.waitForFunction(() => window.prefetched.length > 0);
    const ahead = await page.evaluate(() => window.prefetched[0]);
    assert.equal(ahead.length, 3, 'the three lines after the first: ' + JSON.stringify(ahead));
    assert.match(ahead[0], /왔어/); assert.match(ahead[2], /늦었지/);
    // 나레이션 switched back on: the narration on screen is voiced at once (it took reopening the viewer).
    await press('narr'); await page.waitForFunction(() => window.ttsData().settings.narration === false);
    await page.evaluate(() => { window.played = []; });
    await press('narr'); await page.waitForFunction(() => window.ttsData().settings.narration === true);
    await page.waitForFunction(() => window.played.some(t => /문이 열렸다/.test(t)));
    await page.evaluate(() => { window.ttsData().settings.enabled = false; });
    for (let i = 0; i < 8 && !/^"5 \//.test(await count()); i++) { await page.waitForTimeout(300); await page.keyboard.press('ArrowRight'); }
    await page.waitForFunction(() => /^"5 \//.test(getComputedStyle(document.querySelector('[x-omni-vn] [data-vn-box]'), '::after').content));
    // ✕ closes: no frame, no styles, no listener.
    const close = await page.locator('[x-omni-vn] [data-vn-act="close"]').boundingBox();
    await page.mouse.click(close.x + close.width / 2, close.y + close.height / 2);
    await page.waitForFunction(() => !document.querySelector('[x-omni-vn]'));
    assert.equal(await page.evaluate(() => document.querySelectorAll('[x-omni-vn-style]').length), 0);
    assert.equal(await page.evaluate(({ x, y }) => window.__OMNI_VIEWER_COVERS__(x, y), { x: box.x + 10, y: box.y + 10 }), false, 'closed, it covers nothing');
    assert.equal(await page.evaluate(() => window.liveListeners), 0);
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('.flex-col-reverse > .chat-message-container')].filter(n => getComputedStyle(n).display !== 'none').length), 6, 'the chat is whole again');
    // Reopened, it is where the reader left it (하린's line, the last), not back at the top.
    const reopen = async () => { await page.evaluate(() => window.buttons['omni-viewer-chat']()); await page.waitForFunction(() => !!document.querySelector('[x-omni-vn] [data-vn-text]')); };
    const shut = async () => { await press('close'); await page.waitForFunction(() => !document.querySelector('[x-omni-vn]')); };
    await reopen();
    await page.waitForFunction(() => /늦었지/.test(document.querySelector('[x-omni-vn] [data-vn-text]')?.textContent || ''));
    assert.match(await count(), /^"5 \//, 'back at the line it was closed on');
    await shut();
    // A reply that came since opens instead, from its top: that is what is unread.
    await page.evaluate(() => window.bot.chats[0].message.push({ role: 'user', data: '또 만나' }, { role: 'char', chatId: 'm2', data: '새 아침이 밝았다.\n하린: "또 보네."' }));
    await reopen();
    await page.waitForFunction(() => /새 아침이 밝았다/.test(document.querySelector('[x-omni-vn] [data-vn-text]')?.textContent || ''));
    assert.match(await count(), /^"1 \/ 2"/);
    await shut();
    await page.evaluate(() => window.saveViewerPrefs({ skipWords: '아침, OOC', speed: 'instant' }));
    await reopen();
    await page.waitForFunction(() => /또 보네/.test(document.querySelector('[x-omni-vn] [data-vn-text]')?.textContent || ''));
    assert.match(await count(), /^"1 \/ 1"/, 'the line with 아침 is no scene');
    assert.equal(await page.locator('[x-omni-vn] [data-vn-text] i').count(), 0, '즉시: no letter waits its turn');
    await shut();
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
