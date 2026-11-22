import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const full = await readFile('dist/omninexus.js', 'utf8');
const seam = '  await Qa();';
assert.equal(full.split(seam).length, 2, 'bundle boot seam must match exactly once');
const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
try {
  const page = await browser.newPage();
  await page.goto('about:blank');
  await page.evaluate(() => {
    const kv = new Map();
    let character = { chaId: 'dock-bot', name: 'Dock', globalLore: [], chats: [{ id: 'dock-chat', message: [] }] };
    let modules = [];
    globalThis.risuai = {
      pluginStorage: { getItem: async k => kv.get(k), setItem: async (k, v) => kv.set(k, v), removeItem: async k => kv.delete(k) },
      getArgument: async () => '', getDatabase: async () => ({ characters: [structuredClone(character)], modules: structuredClone(modules) }),
      setDatabase: async db => { if (db.modules) modules = structuredClone(db.modules); },
      getCharacterFromIndex: async () => structuredClone(character), setCharacterToIndex: async (_i, c) => { character = structuredClone(c); },
      getChatFromIndex: async () => structuredClone(character.chats[0]),
      getCurrentCharacterIndex: async () => 0, getCurrentChatIndex: async () => 0,
    };
  });
  await page.addScriptTag({ type: 'module', content: full.replace(seam, 'await le();t.uiOpen=true;globalThis.dockRuntime={t,paint:P};await P();') });
  await page.waitForFunction(() => !!globalThis.dockRuntime);
  await mkdir('.test-build/character-dock', { recursive: true });
  for (const [width, height] of [[320, 686], [360, 686], [812, 375], [1440, 900]]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(async () => { dockRuntime.t.uiTab = 'characters'; await dockRuntime.paint(); });
    const layout = await page.evaluate(() => {
      const dock = document.querySelector('#characters .preset-dock');
      const visible = el => !!el.getClientRects().length;
      const cells = [...dock.children].filter(el => visible(el) && el.matches('button:not(.dock-up)'));
      const rect = el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
      const appearance = el => { const s = getComputedStyle(el); return { background: s.backgroundColor, image: s.backgroundImage, radius: s.borderTopLeftRadius }; };
      return {
        cells: cells.map(el => ({ id: el.id, ...rect(el), ...appearance(el) })),
        edit: rect(dock.querySelector('.dock-up')),
        dock: rect(dock),
        rail: document.querySelectorAll('.char-rail').length,
        page: rect(document.querySelector('#characters .preset-page')), main: rect(document.getElementById('characters')),
        overflow: document.getElementById('nx-main').scrollWidth - document.getElementById('nx-main').clientWidth,
      };
    });
    // The dock holds two things to do and the editor: bringing characters in or out is one menu, the LLM the other.
    assert.deepEqual(layout.cells.map(cell => cell.id), ['nx-char-bring', 'nx-char-create-llm'], `two work cells @${width}`);
    assert.ok(Math.abs(layout.cells[0].y - layout.cells[1].y) < 1 && layout.cells[1].x > layout.cells[0].x, `same row @${width}`);
    assert.ok(Math.abs(layout.cells[0].width - layout.cells[1].width) < 1, `equal cells @${width}`);
    for (const cell of layout.cells) {
      assert.equal(cell.height, 34, `compact button height @${width}`);
      assert.equal(cell.background, 'rgb(16, 22, 34)', `same dark background @${width}`);
      assert.equal(cell.image, 'none', `no gradient @${width}`);
      assert.equal(cell.radius, '12px', `same corner shape @${width}`);
    }
    assert.equal(layout.edit.height, 34, `compact editor button @${width}`);
    assert.ok(layout.edit.width > layout.cells[0].width * 1.8, `the editor button spans the dock @${width}`);
    assert.ok(layout.overflow <= 1, `no horizontal overflow @${width}`);
    // The bot list opens from a button by the search: no rail column beside the page any more.
    assert.equal(layout.rail, 0, 'no rail column');
    assert.ok(Math.abs(layout.page.width - layout.main.width) < 1, `the page takes the pane's whole width @${width}`);
    const search = await page.evaluate(() => { const r = el => document.getElementById(el).getBoundingClientRect(); const a = r('nx-char-search'), b = r('nx-char-risu-open'); return { sameRow: Math.abs((a.top + a.bottom) / 2 - (b.top + b.bottom) / 2) < 6, after: b.left >= a.right - 1, text: document.getElementById('nx-char-risu-open').textContent }; });
    assert.ok(search.sameRow && search.after, `다른 봇 sits beside the search @${width}`);
    assert.match(search.text, /다른 봇/);
    // 가져오기 · 내보내기: the menu opens over the dock, on screen, and names each way plainly.
    await page.locator('#nx-char-bring').click();
    const menu = await page.evaluate(() => {
      const menu = document.getElementById('nx-char-bring-menu'), r = menu.getBoundingClientRect();
      return { open: !menu.hidden, inside: r.left >= 0 && r.top >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1, expanded: document.getElementById('nx-char-bring').getAttribute('aria-expanded'),
        items: [...menu.querySelectorAll('button')].filter(b => b.getClientRects().length).map(b => [b.id, b.textContent]) };
    });
    assert.ok(menu.open && menu.inside, `the menu is on screen @${width}`);
    assert.equal(menu.expanded, 'true');
    assert.deepEqual(menu.items, [['nx-char-import-session', '로어북에서 가져오기'], ['nx-char-import-global', '페르소나에서 가져오기'], ['nx-import-session-chars', 'JSON 파일 불러오기'], ['nx-export-session-chars', 'JSON 파일로 내보내기']]);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#nx-char-bring-menu').isHidden(), true, 'Esc closes it');
    await page.locator('#nx-char-bring').click();
    await page.mouse.click(5, 5);
    assert.equal(await page.locator('#nx-char-bring-menu').isHidden(), true, 'a tap elsewhere closes it');
    await page.locator('#characters .preset-dock').screenshot({ path: `.test-build/character-dock/${width}.png` });
  }
  console.log('Character dock: real bundle has two equal work cells and the editor button, no rail column, 다른 봇 beside the search, and a named 가져오기 · 내보내기 menu on screen at 320/360/812/1440px.');
} finally {
  await browser.close();
}
