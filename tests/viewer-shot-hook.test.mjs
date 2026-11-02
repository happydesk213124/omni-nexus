import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// 옴니 뷰어's 🎲 리롤 and 🔮 샷 태그 run in Omni's own window (tools/vendor-patches/float-viewer.js, put
// into the UI's closure as written). Its toasts are under the viewer, so it answers true or why not.
const source = readFileSync(new URL('../tools/vendor-patches/float-viewer.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const OPEN = 'globalThis.__OMNI_SHOT_ACTION__ = ';
const start = source.indexOf(OPEN), end = source.indexOf('\n};\n', start);
assert.ok(start >= 0 && end > start, 'the hook is where it was');
const body = source.slice(start + OPEN.length, end + 3);

function hook({ gallery = [], wide = [], reroll = async () => ({ ok: true }), roster = {} } = {}) {
  const calls = [], t = { gallery };
  const Z = async () => ({ sessionId: 'sess' });
  const ce = async () => { calls.push(['ce']); return t.gallery; };
  const K = async (path, options) => {
    calls.push([path, options?.body ?? null]);
    if (path.startsWith('/v1/gallery')) return { ok: true, items: wide };
    return reroll(path, options);
  };
  const opened = [], edited = [];
  // The UI's own: w cuts a string short, Dt finds a roster row by name, Ua opens 캐릭터 태그 수정.
  const w = (s, n = 2e5) => String(s ?? '').slice(0, n);
  const run = new Function('t', 'Z', 'ce', 'K', 'y', 'openCardTagEdit', 'withImageRerollToast', 'w', 'ensureViewerRosterLoaded', 'Dt', 'Ua', `return ${body}`)(
    t, Z, ce, K, () => {}, async card => { opened.push(card); }, async (_label, work) => await work(),
    w, async () => { calls.push(['roster']); }, name => roster[name] ?? null, async e => { edited.push(e); });
  return { run, calls, opened, edited };
}

test("🎲 takes the card's id alone: a picture the gallery as loaded does not hold is still redrawn", async () => {
  const { run, calls } = hook();
  assert.equal(await run('reroll', 'card1_r1'), true);
  assert.deepEqual(calls[0], ['/v1/cards/card1_r1/reroll', { mode: 'nai' }]);
  assert.deepEqual(calls.slice(1), [['ce']], 'then the gallery is read again, for the strip');
});

test('🎲 refused or failed: the reason comes back for the viewer to show', async () => {
  const busy = hook({ reroll: async () => ({ ok: false, busy: true, error: { code: 'busy', message: '같은 메시지 작업이 아직 진행 중입니다.' } }) });
  assert.equal(await busy.run('reroll', 'card1'), '같은 메시지 작업이 아직 진행 중입니다.');
  const missing = hook({ reroll: async () => ({ ok: false, error: { code: 'no_meta', message: '이미지에서 NovelAI 메타데이터를 읽지 못했습니다.' } }) });
  assert.equal(await missing.run('reroll', 'card1'), '이미지에서 NovelAI 메타데이터를 읽지 못했습니다.');
  const thrown = hook({ reroll: async () => { throw new Error('NovelAI 401'); } });
  assert.equal(await thrown.run('reroll', 'card1'), 'NovelAI 401');
  assert.equal(thrown.calls.some(call => call[0] === 'ce'), false, 'nothing redrawn: the strip is not read again');
});

test('🔮 finds an old picture past the strip\'s newest: the whole session is asked', async () => {
  const { run, calls, opened } = hook({ gallery: [{ id: 'new' }], wide: [{ id: 'new' }, { id: 'old', session_id: 'sess' }] });
  assert.equal(await run('base', 'old'), true);
  assert.deepEqual(opened, [{ id: 'old', session_id: 'sess' }]);
  assert.ok(calls.some(call => /^\/v1\/gallery\?session_id=sess&limit=2000$/.test(call[0])));
  const shown = hook({ gallery: [{ id: 'new' }] });
  assert.equal(await shown.run('base', 'new'), true, 'in the strip: opened at once');
  assert.deepEqual(shown.calls, [], 'nothing asked');
  const lost = hook();
  assert.match(String(await lost.run('base', 'gone')), /찾지 못했습니다/);
  assert.deepEqual(lost.opened, []);
});

test("a cast chip (c1·하쿠키) opens that person's tags as 크게보기's chip does: by the name, at the chip's place, the roster read first", async () => {
  const haku = { name: '하쿠키', id: 'c-haku' };
  const { run, calls, edited, opened } = hook({ roster: { 하쿠키: haku } });
  assert.equal(await run('char', 'card1', { index: 1, name: '하쿠키' }), true);
  assert.deepEqual(calls, [['roster']]);
  assert.deepEqual(edited, [{ name: '하쿠키', prompt: '', roster: haku, index: 1 }]);
  assert.deepEqual(opened, [], 'not the picture\'s own tags');
  const nameless = hook();
  assert.match(String(await nameless.run('char', 'card1', { index: 0, name: '' })), /찾지 못했습니다/);
  assert.deepEqual(nameless.edited, []);
});
