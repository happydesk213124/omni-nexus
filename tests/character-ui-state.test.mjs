import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {build} from 'esbuild';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
async function runtime() {
 const source=await readFile('tools/vendor-patches/omni-repairs.mjs','utf8');
 const code=source.match(/replace\('    globalThis\.__OMNI_FLUSH_CHARACTERS__ = flush;', `([\s\S]*?)`\);/)[1];
 const t={lastScope:{sessionId:'risu_A|__unified__'},charactersSession:[{id:'a',name:'Alice'}],charactersGlobal:[{id:'g',name:'Global'}],charCatalog:[{index:0,chaId:'A',name:'A'},{index:1,chaId:'B',name:'B'}]};
 const reads=[],renders=[],save=deferred();
 const context={t,Map,Set,Number,String,Array,encodeURIComponent,
  document:{querySelector:()=>null,getElementById:()=>null},
  flush:()=>save.promise, k:{getCurrentCharacterIndex:async()=>0},ye:s=>s,
  P:async()=>{renders.push(t.lastScope.sessionId);},$e:()=>{},z:String,
  K:(url)=>{const wait=deferred();reads.push({url,...wait});return wait.promise;}};
 runInNewContext(code,context);
 return {context,t,reads,renders,save};
}
test('scope reads do not wait for writes; stale A/B responses cannot overwrite global/latest selection',async()=>{
 const {context:c,t,reads,save}=await runtime();
 const a=c.__OMNI_SELECT_CHARACTER_SCOPE__('1');
 assert.equal(reads.length,1);
 const global=c.__OMNI_SELECT_CHARACTER_SCOPE__('__global__');await global;
 reads[0].resolve({characters:[{id:'b'}],global:[]});await a;
 assert.equal(t.lastScope.sessionId,'risu_A|__unified__');
 const b=c.__OMNI_SELECT_CHARACTER_SCOPE__('1');
 reads[1].resolve({characters:[{id:'b'}],global:[]});await b;
 assert.equal(t.lastScope.sessionId,'risu_B|__unified__');
 assert.equal(t.charactersSession[0].id,'b');
 save.resolve();
});
test('failed transition restores the last good scope; a deleted row is filtered from late reads',async()=>{
 const {context:c,t,reads,save}=await runtime();save.resolve();
 const fail=c.__OMNI_SELECT_CHARACTER_SCOPE__('1');
 reads[0].reject(new Error('read failed'));await assert.rejects(fail,/read failed/);
 assert.equal(t.charactersSession[0].id,'a');
 const next=c.__OMNI_SELECT_CHARACTER_SCOPE__('1');
 c.__OMNI_REMOVE_CHARACTER_CACHE__('session',['b'],'risu_B|__unified__');
 reads[1].resolve({characters:[{id:'b'},{id:'c'}],global:[]});await next;
 assert.deepEqual(Array.from(t.charactersSession,row=>row.id),['c']);
 c.__OMNI_RESTORE_CHARACTER_CACHE__('session',[{id:'b'}],'risu_B|__unified__');
 assert.deepEqual(Array.from(t.charactersSession,row=>row.id),['c','b']);
});
test('preview publication is scoped; an old read cannot replace a write or erase a known hash',async()=>{
 const b=await build({entryPoints:['src/core/character-ui-events.ts'],bundle:true,write:false,format:'iife',globalName:'Images'});
 const c={};runInNewContext(b.outputFiles[0].text,c);const images=c.Images;
 const read=images.beginCharacterImage('a','id','ref',false);
 const write=images.beginCharacterImage('a','id','ref');
 const during=images.beginCharacterImage('a','id','ref',false);
 images.endCharacterImage('a','id','ref');
 assert.equal(read(),false);assert.equal(during(),false);assert.equal(write(),true);
 images.publishCharacterImage({scope:'a',id:'id',kind:'ref',url:'a-url',hash:'a-hash',configured:true});
 images.publishCharacterImage({scope:'b',id:'id',kind:'ref',url:'b-url',hash:'b-hash',configured:true});
 assert.equal(images.characterImages().length,2);
 const patch=images.characterImagePatch({scope:'a',id:'id',kind:'ref',url:'new-url',configured:true});
 assert.equal('ref_hash' in patch,false);
});


