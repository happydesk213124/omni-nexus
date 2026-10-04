import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium } from 'playwright';

test('character creation dialog supports help, batching, retry and captured scope in a Risu sandbox',async()=>{
 const bundle=await build({stdin:{contents:`
 export * from './src/settings-ux/character-create';
 export * from './src/settings-ux/tab-html';
 export * from './src/settings-ux/styles';
 `,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'iife',globalName:'CharacterCreateTest'});
 const browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
 try {
  const page=await browser.newPage();
  await page.setContent('<iframe sandbox="allow-scripts allow-modals" style="position:fixed;inset:0;width:100%;height:100%;border:0" srcdoc="<!doctype html><html><head></head><body></body></html>"></iframe>',{waitUntil:'domcontentloaded'});
  page.setDefaultTimeout(10_000);
  const ui=page.frames().find(f=>f!==page.mainFrame());assert.ok(ui);
  await ui.addScriptTag({content:bundle.outputFiles[0].text});
  await ui.evaluate(()=>{
   document.documentElement.className='nx-ux-on';
   document.head.innerHTML='<style>'+CharacterCreateTest.settingsUxCss+'</style>';
   document.body.innerHTML='<div id="nx-shell" class="nx-ux">'+CharacterCreateTest.previewChrome()+'</div>';
   document.getElementById('nx-main').innerHTML=CharacterCreateTest.tabHtml('characters','',{});
   window.calls=[];window.flushes=0;window.cache=[];window.refresh=[];
   window.target={session_id:'selected_bot',character_id:'selected_bot'};
   globalThis.__OMNI_FLUSH_CHARACTERS__=async()=>{flushes++};
   globalThis.__OMNI_REPLACE_CHARACTER_CACHE__=(scope,rows)=>{cache.push({scope,rows})};
   globalThis.__OMNI_REFRESH_CHARACTER_SCOPE__=async scope=>{refresh.push(scope)};
   globalThis.__OMNI_SETTINGS_ACTIONS__={characterTarget:()=>target,request:async(path,body,timeout)=>{
    calls.push({path,body,timeout});
    if(window.failNext){window.failNext=false;throw new Error('LLM 연결 실패');}
    if(window.pauseNext){window.pauseNext=false;await new Promise(resolve=>{window.finish=resolve})}
    return {ok:true,added:2,names:['하진','민지'],message:'2명 추가됨',characters:[{id:'hajin',name:'하진'},{id:'minji',name:'민지'}]};
   }};
   CharacterCreateTest.bindCharacterCreate();CharacterCreateTest.bindCharacterCreate();
  });
  const button=ui.locator('#nx-char-create-llm');
  assert.equal(await button.textContent(),'LLM한테 시키기');
  assert.deepEqual(await button.evaluate(el=>[el.previousElementSibling.id,el.previousElementSibling.previousElementSibling.id]),['nx-char-import-global','nx-char-import-session']);
  await button.click();
  assert.equal(await ui.locator('#nx-char-create-modal').count(),1);
  assert.equal(await ui.locator('#nx-char-create-description').getAttribute('maxlength'),'20000');
  assert.equal(await ui.locator('#nx-char-create-description').getAttribute('placeholder'),'주호 검은머리 짧은 언더컷 25살 검은 눈\n\n민지 파란머리 파란눈을 가진 여성 긴생머리 회색 후드 청바지');
  assert.match(await ui.locator('#nx-char-create-hint').textContent(),/입력하지 않은.*알아서 채웁니다/);
  const theme=await ui.evaluate(()=>({shell:getComputedStyle(document.getElementById('nx-shell')).getPropertyValue('--surface').trim(),popup:getComputedStyle(document.querySelector('#nx-char-create-modal [role=dialog]')).backgroundColor,text:getComputedStyle(document.querySelector('#nx-char-create-modal [role=dialog]')).color}));
  assert.equal(theme.popup,'rgb(16, 22, 34)');assert.equal(theme.text,'rgb(244, 247, 251)');
  // Shell-local overrides must reach a popup appended to body, too.
  await ui.locator('[data-create-close]').click();
  await ui.evaluate(()=>document.getElementById('nx-shell').style.setProperty('--surface','#242635'));
  await button.click();
  assert.equal(await ui.locator('[role=dialog]').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(36, 38, 53)');
  assert.equal(await ui.locator('#nx-char-create-help').isVisible(),false);
  await ui.locator('[data-create-help]').click();
  const help=await ui.locator('#nx-char-create-help').textContent();
  for(const term of ['주호','25살','민지','트리거','한국어·영어','줄바꿈','자료가 없으면 LLM이 어울리게 채웁니다']) assert.ok(help.includes(term));
  assert.ok(!help.includes('하진'));
  await mkdir('.test-build/character-create',{recursive:true});
  for(const width of [320,375,768,1440]) {
   await page.setViewportSize({width,height:900});
   const metrics=await ui.locator('[role=dialog]').evaluate(el=>({scroll:el.scrollWidth,client:el.clientWidth,rect:{left:el.getBoundingClientRect().left,right:el.getBoundingClientRect().right},viewport:innerWidth}));
   assert.ok(metrics.scroll<=metrics.client+1,`${width}px dialog fits horizontally`);
   assert.ok(metrics.rect.left>=0&&metrics.rect.right<=metrics.viewport);
   await ui.locator('[data-create-run]').scrollIntoViewIfNeeded();
   await page.screenshot({path:`.test-build/character-create/dialog-${width}.png`});
  }
  await ui.locator('[data-create-run]').click();
  assert.match(await ui.locator('[data-create-status]').textContent(),/이름과 외형/);
  assert.equal(await ui.evaluate(()=>calls.length),0);
  const instruction='하진: 갈색 머리와 갈색 눈, 사이드테일.\n\n민지: 파란 머리와 파란 눈.';
  await ui.locator('#nx-char-create-description').fill(instruction);
  await ui.evaluate(()=>{window.failNext=true;});
  await ui.locator('[data-create-run]').click();
  await ui.waitForFunction(()=>document.querySelector('[data-create-status]').textContent==='LLM 연결 실패');
  assert.equal(await ui.locator('#nx-char-create-description').inputValue(),instruction);
  assert.equal(await ui.locator('[data-create-run]').isEnabled(),true);
  await ui.evaluate(()=>{window.pauseNext=true;document.querySelector('[data-create-run]').click();document.querySelector('[data-create-run]').click();});
  await ui.waitForFunction(()=>window.finish);
  assert.equal(await ui.locator('[data-create-run]').isEnabled(),false);
  await ui.locator('#nx-char-create-description').press('Escape');
  assert.equal(await ui.locator('#nx-char-create-modal').count(),1,'busy dialog preserves pending work');
  await ui.evaluate(()=>{target={session_id:'other_bot',character_id:'other_bot'};finish()});
  await ui.waitForFunction(()=>document.querySelector('[data-create-status]').textContent.includes('2명 추가됨'));
  const state=await ui.evaluate(()=>({calls,flushes,cache,refresh}));
  assert.equal(state.calls.length,2,'double clicks start only one additional call');
  assert.equal(state.flushes,2);
  assert.deepEqual(state.calls[1],{path:'/v1/characters/create-from-description',body:{session_id:'selected_bot',character_id:'selected_bot',scope:'selected_bot',instruction},timeout:300_000});
  assert.equal(state.cache[0].scope,'selected_bot');assert.deepEqual(state.refresh,['selected_bot']);
  await ui.locator('[data-create-close]').click();
  assert.equal(await ui.locator('#nx-char-create-modal').count(),0);
  await ui.evaluate(()=>{document.getElementById('nx-char-scope-bar').dataset.uxSelectedScope='global'});
  await button.click();
  await ui.locator('#nx-char-create-description').fill('민지: 파란 머리');
  await ui.locator('[data-create-run]').click();
  await ui.waitForFunction(()=>window.calls.length===3&&!document.querySelector('[data-create-run]').disabled);
  assert.equal(await ui.evaluate(()=>calls.at(-1).body.scope),'__global__');
  await ui.locator('[data-create-run]').focus();
  await ui.locator('[data-create-run]').press('Tab');
  assert.equal(await ui.evaluate(()=>document.activeElement.hasAttribute('data-create-help')),true);
  await ui.locator('[data-create-help]').press('Escape');
  assert.equal(await ui.locator('#nx-char-create-modal').count(),0);
 } finally {await browser.close()}
});
