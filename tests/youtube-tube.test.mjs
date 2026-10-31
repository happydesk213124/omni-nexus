import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';

// A stand-in for YouTube's embed: the same postMessage protocol (listening, infoDelivery,
// commands). A video named "blocked…" never starts, as when the browser holds it for a tap.
const FAKE_EMBED = `<!doctype html><body style="margin:0;background:#111"><script>
let to = null, state = -1, video = '', time = 0, volume = 100;
const tell = o => to && to.postMessage(JSON.stringify(o), '*');
const info = () => tell({ event: 'infoDelivery', info: { playerState: state, currentTime: time, duration: 180, volume } });
addEventListener('message', e => {
  let m; try { m = JSON.parse(e.data); } catch { return; }
  if (m.event === 'listening') { to = e.source; tell({ event: 'onReady' }); info(); return; }
  if (m.event !== 'command') return;
  parent.postMessage(JSON.stringify({ fakeLog: [m.func, m.args, location.pathname] }), '*');
  if (m.func === 'loadVideoById') { video = m.args[0].videoId; state = video.startsWith('blocked') ? 5 : 1; if (video === 'gone0000000') tell({ event: 'onError', info: 100 }); }
  if (m.func === 'playVideo') state = 1;
  if (m.func === 'pauseVideo') state = 2;
  if (m.func === 'setVolume') volume = m.args[0];
  info();
});
addEventListener('click', () => { if (video) { state = 1; info(); } });
setInterval(() => { if (state === 1) time += .2; info(); }, 200);
</script></body>`;