test('switching back to a cached bot repaints so the lorebook reloads',async()=>{
  const {context:c,t,reads,renders,save}=await runtime();save.resolve();
  const empty={characters:[],global:[],appearance:{}};
  const alice={characters:[{id:'a',name:'Alice'}],global:[{id:'g',name:'Global'}],appearance:{}};
  const first=c.__OMNI_SELECT_CHARACTER_SCOPE__('1');
  reads[0].resolve(structuredClone(empty));await first;
  assert.equal(renders.length,1);
  const second=c.__OMNI_SELECT_CHARACTER_SCOPE__('0');
  await new Promise(resolve=>setImmediate(resolve));
  reads[1].resolve(structuredClone(alice));await second;
  assert.equal(renders.length,2,'cached identical roster must not repaint twice');
  const back=c.__OMNI_SELECT_CHARACTER_SCOPE__('1');
  await new Promise(resolve=>setImmediate(resolve));
  reads[2].resolve(structuredClone(empty));await back;
  assert.equal(renders.length,3,'cached bot with identical roster must still repaint on switch');
  assert.equal(t.lastScope.sessionId,'risu_B|__unified__');
});
test('reselecting a clean cached scope skips repaints while the list is unchanged',async()=>{
  const {context:c,t,reads,renders,save}=await runtime();save.resolve();
  const first=c.__OMNI_SELECT_CHARACTER_SCOPE__('1');
  reads[0].resolve({characters:[{id:'b',name:'B'}],global:[],appearance:{}});await first;
  assert.equal(renders.length,1);
  const second=c.__OMNI_SELECT_CHARACTER_SCOPE__('1');
  await new Promise(resolve=>setImmediate(resolve));
  reads[1].resolve({characters:[{id:'b',name:'B'}],global:[],appearance:{}});await second;
  assert.equal(reads.length,2,'freshness fetch still runs');
  assert.equal(renders.length,1,'identical list must not repaint');
  const third=c.__OMNI_SELECT_CHARACTER_SCOPE__('1');
  await new Promise(resolve=>setImmediate(resolve));
  reads[2].resolve({characters:[{id:'b',name:'B2'}],global:[],appearance:{}});await third;
  assert.equal(renders.length,2,'changed list must repaint');
  assert.equal(t.charactersSession[0].name,'B2');
});
test('a cached edited roster paints immediately but cannot be replaced before its pending save',async()=>{
 const {context:c,t,reads,save}=await runtime();
 t._omniRosterCache.set('risu_B|__unified__',{characters:[{id:'b',name:'Edited'}],global:[],dirty:true});
 const switching=c.__OMNI_SELECT_CHARACTER_SCOPE__('1');
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(t.charactersSession[0].name,'Edited');assert.equal(reads.length,0);
 save.resolve();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(reads.length,1);
 t._omniRosterRevision=1;
 reads[0].resolve({characters:[{id:'b',name:'Stale'}],global:[]});await switching;
 assert.equal(t.charactersSession[0].name,'Edited');
});
test('character sample uses the selected full costume, inheritance and bottoms without forcing 1girl',async()=>{
 const b=await build({entryPoints:['src/services/character-preview.ts'],bundle:true,write:false,format:'iife',globalName:'Preview'});
 const c={TextEncoder,TextDecoder,Uint8Array,ArrayBuffer,URL,AbortController,Map,Set,setTimeout,clearTimeout};runInNewContext(b.outputFiles[0].text,c);
 const tags=c.Preview.characterPreviewTags({original:'series',gender:'boy',appearance:'wrong',hair_color:'wrong hair',costumes:[
 {name:'default',appearance:'1boy',hair_color:'black hair',hair_style:'short hair',eye_color:'blue eyes',height:'180',age:'20',attire:'shirt',bottoms:'trousers',accessories:'bag'},
 {name:'magic',appearance:'[base]',hair_color:'pink hair',hair_style:'long hair',eye_color:'gold eyes',height:'190',age:'30',attire:'robe',bottoms:'shorts',accessories:'staff'}],active_costume:1});
 for(const tag of ['series','1boy','pink hair','long hair','gold eyes','robe','shorts','staff'])assert.ok(tags.includes(tag),tag);
 assert.doesNotMatch(tags,/\[base\]|wrong|1girl|black hair|trousers/);
});
