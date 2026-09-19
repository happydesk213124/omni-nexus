import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assignLinesFromYPercent,
  isLazySequentialShotLines,
  looksLikeCssLine,
  numberMessageLinesForTagger,
  repairLazyShotLines,
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

test('isLazySequentialShotLines detects 1..N only', () => {
  assert.equal(isLazySequentialShotLines([1, 2, 3]), true);
  assert.equal(isLazySequentialShotLines([1, 2]), true);
  assert.equal(isLazySequentialShotLines([2, 5, 8]), false);
  assert.equal(isLazySequentialShotLines([1]), false);
  assert.equal(isLazySequentialShotLines([1, 2, 4]), false);
});

test('assignLinesFromYPercent spreads and avoids collisions', () => {
  assert.deepEqual(assignLinesFromYPercent([20, 50, 80], 10), [3, 6, 8]);
  const collided = assignLinesFromYPercent([50, 50, 50], 10);
  assert.equal(new Set(collided).size, 3);
});

test('repairLazyShotLines remaps 1,2,3 via y_percent', () => {
  const msg = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join('\n');
  const shots = [
    { line: 1, y_percent: 20, camera: 'a' },
    { line: 2, y_percent: 50, camera: 'b' },
    { line: 3, y_percent: 80, camera: 'c' },
  ];
  const fixed = repairLazyShotLines(shots, msg);
  assert.deepEqual(fixed.map((s) => s.line), [3, 6, 8]);
  assert.equal(fixed[0].camera, 'a');
});

test('repairLazyShotLines keeps non-sequential lines', () => {
  const msg = 'a\nb\nc\nd\ne\nf\ng\nh';
  const shots = [
    { line: 2, y_percent: 20 },
    { line: 5, y_percent: 50 },
    { line: 7, y_percent: 80 },
  ];
  assert.deepEqual(
    repairLazyShotLines(shots, msg).map((s) => s.line),
    [2, 5, 7],
  );
});
