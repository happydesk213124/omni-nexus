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
      if (process.env.BREAK_GUARDRAIL_PRESET) b.onLoad({filter:/[\\/]domain[\\/]llm[\\/]guardrail-preset\.ts$/}, args => ({loader:'ts',resolveDir:path.dirname(args.path),contents:readFileSync(args.path,'utf8').replace("if (family === 'deepseek') return { mode: 'off', tagCal: false };", "if (family === 'deepseek') return { mode: 'authority', tagCal: true };")}));
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
          return { status: 200, json: async () => ({ choices: [{ message: { content: globalThis.__presetReply || 'stub-reply' } }] }) };
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
await api.setPrompt('jailbreak', JB+'\n\n');
await api.setPrompt('prefill', PRE+'\n');
await api.setPrompt('prefill_user', PRE_U+'\n');
await api.setPrompt('memo_jailbreak', MJB+'\n\n');
await api.setPrompt('memo_prefill', MPRE+'\n');
await api.setPrompt('memo_prefill_user', MPRE_U+'\n');

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

test('custom calls choose the model-family preset, preserve Gemini tag-cal and decode only the applied setting', async () => {
  for (const [preset, model, expected, tag] of [
    ['auto','google/gemini-3-flash',MJB,true], ['auto','deepseek/DeepSeek-V3','',false],
    ['auto','z-ai/GLM-4.6',JB,false], ['auto','unknown-model',JB,true],
    ['gemini','unrelated-model',MJB,true], ['deepseek','gemini-3','',false], ['glm','gemini-3',JB,false],
  ]) {
    await setCard({llm_guardrail_preset:preset,llm_reverse_bar:'authority',llm_tag_cal:true});
    globalThis.__captured.length=0;globalThis.__presetReply='gi%%rl, wfsn, 50%';
    const reply=await api.callLlm({...llm,model},[{role:'system',content:'sys'},{role:'user',content:'hi'}]);
    const text=JSON.stringify(globalThis.__captured[0].body.messages);
    assert.equal(text.includes(MJB),expected===MJB,model+' memo');
    assert.equal(text.includes(JB),expected===JB,model+' authority');
    assert.equal(text.includes('Insert `%%`'),tag,model+' tag-cal');
    assert.equal(reply,tag?'girl, nsfw, 50':'gi%%rl, wfsn, 50%');
    assert.equal(api.getConfig().card.llm_reverse_bar,'authority','per-call presets never rewrite saved settings');
  }
  globalThis.__presetReply='';
  await setCard({llm_guardrail_preset:'auto'});
});

test('Risu request hook uses the actual model and Gemini request type, preserving unrelated requests and media', async () => {
  let hook;let registrations=0;const bodies=[];
  globalThis.risuai.registerBodyIntercepter=async callback=>{hook=callback;registrations++;return {id:'preset-test'};};
  const oldRun=globalThis.risuai.runLLMModel;
  try {
    for(const [model,type,expected,tag] of [['deepseek-chat','openai_basic','',false],['GLM-5','openai_basic',JB,false],['','gemini_base_stream',MJB,true]]) {
      await setCard({llm_guardrail_preset:'auto',llm_reverse_bar:'authority',llm_tag_cal:true});
      globalThis.risuai.runLLMModel=async options=>{
        const foreign={model:'deepseek-chat',messages:[{role:'user',content:'ordinary chat'}]};
        assert.equal(await hook(foreign,type),foreign,'unmarked chat is untouched');
        let body;
        if(model)body={model,temperature:0.77,messages:options.messages};
        else body={contents:options.messages.filter(m=>m.role!=='system').map(m=>({role:m.role==='assistant'?'model':'user',parts:[{text:m.content}]})),systemInstruction:{parts:[{text:options.messages.filter(m=>m.role==='system').map(m=>m.content).join('\n\n')}]},generationConfig:{temperature:0.77}};
        const raw=JSON.stringify(body);const result=await hook(raw,type);bodies.push(JSON.parse(result));
        return {success:true,content:'gi%%rl, wfsn, 50%'};
      };
      const reply=await api.callLlm({...llm,source:'main',model:'stale-gemini-custom-id'},[{role:'system',content:'keep-system'},{role:'user',content:'keep-user',multimodals:[{type:'image',base64:'pixels'}]}]);
      const text=JSON.stringify(bodies.at(-1));
      assert.equal(text.includes(MJB),expected===MJB);
      assert.equal(text.includes(JB),expected===JB);
      assert.equal(text.includes('Insert `%%`'),tag);
      assert.equal(text.includes('omni-preset-'),false,'request marker is removed before sending');
      assert.ok(text.includes('keep-system')&&text.includes('keep-user'));
      if(model)assert.deepEqual(bodies.at(-1).messages.find(m=>m.content==='keep-user').multimodals,[{type:'image',base64:'pixels'}]);
      assert.equal(reply,tag?'girl, nsfw, 50':'gi%%rl, wfsn, 50%');
    }
    // Different main/aux requests may enter the host at the same time.
    await setCard({llm_guardrail_preset:'auto',llm_reverse_bar:'authority',llm_tag_cal:true});
    const simultaneous=[];
    globalThis.risuai.runLLMModel=async options=>{
      await new Promise(resolve=>setImmediate(resolve));
      const model=options.mode==='model'?'gemini-3':'deepseek-chat';
      const body=await hook({model,messages:options.messages},'openai_basic');simultaneous.push(body);
      return {success:true,content:'gi%%rl, wfsn, 50%'};
    };
    assert.deepEqual(await Promise.all(['main','aux'].map(source=>api.callLlm({...llm,source},[{role:'user',content:'same input'}]))),['girl, nsfw, 50','gi%%rl, wfsn, 50%']);
    assert.equal(simultaneous.filter(body=>JSON.stringify(body).includes(MJB)).length,1);
    assert.equal(simultaneous.some(body=>JSON.stringify(body).includes('omni-preset-')),false);
    assert.equal(registrations,1,'one hook registration per plugin');
    // A host retry may switch models; retain the original Gemini checkbox.
    globalThis.risuai.runLLMModel=async options=>{
      const first=await hook({model:'deepseek-chat',messages:options.messages},'openai_basic');
      assert.equal(JSON.stringify(first).includes('Insert `%%`'),false);
      const retry=await hook({model:'gemini-3',messages:options.messages},'openai_basic');
      assert.ok(JSON.stringify(retry).includes('Insert `%%`'));
      assert.ok(JSON.stringify(retry).includes(MJB));
      return {success:true,content:'gi%%rl, wfsn'};
    };
    assert.equal(await api.callLlm({...llm,source:'main'},[{role:'user',content:'retry'}]),'girl, nsfw');
    const plain=[{role:'user',content:'probe'}];
    globalThis.risuai.runLLMModel=async options=>{assert.deepEqual(options.messages,plain);return {success:true,content:'50%'};};
    assert.equal(await api.callLlm({...llm,source:'aux'},plain,{plain:true}),'50%');
  } finally {globalThis.risuai.runLLMModel=oldRun;}
});
