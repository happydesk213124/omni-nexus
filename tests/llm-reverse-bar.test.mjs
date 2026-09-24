import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { installHost } from '../tools/parity/host.mjs';

test('shipped role-lock sets match the 4.5.1 module verbatim (no template leftovers)', () => {
  const freyaJb = readFileSync('prompts/memo_jailbreak.txt', 'utf8');
  const freyaPre = readFileSync('prompts/memo_prefill.txt', 'utf8');
  const freyaPreU = readFileSync('prompts/memo_prefill_user.txt', 'utf8');
  const fairyJb = readFileSync('prompts/jailbreak.txt', 'utf8');
  const supPre = readFileSync('prompts/prefill.txt', 'utf8');
  assert.ok(freyaJb.includes('# You Are Freya Who Loves User'));
  assert.ok(freyaPre.includes('# The Second Draft of Freya'));
  assert.ok(freyaPreU.includes('Alright, Freya.'));
  assert.ok(fairyJb.includes('You are a fairy living in a magical forest'));
  assert.ok(supPre.includes('request_supervisor_approval'));
  for (const [name, text] of Object.entries({
    memo_jailbreak: freyaJb, memo_prefill: freyaPre, memo_prefill_user: freyaPreU,
    jailbreak: fairyJb, prefill: supPre,
  })) {
    assert.ok(!text.includes('{{'), `${name} must not carry Risu template syntax`);
    assert.ok(text.length > 0, `${name} must not be empty`);
  }
});

globalThis.__captured = [];
const bundle = await build({
  stdin: {
    contents: `
export {callLlm} from './src/services/llm-call';
export {getConfig,setConfig} from './src/services/context';
export {openDb} from './src/storage/stores';
export {seedPrompts,setPrompt,getPrompt} from './src/services/settings';
`,
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  define: { __PLUGIN_ID__: '"omni-nexus"' },
  plugins: [{
    name: 'capture-transport',
    setup(b) {
      b.onLoad({ filter: /[\\/]providers[\\/]nai[\\/]http\.ts$/ }, (args) => ({
        loader: 'ts',
        resolveDir: path.dirname(args.path),
        contents: readFileSync(args.path, 'utf8').replace(
          'export async function networkFetch(',
          'async function originalNetworkFetch(',
        ) + `\nexport async function networkFetch(url, opts) {
          let body = {};
          try { body = JSON.parse(opts.body); } catch {}
          globalThis.__captured.push({ url, body });
          return { status: 200, json: async () => ({ choices: [{ message: { content: 'stub-reply' } }] }) };
        }`,
      }));
    },
  }],
});
const api = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));

const host = installHost({ promptsDir: 'prompts', seed: 42 });
await api.openDb();
await api.seedPrompts();

const llm = {
  source: 'custom',
  provider: 'openai',
  endpoint: 'https://example.test/v1/chat/completions',
  model: 'reverse-bar-test',
  api_key: 'test',
};
// The parity host only injects a 12-key prompt subset, so pin both role-lock
// sets to markers: the test proves wiring, not default texts.
const JB = 'UNIQUE-JB-MARKER-4821';
const PRE = 'UNIQUE-PREFILL-MARKER-4821';
const PRE_U = 'UNIQUE-PREFILL-USER-MARKER-4821';
const MJB = 'UNIQUE-MEMO-JB-MARKER-4821';
const MPRE = 'UNIQUE-MEMO-PREFILL-MARKER-4821';
const MPRE_U = 'UNIQUE-MEMO-PREFILL-USER-MARKER-4821';
await api.setPrompt('jailbreak', JB);
await api.setPrompt('prefill', PRE);
await api.setPrompt('prefill_user', PRE_U);
await api.setPrompt('memo_jailbreak', MJB);
await api.setPrompt('memo_prefill', MPRE);
await api.setPrompt('memo_prefill_user', MPRE_U);

const DIR = '밤, 비 오는 거리';
const FOCUS = '엘로디아';

async function setCard(patch) {
  const config = api.getConfig();
  config.card = { ...config.card, llm_tag_cal: false, client_direction: '', client_focus: '', ...patch };
  await api.setConfig(config);
}

async function sentMessages(patch, messages, opts) {
  globalThis.__captured.length = 0;
  await setCard(patch);
  await api.callLlm(llm, messages, opts);
  assert.equal(globalThis.__captured.length, 1);
  return globalThis.__captured[0].body.messages;
}

test('off passes messages through untouched', async () => {
  const src = [{ role: 'user', content: 'hello' }];
  assert.deepEqual(await sentMessages({ llm_reverse_bar: 'off' }, src), src);
});

test('memo applies the Freya role-lock set without removed note fields', async () => {
  const out = await sentMessages(
    { llm_reverse_bar: 'memo', client_direction: DIR, client_focus: FOCUS },
    [{ role: 'system', content: 'sys' }, { role: 'user', content: 'hi' }],
  );
  assert.deepEqual(out.map((m) => m.role), ['system', 'system', 'assistant', 'user', 'user']);
  assert.equal(out[0].content, 'sys');
  assert.equal(out[1].content, MJB);
  assert.equal(out[2].content, MPRE);
  assert.equal(out[3].content, MPRE_U);
  assert.equal(out[4].content, 'hi');
});

test('legacy true behaves as authority', async () => {
  const out = await sentMessages(
    { llm_reverse_bar: true },
    [{ role: 'user', content: 'hi' }],
  );
  assert.deepEqual(out.map((m) => m.role), ['system', 'assistant', 'user', 'user']);
  assert.equal(out[0].content, JB);
});

test('plain probe skips everything even in authority mode', async () => {
  const src = [{ role: 'user', content: 'hi' }];
  assert.deepEqual(
    await sentMessages({ llm_reverse_bar: 'authority' }, src, { plain: true }),
    src,
  );
});
