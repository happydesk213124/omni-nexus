import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

// The chat side of BGM·효과음 on the same restricted SafeDOM host as OmniTTS:
// ♪ / ▶ buttons play, cues are rows of the viewer list, continuous reading plays them in place.
test('chat ♪ / ▶ play their cue; the TTS list carries the cues and reading plays them in order', async () => {
  const built = await build({ stdin: { contents: `import {installTtsHost} from './src/tts-ui/host-chat';import {TTS_MODULE_CSS} from './src/domain/tts/module';import {SOUND_MODULE_CSS} from './src/domain/sound/module';import {omniTts} from './src/services/tts-runtime';import {loadTtsData,ttsData,updateTtsSettings} from './src/storage/tts-store';import {omniSound} from './src/services/sound-runtime';import {loadSoundData,soundData,updateSoundSettings} from './src/storage/sound-store';Object.assign(window,{TTS_MODULE_CSS,SOUND_MODULE_CSS,installTtsHost,omniTts,loadTtsData,ttsData,updateTtsSettings,omniSound,loadSoundData,soundData,updateSoundSettings});`, resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife' });
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  try {
    const page = await browser.newPage(), errors = []; page.setDefaultTimeout(10000); page.on('pageerror', e => errors.push(e.message));
    await page.route('https://tts.test/', r => r.fulfill({ contentType: 'text/html', body: '<body></body>' })); await page.goto('https://tts.test/');
    await page.addScriptTag({ content: readFileSync('node_modules/dompurify/dist/purify.min.js', 'utf8') });
    const blockedSource = readFileSync('tools/vendor-patches/float-viewer.js', 'utf8').match(/globalThis\.__OMNI_TTS_HOST_BLOCKED__ = (.*);/)[1];
    await page.evaluate(blockedSource => {
      window.hostScreenState = {}; window.__OMNI_TTS_HOST_BLOCKED__ = new Function('t', 'return ' + blockedSource)(window.hostScreenState);
      // An existing save with empty lists, not a first run (which starts with the examples).
      const saved = new Map([['omnisound.data', '{}']]), local = new Map(); window.fish = 0; window.log = [];
      class Safe {
        constructor(node) { this.node = node; }
        async querySelector(s) { const n = this.node.querySelector(s); return n ? new Safe(n) : null; }
        async querySelectorAll(s) { return [...this.node.querySelectorAll(s)].map(n => new Safe(n)); }
        async getParent() { return this.node.parentElement ? new Safe(this.node.parentElement) : null; }
        async matches(s) { return this.node.nodeType === 1 && this.node.matches(s); }
        async getAttribute(k) { if (!k.startsWith('x-')) throw Error('Forbidden attribute read ' + k); return this.node.getAttribute(k); }
        async setAttribute(k, v) { if (!k.startsWith('x-')) throw Error('Forbidden attribute write ' + k); this.node.setAttribute(k, v); }
        async setTextContent(v) { this.node.textContent = v; }
        async getOuterHTML() { return this.node.outerHTML; }
        async setInnerHTML(v) { this.node.innerHTML = DOMPurify.sanitize(v); }
        async setStyle(k, v) { this.node.style[k] = v; }
        async setStyleAttribute(v) { this.node.style.cssText = v; }
        async appendChild(child) { this.node.append(child.node); }
        async remove() { this.node.remove(); }
        async scrollIntoView(o) { this.node.scrollIntoView(o); }
        async clientHeight() { return this.node.clientHeight; }
        async clientWidth() { return this.node.clientWidth; }
        async getBoundingClientRect() { return this.node.getBoundingClientRect().toJSON(); }
        async addEventListener(type, fn, options) { const cb = e => fn({ clientX: e.clientX, clientY: e.clientY, button: e.button, buttons: e.buttons, key: e.key }); document.addEventListener(type, cb, options); return crypto.randomUUID(); }
        async removeEventListener() {}
        async createElement(tag) { return new Safe(document.createElement(tag)); }
      }
      // As the modules render it: a ♪ line, two spoken lines, and an effect line between them.
      const reply = '[[bgm:calm,cafe,slow]]\n하린 (calm): "문 열어."\n§쾅§\n하린 (happy): "왔다!"';
      window.messages = [{ role: 'char', chatId: 'm0', data: reply }]; window.firstReply = reply;
      const tts = kind => `<span data-omnitts-tail="1"><button type="button" data-omnitts-play="1" data-omnitts-kind="${kind}"></button></span>`;
      document.body.innerHTML = '<div class="default-chat-screen"><div class="risu-chat" data-chat-index="0">'
        + '<p><span data-omni-bgm-tail="1"><button type="button" data-omni-bgm="1"></button></span></p>'
        + `<p>하린 (calm): “문 열어.”${tts('dialogue')}</p><p>§쾅§<span data-omni-sfx-tail="1"><button type="button" data-omni-sfx="1"></button></span>${tts('narration')}</p><p>하린 (happy): “왔다!”${tts('dialogue')}</p></div></div>`;
      const id3 = () => new Uint8Array([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]).buffer;
      // A real effect file: 1 s of silence, a quiet 0.3 s hit, 1 s of silence (8 kHz mono).
      window.paddedWav = () => { const rate = 8000, n = rate * 2.3, b = new ArrayBuffer(44 + n * 2), v = new DataView(b), w = (o, t) => [...t].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
        w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
        for (let i = rate; i < rate * 1.3; i++) v.setInt16(44 + i * 2, Math.round(1600 * Math.sin(i / 2)), true); return b; };
      window.blobs = []; const blobUrl = URL.createObjectURL.bind(URL); URL.createObjectURL = blob => { window.blobs.push({ type: blob.type, size: blob.size }); return blobUrl(blob); };
      window.risuai = {
        pluginStorage: { getItem: async k => saved.get(k), setItem: async (k, v) => saved.set(k, v) },
        getLocalPluginStorage: async () => ({ getItem: async k => local.get(k), setItem: async (k, v) => local.set(k, v), removeItem: async k => local.delete(k) }),
        getDatabase: async () => ({ modules: [], enabledModules: [] }), setDatabase: async () => {}, requestPluginPermission: async () => true,
        getRootDocument: async () => new Safe(document.documentElement),
        createMutationObserver: async fn => { const o = new MutationObserver(() => fn([])); return { observe: async (t, opt) => o.observe(t.node, opt), disconnect: async () => o.disconnect() }; },
        addRisuChatListener: async (_m, fn) => { window.output = fn; }, removeRisuChatListener: async () => {}, onUnload: async () => {},
        getCharacter: async () => ({ chaId: 'c', chatPage: 0, chats: [{ id: 'chat', message: window.messages }] }),
        nativeFetch: async url => { if (url.includes('snd.test/bang')) return { ok: true, arrayBuffer: async () => window.paddedWav() }; if (url.includes('snd.test')) return { ok: true, arrayBuffer: async () => id3() }; window.fish++; return { ok: true, arrayBuffer: async () => new Uint8Array(32).buffer }; },
      };
      // Every clip ends on its own a moment after it starts, so reading moves on.
      window.Audio = class { src = ''; currentTime = 0; duration = 1; loop = false; paused = true; on = {};
        addEventListener(t, f) { (this.on[t] ||= []).push(f); }
        fire(t) { const list = this.on[t] || []; this.on[t] = []; for (const f of list) f(); if (t === 'ended') this.onended?.(); }
        async play() { this.paused = false; if (!this.loop && !window.holdAudio) setTimeout(() => this.fire('ended'), 40); }
        pause() { this.paused = true; } load() {} removeAttribute() { this.src = ''; } };
      window.AudioContext = class { state = 'running'; destination = {}; currentTime = 0; async resume() {} createGain() { return { gain: { value: 1, setTargetAtTime() {}, cancelScheduledValues() {}, setValueAtTime() {}, linearRampToValueAtTime() {} }, connect(n) { return n || this; } }; } createMediaElementSource() { return { connect(n) { return n; } }; } };
    }, blockedSource);
    await page.addScriptTag({ content: built.outputFiles[0].text });
    await page.evaluate(async () => {
      const style = document.createElement('style'); style.textContent = window.TTS_MODULE_CSS + window.SOUND_MODULE_CSS.bgm + window.SOUND_MODULE_CSS.sfx; document.head.append(style);
      await window.loadTtsData(); const d = window.ttsData();
      Object.assign(d.settings, { enabled: true, autoAssign: false, continuous: true, autoReply: false, prefetch: 0 }); d.settings.translation.provider = 'off'; d.settings.fish.key = 'test-key';
      d.characters = [{ id: 'h', scope: 'global', name: '하린', surname: '', givenName: '하린', surnameAliases: [], givenAliases: [], triggers: ['하린'], tags: [], gender: 'female', voiceKey: d.voices[0].key, fishId: d.voices[0].fishId, fixed: false, gain: 0 }];
      await window.loadSoundData(); const s = window.soundData();
      s.bgm.push({ key: 'cafe', kind: 'bgm', name: '카페', tags: ['calm', 'cafe', 'slow'], folder: '', source: 'url', url: 'https://snd.test/cafe.mp3' }, { key: 'chase', kind: 'bgm', name: '추격', tags: ['tense', 'chase', 'fast'], folder: '', source: 'url', url: 'https://snd.test/chase.mp3' });
      s.sfx.push({ key: 'bang', kind: 'sfx', name: '쾅', tags: ['쾅'], folder: '', source: 'url', url: 'https://snd.test/bang.mp3' });
      await window.updateSoundSettings({ bgmEnabled: true, sfxEnabled: true, sfxMatcher: 'tag', bgmMatcher: 'tag' });
      const prepare = window.omniSound.prepareEffects.bind(window.omniSound); window.omniSound.prepareEffects = async words => { window.prepared = words.map(w => w.text); return prepare(words); };
      await window.installTtsHost(); await window.omniTts.player.unlock();
      const player = window.omniSound.player, bgm = player.playBgm.bind(player), sfx = player.playSfx.bind(player);
      player.playBgm = (key, ...rest) => { window.log.push('bgm:' + key); return bgm(key, ...rest); };
      player.playSfx = (...rest) => { window.log.push('sfx'); return sfx(...rest); };
      let last = '';
      window.omniTts.subscribe(() => { const now = window.omniTts.player.status === 'playing' ? 'tts:' + window.omniTts.current?.segment.id : ''; if (now && now !== last) window.log.push(now); last = now; });
    });
    await page.waitForFunction(() => window.prepared?.includes('쾅'), undefined, { timeout: 5000 });
    // The viewer list: ♪ row, the lines, the ▶ row between them. The effect-only line is not read.
    await page.waitForFunction(() => window.omniTts.list.length === 4);
    assert.deepEqual(await page.evaluate(() => window.omniTts.list.map(r => r.segment.kind)), ['bgm', 'dialogue', 'sfx', 'dialogue']);
    await page.locator('[data-tts-control="list"]').click();
    await page.waitForFunction(() => document.querySelectorAll('[data-tts-control^="line-"]').length === 4);
    assert.deepEqual(await page.locator('[data-tts-control^="line-"]').allTextContents(), ['♪BGM · calm, cafe, slow', '하린: 문 열어.calm', '▶효과음 · 쾅', '하린: 왔다!happy']);

    // ▶ is a line of the TTS list: it plays through the voice player, shows the same state, and ■ stops it.
    const sfxId = await page.evaluate(() => window.omniTts.list[2].segment.id);
    const sfxState = () => page.evaluate(() => document.querySelector('[data-omni-sfx]').getAttribute('x-omnitts-state') || '');
    await page.evaluate(() => { window.holdAudio = true; });
    await page.locator('[data-omni-sfx]').click();
    await page.waitForFunction(() => document.querySelector('[data-omni-sfx]').getAttribute('x-omnitts-state') === 'playing');
    assert.equal(await page.evaluate(() => window.omniTts.current?.segment.kind), 'sfx', 'the viewer bar follows the effect');
    assert.notEqual(await page.evaluate(() => getComputedStyle(document.querySelector('[data-omni-sfx]'), '::before').content), '"▶"', 'the ▶ turns into the playing bars');
    assert.equal(await page.evaluate(() => window.log.includes('sfx')), false, 'not a second channel beside the voice');
    const clip = await page.evaluate(() => window.blobs.at(-1));
    assert.equal(clip.type, 'audio/wav', 'the voice player gets the processed clip');
    const seconds = (clip.size - 44) / 2 / 44100;
    assert.ok(seconds > .3 && seconds < .42, 'the silence on both sides is gone: ' + seconds.toFixed(3) + ' s of 2.3 s');
    await page.evaluate(() => window.omniTts.stop());
    await page.waitForFunction(() => !document.querySelector('[data-omni-sfx]').getAttribute('x-omnitts-state') && window.omniTts.player.status === 'idle');
    await page.locator('[data-omni-bgm]').click();
    await page.waitForFunction(() => window.log.includes('bgm:cafe'));
    assert.equal(await page.evaluate(() => window.fish), 0, 'a sound button never synthesizes speech');
    // One voice at a time: a line cuts a playing effect, an effect cuts a playing line.
    await page.locator('[data-omni-sfx]').click();
    await page.waitForFunction(() => document.querySelector('[data-omni-sfx]').getAttribute('x-omnitts-state') === 'playing');
    await page.locator('[data-omnitts-kind="dialogue"]').first().click();
    await page.waitForFunction(() => window.omniTts.current?.segment.kind === 'dialogue' && window.omniTts.player.status === 'playing');
    assert.equal(await sfxState(), '', 'the effect stopped for the line');
    await page.locator('[data-omni-sfx]').click();
    await page.waitForFunction(() => window.omniTts.current?.segment.kind === 'sfx' && window.omniTts.player.status === 'playing');
    await page.evaluate(() => { window.holdAudio = false; window.omniTts.stop(); });

    // Continuous reading from the ♪ row: the music changes, the line is read, the effect plays to its end, the next line.
    await page.evaluate(() => { window.omniSound.player.stopBgm(); window.log = []; });
    await page.locator('[data-tts-control="line-0"]').click();
    await page.waitForFunction(() => window.log.includes('tts:4'), undefined, { timeout: 8000 });
    assert.deepEqual(await page.evaluate(() => window.log), ['bgm:cafe', 'tts:2', 'tts:' + sfxId, 'tts:4'], 'the effect plays in its place, through the voice player');

    // Effects set to "button only": reading steps over them, a tap still plays.
    await page.evaluate(async () => { await window.updateSoundSettings({ sfxAutoPlay: 'button' }); window.log = []; });
    await page.locator('[data-tts-control="line-1"]').click();
    await page.waitForFunction(() => window.log.includes('tts:4'), undefined, { timeout: 8000 });
    assert.deepEqual(await page.evaluate(() => window.log), ['tts:2', 'tts:4']);

    // A new reply changes the music at once when reading will not reach its cue (here: TTS does not auto-read).
    await page.evaluate(() => { window.messages[0] = { ...window.messages[0], data: '[[bgm:tense,chase,fast]]\n하린 (calm): "도망쳐!"' }; window.log = []; });
    await page.evaluate(() => window.output({ char: { chaId: 'c' }, chat: { id: 'chat' }, messageIndex: 0 }));
    await page.waitForFunction(() => window.log.includes('bgm:chase'));
    // A reply with no [[bgm:…]] tag hands its own text to the BGM picker (JEV or the LLM).
    await page.evaluate(() => { window.realReplyPick = window.omniSound.playBgmForReply; window.omniSound.playBgmForReply = async (text, tags) => { window.replyPick = [text, tags ?? null]; return ''; };
      window.messages[0] = { ...window.messages[0], data: '하린 (calm): "태그 없는 응답."' }; });
    await page.evaluate(() => window.output({ char: { chaId: 'c' }, chat: { id: 'chat' }, messageIndex: 0 }));
    await page.waitForFunction(() => window.replyPick?.[0].includes('태그 없는 응답') && window.replyPick[1] === null);
    await page.evaluate(() => { window.omniSound.playBgmForReply = window.realReplyPick; });

    // TTS off: the sound buttons still work, on the effect channel (the chat shows the first reply again).
    await page.evaluate(async () => { window.messages[0] = { ...window.messages[0], data: window.firstReply }; await window.updateTtsSettings({ enabled: false }); document.querySelector('.risu-chat').append(document.createComment('re-render')); window.log = []; });
    await page.locator('[data-omni-sfx]').click();
    await page.waitForFunction(() => window.log.includes('sfx'));
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
