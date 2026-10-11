import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
import {PNG_1X1} from '../tools/parity/host.mjs';

const mutations=[];
if(process.env.BREAK_PREVIEW_STALE||process.env.BREAK_PREVIEW_BUDGET) mutations.push({name:'break-preview-guards',setup(build){
 build.onLoad({filter:/character-image-hydration\.ts$|char-ref-module\.ts$/},async({path})=>{
  const source=await readFile(path,'utf8');let text=source;
  if(process.env.BREAK_PREVIEW_STALE&&path.endsWith('character-image-hydration.ts'))text=text.replace('if (hash !== target.hash || !current()) return;','if (!current()) return;');
  if(process.env.BREAK_PREVIEW_BUDGET&&path.endsWith('char-ref-module.ts'))text=text.replace('const PREVIEW_BUDGET = 8 * 1024 * 1024;','const PREVIEW_BUDGET = Infinity;');
  if((process.env.BREAK_PREVIEW_STALE&&path.endsWith('character-image-hydration.ts'))||(process.env.BREAK_PREVIEW_BUDGET&&path.endsWith('char-ref-module.ts')))assert.notEqual(text,source);
  return {contents:text,loader:'ts'};
 });
}});
const bundle=await build({stdin:{contents:`export {hydrateCharRefs} from './src/services/nai-assets';export {getCharRefAssetPreviewUrl} from './src/services/char-ref-module';export {subscribeCharacterImages} from './src/core/character-ui-events';export {unifiedSessionIdForCharacter,sessionIdHash} from './src/core/util/text';export {getCharRefPreviewUrl,getExamplePreviewUrl} from './src/services/context';`,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'esm',platform:'node',plugins:mutations});
let generation=0;
async function fixture(count,{shared=false,holdFirst=false}={}) {
 const api=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text+`\n// fixture ${generation++}`).toString('base64'));
 const hash=i=>(shared?1:i+1).toString(16).padStart(64,'0');
 const roster=Array.from({length:count},(_,i)=>({id:'c'+i,name:'Character '+i,appearance:'girl',ref_hash:hash(i),...(shared?{example_hash:hash(i)}:{})}));
 const bot=(id,rows)=>({chaId:id,chats:[{id:'chat-'+id}],globalLore:[{comment:'omni.nexus.data.global',key:'',alwaysActive:false,mode:'normal',content:JSON.stringify({version:1,characterId:id,roster:rows})}]});
 const bots=[bot('A',roster),bot('B',[{id:'other',name:'Other',ref_hash:'f'.repeat(64)}])];
 const assets=Array.from(new Set(roster.map(r=>r.ref_hash)),h=>[`inxref_${h}.webp`,'asset-'+h,`inxref_${h}.webp`]);
 const modules=[{id:'inlay-char-ref',name:'Inlay 참고이미지',namespace:'inlay.char_ref',assets},{id:'inlay-inray-display',namespace:'inlay.inray_display',lorebook:[],assets:[]}];
 const reads={bots:[0,0],images:0,directories:0},events=[];
 let release;
 const held=new Promise(resolve=>{release=resolve;});
 globalThis.risuai={
  getDatabase:async keys=>{if(keys?.includes('characters'))reads.directories++;return {characters:structuredClone(bots),modules:structuredClone(modules),enabledModules:['inlay-char-ref']};},
  setDatabase:async()=>{},requestPluginPermission:async()=>{},
  getCharacterFromIndex:async i=>{reads.bots[i]++;await new Promise(resolve=>setTimeout(resolve,2));return structuredClone(bots[i]);},
  readImage:async path=>{reads.images++;if(holdFirst&&path==='asset-'+hash(0))await held;else await new Promise(resolve=>setTimeout(resolve,2));return PNG_1X1;},
 };
 api.subscribeCharacterImages(event=>events.push(event));
 return {api,bots,reads,events,release,hash,scope:api.unifiedSessionIdForCharacter('A')};
}
async function until(fn) {
 const end=Date.now()+5000;
 while(!fn()){if(Date.now()>end)throw Error('thumbnail did not arrive');await new Promise(resolve=>setTimeout(resolve,5));}
}

