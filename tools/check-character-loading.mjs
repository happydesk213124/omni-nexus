import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {PNG_1X1} from './parity/host.mjs';

let full=await readFile('dist/omninexus.js','utf8');
assert.equal(full.split('  await Qa();').length,2);
if(process.argv.includes('--break-eager')) {
 const changed=full.replaceAll('loadInitial: false','loadInitial: true');
 assert.notEqual(changed,full);full=changed;
}
if(process.argv.includes('--break-edit-metadata')) {
 const seam='document.querySelectorAll("[data-global-toggle]").forEach((a) => {';
 assert.equal(full.split(seam).length,2);
 full=full.replace(seam,`document.querySelectorAll("[data-char-scope] input, [data-char-scope] textarea").forEach(a=>{
  a.addEventListener("input",()=>{t._charsDirty=true;t.charactersSession=oe("session");t.charactersGlobal=oe("global");});
 }), `+seam);
}
const browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
try {
 const page=await browser.newPage({viewport:{width:1100,height:800}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto('about:blank');
 await page.evaluate(png=>{
  const kv=new Map(),hash=i=>(i+1).toString(16).padStart(64,'0');
  const roster=Array.from({length:120},(_,i)=>({id:'person-'+i,name:'Person '+String(i).padStart(3,'0'),appearance:'girl, black hair',ref_hash:hash(i),example_hash:hash(i),costumes:[{name:'default',attire:'shirt'},{name:'winter',attire:'coat'}]}));
  const chars=Array.from({length:2},(_,i)=>({chaId:'bot-'+i,name:'Bot '+i,globalLore:[{comment:'omni.nexus.data.global',key:'',alwaysActive:false,mode:'normal',content:JSON.stringify({version:1,characterId:'bot-'+i,roster:i?[{id:'other',name:'Other',appearance:'boy'}]:roster})}],chats:[{id:'chat-'+i,message:[]}]}));
  let modules=[{id:'inlay-char-ref',name:'Inlay 참고이미지',namespace:'inlay.char_ref',assets:roster.map((r,i)=>['inxref_'+hash(i)+'.webp','asset-'+i,'inxref_'+hash(i)+'.webp'])},{id:'inlay-inray-display',namespace:'inlay.inray_display',lorebook:[],assets:[]}];
  globalThis.loadingTest={db:0,bot:0,images:[],examples:0,index:0,urls:[],revoked:[]};
  const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);
  URL.createObjectURL=b=>{const url=create(b);loadingTest.urls.push(url);return url;};
  URL.revokeObjectURL=url=>{loadingTest.revoked.push(url);revoke(url);};
  globalThis.risuai={pluginStorage:{getItem:async k=>kv.get(k),setItem:async(k,v)=>kv.set(k,v),removeItem:async k=>kv.delete(k)},getArgument:async()=>'',
   readImage:async path=>{loadingTest.images.push(path);if(path!=='asset-0'&&!loadingTest.released)await new Promise(resolve=>(loadingTest.waiters||=[]).push(resolve));return new Uint8Array(png);},
   getDatabase:async()=>{loadingTest.db++;return {characters:structuredClone(chars),modules:structuredClone(modules),enabledModules:['inlay-char-ref']};},
   setDatabase:async v=>{if(v.modules)modules=structuredClone(v.modules);},
   getCharacterFromIndex:async i=>{loadingTest.bot++;return structuredClone(chars[i]);},setCharacterToIndex:async(i,c)=>{chars[i]=structuredClone(c);},
   getCurrentCharacterIndex:async()=>loadingTest.index,getCurrentChatIndex:async()=>0,getChatFromIndex:async i=>structuredClone(chars[i].chats[0]),
  };
 },Array.from(PNG_1X1));
 await page.addScriptTag({type:'module',content:full.replace('  await Qa();',`
  { await le();await ia();t.lastScope=await Z();t.uiOpen=true;t.uiTab='characters';
  const data=await K('/v1/characters?session_id='+encodeURIComponent(t.lastScope.sessionId));
  t.charactersSession=data.characters;t.charactersGlobal=data.global||[];
  const native=globalThis.__INLAY_NATIVE__,fetch=native.fetch;
  native.fetch=async function(url,...args){if(url.startsWith('/v1/characters/example-shot?'))loadingTest.examples++;return fetch.call(this,url,...args);};
  Object.assign(loadingTest,{paint:P,t});loadingTest.db=loadingTest.bot=0;
  const at=performance.now();await P();await new Promise(r=>setTimeout(r,0));loadingTest.yieldMs=performance.now()-at; }
 `)});
 const first='[data-ux-character-tile="person-0"] img';
 await page.waitForFunction(selector=>{const img=document.querySelector(selector);return img?.naturalWidth>0;},first,{timeout:5000}).catch(async error=>{
  console.log(errors,await page.evaluate(()=>({images:loadingTest.images,db:loadingTest.db,bot:loadingTest.bot,card:document.querySelector('.char-card')?.outerHTML.slice(0,600),tile:document.querySelector('[data-ux-character-tile]')?.outerHTML,rows:globalThis.__OMNI_CHARACTER_ROWS__?.().session.slice(0,1)})));throw error;
 });
 const initial=await page.evaluate(()=>({db:loadingTest.db,bot:loadingTest.bot,images:loadingTest.images.length,examples:loadingTest.examples,yieldMs:loadingTest.yieldMs}));
 assert.equal(initial.examples,0,'opening 120 characters must not issue one example request per character');
 assert.ok(initial.images>0&&initial.images<120,'edit must happen while image reads are still pending');
 assert.match(await page.locator(first).getAttribute('src'),/^blob:/,'display must avoid base64 conversion');
 await page.locator('#nx-char-edit-btn').click();
 await page.locator('#nx-char-edit-body [data-char-name]').fill('Renamed during loading');
 const hashes=()=>page.evaluate(()=>__OMNI_CHARACTER_ROWS__().session.map(row=>[row.id,row.ref_hash,row.example_hash]));
 const expected=Array.from({length:120},(_,i)=>['person-'+i,(i+1).toString(16).padStart(64,'0'),(i+1).toString(16).padStart(64,'0')]);
 assert.deepEqual(await hashes(),expected,'typing must preserve image identities for the whole roster');
 await page.locator('#nx-char-sheet-close').click();
 await page.evaluate(()=>__OMNI_FLUSH_CHARACTERS__());
 assert.deepEqual(await hashes(),expected,'saving must preserve image identities for the whole roster');
 assert.equal(await page.evaluate(()=>__OMNI_CHARACTER_ROWS__().session[0].name),'Renamed during loading');
 await page.evaluate(()=>{loadingTest.released=true;for(const resolve of loadingTest.waiters||[])resolve();});
 await page.waitForFunction(()=>{
  const cards=[...document.querySelectorAll('.char-card[data-char-id]')];
  return cards.length===120&&cards.every(card=>['[data-char-ref-preview] img','[data-char-ex-preview] img'].every(selector=>card.querySelector(selector)?.naturalWidth>0));
 });
 assert.equal(await page.locator('[data-ux-character-tile] img[data-character-preview]').count(),120,'all thumbnails must load without scrolling after an edit');
 assert.equal(await page.evaluate(()=>loadingTest.images.length),120,'shared ref/example hashes must read each image only once');
 assert.equal(await page.evaluate(()=>new Set(loadingTest.images).size),120);
 assert.equal(await page.evaluate(()=>loadingTest.examples),0);
 const before=await page.evaluate(()=>({urls:[...loadingTest.urls],firstReads:loadingTest.images.filter(p=>p==='asset-0').length}));
 await page.evaluate(()=>loadingTest.paint());
 await page.waitForFunction(selector=>document.querySelector(selector)?.naturalWidth>0,first);
 assert.equal(await page.evaluate(n=>loadingTest.images.filter(p=>p==='asset-0').length===n,before.firstReads),true,'repaint should reuse bytes');
 assert.equal(await page.evaluate(urls=>urls.every(url=>loadingTest.revoked.includes(url)),before.urls),true,'replaced form must release its blob URLs');
 await page.locator('#nx-char-risu-open').click();
 await page.waitForFunction(()=>document.querySelector('[data-risu-value="live"]'));
 await page.evaluate(()=>{loadingTest.switches=0;const select=globalThis.__OMNI_SELECT_CHARACTER_SCOPE__;globalThis.__OMNI_SELECT_CHARACTER_SCOPE__=async(...args)=>{loadingTest.switches++;return select(...args);};});
 await page.locator('[data-risu-value="live"]').click();
 assert.equal(await page.evaluate(()=>loadingTest.switches),0,'same current chat must not reload the roster');
 await page.evaluate(()=>{loadingTest.index=1;});
 await page.locator('[data-risu-value="live"]').click();
 await page.waitForFunction(()=>document.querySelector('.char-card[data-char-id="other"]'));
 assert.equal(await page.evaluate(()=>loadingTest.switches),1,'current chat must follow a changed host selection');
 assert.deepEqual(errors,[]);
 console.log('character loading:',JSON.stringify(initial),'all 120 images without scroll, edit during loading, cached redraw, URL cleanup, current-chat navigation passed');
} finally {await browser.close();}
