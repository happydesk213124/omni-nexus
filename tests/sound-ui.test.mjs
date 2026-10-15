import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';

test('BGM·효과음 page: menu pages, settings install the ⚛️ modules, links and files register, glossary learns words', async () => {
  const built = await build({ stdin: { contents: `import {mountTts,ttsSettingsHtml} from './src/tts-ui/mount';import {settingsUxCss} from './src/settings-ux/styles';import {previewChrome} from './src/settings-ux/tab-html';import {bindSoundNav,setSoundPage} from './src/sound-ui/page';import {soundData} from './src/storage/sound-store';import {omniSound} from './src/services/sound-runtime';Object.assign(window,{mountTts,ttsSettingsHtml,settingsUxCss,previewChrome,bindSoundNav,setSoundPage,soundData,omniSound});`, resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife', loader: { '.txt': 'text' } });
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1360, height: 900 } }), errors = [];
    page.setDefaultTimeout(8000); page.on('pageerror', error => errors.push(error.message)); page.on('dialog', d => d.accept());
    await page.route('https://sound.test/', route => route.fulfill({ contentType: 'text/html', body: '<html><head></head><body style="background:#0b0f18;color:#eee"></body></html>' }));
    await page.goto('https://sound.test/');
    await page.evaluate(() => {
      const save = new Map(), assets = new Map();
      const id3 = () => new Uint8Array([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
      window.db = { modules: [], enabledModules: [] };
      window.bot = { chaId: 'c', name: '봇', globalLore: [], chats: [{ id: 'chat', message: [] }] };
      window.played = [];
      window.risuai = {
        pluginStorage: { getItem: async k => save.get(k), setItem: async (k, v) => save.set(k, v) },
        requestPluginPermission: async () => true,
        getDatabase: async () => structuredClone(window.db), setDatabase: async next => { window.db = { ...window.db, ...structuredClone(next) }; },
        saveAsset: async bytes => { const path = `assets/${assets.size + 1}.bin`; assets.set(path, new Uint8Array(bytes)); return path; },
        readImage: async path => assets.get(path),
        getCurrentCharacterIndex: async () => 0, getCharacter: async () => ({ chaId: 'c', chats: [{ id: 'chat', message: [] }] }),
        getCharacterFromIndex: async () => structuredClone(window.bot), setCharacterToIndex: async (_i, c) => { window.bot = structuredClone(c); },
        nativeFetch: async url => url.endsWith('.mp3') ? { ok: true, arrayBuffer: async () => id3().buffer } : { ok: true, arrayBuffer: async () => new TextEncoder().encode('<!doctype html><html>').buffer },
      };
      const param = () => ({ value: 1, setTargetAtTime() {}, cancelScheduledValues() {}, setValueAtTime() {}, linearRampToValueAtTime() {} });
      window.AudioContext = class { state = 'running'; currentTime = 0; destination = {}; resume() { return Promise.resolve(); } createGain() { return { gain: param(), connect(n) { return n; } }; } createMediaElementSource() { return { connect(n) { return n; } }; } };
      window.Audio = class { loop = false; paused = true; currentTime = 0; set src(v) { this._src = v; } play() { this.paused = false; window.played.push(this.loop ? 'bgm' : 'sfx'); return Promise.resolve(); } pause() { this.paused = true; } addEventListener() {} };
    });
    await page.addScriptTag({ content: built.outputFiles[0].text });
    await page.evaluate(async () => {
      const style = document.createElement('style'); style.textContent = window.settingsUxCss; document.head.append(style);
      document.documentElement.classList.add('nx-ux-on');
      document.body.innerHTML = '<div id="nx-shell" class="nx-ux">' + window.previewChrome() + '</div>';
      document.getElementById('nx-main').innerHTML = window.ttsSettingsHtml();
      window.bindSoundNav(); await window.mountTts();
    });
    const tabs = () => page.locator('[data-tts-tab]:visible').allTextContents();
    // The markup alone (before any mount script) already shows only the open page's tabs: no flash of other tabs.
    const premount = await page.evaluate(() => ['sound', 'models', 'tts'].map(name => { window.setSoundPage(name); const box = document.createElement('div'); box.innerHTML = window.ttsSettingsHtml(); document.body.append(box);
      const shown = [...box.querySelectorAll('[data-tts-tab]')].filter(b => b.checkVisibility()).map(b => b.textContent); const panels = [...box.querySelectorAll('section.panel')].filter(p => p.checkVisibility()).map(p => p.id); box.remove(); return [shown, panels]; }));
    assert.deepEqual(premount, [[['설정', 'BGM 목록', '효과음 목록', '효과음 용어집'], ['sound-settings']], [['모델 설정'], ['tts-models']], [['TTS 설정', '캐릭터', '음성 목록'], ['tts-settings']]]);
    // On a phone the open list fills the height; a hidden page's container takes none of it.
    await page.setViewportSize({ width: 412, height: 915 });
    const fill = async (panel) => page.evaluate(id => { const root = document.getElementById('tts-settings-root').getBoundingClientRect(), box = document.getElementById(id).getBoundingClientRect(); return Math.round(root.bottom - box.bottom); }, panel);
    await page.locator('#tab-voices').click();
    assert.ok(await fill('tts-voices') < 40, 'the voice list reaches the bottom of the TTS area');
    await page.setViewportSize({ width: 1360, height: 900 });
    const openPage = async name => { await page.locator(`#nx-tabs [data-sound-page="${name}"]`).click(); };
    assert.deepEqual(await tabs(), ['TTS 설정', '캐릭터', '음성 목록'], 'the TTS page no longer carries the model tab');

    await openPage('sound');
    assert.deepEqual(await tabs(), ['설정', 'BGM 목록', '효과음 목록', '효과음 용어집']);
    assert.equal(await page.locator('#tts-power-controls').isVisible(), false, 'the TTS power switch belongs to the TTS page only');
    assert.equal(await page.locator('#snd-bgm-enabled').isDisabled(), false, 'BGM works while TTS is off');

    // Switching BGM on installs its module, enabled, with the tag instruction.
    await page.locator('#snd-bgm-enabled').check();
    await page.waitForFunction(() => window.db.modules.some(m => m.id === 'omni-bgm') && window.db.enabledModules.includes('omni-bgm'));
    const bgmModule = await page.evaluate(() => window.db.modules.find(m => m.id === 'omni-bgm'));
    assert.equal(bgmModule.name, '⚛️ omni bgm');
    assert.match(bgmModule.lorebook[0].content, /\[\[bgm:mood,place,tempo\]\]/);

    // A page address is refused; a real audio link registers as a tile.
    await page.locator('#tab-sound-bgm').click();
    await page.locator('#snd-bgm-add').click();
    await page.locator('#snd-item-name').fill('추격 테마'); await page.locator('#snd-item-tags').fill('tense, chase, fast');
    await page.locator('#snd-item-url').fill('https://audio.test/page.html'); await page.locator('#snd-item-save').click();
    await page.waitForFunction(() => document.getElementById('snd-item-status').textContent.includes('오디오 파일이 아닙니다'));
    await page.locator('#snd-item-url').fill('https://audio.test/chase.mp3'); await page.locator('#snd-item-save').click();
    await page.waitForFunction(() => window.soundData().bgm.length === 1);
    assert.equal(await page.locator('#snd-bgm-list .voice-row strong').textContent(), '추격 테마');
    assert.deepEqual(await page.evaluate(() => window.soundData().bgm[0].tags), ['tense', 'chase', 'fast']);
    assert.equal(await page.evaluate(() => window.db.modules.find(m => m.id === 'omni-bgm').assets.length), 0, 'a link is not copied into the module');

    // Reply tags pick and play it; a second, weaker match keeps it playing.
    const chaseKey = await page.evaluate(() => window.soundData().bgm[0].key);
    assert.equal(await page.evaluate(() => window.omniSound.playBgmForTags(['긴박', '추격', '빠른'])), chaseKey, 'Korean synonyms reach the English tags');
    assert.ok(await page.evaluate(() => window.played.includes('bgm')));

    // A file goes into ⚛️ omni 효과음 as a module asset, even before effects are switched on.
    await page.locator('#tab-sound-sfx').click();
    await page.locator('#snd-sfx-add').click();
    await page.locator('#snd-item-source').selectOption('file');
    await page.locator('#snd-item-file').setInputFiles({ name: 'door.mp3', mimeType: 'audio/mpeg', buffer: Buffer.from([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]) });
    await page.locator('#snd-item-name').fill('문 쾅'); await page.locator('#snd-item-save').click();
    await page.waitForFunction(() => window.db.modules.find(m => m.id === 'omni-sfx')?.assets?.length === 1);
    const sfxModule = await page.evaluate(() => window.db.modules.find(m => m.id === 'omni-sfx'));
    assert.equal(sfxModule.name, '⚛️ omni 효과음');
    assert.equal(await page.evaluate(() => window.db.enabledModules.includes('omni-sfx')), false, 'effects stay off until switched on');

    // An unknown effect word lands in the glossary tab; assigning it teaches the glossary.
    await page.locator('#tab-sound-settings').click(); await page.locator('#snd-sfx-enabled').check();
    await page.waitForFunction(() => window.soundData().settings.sfxEnabled);
    assert.equal(await page.evaluate(() => window.omniSound.playSfxWord('덜컹! 덜컹!')), false);
    await page.locator('#tab-sound-glossary').click();
    const unknown = page.locator('#snd-unknown .snd-unknown');
    assert.equal(await unknown.locator('b').textContent(), '덜컹! 덜컹!');
    await page.setViewportSize({ width: 412, height: 915 });
    assert.ok(await fill('sound-glossary') < 40, 'the glossary fills the height too');
    await page.locator('#tab-sound-bgm').click(); assert.ok(await fill('sound-bgm') < 40, 'and the BGM list');
    await page.locator('#tab-sound-glossary').click(); await page.setViewportSize({ width: 1360, height: 900 });
    await unknown.locator('select').selectOption({ label: '문 쾅' });
    await page.waitForFunction(() => window.soundData().glossary.length === 1 && !window.soundData().unknownTerms.length);
    assert.equal(await page.evaluate(() => window.omniSound.playSfxWord('덜컹! 덜컹!')), true, 'the learned word now plays its effect');
    await page.locator('#tab-sound-settings').click();
    await page.locator('#snd-rule-test').fill('§덜컹! 덜컹!§');
    assert.match(await page.locator('#snd-rule-result').textContent(), /덜컹! 덜컹!」 → 문 쾅/);

    // The shared model page opens on its own and is usable while TTS is off.
    await openPage('models');
    assert.deepEqual(await tabs(), ['모델 설정']);
    assert.equal(await page.locator('#tts-fish-model').isDisabled(), false);
    await openPage('tts');
    assert.deepEqual(await tabs(), ['TTS 설정', '캐릭터', '음성 목록']);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
