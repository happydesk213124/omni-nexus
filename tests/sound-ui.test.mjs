import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';

test('BGM·효과음 page: menu pages, settings install the ⚛️ modules, links and files register, glossary learns words', async () => {
  const built = await build({ stdin: { contents: `import {mountTts,ttsSettingsHtml} from './src/tts-ui/mount';import {settingsUxCss} from './src/settings-ux/styles';import {previewChrome} from './src/settings-ux/tab-html';import {bindSoundNav,setSoundPage} from './src/sound-ui/page';import {soundData} from './src/storage/sound-store';import {omniSound} from './src/services/sound-runtime';import {ttsData,updateTtsSettings} from './src/storage/tts-store';Object.assign(window,{mountTts,ttsSettingsHtml,settingsUxCss,previewChrome,bindSoundNav,setSoundPage,soundData,omniSound,ttsData,updateTtsSettings});`, resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife', loader: { '.txt': 'text' } });
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
      window.played = []; window.eleven = []; window.music = []; window.jevAsked = []; window.jevChoice = 'new'; window.llmAsked = []; window.llmAnswer = '';
      window.risuai = {
        pluginStorage: { getItem: async k => save.get(k), setItem: async (k, v) => save.set(k, v) },
        requestPluginPermission: async () => true,
        runLLMModel: async options => { window.llmAsked.push(options); return { success: true, content: window.llmAnswer }; },
        getDatabase: async () => structuredClone(window.db), setDatabase: async next => { window.db = { ...window.db, ...structuredClone(next) }; },
        saveAsset: async bytes => { const path = `assets/${assets.size + 1}.bin`; assets.set(path, new Uint8Array(bytes)); return path; },
        readImage: async path => assets.get(path),
        getCurrentCharacterIndex: async () => 0, getCharacter: async () => ({ chaId: 'c', chats: [{ id: 'chat', message: [] }] }),
        getCharacterFromIndex: async () => structuredClone(window.bot), setCharacterToIndex: async (_i, c) => { window.bot = structuredClone(c); },
        nativeFetch: async (url, options = {}) => {
          if (url.includes('api.elevenlabs.io/v1/music?')) { window.music.push({ body: JSON.parse(options.body), key: options.headers['xi-api-key'] }); return { ok: true, arrayBuffer: async () => id3().buffer }; }
          if (url.includes('api.elevenlabs.io/v1/sound-generation')) { window.eleven.push({ body: JSON.parse(options.body), key: options.headers['xi-api-key'] }); return { ok: true, arrayBuffer: async () => id3().buffer }; }
          if (url.includes('translate.googleapis.com')) return { ok: true, json: async () => [[[window.english || 'boom']]] };
          if (url.includes('decisions')) { const body = JSON.parse(options.body); window.jevAsked.push(body); return { ok: true, json: async () => ({ answers: Object.fromEntries(Object.keys(body.questions).map(k => [k, { choice: window.jevChoice }])) }) }; }
          return url.endsWith('.mp3') ? { ok: true, arrayBuffer: async () => id3().buffer } : { ok: true, arrayBuffer: async () => new TextEncoder().encode('<!doctype html><html>').buffer };
        },
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

    // An unknown effect word lands in the glossary tab; assigning it teaches the glossary. 「덜컹! 덜컹!」 is two sounds: the part is what is learned.
    await page.locator('#tab-sound-settings').click(); await page.locator('#snd-sfx-enabled').check();
    await page.waitForFunction(() => window.soundData().settings.sfxEnabled);
    assert.equal(await page.evaluate(() => window.omniSound.playSfxWord('덜컹! 덜컹!')), false);
    await page.locator('#tab-sound-glossary').click();
    const unknown = page.locator('#snd-unknown .snd-unknown-tile');
    assert.deepEqual(await unknown.locator('b').allTextContents(), ['덜컹'], 'one unknown sound, not the whole compound');
    await page.setViewportSize({ width: 412, height: 915 });
    assert.ok(await fill('sound-glossary') < 40, 'the glossary fills the height too');
    await page.locator('#tab-sound-bgm').click(); assert.ok(await fill('sound-bgm') < 40, 'and the BGM list');
    await page.locator('#tab-sound-glossary').click(); await page.setViewportSize({ width: 1360, height: 900 });
    // Words and the unknown list are two tabs.
    assert.equal(await page.locator('#snd-gloss-unknown').isVisible(), false, 'the word tiles first');
    assert.equal(await page.locator('#snd-unknown-count').textContent(), '1');
    await page.locator('#snd-gloss-tab-unknown').click();
    assert.equal(await page.locator('#snd-gloss-terms').isVisible(), false);
    assert.equal(await page.locator('#snd-term-add').isVisible(), false, '+ 묶음 belongs to the word tab');
    await unknown.locator('select').selectOption({ label: '문 쾅' });
    await page.waitForFunction(() => window.soundData().glossary.length === 1 && !window.soundData().unknownTerms.length);
    assert.equal(await page.evaluate(() => window.omniSound.playSfxWord('덜컹! 덜컹!')), true, 'the learned word now plays its effect');
    // Glossary tiles: words are chips on the tile; add with Enter, × drops one, a word lives in one tile only.
    await page.locator('#tab-sound-glossary').click(); await page.locator('#snd-gloss-tab-terms').click();
    const tile = () => page.locator('#snd-terms .snd-term-tile');
    assert.deepEqual(await tile().first().locator('.snd-chip').allTextContents(), ['덜컹×']);
    assert.equal(await tile().first().locator('.snd-term-effect').inputValue(), await page.evaluate(() => window.soundData().glossary[0].sfxKey));
    await tile().first().locator('.snd-term-new').fill('쾅쾅, 탕'); await tile().first().locator('.snd-term-new').press('Enter');
    await page.waitForFunction(() => window.soundData().glossary[0].terms.join(',') === '덜컹,쾅쾅,탕');
    await tile().first().locator('[aria-label="탕 빼기"]').click();
    await page.waitForFunction(() => window.soundData().glossary[0].terms.join(',') === '덜컹,쾅쾅');
    await page.locator('#snd-term-add').click();
    await page.waitForFunction(() => window.soundData().glossary.length === 2 && document.querySelectorAll('#snd-terms .snd-term-tile').length === 2);
    assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('snd-term-new')), true, 'a new tile is ready to type into');
    await tile().first().locator('.snd-term-new').fill('쾅쾅'); await tile().first().locator('.snd-term-new').press('Enter');
    await page.waitForFunction(() => window.soundData().glossary[0].terms.join(',') === '쾅쾅' && window.soundData().glossary[1].terms.join(',') === '덜컹', null, { timeout: 5000 });
    await tile().first().locator('.snd-term-delete').click();
    await page.waitForFunction(() => window.soundData().glossary.length === 1 && window.soundData().glossary[0].terms.join(',') === '덜컹');
    await page.locator('#snd-term-search').fill('없는말');
    assert.match(await page.locator('#snd-terms').textContent(), /검색에 맞는 용어가 없습니다/);
    await page.locator('#snd-term-search').fill('');
    await page.locator('#tab-sound-settings').click();
    await page.locator('#snd-rule-test').fill('§덜컹! 덜컹!§');
    assert.match(await page.locator('#snd-rule-result').textContent(), /덜컹! 덜컹!」 → 문 쾅/);
    // A rule is two marks, no regex: what the user types is what the chat matches.
    const rule = page.locator('#snd-rules .snd-rule').first();
    assert.equal(await rule.locator('.snd-rule-pattern, .snd-rule-flags').count(), 0, 'no regex or flag field');
    await rule.locator('.snd-rule-open').fill('[['); await rule.locator('.snd-rule-open').dispatchEvent('change');
    await rule.locator('.snd-rule-close').fill(']]'); await rule.locator('.snd-rule-close').dispatchEvent('change');
    await page.waitForFunction(() => window.soundData().settings.sfxRules[0].open === '[[' && window.soundData().settings.sfxRules[0].close === ']]');
    await page.locator('#snd-rule-test').fill('[[덜컹! 덜컹!]]');
    assert.match(await page.locator('#snd-rule-result').textContent(), /덜컹! 덜컹!」 → 문 쾅/, 'the example follows the new marks');
    await rule.locator('.snd-rule-close').fill(''); await rule.locator('.snd-rule-close').dispatchEvent('change');
    await page.waitForFunction(() => /모두 넣어/.test(document.querySelector('#snd-rules .snd-rule-error')?.textContent || ''));
    assert.equal(await page.evaluate(() => window.soundData().settings.sfxRules[0].close), ']]', 'an empty mark is not saved');
    // Under the instruction switch: whether the chat model's last request carried it.
    await page.evaluate(() => { Object.assign(window.soundData().settings, { sfxEnabled: true, sfxCue: true }); window.__OMNI_INLINE_TAGS__ = { status: () => ({ registered: 'yes' }), cues: () => ({ at: Date.now(), tts: true, bgm: true, sfx: false }) }; });
    await page.waitForFunction(() => /효과음 지시가 빠졌습니다[\s\S]*로어북 토큰 한도/.test(document.getElementById('snd-sfx-cue-status')?.textContent || ''), null, { timeout: 5000 });
    await page.evaluate(() => { window.__OMNI_INLINE_TAGS__.cues = () => ({ at: Date.now(), tts: true, bgm: true, sfx: true }); });
    await page.waitForFunction(() => /효과음 지시가 들어갔습니다/.test(document.getElementById('snd-sfx-cue-status')?.textContent || ''), null, { timeout: 5000 });
    // Loudness, silence and length are per-effect playback settings, on by default.
    assert.deepEqual(await page.evaluate(() => [document.getElementById('snd-sfx-normalize').checked, document.getElementById('snd-sfx-trim').checked, document.getElementById('snd-sfx-max').value, document.getElementById('snd-sfx-first').checked]), [true, true, '6', true]);
    await page.locator('#snd-sfx-max').fill('10'); await page.locator('#snd-sfx-max').dispatchEvent('change');
    await page.locator('#snd-sfx-normalize').evaluate(n => { n.checked = false; n.dispatchEvent(new Event('change')); });
    await page.waitForFunction(() => window.soundData().settings.sfxMaxSec === 10 && window.soundData().settings.sfxNormalize === false);
    await page.locator('#snd-sfx-max').fill('999'); await page.locator('#snd-sfx-max').dispatchEvent('change');
    await page.waitForFunction(() => window.soundData().settings.sfxMaxSec === 60 && document.getElementById('snd-sfx-max').value === '60');

    // The shared model page opens on its own and is usable while TTS is off.
    await openPage('models');
    assert.deepEqual(await tabs(), ['모델 설정']);
    assert.equal(await page.locator('#tts-fish-model').isDisabled(), false);
    await openPage('tts');
    assert.deepEqual(await tabs(), ['TTS 설정', '캐릭터', '음성 목록']);
    // ElevenLabs: the key lives on the shared model page.
    await openPage('models');
    await page.locator('#snd-eleven-key').fill('el-key'); await page.locator('#snd-eleven-key').dispatchEvent('change');
    await page.waitForFunction(() => window.soundData().settings.elevenKey === 'el-key');
    // Adding an effect by prompt generates it and stores it in ⚛️ omni 효과음.
    await openPage('sound'); await page.locator('#tab-sound-sfx').click(); await page.locator('#snd-sfx-add').click();
    await page.locator('#snd-item-source').selectOption('eleven');
    assert.equal(await page.locator('#snd-item-prompt').isVisible(), true);
    await page.locator('#snd-item-prompt').fill('heavy wooden door slamming'); await page.locator('#snd-item-name').fill('문 쾅2'); await page.locator('#snd-item-save').click();
    await page.waitForFunction(() => window.soundData().sfx.some(i => i.name === '문 쾅2'));
    assert.deepEqual(await page.evaluate(() => window.eleven.at(-1)), { body: { text: 'heavy wooden door slamming', prompt_influence: 0.4 }, key: 'el-key' });
    assert.equal(await page.evaluate(() => window.soundData().sfx.find(i => i.name === '문 쾅2').source), 'asset');
    await page.locator('#tab-sound-bgm').click(); await page.locator('#snd-bgm-add').click();
    // BGM: the same option makes instrumental music through Eleven Music.
    await page.locator('#snd-item-source').selectOption('eleven');
    assert.match(await page.locator('#snd-item-prompt-label').textContent(), /BGM/);
    await page.locator('#snd-item-prompt').fill('calm piano for a rainy cafe'); await page.locator('#snd-item-duration').fill('90'); await page.locator('#snd-item-name').fill('비 오는 카페'); await page.locator('#snd-item-save').click();
    await page.waitForFunction(() => window.soundData().bgm.some(i => i.name === '비 오는 카페'));
    assert.deepEqual(await page.evaluate(() => window.music.at(-1)), { body: { prompt: 'calm piano for a rainy cafe', model_id: 'music_v1', force_instrumental: true, music_length_ms: 90000 }, key: 'el-key' });
    assert.equal(await page.evaluate(() => window.eleven.filter(c => c.body.text === 'calm piano for a rainy cafe').length), 0, 'BGM never goes to the effect endpoint');
    // Auto: JEV says none fits → one generated effect, in its folder and the glossary.
    await page.evaluate(() => window.updateTtsSettings({ jev: { ...window.ttsData().settings.jev, key: 'jev-key' } }));
    await page.locator('#tab-sound-settings').click(); await page.locator('#snd-sfx-matcher').selectOption('jev');
    const before = await page.evaluate(() => window.eleven.length);
    await page.evaluate(() => { window.english = 'rumble'; });
    assert.equal(await page.evaluate(() => window.omniSound.playSfxWord('우르릉', '천둥이 쳤다')), false, 'switched off: nothing is generated');
    assert.equal(await page.evaluate(() => window.eleven.length), before);
    await page.locator('#snd-sfx-autocreate').check(); await page.waitForFunction(() => window.soundData().settings.sfxAutoCreate);
    const twice = await page.evaluate(() => Promise.all([window.omniSound.playSfxWord('우르릉', '천둥이 쳤다'), window.omniSound.playSfxWord('우르릉', '천둥이 쳤다')]));
    assert.deepEqual(twice, [true, true]);
    assert.equal(await page.evaluate(() => window.eleven.length), before + 1, 'the same word at once makes one effect');
    assert.match(await page.evaluate(() => window.eleven.at(-1).body.text), /^rumble sound effect/, 'the template gets the word in English');
    const made = await page.evaluate(() => window.soundData().sfx.find(i => i.name === '우르릉'));
    assert.equal(made.folder, '자동 생성');
    assert.ok(await page.evaluate(key => window.soundData().glossary.some(r => r.sfxKey === key && r.terms.includes('우르릉')), made.key));
    const jevCalls = await page.evaluate(() => window.jevAsked.length);
    assert.equal(await page.evaluate(() => window.omniSound.playSfxWord('우르릉')), true);
    assert.equal(await page.evaluate(() => window.jevAsked.length), jevCalls, 'a learned word needs no model call');
    assert.ok(JSON.stringify(await page.evaluate(() => window.jevAsked.at(-1).questions[0].criteria)).includes('"new"'), 'JEV is offered "new" next to the listed effects');
    // JEV picks a listed effect: learned, nothing generated.
    await page.evaluate(() => { window.jevChoice = '1'; });
    const count = await page.evaluate(() => window.eleven.length);
    assert.equal(await page.evaluate(() => window.omniSound.playSfxWord('철컥')), true);
    assert.equal(await page.evaluate(() => window.eleven.length), count);
    assert.ok(await page.evaluate(() => window.soundData().glossary.some(r => r.terms.includes('철컥'))));
    // LLM works the same way, and when it says none fits its own English prompt is used as is.
    await page.locator('#snd-sfx-matcher').selectOption('llm'); await page.waitForFunction(() => window.soundData().settings.sfxMatcher === 'llm');
    await page.evaluate(() => { window.llmAnswer = '{"n":0,"prompt":"distant thunder rolling over hills"}'; });
    const jevBefore = await page.evaluate(() => window.jevAsked.length);
    assert.equal(await page.evaluate(() => window.omniSound.playSfxWord('콰광', '멀리서 천둥')), true);
    assert.equal(await page.evaluate(() => window.eleven.at(-1).body.text), 'distant thunder rolling over hills');
    assert.equal(await page.evaluate(() => window.jevAsked.length), jevBefore, 'the LLM matcher never asks JEV');
    assert.equal(await page.evaluate(() => window.soundData().sfx.find(i => i.name === '콰광').folder), '자동 생성');
    await page.evaluate(() => { window.llmAnswer = '{"n":1,"prompt":""}'; });
    const llmCount = await page.evaluate(() => window.eleven.length);
    assert.equal(await page.evaluate(() => window.omniSound.playSfxWord('덜컹')), true);
    assert.equal(await page.evaluate(() => window.eleven.length), llmCount, 'a listed pick makes nothing');
    assert.ok(await page.evaluate(() => window.soundData().glossary.some(r => r.terms.includes('덜컹'))));
    // A compound effect: its unknown parts go to JEV in one request, one question per part, and each part is learned.
    await page.locator('#snd-sfx-matcher').selectOption('jev'); await page.waitForFunction(() => window.soundData().settings.sfxMatcher === 'jev');
    await page.evaluate(() => { window.jevChoice = '1'; });
    const jevBeforeCombo = await page.evaluate(() => window.jevAsked.length);
    assert.equal(await page.evaluate(() => window.omniSound.playSfxWord('콰르릉 휘이잉', '폭풍이 몰아쳤다')), true);
    assert.equal(await page.evaluate(() => window.jevAsked.length), jevBeforeCombo + 1, 'one request for both parts');
    assert.deepEqual(await page.evaluate(() => Object.values(window.jevAsked.at(-1).questions).map(q => q.instructions.sound_word)), ['콰르릉', '휘이잉']);
    assert.ok(await page.evaluate(() => ['콰르릉', '휘이잉'].every(word => window.soundData().glossary.some(row => row.terms.includes(word)))), 'each part is learned');
    assert.equal(await page.evaluate(() => window.omniSound.playSfxWord('콰르릉 휘이잉')), true);
    assert.equal(await page.evaluate(() => window.jevAsked.length), jevBeforeCombo + 1, 'known parts ask nothing again');
    // ⚡ in the unknown tab: JEV sorts the collected words into listed effects, eight per request.
    await page.evaluate(() => { window.soundData().unknownTerms = Array.from({ length: 10 }, (_, i) => '알수없음' + i); window.jevChoice = '1'; });
    await page.locator('#tab-sound-glossary').click(); await page.locator('#snd-gloss-tab-unknown').click();
    await page.waitForFunction(() => document.querySelectorAll('#snd-unknown .snd-unknown-tile').length === 10);
    const jevBeforeAuto = await page.evaluate(() => window.jevAsked.length);
    await page.locator('#snd-unknown-auto').click();
    await page.waitForFunction(() => !window.soundData().unknownTerms.length && !document.querySelector('#snd-unknown .snd-unknown-tile'));
    assert.deepEqual(await page.evaluate(n => window.jevAsked.slice(n).map(body => Object.keys(body.questions).length), jevBeforeAuto), [8, 2], 'two requests: eight words, then two');
    assert.ok(await page.evaluate(() => Array.from({ length: 10 }, (_, i) => '알수없음' + i).every(word => window.soundData().glossary.some(row => row.terms.includes(word)))));
    assert.equal(await page.locator('#snd-unknown-auto').textContent(), '⚡ 자동 등록');
    await page.locator('#tab-sound-settings').click();
    // ⚡: a reply's own text picks a listed track through JEV or the LLM, and BGM turns on with it.
    const tracks = await page.evaluate(() => window.soundData().bgm.map(item => item.key));
    assert.ok(tracks.length >= 2, 'two tracks to choose between');
    await page.locator('#snd-bgm-matcher').selectOption('jev'); await page.waitForFunction(() => window.soundData().settings.bgmMatcher === 'jev');
    await page.evaluate(() => { window.jevChoice = '1'; window.soundData().settings.bgmEnabled = false; });
    const reply = '<Thoughts>\nsecret plan\n</Thoughts>\n빗소리가 들리는 조용한 카페.';
    assert.equal(await page.evaluate(text => window.omniSound.guessBgm(text).then(item => item.key), reply), tracks[0]);
    const asked = await page.evaluate(() => window.jevAsked.at(-1).questions[0]);
    assert.equal(asked.instructions.scene, '빗소리가 들리는 조용한 카페.', 'the prose only, never the reasoning');
    assert.equal(JSON.stringify(asked.criteria).includes('"new"'), false, 'a pick among the listed tracks only');
    assert.equal(await page.evaluate(() => window.soundData().settings.bgmEnabled), true, 'picking music turns BGM on');
    await page.locator('#snd-bgm-matcher').selectOption('llm'); await page.waitForFunction(() => window.soundData().settings.bgmMatcher === 'llm');
    await page.evaluate(n => { window.llmAnswer = JSON.stringify({ n }); }, tracks.length);
    const jevNow = await page.evaluate(() => window.jevAsked.length);
    assert.equal(await page.evaluate(text => window.omniSound.guessBgm(text).then(item => item.key), reply), tracks.at(-1));
    assert.equal(await page.evaluate(() => window.jevAsked.length), jevNow, 'the LLM setting never asks JEV');
    await page.evaluate(() => { window.llmAnswer = '{"n":999}'; });
    assert.match(await page.evaluate(text => window.omniSound.guessBgm(text).then(() => 'played', error => error.message), reply), /고르지 못했습니다/, 'an answer naming no listed track plays nothing');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
