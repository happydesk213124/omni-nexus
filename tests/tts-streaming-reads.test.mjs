import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';


/**
 * A long chat streaming a reply: each read of the context is the whole bot over Risu's bridge, and the chat's
 * watchers read it on every chunk. While the reply streams the read made during it stands (its last message the
 * text that came); the saved chat is read again at its end.
 */
test('a reply streaming into a long chat reads the bot once, not on every chunk; its finished lines still voiced ahead, the saved chat read at its end', { timeout: 90000 }, async () => {
  const built = await build({ stdin: { contents: `import {installTtsHost} from './src/tts-ui/host-chat';import {omniTts} from './src/services/tts-runtime';import {loadTtsData,ttsData,updateTtsSettings} from './src/storage/tts-store';import {noteStreamText} from './src/services/tts-context';Object.assign(window,{installTtsHost,omniTts,loadTtsData,ttsData,updateTtsSettings,noteStreamText});`, resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife' });
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  try {
    const page = await browser.newPage(), errors = [];
    page.setDefaultTimeout(12000); page.on('pageerror', e => errors.push(e.message));
    await page.route('https://tts.test/', r => r.fulfill({ contentType: 'text/html', body: '<body></body>' })); await page.goto('https://tts.test/');
    await page.addScriptTag({ content: readFileSync('node_modules/dompurify/dist/purify.min.js', 'utf8') });
    const blockedSource = readFileSync('tools/vendor-patches/float-viewer.js', 'utf8').match(/globalThis\.__OMNI_TTS_HOST_BLOCKED__ = (.*);/)[1];
    await page.evaluate(blockedSource => {
      window.hostScreenState = {}; window.__OMNI_TTS_HOST_BLOCKED__ = new Function('t', 'return ' + blockedSource)(window.hostScreenState);
      const saved = new Map([['omnisound.data', '{}']]), local = new Map(), hostUUID = crypto.randomUUID.bind(crypto); window.apiEvents = [];
      class Safe {
        constructor(node){this.node=node;this.listeners=new Map();}
        async querySelector(s){window.hostCalls=(window.hostCalls||0)+1;const n=this.node.querySelector(s);return n?new Safe(n):null;}
        async querySelectorAll(s){window.hostCalls=(window.hostCalls||0)+1;return [...this.node.querySelectorAll(s)].map(n=>new Safe(n));}
        async getParent(){return this.node.parentElement?new Safe(this.node.parentElement):null;}
        async matches(s){return this.node.nodeType===1&&this.node.matches(s);}
        async getAttribute(k){if(!k.startsWith('x-'))throw Error('Forbidden attribute read '+k);return this.node.getAttribute(k);}
        async setAttribute(k,v){if(!k.startsWith('x-'))throw Error('Forbidden attribute write '+k);this.node.setAttribute(k,v);}
        async setTextContent(v){this.node.textContent=v;}
        async getOuterHTML(){window.outerReads=(window.outerReads||0)+1;return this.node.outerHTML;}
        async setInnerHTML(v){this.node.innerHTML=DOMPurify.sanitize(v);}
        async setStyle(k,v){this.node.style[k]=v;}
        async setStyleAttribute(v){this.node.style.cssText=v;}
        async appendChild(child){this.node.append(child.node);}
        async remove(){this.node.remove();}
        async scrollIntoView(o){window.scrolled=(window.scrolled||[]).concat(this.node.getAttribute('data-omnitts-kind')||this.node.tagName);this.node.scrollIntoView(o);}
        async clientHeight(){return this.node.clientHeight;}
        async clientWidth(){return this.node.clientWidth;}
        async getBoundingClientRect(){window.hostCalls=(window.hostCalls||0)+1;return this.node.getBoundingClientRect().toJSON();}
        async addEventListener(type,fn,options){if(!['click','pointerenter','pointerdown','pointermove','pointerup','pointercancel','mouseover','keydown','scroll'].includes(type))throw Error('Unsupported host event '+type);const id=hostUUID();const cb=e=>fn({clientX:e.clientX,clientY:e.clientY,button:e.button,buttons:e.buttons,key:e.key});this.listeners.set(id,[type,cb,options]);document.addEventListener(type,cb,options);window.apiEvents.push(type);return id;}
        async removeEventListener(type,id){const x=this.listeners.get(id);if(x){document.removeEventListener(type,x[1],x[2]);this.listeners.delete(id);}}
        async createElement(tag){if(!['div','button','style'].includes(tag))throw Error('Unsupported host element '+tag);return new Safe(document.createElement(tag));}
      }
      window.calls = [];
      window.chat = { id: 'chat', isStreaming: true, message: [...Array.from({ length: 300 }, (_, i) => ({ role: i % 2 ? 'char' : 'user', chatId: 'old' + i, data: '옛 메시지 ' + i })), { role: 'char', chatId: 'm0', data: '' }] };
      window.last = () => window.chat.message[window.chat.message.length - 1];
      const tail = '<span data-omnitts-tail="1"><button type="button" data-omnitts-play="1" data-omnitts-kind="dialogue" title="재생" aria-label="재생"></button></span>';
      // What the module draws for the reply as it stands: a control after every line, the unfinished one too.
      window.write = text => {
        window.last().data = text;
        document.querySelector('.default-chat-screen').innerHTML = '<div class="risu-chat" data-chat-index="300">' + text.split('\n').filter(Boolean).map(line => '<p>' + DOMPurify.sanitize(line) + tail + '</p>').join('') + '</div>';
      };
      document.body.innerHTML = '<div class="default-chat-screen"></div>';
      window.risuai = { pluginStorage: { getItem: async k => saved.get(k), setItem: async (k, v) => saved.set(k, v) }, getLocalPluginStorage: async () => ({ getItem: async k => local.get(k), setItem: async (k, v) => local.set(k, v), removeItem: async k => local.delete(k) }), getDatabase: async () => ({ modules: [], enabledModules: [] }), setDatabase: async () => {}, requestPluginPermission: async () => true, getRootDocument: async () => new Safe(document.documentElement), unwarpSafeArray: async a => { const result = []; for (let i = 0, n = await a.length(); i < n; i++) result.push(await a.at(i)); return result; },
        createMutationObserver: async fn => { const observer = new MutationObserver(rows => fn(rows.map(row => ({ getTarget: async () => new Safe(row.target) })))); return { observe: async (target, options) => observer.observe(target.node, options), disconnect: async () => observer.disconnect() }; }, addRisuChatListener: async (mode, fn) => { if (mode === 'output') window.output = fn; }, getCurrentCharacterIndex: async () => 0, getCurrentChatIndex: async () => 0, removeRisuChatListener: async () => {}, onUnload: async () => {},
        getCharacter: async () => { window.reads = (window.reads || 0) + 1; return { chaId: 'c', chatPage: 0, chats: [window.chat] }; },
        nativeFetch: async (url, options) => { const body = JSON.parse(options.body); window.calls.push({ url: String(url), text: body.text ?? body.input }); return { ok: true, arrayBuffer: async () => new Uint8Array(32).buffer }; } };
      window.Audio = class { src = ''; currentTime = 0; duration = 1; async play() {} pause() {} load() {} removeAttribute() {} };
      window.AudioContext = class { state = 'running'; destination = {}; async resume() {} createGain() { return { gain: { value: 1 }, connect() { return this; } }; } createMediaElementSource() { return { connect(node) { return node; } }; } };
    }, blockedSource);
    await page.evaluate(() => { window.crypto.randomUUID = undefined; });
    await page.addScriptTag({ content: built.outputFiles[0].text });
    await page.evaluate(async () => {
      await window.loadTtsData(); const d = window.ttsData(), v = d.voices[0];
      Object.assign(d.settings, { enabled: true, autoAssign: false, continuous: false, prefetch: 50, narration: true, narrationVoice: v.key }); d.settings.translation.provider = 'off'; d.settings.fish.key = 'fish-key';
      const person = name => ({ id: name, scope: 'global', name, surname: '', givenName: name, surnameAliases: [], givenAliases: [], triggers: [name], tags: [], gender: 'female', voiceKey: v.key, fishId: v.fishId, fixed: false, gain: 0 });
      d.characters = [person('미야'), person('리나'), person('하나')];
      await window.installTtsHost();
    });

    // Risu gives each chunk to the output script (the frozen UI's), which hands it on; the chat changes with it.
    const chunk = more => page.evaluate(more => { const text = window.last().data + more; window.noteStreamText(text); window.write(text); }, more);
    await chunk('미야: "첫 줄이야"\n리나는 ');
    await page.waitForFunction(() => window.calls.some(c => c.text.includes('첫 줄이야')));
    const before = await page.evaluate(() => window.reads);
    const lines = ['고개를 끄덕였다.\n', '하나: "둘째 줄"\n', '미야는 ', '웃었다.\n', '리나: "셋째 줄"\n', '하나는 ', '창밖을 봤다.\n', '미야: "넷째 줄"\n', '하나는 문을 '];
    for (const more of lines) { await chunk(more); await page.waitForTimeout(300); }
    // A line finished after the read that stands is voiced ahead all the same: the text that came is what is read.
    await page.waitForFunction(() => window.calls.some(c => c.text.includes('넷째 줄')));
    const during = (await page.evaluate(() => window.reads)) - before;
    assert.ok(during <= 1, `the bot (every message of the chat) read ${during} times while ${lines.length} chunks came: once at most`);
    assert.deepEqual((await page.evaluate(() => window.calls.map(c => c.text))).filter(t => t.includes('문을')), [], 'the line still being written is still never voiced');
    // The reply is saved (Risu's output event): the chat is read again, as saved, and its last line voiced.
    await page.evaluate(async () => { window.chat.isStreaming = false; window.write(window.last().data + '열었다.\n하나: "끝 줄"'); await window.output({ char: { chaId: 'c' }, chat: { id: 'chat' }, messageIndex: 300 }); });
    const saved = await page.evaluate(() => window.reads);
    await page.evaluate(() => window.write(window.last().data + ' '));
    await page.waitForFunction(n => window.reads > n, saved);
    await page.waitForFunction(() => window.calls.some(c => c.text.includes('끝 줄')));
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
