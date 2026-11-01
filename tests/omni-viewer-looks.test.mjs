import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

// 체육관 심판 has a voice card but no looks (no illustration character, no picture of theirs): their oval offers to make them.
const REPLY = ['체육관 심판 (happy): "야생 식스테일 포획으로 2점 추가!"', '하루키: "해냈다!"', '체육관 심판: "미션 클리어입니다!"'];

test('옴니 뷰어 over a restricted SafeDOM, 외형 없음 · 눌러서 만들기: a tap on that oval (and only there) asks the character LLM for them, from their voice card and lines', async () => {
  const built = await build({ stdin: { contents: "import {installOmniViewer} from './src/viewer/omni-viewer';import {loadTtsData,ttsData} from './src/storage/tts-store';import {loadEmotionData,emotionData} from './src/storage/emotion-store';Object.assign(window,{installOmniViewer,loadTtsData,ttsData,loadEmotionData,emotionData});", resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife' });
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 400, height: 900 } }), errors = [];
    page.setDefaultTimeout(8000); page.on('pageerror', e => errors.push(e.message));
    await page.route('https://vn.test/', r => r.fulfill({ contentType: 'text/html', body: '<html><head></head><body style="margin:0"></body></html>' })); await page.goto('https://vn.test/');
    await page.addScriptTag({ content: readFileSync('node_modules/dompurify/dist/purify.min.js', 'utf8') });
    await page.evaluate(({ reply }) => {
      window.buttons = {}; window.llmCalls = [];
      class Safe {
        constructor(node) { this.node = node; }
        release() {}
        async querySelector(s) { const n = this.node.querySelector(s); return n ? new Safe(n) : null; }
        async querySelectorAll(s) { return [...this.node.querySelectorAll(s)].map(n => new Safe(n)); }
        async setAttribute(k, v) { if (!k.startsWith('x-')) throw Error('Forbidden attribute write ' + k); this.node.setAttribute(k, v); }
        async getAttribute(k) { if (!k.startsWith('x-')) throw Error('Forbidden attribute read ' + k); return this.node.getAttribute(k); }
        async setTextContent(v) { this.node.textContent = v; }
        async getOuterHTML() { return this.node.outerHTML; }
        async innerText() { return this.node.innerText; }
        async scrollIntoView(o) { this.node.scrollIntoView(o); }
        async setInnerHTML(v) { this.node.innerHTML = DOMPurify.sanitize(v); }
        async setStyleAttribute(v) { this.node.style.cssText = v; }
        async appendChild(child) { this.node.append(child.node); }
        async remove() { this.node.remove(); }
        async cloneNode(deep) { return new Safe(this.node.cloneNode(deep)); }
        async getBoundingClientRect() { return this.node.getBoundingClientRect().toJSON(); }
        async addEventListener(type, fn) { const cb = e => fn({ clientX: e.clientX, clientY: e.clientY, key: e.key, repeat: e.repeat }); document.addEventListener(type, cb); return String(Math.random()); }
        async removeEventListener() {}
        async createElement(tag) { return new Safe(document.createElement(tag)); }
      }
      const messages = [{ role: 'user', chatId: 'u0', data: '시작하자.' }, { role: 'char', chatId: 'r0', data: reply.join('\n') }];
      const row = (m, i) => `<div class="chat-message-container"><div class="risu-chat" data-chat-index="${i}"><div class="chattext">${m.data.split('\n').map(l => `<p>${l}</p>`).join('')}</div></div></div>`;
      document.body.innerHTML = `<div class="default-chat-screen" style="position:fixed;inset:0;overflow:auto;display:flex;flex-direction:column-reverse"><div style="height:90px;flex:none">입력창</div><div class="flex-col-reverse" style="display:flex;flex-direction:column-reverse;flex:none">${messages.map(row).reverse().join('')}</div></div>`;
      const bot = { chaId: 'bot', name: 'Bot', additionalAssets: [['하루키_neutral', 'assets/h.png', 'png']], chats: [{ id: 'chat', message: messages }], chatPage: 0 };
      const saved = new Map(), local = new Map();
      const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), c => c.charCodeAt(0));
      window.risuai = { pluginStorage: { getItem: async k => saved.get(k), setItem: async (k, v) => saved.set(k, v) }, getLocalPluginStorage: async () => ({ getItem: async k => local.get(k), setItem: async (k, v) => local.set(k, v), removeItem: async k => local.delete(k) }),
        getDatabase: async () => ({ characters: [structuredClone(bot)], modules: [], enabledModules: [] }), getCurrentCharacterIndex: async () => 0, getCurrentChatIndex: async () => 0,
        getCharacterFromIndex: async () => structuredClone(bot), getCharacter: async () => structuredClone(bot),
        readImage: async () => png, getRootDocument: async () => new Safe(document), registerButton: async (arg, fn) => { window.buttons[arg.id] = fn; return { id: arg.id }; },
        // The character LLM (the 보조 모델): what it is asked is kept, and it answers when the test says.
        runLLMModel: async ({ messages }) => { window.llmCalls.push(messages); return new Promise(resolve => { window.answerLlm = content => resolve({ success: true, content }); }); } };
    }, { reply: REPLY });
    await page.evaluate(() => { window.crypto.randomUUID = undefined; });
    await page.addScriptTag({ content: built.outputFiles[0].text });
    await page.evaluate(async () => {
      await window.loadTtsData(); const d = window.ttsData(); d.settings.enabled = false;
      const card = (id, name, gender, tags) => ({ id, scope: 'global', name, surname: '', givenName: name, surnameAliases: [], givenAliases: [], triggers: [], tags, gender, voiceKey: '', fishId: '', fixed: false, gain: 0 });
      d.characters.push(card('t-ref', '체육관 심판', 'male', ['중년', '열정적']), card('t-haruki', '하루키', 'female', []));
      await window.loadEmotionData(); const e = window.emotionData(); e.settings.enabled = true; e.settings.autoGenerate = true; e.settings.placeBackgrounds = false;
      await window.installOmniViewer();
    });
    const text = () => page.evaluate(() => document.querySelector('[x-omni-vn] [data-vn-text]')?.textContent || '');
    const scene = () => page.evaluate(() => document.querySelector('[x-omni-vn-style="scene"]')?.textContent || '');
    const sceneSays = re => page.waitForFunction(source => new RegExp(source).test(document.querySelector('[x-omni-vn-style="scene"]')?.textContent || ''), re.source);
    const lineDone = () => page.waitForFunction(() => { const cue = document.querySelector('[x-omni-vn] [data-vn-next],[x-omni-vn] [data-vn-end]'); return !cue || getComputedStyle(cue).opacity !== '0'; });
    // The referee's oval as the page lays it out: the tap goes where the reader sees it, on its outer side (away from
    // the stage's middle). The oval is wide: only out there does an oval worked out at the wrong spot miss.
    const tapOval = async () => {
      const [b, stage] = await page.evaluate(() => {
        const sil = [...document.querySelectorAll('[x-omni-vn] [x-vn-p] [data-vn-sil]')].find(n => n.textContent.includes('체육관 심판'));
        return [sil.getBoundingClientRect().toJSON(), document.querySelector('[x-omni-vn]').getBoundingClientRect().toJSON()];
      });
      const outer = b.x + b.width / 2 < stage.x + stage.width / 2 ? 0.15 : 0.85;
      await page.mouse.click(b.x + b.width * outer, b.y + b.height * 0.5);
    };

    await page.evaluate(() => window.buttons['omni-viewer-chat']());
    await page.waitForFunction(() => /2점 추가/.test(document.querySelector('[x-omni-vn] [data-vn-text]')?.textContent || ''));
    // Their face cannot be drawn for want of looks: the oval says what a tap does, not the error.
    await sceneSays(/\(happy\)\\A 외형 없음 · 눌러서 만들기/);
    assert.doesNotMatch(await scene(), /못 그림/);
    await lineDone();

    // A tap on it: the character LLM is asked, and the line stays where it is.
    await tapOval();
    await page.waitForFunction(() => window.llmCalls.length === 1);
    await sceneSays(/외형 만드는 중…/);
    const asked = await page.evaluate(() => JSON.stringify(window.llmCalls[0]));
    assert.match(asked, /Create exactly one character, \\"체육관 심판\\"/);
    assert.match(asked, /gender male; tags 중년, 열정적/, 'their voice card');
    assert.match(asked, /2점 추가.*미션 클리어입니다/, 'their lines in this reply');
    assert.match(await text(), /2점 추가/, 'the tap only made their looks');
    // An answer that is no character: the oval says it failed, and that a tap tries again.
    await page.evaluate(() => window.answerLlm('not a character'));
    await sceneSays(/외형 못 만듦 · 눌러서 다시/);

    // Anywhere else on the stage, a tap goes on as ever.
    const box = await page.locator('[x-omni-vn]').boundingBox();
    await page.mouse.click(box.x + 30, box.y + 200);
    await page.waitForFunction(() => /해냈다/.test(document.querySelector('[x-omni-vn] [data-vn-text]')?.textContent || ''));
    assert.equal(await page.evaluate(() => window.llmCalls.length), 1);
    // With two on stage, their oval stands elsewhere: a tap on it still tries again.
    await lineDone();
    await page.mouse.click(box.x + 30, box.y + 200);
    await page.waitForFunction(() => /미션 클리어/.test(document.querySelector('[x-omni-vn] [data-vn-text]')?.textContent || ''));
    await sceneSays(/외형 못 만듦 · 눌러서 다시/);
    await lineDone();
    await tapOval();
    await page.waitForFunction(() => window.llmCalls.length === 2);
    assert.match(await text(), /미션 클리어/);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
