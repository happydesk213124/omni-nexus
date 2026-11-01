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
  assert.doesNotMatch(instant.html, /<i>/);
  assert.match(instant.html, /“응, 늦었지.”/);
  const fast = api.boxHtml({ speaker: '하린', text: '응, 늦었지.', narration: false, pace: 1 }), slow = api.boxHtml({ speaker: '하린', text: '응, 늦었지.', narration: false, pace: 2.6 });
  assert.ok(slow.revealMs > fast.revealMs * 2);
  assert.match(stage({ cg: 'pending', cgView: 'show', cgPending: true }), /\[data-vn-act="cgfull"\]\{display:none\}/, 'a frame still being drawn has no full screen');
});

test('letters are plain <i>: their delay is by place in the style sheet, never a style of their own', () => {
  const line = api.boxHtml({ speaker: '하린', text: '응, 늦었지.', narration: false, pace: 1.7 });
  assert.match(line.html, /<div data-vn-text style="--vs:\d+ms"><i>“<\/i><i>응<\/i>/);
  assert.doesNotMatch(line.html, /<(span|i) style/, 'no inline style per letter');
  assert.match(api.STATIC_CSS, /\[data-vn-text\] i:nth-child\(2\)\{animation-delay:calc\(1 \* var\(--vs\)\)\}/);
  assert.match(api.STATIC_CSS, /\[data-vn-text\] i:nth-child\(n\+321\)\{animation-delay:calc\(320 \* var\(--vs\)\)\}/, 'a long line: the rest come with the last');
  assert.match(stage({ revealed: true }), /\[data-vn-text\] i\{animation:none!important;visibility:visible!important\}/);
  // Shown at its turn, at once: no letter is ever a fading layer of its own (that cost a phone every frame of a reveal).
  assert.match(api.STATIC_CSS, /\[data-vn-text\] i\{font-style:normal;visibility:hidden;animation:vn-ch 1ms steps\(1,end\) forwards\}/);
  // Visible at both ends: a 1ms step past a second's delay held at a rounding short of its end showed its "from" (hidden)
  // and the line stopped there for good (the browser check is in omni-viewer-reading: a long line to its last letter).
  assert.match(api.STATIC_CSS, /@keyframes vn-ch\{from,to\{visibility:visible\}\}/);
  assert.doesNotMatch(api.STATIC_CSS, /\[data-vn-text\] i\{[^}]*opacity/);
  const long = api.boxHtml({ speaker: '', text: '가'.repeat(1000), narration: true, pace: 1 }), vs = Number(long.html.match(/--vs:(\d+)ms/)[1]);
  assert.equal(long.revealMs, 321 * vs, 'a long line is whole when its last delayed letter is: the cue does not wait for 1000 of them');
});

