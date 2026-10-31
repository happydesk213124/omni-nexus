import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

test('옴니 뷰어 over a restricted SafeDOM: a reply that ends on its picture can still be left — the picture folds on a tap, ◀ and a swipe go back, ✕ closes', async () => {
  const built = await build({ stdin: { contents: "import {installOmniViewer,viewerOpen} from './src/viewer/omni-viewer';import {loadTtsData,ttsData} from './src/storage/tts-store';import {loadEmotionData,emotionData} from './src/storage/emotion-store';Object.assign(window,{installOmniViewer,viewerOpen,loadTtsData,ttsData,loadEmotionData,emotionData});", resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife' });
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 400, height: 900 } }), errors = [];
    page.setDefaultTimeout(8000); page.on('pageerror', e => errors.push(e.message));
    await page.route('https://vn.test/', r => r.fulfill({ contentType: 'text/html', body: '<html><head></head><body style="margin:0"></body></html>' })); await page.goto('https://vn.test/');
    await page.addScriptTag({ content: readFileSync('node_modules/dompurify/dist/purify.min.js', 'utf8') });
    await page.evaluate(() => {
      // A picture as large as NovelAI's portrait (832×1216): the photo covers most of the stage.
      const canvas = document.createElement('canvas'); canvas.width = 832; canvas.height = 1216;
      const g = canvas.getContext('2d'); g.fillStyle = '#7aa'; g.fillRect(0, 0, 832, 1216);
      const picture = canvas.toDataURL('image/png');
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
        async cloneNode(deep) { return new Safe(this.node.cloneNode(deep)); }
        async scrollIntoView(o) { this.node.scrollIntoView(o); }
        async getBoundingClientRect() { return this.node.getBoundingClientRect().toJSON(); }
        async addEventListener(type, fn) { const cb = e => fn({ clientX: e.clientX, clientY: e.clientY, key: e.key, repeat: e.repeat }); document.addEventListener(type, cb); return String(Math.random()); }
        async removeEventListener() {}
        async createElement(tag) { return new Safe(document.createElement(tag)); }
      }
      // Two replies; the newest ends on its picture.
      const older = '하린: "어제는 비가 왔지."', newest = '하린: "이거 봐, 오늘 찍었어."\n오미선: "와, 예쁘다."\n[[@inray::card9::inxshot_end::832::1216]]';
      document.body.innerHTML = `<div class="default-chat-screen" style="position:fixed;inset:0;display:flex;flex-direction:column-reverse"><div style="height:90px">입력창</div><div class="flex-col-reverse">`
        + `<div class="chat-message-container"><div class="risu-chat" data-chat-index="2"><div class="chattext"><p>하린: "이거 봐, 오늘 찍었어."</p><p>오미선: "와, 예쁘다."</p><div data-inray-asset="inxshot_end"><img src="${picture}"></div></div></div></div>`
        + `<div class="chat-message-container"><div class="risu-chat" data-chat-index="1"><div class="chattext">응</div></div></div>`
        + `<div class="chat-message-container"><div class="risu-chat" data-chat-index="0"><div class="chattext"><p>하린: "어제는 비가 왔지."</p></div></div></div></div></div>`;
      const bot = { chaId: 'bot', name: 'Bot', additionalAssets: [], chats: [{ id: 'chat', message: [{ role: 'char', chatId: 'm0', data: older }, { role: 'user', chatId: 'u0', data: '응' }, { role: 'char', chatId: 'm1', data: newest }] }], chatPage: 0 };
      const saved = new Map(), local = new Map(); window.buttons = {};
      window.risuai = { pluginStorage: { getItem: async k => saved.get(k), setItem: async (k, v) => saved.set(k, v) }, getLocalPluginStorage: async () => ({ getItem: async k => local.get(k), setItem: async (k, v) => local.set(k, v), removeItem: async k => local.delete(k) }),
        getDatabase: async () => ({ modules: [], enabledModules: [] }), getCurrentCharacterIndex: async () => 0, getCharacterFromIndex: async () => structuredClone(bot), getCharacter: async () => structuredClone(bot),
        readImage: async () => null, getRootDocument: async () => new Safe(document), registerButton: async (arg, fn) => { window.buttons[arg.id] = fn; return { id: arg.id }; } };
    });
    await page.evaluate(() => { window.crypto.randomUUID = undefined; });
    await page.addScriptTag({ content: built.outputFiles[0].text });
    await page.evaluate(async () => {
      await window.loadTtsData(); const d = window.ttsData(); d.settings.enabled = false;
      for (const [id, name] of [['t-harin', '하린'], ['t-misun', '오미선']]) d.characters.push({ id, scope: 'global', name, surname: '', givenName: name, surnameAliases: [], givenAliases: [], triggers: [], tags: [], gender: 'female', voiceKey: '', fishId: '', fixed: false, gain: 0 });
      await window.loadEmotionData(); window.emotionData().settings.enabled = false;
      await window.installOmniViewer();
      window.buttons['omni-viewer-chat']();
    });
    const text = () => page.evaluate(() => document.querySelector('[x-omni-vn] [data-vn-text]')?.textContent || '');
    const shows = re => page.waitForFunction(source => new RegExp(source).test(document.querySelector('[x-omni-vn] [data-vn-text]')?.textContent || ''), re.source);
    const scene = () => page.evaluate(() => document.querySelector('[x-omni-vn-style="scene"]')?.textContent || '');
    const photo = () => page.evaluate(() => { const img = document.querySelector('[x-omni-vn] img[x-vn-cg]'); if (!img || getComputedStyle(img).display === 'none') return null; const r = img.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
    const press = async act => { const b = await page.locator(`[x-omni-vn] [data-vn-act="${act}"]`).boundingBox(); await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); };
    await shows(/이거 봐/);
    const box = await page.locator('[x-omni-vn]').boundingBox();
    const toPicture = async () => {
      for (let i = 0; i < 6 && !(await photo()); i++) { await page.waitForTimeout(700); await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.3); }
      await page.waitForFunction(() => { const img = document.querySelector('[x-omni-vn] img[x-vn-cg]'); return !!img && getComputedStyle(img).display !== 'none' && img.getBoundingClientRect().height > 200; });
      await page.waitForTimeout(600);
    };
    await toPicture();
    assert.equal(await page.locator('[x-omni-vn] [data-vn-end]').count(), 1, 'the end of the story so far: its cue under the picture');

    // A tap on the picture that ends the story so far folds it (there is no next scene to go on to).
    const big = await photo();
    await page.mouse.click(big.x + big.width / 2, big.y + big.height / 2);
    await page.waitForFunction(() => { const img = document.querySelector('[x-omni-vn] img[x-vn-cg]'); return !!img && getComputedStyle(img).display !== 'none' && img.getBoundingClientRect().height < 120; });
    // ◀ goes back to the line before it.
    await page.waitForTimeout(400);
    await press('prev');
    await shows(/와, 예쁘다/);

    // On to the picture again (a step on folds it no more than a tap: it opens big as the reply ends on it): a swipe
    // down goes back, also one that starts low, over the box a picture hides (a drag there selects only a shown line).
    await toPicture();
    const lineBox = await page.locator('[x-omni-vn] [data-vn-box]').boundingBox();
    const x = lineBox.x + lineBox.width / 2, from = lineBox.y + 14;
    await page.mouse.move(x, from); await page.mouse.down();
    await page.mouse.move(x, from + 60, { steps: 4 }); await page.mouse.move(x, from + 110, { steps: 4 }); await page.mouse.up();
    await shows(/와, 예쁘다|이거 봐/);

    // And ✕ closes, from the picture too.
    await toPicture();
    await press('close');
    await page.waitForFunction(() => !window.viewerOpen());
    assert.equal(await page.locator('[x-omni-vn]').count(), 0);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
