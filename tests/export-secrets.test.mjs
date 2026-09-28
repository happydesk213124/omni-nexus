import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';
import { secureJsonExports } from '../tools/vendor-patches/export-secrets.mjs';

const built = await build({ stdin: { contents: `
  export * from './src/core/util/export-secrets';
  export * from './src/services/export';
  export { setConfig, getConfig } from './src/services/context';
`, resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife', globalName: 'Subject' });
const context = { console, TextEncoder, TextDecoder, URL, setTimeout, clearTimeout };
runInNewContext(built.outputFiles[0].text, context);
const { sanitizeForExport, shareableJson, jsonParts, setConfig, getConfig } = context.Subject;
const safe = value => JSON.parse(JSON.stringify(sanitizeForExport(value)));
const pem = '-----BEGIN PRIVATE KEY-----\nSYNTHETIC_TEST_PRIVATE_BYTES\n-----END PRIVATE KEY-----';
const sa = JSON.stringify({ type: 'service_account', project_id: 'example', private_key_id: 'test-key-id', private_key: pem });
const opaque = 'opaque-local-credential-12345';
setConfig({ llm: { api_key: opaque, service_account_json: sa } });

test('nested credential containers, casing, roles and embedded JSON cannot enter shared files', () => {
  const input = { llm: { service_account_json: sa, api_key: opaque, model: 'example-model' },
    llm_roles: { comic: { serviceAccountJson: sa, API_KEY: opaque } },
    nai: { api_keys_v5: [opaque], api_keys_v4: [opaque], width: 832 },
    headers: { Authorization: 'Bearer synthetic-test-token' },
    extra: { private_key: pem, client_secret: opaque, refresh_token: opaque },
    workflow: JSON.stringify({ node: { apiKey: opaque, prompt: 'keep this' } }),
    key: 'author_note', max_tokens: 4096 };
  const original = JSON.stringify(input);
  const output = safe(input);
  assert.deepEqual(output.llm, { model: 'example-model' });
  assert.deepEqual(output.llm_roles.comic, {});
  assert.deepEqual(output.nai, { width: 832 });
  assert.deepEqual(output.extra, {});
  assert.deepEqual(output.headers, {});
  assert.deepEqual(JSON.parse(output.workflow), { node: { prompt: 'keep this' } });
  assert.equal(output.key, 'author_note');
  assert.equal(output.max_tokens, 4096);
  assert.equal(JSON.stringify(input), original, 'export must not mutate saved data');
});

test('notes, character text, preset text and URL credentials are sanitized using live credentials', () => {
  const output = shareableJson({ prompts: { author_note: `keep text ${opaque}` },
    character: { appearance: pem }, presets: [{ text: sa }],
    endpoint: `https://user:pass@example.invalid/v1?key=${opaque}&model=keep`,
    example: 'sk-' + 'X'.repeat(32), escaped: `example ${JSON.stringify(pem)}` });
  for (const secret of [opaque, 'SYNTHETIC_TEST_PRIVATE_BYTES', 'X'.repeat(32), 'user:pass']) assert.equal(output.includes(secret), false);
  assert.ok(output.includes('keep text'));
  assert.ok(output.includes('model=keep'));
  assert.equal(getConfig().llm.api_key, opaque);
  assert.equal(getConfig().llm.service_account_json, sa);
});

test('ordinary JSON prompts and lorebook keys retain content and formatting', () => {
  const input = { prompts: { author_note: '{ "normal": "pose", "max_tokens": 4096 }' }, key: 'trigger', tokens: 42 };
  assert.deepEqual(safe(input), input);
});

test('frozen UI download guard covers all six exporters and refuses broken or uninspected payloads', async () => {
  const source = Array.from({ length: 6 }, (_, i) => `out.push(new Blob([JSON.stringify({api_key: '${opaque}', name: 'export-${i}'})], {type:'application/json'}));`).join('\n');
  const patched = secureJsonExports(source);
  const out = [];
  runInNewContext(patched, { out, Blob, globalThis: { __OMNI_EXPORT__: { jsonParts } } });
  assert.equal(out.length, 6);
  for (let i = 0; i < out.length; i++) assert.deepEqual(JSON.parse(await out[i].text()), { name: `export-${i}` });
  assert.throws(() => secureJsonExports(source.replace('application/json', 'text/plain')), /expected 6/);
  assert.throws(() => secureJsonExports(source + source), /expected 6/);
  assert.throws(() => secureJsonExports("new Blob(parts, {type:'application/json'})", 1), /unsupported/);
  assert.throws(() => secureJsonExports('', 0), /expected/);
  assert.throws(() => runInNewContext(patched, { out: [], Blob, globalThis: {} }), /jsonParts/);
  assert.throws(() => jsonParts(['not JSON']));
  assert.throws(() => jsonParts([new Uint8Array([1])]));
  assert.throws(() => jsonParts([]));
});