test('YouTube BGM: the seed is cloned into the player, its window found among others, and driven by postMessage', async () => {
  const built = await build({ stdin: { contents: "import {YoutubeTube,YOUTUBE_SEED_HTML} from './src/providers/sound/youtube';window.YoutubeTube=YoutubeTube;window.SEED=YOUTUBE_SEED_HTML;", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'iife' });
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 400, height: 800 } }), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('https://vn.test/', r => r.fulfill({ contentType: 'text/html', body: '<html><head></head><body style="margin:0"></body></html>' }));
    await page.route('https://www.youtube.com/embed/**', r => r.fulfill({ contentType: 'text/html', body: FAKE_EMBED }));
    await page.goto('https://vn.test/');
    await page.addScriptTag({ content: built.outputFiles[0].text });
    await page.evaluate(() => {
      window.log = [];
      addEventListener('message', e => { try { const m = JSON.parse(e.data); if (m.fakeLog) window.log.push(m.fakeLog); } catch { /* not ours */ } });
      class Safe {
        constructor(node) { this.node = node; }
        release() {}
        async querySelector(s) { const n = this.node.querySelector(s); return n ? new Safe(n) : null; }
        async querySelectorAll(s) { return [...this.node.querySelectorAll(s)].map(n => new Safe(n)); }
        async setAttribute(k, v) { if (!k.startsWith('x-')) throw Error('Forbidden attribute write ' + k); this.node.setAttribute(k, v); }
        async setStyleAttribute(v) { this.node.style.cssText = v; }
        async appendChild(child) { this.node.append(child.node); }
        async remove() { this.node.remove(); }
        async cloneNode(deep) { return new Safe(this.node.cloneNode(deep)); }
        // Document-wide listeners, as Risu's SafeDocument: an id back, pointer coordinates in.
        async addEventListener(type, fn) { const id = String(Math.random()), cb = e => fn({ clientX: e.clientX, clientY: e.clientY }); (this.listeners ||= new Map()).set(id, [type, cb]); this.node.addEventListener(type, cb); window.liveListeners = (window.liveListeners || 0) + 1; return id; }
        async removeEventListener(type, id) { const row = this.listeners?.get(id); if (row) { this.node.removeEventListener(row[0], row[1]); this.listeners.delete(id); window.liveListeners--; } }
      }
      // The chat as Risu drew it: someone else's YouTube embed, and our planted seed.
      document.body.innerHTML = `<div class="chat"><iframe src="https://www.youtube.com/embed/OTHERVIDEO1?enablejsapi=1" width="320" height="180"></iframe><p>본문</p>${window.SEED}</div>`;
      window.risuai = { getRootDocument: async () => new Safe(document) };
      window.tube = new window.YoutubeTube();
    });
    // Someone else's player has loaded before ours exists.
    await page.waitForTimeout(800);
    // Made ahead with nothing to play: never seen (it would show YouTube's sample video), hidden or not.
    await page.evaluate(() => window.tube.ensure());
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('[x-omni-yt-tv]')).opacity), '0', 'made ahead, nothing on: out of sight');
    await page.evaluate(() => window.tube.play('bgm1', 'sMcWOaJFuw0', { level: 0.5, fadeMs: 0, hidden: false }));
    assert.equal(await page.locator('[data-omni-yt-seed] iframe').count(), 1, 'the seed stays where it was planted');
    assert.equal(await page.evaluate(() => document.querySelectorAll('body > iframe[x-omni-yt-tv]').length), 1, 'one player, cloned under <body>');
    const loads = await page.evaluate(() => window.log.filter(l => l[0] === 'loadVideoById'));
    assert.deepEqual(loads.map(l => [l[1][0].videoId, l[2]]), [['sMcWOaJFuw0', '/embed/M7lc1UVf-VE']], 'the track went to our clone, not to the other player');
    await page.waitForFunction(() => window.tube.playing);
    assert.equal(await page.evaluate(() => window.log.filter(l => l[0] === 'setVolume').at(-1)[1][0]), 50, 'at the BGM level');
    // Pause and play on; a track that ends starts again.
    await page.evaluate(() => window.tube.pause());
    await page.waitForFunction(() => window.tube.paused);
    assert.equal(await page.evaluate(() => window.tube.resume()), true);
    // A video YouTube does not have: rejected with the reason, the music stays as it was.
    await assert.rejects(page.evaluate(() => window.tube.play('bgm2', 'gone0000000', { level: 0.5, fadeMs: 0, hidden: false })), /찾을 수 없습니다/);
    assert.equal(await page.evaluate(() => window.tube.key), '');
    // Held back for a tap, kept hidden: it stays out of sight and keeps the track; the next press anywhere brings it in.
    await assert.rejects(page.evaluate(() => window.tube.play('bgm3', 'blocked0000', { level: 0.4, fadeMs: 0, hidden: true })), /누르면 재생/);
    assert.equal(await page.evaluate(() => window.tube.waiting), true);
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('[x-omni-yt-tv]')).opacity), '0', 'kept hidden, even for the tap it needs');
    await page.waitForFunction(() => window.liveListeners === 1);
    await page.mouse.click(300, 300);
    await page.waitForFunction(() => window.tube.playing && !window.tube.waiting);
    await page.waitForFunction(() => window.log.filter(l => l[0] === 'setVolume').at(-1)[1][0] === 40, null, { timeout: 3000 });
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('[x-omni-yt-tv]')).opacity), '0', 'played, still out of sight');
    await page.waitForFunction(() => window.liveListeners === 0);
    // Shown (not hidden): held back, it shows itself, outlined, for the tap on it.
    await page.evaluate(() => window.tube.stop(0));
    await assert.rejects(page.evaluate(() => window.tube.play('bgm4', 'blocked1111', { level: 0.4, fadeMs: 0, hidden: false })), /한 번 눌러/);
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('[x-omni-yt-tv]')).opacity), '1', 'shown for the tap it needs');
    assert.equal(await page.evaluate(() => window.liveListeners), 0, 'shown, it waits for its own tap: nothing listens elsewhere');
    await page.locator('[x-omni-yt-tv]').click();
    await page.waitForFunction(() => window.tube.playing && !window.tube.waiting);
    await page.evaluate(() => window.tube.stop(0));
    assert.equal(await page.evaluate(() => window.tube.key), '');
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('[x-omni-yt-tv]')).opacity), '0', 'stopped, nothing on: out of sight');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('YouTube BGM: with no seed in the chat, the display handler is there only until a draw has planted one', async () => {
  const built = await build({ stdin: { contents: "import {YoutubeTube} from './src/providers/sound/youtube';window.YoutubeTube=YoutubeTube;", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'iife' });
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 400, height: 800 } }), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('https://vn.test/', r => r.fulfill({ contentType: 'text/html', body: '<html><head></head><body style="margin:0"></body></html>' }));
    await page.route('https://www.youtube.com/embed/**', r => r.fulfill({ contentType: 'text/html', body: FAKE_EMBED }));
    await page.goto('https://vn.test/');
    await page.addScriptTag({ content: built.outputFiles[0].text });
    await page.evaluate(() => {
      class Safe {
        constructor(node) { this.node = node; }
        release() {}
        async querySelector(s) { const n = this.node.querySelector(s); return n ? new Safe(n) : null; }
        async querySelectorAll(s) { return [...this.node.querySelectorAll(s)].map(n => new Safe(n)); }
        async setAttribute(k, v) { if (!k.startsWith('x-')) throw Error('Forbidden attribute write ' + k); this.node.setAttribute(k, v); }
        async setStyleAttribute(v) { this.node.style.cssText = v; }
        async appendChild(child) { this.node.append(child.node); }
        async remove() { this.node.remove(); }
        async cloneNode(deep) { return new Safe(this.node.cloneNode(deep)); }
      }
      document.body.innerHTML = '<div class="chat"><p>본문</p></div>';
      // Risu calls every display handler on every draw, each a call across to the plugin.
      window.handlers = new Set(); window.added = 0;
      window.risuai = {
        getRootDocument: async () => new Safe(document),
        addRisuScriptHandler: async (mode, fn) => { if (mode === 'display') { window.handlers.add(fn); window.added++; } },
        removeRisuScriptHandler: async (mode, fn) => { if (mode === 'display') window.handlers.delete(fn); },
      };
      window.draw = async text => { let out = text; for (const fn of window.handlers) out = (await fn(out)) ?? out; const node = document.createElement('div'); node.innerHTML = out; document.querySelector('.chat').append(node); };
      window.tube = new window.YoutubeTube();
    });
    assert.equal(await page.evaluate(() => window.handlers.size), 0, 'no player wanted yet: Risu has no handler of ours to call');
    const playing = page.evaluate(() => window.tube.play('bgm1', 'sMcWOaJFuw0', { level: 0.5, fadeMs: 0, hidden: true }));
    await page.waitForFunction(() => window.handlers.size === 1);
    await page.evaluate(() => window.draw('새 메시지'));
    await playing;
    assert.equal(await page.evaluate(() => document.querySelectorAll('body > iframe[x-omni-yt-tv]').length), 1, 'the planted seed became the player');
    assert.equal(await page.evaluate(() => window.handlers.size), 0, 'and the handler is gone again');
    assert.equal(await page.evaluate(() => window.added), 1);
    await page.evaluate(() => window.draw('또 다른 메시지'));
    assert.equal(await page.locator('[data-omni-yt-seed]').count(), 1, 'later draws pass as they are');
    await page.evaluate(() => window.tube.stop(0));
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
