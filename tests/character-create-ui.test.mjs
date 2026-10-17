import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';

// 「LLM한테 시키기」: one instruction over the roster, previewed before anything is saved.
test('LLM한테 시키기 previews a plan, saves only on 적용, and keeps the scope it opened with', async () => {
 const bundle=await build({stdin:{contents:`
 export * from './src/settings-ux/character-create';
 export * from './src/settings-ux/roster-command';
 export * from './src/settings-ux/tab-html';
 export * from './src/settings-ux/styles';
 `,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'iife',globalName:'RosterUi'});
 const browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
 try {
  const page=await browser.newPage();
  await page.setContent('<iframe sandbox="allow-scripts allow-modals" style="position:fixed;inset:0;width:100%;height:100%;border:0" srcdoc="<!doctype html><html><head></head><body></body></html>"></iframe>',{waitUntil:'domcontentloaded'});
  page.setDefaultTimeout(10_000);
  const ui=page.frames().find(f=>f!==page.mainFrame());assert.ok(ui);
  await ui.addScriptTag({content:bundle.outputFiles[0].text});
  await ui.evaluate(()=>{
   document.documentElement.className='nx-ux-on';
   document.head.innerHTML='<style>'+RosterUi.settingsUxCss+'</style>';
   document.body.innerHTML='<div id="nx-shell" class="nx-ux">'+RosterUi.previewChrome()+'</div>';
   document.getElementById('nx-main').innerHTML=RosterUi.tabHtml('characters','',{});
   window.calls=[];window.flushes=0;window.cache=[];window.refresh=[];
   window.target={session_id:'selected_bot',character_id:'selected_bot'};
   globalThis.__OMNI_FLUSH_CHARACTERS__=async()=>{flushes++};
   globalThis.__OMNI_REPLACE_CHARACTER_CACHE__=(scope,rows)=>{cache.push({scope,rows})};
   globalThis.__OMNI_REFRESH_CHARACTER_SCOPE__=async scope=>{refresh.push(scope)};
   const plan={edits:[{id:'harin',name:'하린',log:'remove_costumes: school',character:{id:'harin',name:'하린'}}],deletes:[{id:'minji',name:'민지'}],adds:[{name:'지수',description:'파란 단발'}]};
   globalThis.__OMNI_SETTINGS_ACTIONS__={characterTarget:()=>target,request:async(path,body,timeout)=>{
    calls.push({path,body:JSON.parse(JSON.stringify(body)),timeout});
    if(window.pauseNext){window.pauseNext=false;await new Promise(resolve=>{window.finish=resolve})}
    if(path.endsWith('/command-plan'))return {ok:true,plan,empty:false,targets:2};
    return {ok:true,edited:1,deleted:1,added:1,characters:[{id:'harin',name:'하린'},{id:'jisu',name:'지수'}]};
   }};
   RosterUi.bindCharacterCreate();RosterUi.bindCharacterCreate();
  });
  const button=ui.locator('#nx-char-create-llm');
  assert.equal(await button.textContent(),'LLM한테 시키기');
  await button.click();
  assert.equal(await ui.locator('#nx-roster-command-modal').count(),1,'bound once, one dialog');
  assert.match(await ui.locator('#nx-roster-command-modal').textContent(),/지금 캐릭터 목록 전체/);
  assert.equal(await ui.locator('[data-rc-apply]').isEnabled(),false,'nothing to apply before a preview');
  await ui.locator('[data-rc-preview]').click();
  assert.match(await ui.locator('[data-rc-plan]').textContent(),/할 일을 적어/);
  assert.equal(await ui.evaluate(()=>calls.length),0);
  await ui.locator('[data-rc-help]').click();
  assert.match(await ui.locator('[data-rc-help-body]').textContent(),/미리보기[\s\S]*적용」을 눌러야 저장/);

  const instruction='하린 교복 코스튬 지워 줘\n민지는 삭제\n지수 추가: 파란 단발';
  await ui.locator('[data-rc-text]').fill(instruction);
  await ui.locator('[data-rc-xnai]').check();
  await ui.evaluate(()=>{window.pauseNext=true;document.querySelector('[data-rc-preview]').click();document.querySelector('[data-rc-preview]').click();});
  await ui.waitForFunction(()=>window.finish);
  await ui.locator('[data-rc-text]').press('Escape');
  assert.equal(await ui.locator('#nx-roster-command-modal').count(),1,'a busy dialog keeps its work');
  await ui.evaluate(()=>{target={session_id:'other_bot',character_id:'other_bot'};finish()});
  await ui.waitForFunction(()=>/수정 · 1/.test(document.querySelector('[data-rc-plan]').textContent));
  const shown=await ui.locator('[data-rc-plan]').textContent();
  assert.match(shown,/하린[\s\S]*remove_costumes[\s\S]*삭제 · 1[\s\S]*민지[\s\S]*추가 · 1[\s\S]*지수/);
  let state=await ui.evaluate(()=>({calls,flushes,cache,refresh}));
  assert.equal(state.calls.length,1,'a double click asks once');
  assert.deepEqual(state.calls[0],{path:'/v1/characters/command-plan',timeout:300_000,
   body:{session_id:'selected_bot',character_id:'selected_bot',scope:'selected_bot',ids:[],instruction,xnai:true,lore:false}});
  assert.equal(state.cache.length,0,'a preview saves nothing');

  await ui.locator('[data-rc-apply]').click();
  await ui.waitForFunction(()=>/적용했습니다/.test(document.querySelector('[data-rc-plan]').textContent));
  state=await ui.evaluate(()=>({calls,flushes,cache,refresh}));
  assert.equal(state.calls[1].path,'/v1/characters/command-apply');
  assert.equal(state.calls[1].body.scope,'selected_bot','the scope it opened with, not the later one');
  assert.deepEqual(state.calls[1].body.plan.deletes,[{id:'minji',name:'민지'}]);
  assert.equal(state.cache[0].scope,'selected_bot');assert.deepEqual(state.refresh,['selected_bot']);
  assert.equal(state.flushes,2,'pending form edits are saved before each request');
  assert.equal(await ui.locator('[data-rc-apply]').isEnabled(),false,'an applied plan cannot be applied twice');

  // A changed instruction drops the shown plan.
  await ui.locator('[data-rc-preview]').click();
  await ui.waitForFunction(()=>!document.querySelector('[data-rc-apply]').disabled);
  await ui.locator('[data-rc-text]').fill('다른 명령');
  assert.equal(await ui.locator('[data-rc-apply]').isEnabled(),false);
  await ui.locator('[data-rc-close]').click();
  assert.equal(await ui.locator('#nx-roster-command-modal').count(),0);

  // The global list in view is the global roster.
  await ui.evaluate(()=>{document.getElementById('nx-char-scope-bar').dataset.uxSelectedScope='global'});
  await button.click();
  await ui.locator('[data-rc-text]').fill('모두 머리 자세히');
  await ui.locator('[data-rc-preview]').click();
  await ui.waitForFunction(()=>window.calls.length===4&&!document.querySelector('[data-rc-preview]').disabled);
  assert.equal(await ui.evaluate(()=>calls.at(-1).body.scope),'__global__');
  // The selection bar opens the same dialog for the picked ones only.
  await ui.locator('[data-rc-close]').click();
  await ui.evaluate(()=>RosterUi.openRosterCommand(__OMNI_SETTINGS_ACTIONS__,'selected_bot',['harin'],['하린']));
  assert.match(await ui.locator('#nx-roster-command-modal').textContent(),/고른 1명: 하린/);
  await ui.locator('[data-rc-apply]').focus();
  await ui.locator('[data-rc-preview]').focus();
  await ui.locator('[data-rc-preview]').press('Tab');
  assert.equal(await ui.evaluate(()=>document.activeElement.hasAttribute('data-rc-help')),true,'focus stays in the dialog');
  await ui.locator('[data-rc-help]').press('Escape');
  assert.equal(await ui.locator('#nx-roster-command-modal').count(),0);
 } finally {await browser.close()}
});
