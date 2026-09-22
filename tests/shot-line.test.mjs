import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  normalizeShotLines,
  looksLikeCssLine,
  numberMessageLinesForTagger,
  splitTaggerMessageLines,
} from '../.test-build/shot-line.mjs';

test('splitTaggerMessageLines skips blanks', () => {
  assert.deepEqual(splitTaggerMessageLines('a\n\n  b  \n'), ['a', 'b']);
});

test('numberMessageLinesForTagger prefixes L#', () => {
  assert.equal(
    numberMessageLinesForTagger('첫 줄\n둘째\n셋째'),
    'L1|첫 줄\nL2|둘째\nL3|셋째',
  );
});

test('looksLikeCssLine catches stylesheet rows and not prose', () => {
  assert.equal(
    looksLikeCssLine(
      '.chattext .x-risu-ngs-card{--ngs-irid:linear-gradient(100deg,#7fd8ff,#a99bff);position:relative}',
    ),
    true,
  );
  assert.equal(
    looksLikeCssLine(
      '@keyframes spin-loader{from{transform:rotate(0deg);}to{transform:rotate(360deg);}}',
    ),
    true,
  );
  assert.equal(looksLikeCssLine('바람이 풀잎을 낮게 쓸고 지나가며 스치는 소리를 냈다.'), false);
  assert.equal(looksLikeCssLine('생성중...'), false);
});

test('numberMessageLinesForTagger compresses CSS-looking lines to 50 chars', () => {
  const css =
    '.chattext .x-risu-ngs-card{--ngs-irid:linear-gradient(100deg,#7fd8ff,#a99bff,#ff9ad5,#ffe27a,#8ef0a6,#7fd8ff);position:relative}';
  const labeled = numberMessageLinesForTagger(`바람이 분다.\n${css}\n생성중...`);
  const rows = labeled.split('\n');
  assert.equal(rows.length, 3);
  assert.equal(rows[0], 'L1|바람이 분다.');
  assert.equal(rows[1], `L2|maybeCSSCode<< ${css.slice(0, 50)}…`);
  assert.ok(!rows[1].includes(css.slice(50, 80)));
  assert.equal(rows[2], 'L3|생성중...');
});

test('line numbers remain authoritative even with obsolete percent values', () => {
 const shots = [{line:1,y_percent:90},{line:2,y_percent:5},{line:3,y_percent:50}];
 assert.deepEqual(normalizeShotLines(shots,'a\nb\nc\nd').map(s=>s.line),[1,2,3]);
 assert.deepEqual(normalizeShotLines([{line:0},{line:99},{line:'bad'},{line:2}], 'a\nb\nc').map(s=>s.line),[3,3,3,2]);
 assert.equal(shots[0].line,1);
});
