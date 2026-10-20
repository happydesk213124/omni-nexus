import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium } from 'playwright';

// 세션 작가의 노트 → 세션/캐릭터 tabs, the image preset as in 샷 태그 수정 (the one in use,
// tiles in a popup), and the shared note presets on both tabs. Mounted on a window shaped
// like openOmniNote's, with the backend answered in the page as the services answer.
const full = await readFile('dist/omninexus.js', 'utf8');
assert.ok(full.includes('__OMNI_NOTE_EXTRAS__?.mount?.({panel,title,content,footer,sid,characterId:scope.characterId||"",request:K,notePresetsChanged:'), 'the note window mounts the tabs');
assert.ok(full.includes('const ok=await save() && await (extras?.flush?.() ?? true);'), 'closing the note window saves the bot note');
assert.ok(full.includes('[["prefix","세션 작노 선행"],["suffix","세션 작노 후행"],["location","장소"]]'), 'the session fields say whose note they are');
const bundle = await build({ entryPoints: ['src/image-ui/note-extras.ts'], bundle: true, write: false, format: 'iife', globalName: 'NoteExtras' });
const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setContent('<html><body></body></html>');
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const mount = async (characterId = 'bot') => page.evaluate(async characterId => {
    document.body.innerHTML = '';
    const presets = [{ id: 'p-omni', name: 'Omni 기본' }, { id: 'p-water', name: '수채화' }, { id: 'p-anime', name: '애니' }];
    const state = {
      character: 'p-water', session: '', note: { prefix: 'bot before', suffix: '', preset_id: '' }, posts: [], fail: false, changed: 0,
      notePresets: [{ id: 'np-soft', name: '부드럽게', prefix: 'soft', suffix: 'grain' }, { id: 'np-dark', name: '어둡게', prefix: 'dark', suffix: '' }],
    };
    const name = id => presets.find(p => p.id === id)?.name || '';
    const describe = () => {
      const has = id => presets.some(p => p.id === id);
      const character = has(state.character) ? { id: state.character, source: 'character' } : { id: 'p-omni', source: 'omni' };
      const effective = state.session === 'omni' ? { id: 'p-omni', source: 'omni' } : has(state.session) ? { id: state.session, source: 'session' } : character;
      return { ok: true, character: state.character, session: state.session, omni: { id: 'p-omni', name: 'Omni 기본', source: 'omni' },
        character_effective: { ...character, name: name(character.id) }, effective: { ...effective, name: name(effective.id) }, presets };
    };
    const request = async (path, init) => {
      if (init) state.posts.push({ path, method: init.method, body: structuredClone(init.body) });
      if (state.fail) return { ok: false, error: { message: 'offline' } };
      if (path.startsWith('/v1/preset-bindings')) {
        if (init && 'session' in init.body) state.session = init.body.session;
        if (init && 'character' in init.body) state.character = init.body.character;
        return describe();
      }
      if (path.startsWith('/v1/character-author-note')) {
        if (init) state.note = { prefix: init.body.prefix, suffix: init.body.suffix, preset_id: init.body.preset_id };
        return { ok: true, ...state.note };
      }
      if (path === '/v1/session-author-note-presets') {
        if (init) state.notePresets = structuredClone(init.body.items);
        return { ok: true, items: structuredClone(state.notePresets) };
      }
      return null;
    };
    const root = document.createElement('div'); root.style.cssText = 'position:fixed;inset:0;z-index:100000;display:grid;place-items:center;padding:16px';
    const panel = document.createElement('div'); panel.style.cssText = 'box-sizing:border-box;width:min(700px,100%);max-height:min(960px,95vh);display:flex;flex-direction:column;overflow:hidden;background:#101620;color:#eee';
    const title = document.createElement('h3'); title.textContent = '세션 작가의 노트';
    const content = document.createElement('div'); content.id = 'session-content'; content.style.cssText = 'flex:0 1 auto;min-height:0;overflow-y:auto;padding:20px';
    content.innerHTML = '<div id="note-preset-group">노트 프리셋</div><textarea id="session-prefix"></textarea><div>옷 상태</div>';
    const footer = document.createElement('div'); footer.textContent = 'footer';
    panel.append(title, content, footer); root.append(panel); document.body.append(root);
    globalThis.noteState = state;
    globalThis.extras = NoteExtras.mountNoteExtras({ panel, title, content, footer, sid: 'risu_session', characterId, request, notePresetsChanged: () => { state.changed++; } });
    await new Promise(r => setTimeout(r, 50));
    return true;
  }, characterId);
  const head = () => page.locator('.onx-preset-head:visible').textContent();
  const combo = () => page.locator('.onx-combo:visible');
  const comboName = () => page.locator('.onx-combo:visible .onx-combo-name').textContent();
  const tiles = () => page.locator('.onx-spop .onx-tile span').allTextContents();
  const pressed = () => page.locator('.onx-spop .onx-tile[aria-pressed="true"] span').allTextContents();
  const lastPost = () => page.evaluate(() => noteState.posts.at(-1));

  await mount();
  // The window as it was, with tabs under the title and the session's image preset on top.
  assert.deepEqual(await page.locator('[role="tab"]').allTextContents(), ['세션', '캐릭터']);
  assert.equal(await page.locator('h3 + .onx-tabs').count(), 1, 'tabs sit right under the title');
  assert.equal(await page.locator('#session-content > .onx-preset:first-child').count(), 1, 'the preset opens the session tab');
  assert.equal(await page.locator('#note-preset-group').isVisible(), true, 'the old session note is all still there');
  // Only the preset in use shows, as 샷 태그 수정 shows it; the tiles wait for a press.
  assert.equal(await comboName(), '🎨수채화');
  assert.equal(await head(), '세션 이미지 프리셋캐릭터 따라가기');
  assert.equal(await page.locator('.onx-tile').count(), 0, 'no tiles until the box is pressed');

  await combo().click();
  assert.deepEqual(await tiles(), ['캐릭터 따라가기', 'Omni 따라가기', 'Omni 기본', '수채화', '애니'], 'follow tiles in place of ＋');
  assert.deepEqual(await pressed(), ['캐릭터 따라가기']);
  const below = await page.evaluate(() => document.querySelector('.onx-spop-card').getBoundingClientRect().top - document.querySelector('.onx-combo').getBoundingClientRect().bottom);
  assert.ok(below >= 0 && below < 12, `the popup opens right under the box: ${below}`);

  // Picking a tile saves the session's choice, closes the popup and shows what now applies.
  await page.locator('.onx-spop .onx-tile', { hasText: '애니' }).click();
  assert.equal(await page.locator('.onx-spop').count(), 0, 'picking closes the popup');
  await page.waitForFunction(() => document.querySelector('.onx-combo-name')?.textContent.includes('애니'));
  assert.equal(await head(), '세션 이미지 프리셋이 세션');
  assert.deepEqual(await lastPost(), { path: '/v1/preset-bindings', method: 'POST', body: { character_id: 'bot', session_id: 'risu_session', session: 'p-anime' } });
  await combo().click();
  await page.locator('.onx-spop .onx-tile', { hasText: 'Omni 따라가기' }).click();
  await page.waitForFunction(() => document.querySelector('.onx-combo-name')?.textContent.includes('Omni 기본'));
  assert.equal(await head(), '세션 이미지 프리셋Omni 따라가기');

  // The backdrop and Esc close it without saving anything.
  const posts = await page.evaluate(() => noteState.posts.length);
  await combo().click();
  await page.mouse.click(5, 5);
  assert.equal(await page.locator('.onx-spop').count(), 0, 'the backdrop closes');
  await combo().click();
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.onx-spop').count(), 0, 'Esc closes');
  assert.equal(await page.evaluate(() => noteState.posts.length), posts, 'closing picks nothing');

  // The bot tab: Omni is its only follow tile; its fields say whose note they are.
  await page.locator('[role="tab"]', { hasText: '캐릭터' }).click();
  assert.equal(await page.locator('#session-content').isVisible(), false);
  assert.equal(await comboName(), '🎨수채화');
  assert.equal(await head(), '캐릭터 이미지 프리셋이 캐릭터');
  await combo().click();
  assert.deepEqual(await tiles(), ['Omni 따라가기', 'Omni 기본', '수채화', '애니']);
  assert.deepEqual(await pressed(), ['수채화']);
  await page.keyboard.press('Escape');
  assert.deepEqual(await page.locator('.onx-char-note label').evaluateAll(ls => ls.map(l => l.firstChild.textContent)), ['캐릭터 작노 선행', '캐릭터 작노 후행']);
  assert.equal(await page.locator('.onx-char-note textarea').first().inputValue(), 'bot before');

  // The note presets, the same list as the session tab's: picking fills both fields.
  const select = page.locator('.onx-note-presets select');
  assert.deepEqual(await select.locator('option').allTextContents(), ['프리셋 선택', '부드럽게', '어둡게']);
  await select.selectOption('np-soft');
  assert.equal(await page.locator('.onx-char-note textarea').first().inputValue(), 'soft');
  assert.equal(await page.locator('.onx-char-note textarea').nth(1).inputValue(), 'grain');
  assert.equal(await page.locator('.onx-note-presets input').inputValue(), '부드럽게');
  // 프리셋 저장 rewrites the picked one, as on the session tab, and the session tab hears of it.
  await page.locator('.onx-char-note textarea').first().fill('soft, bot');
  await page.locator('.onx-note-presets input').fill('봇 전용');
  await page.locator('.onx-note-presets button', { hasText: '프리셋 저장' }).click();
  await page.waitForFunction(() => noteState.changed === 1);
  const shared = await page.evaluate(() => noteState.notePresets);
  assert.deepEqual(shared.map(p => p.name), ['어둡게', '봇 전용']);
  assert.deepEqual(shared.at(-1), { id: 'np-soft', name: '봇 전용', prefix: 'soft, bot', suffix: 'grain' });
  assert.equal(await select.inputValue(), shared.at(-1).id);

  // Leaving the tab saves the note with the preset it came from.
  await page.locator('[role="tab"]', { hasText: '세션' }).click();
  await page.waitForFunction(() => document.getElementById('session-content').offsetParent !== null);
  assert.deepEqual(await lastPost(), { path: '/v1/character-author-note', method: 'POST', body: { character_id: 'bot', prefix: 'soft, bot', suffix: 'grain', preset_id: shared.at(-1).id } });
  const before = await page.evaluate(() => noteState.posts.length);
  assert.equal(await page.evaluate(() => extras.flush()), true);
  assert.equal(await page.evaluate(() => noteState.posts.length), before, 'an unchanged note writes nothing');

  // A preset the session tab removed meanwhile is gone when the bot tab comes back.
  await page.evaluate(() => { noteState.notePresets = noteState.notePresets.filter(p => p.id !== 'np-dark'); });
  await page.locator('[role="tab"]', { hasText: '캐릭터' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.onx-note-presets option').length === 2);
  assert.deepEqual(await select.locator('option').allTextContents(), ['프리셋 선택', '봇 전용']);

  // A failed save keeps the window open (flush answers false) and says why.
  await page.locator('.onx-char-note textarea').nth(1).fill('after');
  await page.evaluate(() => { noteState.fail = true; });
  assert.equal(await page.evaluate(() => extras.flush()), false);
  assert.match(await page.locator('.onx-char .onx-muted').last().textContent(), /저장 실패/);

  // No bot known: no bot tab.
  await mount('');
  assert.equal(await page.locator('[role="tab"]', { hasText: '캐릭터' }).isVisible(), false);

  // A phone: the popup stays on screen and lays the tiles out in a grid.
  await page.setViewportSize({ width: 390, height: 844 });
  await mount();
  await combo().click();
  const pop = await page.locator('.onx-spop-card').evaluate(el => {
    const r = el.getBoundingClientRect(), t = [...el.querySelectorAll('.onx-tile')].map(b => b.getBoundingClientRect());
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, perRow: t.filter(b => b.top === t[0].top).length, tile: t[0].width };
  });
  assert.ok(pop.left >= 0 && pop.right <= 390 && pop.top >= 0 && pop.bottom <= 844, `the popup fits a phone: ${JSON.stringify(pop)}`);
  assert.ok(pop.perRow >= 3 && pop.tile >= 70, `a grid of tiles big enough to tap: ${JSON.stringify(pop)}`);
  assert.deepEqual(errors, []);
  console.log('Note extras: tabs, preset box with tile popup, follow tiles, session and bot presets, shared note presets, bot note saves on leaving and on close, phone popup passed.');
} finally { await browser.close(); }
