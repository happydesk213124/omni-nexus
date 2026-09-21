import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transform } from 'esbuild';
import { parseJsonLoose, TAGGER_JSON_RETRY_FAIL_MESSAGE } from '../.test-build/object-util.mjs';

const source = readFileSync(new URL('../src/services/jobs.ts', import.meta.url), 'utf8');
function block(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a);
  return source.slice(a, b);
}
async function run(body, scope) {
  if (process.env.BREAK_TAGGER_FAILURE_GUARD) body = body.replace(/throw new Error\(`에셋 태거 실패[^;]+;/, '');
  const { code } = await transform(`return (async()=>{${body}})();`, { loader: 'ts', target: 'es2022' });
  return new Function(...Object.keys(scope), code)(...Object.values(scope));
}

test('prepass stops on malformed or wrong-shape JSON and identifies the asset tagger', async () => {
  const body = block("    if (assetMode === 'prepass') {", "\n    await setJob(jobId, 'tagging', {");
  for (const raw of ['broken JSON', '{"new_characters":', '{"scenes":[]}']) {
    let requests = 0, saves = 0;
    await assert.rejects(run(body, {
      assetMode: 'prepass', request: {}, jobId: 'j', sessionId: 'a', unifiedSessionId: '', characterId: 'a', sourceSessionIds: [],
      skipAssetInject: false, llmOptions: {},
      collectGenerationAssets: async () => ({ collected: { block: 'tags', packed: { groups: [] } }, images: [] }),
      characterImageInput: async () => [],
      setJob: async () => {}, cancelJobIfStale: async () => false,
      buildCharacterLooksMessages: async () => [], dbg: () => {},
      resolveLlmRole: () => ({}), getConfig: () => ({card:{}}),
      callLlm: async () => { requests++; return raw; }, parseJsonLoose,
      mergeRosterFromTagged: async () => { saves++; }, characterHasAppearance: () => true,
      rosterForSession: async () => [], matchCharactersInText: () => [],
    }), /에셋 태거 실패/);
    assert.equal(requests, 1);
    assert.equal(saves, 0);
  }
});

test('main parse failures keep the failing response details with and without the configured retry', async () => {
  const body = block('    const readMainTagger =', "    dbg('job.tagger.done'");
  for (const retry of [false, true]) {
    let retries = 0;
    await assert.rejects(run(body, {
      taggedRaw: 'first bad reply', request: {}, jobId: 'j', messages: [], llmOptions: {},
      parseJsonLoose, TAGGER_JSON_RETRY_FAIL_MESSAGE, flattenShots: () => [],
      getConfig: () => ({ card: { llm_json_retry: retry } }), dbg: () => {},
      setJob: async () => {}, cancelJobIfStale: async () => false, resolveLlmRole: () => ({}),
      callLlm: async () => { retries++; return 'second bad reply'; },
    }), error => /메인 태거/.test(error.message) && error.message.includes(retry ? 'second bad reply' : 'first bad reply'));
    assert.equal(retries, retry ? 1 : 0);
  }
});