test('120 character previews avoid unrelated bot reads and share reference/example pixels',async()=>{
 const f=await fixture(120,{shared:true});
 const result=await f.api.hydrateCharRefs({sessionId:f.scope});
 assert.equal(result.session.length,120);
 await until(()=>f.events.filter(e=>e.url).length===240);
 console.log('120-character loading work:',JSON.stringify(f.reads));
 assert.equal(f.reads.bots[1],0,'a selected roster must not load unrelated bots');
 assert.equal(f.reads.images,1,'the same content hash is decoded once for both preview kinds');
 assert.ok(f.reads.bots[0]<=62,`fresh validation must share roster reads: ${f.reads.bots[0]}`);
 const again=await f.api.hydrateCharRefs({sessionId:f.scope});
 assert.ok(again.session.every(row=>row.preview_url&&row.example_preview_url));
 assert.equal(f.reads.images,1,'reopening reuses previews without another pixel read');
});

test('distinct character images keep their own pixels while sharing fresh roster validation',async()=>{
 const f=await fixture(120);
 const result=await f.api.hydrateCharRefs({sessionId:f.scope});
 assert.equal(result.session.length,120);
 await until(()=>f.events.filter(e=>e.url).length===120);
 assert.equal(f.reads.images,120);
 assert.equal(f.reads.bots[1],0);
 assert.ok(f.reads.bots[0]<=62,`fresh validation must not reload the roster per image: ${f.reads.bots[0]}`);
 assert.deepEqual(new Set(f.events.map(e=>e.hash)),new Set(Array.from({length:120},(_,i)=>f.hash(i))));
 console.log('120 distinct images:',JSON.stringify(f.reads));
});

test('single-character hydration accepts chat aliases and publishes to the requested chat',async()=>{
 const f=await fixture(2);
 const sessionId='risu_'+f.api.sessionIdHash('A|chat-A');
 const result=await f.api.hydrateCharRefs({sessionId,scope:sessionId,characterId:'c1'});
 assert.equal(result.session.length,1);
 assert.equal(result.session[0].scope,sessionId);
 await until(()=>f.events.some(e=>e.url));
 assert.deepEqual(f.events.map(e=>[e.scope,e.id]),[[sessionId,'c1']]);
 assert.equal(f.reads.bots[1],0);
});

test('unreadable images are retried and the shared preview cache evicts by byte budget',async()=>{
 const f=await fixture(2);
 const original=globalThis.risuai.readImage;
 let fail=true;
 const large=new Uint8Array(2*1024*1024);large.set(PNG_1X1);
 globalThis.risuai.readImage=async path=>{await original(path);if(fail){fail=false;return new Uint8Array();}return large;};
 assert.equal(await f.api.getCharRefAssetPreviewUrl(f.hash(0)),'');
 assert.ok((await f.api.getCharRefAssetPreviewUrl(f.hash(0))).startsWith('data:image/png;base64,'));
 assert.equal(f.reads.images,2,'failed reads cannot become permanent cache misses');
 await f.api.getCharRefAssetPreviewUrl(f.hash(1));
 await f.api.getCharRefAssetPreviewUrl(f.hash(0));
 assert.equal(f.reads.images,4,'large previews cannot accumulate beyond the cache budget');
});

test('a slow first image does not block later thumbnails, and replacement wins over old loading work',async()=>{
 const f=await fixture(9,{holdFirst:true});
 try {
  const result=await f.api.hydrateCharRefs({sessionId:f.scope});
  assert.equal(result.session.length,9);
  await until(()=>f.events.some(e=>e.id==='c8'&&e.url));
  const data=JSON.parse(f.bots[0].globalLore[0].content);
  data.roster[0].ref_hash='e'.repeat(64);
  f.bots[0].globalLore[0].content=JSON.stringify(data);
  f.release();
  await new Promise(resolve=>setTimeout(resolve,30));
  assert.equal(f.events.some(e=>e.id==='c0'&&e.hash===f.hash(0)),false);
  assert.equal(f.api.getCharRefPreviewUrl(f.scope,'c0'),'','an old image cannot poison the preview cache');
 } finally {f.release();}
});
