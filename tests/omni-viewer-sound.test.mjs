import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

// 옴니 뷰어's sounds: 기록 lists the effects and pictures among the numbered lines, an effect's word shows over the box
// while it sounds, VOICE opens 소리 (each sound's switch and level, the settings' own), and 최신 is beside 메시지's foot.
const built = await build({ stdin: { contents: "import {installOmniViewer} from './src/viewer/omni-viewer';import {loadTtsData,ttsData,ttsVolumeOf} from './src/storage/tts-store';import {loadEmotionData,emotionData} from './src/storage/emotion-store';import {loadSoundData,soundData} from './src/storage/sound-store';import {omniSound} from './src/services/sound-runtime';import {viewerPrefs,saveViewerPrefs} from './src/storage/viewer-prefs';Object.assign(window,{installOmniViewer,loadTtsData,ttsData,ttsVolumeOf,loadEmotionData,emotionData,loadSoundData,soundData,omniSound,viewerPrefs,saveViewerPrefs});", resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife' });

// The newest reply: a line, a line with an effect word in it, a picture, a last line. One reply before it.
const reply = ['문이 열렸다.', '하린: "문을 닫았어 §쾅§ 이제 됐지?"', '[[@inray::card1::inxshot_abc]]', '하린: "어때?"'].join('\n');

async function viewerPage(browser, { width = 420, height = 860, mobile = false } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, ...(mobile ? { isMobile: true, hasTouch: true } : {}) });
  const page = await context.newPage(), errors = [];
  page.setDefaultTimeout(8000); page.on('pageerror', e => errors.push(e.message));
  await page.route('https://vn.test/', r => r.fulfill({ contentType: 'text/html', body: '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"></body></html>' })); await page.goto('https://vn.test/');
  await page.addScriptTag({ content: readFileSync('node_modules/dompurify/dist/purify.min.js', 'utf8') });
  await page.evaluate(({ reply }) => {
    const canvas = document.createElement('canvas'); canvas.width = 400; canvas.height = 600;
    const pen = canvas.getContext('2d'); pen.fillStyle = '#c9a46a'; pen.fillRect(0, 0, 400, 600);
    const drawn = canvas.toDataURL('image/png');
    window.buttons = {};
    const node = n => n === document ? document.documentElement : n;
    class Safe {
      constructor(n) { this.node = n; }
      release() {}
      async querySelector(s) { const n = this.node.querySelector(s); return n ? new Safe(n) : null; }
      async querySelectorAll(s) { return [...this.node.querySelectorAll(s)].map(n => new Safe(n)); }
      async setAttribute(k, v) { if (!k.startsWith('x-')) throw Error('Forbidden attribute write ' + k); this.node.setAttribute(k, v); }
      async getAttribute(k) { if (!k.startsWith('x-')) throw Error('Forbidden attribute read ' + k); return this.node.getAttribute(k); }
      async setTextContent(v) { this.node.textContent = v; }
      async getOuterHTML() { return this.node.outerHTML; }
      async innerText() { return this.node.innerText; }
      async scrollIntoView(o) { node(this.node).scrollIntoView(o); }
      async setInnerHTML(v) { this.node.innerHTML = DOMPurify.sanitize(v); }
      async setStyleAttribute(v) { this.node.style.cssText = v; }
      async appendChild(child) { this.node.append(child.node); }
      async remove() { this.node.remove(); }
      async cloneNode(deep) { return new Safe(this.node.cloneNode(deep)); }
      async getBoundingClientRect() { return node(this.node).getBoundingClientRect().toJSON(); }
      // Listeners are counted: a bar's drag listens to the moves only while it is held.
      async addEventListener(type, fn) { const cb = e => fn({ clientX: e.clientX, clientY: e.clientY, key: e.key, repeat: e.repeat }); const id = String(Math.random()); (window.listening ??= new Map()).set(id, [type, cb]); document.addEventListener(type, cb); return id; }
      async removeEventListener(type, id) { const x = window.listening?.get(id); if (x) { document.removeEventListener(x[0], x[1]); window.listening.delete(id); } }
      async createElement(tag) { return new Safe(document.createElement(tag)); }
    }
    const messages = [{ role: 'user', chatId: 'u0', data: '시작하자.' }, { role: 'char', chatId: 'r0', data: '하린: "옛 답장이야."' }, { role: 'user', chatId: 'u1', data: '보여 줘.' }, { role: 'char', chatId: 'r1', data: reply }];
    const bot = { chaId: 'bot', name: 'Bot', additionalAssets: [['하린_neutral', 'assets/h.png', 'png']], chats: [{ id: 'chat', message: messages }], chatPage: 0 };
    const line = l => /^\[\[@inray::/.test(l) ? `<div data-inray-asset="${/^\[\[@inray::[^:]+::([^:\]]+)/.exec(l)[1]}"><img src="${drawn}"></div>` : `<p>${l}</p>`;
    const row = (m, i) => `<div class="chat-message-container"><div class="risu-chat" data-chat-index="${i}"><div class="chattext">${m.data.split('\n').map(line).join('')}</div></div></div>`;
    document.body.innerHTML = `<div class="default-chat-screen" style="position:absolute;left:0;top:0;width:100%;height:100vh;overflow:auto;display:flex;flex-direction:column-reverse"><div style="height:90px;flex:none"><textarea id="risu-input"></textarea></div><div class="flex-col-reverse" style="display:flex;flex-direction:column-reverse;flex:none"></div></div>`;
    document.querySelector('.flex-col-reverse').innerHTML = messages.map(row).reverse().join('');
    const saved = new Map(), local = new Map();
    window.risuai = { pluginStorage: { getItem: async k => saved.get(k), setItem: async (k, v) => saved.set(k, v) }, getLocalPluginStorage: async () => ({ getItem: async k => local.get(k), setItem: async (k, v) => local.set(k, v), removeItem: async k => local.delete(k) }),
      getDatabase: async () => ({ characters: [structuredClone(bot)], modules: [], enabledModules: [] }), getCurrentCharacterIndex: async () => 0, getCurrentChatIndex: async () => 0,
      getCharacterFromIndex: async () => structuredClone(bot), getCharacter: async () => structuredClone(bot),
      getChatFromIndex: async () => structuredClone(bot.chats[0]), setChatToIndex: async () => {},
      readImage: async () => null, getRootDocument: async () => new Safe(document), registerButton: async (arg, fn) => { window.buttons[arg.id] = fn; return { id: arg.id }; },
      addRisuChatListener: async () => {} };
  }, { reply });
  await page.evaluate(() => { window.crypto.randomUUID = undefined; });
  await page.addScriptTag({ content: built.outputFiles[0].text });
  await page.evaluate(async () => {
    await window.loadTtsData(); const d = window.ttsData(); d.settings.enabled = false;
    d.characters.push({ id: 't-harin', scope: 'global', name: '하린', surname: '', givenName: '하린', surnameAliases: [], givenAliases: [], triggers: [], tags: [], gender: 'female', voiceKey: '', fishId: '', fixed: false, gain: 0 });
    await window.loadEmotionData(); window.emotionData().settings.autoGenerate = false;
    await window.loadSoundData(); window.soundData().settings.sfxEnabled = true;
    // An effect sounds until the test lets it end (as an <audio> would): the viewer is told when it starts, and when it stops.
    window.sfxPlayed = [];
    window.omniSound.playSfxWord = async (word, context, started) => {
      window.sfxPlayed.push(word);
      let end; const ended = new Promise(done => { end = done; });
      window.endSfx = end; started?.(ended);
      return true;
    };
    await window.installOmniViewer();
    await window.buttons['omni-viewer-chat']();
  });
  await page.waitForFunction(() => /문이 열렸다/.test(document.querySelector('[x-omni-vn] [data-vn-text]')?.textContent || ''));
  const box = selector => page.locator(`[x-omni-vn] ${selector}`).boundingBox();
  const tap = async selector => { const b = await box(selector); await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); };
  const style = (selector, prop, pseudo = null) => page.evaluate(([s, p, x]) => { const n = document.querySelector(`[x-omni-vn] ${s}`); return n ? getComputedStyle(n, x)[p] : ''; }, [selector, prop, pseudo]);
  const text = () => page.evaluate(() => document.querySelector('[x-omni-vn] [data-vn-text]')?.textContent || '');
  const count = () => page.evaluate(() => getComputedStyle(document.querySelector('[x-omni-vn] [data-vn-box]'), '::after').content);
  return { page, errors, box, tap, style, text, count, close: () => context.close() };
}
const launch = () => chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });

