import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const built = await build({ stdin: { contents: "import {installOmniViewer,viewerOpen} from './src/viewer/omni-viewer';import {loadTtsData,ttsData} from './src/storage/tts-store';import {loadEmotionData,emotionData} from './src/storage/emotion-store';import {saveViewerPrefs} from './src/storage/viewer-prefs';import {idbPut} from './src/storage/stores';import {takeSoundFocus} from './src/sound-ui/page';Object.assign(window,{installOmniViewer,viewerOpen,loadTtsData,ttsData,loadEmotionData,emotionData,saveViewerPrefs,idbPut,takeSoundFocus});", resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife' });

/**
 * The viewer open on a chat of two replies, the newest one `lines` (a picture among them as
 * `[[@inray::card9::inxshot_pic::832::1216]]`, the chat showing it at portrait size). `files`: cards whose
 * picture only their file holds (card id → asset path), as an older reply's that the chat does not draw.
 * `older`: the reply before it.
 */
async function viewerOn(browser, lines, files = {}, older = '하린: "어제는 비가 왔지."') {
  const page = await browser.newPage({ viewport: { width: 400, height: 900 } }), errors = [];
  page.setDefaultTimeout(8000); page.on('pageerror', e => errors.push(e.message));
  await page.route('https://vn.test/', r => r.fulfill({ contentType: 'text/html', body: '<html><head></head><body style="margin:0"></body></html>' })); await page.goto('https://vn.test/');
  await page.addScriptTag({ content: readFileSync('node_modules/dompurify/dist/purify.min.js', 'utf8') });
  await page.evaluate(({ lines, files, older }) => {
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
    const newest = lines.join('\n');
    const drawn = lines.map(line => /^\[\[@inray::/.test(line) ? `<div data-inray-asset="inxshot_pic"><img src="${picture}"></div>` : `<p>${line}</p>`).join('');
    document.body.innerHTML = `<div class="default-chat-screen" style="position:fixed;inset:0;display:flex;flex-direction:column-reverse"><div style="height:90px">입력창</div><div class="flex-col-reverse">`
      + `<div class="chat-message-container"><div class="risu-chat" data-chat-index="2"><div class="chattext">${drawn}</div></div></div>`
      + `<div class="chat-message-container"><div class="risu-chat" data-chat-index="1"><div class="chattext">응</div></div></div>`
      + `<div class="chat-message-container"><div class="risu-chat" data-chat-index="0"><div class="chattext"><p>${older}</p></div></div></div></div></div>`;
    const bot = { chaId: 'bot', name: 'Bot', additionalAssets: [], chats: [{ id: 'chat', message: [{ role: 'char', chatId: 'm0', data: older }, { role: 'user', chatId: 'u0', data: '응' }, { role: 'char', chatId: 'm1', data: newest }] }], chatPage: 0 };
    const saved = new Map(), local = new Map(); window.buttons = {}; window.cardFiles = files;
    window.risuai = { pluginStorage: { getItem: async k => saved.get(k), setItem: async (k, v) => saved.set(k, v) }, getLocalPluginStorage: async () => ({ getItem: async k => local.get(k), setItem: async (k, v) => local.set(k, v), removeItem: async k => local.delete(k) }),
      getDatabase: async () => ({ modules: [], enabledModules: [] }), getCurrentCharacterIndex: async () => 0, getCharacterFromIndex: async () => structuredClone(bot), getCharacter: async () => structuredClone(bot),
      readImage: async path => Object.values(files).includes(path) ? Uint8Array.from(atob(picture.split(',')[1]), c => c.charCodeAt(0)) : null, getRootDocument: async () => new Safe(document), registerButton: async (arg, fn) => { window.buttons[arg.id] = fn; return { id: arg.id }; } };
  }, { lines, files, older });
  await page.evaluate(() => { window.crypto.randomUUID = undefined; });
  await page.addScriptTag({ content: built.outputFiles[0].text });
  await page.evaluate(async () => {
    for (const [id, path] of Object.entries(window.cardFiles || {})) await window.idbPut('images', { id, location: { asset_path: path } });
    await window.loadTtsData(); const d = window.ttsData(); d.settings.enabled = false;
    for (const [id, name] of [['t-harin', '하린'], ['t-misun', '오미선']]) d.characters.push({ id, scope: 'global', name, surname: '', givenName: name, surnameAliases: [], givenAliases: [], triggers: [], tags: [], gender: 'female', voiceKey: '', fishId: '', fixed: false, gain: 0 });
    await window.loadEmotionData(); window.emotionData().settings.enabled = false;
    await window.installOmniViewer();
    window.buttons['omni-viewer-chat']();
  });
  const text = () => page.evaluate(() => document.querySelector('[x-omni-vn] [data-vn-text]')?.textContent || '');
  const shows = re => page.waitForFunction(source => new RegExp(source).test(document.querySelector('[x-omni-vn] [data-vn-text]')?.textContent || ''), re.source);
  /** The picture as it shows: big (open or shown again), folded, or none. */
  const picture = () => page.evaluate(() => { const img = document.querySelector('[x-omni-vn] img[x-vn-cg]'); if (!img || getComputedStyle(img).display === 'none') return 'none'; return img.getBoundingClientRect().height > 200 ? 'big' : 'folded'; });
  const pictureIs = state => page.waitForFunction(state => { const img = document.querySelector('[x-omni-vn] img[x-vn-cg]'); const now = !img || getComputedStyle(img).display === 'none' ? 'none' : img.getBoundingClientRect().height > 200 ? 'big' : 'folded'; return now === state; }, state);
  const rect = selector => page.locator(selector).boundingBox();
  const press = async act => { const b = await rect(`[x-omni-vn] [data-vn-act="${act}"]`); await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); };
  const lineBox = () => page.evaluate(() => getComputedStyle(document.querySelector('[x-omni-vn] [data-vn-box]')).opacity);
  await page.waitForFunction(() => (document.querySelector('[x-omni-vn] [data-vn-text]')?.textContent || '').length > 2);
  const frame = await rect('[x-omni-vn]');
  /** Taps on (towards the top of the stage: never the folded picture) until `done`. */
  const tapUntil = async done => { for (let i = 0; i < 8 && !await done(); i++) { await page.waitForTimeout(650); await page.mouse.click(frame.x + frame.width / 2, frame.y + frame.height * 0.3); } };
  /**
   * What is drawn on top at the middle of the picture: 'picture', or the name of the person over it. The stage's
   * layers take no pointer, so for the look they are made to.
   */
  const onTopOfPicture = () => page.evaluate(() => {
    const probe = document.createElement('style');
    probe.textContent = '[x-omni-vn] :is([data-vn-cast],[data-vn-cg]),[x-omni-vn] :is([data-vn-cast],[data-vn-cg]) *{pointer-events:auto!important}';
    document.head.append(probe);
    try {
      const r = document.querySelector('[x-omni-vn] img[x-vn-cg]').getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return hit?.closest('[x-vn-cg]') ? 'picture' : hit?.closest('[x-vn-p]')?.querySelector('b')?.textContent || hit?.tagName || '';
    } finally { probe.remove(); }
  });
  return { page, errors, text, shows, picture, pictureIs, rect, press, lineBox, frame, tapUntil, onTopOfPicture };
}

test('옴니 뷰어 over a restricted SafeDOM: a reply that ends on its picture can still be left — the picture folds on a tap, ◀ and a swipe go back, ✕ closes', async () => {
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  try {
    const v = await viewerOn(browser, ['하린: "이거 봐, 오늘 찍었어."', '오미선: "와, 예쁘다."', '[[@inray::card9::inxshot_pic::832::1216]]']);
    await v.shows(/이거 봐/);
    const toPicture = async () => { await v.tapUntil(async () => await v.picture() === 'big'); await v.pictureIs('big'); await v.page.waitForTimeout(600); };
    await toPicture();
    assert.equal(await v.page.locator('[x-omni-vn] [data-vn-end]').count(), 1, 'the end of the story so far: its cue under the picture');
    // The two who spoke stand dimmed behind it: the picture is drawn over them (a person once stood over it).
    assert.equal(await v.page.locator('[x-omni-vn] [x-vn-p]').evaluateAll(n => n.filter(p => getComputedStyle(p).display !== 'none').length), 2);
    assert.equal(await v.onTopOfPicture(), 'picture');
    // A tap on the picture that ends the story so far folds it (there is no next scene to go on to).
    await v.page.mouse.click(v.frame.x + v.frame.width / 2, v.frame.y + v.frame.height * 0.4);
    await v.pictureIs('folded');
    // Folded, its thumb at the top is over the people too (a head stood over it).
    await v.page.waitForTimeout(400);
    assert.equal(await v.onTopOfPicture(), 'picture', 'the folded thumb over the people');
    // ◀ goes back to the line before it.
    await v.page.waitForTimeout(400);
    await v.press('prev');
    await v.shows(/와, 예쁘다/);
    // On to the picture again (it opens big as the reply ends on it): a swipe down goes back, also one that starts
    // low, over the box a picture hides (a drag there selects only a shown line).
    await toPicture();
    const box = await v.rect('[x-omni-vn] [data-vn-box]');
    const x = box.x + box.width / 2, from = box.y + 14;
    await v.page.mouse.move(x, from); await v.page.mouse.down();
    await v.page.mouse.move(x, from + 60, { steps: 4 }); await v.page.mouse.move(x, from + 110, { steps: 4 }); await v.page.mouse.up();
    await v.shows(/와, 예쁘다|이거 봐/);
    // And ✕ closes, from the picture too.
    await toPicture();
    await v.press('close');
    await v.page.waitForFunction(() => !window.viewerOpen());
    assert.equal(await v.page.locator('[x-omni-vn]').count(), 0);
    assert.deepEqual(v.errors, []);
  } finally { await browser.close(); }
});

test('옴니 뷰어 over a restricted SafeDOM: from any picture ◀ and ← go back — a picture shown big folds away with the step, and the full-screen sheet once shown takes no tap meant for ◀', async () => {
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  try {
    const v = await viewerOn(browser, ['하린: "첫 줄이야."', '[[@inray::card9::inxshot_pic::832::1216]]', '오미선: "그림 다음 줄."', '하린: "마지막 줄."']);
    await v.shows(/첫 줄/);
    // Past the picture to the last line: it waits folded at the top.
    await v.tapUntil(async () => /마지막 줄/.test(await v.text()));
    await v.pictureIs('folded');
    // Shown big again from its thumb, then ◀: the line before, with the picture folded away (not still over it).
    const thumb = async () => { await v.page.waitForTimeout(600); const r = await v.rect('[x-omni-vn] img[x-vn-cg]'); await v.page.mouse.click(r.x + r.width / 2, r.y + r.height / 2); await v.pictureIs('big'); await v.page.waitForTimeout(400); };
    await thumb();
    await v.press('prev');
    await v.shows(/그림 다음 줄/);
    await v.pictureIs('folded');
    // The line is in sight (the box fades back in).
    await v.page.waitForFunction(() => getComputedStyle(document.querySelector('[x-omni-vn] [data-vn-box]')).opacity === '1');
    // Shown big again, then ←: back too (it once only folded the picture), here onto the picture's own scene.
    await thumb();
    await v.page.keyboard.press('ArrowLeft');
    await v.page.waitForFunction(() => /^"2 \//.test(getComputedStyle(document.querySelector('[x-omni-vn] [data-vn-box]'), '::after').content));
    await v.pictureIs('big');
    // ← from the picture's own scene: the line before it.
    await v.page.waitForTimeout(400);
    await v.page.keyboard.press('ArrowLeft');
    await v.shows(/첫 줄/);
    await v.pictureIs('none');
    // The full-screen sheet (◀ 🔍 ▶ 닫기, without Omni's 크게보기), shown and closed: afterwards the menu's ◀ is ◀ again.
    await v.tapUntil(async () => /마지막 줄/.test(await v.text()));
    await thumb();
    await v.press('cgfull');
    await v.page.waitForFunction(() => getComputedStyle(document.querySelector('[x-omni-vn] [data-vn-dock]')).display === 'grid');
    // Left by a tap on the picture (it folds straight away): the sheet's buttons were last where ◀ is.
    await v.page.waitForTimeout(300);
    await v.page.mouse.click(v.frame.x + v.frame.width / 2, v.frame.y + v.frame.height * 0.3);
    await v.page.waitForFunction(() => getComputedStyle(document.querySelector('[x-omni-vn] [data-vn-dock]')).display === 'none');
    await v.pictureIs('folded');
    await v.page.waitForTimeout(400);
    await v.press('prev');
    await v.shows(/그림 다음 줄/);
    await v.pictureIs('folded');
    assert.deepEqual(v.errors, []);
  } finally { await browser.close(); }
});

test('옴니 뷰어 over a restricted SafeDOM: a picture the chat does not show is passed over the way the reader goes — ◀ from the last picture gets past it', async () => {
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  try {
    // Two pictures end the reply; the chat draws only the last (the first has no image there to show).
    const v = await viewerOn(browser, ['하린: "앞 줄이야."', '[[@inray::card8::inxshot_gone::832::1216]]', '[[@inray::card9::inxshot_pic::832::1216]]']);
    await v.shows(/앞 줄/);
    await v.tapUntil(async () => await v.picture() === 'big');
    await v.page.waitForFunction(() => /^"3 \/ 3"/.test(getComputedStyle(document.querySelector('[x-omni-vn] [data-vn-box]'), '::after').content));
    await v.page.waitForTimeout(600);
    // ◀: past the picture it cannot show, back to the line (it bounced forward to the last picture, for good).
    await v.press('prev');
    await v.shows(/앞 줄/);
    await v.page.waitForFunction(() => /^"1 \/ 3"/.test(getComputedStyle(document.querySelector('[x-omni-vn] [data-vn-box]'), '::after').content));
    // And ← from the last picture too.
    await v.tapUntil(async () => await v.picture() === 'big');
    await v.page.waitForTimeout(600);
    await v.page.keyboard.press('ArrowLeft');
    await v.page.waitForFunction(() => /^"1 \/ 3"/.test(getComputedStyle(document.querySelector('[x-omni-vn] [data-vn-box]'), '::after').content));
    assert.deepEqual(v.errors, []);
  } finally { await browser.close(); }
});

test('옴니 뷰어 over a restricted SafeDOM: the stage — one quiet longer than 말한 뒤 남는 줄 (three lines unless set) steps off, nobody stands ahead of their line, and where people overlap the last to speak stands in front', async () => {
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  try {
    const v = await viewerOn(browser, ['오미선: "왔어?"', '하린: "응, 방금 왔어."', '문이 열렸다.', '바람이 불었다.', '창밖이 어두워졌다.', '비가 내리기 시작했다.', '하린: "벌써 이렇게 늦었네."']);
    /** Who stands, by name, with how far forward (z-index). */
    const standing = () => v.page.evaluate(() => Object.fromEntries([...document.querySelectorAll('[x-omni-vn] [x-vn-p]')].filter(n => getComputedStyle(n).display !== 'none').map(n => [n.querySelector('b')?.textContent, Number(getComputedStyle(n).zIndex)])));
    const step = async re => { await v.tapUntil(async () => re.test(await v.text())); await v.shows(re); await v.page.waitForTimeout(150); };
    await v.shows(/왔어/);
    assert.deepEqual(Object.keys(await standing()), ['오미선']);
    await step(/방금 왔어/);
    assert.deepEqual(await standing(), { 오미선: 2, 하린: 3 }, 'the speaker in front');
    await step(/문이 열렸다/);
    assert.deepEqual(await standing(), { 오미선: 2, 하린: 3 }, 'narration: who spoke last stays in front');
    await step(/바람이 불었다/);
    assert.deepEqual(await standing(), { 오미선: 2, 하린: 3 }, 'three lines by default: 오미선, quiet three lines, still stands');
    await step(/창밖이/);
    assert.deepEqual(Object.keys(await standing()), ['하린'], '오미선, quiet four lines: off; 하린 spoke three lines ago');
    await step(/비가 내리기/);
    assert.deepEqual(await standing(), {}, '하린 speaks next, and is not there before it (that told who would speak)');
    await step(/벌써 이렇게/);
    assert.deepEqual(await standing(), { 하린: 3 }, 'back with her line');
    // 뷰어 설정's 말한 뒤 남는 줄: one line, and 하린 is off three lines after hers; 답장 끝까지, and nobody steps off.
    await v.page.evaluate(() => window.saveViewerPrefs({ stageReach: 1 }));
    for (const back of [/비가 내리기/, /창밖이/]) { await v.page.waitForTimeout(300); await v.page.keyboard.press('ArrowLeft'); await v.shows(back); }
    await v.page.waitForTimeout(150);
    assert.deepEqual(await standing(), {}, 'one line: nobody within it');
    await v.page.evaluate(() => window.saveViewerPrefs({ stageReach: 0 }));
    await step(/비가 내리기/);
    assert.deepEqual(await standing(), { 오미선: 2, 하린: 3 }, '답장 끝까지: everyone who spoke stays');
    assert.deepEqual(v.errors, []);
  } finally { await browser.close(); }
});

test('옴니 뷰어 over a restricted SafeDOM: a picture as it first comes up has its bar too — ▲ 접기 goes on, full screen goes back to it', async () => {
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  try {
    const v = await viewerOn(browser, ['하린: "첫 줄이야."', '[[@inray::card9::inxshot_pic::832::1216]]', '오미선: "그림 다음 줄."', '하린: "마지막 줄."']);
    const count = () => v.page.evaluate(() => getComputedStyle(document.querySelector('[x-omni-vn] [data-vn-box]'), '::after').content);
    const barUp = () => v.page.evaluate(() => ['cgfull', 'cgroll', 'cgtags', 'cgclose'].map(act => getComputedStyle(document.querySelector(`[x-omni-vn] [data-vn-act="${act}"]`)).display !== 'none'));
    await v.shows(/첫 줄/);
    await v.tapUntil(async () => await v.picture() === 'big');
    assert.match(await count(), /^"2 \//, "the picture's own scene");
    assert.deepEqual(await barUp(), [true, true, true, true], '⛶ 🎲 🔮 ▲ as it first comes up, not only shown again from its thumb');
    // ⛶ (the viewer's own full screen, without Omni's 크게보기) and back: its own scene again, big, the bar up.
    await v.page.waitForTimeout(500);
    await v.press('cgfull');
    await v.page.waitForFunction(() => getComputedStyle(document.querySelector('[x-omni-vn] [data-vn-dock]')).display === 'grid');
    await v.page.waitForTimeout(300);
    await v.press('cgback');
    await v.page.waitForFunction(() => getComputedStyle(document.querySelector('[x-omni-vn] [data-vn-dock]')).display === 'none');
    await v.pictureIs('big');
    assert.match(await count(), /^"2 \//);
    assert.deepEqual(await barUp(), [true, true, true, true]);
    // Left by a tap on it, full screen goes back there too (folded, the box would show the line before it).
    await v.page.waitForTimeout(300);
    await v.press('cgfull');
    await v.page.waitForFunction(() => getComputedStyle(document.querySelector('[x-omni-vn] [data-vn-dock]')).display === 'grid');
    await v.page.waitForTimeout(300);
    await v.page.mouse.click(v.frame.x + v.frame.width / 2, v.frame.y + v.frame.height * 0.3);
    await v.page.waitForFunction(() => getComputedStyle(document.querySelector('[x-omni-vn] [data-vn-dock]')).display === 'none');
    await v.pictureIs('big');
    assert.match(await count(), /^"2 \//);
    // Omni's own 크게보기 (stubbed), opened there and closed: back to the same scene, big.
    await v.page.evaluate(() => { window.__OMNI_INSPECT_SHOT__ = async () => { window.inspecting = true; return true; }; window.__OMNI_INSPECT_OPEN__ = () => window.inspecting === true; });
    await v.page.waitForTimeout(300);
    await v.press('cgfull');
    await v.page.waitForFunction(() => window.inspecting === true);
    await v.page.waitForTimeout(400);
    await v.page.evaluate(() => { window.inspecting = false; });
    await v.page.waitForTimeout(900);
    await v.pictureIs('big');
    assert.match(await count(), /^"2 \//);
    // ▲ 접기 there folds it as a tap does: the reading goes on, the picture at the top.
    await v.page.waitForTimeout(500);
    await v.press('cgclose');
    await v.shows(/그림 다음 줄/);
    await v.pictureIs('folded');
    assert.deepEqual(v.errors, []);
  } finally { await browser.close(); }
});

test('옴니 뷰어 over a restricted SafeDOM: a picture the chat does not draw (an older reply) is read from its own file, once', async () => {
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  try {
    // card7's picture is in no chat image (Risu draws only the newest messages): only its file has it.
    const v = await viewerOn(browser, ['하린: "옛날 그림이야."', '[[@inray::card7::inxshot_old::832::1216]]', '하린: "그 다음 줄."'], { card7: 'assets/old.png' });
    await v.shows(/옛날 그림/);
    await v.tapUntil(async () => await v.picture() === 'big');
    assert.match(await v.page.evaluate(() => document.querySelector('[x-omni-vn] img[x-vn-cg]').getAttribute('src')), /^data:image\//, 'the file, fitted and sent once');
    await v.page.waitForTimeout(500);
    await v.tapUntil(async () => /그 다음 줄/.test(await v.text()));
    await v.pictureIs('folded');
    assert.equal(await v.page.locator('[x-omni-vn] img[x-vn-cg]').count(), 1, 'read once: the same picture folds');
    assert.deepEqual(v.errors, []);
  } finally { await browser.close(); }
});

test('옴니 뷰어 over a restricted SafeDOM: the top bar keeps the clock of the line on screen — a time skip once passed, and an earlier reply\'s own when turned back to', async () => {
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  try {
    const v = await viewerOn(browser, ['[3월 2일 ◆ 오후 4시 ◆ 카페]', '오미선: "왔어? 오늘은 일찍 왔네."', '[오후 9시 ◆ 집]', '하린: "벌써 밤이네, 들어가자."'], {},
      '[3월 1일 ◆ 밤 ◆ 집]\n하린: "어제는 비가 왔지."');
    const clockIs = want => v.page.waitForFunction(want => (document.querySelector('[x-omni-vn] [data-vn-clock]')?.textContent || '') === want, want);
    await v.shows(/일찍 왔네/);
    await clockIs('3월 2일 · 오후 4시 · 카페');
    await v.tapUntil(async () => /들어가자/.test(await v.text()));
    await clockIs('오후 9시 · 집');
    await v.page.waitForTimeout(400);
    await v.press('prev');
    await v.shows(/일찍 왔네/);
    await clockIs('3월 2일 · 오후 4시 · 카페');
    // ◀ from the reply's first line: the reply before, with its own clock (it was the one shown at opening, once).
    await v.page.waitForTimeout(400);
    await v.press('prev');
    await v.shows(/비가 왔지/);
    await clockIs('3월 1일 · 밤 · 집');
    assert.equal(await v.page.evaluate(() => /\[오후 9시/.test(document.querySelector('[x-omni-vn] [data-vn-log]')?.textContent || '')), false, 'a clock line is never a scene');
    assert.deepEqual(v.errors, []);
  } finally { await browser.close(); }
});

test('옴니 뷰어 over a restricted SafeDOM: a tap on the name over a line opens that person\'s TTS 캐릭터 sheet — the spinner until it is up, and back on the same line once it closes', async () => {
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  try {
    const v = await viewerOn(browser, ['오미선: "왔어? 오늘은 일찍 왔네."', '하린: "응, 수업이 빨리 끝났어."']);
    // The settings window as the frozen UI makes it: opened on a tab, its flag, its ✕. Its mount takes the ask a moment later.
    await v.page.evaluate(() => {
      window.settingsUp = false; window.asked = [];
      window.__OMNI_TTS_SETTINGS_OPEN__ = () => window.settingsUp;
      window.__OMNI_OPEN_TTS__ = async () => {
        window.settingsUp = true;
        setTimeout(() => { const ask = window.takeSoundFocus(); window.asked.push(ask); ask?.shown?.(); }, 900);
      };
      const close = document.createElement('button'); close.id = 'nx-close'; close.onclick = () => { window.settingsUp = false; }; document.body.append(close);
    });
    const tapName = async () => { const r = await v.rect('[x-omni-vn] [data-vn-name]'); await v.page.mouse.click(r.x + r.width / 2, r.y + r.height / 2); };
    await v.shows(/일찍 왔네/);
    await v.page.waitForTimeout(500);
    await tapName();
    await v.page.waitForFunction(() => getComputedStyle(document.querySelector('[x-omni-vn] [data-vn-busy]')).display !== 'none', null, { timeout: 800 });
    assert.equal(await v.page.evaluate(() => window.viewerOpen()), true, 'the viewer stays up, its spinner turning, until the sheet is');
    await v.page.waitForFunction(() => !window.viewerOpen());
    const ask = await v.page.evaluate(() => { const { panel, search, sheet } = window.asked[0]; return { panel, search, sheet }; });
    assert.deepEqual(ask, { panel: 'tts-characters', search: '오미선', sheet: { id: 't-misun', name: '오미선' } });
    // The sheet closed for good: the window goes as by its ✕, and the viewer is back where it was.
    await v.page.evaluate(() => window.asked[0].done());
    await v.page.waitForFunction(() => window.viewerOpen() && /일찍 왔네/.test(document.querySelector('[x-omni-vn] [data-vn-text]')?.textContent || ''));
    assert.equal(await v.page.evaluate(() => window.settingsUp), false, 'the settings window closed with it');
    // The window closed instead (its ✕): back as well.
    await v.page.waitForTimeout(700);
    await tapName();
    await v.page.waitForFunction(() => !window.viewerOpen());
    await v.page.evaluate(() => { window.settingsUp = false; });
    await v.page.waitForFunction(() => window.viewerOpen() && /일찍 왔네/.test(document.querySelector('[x-omni-vn] [data-vn-text]')?.textContent || ''));
    // Off the name, a tap still turns the line.
    await v.page.waitForTimeout(700);
    await v.tapUntil(async () => /수업이/.test(await v.text()));
    assert.equal(await v.page.evaluate(() => window.asked.length), 2);
    assert.deepEqual(v.errors, []);
  } finally { await browser.close(); }
});
