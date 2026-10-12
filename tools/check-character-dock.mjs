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
      const cells = [...dock.children].filter(el => visible(el) && (el.matches('button:not(.dock-up)') || el.matches('.char-json-actions')));
      const rect = el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
      const appearance = el => { const s = getComputedStyle(el); return { background: s.backgroundColor, image: s.backgroundImage, radius: s.borderTopLeftRadius }; };
      const json = dock.querySelector('.char-json-actions');
      return {
        cells: cells.map(el => ({ ...rect(el), ...appearance(el) })),
        json: json ? [...json.querySelectorAll('button')].filter(visible).map(el => ({ id: el.id, divider: getComputedStyle(el).borderLeftWidth, ...rect(el) })) : [],
        edit: rect(dock.querySelector('.dock-up')),
        overflow: document.getElementById('nx-main').scrollWidth - document.getElementById('nx-main').clientWidth,
      };
    });
    assert.equal(layout.cells.length, 6, `six work cells @${width}`);
    for (let row = 0; row < 3; row++) {
      const [left, right] = layout.cells.slice(row * 2, row * 2 + 2);
      assert.ok(Math.abs(left.y - right.y) < 1 && right.x > left.x, `two columns in row ${row} @${width}`);
      assert.ok(Math.abs(left.width - right.width) < 1, `equal cell widths @${width}`);
    }
    for (const cell of layout.cells) {
      assert.equal(cell.height, 34, `compact button height @${width}`);
      assert.equal(cell.background, 'rgb(16, 22, 34)', `same dark background @${width}`);
      assert.equal(cell.image, 'none', `no gradient @${width}`);
      assert.equal(cell.radius, '12px', `same corner shape @${width}`);
    }
    assert.equal(layout.json.length, 2, `two visible JSON actions @${width}`);
    assert.deepEqual(layout.json.map(el => el.id), ['nx-export-session-chars', 'nx-import-session-chars']);
    assert.equal(layout.json[1].divider, '1px', `visible JSON divider @${width}`);
    assert.ok(Math.abs(layout.json[0].width - layout.json[1].width) < 1, `equal split @${width}`);
    assert.equal(layout.edit.height, 34, `compact editor button @${width}`);
    assert.ok(layout.overflow <= 1, `no horizontal overflow @${width}`);
    await page.locator('#characters .preset-dock').screenshot({ path: `.test-build/character-dock/${width}.png` });
  }
  console.log('Character dock: real bundle uses two columns, equal JSON halves, 34px buttons and matching colors at 320/360/812/1440px.');
} finally {
  await browser.close();
}
