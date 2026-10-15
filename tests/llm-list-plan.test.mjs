import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const built = await build({ stdin: { contents: "export * from './src/domain/llm-list-plan';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'neutral' });
const api = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));
const https = value => /^https:\/\//.test(value) ? value : null;

test('a list plan keeps only well-formed edits and adds; new folders are collected once', () => {
  const plan = api.parseListPlan({
    folders: ['일상', '일상', '긴장'],
    edit: [[1, '새 이름', '긴장', ['tense', 'night']], [1, 'twice', null, null], [9, 'out of range', null, null], [2, null, '전투', null], [3, null, null, null], ['2', 'not a number', null, null]],
    add: [{ name: '추격', folder: '액션', tags: ['fast'], url: 'https://x.test/chase.mp3' }, { name: 'no link', url: 'ftp://x' }, { url: 'https://x.test/nameless.mp3' }],
  }, 3, ['일상'], https);
  assert.deepEqual(plan.folders, ['긴장', '전투', '액션'], 'existing folders are not new; folders used without being listed are added');
  assert.deepEqual(plan.edits, [{ index: 0, name: '새 이름', folder: '긴장', tags: ['tense', 'night'] }, { index: 1, folder: '전투' }], 'a repeated, out-of-range, empty or malformed row is dropped');
  assert.deepEqual(plan.adds, [{ name: '추격', folder: '액션', tags: ['fast'], id: 'https://x.test/chase.mp3' }], 'an add needs a name and a valid id');
  assert.deepEqual(api.parseListPlan('nonsense', 3, [], https), { folders: [], edits: [], adds: [] });
  assert.deepEqual(api.parseListPlan({ edit: [[1, null, '', null]] }, 1, [], https).edits, [{ index: 0, folder: '' }], 'moving to 미분류 is a folder of ""');
});

test('the prompt numbers the list, carries the request, and allows adds only with pasted source', () => {
  const rows = [{ name: '카페', folder: '일상', tags: ['calm'] }];
  const withSource = api.listPlanMessages('background music', 'url', 'each needs its url.', rows, ['일상'], '정리해 줘', 'https://x.test/a.mp3 비');
  assert.match(withSource[0].content, /Add only entries found in the pasted source/);
  assert.deepEqual(JSON.parse(withSource[1].content).items, [[1, '카페', '일상', ['calm']]]);
  assert.equal(JSON.parse(withSource[1].content).request, '정리해 줘');
  assert.match(api.listPlanMessages('voice', 'fishId', 'x', rows, [], '정리', '')[0].content, /"add" stays empty/);
});

test('a glossary plan changes listed tiles or makes new ones, with listed effects only', () => {
  const changes = api.parseGlossaryPlan({ tiles: [[1, 2, ['쾅', '콰앙']], [null, 1, ['덜컹']], [1, 1, ['twice']], [5, 1, ['no tile']], [null, 9, ['no effect']], [2, 1, 'not a list']] }, 2, 2);
  assert.deepEqual(changes, [{ tile: 0, effect: 1, words: ['쾅', '콰앙'] }, { tile: null, effect: 0, words: ['덜컹'] }]);
  const messages = api.glossaryPlanMessages([{ name: '문 쾅', folder: '', tags: ['쾅'] }], [{ effect: 0, words: ['쾅'] }], ['콰당'], '미등록 넣어 줘');
  assert.deepEqual(JSON.parse(messages[1].content).unknown_words, ['콰당']);
  assert.deepEqual(JSON.parse(messages[1].content).tiles, [[1, 1, ['쾅']]]);
});
