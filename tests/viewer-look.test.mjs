import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const built = await build({ stdin: { contents: "export * from './src/viewer/look';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node' });
const api = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));
const stage = extra => api.stageCss({ cast: [], narration: false, bg: '', cg: '', revealed: false, log: false, auto: false, voice: true, ...extra });

test('the end of the story so far: the arrow becomes a blinking cue to write the next message', () => {
  const mid = api.boxHtml({ speaker: '하린', text: '응, 늦었지.', narration: false });
  assert.match(mid.html, /data-vn-next/);
  assert.doesNotMatch(mid.html, /data-vn-end/);
  const end = api.boxHtml({ speaker: '하린', text: '응, 늦었지.', narration: false, end: true });
  assert.match(end.html, /<div data-vn-end style="animation-delay:\d+ms">메시지를 입력해 주세요 ▼<\/div>/, 'after the letters, never over them');
  assert.doesNotMatch(end.html, /data-vn-next/);
  assert.match(stage({ revealed: true }), /\[data-vn-end\]\{animation-delay:0s!important\}/, 'a tap that completes the line brings the cue at once');
});

test('a reply ending on its picture keeps the cue in sight; any other picture hides the box', () => {
  assert.match(stage({ cg: 'p1', cgView: 'open' }), /\[data-vn-box\]\{opacity:0\}/);
  const end = stage({ cg: 'p1', cgView: 'open', endCg: true });
  assert.doesNotMatch(end, /\[data-vn-box\]\{opacity:0\}/, 'the cue lives in the box: hidden with it, it would never show');
  assert.match(end, /\[data-vn-box\]\{background:transparent/);
});

test('full screen without Omni: the sheet shows, an end with nothing beyond it is dimmed, 🔍 fills', () => {
  const full = stage({ cg: 'p1', cgView: 'full', cgNav: { prev: false, next: true } });
  assert.match(full, /\[data-vn-dock\]\{display:grid\}/);
  assert.match(full, /\[data-vn-act="cgprev"\]\{opacity:\.3\}/);
  assert.doesNotMatch(full, /cgnext"\]\{opacity/);
  assert.match(full, /object-fit:contain/);
  assert.match(stage({ cg: 'p1', cgView: 'full', cgFill: true }), /object-fit:cover/);
});

test('a person with no picture is an oval with their name; the face and how its picture goes ride under it', () => {
  assert.match(api.personHtml('오미선'), /<div data-vn-sil style="--c:[^"]+"><b>오미선<\/b><\/div>/);
  const css = stage({ cast: [{ key: 'tA', face: '', speaking: true, label: '(happy)\n그리는 중…' }, { key: 'tB', face: 'sp1', speaking: false, label: '(sad)' }] });
  assert.match(css, /\[x-vn-p="tA"\] \[data-vn-sil\]::after\{content:"\(happy\)\\A 그리는 중…"\}/, 'two lines, by CSS: no call of its own');
  assert.doesNotMatch(css, /\[x-vn-p="tB"\] \[data-vn-sil\]::after/, 'with a picture there is no oval to label');
  assert.match(api.STATIC_CSS, /\[x-omni-vn\]\{position:fixed;z-index:45;/, 'above the chat, under Risu\'s popups and every toast');
});

test('letter speed: 즉시 writes the line as it is; slower ones wait longer per letter', () => {
  const instant = api.boxHtml({ speaker: '하린', text: '응, 늦었지.', narration: false, pace: 0 });
  assert.equal(instant.revealMs, 0);
  assert.doesNotMatch(instant.html, /<span/);
  assert.match(instant.html, /“응, 늦었지.”/);
  const fast = api.boxHtml({ speaker: '하린', text: '응, 늦었지.', narration: false, pace: 1 }), slow = api.boxHtml({ speaker: '하린', text: '응, 늦었지.', narration: false, pace: 2.6 });
  assert.ok(slow.revealMs > fast.revealMs * 2);
  assert.match(stage({ cg: 'pending', cgView: 'show', cgPending: true }), /\[data-vn-act="cgfull"\]\{display:none\}/, 'a frame still being drawn has no full screen');
});
