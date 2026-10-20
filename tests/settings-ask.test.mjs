import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

// The service with the LLM and config replaced, so the whole ask runs without a provider.
const bundle = await build({ entryPoints: ['src/services/settings-ask.ts'], bundle: true, write: false, format: 'esm', platform: 'node',
  plugins: [{ name: 'ask-io', setup(b) {
    b.onResolve({ filter: /\/llm-call$|\/context$/ }, args => ({ path: args.path, namespace: 'ask' }));
    b.onLoad({ filter: /.*/, namespace: 'ask' }, args => ({ loader: 'js', contents: args.path.endsWith('llm-call')
      ? 'export async function callLlm(llm,messages,opts){const s=globalThis.__ask;s.calls.push({llm,messages,opts});if(s.fail)throw Error(s.fail);return s.reply;}'
      : 'export function getConfig(){return {llm:{model:"main"}};}' }));
  } }] });
const api = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const domain = await import('data:text/javascript;base64,' + Buffer.from((await build({ entryPoints: ['src/domain/settings-ask.ts'], bundle: true, write: false, format: 'esm' })).outputFiles[0].text).toString('base64'));

const body = () => ({
  question: '스트리밍 끝나면 화면이 튀어요',
  tabs: [{ tab: '대시보드', items: [{ n: 1, title: '스크롤 붙잡기' }, { n: 2, title: '스트리밍 스크롤 붙잡기' }] }, { tab: '생성 옵션', items: [{ n: 3, title: '🆙 버튼 방식' }] }],
  details: [{ n: 2, text: '스트리밍이 끝나면 보던 곳으로 되돌립니다.' }, { n: 77, text: 'not listed' }],
});
const state = reply => (globalThis.__ask = { calls: [], reply, fail: '' });

test('one plain call to the main LLM: English rules, numbered names by tab, help only for listed numbers', async () => {
  const s = state('{"n":[2,9,2,1],"a":"「스트리밍 스크롤 붙잡기」를 켜세요."}');
  const result = await api.askSettings(body());
  assert.deepEqual(result, { ok: true, answer: '「스트리밍 스크롤 붙잡기」를 켜세요.', picks: [2, 1] }, 'unlisted 9 and the repeat are dropped');
  assert.equal(s.calls.length, 1);
  assert.equal(s.calls[0].opts.plain, true, 'no reverse bar or tag calibration on a settings question');
  assert.equal(s.calls[0].llm.model, 'main');
  const [system, user] = s.calls[0].messages;
  assert.match(system.content, /^You help a user find settings/);
  assert.match(system.content, /JSON only/);
  assert.match(user.content, /\[대시보드\] 1 스크롤 붙잡기; 2 스트리밍 스크롤 붙잡기\n\[생성 옵션\] 3 🆙 버튼 방식/);
  assert.match(user.content, /Details:\n2: 스트리밍이 끝나면 보던 곳으로 되돌립니다\./);
  assert.doesNotMatch(user.content, /not listed/);
  assert.match(user.content, /Question: 스트리밍 끝나면 화면이 튀어요$/);
});

test('an answer in a code fence or prose around the JSON still parses; plain prose is the answer', () => {
  const listed = new Set([1, 2, 3]);
  assert.deepEqual(domain.parseSettingsAnswer('```json\n{"n":[3],"a":"이거"}\n```', listed), { answer: '이거', picks: [3] });
  assert.deepEqual(domain.parseSettingsAnswer('Sure: {"n":["1"],"a":"켜요"} done', listed), { answer: '켜요', picks: [1] });
  assert.deepEqual(domain.parseSettingsAnswer('그런 설정은 없어요.', listed), { answer: '그런 설정은 없어요.', picks: [] });
  assert.equal(domain.parseSettingsAnswer('{"n":[1,2,3,1,2,3,3]}', listed).picks.length, 3);
});

test('nothing grows the prompt past its caps', () => {
  const huge = {
    question: 'q'.repeat(5000),
    tabs: [{ tab: 'T', items: Array.from({ length: 900 }, (_, i) => ({ n: i + 1, title: 'x'.repeat(300) })) }],
    details: Array.from({ length: 50 }, (_, i) => ({ n: i + 1, text: 'y'.repeat(3000) })),
  };
  const input = domain.normalizeSettingsAsk(huge);
  assert.equal(input.question.length, 400);
  assert.equal(input.tabs[0].items.length, 400);
  assert.ok(input.tabs[0].items.every(item => item.title.length === 40));
  assert.equal(input.details.length, 12);
  assert.ok(input.details.every(item => item.text.length === 160));
});

test('no question or no settings: refused before any call; a failed or empty call is an error', async () => {
  const s = state('');
  assert.equal((await api.askSettings({ ...body(), question: '  ' })).error.code, 'bad_request');
  assert.equal((await api.askSettings({ question: 'x', tabs: [] })).error.code, 'bad_request');
  assert.equal(s.calls.length, 0);
  s.fail = 'HTTP 500';
  assert.equal((await api.askSettings(body())).error.code, 'llm_failed');
  s.fail = ''; s.reply = '{"n":[]}';
  assert.equal((await api.askSettings(body())).error.code, 'llm_empty');
});
