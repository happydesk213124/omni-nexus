import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';

const full=await readFile('dist/omninexus.js','utf8');
assert.equal(full.split('  await Qa();').length,2);
const browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
try {
 const page=await browser.newPage({viewport:{width:900,height:700}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto('about:blank');
 await page.evaluate(()=>{
  const kv=new Map();
  const chars=Array.from({length:50},(_,i)=>({chaId:'bot-'+i,name:'Bot '+i,globalLore:[],chats:[{id:'chat-'+i,message:[]}]}));
  globalThis.risuai={
   pluginStorage:{getItem:async k=>kv.get(k),setItem:async(k,v)=>kv.set(k,v),removeItem:async k=>kv.delete(k)},
   getArgument:async()=>'',getDatabase:async()=>({characters:structuredClone(chars),modules:[]}),
   getCharacterFromIndex:async i=>structuredClone(chars[i]),setCharacterToIndex:async(i,c)=>{chars[i]=structuredClone(c);},
   getCurrentCharacterIndex:async()=>0,getCurrentChatIndex:async()=>0,getChatFromIndex:async i=>structuredClone(chars[i].chats[0]),
  };
 });
 await page.addScriptTag({type:'module',content:full.replace('  await Qa();',`
   await le(); await ia(); t.lastScope=await Z(); t.uiOpen=true; t.uiTab='characters';
   const actualK=K;
   const pending=[];
   K=async (url,options,...rest)=>{
     if(url.includes('/v1/characters/lorefilter')) {
       const cid=options?.body?.character_id || new URL(url,'https://test.invalid').searchParams.get('character_id');
       if(options?.body?.rescan) return new Promise(resolve=>pending.push({cid,resolve}));
       if(Array.isArray(options?.body?.selected))return {ok:true,character_id:cid,selected:options.body.selected,initialized:true};
       return {ok:true,character_id:cid,selected:[],catalog:[{id:'t:'+cid,title:cid,keys:[cid],content:'Lore '+cid}],initialized:false};
     }
     if(url.startsWith('/v1/characters?'))await new Promise(resolve=>setTimeout(resolve,120));
     return actualK(url,options,...rest);
   };
   globalThis.switchTest={t,paint:P,pending,complete(cid){const at=pending.findIndex(p=>p.cid===cid);if(at<0)throw Error('missing scan '+cid);const p=pending.splice(at,1)[0];p.resolve({ok:true,character_id:cid,selected:['t:'+cid],catalog:[{id:'t:'+cid,title:cid,keys:[cid],content:'Lore '+cid}],initialized:true});}};
   ${process.argv.includes('--break-navigation') ? 'globalThis.__INLAY_SETTINGS_UX__.replaceMain=(main,html)=>{main.innerHTML=html;};' : ''}
   await P();
  `)});
 await page.waitForFunction(()=>globalThis.switchTest?.pending.length===1);
 await page.locator('#nx-char-risu-open').click();
 await page.locator('[data-risu-value="20"]').waitFor();
 const before=await page.evaluate(()=>{
  const rail=document.getElementById('nx-risu-pick-tiles');
  rail.scrollTop=500;
  globalThis.savedRail=rail;globalThis.savedHeader=document.getElementById('nx-risu-current');
  const names=[];globalThis.headerNames=names;
  new MutationObserver(()=>names.push(document.getElementById('nx-risu-current')?.textContent)).observe(document.getElementById('nx-main'),{subtree:true,childList:true,characterData:true});
  document.querySelector('[data-risu-value="20"]').click();
  return {top:rail.scrollTop,name:document.getElementById('nx-risu-current').textContent};
 });
 assert.equal(before.name,'Bot 20','clicked bot name must be synchronous');
 assert.ok(before.top>0);
 await page.waitForFunction(()=>switchTest.t.lastScope.characterId==='bot-20' && switchTest.pending.some(p=>p.cid==='bot-20'));
 const after=await page.evaluate(()=>({sameRail:savedRail===document.getElementById('nx-risu-pick-tiles'),sameHeader:savedHeader===document.getElementById('nx-risu-current'),top:savedRail.scrollTop,names:headerNames}));
 assert.equal(after.sameRail,true,'navigation DOM must survive the content render');
 assert.equal(after.sameHeader,true);
 assert.equal(after.top,before.top,'switch must preserve rail scroll');
 assert.ok(after.names.every(name=>name==='Bot 20'),JSON.stringify(after.names));
 // Finish the first bot after the second is visible: it must not repaint B.
 await page.evaluate(()=>switchTest.complete('bot-0'));
 await page.waitForFunction(()=>switchTest.t._omniLoreStates.get('bot-0').busy===false);
 assert.equal(await page.locator('[data-lorefilter-chip="t:bot-0"]').count(),0);
 await page.evaluate(()=>switchTest.complete('bot-20'));
 await page.waitForFunction(()=>!!document.querySelector('[data-lorefilter-chip="t:bot-20"]'));
 assert.equal(await page.locator('#nx-risu-pick-tiles').evaluate(el=>el.scrollTop),before.top);
 // Both directions use cached rosters, and repeated renders keep the rail bound.
 for(const value of ['0','20','0','20']) {
  await page.locator(`[data-risu-value="${value}"]`).evaluate(el=>el.click());
  await page.waitForFunction(value=>switchTest.t.lastScope.characterId==='bot-'+value,value);
  await page.waitForFunction(value=>document.querySelector(`[data-risu-value="${value}"]`)?.getAttribute('aria-busy')==='false',value);
  assert.equal(await page.locator('#nx-risu-current').textContent(),'Bot '+value);
  assert.equal(await page.locator('#nx-risu-pick-tiles').evaluate(el=>el.scrollTop),before.top);
 }
 await page.evaluate(()=>{
  for(const value of ['1','2','20'])document.querySelector('[data-risu-value="'+value+'"]').click();
 });
 await page.waitForFunction(()=>document.querySelector('[data-risu-value="20"]')?.getAttribute('aria-busy')==='false');
 assert.equal(await page.locator('#nx-risu-current').textContent(),'Bot 20');
 assert.equal(await page.locator('#nx-risu-pick-tiles').evaluate(el=>el.scrollTop),before.top);
 // A manually requested scan is isolated too, even when its old DOM is gone.
 await page.locator('#nx-lorefilter-rescan').evaluate(el=>el.click());
 await page.waitForFunction(()=>switchTest.pending.some(p=>p.cid==='bot-20'));
 await page.locator('[data-risu-value="0"]').evaluate(el=>el.click());
 await page.waitForFunction(()=>document.querySelector('[data-risu-value="0"]')?.getAttribute('aria-busy')==='false');
 await page.evaluate(()=>switchTest.complete('bot-20'));
 await page.waitForFunction(()=>!switchTest.t._omniLoreStates.get('bot-20').busy);
 assert.equal(await page.locator('[data-lorefilter-chip="t:bot-20"]').count(),0);
 await page.locator('[data-lorefilter-peek="t:bot-0"]').evaluate(el=>el.click());
 assert.match(await page.locator('#nx-lorefilter-peek').textContent(),/Lore bot-0/);
 await page.locator('#nx-lorefilter-peek-remove').evaluate(el=>el.click());
 await page.waitForFunction(()=>!document.querySelector('[data-lorefilter-chip="t:bot-0"]'));
 await page.locator('#nx-lorefilter-toggle-add').evaluate(el=>el.click());
 await page.locator('[data-lorefilter-add="t:bot-0"]').evaluate(el=>el.click());
 await page.waitForFunction(()=>!!document.querySelector('[data-lorefilter-chip="t:bot-0"]'));
 // The preserved global tile and rail close/open controls must still target the new form.
 await page.locator('[data-risu-value="__global__"]').evaluate(el=>el.click());
 assert.equal(await page.locator('#nx-risu-current').textContent(),'전역 로스터');
 await page.locator('#nx-risu-pick-close').click();
 await page.locator('#nx-char-risu-open').click();
 assert.equal(await page.locator('#nx-risu-pick').getAttribute('aria-hidden'),'false');
 assert.deepEqual(errors,[]);
 console.log('Character switch: delayed reads, cached switches, persistent header/rail scroll, and reversed lore completion passed.');
} finally {await browser.close();}
