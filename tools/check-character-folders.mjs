import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

// 폴더 in the real settings bundle's 캐릭터 tab: nothing shows until one is made; a folder is made with the looks its
// members share; a tile is filed by dragging it onto a folder (mouse, or a held finger) and taken out by dragging it
// onto 📁 전체; 선택 → 폴더로 files several; a search looks through every folder; a deleted folder frees its members.
const full = await readFile('dist/omninexus.js', 'utf8');
const seam = '  await Qa();';
assert.equal(full.split(seam).length, 2, 'bundle boot seam must match exactly once');
const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
try {
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1280, height: 860 });
  page.on('dialog', dialog => dialog.accept());
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('about:blank');
  await page.evaluate(() => {
    const kv = new Map();
    globalThis.stored = key => structuredClone(kv.get(key));
    const roster = ['Alpha', 'Beta', 'Gamma', 'Delta'].map(name => ({ id: name.toLowerCase(), name, aliases: [name], appearance: 'girl, red hair', schema_version: 2 }));
    let character = { chaId: 'folder-bot', name: 'Folders', chats: [{ id: 'chat', message: [] }],
      globalLore: [{ comment: 'omni.nexus.data.global', key: '', secondkey: '', alwaysActive: false, selective: false, mode: 'normal', insertorder: 0,
        content: JSON.stringify({ version: 1, characterId: 'folder-bot', roster }) }] };
    let modules = [{ id: 'inlay-inray-display', namespace: 'inlay.inray_display', lorebook: [], assets: [] }];
    globalThis.rosterNow = () => JSON.parse(character.globalLore.find(e => e.comment === 'omni.nexus.data.global').content).roster;
    globalThis.risuai = {
      pluginStorage: { getItem: async k => kv.get(k), setItem: async (k, v) => kv.set(k, v), removeItem: async k => kv.delete(k) },
      getArgument: async () => '', getDatabase: async () => ({ characters: [structuredClone(character)], modules: structuredClone(modules) }),
      setDatabase: async db => { if (db.modules) modules = structuredClone(db.modules); },
      getCharacterFromIndex: async () => structuredClone(character), setCharacterToIndex: async (_i, c) => { character = structuredClone(c); },
      getChatFromIndex: async () => structuredClone(character.chats[0]), getCharacter: async () => structuredClone(character),
      getCurrentCharacterIndex: async () => 0, getCurrentChatIndex: async () => 0,
    };
  });
  await page.addScriptTag({ type: 'module', content: full.replace(seam, 'await le();await ia();t.lastScope=await Z();t.uiOpen=true;t.uiTab="characters";globalThis.folderRuntime={t,paint:P,refresh:ce};await ce();await P();') });
  await page.waitForFunction(() => !!globalThis.folderRuntime);
  const tile = name => page.locator(`[data-ux-character-tile]:has([data-character-label]:text-is("${name}"))`);
  const folderTile = name => page.locator(`[data-ux-folder]:has([data-folder-name]:text-is("${name}"))`);
  await tile('Alpha').waitFor();
  const shown = () => page.evaluate(() => [...document.querySelectorAll('#nx-char-session-list [data-ux-character-tile]')].filter(t => t.getClientRects().length).map(t => t.querySelector('[data-character-label]').textContent).sort());
  const folders = () => page.evaluate(() => stored('onx_folders')?.characters?.['folder-bot'] ?? null);
  const saved = async want => { await page.waitForFunction(w => JSON.stringify(stored('onx_folders')?.characters?.['folder-bot'] ?? null) === w, JSON.stringify(want)); };
  const center = async locator => { const b = await locator.boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };
  const drag = async (from, to) => {
    const [x, y] = await center(from), [tx, ty] = await center(to);
    await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(x + 12, y + 8, { steps: 3 }); await page.mouse.move(tx, ty, { steps: 6 });
    assert.equal(await page.locator('.nx-drag-ghost').count(), 1, 'a ghost follows the pointer');
    assert.equal(await page.evaluate(([px, py]) => !!document.elementFromPoint(px, py)?.closest('.nx-drop'), [tx, ty]), true, 'the place under the pointer lights up');
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains('nx-tile-drag')), true, 'the places to drop are lit for as long as the drag lasts');
    // What is dragged is a copy of the tile with nothing to find it by.
    assert.equal(await page.evaluate(() => { const g = document.querySelector('.nx-drag-ghost'); return g.matches('[data-ux-character-tile]') || !!g.querySelector('[id], [data-character-label]'); }), false);
    await page.mouse.up();
    await page.waitForFunction(() => !document.querySelector('.nx-drag-ghost') && !document.querySelector('.nx-dragging') && !document.documentElement.classList.contains('nx-tile-drag'));
  };

  // No folder yet: the tab is as it was before folders.
  assert.equal(await page.locator('#nx-char-folder-path .nx-folder-path:not([hidden])').count(), 0, 'no path bar');
  assert.equal(await page.locator('[data-ux-folder]').count(), 0);
  assert.deepEqual(await shown(), ['Alpha', 'Beta', 'Delta', 'Gamma']);
  assert.equal(await folders(), null);

  // 📁 새 폴더: a name and the looks its members share.
  await page.locator('#nx-char-new-folder').click();
  await page.locator('#nx-folder-pop [data-folder-save]').click();
  assert.equal(await page.locator('#nx-folder-pop').count(), 1, 'a folder needs a name');
  await page.locator('#nx-folder-pop [data-folder-field="name"]').fill('네일샵 직원');
  await page.locator('#nx-folder-pop [data-folder-field="attire"]').fill('black nail salon apron');
  await page.locator('#nx-folder-pop [data-folder-field="appearance"]').fill('friendly look');
  await page.locator('#nx-folder-pop [data-folder-field="memo"]').fill('네일샵에서 일하는 직원들');
  assert.match(await page.locator('#nx-folder-pop .nx-folder-hint').textContent(), /비워 두면 이 폴더는 LLM에게 알리지 않습니다/);
  assert.match(await page.locator('#nx-folder-pop .nx-folder-looks > header').textContent(), /샷을 만들 때 이 폴더의 캐릭터에게 함께 들어갑니다/);
  assert.equal(await page.locator('#nx-folder-pop [data-folder-remove]').count(), 0, 'a new folder has nothing to delete');
  // The sheet fits the screen with its buttons in reach.
  assert.equal(await page.evaluate(() => { const r = document.querySelector('#nx-folder-pop [data-folder-save]').getBoundingClientRect(); return r.bottom <= innerHeight && r.top >= 0; }), true);
  await page.locator('#nx-folder-pop [data-folder-save]').click();
  await folderTile('네일샵 직원').waitFor();
  const [made] = await folders();
  assert.deepEqual({ ...made, id: '' }, { id: '', name: '네일샵 직원', members: [], appearance: 'friendly look', attire: 'black nail salon apron', memo: '네일샵에서 일하는 직원들' });
  assert.equal(await folderTile('네일샵 직원').getAttribute('data-folder-memo'), '1', 'a folder the LLM fills is marked');
  assert.equal(await page.locator('#nx-char-folder-path .nx-folder-path:not([hidden])').count(), 1, 'the path bar is there now');
  assert.equal(await page.evaluate(() => document.querySelector('#nx-char-session-list').firstElementChild.matches('[data-ux-folder]')), true, 'folders stand first in the grid');
  // The vendor reads every [data-char-scope] node as a character: a folder must never be one.
  assert.equal(await page.evaluate(() => document.querySelectorAll('[data-ux-folder][data-char-scope], [data-ux-folder].char-card').length), 0);

  // Dragging a tile onto the folder files it; the roster itself is not written.
  const rosterBefore = await page.evaluate(() => JSON.stringify(rosterNow()));
  await drag(tile('Alpha'), folderTile('네일샵 직원'));
  await saved([{ ...made, members: ['alpha'] }]);
  assert.deepEqual(await shown(), ['Beta', 'Delta', 'Gamma'], 'a filed character leaves 전체');
  assert.match(await folderTile('네일샵 직원').textContent(), /1개/);
  assert.equal(await page.locator('#nx-char-sheet.open').count(), 0, 'the release that ends a drag opens no editor');
  assert.equal(await page.evaluate(() => JSON.stringify(rosterNow())), rosterBefore, 'filing rewrites no character');

  // Opening the folder: its members only, the choice moved into it, a way back.
  await folderTile('네일샵 직원').click();
  assert.deepEqual(await shown(), ['Alpha']);
  assert.equal(await page.locator('[data-folder-scope="session"] [data-folder-current]').textContent(), '네일샵 직원');
  assert.equal(await page.locator('#nx-char-current').textContent(), 'Alpha', 'the chosen character is one that is shown');
  assert.equal(await page.locator('[data-ux-folder]').count(), 0);
  // 폴더 수정 keeps its members.
  await page.locator('[data-folder-scope="session"] [data-folder-edit]').click();
  assert.equal(await page.locator('#nx-folder-pop [data-folder-field="attire"]').inputValue(), 'black nail salon apron');
  await page.locator('#nx-folder-pop [data-folder-field="attire"]').fill('white apron');
  await page.locator('#nx-folder-pop [data-folder-save]').click();
  await saved([{ ...made, members: ['alpha'], attire: 'white apron' }]);
  // A folder's own menu: a right-click (a held finger on a phone) on its tile.
  await page.locator('[data-folder-scope="session"] [data-folder-crumb]').click();
  await folderTile('네일샵 직원').click({ button: 'right' });
  assert.deepEqual(await page.locator('.nx-folder-menu:not([hidden]) button').allTextContents(), ['열기', '폴더 수정', '폴더 삭제']);
  assert.equal(await page.locator('.nx-folder-menu:not([hidden]) [data-fm-title]').textContent(), '📁 네일샵 직원');
  await page.locator('.nx-folder-menu:not([hidden]) [data-fm="edit"]').click();
  assert.equal(await page.locator('#nx-folder-pop [data-folder-field="name"]').inputValue(), '네일샵 직원');
  assert.equal(await page.locator('#nx-folder-pop [data-folder-remove]').count(), 1, 'the sheet of a saved folder can delete it');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#nx-folder-pop').count(), 0, 'Esc closes the sheet, saving nothing');
  // A held finger opens the same menu, and the release that ends the hold does not open the folder.
  await page.evaluate(async () => {
    const folder = document.querySelector('#nx-char-session-list [data-ux-folder]'), r = folder.getBoundingClientRect(), p = { clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 };
    const fire = (type, live) => folder.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches: live ? [new Touch({ identifier: 1, target: folder, ...p })] : [], changedTouches: [new Touch({ identifier: 1, target: folder, ...p })] }));
    fire('touchstart', true);
    await new Promise(done => setTimeout(done, 1950));
    fire('touchend', false);
    folder.click();
  });
  assert.equal(await page.locator('.nx-folder-menu:not([hidden])').isVisible(), true, 'the hold opened the menu');
  assert.equal(await page.locator('[data-folder-scope="session"] [data-folder-current]').count(), 0, 'and the folder stayed closed');
  await page.waitForTimeout(450);
  await page.locator('.nx-folder-menu:not([hidden]) [data-fm="open"]').click();
  assert.equal(await page.locator('[data-folder-scope="session"] [data-folder-current]').textContent(), '네일샵 직원');
  // Dragged onto 📁 전체: out of the folder.
  await drag(tile('Alpha'), page.locator('[data-folder-scope="session"] [data-folder-crumb]'));
  await saved([{ ...made, members: [], attire: 'white apron' }]);
  assert.match(await page.locator('[data-folder-scope="session"] .nx-folder-empty').textContent(), /빈 폴더/);
  await page.locator('[data-folder-scope="session"] [data-folder-crumb]').click();
  assert.deepEqual(await shown(), ['Alpha', 'Beta', 'Delta', 'Gamma']);

  // A held finger drags too (a quick swipe would scroll).
  await page.evaluate(async ([from, to]) => {
    const tile = [...document.querySelectorAll('[data-ux-character-tile]')].find(t => t.textContent === from), folder = document.querySelector(to);
    const at = el => { const r = el.getBoundingClientRect(); return { clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 }; };
    const touch = (el, p) => new Touch({ identifier: 1, target: el, ...p });
    const fire = (type, el, p, live = true) => el.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches: live ? [touch(el, p)] : [], changedTouches: [touch(el, p)] }));
    fire('touchstart', tile, at(tile));
    await new Promise(r => setTimeout(r, 480));
    fire('touchmove', tile, at(folder));
    fire('touchend', tile, at(folder), false);
  }, ['Beta', '[data-ux-folder]']);
  await saved([{ ...made, members: ['beta'], attire: 'white apron' }]);

  // 선택 → 폴더로: several at once, into a folder made on the way.
  await page.locator('#nx-char-select').click();
  await tile('Gamma').click(); await tile('Delta').click();
  await page.locator('#nx-char-select-bar [data-sel="folder"]').click();
  assert.deepEqual(await page.locator('#nx-folder-pick [data-folder-choice] span').allTextContents(), ['📁 전체 (폴더 밖)', '네일샵 직원']);
  await page.locator('#nx-folder-pick [data-folder-choice-new]').click();
  await page.locator('#nx-folder-pop [data-folder-field="name"]').fill('학교');
  await page.locator('#nx-folder-pop [data-folder-save]').click();
  await page.waitForFunction(() => stored('onx_folders')?.characters?.['folder-bot']?.length === 2);
  assert.deepEqual((await folders()).map(f => [f.name, f.members]), [['네일샵 직원', ['beta']], ['학교', ['gamma', 'delta']]]);
  await page.locator('#nx-char-select').click();
  assert.deepEqual(await shown(), ['Alpha']);

  // A search looks through every folder; cleared, the folders are back.
  await page.locator('#nx-char-search').fill('gamma');
  assert.deepEqual(await shown(), ['Gamma']);
  assert.equal(await page.locator('[data-ux-folder]').count(), 0);
  assert.match(await page.locator('[data-folder-scope="session"] .nx-folder-crumbs').textContent(), /검색 결과/);
  await page.locator('#nx-char-search').fill('');
  assert.equal(await page.locator('[data-ux-folder]').count(), 2);

  // ⋯ → 폴더로 이동…: the chosen character, to a folder by name.
  await tile('Alpha').click({ button: 'right' });
  await page.locator('#nx-char-to-folder').click();
  await page.locator('#nx-folder-pick [data-folder-choice]', { hasText: '학교' }).click();
  await page.waitForFunction(() => stored('onx_folders').characters['folder-bot'][1].members.includes('alpha'));

  // A deleted folder frees its members; the characters stay.
  await folderTile('학교').click();
  assert.deepEqual(await shown(), ['Alpha', 'Delta', 'Gamma']);
  await page.locator('[data-folder-scope="session"] [data-folder-delete]').click();
  await page.waitForFunction(() => stored('onx_folders').characters['folder-bot'].length === 1);
  assert.deepEqual(await shown(), ['Alpha', 'Delta', 'Gamma'], 'back in 전체, with Beta still filed');
  assert.equal(await page.evaluate(() => rosterNow().length), 4, 'no character was deleted');
  assert.deepEqual(errors, []);
  console.log('[character folders] PASS: none until made, shared looks on the folder, mouse and held-finger drags in and out, 선택 → 폴더로, search across folders, ⋯ → 폴더로 이동, delete frees members');
} finally {
  await browser.close();
}