test('옴니 뷰어 · an effect\'s word rides over the box while it sounds — up as it starts, down as it stops; 기록 numbers each scene as the box counts it, lists 삽화 #1 and the effect in their places', async () => {
  const browser = await launch();
  try {
    const { page, errors, tap, style, count } = await viewerPage(browser);
    assert.equal(await style('[data-vn-sfx]', 'opacity'), '0', 'no effect yet: nothing over the box');
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => window.sfxPlayed.includes('쾅'));
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[x-omni-vn] [data-vn-sfx]')).opacity === '1');
    assert.equal(await style('[data-vn-sfx]', 'content', '::after'), '"🔊 쾅"');
    // Above the box's counter, at its right.
    const [note, boxRect] = await page.evaluate(() => ['[data-vn-sfx]', '[data-vn-box]'].map(s => document.querySelector(`[x-omni-vn] ${s}`).getBoundingClientRect().toJSON()));
    assert.ok(note.bottom <= boxRect.top - 8 && note.right <= boxRect.right && note.right >= boxRect.right - 30, `over the box's right corner: ${JSON.stringify(note)} / ${JSON.stringify(boxRect)}`);
    // It stops: the word slides down and away, still written while it goes.
    await page.evaluate(() => window.endSfx());
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[x-omni-vn] [data-vn-sfx]')).opacity === '0');
    assert.equal(await style('[data-vn-sfx]', 'content', '::after'), '"🔊 쾅"');

    // 기록: #n as the box counts (3 / 4 is #3), the picture as 삽화 #1, the effect before the line it sounds at.
    await page.waitForTimeout(300);
    await tap('[data-vn-act="log"]');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[x-omni-vn] [data-vn-log]')).display === 'block');
    const rows = await page.evaluate(() => [...document.querySelectorAll('[x-omni-vn] [data-vn-log] p')].map(p => p.textContent));
    assert.equal(rows.length, 5, JSON.stringify(rows));
    assert.match(rows[0], /^#1문이 열렸다/);
    assert.equal(rows[1], '🔊 쾅');
    assert.match(rows[2], /^#2하린문을 닫았어/);
    assert.equal(rows[3], '#3🖼 삽화 #1');
    assert.match(rows[4], /^#4하린어때/);
    assert.equal(await page.evaluate(() => document.querySelector('[x-omni-vn] [data-vn-log] [data-now]')?.textContent.slice(0, 2)), '#2', 'the line on screen is lit');
    // The effect's row plays it again; 기록 stays.
    const effect = await page.locator('[x-omni-vn] [data-vn-log] [data-sfx]').boundingBox();
    await page.mouse.click(effect.x + effect.width / 2, effect.y + effect.height / 2);
    await page.waitForFunction(() => window.sfxPlayed.length === 2);
    await page.waitForTimeout(200);
    assert.equal(await style('[data-vn-log]', 'display'), 'block', '기록 stays open');
    // 효과음 off: the row says so, and plays nothing.
    await page.evaluate(() => window.saveViewerPrefs({ sfx: false }));
    await page.mouse.click(effect.x + effect.width / 2, effect.y + effect.height / 2);
    await page.waitForFunction(() => /효과음이 꺼져 있어요/.test(getComputedStyle(document.querySelector('[x-omni-vn] [data-vn-note]'), '::after').content));
    assert.equal(await page.evaluate(() => window.sfxPlayed.length), 2);
    await page.evaluate(() => window.saveViewerPrefs({ sfx: true }));
    // 글자 표시 off: the effect sounds, no word comes up.
    await page.evaluate(() => window.saveViewerPrefs({ sfxText: false }));
    await page.mouse.click(effect.x + effect.width / 2, effect.y + effect.height / 2);
    await page.waitForFunction(() => window.sfxPlayed.length === 3);
    await page.waitForTimeout(450);
    assert.equal(await style('[data-vn-sfx]', 'opacity'), '0', 'no word while it sounds');
    await page.evaluate(() => { window.endSfx(); return window.saveViewerPrefs({ sfxText: true }); });
    // The picture's row goes to it, and 기록 closes.
    const picture = await page.locator('[x-omni-vn] [data-vn-log] [data-cg]').boundingBox();
    await page.mouse.click(picture.x + picture.width / 2, picture.y + picture.height / 2);
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[x-omni-vn] [data-vn-log]')).display === 'none');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[x-omni-vn] [data-vn-box]'), '::after').content === '"3 / 4"');
    assert.match(await count(), /^"3 \/ 4"$/);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('옴니 뷰어 · VOICE opens 소리: each sound\'s switch, and its level set where a bar is pressed and where the finger lets go — the settings\' own values', async () => {
  const browser = await launch();
  try {
    const { page, errors, box, tap, style, count } = await viewerPage(browser);
    const frame = await box('');
    await tap('[data-vn-act="voice"]');
    await page.waitForFunction(() => { const r = document.querySelector('[x-omni-vn] [data-vn-sound]').getBoundingClientRect(), f = document.querySelector('[x-omni-vn]').getBoundingClientRect(); return r.right <= f.right + 1 && r.left > f.left; });
    await page.waitForTimeout(450);
    const panel = await box('[data-vn-sound]');
    assert.ok(panel.x >= frame.x && panel.x + panel.width <= frame.x + frame.width + 1, `inside the frame: ${JSON.stringify(panel)}`);
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('[x-omni-vn] [data-vn-srow] b')].map(b => b.textContent)), ['Voice', '나레이션', 'BGM', 'TTS 중', '효과음', '글자 표시']);
    assert.equal(await page.evaluate(() => window.viewerPrefs().voice), true, 'VOICE itself switches nothing now');
    const at = async (key, share) => { const b = await box(`[data-vn-snd="${key}"]`); return { x: b.x + b.width * share, y: b.y + b.height / 2 }; };
    const press = async (key, share) => { const p = await at(key, share); await page.mouse.click(p.x, p.y); };
    // Voice's switch: the viewer's own (VOICE's before); the panel stays, drawn as it now stands.
    await press('voice-mute', .5);
    await page.waitForFunction(() => window.viewerPrefs().voice === false);
    await page.waitForFunction(() => document.querySelector('[x-omni-vn] [data-vn-snd="voice-mute"]')?.textContent === '🔇');
    assert.equal(await style('[data-vn-sound]', 'translate'), '0px');
    // A level where it is pressed: TTS 재생 볼륨.
    await press('voice-bar', .25);
    await page.waitForFunction(() => Math.abs(window.ttsData().settings.volume - .25) < .02);
    // Dragged: the fill follows the finger, and the level is where it lets go. Narration's own, the voice's untouched.
    assert.equal(await page.evaluate(() => window.ttsData().settings.narrationVolume), null, 'until moved, narration is as loud as the voice');
    const from = await at('narr-bar', .2), mid = await at('narr-bar', .5), to = await at('narr-bar', .8);
    await page.mouse.move(from.x, from.y); await page.mouse.down();
    await page.mouse.move(mid.x, mid.y, { steps: 4 });
    await page.waitForFunction(() => { const bar = document.querySelector('[x-omni-vn] [data-vn-snd="narr-bar"]'), fill = bar.querySelector('span'); return Math.abs(fill.getBoundingClientRect().width / bar.getBoundingClientRect().width - .5) < .05; });
    assert.match(await page.evaluate(() => document.querySelector('[x-omni-vn] [data-vn-srow="narr"] em').textContent), /^(49|50|51)%$/);
    await page.mouse.move(to.x, to.y, { steps: 4 }); await page.mouse.up();
    await page.waitForFunction(() => Math.abs((window.ttsData().settings.narrationVolume ?? 0) - .8) < .02);
    assert.ok(Math.abs(await page.evaluate(() => window.ttsData().settings.volume) - .25) < .02, 'the voice keeps its own');
    assert.ok(Math.abs(await page.evaluate(() => window.ttsVolumeOf(window.ttsData().settings, 'narration')) - .8) < .02, 'a narration line plays at narration\'s');
    assert.ok(Math.abs(await page.evaluate(() => window.ttsVolumeOf(window.ttsData().settings, 'dialogue')) - .25) < .02, 'a line of dialogue at the voice\'s');
    assert.equal(await page.evaluate(() => [...(window.listening?.values() ?? [])].filter(([type]) => type === 'pointermove').length), 0, 'the moves are listened to only while a bar is held');
    // BGM, its level while TTS speaks, and 효과음: the sound settings' own.
    await press('bgm-bar', .6);
    await page.waitForFunction(() => Math.abs(window.soundData().settings.bgmVolume - .6) < .02);
    await press('duck-bar', .1);
    await page.waitForFunction(() => Math.abs(window.soundData().settings.duck - .1) < .02);
    await press('sfx-bar', .4);
    await page.waitForFunction(() => Math.abs(window.soundData().settings.sfxVolume - .4) < .02);
    // 효과음's switch is the bottom row's: the two show the same.
    await press('sfx-mute', .5);
    await page.waitForFunction(() => window.viewerPrefs().sfx === false);
    await page.waitForFunction(() => document.querySelector('[x-omni-vn] [data-vn-srow="sfx"]').hasAttribute('data-off'));
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[x-omni-vn] [data-vn-menu] [data-vn-act="sfx"]')).opacity === '0.4');
    await press('sfxtext-mute', .5);
    await page.waitForFunction(() => window.viewerPrefs().sfxText === false && document.querySelector('[x-omni-vn] [data-vn-snd="sfxtext-mute"]').textContent === '꺼짐');
    // A drag that ends off the panel: clamped at the end, and its click puts nothing away.
    const start = await at('bgm-bar', .5);
    await page.mouse.move(start.x, start.y); await page.mouse.down();
    await page.mouse.move(frame.x + 4, start.y, { steps: 5 }); await page.mouse.up();
    await page.waitForFunction(() => window.soundData().settings.bgmVolume === 0);
    await page.waitForTimeout(300);
    assert.equal(await style('[data-vn-sound]', 'translate'), '0px', 'still open');
    // A tap off it puts it away, and is only that: the line stays.
    const before = await count();
    await page.mouse.click(frame.x + 60, frame.y + frame.height * .5);
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[x-omni-vn] [data-vn-sound]')).translate !== '0px');
    await page.waitForTimeout(300);
    assert.equal(await count(), before);
    // Esc puts it away too; the bottom row's buttons do, and do their own.
    await tap('[data-vn-act="voice"]');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[x-omni-vn] [data-vn-sound]')).translate === '0px');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[x-omni-vn] [data-vn-sound]')).translate !== '0px');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('옴니 뷰어 · 소리 on a 360 px phone: inside the frame, every bar wide enough for a finger', async () => {
  const browser = await launch();
  try {
    const { page, errors, box, tap } = await viewerPage(browser, { width: 360, height: 740, mobile: true });
    const frame = await box('');
    await tap('[data-vn-act="voice"]');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[x-omni-vn] [data-vn-sound]')).translate === '0px');
    await page.waitForTimeout(450);
    const panel = await box('[data-vn-sound]');
    assert.ok(panel.x >= frame.x && panel.x + panel.width <= frame.x + frame.width + 1, JSON.stringify(panel));
    const bars = await page.evaluate(() => [...document.querySelectorAll('[x-omni-vn] [data-vn-snd$="-bar"]')].map(b => b.getBoundingClientRect().toJSON()));
    assert.equal(bars.length, 5);
    for (const b of bars) assert.ok(b.width >= 120 && b.height >= 30, JSON.stringify(b));
    // Nothing in it lies past its right edge (a row too wide for it).
    assert.ok(await page.evaluate(() => { const p = document.querySelector('[x-omni-vn] [data-vn-sound]'); return p.scrollWidth <= p.clientWidth + 1; }));
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('옴니 뷰어 · 최신 is beside 메시지\'s foot, not in the bottom row: it goes to the newest reply, and the list goes with it', async () => {
  const browser = await launch();
  try {
    const { page, errors, box, tap, text } = await viewerPage(browser);
    assert.equal(await page.locator('[x-omni-vn] [data-vn-menu] [data-vn-act="newest"]').count(), 0, 'not beside 기록');
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('[x-omni-vn] [data-vn-act="newest"]')).display), 'none', 'away while 메시지 is');
    // To the reply before, through the list.
    await tap('[data-vn-act="msgs"]');
    await page.waitForFunction(() => document.querySelectorAll('[x-omni-vn] [data-vn-msgs] [data-vn-msg]').length === 2);
    await page.waitForTimeout(450);
    const oldest = await page.locator('[x-omni-vn] [data-vn-msg]').first().boundingBox();
    await page.mouse.click(oldest.x + oldest.width / 2, oldest.y + oldest.height / 2);
    await page.waitForFunction(() => /옛 답장이야/.test(document.querySelector('[x-omni-vn] [data-vn-text]')?.textContent || ''));
    // Open again: 최신 stands just right of the list, by its last tile (the newest reply listed).
    await tap('[data-vn-act="msgs"]');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[x-omni-vn] [data-vn-act="newest"]')).display !== 'none');
    await page.waitForTimeout(450);
    const [list, newest, last] = await Promise.all([box('[data-vn-msgs]'), box('[data-vn-act="newest"]'), page.locator('[x-omni-vn] [data-vn-msg]').last().boundingBox()]);
    assert.ok(newest.x >= list.x + list.width && newest.x <= list.x + list.width + 16, `right of the list: ${JSON.stringify(newest)} / ${JSON.stringify(list)}`);
    assert.ok(newest.y + newest.height / 2 >= last.y && newest.y + newest.height / 2 <= last.y + last.height + 8, `by the last tile: ${JSON.stringify(newest)} / ${JSON.stringify(last)}`);
    await tap('[data-vn-act="newest"]');
    await page.waitForFunction(() => /문이 열렸다/.test(document.querySelector('[x-omni-vn] [data-vn-text]')?.textContent || ''));
    await page.waitForFunction(() => !(document.querySelector('[x-omni-vn-style="scene"]')?.textContent || '').includes('[data-vn-msgwrap]{translate:0 0}'));
    assert.match(await text(), /문이 열렸다/);
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('[x-omni-vn] [data-vn-act="newest"]')).display), 'none');
    // Where it stood, with the list away, a tap is the stage's own (no 최신 left behind there).
    await page.waitForTimeout(450);
    await page.mouse.click(newest.x + newest.width / 2, newest.y + newest.height / 2);
    await page.waitForFunction(() => /문을 닫았어/.test(document.querySelector('[x-omni-vn] [data-vn-text]')?.textContent || ''));
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
