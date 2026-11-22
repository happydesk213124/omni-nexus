import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

// The 캐릭터 tab's tiles in the real settings bundle, arranged by hand: a tile dragged between two others is set down
// there (mouse, or a held finger), the picked move together in 선택 mode, folders reorder the same way, and a finger
// that holds a tile without carrying it anywhere gets the tile's menu (the bar's actions in 선택 mode).
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
    kv.set('onx_folders', { version: 1, characters: { 'order-bot': [{ id: 'fa', name: '학교', members: [] }, { id: 'fb', name: '회사', members: [] }] }, presets: [] });
    globalThis.stored = key => structuredClone(kv.get(key));
    const roster = ['Alpha', 'Beta', 'Delta', 'Gamma'].map(name => ({ id: name.toLowerCase(), name, aliases: [name], appearance: 'girl, red hair', schema_version: 2 }));
    let character = { chaId: 'order-bot', name: 'Order', chats: [{ id: 'chat', message: [] }],
      globalLore: [{ comment: 'omni.nexus.data.global', key: '', secondkey: '', alwaysActive: false, selective: false, mode: 'normal', insertorder: 0,
        content: JSON.stringify({ version: 1, characterId: 'order-bot', roster }) }] };
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
  await page.addScriptTag({ type: 'module', content: full.replace(seam, 'await le();await ia();t.lastScope=await Z();t.uiOpen=true;t.uiTab="characters";globalThis.orderRuntime={t,paint:P,refresh:ce};await ce();await P();') });
  await page.waitForFunction(() => !!globalThis.orderRuntime);
  const tile = name => page.locator(`#nx-char-session-list [data-ux-character-tile]:has([data-character-label]:text-is("${name}"))`);
  const folderTile = name => page.locator(`#nx-char-session-list [data-ux-folder]:has([data-folder-name]:text-is("${name}"))`);
  await tile('Alpha').waitFor(); await folderTile('학교').waitFor();
  /** What the grid shows, read as a reader would: by rows, left to right. */
  const visual = sel => page.evaluate(selector => [...document.querySelectorAll('#nx-char-session-list ' + selector)].filter(t => t.getClientRects().length)
    .map(t => ({ name: (t.querySelector('[data-character-label], [data-folder-name]')).textContent, r: t.getBoundingClientRect() }))
    .sort((a, b) => Math.abs(a.r.top - b.r.top) > 4 ? a.r.top - b.r.top : a.r.left - b.r.left).map(row => row.name), sel);
  const people = () => visual('[data-ux-character-tile]'), folders = () => visual('[data-ux-folder]');
  const order = () => page.evaluate(() => stored('onx_folders')?.order?.['order-bot'] ?? null);
  const settled = () => page.waitForFunction(() => !document.querySelector('.nx-drag-ghost') && !document.querySelector('.nx-dragging'));
  const at = async (locator, part) => { const b = await locator.boundingBox(); return [b.x + b.width * part, b.y + b.height / 2]; };
  /** A mouse drag from the middle of one tile to a point a `part` of the way across another (.15: its left edge, .85: its right). */
  const drag = async (from, to, part, during) => {
    const [x, y] = await at(from, .5), [tx, ty] = await at(to, part);
    await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(x + 12, y + 8, { steps: 3 }); await page.mouse.move(tx, ty, { steps: 6 });
    if (during) await during();
    await page.mouse.up(); await settled();
  };
  const rosterBefore = await page.evaluate(() => JSON.stringify(rosterNow()));

  // As the roster has them until someone arranges them; nothing is saved for that.
  assert.deepEqual(await people(), ['Alpha', 'Beta', 'Delta', 'Gamma']);
  assert.equal(await order(), null);
  assert.deepEqual(await folders(), ['학교', '회사']);

  // Set down before a tile, and after one: a bar on the side it will land.
  await drag(tile('Gamma'), tile('Alpha'), .15, async () => assert.equal(await tile('Alpha').evaluate(el => el.classList.contains('nx-insert-before')), true, 'a bar before the tile it lands beside'));
  await page.waitForFunction(() => stored('onx_folders')?.order?.['order-bot']?.[0] === 'gamma');
  assert.deepEqual(await order(), ['gamma', 'alpha', 'beta', 'delta']);
  assert.deepEqual(await people(), ['Gamma', 'Alpha', 'Beta', 'Delta']);
  await drag(tile('Alpha'), tile('Delta'), .85, async () => assert.equal(await tile('Delta').evaluate(el => el.classList.contains('nx-insert-after')), true));
  await page.waitForFunction(() => stored('onx_folders').order['order-bot'].at(-1) === 'alpha');
  assert.deepEqual(await people(), ['Gamma', 'Beta', 'Delta', 'Alpha']);
  assert.equal(await page.evaluate(() => JSON.stringify(rosterNow())), rosterBefore, 'arranging the tiles rewrites no character');
  assert.equal(await page.locator('#nx-char-sheet.open').count(), 0, 'a drag opens no editor');

  // 선택 mode: the picked move together, in the order they stood, under one copy with their number.
  await page.locator('#nx-char-select').click();
  await tile('Gamma').click(); await tile('Beta').click();
  await drag(tile('Gamma'), tile('Alpha'), .85, async () => {
    assert.equal(await page.locator('.nx-drag-ghost.nx-drag-many em').textContent(), '2');
    assert.equal(await tile('Beta').evaluate(el => el.classList.contains('nx-dragging')), true, 'the other picked tile is lifted with it');
  });
  await page.waitForFunction(() => stored('onx_folders').order['order-bot'].join() === 'delta,alpha,gamma,beta');
  assert.deepEqual(await people(), ['Delta', 'Alpha', 'Gamma', 'Beta']);
  // Onto a folder they are filed together.
  await drag(tile('Beta'), folderTile('회사'), .5);
  await page.waitForFunction(() => stored('onx_folders').characters['order-bot'].find(f => f.id === 'fb').members.length === 2);
  assert.deepEqual(await page.evaluate(() => stored('onx_folders').characters['order-bot'].find(f => f.id === 'fb').members.sort()), ['beta', 'gamma']);
  assert.deepEqual(await people(), ['Delta', 'Alpha']);

  // A finger held on a tile in 선택 mode: the tile joins the picked, and the bar's actions come up as a menu.
  const hold = (selector, ms, release = true) => page.evaluate(async ([sel, wait, lift]) => {
    const el = document.querySelector(sel), r = el.getBoundingClientRect(), p = { clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 };
    const fire = (type, live) => el.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches: live ? [new Touch({ identifier: 1, target: el, ...p })] : [], changedTouches: [new Touch({ identifier: 1, target: el, ...p })] }));
    fire('touchstart', true);
    await new Promise(done => setTimeout(done, wait));
    // Some browsers send a tap when a long press lets go: it must choose nothing.
    if (lift) { fire('touchend', false); el.click(); }
  }, [selector, ms, release]);
  await hold('#nx-char-session-list [data-ux-character-tile="delta"]', 1950);
  assert.equal(await tile('Delta').evaluate(el => el.classList.contains('nx-picked')), true, 'the held tile is picked');
  assert.equal(await page.locator('.nx-button-menu .nx-menu-title').textContent(), '1명 선택');
  assert.deepEqual(await page.locator('.nx-button-menu button').allTextContents(), ['비활성화', '활성화', '폴더로', 'LLM 명령', '참고컷 생성', 'vibe레퍼로', '전역 로스터로', '삭제']);
  await page.waitForTimeout(520);
  await page.locator('.nx-button-menu button', { hasText: '폴더로' }).click();
  await page.locator('#nx-folder-pick [data-folder-choice]', { hasText: '학교' }).click();
  await page.waitForFunction(() => stored('onx_folders').characters['order-bot'].find(f => f.id === 'fa').members.includes('delta'));
  assert.equal(await page.locator('.nx-button-menu').count(), 0, 'the menu is gone once it closes');
  await page.locator('#nx-char-select').click();

  // Out of 선택 mode a held finger gets the tile's own ⋯ menu: still down after a moment where it was lifted…
  // A ring fills on the lifted tile first; until it is full there is no menu, so a move is never cut short by one.
  await hold('#nx-char-session-list [data-ux-character-tile="alpha"]', 900, false);
  assert.equal(await page.locator('.nx-drag-ghost .nx-hold-ring').count(), 1, 'the ring is filling');
  assert.equal(await page.locator('#nx-char-more-menu').isHidden(), true, 'no menu yet');
  await page.waitForFunction(() => !document.getElementById('nx-char-more-menu').hidden, undefined, { timeout: 2500 });
  assert.equal(await page.locator('#nx-char-more-menu').isVisible(), true, 'the menu comes when the ring is full, the finger still down');
  assert.equal(await page.locator('#nx-char-more-title').textContent(), 'Alpha');
  await settled();
  await page.keyboard.press('Escape');
  // Let go before the ring is full: nothing at all. No menu, no editor, no move.
  await page.locator('[data-folder-scope="session"] [data-folder-crumb]').click();
  await folderTile('학교').click();
  await page.evaluate(async () => {
    const el = document.querySelector('#nx-char-session-list [data-ux-character-tile="delta"]'), r = el.getBoundingClientRect(), p = { clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 };
    const fire = (type, live) => el.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches: live ? [new Touch({ identifier: 1, target: el, ...p })] : [], changedTouches: [new Touch({ identifier: 1, target: el, ...p })] }));
    fire('touchstart', true); await new Promise(done => setTimeout(done, 700)); fire('touchend', false);
  });
  assert.equal(await page.locator('#nx-char-more-menu').isHidden(), true, 'let go early: no menu');
  assert.equal(await page.locator('#nx-char-sheet.open').count(), 0);
  await settled();
  await page.keyboard.press('Escape');
  await page.locator('[data-folder-scope="session"] [data-folder-crumb]').click();

  // Folders reorder the same way, among themselves.
  await drag(folderTile('회사'), folderTile('학교'), .15, async () => assert.equal(await folderTile('학교').evaluate(el => el.classList.contains('nx-insert-before')), true));
  await page.waitForFunction(() => stored('onx_folders').characters['order-bot'][0].id === 'fb');
  assert.deepEqual(await folders(), ['회사', '학교']);
  assert.deepEqual(await page.evaluate(() => stored('onx_folders').characters['order-bot'].map(f => [f.id, f.members.length])), [['fb', 2], ['fa', 1]], 'a moved folder keeps its members');
  // A folder dropped on a character goes nowhere; a character dropped on a folder's middle is filed, not reordered.
  await drag(folderTile('회사'), tile('Alpha'), .5);
  assert.deepEqual(await folders(), ['회사', '학교']);

  // A finger carries a tile between two others too.
  await page.locator('[data-folder-scope="session"] [data-folder-crumb]').click();
  await folderTile('회사').click();
  assert.deepEqual(await people(), ['Gamma', 'Beta']);
  await page.evaluate(async () => {
    const from = document.querySelector('#nx-char-session-list [data-ux-character-tile="beta"]'), to = document.querySelector('#nx-char-session-list [data-ux-character-tile="gamma"]');
    const mid = el => { const r = el.getBoundingClientRect(); return { clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 }; };
    const left = el => { const r = el.getBoundingClientRect(); return { clientX: r.x + r.width * .15, clientY: r.y + r.height / 2 }; };
    const fire = (type, p, live = true) => from.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches: live ? [new Touch({ identifier: 1, target: from, ...p })] : [], changedTouches: [new Touch({ identifier: 1, target: from, ...p })] }));
    fire('touchstart', mid(from));
    await new Promise(done => setTimeout(done, 480));
    fire('touchmove', left(to)); fire('touchend', left(to), false);
  });
  await page.waitForFunction(() => { const o = stored('onx_folders').order['order-bot']; return o.indexOf('beta') < o.indexOf('gamma'); });
  await settled();
  assert.deepEqual(await people(), ['Beta', 'Gamma']);
  assert.equal(await page.evaluate(() => JSON.stringify(rosterNow())), rosterBefore);
  assert.deepEqual(errors, []);
  console.log('[tile order] PASS: set down before and after a tile, the picked together, folders among themselves, a carried finger, and a held finger getting the tile menu (the 선택 bar\'s in 선택 mode)');
} finally {
  await browser.close();
}
