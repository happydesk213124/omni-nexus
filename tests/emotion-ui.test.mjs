import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';

// 1×1 PNG: the bot's own 「미선_sad」 image.
const PNG = [137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1,8,6,0,0,0,31,21,196,137,0,0,0,13,73,68,65,84,120,156,99,248,15,4,0,9,251,3,253,227,85,242,156,0,0,0,0,73,69,78,68,174,66,96,130];

test('감정 에셋: its page saves settings, and a TTS card opens on its faces with the bot image and a make button', async () => {
  const built = await build({ stdin: { contents: `import {mountTts,ttsSettingsHtml} from './src/tts-ui/mount';import {ttsData,saveTtsData} from './src/storage/tts-store';import {viewerPrefs} from './src/storage/viewer-prefs';import {emotionData} from './src/storage/emotion-store';import {setSoundPage} from './src/sound-ui/page';import {settingsUxCss} from './src/settings-ux/styles';import {previewChrome} from './src/settings-ux/tab-html';Object.assign(window,{mountTts,ttsSettingsHtml,ttsData,saveTtsData,emotionData,viewerPrefs,setSoundPage,settingsUxCss,previewChrome});`, resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife' });
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 420, height: 860 } }), errors = [];
    page.setDefaultTimeout(8000); page.on('pageerror', error => errors.push(error.message)); page.on('dialog', d => d.dismiss());
    await page.route('https://tts.test/', route => route.fulfill({ contentType: 'text/html', body: '<html><head></head><body style="background:#0b0f18;color:#eee"></body></html>' })); await page.goto('https://tts.test/');
    await page.evaluate(png => {
      const save = new Map(), local = new Map();
      window.bots = [{ chaId: 'test-char', name: '봇', additionalAssets: [['미선_sad', 'assets/sad.png', 'png']], globalLore: [], chats: [{ id: 'test-chat', message: [{ role: 'char', data: '오미선 (sobbing): "흑흑, 미안해"' }] }] }];
      window.risuai = { pluginStorage: { getItem: async k => save.get(k), setItem: async (k, v) => save.set(k, v) }, getLocalPluginStorage: async () => ({ getItem: async k => local.get(k), setItem: async (k, v) => local.set(k, v), removeItem: async k => local.delete(k) }),
        requestPluginPermission: async () => true, getDatabase: async () => ({ modules: [], enabledModules: [] }), setDatabase: async db => { (window.dbWrites ||= []).push(structuredClone(db)); }, getCurrentCharacterIndex: async () => 0, getCurrentChatIndex: async () => 0,
        getCharacterFromIndex: async i => structuredClone(window.bots[i] ?? null), setCharacterToIndex: async (i, c) => { window.bots[i] = structuredClone(c); },
        getCharacter: async () => structuredClone({ ...window.bots[0], chatPage: 0 }), readImage: async path => path === 'assets/sad.png' ? new Uint8Array(png) : null,
        runLLMModel: async () => ({ success: true, content: 'OK' }), nativeFetch: async () => ({ ok: true, arrayBuffer: async () => new Uint8Array(32).buffer }) };
      window.Audio = class { play() { return Promise.resolve(); } pause() {} load() {} removeAttribute() {} };
    }, PNG);
    await page.evaluate(() => { window.crypto.randomUUID = undefined; document.addEventListener('submit', e => { e.preventDefault(); e.stopImmediatePropagation(); }, true); });
    await page.addScriptTag({ content: built.outputFiles[0].text });
    await page.evaluate(async () => {
      document.documentElement.classList.add('nx-ux-on'); const style = document.createElement('style'); style.textContent = window.settingsUxCss; document.head.append(style);
      document.body.innerHTML = '<div id="nx-shell" class="nx-ux">' + window.previewChrome() + '</div>';
      window.setSoundPage('asset'); document.getElementById('nx-main').innerHTML = window.ttsSettingsHtml(); await window.mountTts();
    });
    // Three tabs, like BGM·효과음's: 뷰어 opens first, outside the TTS power switch.
    assert.deepEqual(await page.locator('[data-tts-tab]:not([hidden])').allTextContents(), ['뷰어', '배경', '감정 에셋']);
    assert.equal(await page.locator('#emo-viewer').isVisible(), true);
    assert.equal(await page.locator('#tts-controls').isVisible(), false);
    // 옴니 뷰어's own settings: the words whose lines are no scene, the letter speed and size.
    await page.locator('#emo-skip').fill('상태창, OOC');
    await page.locator('#emo-speed').selectOption('slow');
    await page.waitForFunction(() => window.viewerPrefs().skipWords === '상태창, OOC' && window.viewerPrefs().speed === 'slow');
    await page.locator('#emo-size').selectOption('large');
    await page.waitForFunction(() => window.viewerPrefs().textSize === 'large');
    // 캐릭터 움직임: breathing and springs, both on; switched off, kept.
    assert.equal(await page.locator('#emo-breathe').isChecked(), true);
    assert.equal(await page.locator('#emo-bounce').isChecked(), true);
    await page.locator('#emo-bounce').uncheck();
    await page.waitForFunction(() => window.viewerPrefs().bounce === false && window.viewerPrefs().breathe === true);
    // 무대에 남는 줄: three lines unless set; 답장 끝까지 is kept as 0. Its 「?」 says what it does.
    assert.equal(await page.locator('#emo-reach').inputValue(), '3');
    await page.locator('#emo-reach').selectOption('0');
    await page.waitForFunction(() => window.viewerPrefs().stageReach === 0);
    await page.locator('#emo-reach').selectOption('2');
    await page.waitForFunction(() => window.viewerPrefs().stageReach === 2);
    // risu64 난독 풀어 읽기: off unless switched on.
    assert.equal(await page.locator('#emo-base64').isChecked(), false);
    await page.locator('#emo-base64').check();
    await page.waitForFunction(() => window.viewerPrefs().revealBase64 === true);
    assert.equal(await page.locator('#emo-reach').evaluate(n => n.closest('.row')?.dataset.nxHelpId), 'emo-reach');
    // 바로가기: four switches, all on unless switched off, each named with its button's emoji and with its own 「?」.
    for (const id of ['emo-float-resume', 'emo-float-center', 'emo-menu-resume', 'emo-menu-center']) {
      assert.equal(await page.locator(`#${id}`).isChecked(), true, id);
      assert.equal(await page.locator(`#${id}`).evaluate(n => n.closest('.row')?.dataset.nxHelpId), id);
    }
    assert.match(await page.locator('#emo-float-center').evaluate(n => n.closest('.row')?.textContent), /바로가기 버튼 · 🎯 화면 중앙/);
    assert.match(await page.locator('#emo-menu-resume').evaluate(n => n.closest('.row')?.textContent), /채팅 ☰ 메뉴 · 📽️ 보던 곳/);
    await page.locator('#emo-float-center').uncheck();
    await page.waitForFunction(() => window.viewerPrefs().floatCenter === false && window.viewerPrefs().floatResume === true && window.viewerPrefs().menuCenter === true);
    // 배경: its switch greys out the rest; ⚛️ omni place goes into Risu's modules, on; a reply with no place is picked by JEV.
    await page.locator('#tab-emo-bg').click();
    assert.equal(await page.locator('#emo-bg').isVisible(), true);
    assert.equal(await page.locator('#emo-bg-samples button').count(), 106, 'the sample places, tags only');
    // The page opened again (new markup): listed again (it stayed empty once reopened).
    await page.evaluate(async () => { document.getElementById('nx-main').innerHTML = window.ttsSettingsHtml(); await window.mountTts(); });
    await page.locator('#tab-emo-bg').click();
    await page.waitForFunction(() => document.querySelectorAll('#emo-bg-samples button').length === 106);
    // A background every chat uses (drawn for a sample place): its tile, 다시 그리기 and 삭제; its sample no longer to draw.
    await page.evaluate(() => window.emotionData().made.push({ bot: '*', person: '__place__', face: 'cafe, indoors, window, daytime', name: 'omni_bg_cafe, indoors, window, daytime.webp', path: 'assets/sad.png', registered: true, at: 1 }));
    await page.locator('#tab-emo-assets').click(); await page.locator('#tab-emo-bg').click();
    await page.waitForFunction(() => document.querySelectorAll('#emo-bg-shared .emo-bg-tile').length === 1);
    assert.equal(await page.locator('#emo-bg-shared-count').textContent(), '1장');
    assert.deepEqual(await page.locator('#emo-bg-shared .emo-bg-tools button').allTextContents(), ['다시 그리기', '삭제']);
    assert.equal(await page.locator('[data-emo-bg-make="cafe, indoors, window, daytime"]').isDisabled(), true);
    await page.waitForFunction(() => /url\("blob:/.test(document.querySelector('#emo-bg-shared .emo-bg-pic')?.style.backgroundImage || ''));
    await page.evaluate(() => { window.confirm = () => true; });
    await page.locator('#emo-bg-shared [data-emo-bg-delete]').click();
    await page.waitForFunction(() => !document.querySelector('#emo-bg-shared .emo-bg-tile'));
    assert.equal(await page.evaluate(() => window.emotionData().made.some(m => m.bot === '*')), false, 'gone for every chat');
    assert.equal(await page.locator('[data-emo-bg-make="cafe, indoors, window, daytime"]').isDisabled(), false, 'its sample can be drawn again');
    await page.locator('#emo-places').uncheck();
    await page.waitForFunction(() => window.emotionData().settings.placeBackgrounds === false && document.getElementById('emo-bg-gate').disabled);
    await page.locator('#emo-places').check();
    await page.waitForFunction(() => !document.getElementById('emo-bg-gate').disabled);
    await page.locator('#emo-place-module').check();
    await page.waitForFunction(() => window.viewerPrefs().placeModule === true);
    const written = await page.evaluate(() => window.dbWrites.at(-1));
    assert.deepEqual(written.enabledModules, ['omni-place']);
    assert.equal(written.modules[0].name, '⚛️ omni place');
    assert.match(await page.locator('#emo-place-module-status').textContent(), /켜짐/);
    await page.locator('#emo-bg-pick').selectOption('jev');
    await page.waitForFunction(() => window.viewerPrefs().bgPick === 'jev');
    // 감정 에셋: the faces; its switch greys out the rest.
    await page.locator('#tab-emo-assets').click();
    assert.equal(await page.locator('#emo-assets').isVisible(), true);
    await page.locator('#emo-family').selectOption('v4');
    await page.locator('#emo-face-happy').fill('2::grin::');
    await page.locator('#emo-words').fill('pouting=sad\nbogus=nothing');
    await page.locator('#emo-pose').click();
    await page.waitForFunction(() => window.emotionData().settings.family === 'v4' && window.emotionData().settings.faceTags.happy === '2::grin::');
    assert.deepEqual(await page.evaluate(() => window.emotionData().settings.words), { pouting: 'sad' }, 'only words onto a real face are kept');
    await page.locator('#emo-enabled').uncheck();
    await page.waitForFunction(() => document.getElementById('emo-faces-gate').disabled && window.emotionData().settings.enabled === false);
    await page.locator('#emo-enabled').check();
    await page.waitForFunction(() => !document.getElementById('emo-faces-gate').disabled);
    // 코스튬별 에셋 waits on streaming tags with costumes: the writer names a costume from the list they bring.
    assert.equal(await page.locator('#emo-costumes').isDisabled(), true);
    assert.match(await page.locator('#emo-costumes-status').textContent(), /스트리밍 중 태그 생성과 코스튬을 켜면/);
    assert.equal(await page.locator('#emo-costumes').evaluate(n => n.closest('.row')?.dataset.nxHelpId), 'emo-costumes');
    // What each row does is the 「?」's (no gray lines under the rows).
    assert.equal(await page.locator('#emo-place-module').evaluate(n => n.closest('.row')?.dataset.nxHelpId), 'emo-place-module');
    assert.equal(await page.evaluate(() => window.emotionData().settings.prefix), '', "not 감정 에셋's own settings");
    // A TTS card of this bot, listed with the face its reply showed.
    await page.evaluate(async () => { window.ttsData().characters.push({ id: 't-misun', scope: 'global', name: '오미선', surname: '오', givenName: '미선', surnameAliases: [], givenAliases: ['Misun'], triggers: [], tags: [], gender: 'female', voiceKey: '', fishId: '', fixed: false, gain: 0 }); await window.saveTtsData(); });
    await page.locator('#tab-emo-assets').click();
    // Folded at first (a long list made the page long), its count on the fold.
    await page.waitForFunction(() => document.getElementById('emo-people-count')?.textContent === '1명');
    assert.equal(await page.locator('[data-emo-open="t-misun"]').isVisible(), false, "the bot's characters start folded");
    await page.locator('.emo-people-fold summary').click();
    await page.locator('[data-emo-open="t-misun"]').click();
    await page.waitForFunction(() => document.getElementById('character-dialog').open && document.getElementById('character-form').dataset.emoView === 'faces');
    assert.equal(await page.locator('#c-name').isVisible(), false, 'the faces view hides the voice fields');
    const sad = page.locator('.emo-tile', { has: page.locator('[data-face="sad"]') });
    await page.waitForFunction(() => /url\("blob:/.test(document.querySelector('.emo-pic[data-face="sad"]')?.style.backgroundImage || ''));
    assert.match(await sad.textContent(), /봇 에셋/);
    // The reply's `(sobbing)` is the cry face: seen faces come first, marked.
    assert.equal(await page.locator('.emo-pic').first().getAttribute('data-face'), 'cry');
    assert.match(await page.locator('.emo-tile').first().textContent(), /대사에 나옴/);
    assert.match(await page.locator('.emo-tile').first().textContent(), /없음/);
    assert.match(await page.locator('#emo-char-looks').textContent(), /외형 태그가 없습니다/);
    assert.equal(await page.locator('.emo-tile').count() >= 15, true);
    await page.locator('[data-emo-tab="voice"]').click();
    assert.equal(await page.locator('#c-name').isVisible(), true);
    // 연결된 삽화 stands by 감정 에셋 in their row, not in a row of its own.
    assert.equal(await page.locator('.emo-sheet-switch #c-illustration-link').count(), 1);
    assert.equal(await page.locator('[data-sheet-links]').count(), 0);
    const [tab, link] = await Promise.all(['[data-emo-tab="faces"]', '#c-illustration-link'].map(s => page.locator(s).boundingBox()));
    assert.ok(Math.abs(tab.y - link.y) < 2 && link.x > tab.x, 'on the same line, after 감정 에셋: ' + JSON.stringify({ tab, link }));
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
