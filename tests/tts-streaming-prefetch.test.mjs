import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

/**
 * 미리 만들기 while a reply streams: the line still being written changes with
 * every chunk (「미야: 태평」, 「미야: 태평하게 여기」…), so only lines the model
 * has finished with a newline are voiced ahead; the rest once the reply ends.
 * And the OpenRouter route prefetches too (only Fish's own key was checked).
 */
test('a streaming reply is voiced ahead only up to its last finished line; OpenRouter prefetches too', { timeout: 90000 }, async () => {
  const built = await build({ stdin: { contents: `import {installTtsHost} from './src/tts-ui/host-chat';import {omniTts} from './src/services/tts-runtime';import {loadTtsData,ttsData,updateTtsSettings} from './src/storage/tts-store';Object.assign(window,{installTtsHost,omniTts,loadTtsData,ttsData,updateTtsSettings});`, resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife' });
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
        async querySelector(s){const n=this.node.querySelector(s);return n?new Safe(n):null;}
        async querySelectorAll(s){return [...this.node.querySelectorAll(s)].map(n=>new Safe(n));}
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
        async getBoundingClientRect(){return this.node.getBoundingClientRect().toJSON();}
        async addEventListener(type,fn,options){if(!['click','pointerenter','pointerdown','pointermove','pointerup','pointercancel','mouseover','keydown','scroll'].includes(type))throw Error('Unsupported host event '+type);const id=hostUUID();const cb=e=>fn({clientX:e.clientX,clientY:e.clientY,button:e.button,buttons:e.buttons,key:e.key});this.listeners.set(id,[type,cb,options]);document.addEventListener(type,cb,options);window.apiEvents.push(type);return id;}
        async removeEventListener(type,id){const x=this.listeners.get(id);if(x){document.removeEventListener(type,x[1],x[2]);this.listeners.delete(id);}}
        async createElement(tag){if(!['div','button','style'].includes(tag))throw Error('Unsupported host element '+tag);return new Safe(document.createElement(tag));}
      }
      window.calls = [];
      window.chat = { id: 'chat', isStreaming: true, message: [{ role: 'char', chatId: 'm0', data: '' }] };
      const tail = '<span data-omnitts-tail="1"><button type="button" data-omnitts-play="1" data-omnitts-kind="dialogue" title="재생" aria-label="재생"></button></span>';
      // What the module draws for the reply as it stands: a control after every line, the unfinished one too.
      window.write = text => {
        window.chat.message[0].data = text;
        document.querySelector('.default-chat-screen').innerHTML = '<div class="risu-chat" data-chat-index="0">' + text.split('\n').filter(Boolean).map(line => '<p>' + DOMPurify.sanitize(line) + tail + '</p>').join('') + '</div>';
      };
      document.body.innerHTML = '<div class="default-chat-screen"></div>';
      window.risuai = { pluginStorage: { getItem: async k => saved.get(k), setItem: async (k, v) => saved.set(k, v) }, getLocalPluginStorage: async () => ({ getItem: async k => local.get(k), setItem: async (k, v) => local.set(k, v), removeItem: async k => local.delete(k) }), getDatabase: async () => ({ modules: [], enabledModules: [] }), setDatabase: async () => {}, requestPluginPermission: async () => true, getRootDocument: async () => new Safe(document.documentElement), unwarpSafeArray: async a => { const result = []; for (let i = 0, n = await a.length(); i < n; i++) result.push(await a.at(i)); return result; },
        createMutationObserver: async fn => { const observer = new MutationObserver(rows => fn(rows.map(row => ({ getTarget: async () => new Safe(row.target) })))); return { observe: async (target, options) => observer.observe(target.node, options), disconnect: async () => observer.disconnect() }; }, addRisuChatListener: async () => {}, removeRisuChatListener: async () => {}, onUnload: async () => {},
        getCharacter: async () => ({ chaId: 'c', chatPage: 0, chats: [window.chat] }),
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
    const texts = () => page.evaluate(() => window.calls.map(c => c.text));
    const settle = () => page.waitForTimeout(1200);
    // Mid-stream: a quoted line is finished; the narration after it is still growing.
    await page.evaluate(() => window.write('미야: "태평하게 여기지마"\n리나는 고개를 끄'));
    await page.waitForFunction(() => window.calls.some(c => c.text.includes('태평하게 여기지마')));
    for (const more of ['덕', '였다. 그리고', ' 웃었다.']) { await page.evaluate(more => window.write(window.chat.message[0].data + more), more); await settle(); }
    assert.deepEqual((await texts()).filter(t => t.includes('리나는')), [], 'the line still being written is never voiced, however often it grows');
    assert.equal((await texts()).filter(t => t.includes('태평')).length, 1, 'a finished line is voiced once');
    // Its newline arrives: now it is finished and voiced, once; the next line waits.
    await page.evaluate(() => window.write(window.chat.message[0].data + '\n하나는 그'));
    await page.waitForFunction(() => window.calls.some(c => c.text.includes('리나는 고개를 끄덕였다. 그리고 웃었다.')));
    await settle();
    assert.deepEqual((await texts()).filter(t => t.includes('리나는')), ['리나는 고개를 끄덕였다. 그리고 웃었다.'], 'voiced once, whole');
    assert.deepEqual((await texts()).filter(t => t.includes('하나는')), [], 'and the new unfinished line waits');
    // The reply ends: its last line is voiced, once, as written in full.
    await page.evaluate(() => { window.chat.isStreaming = false; window.write(window.chat.message[0].data + '래도 따라갔다.'); });
    await page.waitForFunction(() => window.calls.some(c => c.text.includes('하나는 그래도 따라갔다.')));
    await settle();
    assert.deepEqual((await texts()).filter(t => t.includes('하나는')), ['하나는 그래도 따라갔다.'], 'the finished reply makes that line once, never its fragments');
    assert.ok((await page.evaluate(() => window.calls)).every(c => c.url.includes('fish.audio')), 'Fish route');
    // OpenRouter: no Fish key, an OpenRouter key; lines on screen are voiced ahead through it.
    await page.evaluate(async () => {
      window.calls = [];
      await window.updateTtsSettings({ fish: { ...window.ttsData().settings.fish, via: 'openrouter', key: '', routerKey: 'or-key' } });
      window.write(window.chat.message[0].data + '\n미야: "오픈라우터로 미리"\n');
    });
    await page.waitForFunction(() => window.calls.some(c => c.text.includes('오픈라우터로 미리')));
    assert.ok((await page.evaluate(() => window.calls)).every(c => c.url.includes('openrouter.ai')), 'through OpenRouter');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
