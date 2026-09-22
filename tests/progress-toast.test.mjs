import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { repairProgressToast } from '../tools/vendor-patches/progress-toast.mjs';
import { progressToastView, progressToastStyles } from '../.test-build/viewer-core.mjs';

const runtime = readFileSync(new URL('../tools/vendor-patches/progress-toast-runtime.js', import.meta.url), 'utf8');
function legacyFixture() {
  const config = ts.createSourceFile('vite.config.ts', readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
  let toast;
  for (const statement of config.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (declaration.name.getText(config) === 'VENDOR_PROGRESS_TOAST_FN_PATCH') toast = new Function('return ' + declaration.initializer.getText(config))();
    }
  }
  assert.ok(toast);
  const vendor = readFileSync(new URL('../vendor/inlay-nexus-ui.js', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
  const start = vendor.indexOf('  async function withImageRerollToast('), end = vendor.indexOf('  async function dismissProgressToast()', start);
  assert.ok(start >= 0 && end > start);
  return vendor.slice(start, end) + toast + '\n k.onUnload(async () => {});';
}
function harness() {
  let now = 1000, sequence = 0;
  const timers = new Map(), writes = [], elements = [];
  class Element {
    constructor(tag) { this.tag = tag; this.children = []; elements.push(this); }
    async setAttribute(key, value) { this[key] = value; writes.push(['attr', key, value]); }
    async setStyleAttribute(value) { this.style = value; writes.push(['style', value]); }
    async setTextContent(value) { this.text = value; writes.push(['text', value]); }
    async appendChild(node) { this.children.push(node); writes.push(['append']); }
    async remove() { writes.push(['remove']); }
    async setInnerHTML() { throw Error('Whole-toast HTML replacement is forbidden'); }
    async getBoundingClientRect() { throw Error('Toast must not measure layout'); }
  }
  const body = new Element('body');
  const t = { backendSettings: { card: { progress_toast: true } } };
  const context = vm.createContext({
    t, Date: { now: () => now }, Promise,
    __INLAY_VIEWER_CORE__: { progressToastView, progressToastStyles },
    setTimeout: (fn, ms) => { const id = ++sequence; timers.set(id, { fn, at: now + ms }); return id; },
    clearTimeout: id => timers.delete(id),
    setInterval: () => { throw Error('No idle polling'); },
    Pe: (_label, error) => { throw error; },
    ue: async () => ({}), Ee: async () => body,
    H: async (_doc, tag, options = {}) => {
      const node = new Element(tag);
      if (options.style) await node.setStyleAttribute(options.style);
      return node;
    },
    nxToastPos: options => `position:fixed;display:${options.visible ? 'block' : 'none'};pointer-events:${options.pointerEvents ? 'auto' : 'none'};`,
  });
  const api = vm.runInContext(runtime + ';({sync:syncProgressToast,dispose:nxDisposeProgressToast,state:nxProgress})', context);
  return { t, timers, writes, elements, context, ...api,
    async advance(ms) {
      now += ms;
      for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.fn(); }
      await api.state.pending;
    },
  };
}
const job = (extra = {}) => ({ jobId: 'job1', state: 'generating', shot_count: 4, shot_done: 1, shot_index: 1, ...extra });

test('progress details use real counts, ignore fabricated percent, and distinguish useful stages', () => {
  const view = progressToastView(job({ progress: 88 }), 15000);
  assert.equal(view.ratio, .25);
  assert.equal(view.detail, '2 / 4장 · 1장 완료');
  assert.equal(view.clock, '15초');
  assert.equal(progressToastView(job({ state: 'tagging', progress: 28 })).measured, false);
  for (const [message, expected] of [
    ['에셋 캐릭터 룩 태깅 중…', '캐릭터 외형 확인 중'],
    ['태거 JSON 오류 → 재시도 중…', '장면 분석 다시 시도 중'],
    ['만화 레이아웃 중…', '만화 구성 중'],
  ]) assert.equal(progressToastView(job({ state: 'tagging', message })).title, expected);
  assert.equal(progressToastView(job({ message: '이미지 반영 중 2/4… [job.persist]' })).title, '이미지 반영 중');
  assert.equal(progressToastView(job({ message: 'NovelAI 대기 2/4 (5s) · nai.read_bytes.progress' })).title, '이미지 받는 중');
});

test('cancellation and user stop never claim 100% success; error text remains literal', () => {
  for (const patch of [{ state: 'cancelled' }, { state: 'done', message: '사용자 중단 · 유지 1장' }]) {
    const view = progressToastView(job(patch));
    assert.equal(view.tone, 'muted');
    assert.equal(view.ratio, 0);
    assert.equal(view.showRail, false);
  }
  assert.equal(progressToastView(job({ state: 'error', message: '<img onerror=alert(1)>' })).detail, '<img onerror=alert(1)>');
});

test('idle and background warm create no nodes, writes, or timers; quick successes stay quiet', async () => {
  const h = harness();
  h.context.__INLAY_NATIVE__ = { warmFocusProgress: () => ({ busy: true, pct: 50 }) };
  await h.sync();
  assert.equal(h.writes.length, 0);
  assert.equal(h.timers.size, 0);
  h.t.jobProgress = job();
  await h.sync();
  assert.equal(h.writes.length, 0);
  await h.advance(200);
  h.t.jobProgress = job({ state: 'done' });
  await h.sync();
  assert.equal(h.writes.length, 0);
  assert.equal(h.timers.size, 0);
});

test('one mount, unchanged states make zero DOM calls, clock updates only one text node', async () => {
  const h = harness();
  h.t.jobProgress = job();
  await h.sync();
  await h.advance(450);
  const mounted = h.elements.length;
  assert.equal(h.t._progressToastShown, true);
  h.writes.length = 0;
  for (let i = 0; i < 30; i++) {
    h.t.jobProgress = job({ message: `NovelAI 대기 2/4 (${i}s) · nai.wait` });
    await h.sync();
  }
  assert.equal(h.writes.length, 0);
  assert.equal(h.elements.length, mounted);
  assert.equal(h.timers.size, 1);
  await h.advance(4550);
  assert.deepEqual(h.writes, [['text', '5초']]);
  h.writes.length = 0;
  h.t.jobProgress = job({ shot_done: 2, shot_index: 2 });
  await h.sync();
  assert.equal(h.writes.filter(row => row[0] === 'text').length, 1);
  assert.equal(h.writes.filter(row => row[0] === 'style').length, 1);
  assert.equal(h.elements.length, mounted);
});

test('errors survive job cleanup for six seconds, then hide once with no polling or resurrection', async () => {
  const h = harness();
  h.t.jobProgress = job({ state: 'error', message: 'API 키를 확인하세요' });
  await h.sync();
  assert.equal(h.t._progressToastShown, true);
  await h.advance(1000);
  h.t.jobProgress = null;
  await h.sync();
  assert.equal(h.t._progressToastShown, true);
  await h.advance(5000);
  assert.equal(h.t._progressToastShown, false);
  assert.equal(h.timers.size, 0);
  h.t.jobProgress = job({ state: 'error', message: 'API 키를 확인하세요' });
  h.writes.length = 0;
  await h.sync();
  assert.equal(h.writes.length, 0);
  assert.equal(h.timers.size, 0);
});

test('a new job replaces the previous terminal timeout and disabled settings tear down', async () => {
  const h = harness();
  h.t.jobProgress = job({ state: 'error' });
  await h.sync();
  h.t.jobProgress = job({ jobId: 'job2' });
  await h.sync();
  await h.advance(450);
  await h.advance(6000);
  assert.equal(h.t._progressToastShown, true);
  assert.equal(h.state.nodes.title.text, '이미지 생성 중');
  h.t.backendSettings.card.progress_toast = false;
  await h.sync();
  assert.equal(h.timers.size, 0);
  assert.equal(h.state.nodes, null);
});

test('in-flight SafeDOM writes coalesce and retain terminal updates; unload releases nodes and timer', async () => {
  const h = harness();
  h.t.jobProgress = job();
  await h.sync();
  await h.advance(450);
  let release;
  const original = h.state.nodes.title.setTextContent.bind(h.state.nodes.title);
  h.state.nodes.title.setTextContent = async text => {
    await new Promise(resolve => { release = resolve; });
    return original(text);
  };
  h.t.jobProgress = job({ message: '이미지 반영 중' });
  const pending = h.sync();
  while (!release) await Promise.resolve();
  h.t.jobProgress = job({ state: 'done' });
  assert.equal(h.sync(), pending);
  h.state.nodes.title.setTextContent = original;
  release();
  await pending;
  assert.equal(h.state.nodes.title.text, '생성 완료');
  await h.dispose();
  assert.equal(h.timers.size, 0);
  assert.equal(h.state.nodes, null);
  await h.sync();
  assert.equal(h.timers.size, 0);
});

test('built toast has no legacy watchdog or reroll heartbeat and cleans up on unload', () => {
  const built = readFileSync(new URL('../dist/omninexus.js', import.meta.url), 'utf8');
  assert.match(built, /const nxProgress =/);
  assert.match(built, /await nxDisposeProgressToast\(\)/);
  assert.doesNotMatch(built, /_progressToastWatchdog|_progressToastSyncingAt/);
  const reroll = built.slice(built.indexOf('  async function withImageRerollToast('), built.indexOf('  function messageCardsByY('));
  assert.ok(reroll.length > 0);
  assert.doesNotMatch(reroll, /setInterval/);
  assert.match(reroll, /t\.jobProgress\?\.toastRun === toastRun/);
});

test('patch guards accept real legacy source and reject removed, duplicated, or renamed boundaries', () => {
  const source = legacyFixture();
  assert.match(repairProgressToast(source), /const nxProgress =/);
  const needle = '  const PROGRESS_TOAST_HIDE_MS = 2e3;';
  for (const broken of [source.replace(needle, ''), source.replace(needle, needle + needle), source.replace('  async function Se() {', '  async function movedSe() {')]) {
    assert.throws(() => repairProgressToast(broken), /boundary drift/);
  }
});

test('previous reroll timeout cannot clear a new reroll', async () => {
  const source = repairProgressToast(legacyFixture());
  const start = source.indexOf('  let nxRerollToastSequence'), end = source.indexOf('  function messageCardsByY(', start);
  assert.ok(start >= 0 && end > start);
  const callbacks = [], t = {};
  const run = new Function('t', 'Se', 'setTimeout', 'clearInterval', 'z', source.slice(start, end) + ';return withImageRerollToast;')(
    t, async () => {}, fn => callbacks.push(fn), () => {}, String,
  );
  await run('첫 리롤', async () => 'first');
  let finish;
  const next = run('다음 리롤', () => new Promise(resolve => { finish = resolve; }));
  await Promise.resolve();
  const id = t.jobProgress.toastRun;
  callbacks[0]();
  assert.equal(t.jobProgress.toastRun, id);
  assert.equal(t.jobProgress.state, 'generating');
  finish('second');
  await next;
  callbacks[1]();
  assert.equal(t.jobProgress, null);
});

test('reroll completion uses reported batch totals, distinguishes partial failure and user stop', async () => {
  const source = readFileSync(new URL('../tools/vendor-patches/progress-reroll-runtime.js', import.meta.url), 'utf8');
  const t = {}, snapshots = [];
  const run = new Function('t', 'Se', 'setTimeout', 'z', source + ';return withImageRerollToast;')(
    t, async () => snapshots.push({ ...t.jobProgress }), () => {}, String,
  );
  await run('전체 리롤', async report => {
    report({ shot_count: 4, shot_done: 2, shot_index: 3 });
    return { ok: true, cards: [{}, {}, {}], failed: [{}] };
  });
  assert.equal(t.jobProgress.shot_count, 4);
  assert.equal(t.jobProgress.shot_done, 3);
  const partial = progressToastView(t.jobProgress);
  assert.equal(partial.title, '일부 이미지 재생성 실패');
  assert.equal(partial.detail, '3장 완료 · 1장 실패');
  assert.equal(partial.tone, 'error');
  assert.equal(partial.ratio, 0);
  await run('중단', async report => {
    report({ shot_count: 4, shot_done: 1 });
    return { ok: true, stopped: true, cards: [{}], failed: [] };
  });
  assert.equal(progressToastView(t.jobProgress).title, '재생성 중단됨');
  assert.equal(t.jobProgress.shot_done, 1);
  await run('실패 응답', async () => ({ ok: false, error: { message: 'API 키 없음' } }));
  assert.equal(t.jobProgress.state, 'error');
  assert.equal(t.jobProgress.message, 'API 키 없음');
  assert.ok(snapshots.length >= 6);
});
