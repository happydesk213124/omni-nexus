/**
 * 옴니 뷰어's tap latency, measured: the built viewer and the TTS chat UI over a SafeDOM
 * whose every call pays a cross-frame message hop each way (as Risu v3's bridge does), on
 * a throttled CPU (a phone), with a character as heavy as a long-played one. The taps go
 * through six replies, so stepping inside a reply and crossing into the next are both
 * measured. Per tap: press → the next line's text in the page → the frame after it, the
 * bridge calls on the way, and every call the tap set off in the next 1.5 s (whoever made
 * them: the viewer, the voice, the TTS window behind it).
 *
 *   node tools/bench-viewer.mjs [--cpu=4] [--taps=30] [--chat-mb=3] [--no-tts] [--trace] [--css=...]
 *
 * --trace adds where the main thread's time went over the taps (style, layout, paint,
 * script), by Chrome's own trace. --css adds a style sheet over the viewer's, to try a
 * change to its look before making it.
 *
 * A measurement tool, not a test: the numbers move with the machine. Compare runs on the
 * same machine before and after a change.
 */
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const arg = (name, fallback) => Number(process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback);
const CPU = arg('cpu', 4), TAPS = arg('taps', 30), CHAT_MB = arg('chat-mb', 3), TTS = !process.argv.includes('--no-tts'), TRACE = process.argv.includes('--trace');
const CSS = process.argv.find(a => a.startsWith('--css='))?.slice(6) ?? '';

const SPEAKERS = [['오미선', 't-misun'], ['하린', 't-harin'], ['세라', 't-sera']];
const FACES = ['happy', 'sad', 'angry', 'surprised', 'neutral'];
const REPLIES = 6, LINES = 7;
// Each line carries its reply's number (R3): the page tells a step inside a reply from a crossing.
function reply(r) {
  const lines = r === 0 ? ['[[place:cafe, indoors]]', '[3월 2일 ◆ 오후 4시 ◆ 카페]'] : [];
  for (let i = 0; i < LINES; i++) {
    const [name] = SPEAKERS[(r + i) % 3], face = FACES[(r * 3 + i * 7) % FACES.length];
    if (i % 4 === 3) lines.push(`R${r} 창밖으로 비가 조금씩 굵어졌다. 사람들은 우산을 펴고 걸음을 재촉했다. 유리창에 맺힌 빗방울이 길게 흘러내렸다.`);
    else lines.push(`${name} (${face}): "R${r} ${'그래, 오늘은 정말 긴 하루였어. 너도 그렇지? '.repeat(1 + (i % 3))}"`);
  }
  return lines.join('\n');
}