test('a long line: the box is given its reckoned height as a least one (a line needing more still grows it), a short one none', () => {
  assert.match(stage({ boxHeight: 260.4 }), /\[x-omni-vn\] \[data-vn-box\]\{min-height:260px\}/);
  assert.doesNotMatch(stage({}), /\[data-vn-box\]\{min-height/);
  assert.match(api.STATIC_CSS, /\[data-vn-box\]\{[^}]*min-height:clamp\(136px,26%,200px\);max-height:58%;/, 'its own least and most, as fit.ts reckons them');
  assert.doesNotMatch(api.STATIC_CSS, /\[data-vn-box\]\{[^}]*;height:/, 'no fixed height: a long line ran on below the box, out of sight');
});

test('기록: the line the keys picked is outlined, none when no key has picked one', () => {
  assert.match(stage({ log: true, logSel: 2 }), /\[data-vn-log\] p:nth-of-type\(3\)\{outline:2px solid/);
  assert.doesNotMatch(stage({ log: true, logSel: -1 }), /nth-of-type/);
  assert.doesNotMatch(stage({ log: false, logSel: 2 }), /nth-of-type/, 'closed, nothing');
});

test("글자 크기: the box's letters and name, scaled by one rule; as designed, none", () => {
  assert.match(stage({ textScale: 1.34 }), /\[data-vn-text\]\{font-size:22\.1px\}\[x-omni-vn\] \[data-vn-name\]\{font-size:20\.1px\}/);
  assert.doesNotMatch(stage({ textScale: 1 }), /font-size/);
  assert.doesNotMatch(stage({}), /font-size/);
});

test('캐릭터 움직임: a spring on the face shown (or the oval), breathing for the lit only; off, neither', () => {
  const cast = [{ key: 'tA', face: 'sp1', speaking: true, bounce: 'b' }, { key: 'tB', face: '', speaking: false, label: '(sad)', bounce: 'a' }];
  const on = stage({ cast, motion: { breathe: true, bounce: true } });
  assert.match(on, /\[x-vn-p="tA"\] \[x-vn-sp="sp1"\]\{opacity:1;animation:vn-jelly-b \.62s/);
  assert.match(on, /\[x-vn-p="tB"\] \[data-vn-sil\]\{animation:vn-jelly-a/, 'an oval springs too');
  // The speaker breathes; the dimmed (blurred) one stands still: moving inside a blur redraws it every frame.
  assert.match(on, /\[x-vn-p="tA"\] \[x-vn-sp\] img\{animation:vn-breathe 4\.6s ease-in-out 0s infinite\}/);
  assert.doesNotMatch(on, /\[x-vn-p="tB"\] \[x-vn-sp\] img\{animation:vn-breathe/);
  assert.doesNotMatch(on, /\[x-omni-vn\] \[x-vn-sp\] img\{animation:vn-breathe/, 'never every picture at once');
  const told = stage({ cast, narration: true, motion: { breathe: true, bounce: true } });
  assert.match(told, /\[x-vn-p="tA"\] \[x-vn-sp\] img\{animation:vn-breathe 4\.6s/);
  assert.match(told, /\[x-vn-p="tB"\] \[x-vn-sp\] img\{animation:vn-breathe 5\.2s ease-in-out -1\.7s/, 'in narration nobody is blurred: all breathe, each at their own pace');
  assert.doesNotMatch(stage({ cast, cg: 'p1', cgView: 'open', motion: { breathe: true, bounce: true } }), /vn-breathe/, 'a picture on show dims everyone');
  assert.match(stage({ cast, cg: 'p1', cgView: 'fold', motion: { breathe: true, bounce: true } }), /\[x-vn-p="tA"\] \[x-vn-sp\] img\{animation:vn-breathe/, 'folded at the top it does not');
  const off = stage({ cast, motion: { breathe: false, bounce: false } });
  assert.doesNotMatch(off, /vn-jelly|vn-breathe/);
  assert.match(off, /\[x-vn-p="tA"\] \[x-vn-sp="sp1"\]\{opacity:1\}/);
  assert.match(api.STATIC_CSS, /@keyframes vn-jelly-a\{/); assert.match(api.STATIC_CSS, /@keyframes vn-jelly-b\{/);
  assert.match(api.STATIC_CSS, /prefers-reduced-motion:reduce\)\{\[x-omni-vn\] \[x-vn-sp\],\[x-omni-vn\] \[x-vn-sp\] img,\[x-omni-vn\] \[data-vn-sil\]\{animation:none!important\}/);
});

test('the line and 기록 can be selected to copy; the rest of the stage cannot', () => {
  assert.match(api.STATIC_CSS, /\[x-omni-vn\] \[data-vn-text\],\[x-omni-vn\] \[data-vn-log\] p\{user-select:text!important;-webkit-user-select:text!important/);
  assert.match(api.STATIC_CSS, /\[x-omni-vn\]\{position:fixed;[^}]*user-select:none/);
  assert.match(stage({ sfx: false }), /\[data-vn-act="sfx"\]\{opacity:0\.4\}/);
  assert.match(stage({ sfx: true }), /\[data-vn-act="sfx"\]\{opacity:1\}/);
});

test('waiting: the spinner by the clock turns while the reader waits, and 메시지의 ▲ ▼ row while it fills', () => {
  assert.match(api.FRAME, /<div data-vn-clock><\/div><div data-vn-busy><\/div>/);
  assert.match(api.STATIC_CSS, /\[data-vn-busy\]\{display:none;[^}]*animation:vn-spin/);
  assert.match(stage({ busy: true }), /\[x-omni-vn\] \[data-vn-busy\]\{display:block\}/);
  assert.doesNotMatch(stage({}), /data-vn-busy/);
  assert.match(stage({ msgs: true, msgsLoading: 'before' }), /\[data-vn-msg\]\[data-more="before"\]::after\{content:"";[^}]*animation:vn-spin/);
  assert.doesNotMatch(stage({ msgs: false, msgsLoading: 'before' }), /data-more/, 'closed, nothing turns');
  assert.match(api.FRAME, /<button data-vn-act="set"[^>]*>⚙<\/button><button data-vn-act="cast" type="button" aria-label="이 답장의 TTS 캐릭터 설정">👨‍👩‍👧‍👦<\/button>/, 'the people button sits by the settings');
});

test("the picture's bar: 🎲 리롤 and 🔮 샷 태그 beside 전체화면, dimmed while they cannot run; the voice's spinner rides in every box", () => {
  assert.match(api.FRAME, /<div data-vn-cgbar><button data-vn-act="cgfull"[^>]*>⛶ 전체화면<\/button><button data-vn-act="cgroll"[^>]*>🎲 리롤<\/button><button data-vn-act="cgtags"[^>]*>🔮 샷 태그<\/button><button data-vn-act="cgclose"/);
  assert.match(stage({ cg: 'p1', cgView: 'show', cgLocked: true }), /\[data-vn-act="cgroll"\],\[x-omni-vn\] \[data-vn-cgbar\] \[data-vn-act="cgtags"\]\{opacity:\.35\}/);
  assert.doesNotMatch(stage({ cg: 'p1', cgView: 'show', cgLocked: false }), /cgroll/);
  assert.match(api.boxHtml({ speaker: '하린', text: '응.', narration: false }).html, /<div data-vn-voicewait><\/div>$/);
  assert.match(stage({ voiceWait: true }), /\[x-omni-vn\] \[data-vn-voicewait\]\{display:block\}/);
  assert.doesNotMatch(stage({}), /data-vn-voicewait/);
  assert.match(api.STATIC_CSS, /\[data-vn-voicewait\]\{display:none;position:absolute;right:36px;bottom:46px;[^}]*animation:vn-spin/);
  assert.match(api.STATIC_CSS, /\[x-omni-vn\] \[data-vn-act="eledit"\]\{position:absolute;right:34px;top:calc\(38% \+ 84px\)/, '✎ 편집 by 요소');
});

test('overlapping people: the last to speak in front, then whoever spoke before them', () => {
  const zOf = (css, key) => Number(css.split(`[x-vn-p="${key}"]{`)[1]?.split('}')[0].split('z-index:')[1]);
  const css = stage({ cast: [{ key: 'tA', face: '', speaking: false, front: 1 }, { key: 'tB', face: '', speaking: true, front: 0 }, { key: 'tC', face: '', speaking: false, front: 2 }] });
  assert.deepEqual(['tA', 'tB', 'tC'].map(key => zOf(css, key)), [2, 3, 1]);
  // Narration: nobody speaks, and still the last who spoke stands before the others.
  const told = stage({ narration: true, cast: [{ key: 'tA', face: '', speaking: false, front: 0 }, { key: 'tB', face: '', speaking: false, front: 1 }] });
  assert.deepEqual(['tA', 'tB'].map(key => zOf(told, key)), [3, 2]);
});

test('the picture is over the people: shown big they take no z-index (it has none), folded its thumb is above them', () => {
  const cast = [{ key: 'tA', face: '', speaking: true, front: 0 }, { key: 'tB', face: '', speaking: false, front: 1 }];
  const ruleOf = (css, key) => css.split(`[x-vn-p="${key}"]{`)[1]?.split('}')[0] ?? '';
  for (const cgView of [undefined, 'open', 'show']) {
    const css = stage({ cast, cg: 'p1', cgView });
    assert.deepEqual(['tA', 'tB'].map(key => ruleOf(css, key).includes('z-index')), [false, false], `${cgView}: dimmed under the picture`);
  }
  const folded = stage({ cast, cg: 'p1', cgView: 'fold' });
  assert.equal(folded.split('[x-vn-cg="p1"]{')[1].split('}')[0].split(';').includes('z-index:4'), true, 'the thumb above every person (3 at most)');
  // Its bar (⛶ 🎲 🔮 ▲) is up whenever the picture is big: as it first comes up in the reading too, not only shown again.
  for (const cgView of ['open', 'show']) assert.ok(stage({ cg: 'p1', cgView }).includes('[data-vn-cgbar] [data-vn-act]{display:inline-flex}'), cgView);
  for (const cgView of ['fold', 'full']) assert.equal(stage({ cg: 'p1', cgView }).includes('[data-vn-cgbar] [data-vn-act]{display:inline-flex}'), false, cgView);
  assert.ok(stage({ cg: 'p1', cgView: 'open', cgNote: '리롤 중' }).includes('[data-vn-note]{display:block;top:auto;bottom:124px}'), "the note over the bar, as it is up");
  assert.equal(ruleOf(folded, 'tA').includes('z-index:3'), true, 'folded, the stage is lit as ever');
});
