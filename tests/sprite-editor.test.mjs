import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';

// 감정 에셋's faces: what a face is rides on its picture; its big view has a 닫기; 편집 puts in a picture (the bot's
// asset or a file) with its plain background taken, and keeps it as Omni's own face.
const built = await build({ stdin: { contents: `import {mountTts,ttsSettingsHtml} from './src/tts-ui/mount';import {ttsData,saveTtsData} from './src/storage/tts-store';import {emotionData} from './src/storage/emotion-store';import {setSoundPage} from './src/sound-ui/page';import {settingsUxCss} from './src/settings-ux/styles';import {previewChrome} from './src/settings-ux/tab-html';import {cutoutBytes} from './src/services/sprite-cutout';Object.assign(window,{mountTts,ttsSettingsHtml,ttsData,saveTtsData,emotionData,setSoundPage,settingsUxCss,previewChrome,cutoutBytes});`, resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife' });

test('감정 에셋 · a face\'s name, source, key and 대사에 나옴 ride its picture; its big view closes by its ✕; 편집 puts in a file with its white taken and keeps it as Omni\'s', async () => {
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 420, height: 860 } }), errors = [];
    page.setDefaultTimeout(8000); page.on('pageerror', error => errors.push(error.message)); page.on('dialog', d => d.dismiss());
    await page.route('https://tts.test/', route => route.fulfill({ contentType: 'text/html', body: '<html><head></head><body style="background:#0b0f18;color:#eee"></body></html>' })); await page.goto('https://tts.test/');
    // Pictures drawn in the page: the bot's own 「미선_sad」 on white, and a file on white with a red figure in it.
    const drawn = await page.evaluate(async () => {
      const draw = async (w, h) => {
        const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d');
        g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.fillStyle = '#c33'; g.fillRect(w * .25, h * .2, w * .5, h * .7); g.fillStyle = '#fff'; g.fillRect(w * .45, h * .3, w * .1, h * .05);
        return [...new Uint8Array(await (await new Promise(r => c.toBlob(r, 'image/png'))).arrayBuffer())];
      };
      return { asset: await draw(60, 90), file: await draw(120, 180) };
    });
    await page.evaluate(({ asset }) => {
      const save = new Map(), local = new Map(), files = new Map([['assets/sad.png', new Uint8Array(asset)]]);
      window.saved = [];
      window.bots = [{ chaId: 'test-char', name: '봇', additionalAssets: [['미선_sad', 'assets/sad.png', 'png'], ['배경음', 'assets/bgm.mp3', 'mp3']], globalLore: [], chats: [{ id: 'test-chat', message: [{ role: 'char', data: '오미선 (sobbing): "흑흑, 미안해"' }] }] }];
      window.risuai = { pluginStorage: { getItem: async k => save.get(k), setItem: async (k, v) => save.set(k, v) }, getLocalPluginStorage: async () => ({ getItem: async k => local.get(k), setItem: async (k, v) => local.set(k, v), removeItem: async k => local.delete(k) }),
        requestPluginPermission: async () => true, getDatabase: async () => ({ modules: [], enabledModules: [] }), setDatabase: async () => {}, getCurrentCharacterIndex: async () => 0, getCurrentChatIndex: async () => 0,
        getCharacterFromIndex: async i => structuredClone(window.bots[i] ?? null), setCharacterToIndex: async (i, c) => { window.bots[i] = structuredClone(c); },
        getCharacter: async () => structuredClone({ ...window.bots[0], chatPage: 0 }), readImage: async path => files.get(path) ?? null,
        saveAsset: async bytes => { const path = `assets/made-${files.size}.png`; const copy = new Uint8Array(bytes); files.set(path, copy); window.saved.push(copy); return path; },
        runLLMModel: async () => ({ success: true, content: 'OK' }), nativeFetch: async () => ({ ok: true, arrayBuffer: async () => new Uint8Array(32).buffer }) };
      window.Audio = class { play() { return Promise.resolve(); } pause() {} load() {} removeAttribute() {} };
    }, drawn);
    await page.evaluate(() => { window.crypto.randomUUID = undefined; document.addEventListener('submit', e => { e.preventDefault(); e.stopImmediatePropagation(); }, true); });
    await page.addScriptTag({ content: built.outputFiles[0].text });
    await page.evaluate(async () => {
      document.documentElement.classList.add('nx-ux-on'); const style = document.createElement('style'); style.textContent = window.settingsUxCss; document.head.append(style);
      document.body.innerHTML = '<div id="nx-shell" class="nx-ux">' + window.previewChrome() + '</div>';
      window.setSoundPage('asset'); document.getElementById('nx-main').innerHTML = window.ttsSettingsHtml(); await window.mountTts();
      window.ttsData().characters.push({ id: 't-misun', scope: 'global', name: '오미선', surname: '오', givenName: '미선', surnameAliases: [], givenAliases: [], triggers: [], tags: [], gender: 'female', voiceKey: '', fishId: '', fixed: false, gain: 0 });
      await window.saveTtsData();
    });
    await page.locator('#tab-emo-assets').click();
    await page.waitForFunction(() => document.getElementById('emo-people-count')?.textContent === '1명');
    await page.locator('.emo-people-fold summary').click();
    await page.locator('[data-emo-open="t-misun"]').click();
    await page.waitForFunction(() => document.getElementById('character-dialog').open && document.getElementById('character-form').dataset.emoView === 'faces');
    await page.waitForFunction(() => /url\("blob:/.test(document.querySelector('.emo-pic[data-face="sad"]')?.style.backgroundImage || ''));
    // 자동 누끼 is on unless switched off, beside 투명 배경.
    assert.equal(await page.evaluate(() => window.emotionData().settings.autoCutout), true);
    const sad = page.locator('.emo-tile', { has: page.locator('[data-face="sad"]') });
    const chips = () => sad.locator('.emo-chip').evaluateAll(list => list.map(n => `${n.dataset.at}:${n.textContent}`));
    assert.deepEqual((await chips()).filter(c => !c.startsWith('tl:')), ['tr:봇 에셋', 'bl:sad']);
    // The chips lie on the picture, and the tile is the picture and its two buttons.
    const [pic, chip] = await Promise.all([sad.locator('.emo-pic').boundingBox(), sad.locator('.emo-chip[data-at="bl"]').boundingBox()]);
    assert.ok(chip.y >= pic.y && chip.y + chip.height <= pic.y + pic.height + 0.5, 'on the picture');
    assert.deepEqual(await sad.locator('button').allTextContents(), ['다시 만들기', '편집']);
    assert.match(await page.locator('.emo-tile').first().locator('.emo-chip[data-at="br"]').textContent(), /대사에 나옴/);
    // Big: its ✕ closes it (on a phone the picture filled the screen; only the dark around it closed it).
    await sad.locator('.emo-pic').click();
    await page.waitForSelector('[data-nx-peek] [data-nx-peek-close]');
    await page.locator('[data-nx-peek-close]').click();
    await page.waitForFunction(() => !document.querySelector('[data-nx-peek]'));
    assert.equal(await page.evaluate(() => document.getElementById('character-dialog').open), true, 'the sheet stays');
    // 편집 › 에셋에서: the bot's pictures (its sound left out).
    await sad.locator('[data-emo-edit]').click();
    await page.waitForSelector('.emo-edit');
    await page.waitForFunction(() => !document.querySelector('.emo-edit [data-ee-img]').hidden);
    await page.locator('.emo-edit [data-ee="assets"]').click();
    assert.deepEqual(await page.locator('.emo-edit [data-ee-asset] small').allTextContents(), ['미선_sad']);
    // 내 파일에서: a file on white, its white taken by itself; the white inside the figure stays.
    await page.locator('.emo-edit [data-ee-file]').setInputFiles({ name: 'face.png', mimeType: 'image/png', buffer: Buffer.from(drawn.file) });
    await page.waitForFunction(() => document.querySelector('.emo-edit [data-ee-note]').textContent === '흰 배경을 지웠어요.');
    assert.equal(await page.locator('.emo-edit [data-ee-cut="auto"]').getAttribute('aria-pressed'), 'true');
    // 원본: back as it was; 흰 배경 by hand takes it again.
    await page.locator('.emo-edit [data-ee-cut="none"]').click();
    await page.waitForFunction(() => document.querySelector('.emo-edit [data-ee-note]').textContent === '원본 그대로예요.');
    await page.locator('.emo-edit [data-ee-cut="white"]').click();
    await page.waitForFunction(() => document.querySelector('.emo-edit [data-ee-note]').textContent === '흰 배경을 지웠어요.');
    await page.locator('.emo-edit [data-ee="save"]').click();
    await page.waitForFunction(() => !document.querySelector('.emo-edit'));
    // Kept as Omni's own face under a drawn one's name, see-through where the white was, the figure and its white eye kept.
    const made = await page.evaluate(() => window.emotionData().made.map(m => [m.person, m.face, m.name]));
    assert.deepEqual(made, [['t-misun', 'sad', 'omni_오미선_sad.png']]);
    const pixels = await page.evaluate(async () => {
      const bitmap = await createImageBitmap(new Blob([window.saved.at(-1)])), c = new OffscreenCanvas(bitmap.width, bitmap.height), g = c.getContext('2d');
      g.drawImage(bitmap, 0, 0); const at = (x, y) => g.getImageData(x, y, 1, 1).data[3];
      return { corner: at(1, 1), body: at(60, 150), eye: at(60, 60) };
    });
    assert.deepEqual(pixels, { corner: 0, body: 255, eye: 255 });
    await page.waitForFunction(() => document.querySelector('.emo-tile .emo-pic[data-face="sad"]')?.parentElement.querySelector('.emo-chip[data-at="tr"]')?.textContent === '옴니');
    assert.match(await page.locator('#emo-char-status').textContent(), /그림을 바꿨어요/);
    // A picture the size a face is drawn at: once, well under a second.
    const ms = await page.evaluate(async () => {
      const c = new OffscreenCanvas(832, 1216), g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 832, 1216); g.fillStyle = '#c33'; g.fillRect(200, 200, 432, 900);
      const bytes = new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer()), t = performance.now();
      const out = await window.cutoutBytes(bytes);
      return { ms: performance.now() - t, result: out.result };
    });
    assert.equal(ms.result, 'cut');
    assert.ok(ms.ms < 1500, `832×1216 in ${Math.round(ms.ms)} ms`);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
