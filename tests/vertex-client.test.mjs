import test from 'node:test';
import assert from 'node:assert/strict';
import { callLlm } from '../.test-build/llm-client.mjs';

test('Vertex sends Gemini publisher ids while other providers keep their model ids', async () => {
  const sent = [];
  globalThis.risuai = { nativeFetch: async (url, options) => {
    sent.push({ url, ...JSON.parse(options.body) });
    return { status: 200, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) };
  } };
  try {
    for (const [provider, model] of [['vertex','gemini-2.5-flash'], ['vertex','google/gemini-2.5-flash'], ['openai','gemini-2.5-flash']]) {
      await callLlm({ source: 'custom', provider, model, api_key: 'fake-access-token',
        endpoint: 'https://aiplatform.googleapis.com/v1/projects/demo/locations/global/endpoints/openapi/chat/completions',
        vertex_region: 'global', timeout_seconds: 2 }, [{ role: 'user', content: 'hello' }]);
    }
    assert.deepEqual(sent.map(row => row.model), ['google/gemini-2.5-flash', 'google/gemini-2.5-flash', 'gemini-2.5-flash']);
  } finally { delete globalThis.risuai; }
});
