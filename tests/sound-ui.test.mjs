import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';

test('BGM·효과음 page: menu pages, settings install the ⚛️ modules, links and files register, glossary learns words', async () => {
  const built = await build({ stdin: { contents: `import {mountTts,ttsSettingsHtml} from './src/tts-ui/mount';import {settingsUxCss} from './src/settings-ux/styles';import {previewChrome} from './src/settings-ux/tab-html';import {bindSoundNav,setSoundPage} from './src/sound-ui/page';import {soundData,updateSoundSettings} from './src/storage/sound-store';import {omniSound} from './src/services/sound-runtime';import {ttsData,updateTtsSettings} from './src/storage/tts-store';Object.assign(window,{mountTts,ttsSettingsHtml,settingsUxCss,previewChrome,bindSoundNav,setSoundPage,soundData,updateSoundSettings,omniSound,ttsData,updateTtsSettings});`, resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife', loader: { '.txt': 'text' } });
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1360, height: 900 } }), errors = [];
    page.setDefaultTimeout(8000); page.on('pageerror', error => errors.push(error.message)); page.on('dialog', d => d.accept());
    await page.route('https://sound.test/', route => route.fulfill({ contentType: 'text/html', body: '<html><head></head><body style="background:#0b0f18;color:#eee"></body></html>' }));
    await page.goto('https://sound.test/');
    await page.evaluate(() => {
      // An existing save with empty lists: a first run would start with the examples (tested at the end).
      const save = new Map([['omnisound.data', '{}']]), assets = new Map();
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
    // Three rows of controls above the list on a phone (search · commands · folders with the selection bar), not five.
    const head = await page.evaluate(() => Math.round(document.getElementById('snd-bgm-list').getBoundingClientRect().top - document.getElementById('sound-bgm').getBoundingClientRect().top));
    assert.ok(head < 200, `the list starts ${head}px below the tabs`);
    assert.equal(await page.evaluate(() => document.getElementById('snd-bgm-folder-toggle').getBoundingClientRect().top === document.getElementById('snd-bgm-multi').getBoundingClientRect().top), true, 'folders and the selection bar share a row');
    assert.ok(await page.evaluate(() => { const list = document.getElementById('snd-bgm-list').getBoundingClientRect(), bar = document.querySelector('#sound-bgm .voice-command-bar').getBoundingClientRect(); return Math.abs(list.left - bar.left) < 8 && Math.abs(list.right - bar.right) < 8; }), 'the list keeps the full width below them');
    await page.locator('#tab-sound-glossary').click(); await page.setViewportSize({ width: 1360, height: 900 });
    // Words and the unknown list are two tabs.
    assert.equal(await page.locator('#snd-gloss-unknown').isVisible(), false, 'the word tiles first');
    assert.equal(await page.locator('#snd-unknown-count').textContent(), '1');
    await page.locator('#snd-gloss-tab-unknown').click();
    assert.equal(await page.locator('#snd-gloss-terms').isVisible(), false);
    assert.equal(await page.locator('#snd-term-add').isVisible(), false, '+ 묶음 belongs to the word tab');
    // 「직접 고르기」 opens a searchable list with ▶ on every row; Enter takes the first match.
    await unknown.locator('.snd-unknown-pick').click();
    assert.equal(await page.locator('#snd-pick-dialog').isVisible(), true);
    assert.match(await page.locator('#snd-pick-title').textContent(), /덜컹/);
    await page.locator('#snd-pick-search').fill('문 쾅'); assert.equal(await page.locator('#snd-pick-list .snd-pick-row').count(), 1, 'the search narrows the list');
    await page.locator('#snd-pick-search').press('Enter');
    assert.equal(await page.locator('#snd-pick-dialog').isVisible(), false);
    await page.waitForFunction(() => window.soundData().glossary.length === 1 && !window.soundData().unknownTerms.length);
    assert.equal(await page.evaluate(() => window.omniSound.playSfxWord('덜컹! 덜컹!')), true, 'the learned word now plays its effect');
    // Glossary tiles: words are chips on the tile; add with Enter, × drops one, a word lives in one tile only.
    await page.locator('#tab-sound-glossary').click(); await page.locator('#snd-gloss-tab-terms').click();
    const tile = () => page.locator('#snd-terms .snd-term-tile');
    assert.deepEqual(await tile().first().locator('.snd-chip').allTextContents(), ['덜컹×']);
    assert.equal(await tile().first().locator('.snd-term-effect').getAttribute('data-key'), await page.evaluate(() => window.soundData().glossary[0].sfxKey));
    assert.match(await tile().first().locator('.snd-term-effect').textContent(), /문 쾅/, 'the tile names its effect');
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
    // No test sentence, no generation prompt: each rule shows its own example.
    assert.equal(await page.locator('#snd-rule-test, #snd-rule-result, #snd-sfx-prompt').count(), 0);
    // A rule is two marks, no regex: what the user types is what the chat matches.
    const rule = page.locator('#snd-rules .snd-rule').first();
    assert.equal(await rule.locator('.snd-rule-pattern, .snd-rule-flags').count(), 0, 'no regex or flag field');
    assert.equal(await rule.locator('.snd-rule-sample').textContent(), '예 §쾅§');
    await rule.locator('.snd-rule-open').fill('[[');
    assert.equal(await rule.locator('.snd-rule-sample').textContent(), '예 [[쾅§', 'the example follows the marks as they are typed');
    await rule.locator('.snd-rule-open').dispatchEvent('change');
    await rule.locator('.snd-rule-close').fill(']]'); await rule.locator('.snd-rule-close').dispatchEvent('change');
    await page.waitForFunction(() => window.soundData().settings.sfxRules[0].open === '[[' && window.soundData().settings.sfxRules[0].close === ']]');
    assert.equal(await rule.locator('.snd-rule-sample').textContent(), '예 [[쾅]]');
    await rule.locator('.snd-rule-close').fill(''); await rule.locator('.snd-rule-close').dispatchEvent('change');
    await page.waitForFunction(() => /모두 넣어/.test(document.querySelector('#snd-rules .snd-rule-error')?.textContent || ''));
    assert.equal(await page.evaluate(() => window.soundData().settings.sfxRules[0].close), ']]', 'an empty mark is not saved');
    // On a wide screen a rule is one compact line: switch, name, the marks around 효과음, its example, 삭제.
    await rule.locator('.snd-rule-close').fill(']]'); await rule.locator('.snd-rule-close').dispatchEvent('change');
    await page.waitForFunction(() => !document.querySelector('#snd-rules .snd-rule-error')?.textContent);
    // As wide as the user's PC screenshot (one column, ~1200px): the card stays compact instead of spreading out.
    await page.evaluate(() => { document.getElementById('snd-sfx-gate').style.width = '1200px'; });
    const card = await rule.evaluate(node => { const box = node.getBoundingClientRect(), parts = ['.switch', '.snd-rule-name', '.snd-rule-marks', '.snd-rule-sample', '.snd-rule-del'].map(s => node.querySelector(s).getBoundingClientRect());
      return { width: box.width, height: box.height, oneLine: parts.every(p => Math.abs((p.top + p.bottom) / 2 - (parts[0].top + parts[0].bottom) / 2) < 8), ordered: parts.every((p, i) => !i || p.left >= parts[i - 1].right - 1), inside: parts.every(p => p.right <= box.right + 1), markGap: node.querySelector('.snd-rule-close').getBoundingClientRect().left - node.querySelector('.snd-rule-open').getBoundingClientRect().right,
        maxGap: Math.max(...parts.slice(1).map((p, i) => p.left - parts[i].right)) }; });
    assert.ok(card.height < 64 && card.oneLine && card.ordered && card.inside, JSON.stringify(card));
    assert.ok(card.markGap < 80, 'the two marks sit together around 효과음, not spread across the row: ' + card.markGap);
    assert.ok(card.maxGap <= 16 && card.width <= 680, 'nothing floats apart on a wide row: ' + JSON.stringify(card));
    await page.evaluate(() => { document.getElementById('snd-sfx-gate').style.width = ''; });
    // Explanations open with 「?」: the rows carry help ids, and their small lines are live status only.
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('#sound-settings .row .copy small')].filter(s => !s.querySelector('span[id]')).map(s => s.textContent)), [], 'no explanation text under the rows');
    const helpIds = await page.evaluate(() => ['snd-sfx-cue', 'snd-bgm-prompt', 'snd-rules-head', 'snd-bgm-tags', 'snd-bgm-cache'].map(id => document.getElementById(id).closest('[data-nx-help-id]')?.dataset.nxHelpId));
    assert.deepEqual(helpIds, ['snd-sfx-cue', 'snd-bgm-prompt', 'snd-rules-head', 'snd-bgm-tags', 'snd-bgm-cache']);
    // Under the instruction switch: whether the chat model's last request carried it.
    await page.evaluate(() => { Object.assign(window.soundData().settings, { sfxEnabled: true, sfxCue: true }); window.__OMNI_INLINE_TAGS__ = { status: () => ({ registered: 'yes' }), cues: () => ({ at: Date.now(), tts: true, bgm: true, sfx: false }) }; });
    await page.waitForFunction(() => /효과음 지시가 빠졌습니다[\s\S]*로어북 토큰 한도/.test(document.getElementById('snd-sfx-cue-status')?.textContent || ''), null, { timeout: 5000 });
    await page.evaluate(() => { window.__OMNI_INLINE_TAGS__.cues = () => ({ at: Date.now(), tts: true, bgm: true, sfx: true }); });
    await page.waitForFunction(() => /효과음 지시가 들어갔습니다/.test(document.getElementById('snd-sfx-cue-status')?.textContent || ''), null, { timeout: 5000 });
    // Loudness, silence and length are per-effect playback settings, on by default.
    assert.deepEqual(await page.evaluate(() => [document.getElementById('snd-sfx-normalize').checked, document.getElementById('snd-sfx-trim').checked, document.getElementById('snd-sfx-max').value, document.getElementById('snd-sfx-first').checked]), [true, true, '3', true]);
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
    // Ahead of time: every unknown part of the effects on screen goes to JEV in one request; playing then asks nothing.
    await page.evaluate(() => { window.jevChoice = '1'; });
    const jevBeforePrep = await page.evaluate(() => window.jevAsked.length);
    await page.evaluate(() => window.omniSound.prepareEffects([{ text: '삐용 뿌잉', context: '로봇' }, { text: '휘리릭', context: '바람' }, { text: '휘리릭', context: '다시' }]));
    assert.equal(await page.evaluate(() => window.jevAsked.length), jevBeforePrep + 1, 'one request for the whole screen');
    assert.deepEqual(await page.evaluate(() => Object.values(window.jevAsked.at(-1).questions).map(q => q.instructions.sound_word)), ['삐용', '뿌잉', '휘리릭']);
    assert.equal(await page.evaluate(() => window.omniSound.playSfxWord('삐용 뿌잉')), true);
    assert.equal(await page.evaluate(() => window.jevAsked.length), jevBeforePrep + 1, 'playing a prepared effect asks nothing');
    await page.evaluate(() => { window.jevChoice = 'new'; window.soundData().settings.sfxAutoCreate = false; });
    await page.evaluate(() => window.omniSound.prepareEffects([{ text: '퓨슝', context: '' }]));
    assert.equal(await page.evaluate(() => window.jevAsked.length), jevBeforePrep + 2);
    assert.equal(await page.evaluate(() => window.omniSound.playSfxWord('퓨슝')), false);
    assert.equal(await page.evaluate(() => window.jevAsked.length), jevBeforePrep + 2, 'a word nothing fits is not asked again');
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
    // 「곡을 고르는 근거」: the tags (the text when a reply has none), always the text, or the text with its tags.
    await page.locator('#snd-bgm-matcher').selectOption('jev'); await page.waitForFunction(() => window.soundData().settings.bgmMatcher === 'jev');
    await page.evaluate(() => { window.jevChoice = '1'; window.soundData().settings.bgmEnabled = true; });
    assert.equal(await page.locator('#snd-bgm-basis').inputValue(), 'tags', 'the tags by default');
    const bgmAsks = () => page.evaluate(() => window.jevAsked.length), bgmLast = () => page.evaluate(() => window.jevAsked.at(-1).questions[0].instructions);
    let bgmCount = await bgmAsks();
    await page.evaluate(() => window.omniSound.playBgmForReply('비 오는 카페.', ['calm', 'cafe', 'slow']));
    assert.equal(await bgmAsks(), bgmCount, 'a tagged reply needs no request');
    await page.evaluate(() => window.omniSound.playBgmForReply('조용한 밤 거리.', []));
    assert.equal(await bgmAsks(), ++bgmCount, 'no tag: the text picks');
    assert.equal((await bgmLast()).scene, '조용한 밤 거리.');
    await page.locator('#snd-bgm-basis').selectOption('message'); await page.waitForFunction(() => window.soundData().settings.bgmBasis === 'message');
    await page.evaluate(() => window.omniSound.playBgmForReply('다른 장면.', ['tense']));
    assert.equal(await bgmAsks(), ++bgmCount, 'always the text');
    assert.equal((await bgmLast()).bgm_tags, undefined, 'without the tags');
    await page.locator('#snd-bgm-basis').selectOption('both'); await page.waitForFunction(() => window.soundData().settings.bgmBasis === 'both');
    await page.evaluate(() => window.omniSound.playBgmForReply('세 번째 장면.', ['tense', 'chase', 'fast']));
    assert.equal(await bgmAsks(), ++bgmCount);
    assert.deepEqual([(await bgmLast()).scene, (await bgmLast()).bgm_tags], ['세 번째 장면.', 'tense, chase, fast'], 'the text with its tags as a hint');
    await page.evaluate(() => window.omniSound.playBgmForReply('세 번째 장면.', ['tense', 'chase', 'fast']));
    assert.equal(await bgmAsks(), bgmCount, 'the same reply is asked once');
    await page.evaluate(() => { window.soundData().settings.bgmEnabled = false; });
    assert.equal(await page.evaluate(() => window.omniSound.playBgmForReply('네 번째 장면.', [])), '', 'BGM off: nothing picks or plays');
    assert.equal(await bgmAsks(), bgmCount);
    // 「LLM에게 시키기」 on the effect list: one request proposes renames, folders, tags and adds; only ticked rows apply.
    await page.locator('#tab-sound-sfx').click();
    const sfxBefore = await page.evaluate(() => window.soundData().sfx.map(item => ({ key: item.key, name: item.name, folder: item.folder })));
    await page.evaluate(() => { window.llmAnswer = JSON.stringify({ folders: ['타격'], edit: [[1, '문 세게 닫힘', '타격', ['쾅', '문']], [2, null, '타격', null]], add: [{ name: '총소리', folder: '타격', tags: ['탕'], url: 'https://snd.test/gun.mp3' }] }); });
    await page.locator('#snd-sfx-llm').click();
    await page.locator('#llm-command-request').fill('타격음 폴더로 정리해 줘');
    await page.locator('#llm-command-source').fill('총소리 https://snd.test/gun.mp3');
    await page.locator('#llm-command-run').click();
    await page.waitForFunction(() => document.querySelectorAll('#llm-command-results input[data-row]').length === 3);
    assert.ok(await page.evaluate(() => JSON.stringify(window.llmAsked.at(-1)).includes('타격음 폴더로 정리해 줘')), 'the request goes to the model');
    assert.equal(await page.evaluate(() => window.soundData().sfx[0].name), sfxBefore[0].name, 'a proposal changes nothing by itself');
    await page.locator('#llm-command-results input[data-row]').nth(1).uncheck();
    await page.locator('#llm-command-apply').click();
    await page.waitForFunction(() => window.soundData().sfx[0].name === '문 세게 닫힘' && window.soundData().sfx.some(item => item.url === 'https://snd.test/gun.mp3'));
    assert.deepEqual(await page.evaluate(() => [window.soundData().sfx[0].folder, window.soundData().sfx[0].tags, window.soundData().folders.sfx.includes('타격')]), ['타격', ['쾅', '문'], true]);
    assert.equal(await page.evaluate(() => window.soundData().sfx[1].folder), sfxBefore[1].folder, 'the unticked row is left alone');
    assert.equal(await page.locator('#llm-command-dialog').isVisible(), false);
    // The glossary: which words go in which tile, the unknown words included.
    await page.evaluate(() => { window.soundData().unknownTerms = ['콰당']; window.llmAnswer = JSON.stringify({ tiles: [[null, 1, ['콰당', '쿵']]] }); });
    await page.locator('#tab-sound-glossary').click();
    await page.locator('#snd-term-llm').click();
    await page.locator('#llm-command-request').fill('미등록 용어를 알맞은 타일에 넣어 줘');
    assert.equal(await page.locator('#llm-command-source-wrap').isVisible(), false, 'nothing to paste for the glossary');
    await page.locator('#llm-command-run').click();
    await page.waitForFunction(() => document.querySelectorAll('#llm-command-results input[data-row]').length === 1);
    await page.locator('#llm-command-apply').click();
    await page.waitForFunction(() => window.soundData().glossary.some(row => row.sfxKey === window.soundData().sfx[0].key && row.terms.includes('콰당')) && !window.soundData().unknownTerms.includes('콰당'));
    // An effect's tile shows the glossary words that call it; its editor changes them.
    await page.locator('#tab-sound-sfx').click();
    const first = page.locator('#snd-sfx-list .voice-row').first();
    assert.match(await first.locator('.snd-row-words').getAttribute('title'), /콰당/, 'every word, past the six shown');
    await first.dblclick();
    assert.equal(await page.locator('#snd-item-terms').isVisible(), true);
    assert.match(await page.locator('#snd-item-terms').inputValue(), /콰당/);
    await page.locator('#snd-item-terms').fill('쿵쾅, 쾅쾅'); await page.locator('#snd-item-save').click();
    await page.waitForFunction(() => { const key = window.soundData().sfx[0].key, words = window.soundData().glossary.filter(row => row.sfxKey === key).flatMap(row => row.terms); return words.join(',') === '쿵쾅,쾅쾅'; });
    assert.ok(!(await page.evaluate(() => window.soundData().glossary.flatMap(row => row.terms))).includes('콰당'), 'a word taken out leaves the glossary');
    assert.match(await first.locator('.snd-row-words').textContent(), /쿵쾅, 쾅쾅/);
    // BGM keeps no glossary words.
    await page.locator('#tab-sound-bgm').click(); await page.locator('#snd-bgm-list .voice-row').first().dblclick();
    assert.equal(await page.locator('#snd-item-terms').isVisible(), false); await page.locator('#snd-item-cancel').click();
    // Dragging a tile onto a folder moves it there.
    await page.locator('#tab-sound-sfx').click();
    await page.evaluate(async () => { window.soundData().folders.sfx.push('드래그'); });
    await page.locator('#snd-sfx-search').fill(''); await page.locator('#snd-sfx-search').dispatchEvent('input');
    await first.dragTo(page.locator('#snd-sfx-folders .folder-item', { hasText: '드래그' }));
    await page.waitForFunction(() => window.soundData().sfx[0].folder === '드래그');
    // 「예제 불러오기」 adds the examples that are missing, once; the example music carries its credit.
    const bgmBefore = await page.evaluate(() => window.soundData().bgm.length);
    await page.locator('#tab-sound-bgm').click();
    await page.locator('#sound-bgm .file-menu summary').click(); await page.locator('#snd-bgm-samples').click();
    await page.waitForFunction(n => window.soundData().bgm.length > n + 100, bgmBefore);
    const bgmAfter = await page.evaluate(() => window.soundData().bgm.length);
    assert.match(await page.locator('#snd-bgm-list .snd-credit').textContent(), /Kevin MacLeod.*Attribution 4.0/);
    await page.locator('#snd-bgm-samples').click();
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => window.soundData().bgm.length), bgmAfter, 'a second time adds nothing');
    await page.locator('#tab-sound-sfx').click();
    // An unknown word that sounds like an effect's word is one tap from it.
    await page.evaluate(() => { window.soundData().unknownTerms = ['쿵콰앙']; });
    await page.locator('#tab-sound-glossary').click(); await page.locator('#snd-gloss-tab-unknown').click();
    const hint = page.locator('#snd-unknown .snd-hint').first();
    // Every suggestion has its own ▶, to hear it before connecting.
    const heard = await page.evaluate(() => window.played.length);
    await page.locator('#snd-unknown .snd-hint-play').first().click();
    await page.waitForFunction(n => window.played.length > n, heard);
    assert.equal(await page.evaluate(() => window.soundData().unknownTerms.includes('쿵콰앙')), true, 'hearing it connects nothing');
    assert.equal(await hint.getAttribute('data-key'), await page.evaluate(() => window.soundData().sfx[0].key));
    await hint.click();
    await page.waitForFunction(() => !window.soundData().unknownTerms.length && window.soundData().glossary.some(row => row.sfxKey === window.soundData().sfx[0].key && row.terms.includes('쿵콰앙')));
    // 다중선택: tick tiles, delete them at once; each tab keeps its own ticks.
    await page.evaluate(async () => { const d = window.soundData(); d.glossary.push({ id: 'm1', terms: ['하나'], sfxKey: d.sfx[0].key, enabled: true }, { id: 'm2', terms: ['둘'], sfxKey: d.sfx[0].key, enabled: true }, { id: 'm3', terms: ['셋'], sfxKey: d.sfx[0].key, enabled: true }); d.unknownTerms = ['가가', '나나', '다다']; });
    await page.locator('#snd-gloss-tab-terms').click(); await page.locator('#snd-term-search').fill(''); await page.locator('#snd-term-search').dispatchEvent('input');
    assert.equal(await page.locator('#snd-gloss-delete').isVisible(), false, 'no delete bar until 다중선택');
    await page.locator('#snd-gloss-multi').click();
    const termTile = id => page.locator(`#snd-terms .snd-term-tile[data-row="${id}"]`);
    await termTile('m1').locator('.snd-pick').check(); await termTile('m3').locator('.snd-pick').check();
    assert.equal(await page.locator('#snd-gloss-delete').textContent(), '2개 삭제');
    await page.locator('#snd-gloss-delete').click();
    await page.waitForFunction(() => { const ids = window.soundData().glossary.map(r => r.id); return !ids.includes('m1') && !ids.includes('m3') && ids.includes('m2'); });
    assert.equal(await page.locator('#snd-gloss-delete').textContent(), '선택 삭제', 'the ticks go with the deleted tiles');
    await page.locator('#snd-gloss-tab-unknown').click();
    await page.locator('#snd-gloss-all').click(); assert.equal(await page.locator('#snd-gloss-delete').textContent(), '3개 삭제', '전체 선택 ticks this tab only');
    await page.locator('#snd-unknown .snd-unknown-tile').filter({ hasText: '나나' }).locator('.snd-pick').uncheck();
    await page.locator('#snd-gloss-delete').click();
    await page.waitForFunction(() => window.soundData().unknownTerms.join(',') === '나나');
    await page.locator('#snd-gloss-multi').click();
    assert.equal(await page.locator('#snd-unknown .snd-pick').count(), 0, 'leaving 다중선택 takes the checkboxes away');
    assert.equal(await page.locator('#snd-gloss-delete').isVisible(), false);
    // Settings: a section is greyed out and locked while its switch is off.
    await page.locator('#tab-sound-settings').click();
    const gate = async id => page.evaluate(g => { const node = document.getElementById(g); return [node.disabled, Number(getComputedStyle(node).opacity) < 1]; }, id);
    await page.locator('#snd-sfx-enabled').evaluate(n => { n.checked = false; n.dispatchEvent(new Event('change')); });
    // Greyed out once the short fade ends.
    await page.waitForFunction(() => { const node = document.getElementById('snd-sfx-gate'); return node.disabled && Number(getComputedStyle(node).opacity) < 0.5; });
    assert.deepEqual(await gate('snd-sfx-gate'), [true, true]);
    assert.equal(await page.locator('#snd-sfx-volume').isDisabled(), true); assert.equal(await page.locator('#snd-rule-add').isDisabled(), true, 'rules are locked too');
    assert.equal(await page.locator('#snd-sfx-enabled').isDisabled(), false, 'the switch itself stays usable');
    assert.equal((await gate('snd-bgm-gate'))[0], !(await page.evaluate(() => window.soundData().settings.bgmEnabled)), 'the BGM section follows its own switch only');
    // A change made elsewhere (⚡ turns BGM on) shows here at once.
    await page.evaluate(() => window.omniSound.player.stopBgm?.());
    await page.locator('#snd-bgm-enabled').evaluate(n => { n.checked = false; n.dispatchEvent(new Event('change')); });
    await page.waitForFunction(() => document.getElementById('snd-bgm-gate').disabled);
    await page.evaluate(() => window.updateSoundSettings({ bgmEnabled: true }));
    await page.waitForFunction(() => !document.getElementById('snd-bgm-gate').disabled && document.getElementById('snd-bgm-enabled').checked);
    // The settings as one JSON: no ElevenLabs key; loading it keeps this device's key and switches.
    // The embedding: a provider brings its own model; its key stays on this device.
    await page.locator('#snd-embed-provider').evaluate(n => { n.value = 'voyage'; n.dispatchEvent(new Event('change')); });
    await page.waitForFunction(() => window.soundData().settings.embed.provider === 'voyage' && window.soundData().settings.embed.model === 'voyage-3-lite');
    await page.locator('#snd-embed-key').evaluate(n => { n.value = 'vo-secret'; n.dispatchEvent(new Event('change')); });
    await page.waitForFunction(() => window.soundData().settings.embed.key === 'vo-secret');
    assert.equal(await page.locator('#snd-embed-endpoint').getAttribute('placeholder'), 'https://api.voyageai.com/v1/embeddings', 'the address field shows the default it uses');
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#snd-settings-export').click()]);
    const exported = JSON.parse(await (await import('node:fs/promises')).readFile(await download.path(), 'utf8'));
    assert.equal(exported.type, 'omnisound-settings'); assert.equal('elevenKey' in exported.settings, false, 'no key in a shareable file');
    assert.equal(exported.settings.sfxMaxSec, 60);
    const key = await page.evaluate(() => window.soundData().settings.elevenKey); assert.ok(key, 'a key is set on this device');
    assert.equal(exported.settings.embed.key, '', 'nor the embedding key');
    exported.settings = { ...exported.settings, sfxMaxSec: 4, bgmVolume: 0.3, bgmTags: ['calm', 'rain'], sfxEnabled: true, bgmEnabled: false, elevenKey: 'stolen' };
    await page.locator('#snd-settings-file').setInputFiles({ name: 'omnisound-settings.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(exported)) });
    await page.waitForFunction(() => window.soundData().settings.sfxMaxSec === 4);
    assert.deepEqual(await page.evaluate(() => { const s = window.soundData().settings; return [s.bgmVolume, s.bgmTags, s.sfxEnabled, s.bgmEnabled, s.elevenKey]; }), [0.3, ['calm', 'rain'], false, true, key], 'switches and key stay as they were');
    assert.deepEqual(await page.evaluate(() => [window.soundData().settings.embed.provider, window.soundData().settings.embed.key]), ['voyage', 'vo-secret'], 'the embedding key stays too');
    assert.deepEqual(await page.evaluate(() => [document.getElementById('snd-sfx-max').value, document.getElementById('snd-bgm-volume-value').textContent, document.getElementById('snd-bgm-tags').value]), ['4', '30%', 'calm, rain'], 'the page shows the loaded values');
    await page.locator('#snd-settings-file').setInputFiles({ name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{"type":"other"}') });
    await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => window.soundData().settings.sfxMaxSec), 4, 'another kind of file changes nothing');
    // The BGM list: a pick spins at once and is the current track before it plays; the bar names it.
    await page.locator('#tab-sound-bgm').click();
    // A track that is neither playing nor the last one played: only the fetch makes it current.
    const firstBgm = await page.evaluate(() => { const p = window.omniSound.player; return window.soundData().bgm.find(item => item.key !== p.bgmKey && item.name !== window.omniSound.bgmName()); });
    await page.evaluate(key => { window.omniSound.bgmLoading = key; window.omniSound.player.onChange(); }, firstBgm.key);
    await page.waitForFunction(() => document.querySelector('#snd-bgm-list .voice-row .snd-spin'));
    assert.ok(await page.locator('#snd-bgm-list .voice-row.playing').first().locator('.snd-spin').count(), 'the fetched track is the current tile');
    assert.equal(await page.evaluate(() => window.omniSound.bgmName()), firstBgm.name, 'and its name is the current one');
    await page.evaluate(() => { window.omniSound.bgmLoading = ''; window.omniSound.player.onChange(); });
    await page.waitForFunction(() => !document.querySelector('#snd-bgm-list .snd-spin'));
    if (!await page.locator('#snd-bgm-clear').isDisabled()) await page.locator('#snd-bgm-clear').click();
    assert.equal(await page.locator('#snd-bgm-prefetch').isDisabled(), true, '「미리 받기」 waits for a ticked track');
    await page.locator('#snd-bgm-list .voice-row').first().click();
    assert.equal(await page.locator('#snd-bgm-prefetch').isDisabled(), false, 'and acts on the ticked ones');
    assert.equal(await page.locator('#snd-sfx-prefetch').count(), 0, 'not on effects (small, fetched when heard)');
    // Settings: the device limit and its usage; effect length in halves of a second.
    await page.locator('#tab-sound-settings').click();
    assert.equal(await page.locator('#snd-bgm-cache').inputValue(), '200', 'BGM kept on this device: 200 MB by default');
    assert.match(await page.locator('#snd-bgm-cache-usage').textContent(), /곡 · [\d.]+ MB/);
    await page.locator('#snd-sfx-enabled').evaluate(n => { n.checked = true; n.dispatchEvent(new Event('change')); });
    await page.locator('#snd-sfx-max').fill('2.5'); await page.locator('#snd-sfx-max').dispatchEvent('change');
    await page.waitForFunction(() => window.soundData().settings.sfxMaxSec === 2.5);
    assert.equal(await page.locator('#snd-sfx-max').inputValue(), '2.5');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
