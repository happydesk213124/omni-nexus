import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {runInNewContext} from 'node:vm';

const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
async function runtime() {
 const saved=new Map(),calls=[];
 const chars=['Alice','Bob'].map(chaId=>({chaId,globalLore:[{comment:chaId,key:chaId,content:chaId}],chats:[]}));
 const c={Map,Set,console,structuredClone,risuai:{getDatabase:async()=>({characters:chars,modules:[]}),getCurrentLorebookEntries:async()=>chars[0].globalLore},
  read:async id=>saved.get(id),write:async(id,value)=>saved.set(id,value),llm:()=>{const d=deferred();calls.push(d);return d.promise;}};
 const bundle=await build({entryPoints:['src/services/lorefilter.ts'],bundle:true,write:false,format:'iife',globalName:'Api',plugins:[{name:'ports',setup(b){
  b.onResolve({filter:/^(\.\/llm-call\.ts|\.\/settings\.ts|\.\/context\.ts|\.\.\/storage\/stores\.ts|\.\.\/storage\/character-roster\.ts)$/},a=>({path:a.path,namespace:'port'}));
  b.onLoad({filter:/.*/,namespace:'port'},a=>({contents:a.path.includes('llm-call')?'export const callLlm=(...a)=>globalThis.llm(...a)':a.path.includes('character-roster')?'export const readCharacterEntryKey=(id)=>globalThis.read(id); export const writeCharacterEntryKey=(id,k,v)=>globalThis.write(id,v)':a.path.includes('stores')?'export const idbGet=async()=>null':a.path.includes('settings')?'export const getPrompt=async()=>"scan"':'export const getConfig=()=>({llm:{},card:{}})',loader:'js'}));
 }}]});
 runInNewContext(bundle.outputFiles[0].text,c);
 return {api:c.Api,saved,calls,chars};
}
const tick=()=>new Promise(r=>setImmediate(r));
test('lore catalog belongs to the requested bot, never the current host bot',async()=>{
 const {api}=await runtime();
 const result=await api.getLorefilterPayload({character_id:'Bob'});
 assert.deepEqual(Array.from(result.catalog,r=>r.title),['Bob']);
});
test('empty explicit lore is authoritative and must not fall back to the live bot',async()=>{
 const {api}=await runtime();
 const result=await api.getLorefilterPayload({character_id:'Bob',lorebook:[]});
 assert.equal(result.catalog.length,0);
});
test('simultaneous scans share one request and late LLM cannot undo a manual selection',async()=>{
 const {api,calls,saved,chars}=await runtime();
 const a=api.ensureLorefilter('Alice',chars[0].globalLore);
 const b=api.ensureLorefilter('Alice',chars[0].globalLore);
 await tick();assert.equal(calls.length,1);
 await api.setLorefilterSelected({character_id:'Alice',selected:[]});
 calls[0].resolve('["Alice"]');await Promise.all([a,b]);
 assert.deepEqual(Array.from(saved.get('Alice')),[]);
 await api.ensureLorefilter('Alice',chars[0].globalLore);
 assert.equal(calls.length,1,'deliberately empty selection is initialized');
});
test('two bots can finish scans in reverse order without sharing saved selections',async()=>{
 const {api,calls,saved,chars}=await runtime();
 const a=api.ensureLorefilter('Alice',chars[0].globalLore),b=api.ensureLorefilter('Bob',chars[1].globalLore);
 await tick();calls[1].resolve('["Bob"]');await b;calls[0].resolve('["Alice"]');await a;
 assert.deepEqual(Array.from(saved.get('Alice')),['t:alice']);assert.deepEqual(Array.from(saved.get('Bob')),['t:bob']);
});
