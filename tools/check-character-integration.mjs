import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {build} from 'esbuild';

const full=await readFile('dist/omninexus.js','utf8');
const taggerBundle = await build({stdin:{contents:`export {mergeRosterFromTagged} from './src/services/characters';`,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'iife',globalName:'taggerRegression',define:{__PLUGIN_ID__:'"omni-nexus"'}});
assert.equal(full.split('  await Qa();').length,2);
const browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
try {
 const page=await browser.newPage({viewport:{width:900,height:700}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto('about:blank');
 await page.evaluate(()=>{
  const kv=new Map();
  const chars=Array.from({length:50},(_,i)=>({chaId:'bot-'+i,name:'Bot '+i,additionalAssets:[['Asset '+i,'asset-'+i]],modules:['m'],globalLore:[],chats:[{id:'chat-'+i,message:[]}]}));
  globalThis.risuai={
   pluginStorage:{getItem:async k=>kv.get(k),setItem:async(k,v)=>kv.set(k,v),removeItem:async k=>kv.delete(k)},
   getArgument:async()=>'',readImage:async()=>new Uint8Array([1,2,3]),getDatabase:async()=>({characters:structuredClone(chars),modules:[{id:'m',name:'Active module',assets:[['Module asset','module-asset']]}],enabledModules:['m']}),
   getCharacterFromIndex:async i=>structuredClone(chars[i]),setCharacterToIndex:async(i,c)=>{await new Promise(r=>setTimeout(r,80));chars[i]=structuredClone(c);},
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
   globalThis.switchTest={t,paint:P,refresh:ce,pending,complete(cid){const at=pending.findIndex(p=>p.cid===cid);if(at<0)throw Error('missing scan '+cid);const p=pending.splice(at,1)[0];p.resolve({ok:true,character_id:cid,selected:['t:'+cid],catalog:[{id:'t:'+cid,title:cid,keys:[cid],content:'Lore '+cid}],initialized:true});}};
   ${process.argv.includes('--break-navigation') ? 'globalThis.__INLAY_SETTINGS_UX__.replaceMain=(main,html)=>{main.innerHTML=html;};' : ''}
   await P();
  `)});
 await page.waitForFunction(()=>globalThis.switchTest?.pending.length===1);
 await page.evaluate(()=>switchTest.complete('bot-0'));
 await page.waitForFunction(()=>switchTest.pending.length===0);
 await page.evaluate(()=>{globalThis.savedMain=document.getElementById('nx-main');globalThis.savedBody=document.getElementById('nx-char-edit-body');});
 if (process.argv.includes('--break-add')) await page.evaluate(()=>{globalThis.__OMNI_RENDER_CHARACTER_CARD__=()=>'';});
 await page.locator('#nx-char-add-session').click();
 await page.waitForFunction(()=>document.querySelectorAll('.char-card[data-char-id]').length===1,{},{timeout:5000});
 assert.equal(await page.evaluate(()=>savedBody===document.getElementById('nx-char-edit-body')),true,'adding must preserve editor DOM');
 await page.locator('#nx-char-edit-body [data-char-name]').fill('Edited immediately');
 await page.locator('#nx-char-sheet-close').click();
 await page.locator('#nx-char-add-session').click();
 await page.waitForFunction(()=>document.querySelectorAll('.char-card[data-char-id]').length===2);
 await page.locator('#nx-char-edit-body [data-char-name]').fill('Second');
 await page.evaluate(async()=>{await globalThis.__OMNI_FLUSH_CHARACTERS__();});
 assert.equal(await page.evaluate(()=>savedBody===document.getElementById('nx-char-edit-body')),true);
 assert.equal(await page.locator('#nx-char-edit-body [data-char-name]').inputValue(),'Second');
 const persisted = await page.evaluate(async()=>{const s=switchTest.t.lastScope;return globalThis.__INLAY_NATIVE__.fetch('/v1/characters?session_id='+encodeURIComponent(s.sessionId)+'&character_id='+s.characterId,{method:'GET'});});
 assert.deepEqual(persisted.characters.map(c=>c.name).sort(),['Edited immediately','Second']);
 assert.deepEqual(await page.locator('.char-card [data-char-name]').evaluateAll(xs=>xs.map(x=>x.value)),['Edited immediately','Second']);
 // A failed background create keeps its card, edits and a usable retry.
 await page.evaluate(()=>{
   const queue=globalThis.__OMNI_QUEUE_CHARACTER_WRITE__;
   globalThis.__OMNI_QUEUE_CHARACTER_WRITE__=work=>{
     globalThis.__OMNI_QUEUE_CHARACTER_WRITE__=queue;
     return Promise.reject(new Error('injected create failure'));
   };
 });
 await page.locator('#nx-char-sheet-close').click();
 await page.locator('#nx-char-add-session').click();
 await page.locator('#nx-char-edit-body [data-char-name]').fill('Retry kept');
 await page.locator('#nx-char-sheet-close').click();
 await page.getByRole('button',{name:'저장 실패 · 재시도',exact:true}).click();
 await page.waitForFunction(()=>![...document.querySelectorAll('button')].some(b=>b.textContent==='저장 실패 · 재시도'));
 assert.equal(await page.locator('.char-card[data-char-id]').count(),3);
 await page.locator('#nx-char-edit-btn').click();
 assert.equal(await page.locator('#nx-char-edit-body [data-char-name]').inputValue(),'Retry kept');
 // The new row retains native image controls without rebinding the entire list.
 await page.locator('#nx-char-edit-body [data-char-autotag]').click();
 assert.match(await page.locator('#nx-char-edit-body').textContent(),/이미지 붙여넣기 대기 중/);
 await page.evaluate(()=>{
   globalThis.pasted=0;
   globalThis.__OMNI_AUTOTAG_CARD__=async()=>{globalThis.pasted++;};
   const data=new DataTransfer();data.items.add(new File([new Uint8Array([1])],'test.png',{type:'image/png'}));
   const field=document.querySelector('#nx-char-edit-body [data-char-appearance]');
   field.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));
 });
 assert.equal(await page.evaluate(()=>globalThis.pasted),1);
 const textPaste=await page.evaluate(()=>{
   const data=new DataTransfer();data.setData('text/plain','normal text');
   const event=new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data});
   document.querySelector('#nx-char-edit-body [data-char-appearance]').dispatchEvent(event);
   return event.defaultPrevented;
 });
 assert.equal(textPaste,false);
 await page.locator('#nx-char-from-module').click();
 await page.locator('dialog input[type="search"]').fill('');
 await page.locator('dialog select').selectOption('0');
 assert.match(await page.locator('dialog').textContent(),/Module asset/);
 await page.getByRole('button',{name:'닫기',exact:true}).last().click();
 await page.evaluate(()=>{const input=document.querySelector('#nx-char-edit-body [data-char-given]');globalThis.savedGiven=input.value;input.value='지호';input.dispatchEvent(new Event('input',{bubbles:true}));});
 await page.locator('#nx-char-from-asset').click();
 assert.match(await page.locator('dialog input[type="search"]').inputValue(),/지호/);
 await page.evaluate(()=>{const input=document.querySelector('#nx-char-edit-body [data-char-given]');input.value=globalThis.savedGiven;input.dispatchEvent(new Event('input',{bubbles:true}));});
 await page.locator('dialog input[type="search"]').fill('');
 assert.match(await page.locator('dialog').textContent(),/Asset 0/);
 assert.doesNotMatch(await page.locator('dialog').textContent(),/Module asset/);
 // Completing A's analysis after selecting B must not mutate the visible card.
 await page.evaluate(()=>{
   const fetch=globalThis.__INLAY_NATIVE__.fetch;
   globalThis.assetRace={fetch,before:document.querySelector('#nx-char-edit-body [data-char-appearance]').value};
   globalThis.__INLAY_NATIVE__.fetch=(path,...args)=>path==='/v1/characters/analyze-asset'
     ? new Promise(resolve=>{assetRace.resolve=resolve;}) : fetch(path,...args);
 });
 await page.locator('dialog button[title="Asset 0"]').click();
 await page.waitForFunction(()=>!!assetRace.resolve);
 await page.evaluate(()=>{
   const selector=document.getElementById('nx-scope-char');assetRace.selected=selector.value;selector.value='1';
   assetRace.resolve({appearance:'WRONG CHARACTER',hair_style:'WRONG HAIR'});
 });
 await page.waitForFunction(()=>!document.querySelector('dialog button[title="Asset 0"]').disabled);
 assert.equal(await page.locator('#nx-char-edit-body [data-char-appearance]').inputValue(),await page.evaluate(()=>assetRace.before));
 await page.evaluate(()=>{document.getElementById('nx-scope-char').value=assetRace.selected;globalThis.__INLAY_NATIVE__.fetch=assetRace.fetch;});
 await page.getByRole('button',{name:'닫기',exact:true}).last().click();
 // Selecting an asset registers those exact image bytes into the empty ref slot.
 await page.evaluate(()=>{
   const original=globalThis.__INLAY_NATIVE__.fetch;globalThis.assetRefTest={original,calls:[]};
   globalThis.__INLAY_NATIVE__.fetch=(path,options,...rest)=>{
     if(path==='/v1/characters/analyze-asset'){assetRefTest.analysis=options.body;return Promise.resolve({appearance:'girl',hair_style:'braid',source:'metadata'});}
     if(path==='/v1/characters/ref'){assetRefTest.calls.push(options.body);return Promise.resolve({ok:true,configured:true});}
     return original(path,options,...rest);
   };
 });
 await page.locator('#nx-char-from-asset').click();
 await page.locator('dialog input[type="search"]').fill('');
 await page.locator('dialog button[title="Asset 0"]').click();
 await page.waitForFunction(()=>!document.querySelector('dialog'));
 assert.deepEqual(await page.evaluate(()=>assetRefTest.calls.map(c=>({overwrite:c.overwrite,sameImage:c.image_b64===assetRefTest.analysis.image_b64}))),[{overwrite:false,sameImage:true}]);
 await page.evaluate(()=>{globalThis.__INLAY_NATIVE__.fetch=assetRefTest.original;});
 await page.evaluate(async()=>{switchTest.t.uiTab='gen_options';await switchTest.paint();});
 await page.locator('#nx-omni-helper').check();
 await page.waitForFunction(()=>switchTest.t.backendSettings.card.omni_helper_prompt===true);
 await page.locator('#nx-omni-helper').uncheck();
 await page.waitForFunction(()=>switchTest.t.backendSettings.card.omni_helper_prompt===false);
 await page.evaluate(async()=>{switchTest.t.uiTab='dashboard';await switchTest.paint();});
 await page.locator('#nx-asset-tags-enabled').check();
 await page.locator('#nx-asset-tags-inline').check();
 await page.locator('#nx-image-analysis-separate').check();
 await page.waitForFunction(()=>switchTest.t.backendSettings.card.image_analysis_separate===true);
 await page.waitForFunction(()=>switchTest.t.backendSettings.card.asset_nai_tags==='inline');
 await page.evaluate(async()=>{switchTest.t.uiTab='prompts';await switchTest.paint();});
 await page.waitForSelector('#nx-prompt-character_common');
 await page.locator('#nx-prompt-character_common').fill('MY EDITED COMMON RULE');
 await page.waitForFunction(async()=>{
   const row=await globalThis.__INLAY_NATIVE__.fetch('/v1/prompts/character_common',{method:'GET'});
   return row.text==='MY EDITED COMMON RULE';
 });
 await page.evaluate(async()=>{
   const rows=(await globalThis.__INLAY_NATIVE__.fetch('/v1/prompts',{method:'GET'})).prompts;
   globalThis.__INLAY_NATIVE_PROMPTS__=Object.fromEntries(rows.map(p=>[p.key,p.text]));
   globalThis.__INLAY_NATIVE_PROMPTS__.character_common='UPDATED DEFAULT hair_style eye_color';
   await switchTest.paint();
 });
 await page.waitForSelector('#nx-prompt-character-common-block [data-prompt-title] .nx-prompt-update-dot');
 assert.equal(await page.locator('#nx-prompt-character_common').inputValue(),'MY EDITED COMMON RULE');
 assert.equal(await page.locator('#nx-tabs [data-nx-tab="models"] .nx-prompt-update-dot').count(),0);
 assert.equal(await page.locator('#nx-tabs [data-nx-tab="prompts"] .nx-prompt-update-dot').isVisible(),true);
 await page.evaluate(()=>{window.confirm=()=>true;});
 assert.equal(await page.locator('[data-reset-prompt="character_common"]').count(),0);
 await page.locator('#nx-prompts-reset-defaults').click();
 await page.waitForFunction(()=>switchTest.t.promptDrafts.character_common==='UPDATED DEFAULT hair_style eye_color');
 assert.equal(await page.locator('#nx-prompt-character-common-block [data-prompt-title] .nx-prompt-update-dot').isVisible(),false);
 assert.equal(await page.locator('#nx-tabs [data-nx-tab="prompts"] .nx-prompt-update-dot').isVisible(),false);
 await page.setViewportSize({width:375,height:812});
 await page.evaluate(async()=>{switchTest.t.uiTab='characters';await switchTest.paint();});
 await page.waitForSelector('#nx-char-from-module',{state:'attached'});
 await page.locator('#nx-char-edit-btn').click();
 await page.locator('#nx-char-sheet').evaluate(async el=>{await Promise.all(el.getAnimations().map(a=>a.finished));});
 const layout=await page.locator('.char-edit-head').evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth}));
 assert.ok(layout.scroll<=layout.width+1,JSON.stringify(layout));
 // Feed a real new_characters merge into the built editor; opening must not
 // replace the identity fields with empty values from the default costume.
 await page.addScriptTag({content:taggerBundle.outputFiles[0].text});
 await page.evaluate(async()=>{
   await globalThis.__OMNI_FLUSH_CHARACTERS__();
   const s=switchTest.t.lastScope;
   const looks={appearance:'boy, pale skin',hair_color:'silver hair, white hair',hair_style:'short hair, messy hair, bangs',eye_color:'orange eyes, amber eyes'};
   globalThis.expectedGeneratedLooks=looks;
   await taggerRegression.mergeRosterFromTagged({sessionId:s.sessionId,characterId:s.characterId,tagged:{new_characters:[{name:'윤지호',given_name:'지호',gender:'boy',...looks,costumes:[{name:'default',attire:'white shirt',bottoms:'black pants'}]}]},shotChars:[]});
   await switchTest.refresh(s.sessionId,true);await switchTest.paint();
 });
 if(process.argv.includes('--break-generated-looks')) await page.evaluate(()=>{
   for(const el of document.querySelectorAll('.char-card [data-char-hair-color]'))el.value='';
 });
 const generatedTile=page.locator('[data-ux-character-tile]').filter({hasText:'윤지호'});
 await generatedTile.click();
 if(!await page.locator('#nx-char-edit-body').isVisible())await page.locator('#nx-char-edit-btn').click();
 const expectedLooks=await page.evaluate(()=>expectedGeneratedLooks);
 for(const [key,value] of Object.entries(expectedLooks))assert.equal(await page.locator('#nx-char-edit-body [data-char-'+key.replaceAll('_','-')+']').inputValue(),value,key);
 await page.locator('#nx-char-edit-body [data-char-name]').fill('윤지호 확인');
 await page.evaluate(async()=>{await globalThis.__OMNI_FLUSH_CHARACTERS__();});
 const afterEdit=await page.evaluate(async()=>{
   const data=await globalThis.__INLAY_NATIVE__.fetch('/v1/characters?session_id='+encodeURIComponent(switchTest.t.lastScope.sessionId),{method:'GET'});
   return data.characters.find(c=>c.name==='윤지호 확인');
 });
 for(const [key,value] of Object.entries(expectedLooks))assert.equal(afterEdit[key],value,'after edit '+key);
 await page.screenshot({path:'.test-build/character-integration-mobile.png',fullPage:true});
 assert.deepEqual(errors,[]);
 console.log('Character integration: generated look persistence, incremental adds, draft preservation, image/text paste, module assets and both options passed.');
} finally {await browser.close();}
