import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {build} from 'esbuild';
const bundle = await build({stdin:{contents:`export * from './src/providers/llm/client';
 export {fillComicPagesForShots} from './src/services/comic'; export {setConfig} from './src/services/context';`,resolveDir:process.cwd(),loader:'ts'},
 bundle:true,write:false,format:'esm',platform:'node',plugins:[{name:'llm-transport',setup(b){
 b.onLoad({filter:/[\\/]providers[\\/]nai[\\/]http\.ts$/},args=>({loader:'ts',resolveDir:path.dirname(args.path),
 contents:readFileSync(args.path,'utf8').replace('export async function networkFetch(', 'async function originalNetworkFetch(')+
 '\nexport async function networkFetch(...args) { return globalThis.__abortTestFetch(...args); }'}));
 b.onLoad({filter:/[\\/]services[\\/]llm-call\.ts$/},args=>({loader:'ts',resolveDir:path.dirname(args.path),contents:"export {callLlm} from '../providers/llm/client';"}));
 }}]});
const kv=new Map();
globalThis.risuai={pluginStorage:{getItem:async k=>kv.get(k),setItem:async(k,v)=>kv.set(k,v)}};
const api=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const llm={source:'custom',provider:'openai',model:'test',api_key:'test',endpoint:'https://example.test/v1/chat/completions',timeout_seconds:30};
const messages=[{role:'user',content:'hello'}];
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const aborts=promise=>assert.rejects(promise,{name:'AbortError'});

test('pre-aborted and preparation-time aborted calls send no HTTP request',async()=>{
 let calls=0;globalThis.__abortTestFetch=async()=>{calls++;throw Error('must not send');};
 for(const before of [true,false]){
  const controller=new AbortController();if(before)controller.abort();
  const pending=api.callLlm(llm,messages,{signal:controller.signal});
  if(!before)controller.abort();
  await aborts(pending);
 }
 assert.equal(calls,0);
});

test('aborting one HTTP request signals its transport and leaves another call alive', {timeout:2000},async()=>{
 const entered=deferred(),second=deferred();const signals=[];
 globalThis.__abortTestFetch=async(_url,opts)=>{
  signals.push(opts.signal);
  if(signals.length===2)entered.resolve();
  return signals.length===1 ? new Promise(()=>{}) : second.promise;
 };
 const a=new AbortController(),b=new AbortController();
 const first=api.callLlm(llm,messages,{signal:a.signal});
 const other=api.callLlm(llm,messages,{signal:b.signal});
 const rejected=aborts(first);
 await entered.promise;a.abort();await rejected;
 assert.equal(signals[0].aborted,true);assert.equal(signals[1].aborted,false);
 second.resolve({status:200,json:async()=>({choices:[{message:{content:'kept'}}]})});
 assert.equal(await other,'kept');
});

test('stop interrupts a proxied JSON body that ignores transport abort', {timeout:2000},async()=>{
 const reading=deferred();globalThis.__abortTestFetch=async()=>({status:200,json:()=>{reading.resolve();return new Promise(()=>{});}});
 const controller=new AbortController();const pending=api.callLlm(llm,messages,{signal:controller.signal});
 const rejected=aborts(pending);await reading.promise;controller.abort();await rejected;
});

test('Risu calls reject pre-aborted signals and detach abort listener after completion',async()=>{
 let calls=0;globalThis.risuai={...globalThis.risuai,runLLMModel:async()=>{calls++;return 'ok';}};
 const stopped=new AbortController();stopped.abort();await aborts(api.callLlm({...llm,source:'main'},messages,{signal:stopped.signal}));
 assert.equal(calls,0);
 const controller=new AbortController();let attached=0;
 const add=controller.signal.addEventListener.bind(controller.signal),remove=controller.signal.removeEventListener.bind(controller.signal);
 controller.signal.addEventListener=(...args)=>{attached++;return add(...args);};
 controller.signal.removeEventListener=(...args)=>{attached--;return remove(...args);};
 assert.equal(await api.callLlm({...llm,source:'main'},messages,{signal:controller.signal}),'ok');
 assert.equal(attached,0);
});

test('per-shot comic cancellation stops the active request and never starts the next page', {timeout:2000},async()=>{
 const entered=deferred();let calls=0;
 globalThis.__abortTestFetch=async()=>{calls++;entered.resolve();return new Promise(()=>{});};
 api.setConfig({card:{comic_llm_batch:'per_shot'},llm,comic_llm:{...llm},nai:{}});
 const controller=new AbortController();
 const pending=api.fillComicPagesForShots({shots:[{kind:'comic',characters:[]},{kind:'comic',characters:[]}],roster:[],assistantText:'prose',signal:controller.signal});
 const rejected=aborts(pending);await entered.promise;controller.abort();await rejected;
 assert.equal(calls,1);
});


test('pre-aborted comic batch sends no request', async()=>{
 let calls=0;globalThis.__abortTestFetch=async()=>{calls++;throw Error('must not send');};
 const controller=new AbortController();controller.abort();
 await aborts(api.fillComicPagesForShots({shots:[{kind:'comic',characters:[]}],roster:[],assistantText:'prose',signal:controller.signal}));
 assert.equal(calls,0);
});