const built = await build({ stdin: { contents: "import {installOmniViewer} from './src/viewer/omni-viewer';import {installTtsHost} from './src/tts-ui/host-chat';import {omniTts} from './src/services/tts-runtime';import {loadTtsData,ttsData} from './src/storage/tts-store';import {loadEmotionData,emotionData} from './src/storage/emotion-store';Object.assign(window,{installOmniViewer,installTtsHost,omniTts,loadTtsData,ttsData,loadEmotionData,emotionData});", resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife' });
const blockedSource = readFileSync('tools/vendor-patches/float-viewer.js', 'utf8').match(/globalThis\.__OMNI_TTS_HOST_BLOCKED__ = (.*);/)[1];
const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
try {
  const page = await browser.newPage({ viewport: { width: 412, height: 915 } }), errors = [];
  page.setDefaultTimeout(60000); page.on('pageerror', e => errors.push(e.message));
  await page.route('https://vn.test/', r => r.fulfill({ contentType: 'text/html', body: '<html><head></head><body style="margin:0;background:#111"></body></html>' }));
  await page.goto('https://vn.test/');
  await page.addScriptTag({ content: readFileSync('node_modules/dompurify/dist/purify.min.js', 'utf8') });
  await page.evaluate(({ replies, speakers, faces, chatMb, blockedSource }) => {
    window.__OMNI_TTS_HOST_BLOCKED__ = new Function('t', 'return ' + blockedSource)({});
    // Noise pictures (PNG can not squeeze them): a sprite and a background, as large as NovelAI's.
    const noise = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'), d = g.createImageData(w, h); for (let i = 0; i < d.data.length; i += 4) { d.data[i] = Math.random() * 255; d.data[i + 1] = Math.random() * 255; d.data[i + 2] = Math.random() * 255; d.data[i + 3] = 255; } g.putImageData(d, 0, 0); return Uint8Array.from(atob(c.toDataURL('image/png').split(',')[1]), ch => ch.charCodeAt(0)); };
    const sprite = noise(640, 960), background = noise(1216, 832);
    // The bridge: every call is a message to the host and one back (a task each way), as Risu v3's postMessage RPC.
    const channel = new MessageChannel(), waiting = new Map(); let seq = 0;
    channel.port2.onmessage = e => channel.port2.postMessage(e.data);
    channel.port1.onmessage = e => { const done = waiting.get(e.data); waiting.delete(e.data); done?.(); };
    const hop = () => new Promise(resolve => { const id = ++seq; waiting.set(id, resolve); channel.port1.postMessage(id); });
    window.callLog = [];
    const call = async (name, op) => { window.callLog.push([performance.now(), name]); await hop(); const out = await op(); await hop(); return out; };
    class Safe {
      constructor(node) { this.node = node; this.listeners = new Map(); }
      release() {}
      querySelector(s) { return call('querySelector', () => { const n = this.node.querySelector(s); return n ? new Safe(n) : null; }); }
      querySelectorAll(s) { return call('querySelectorAll', () => [...this.node.querySelectorAll(s)].map(n => new Safe(n))); }
      getParent() { return call('getParent', () => this.node.parentElement ? new Safe(this.node.parentElement) : null); }
      matches(s) { return call('matches', () => this.node.nodeType === 1 && this.node.matches(s)); }
      setAttribute(k, v) { return call('setAttribute', () => this.node.setAttribute(k, v)); }
      getAttribute(k) { return call('getAttribute', () => this.node.getAttribute(k)); }
      setTextContent(v) { return call('setTextContent', () => { this.node.textContent = v; }); }
      innerText() { return call('innerText', () => this.node.innerText); }
      scrollIntoView(o) { return call('scrollIntoView', () => this.node.scrollIntoView(o)); }
      getInnerHTML() { return call('getInnerHTML', () => this.node.innerHTML); }
      getOuterHTML() { return call('getOuterHTML', () => this.node.outerHTML); }
      setInnerHTML(v) { return call('setInnerHTML', () => { this.node.innerHTML = DOMPurify.sanitize(v); }); }
      setStyle(k, v) { return call('setStyle', () => { this.node.style[k] = v; }); }
      setStyleAttribute(v) { return call('setStyleAttribute', () => { this.node.style.cssText = v; }); }
      appendChild(child) { return call('appendChild', () => this.node.append(child.node)); }
      remove() { return call('remove', () => this.node.remove()); }
      cloneNode(deep) { return call('cloneNode', () => new Safe(this.node.cloneNode(deep))); }
      clientHeight() { return call('clientHeight', () => this.node.clientHeight); }
      clientWidth() { return call('clientWidth', () => this.node.clientWidth); }
      getBoundingClientRect() { return call('rect', () => this.node.getBoundingClientRect().toJSON()); }
      createElement(tag) { return call('createElement', () => new Safe(document.createElement(tag))); }
      addEventListener(type, fn, options) { return call('addEventListener', () => { const id = String(Math.random()); const cb = e => { const data = { clientX: e.clientX, clientY: e.clientY, button: e.button, buttons: e.buttons, key: e.key, repeat: e.repeat }; hop().then(() => fn(data)); }; this.listeners.set(id, [type, cb, options]); document.addEventListener(type, cb, options); return id; }); }
      removeEventListener(type, id) { return call('removeEventListener', () => { const x = this.listeners.get(id); if (x) { document.removeEventListener(type, x[1], x[2]); this.listeners.delete(id); } }); }
    }
    // The chat: thirty older messages, then six replies with the reader's turns between them.
    const messages = [];
    for (let i = 0; i < 30; i++) messages.push({ role: i % 2 ? 'char' : 'user', chatId: `old${i}`, data: i % 2 ? `하린 (happy): "오래된 답장 ${i}. ${'이전 이야기가 이어진다. '.repeat(12)}"` : `내 말 ${i}` });
    replies.forEach((text, r) => { messages.push({ role: 'char', chatId: `r${r}`, data: text }); if (r < replies.length - 1) messages.push({ role: 'user', chatId: `u${r}`, data: '응, 계속해.' }); });
    const row = (m, i) => `<div class="chat-message-container"><div class="risu-chat" data-chat-index="${i}"><div class="flex"><div class="avatar"><img alt="" width="40" height="40"></div><div class="flex-col"><div class="name"><span>${m.role === 'char' ? 'Bot' : 'Me'}</span><div class="buttons"><button>↻</button><button>✎</button><button>🗑</button></div></div><div class="chattext prose">${String(m.data).split('\n').map(l => `<p>${l}</p>`).join('')}</div></div></div></div></div>`;
    document.body.innerHTML = `<div class="default-chat-screen" style="position:fixed;inset:0;overflow:auto;display:flex;flex-direction:column-reverse"><div style="height:90px">입력창</div><div class="flex-col-reverse" style="display:flex;flex-direction:column-reverse">${messages.map(row).reverse().join('')}</div></div>`;
    // Other chats, as a long-played character has them: every read of the character carries them all.
    const filler = '오래 이어진 다른 채팅의 한 줄. '.repeat(60), chats = [{ id: 'chat', message: messages }];
    for (let made = 0, c = 0; made < chatMb * 1024 * 1024; c++) { const list = []; for (let i = 0; i < 200 && made < chatMb * 1024 * 1024; i++) { list.push({ role: i % 2 ? 'char' : 'user', chatId: `c${c}m${i}`, data: filler }); made += filler.length * 2; } chats.push({ id: `other${c}`, message: list }); }
    const assets = speakers.flatMap(([name]) => faces.map(face => [`${name}_${face}`, `assets/${name}_${face}.png`, 'png']));
    const bot = { chaId: 'bot', name: 'Bot', additionalAssets: assets, emotionImages: [], chats, chatPage: 0 };
    // Opened where the reader left off: the first reply's top, so the taps go on through the rest.
    const saved = new Map([['omnisound.data', '{}'], ['omniviewer.marks', { 'bot|chat': { message: 'r0', hash: '-', at: 0, newest: `r${replies.length - 1}`, t: 1 } }]]), local = new Map();
    window.buttons = {};
    const api = (name, op) => (...args) => call(name, () => op(...args));
    window.risuai = { pluginStorage: { getItem: api('storageGet', async k => saved.get(k)), setItem: api('storageSet', async (k, v) => { saved.set(k, v); }) }, getLocalPluginStorage: async () => ({ getItem: api('localGet', async k => local.get(k)), setItem: api('localSet', async (k, v) => { local.set(k, v); }), removeItem: api('localRemove', async k => { local.delete(k); }) }),
      getDatabase: api('getDatabase', async () => ({ modules: [], enabledModules: [] })), setDatabase: api('setDatabase', async () => {}), requestPluginPermission: async () => true, unwarpSafeArray: async a => a,
      getCurrentCharacterIndex: api('getCurrentCharacterIndex', async () => 0), getCurrentChatIndex: api('getCurrentChatIndex', async () => 0), getCharacterFromIndex: api('getCharacterFromIndex', async () => structuredClone(bot)), getCharacter: api('getCharacter', async () => structuredClone(bot)),
      createMutationObserver: async fn => { const observer = new MutationObserver(rows => fn(rows.map(r => ({ getTarget: async () => new Safe(r.target) })))); return { observe: async (target, options) => observer.observe(target.node, options), disconnect: async () => observer.disconnect() }; },
      addRisuChatListener: async () => {}, removeRisuChatListener: async () => {}, onUnload: async () => {},
      // A voice comes back a quarter second after it is asked for.
      nativeFetch: async () => new Promise(resolve => setTimeout(() => resolve({ ok: true, arrayBuffer: async () => new Uint8Array(64).buffer }), 250)),
      readImage: api('readImage', async path => (path.includes('bg') ? background : sprite).slice()), getRootDocument: async () => new Safe(document), registerButton: async (a, fn) => { window.buttons[a.id] = fn; return { id: a.id }; } };
    window.Audio = class { src = ''; currentTime = 0; duration = 2; async play() {} pause() {} load() {} removeAttribute() { this.src = ''; } addEventListener() {} removeEventListener() {} };
    window.AudioContext = class { state = 'running'; destination = {}; async resume() {} createGain() { return { gain: { value: 1 }, connect() { return this; } }; } createMediaElementSource() { return { connect(node) { return node; } }; } };
  }, { replies: Array.from({ length: REPLIES }, (_, r) => reply(r)), speakers: SPEAKERS, faces: FACES, chatMb: CHAT_MB, blockedSource });
  await page.addScriptTag({ content: built.outputFiles[0].text });
  await page.evaluate(async ({ speakers, tts }) => {
    await window.loadTtsData(); const d = window.ttsData();
    d.settings.enabled = tts; d.settings.translation.provider = 'off'; d.settings.autoAssign = false; d.settings.fish.key = 'test-key'; d.settings.continuous = false;
    for (const [name, id] of speakers) d.characters.push({ id, scope: 'global', name, surname: '', givenName: name, surnameAliases: [], givenAliases: [], triggers: [name], tags: [], gender: 'female', voiceKey: d.voices[0].key, fishId: d.voices[0].fishId, fixed: false, gain: 0 });
    const e = await window.loadEmotionData(); e.settings.autoGenerate = false; e.settings.placeBackgrounds = true;
    e.made.push({ bot: 'bot', person: '__place__', face: 'cafe, indoors', name: 'omni_bg_cafe, indoors.webp', path: 'assets/bg.png', registered: true, at: 1 });
    if (tts) { await window.installTtsHost(); await window.omniTts.player.unlock(); }
    await window.installOmniViewer();
    // Press → the next line's text in the page → the frame after it.
    window.taps = []; window.longTasks = [];
    new PerformanceObserver(list => { for (const t of list.getEntries()) window.longTasks.push([t.startTime, t.duration]); }).observe({ type: 'longtask', buffered: false });
    const replyOf = text => Number(/R(\d+)/.exec(text)?.[1] ?? -1);
    document.addEventListener('pointerdown', () => { window.down = performance.now(); window.callsAtDown = window.callLog.length; window.textAtDown = document.querySelector('[x-omni-vn] [data-vn-text]')?.textContent || ''; }, true);
    new MutationObserver(() => {
      if (window.down === undefined) return;
      const now = document.querySelector('[x-omni-vn] [data-vn-text]')?.textContent || '';
      if (now === window.textAtDown) return;
      const down = window.down, at = performance.now(), calls = window.callLog.length - window.callsAtDown, crossed = replyOf(now) !== replyOf(window.textAtDown);
      window.down = undefined;
      requestAnimationFrame(() => requestAnimationFrame(() => window.taps.push({ down, text: at - down, frame: performance.now() - down, calls, crossed })));
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  }, { speakers: SPEAKERS, tts: TTS });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
  const opened = await page.evaluate(async () => { const t = performance.now(); window.buttons['omni-viewer-chat'](); while (!/R0/.test(document.querySelector('[x-omni-vn] [data-vn-text]')?.textContent || '')) await new Promise(r => setTimeout(r, 5)); return performance.now() - t; });
  await page.waitForTimeout(2500);
  const box = await page.locator('[x-omni-vn]').boundingBox();
  if (CSS) await page.evaluate(css => { const sheet = document.createElement('style'); sheet.textContent = css; document.head.append(sheet); }, CSS);
  if (TRACE) await browser.startTracing(page, { categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'blink', 'cc', 'v8.execute'] });
  const start = await page.evaluate(() => window.callLog.length), tapsFrom = await page.evaluate(() => performance.now());
  for (let i = 0; i < TAPS; i++) {
    await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.45);
    // Wait out the line's letters, so the next press goes on rather than completes it.
    await page.waitForTimeout(2000);
  }
  const trace = TRACE ? JSON.parse(String(await browser.stopTracing())) : null;
  const result = await page.evaluate(({ start, tapsFrom }) => {
    const log = window.callLog.slice(start), names = {};
    for (const [, name] of log) names[name] = (names[name] || 0) + 1;
    // What each tap set off: every call from its press to 1.5 s later.
    const after = window.taps.map(t => log.filter(([at]) => at >= t.down && at < t.down + 1500).length);
    // Long tasks while reading (the opening's own are its business).
    return { taps: window.taps, longTasks: window.longTasks.filter(([at]) => at >= tapsFrom).map(([, d]) => d), names, after, total: log.length };
  }, { start, tapsFrom });
  const pick = (list, key) => list.map(t => t[key]).sort((a, b) => a - b);
  const pct = (list, p) => list.length ? list[Math.min(list.length - 1, Math.floor(p * list.length))] : NaN;
  const fmt = n => Math.round(n);
  const summary = list => { const text = pick(list, 'text'), frame = pick(list, 'frame'), calls = pick(list, 'calls'); return { n: list.length, text: { p50: fmt(pct(text, .5)), p90: fmt(pct(text, .9)), max: fmt(text.at(-1)) }, frame: { p50: fmt(pct(frame, .5)), p90: fmt(pct(frame, .9)), max: fmt(frame.at(-1)) }, callsBeforeText: { p50: pct(calls, .5), max: calls.at(-1) } }; };
  const after = [...result.after].sort((a, b) => a - b);
  console.log(JSON.stringify({
    cpu: `${CPU}x`, tts: TTS, characterMb: CHAT_MB, open: fmt(opened),
    step: summary(result.taps.filter(t => !t.crossed)), crossing: summary(result.taps.filter(t => t.crossed)),
    callsSetOffPerTap: { p50: pct(after, .5), max: after.at(-1) }, callsOverAllTaps: result.total,
    byCall: Object.fromEntries(Object.entries(result.names).sort((a, b) => b[1] - a[1]).slice(0, 12)),
    longTasksWhileReading: { count: result.longTasks.length, totalMs: fmt(result.longTasks.reduce((a, b) => a + b, 0)), worst: fmt(Math.max(0, ...result.longTasks)) },
    errors,
  }));
  if (trace) {
    const events = trace.traceEvents ?? trace, main = new Set();
    for (const e of events) if (e.name === 'thread_name' && e.args?.name === 'CrRendererMain') main.add(`${e.pid}:${e.tid}`);
    const by = new Map(), styled = [];
    for (const e of events) {
      if (e.ph !== 'X' || !main.has(`${e.pid}:${e.tid}`) || !e.dur) continue;
      const row = by.get(e.name) ?? { ms: 0, n: 0 }; row.ms += e.dur / 1000; row.n++; by.set(e.name, row);
      if (e.name === 'UpdateLayoutTree') styled.push(e.args?.elementCount ?? e.args?.data?.elementCount ?? 0);
    }
    const top = [...by].sort((a, b) => b[1].ms - a[1].ms).slice(0, 26).map(([name, r]) => `${name.padEnd(34)} ${r.ms.toFixed(0).padStart(6)} ms  ×${r.n}`);
    console.log(['main thread over the taps (nested events count in their parents too):', ...top].join('\n'));
    if (styled.length) console.log(`style recalcs: ${styled.length}, elements per recalc p50 ${styled.sort((a, b) => a - b)[styled.length >> 1]}, max ${styled.at(-1)}`);
  }
} finally { await browser.close(); }
