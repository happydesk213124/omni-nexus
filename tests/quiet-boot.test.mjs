import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
test('second boot neither writes chats/settings/modules nor decodes reference images',async()=>{
 const built=await build({stdin:{contents:`export {ready,dataReady} from './src/bridge/native';export {flushPersist} from './src/storage/stores';export {ensureInrayDisplayModule} from './src/storage/inray-display-module';export {DEFAULT_CONFIG} from './src/config/defaults';`,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'esm',platform:'node',loader:{'.txt':'text'}});
 const code=built.outputFiles[0].text,kv=new Map(),reads=[],writes=[];let legacyOpens=0,keyScans=0;
 let db={modules:[],enabledModules:[],characters:[]};
 globalThis.risuai={getLocalPluginStorage:async()=>{legacyOpens++;throw Error('boot must not open legacy IDB');},pluginStorage:{keys:async()=>{keyScans++;throw Error('boot must not enumerate save keys');},getItem:async key=>{reads.push(key);return structuredClone(kv.get(key));},setItem:async(key,value)=>{writes.push('settings');kv.set(key,structuredClone(value));},removeItem:async key=>kv.delete(key)},getDatabase:async()=>structuredClone(db),setDatabase:async next=>{writes.push('module');db={...db,...structuredClone(next)};},getChatFromIndex:async()=>{throw Error('boot read a chat');},setChatToIndex:async()=>{throw Error('boot wrote a chat');}};
 const load=n=>import('data:text/javascript;base64,'+Buffer.from(code+'\n//boot '+n).toString('base64'));
 const first=await load(1);await first.ready();await first.dataReady();await first.ensureInrayDisplayModule();await first.flushPersist();
 const installedWrites=writes.length;
 const meta=kv.get('onx_nxstore_meta');
 assert.ok(meta,'first install must persist its prompt pack');
 const value=typeof meta==='string'?JSON.parse(meta):meta;
 value.reference_image={key:'reference_image'};kv.set('onx_nxstore_meta',value);kv.set('onx_nxref_image','AQID');
 writes.length=0;reads.length=0;
 const second=await load(2),start=performance.now();await second.ready();await second.dataReady();await second.ensureInrayDisplayModule();await second.flushPersist();
 assert.deepEqual(writes,[]);assert.equal(legacyOpens,0);assert.equal(keyScans,0);
 assert.ok(!reads.includes('onx_nxref_image'));
 console.log('[boot fixture] first-install writes='+installedWrites+'; second-boot writes=0; second-ready ms='+Math.round(performance.now()-start));
 delete globalThis.risuai;
});

test('a slow image store does not hold back the settings read; data routes still wait for it',async()=>{
 const built=await build({stdin:{contents:`export {ready,fetch} from './src/bridge/native';`,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'esm',platform:'node',loader:{'.txt':'text'}});
 const kv=new Map();let release;const gate=new Promise(resolve=>{release=resolve;});
 // RisuNest took ~10s on this read; here it hangs until released.
 globalThis.risuai={pluginStorage:{getItem:async key=>{if(key==='onx_nxstore_meta')await gate;return structuredClone(kv.get(key));},setItem:async(key,value)=>{kv.set(key,structuredClone(value));},removeItem:async key=>kv.delete(key)},getDatabase:async()=>({modules:[],enabledModules:[],characters:[]}),setDatabase:async()=>{}};
 const api=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text+'\n//slow store').toString('base64'));
 await api.ready();
 const settings=await Promise.race([api.fetch('/v1/settings',{method:'GET'}),new Promise((_,reject)=>setTimeout(()=>reject(new Error('the settings read waited for the image store')),2000))]);
 assert.ok(settings?.settings,'settings answer while the image store is still loading');
 let gallery=false;const pending=api.fetch('/v1/gallery?session_id=s&limit=1',{method:'GET'}).then(()=>{gallery=true;});
 await new Promise(resolve=>setTimeout(resolve,30));
 assert.equal(gallery,false,'the gallery waits for the image store');
 release();await pending;assert.equal(gallery,true);
 delete globalThis.risuai;
});
