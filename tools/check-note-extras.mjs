import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium } from 'playwright';

// 세션 작가의 노트 → 세션/캐릭터 tabs and preset tiles, mounted on a window shaped like
// openOmniNote's, with the backend answered in the page as the services answer.
const full = await readFile('dist/omninexus.js', 'utf8');
assert.ok(full.includes('__OMNI_NOTE_EXTRAS__?.mount?.({panel,title,content,footer,sid,characterId:scope.characterId||"",request:K})'), 'the note window mounts the tabs');
assert.ok(full.includes('const ok=await save() && await (extras?.flush?.() ?? true);'), 'closing the note window saves the bot note');
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
    const state = { character: 'p-water', session: '', note: { prefix: 'bot before', suffix: '' }, posts: [], fail: false };
    const name = id => presets.find(p => p.id === id)?.name || '';
    const describe = () => {
      const has = id => presets.some(p => p.id === id);
      const character = has(state.character) ? { id: state.character, source: 'character' } : { id: 'p-omni', source: 'omni' };
      const effective = state.session === 'omni' ? { id: 'p-omni', source: 'omni' } : has(state.session) ? { id: state.session, source: 'session' } : character;
      return { ok: true, character: state.character, session: state.session, omni: { id: 'p-omni', name: 'Omni 기본', source: 'omni' },
        character_effective: { ...character, name: name(character.id) }, effective: { ...effective, name: name(effective.id) }, presets };
    };
    const request = async (path, init) => {
      if (init) state.posts.push({ path, body: structuredClone(init.body) });
      if (state.fail) return { ok: false, error: { message: 'offline' } };
      if (path.startsWith('/v1/preset-bindings')) {
        if (init && 'session' in init.body) state.session = init.body.session;
        if (init && 'character' in init.body) state.character = init.body.character;
        return describe();
      }
      if (path.startsWith('/v1/character-author-note')) {
        if (init) state.note = { prefix: init.body.prefix, suffix: init.body.suffix };
        return { ok: true, ...state.note };
      }
      return null;
    };
    const root = document.createElement('div'); root.style.cssText = 'position:fixed;inset:0;display:grid;place-items:center;padding:16px';
    const panel = document.createElement('div'); panel.style.cssText = 'box-sizing:border-box;width:min(700px,100%);max-height:min(960px,95vh);display:flex;flex-direction:column;overflow:hidden;background:#101620;color:#eee';
    const title = document.createElement('h3'); title.textContent = '세션 작가의 노트';
    const content = document.createElement('div'); content.id = 'session-content'; content.style.cssText = 'flex:0 1 auto;min-height:0;overflow-y:auto;padding:20px';
    content.innerHTML = '<div id="note-preset-group">노트 프리셋</div><textarea id="session-prefix"></textarea><div>옷 상태</div>';
    const footer = document.createElement('div'); footer.textContent = 'footer';
    panel.append(title, content, footer); root.append(panel); document.body.append(root);
    globalThis.noteState = state;
    globalThis.extras = NoteExtras.mountNoteExtras({ panel, title, content, footer, sid: 'risu_session', characterId, request });
    await new Promise(r => setTimeout(r, 50));
    return true;
  }, characterId);
  const heads = () => page.locator('.onx-preset-head:visible').allTextContents();
  const tiles = () => page.locator('.onx-tiles:visible .onx-tile span').allTextContents();
  const pressed = () => page.locator('.onx-tiles:visible .onx-tile[aria-pressed="true"] span').allTextContents();

  await mount();
  // The window as it was, with tabs under the title and the session's preset on top.
  assert.deepEqual(await page.locator('[role="tab"]').allTextContents(), ['세션', '캐릭터']);
  assert.equal(await page.locator('h3 + .onx-tabs').count(), 1, 'tabs sit right under the title');
  assert.equal(await page.locator('#session-content > .onx-preset:first-child').count(), 1, 'the preset bar opens the session tab');
  assert.equal(await page.locator('#note-preset-group').isVisible(), true, 'the old session note is all still there');
  assert.deepEqual(await tiles(), ['캐릭터 따라가기', 'Omni 따라가기', 'Omni 기본', '수채화', '애니'], 'follow tiles in place of ＋');
  assert.deepEqual(await pressed(), ['캐릭터 따라가기']);
  assert.match((await heads())[0], /지금 적용:수채화\(캐릭터 따라가기\)/);

  // Picking a tile saves the session's choice and says what now applies.
  await page.locator('.onx-tiles:visible .onx-tile', { hasText: '애니' }).click();
  await page.waitForFunction(() => document.querySelector('.onx-preset-head')?.textContent.includes('애니(이 세션)'));
  assert.deepEqual(await page.evaluate(() => noteState.posts.at(-1)), { path: '/v1/preset-bindings', body: { character_id: 'bot', session_id: 'risu_session', session: 'p-anime' } });
  await page.locator('.onx-tiles:visible .onx-tile', { hasText: 'Omni 따라가기' }).click();
  await page.waitForFunction(() => document.querySelector('.onx-preset-head')?.textContent.includes('Omni 기본(Omni 따라가기)'));

  // The bot tab: Omni is its only follow tile; its note saves when the tab is left.
  await page.locator('[role="tab"]', { hasText: '캐릭터' }).click();
  assert.equal(await page.locator('#session-content').isVisible(), false);
  assert.deepEqual(await tiles(), ['Omni 따라가기', 'Omni 기본', '수채화', '애니']);
  assert.deepEqual(await pressed(), ['수채화']);
  assert.match((await heads())[0], /지금 적용:수채화\(이 캐릭터\)/);
  assert.equal(await page.locator('.onx-char-note textarea').first().inputValue(), 'bot before');
  await page.locator('.onx-char-note textarea').first().fill('bot rewritten');
  await page.locator('[role="tab"]', { hasText: '세션' }).click();
  await page.waitForFunction(() => document.getElementById('session-content').offsetParent !== null);
  assert.deepEqual(await page.evaluate(() => noteState.posts.at(-1)), { path: '/v1/character-author-note', body: { character_id: 'bot', prefix: 'bot rewritten', suffix: '' } });
  assert.equal(await page.evaluate(() => extras.flush()), true, 'nothing left to save');
  const before = await page.evaluate(() => noteState.posts.length);
  assert.equal(await page.evaluate(() => extras.flush()), true);
  assert.equal(await page.evaluate(() => noteState.posts.length), before, 'an unchanged note writes nothing');

  // A failed save keeps the window open (flush answers false) and says why.
  await page.locator('[role="tab"]', { hasText: '캐릭터' }).click();
  await page.locator('.onx-char-note textarea').nth(1).fill('after');
  await page.evaluate(() => { noteState.fail = true; });
  assert.equal(await page.evaluate(() => extras.flush()), false);
  assert.match(await page.locator('.onx-char .onx-muted').last().textContent(), /저장 실패/);

  // No bot known: no bot tab.
  await mount('');
  assert.equal(await page.locator('[role="tab"]', { hasText: '캐릭터' }).isVisible(), false);

  // A phone: one row of tiles that scrolls sideways, never a wall of them.
  await page.setViewportSize({ width: 390, height: 844 });
  await mount();
  const row = await page.locator('.onx-tiles:visible').evaluate(el => ({ scroll: el.scrollWidth > el.clientWidth, height: el.getBoundingClientRect().height }));
  assert.ok(row.scroll && row.height < 140, `one sideways row on a phone: ${JSON.stringify(row)}`);
  assert.deepEqual(errors, []);
  console.log('Note extras: tabs, follow tiles, session and bot presets, bot note saves on leaving and on close, phone row passed.');
} finally { await browser.close(); }
