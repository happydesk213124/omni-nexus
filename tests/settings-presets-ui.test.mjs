import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium } from 'playwright';

test('dashboard settings presets use real storage for create/edit/import/export/apply/delete and fit mobile', async () => {
  const bundled = await build({stdin:{contents:[
    'export * from "./src/settings-ux/settings-presets.ts";',
    'export * from "./src/settings-ux/tab-html.ts";',
    'export * from "./src/settings-ux/styles.ts";',
    'export * from "./src/services/settings-presets.ts";',
    'export * from "./src/services/settings.ts";',
    'export * from "./src/services/context.ts";',
  ].join('\n'),resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'iife',globalName:'PresetTest'});
  const browser = await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
  try {
    const page = await browser.newPage({acceptDownloads:true});
    // Match Risu V3: scripts, modals and downloads are allowed, native form submission is not.
    await page.setContent('<iframe sandbox="allow-scripts allow-modals allow-downloads" style="position:fixed;inset:0;width:100%;height:100%;border:0" srcdoc="<!doctype html><html><head></head><body></body></html>"></iframe>');
    const ui = page.frames().find(frame => frame !== page.mainFrame());
    assert.ok(ui, 'plugin sandbox frame exists');
    page.setDefaultTimeout(5000);
    await ui.addScriptTag({content:bundled.outputFiles[0].text});
    await ui.evaluate(async () => {
      const storage = new Map();
      globalThis.risuai={pluginStorage:{getItem:async key=>storage.get(key),setItem:async(key,value)=>storage.set(key,structuredClone(value)),removeItem:async key=>storage.delete(key)}};
      const settings=PresetTest.getConfig();
      settings.card.presets=[{id:'keep',name:'내 스타일',positive:'unchanged',negative:'negative'}];settings.card.active_preset_id='keep';settings.card.custom_pos='unchanged';
      settings.llm.api_key='keep-secret';settings.llm.service_account_json='keep-private';
      await PresetTest.seedPrompts();
      document.documentElement.className='nx-ux-on';
      document.head.innerHTML='<style>'+PresetTest.settingsUxCss+'</style>';
      document.body.innerHTML='<div id="nx-shell" class="nx-ux">'+PresetTest.previewChrome()+'</div>';
      window.paint=()=>{document.getElementById('nx-main').innerHTML=PresetTest.tabHtml('dashboard','',PresetTest.getConfig());PresetTest.bindSettingsPresets();};
      window.flushes=0;
      globalThis.__OMNI_SETTINGS_ACTIONS__={flush:async()=>{flushes++},reload:async()=>paint(),request:async(path,body)=>{
        if(path==='/v1/settings-presets/save'&&window.failNextPresetSave){window.failNextPresetSave=false;throw new Error('저장 실패 재시도 확인');}
        if(path.startsWith('/v1/settings-presets/export?'))return PresetTest.exportSettingsPreset(new URLSearchParams(path.split('?')[1]).get('id'));
        const handlers={'/v1/settings-presets':PresetTest.listSettingsPresets,'/v1/settings-presets/save':PresetTest.saveSettingsPreset,'/v1/settings-presets/apply':PresetTest.applySettingsPreset,'/v1/settings-presets/delete':PresetTest.deleteSettingsPreset,'/v1/settings-presets/import':PresetTest.importSettingsPreset};
        return handlers[path](body);
      }};
      paint();
    });
    await ui.waitForFunction(()=>document.querySelectorAll('#nx-sp-select optgroup option').length===12);
    assert.equal(await ui.locator('#nx-sp-select optgroup option').count(),12);
    assert.ok(await ui.evaluate(()=>!!(document.getElementById('nx-reset-settings').compareDocumentPosition(document.getElementById('nx-settings-presets'))&Node.DOCUMENT_POSITION_FOLLOWING)));
    await mkdir('.test-build/settings-presets',{recursive:true});
    for(const width of [320,375,768,1440,3440]) {
      await page.setViewportSize({width,height:1000});
      await ui.locator('#nx-settings-presets').scrollIntoViewIfNeeded();
      assert.ok(await ui.locator('#nx-settings-presets').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
      assert.deepEqual(await ui.locator('.nx-sp-toolbar button').allTextContents(),['새로 만들기','JSON 내보내기','JSON 가져오기']);
      assert.deepEqual(await ui.locator('.nx-sp-selected-actions button').allTextContents(),['복제','편집','삭제','적용']);
      for(const button of await ui.locator('#nx-settings-presets button').all()) {
        assert.equal(await button.isVisible(),true);
        const bounds=await button.boundingBox();
        assert.ok(bounds.width < 150, `button must not stretch at ${width}px: ${bounds.width}`);
      }
      assert.equal(await ui.locator('#nx-sp-save,#nx-sp-manage,#nx-sp-menu').count(),0,'no overwrite button or hidden management menu');
      assert.equal(await ui.locator('#nx-sp-name').count(),0,'name editing is not duplicated on the dashboard');
      await ui.locator('#nx-settings-presets').screenshot({path:`.test-build/settings-presets/dashboard-${width}.png`});
    }
    await ui.evaluate(()=>{document.documentElement.dir='rtl';document.body.style.zoom='2';});
    assert.ok(await ui.locator('#nx-settings-presets').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
    await ui.evaluate(()=>{document.documentElement.dir='ltr';document.body.style.zoom='';});
    await ui.locator('#nx-sp-new').click();
    await ui.locator('dialog [data-cancel]').click();
    assert.equal(await ui.evaluate(async()=>(await PresetTest.listSettingsPresets()).items.length),12,'new alone never writes a preset');
    await ui.locator('#nx-sp-new').click();
    await ui.locator('dialog [data-save]').click();
    assert.equal(await ui.locator('dialog[open]').count(),1,'empty name keeps the dialog open');
    assert.equal(await ui.evaluate(async()=>(await PresetTest.listSettingsPresets()).items.length),12);
    await ui.locator('dialog input[name=name]').fill('내 설정');
    await ui.locator('dialog').screenshot({path:'.test-build/settings-presets/new-dialog.png'});
    await ui.evaluate(async()=>{PresetTest.getConfig().card.image_max=7;await PresetTest.setPrompt('author_note','저장 직전 노트');});
    await ui.evaluate(()=>{window.failNextPresetSave=true;});
    await ui.locator('dialog [data-save]').click();
    await ui.waitForFunction(()=>document.querySelector('dialog [role=status]')?.textContent==='저장 실패 재시도 확인');
    assert.equal(await ui.locator('dialog input[name=name]').inputValue(),'내 설정');
    assert.equal(await ui.locator('dialog [data-save]').isEnabled(),true);
    await ui.evaluate(()=>{const button=document.querySelector('dialog [data-save]');button.click();button.click();});
    await ui.waitForFunction(()=>document.querySelector('#nx-sp-select option:checked')?.textContent==='내 설정');
    assert.equal(await ui.evaluate(async()=>(await PresetTest.listSettingsPresets()).items.length),13,'repeated clicks save only once');
    const id=await ui.locator('#nx-sp-select').inputValue();
    let captured=await ui.evaluate(async id=>(await PresetTest.listSettingsPresets()).items.find(p=>p.id===id),id);
    assert.equal(captured.settings.card.image_max,7);assert.equal(captured.prompts.author_note,'저장 직전 노트');
    await ui.evaluate(async()=>{PresetTest.getConfig().card.image_max=8;await PresetTest.setPrompt('author_note','현재 설정 갱신');});
    await ui.locator('#nx-sp-select').selectOption('example-pov');await ui.locator('#nx-sp-select').selectOption(id);
    captured=await ui.evaluate(async id=>(await PresetTest.listSettingsPresets()).items.find(p=>p.id===id),id);
    assert.equal(captured.settings.card.image_max,7);assert.equal(captured.prompts.author_note,'저장 직전 노트','selection never overwrites a saved preset with live settings');
    await ui.locator('#nx-sp-edit').click();
    await ui.locator('dialog input[name=name]').fill('수정한 설정');
    await ui.locator('dialog summary').click();
    await ui.locator('dialog textarea[name=author_note]').fill('수정한 작가 노트');
    await ui.locator('dialog [data-save]').click();
    await ui.waitForFunction(()=>document.querySelector('#nx-sp-select option:checked')?.textContent==='수정한 설정');
    assert.equal(await ui.locator('#nx-sp-select').inputValue(),id);
    await ui.locator('#nx-sp-duplicate').click();
    assert.equal(await ui.locator('dialog input[name=name]').inputValue(),'수정한 설정 복사본');
    await ui.locator('dialog input[name=name]').press('Enter');
    await ui.waitForFunction(()=>document.querySelector('#nx-sp-select option:checked')?.textContent==='수정한 설정 복사본');
    const copyId=await ui.locator('#nx-sp-select').inputValue();
    assert.notEqual(copyId,id,'copy has its own identity');
    const originalAndCopy=await ui.evaluate(async ({id,copyId})=>{
      const rows=(await PresetTest.listSettingsPresets()).items;
      return {original:rows.find(p=>p.id===id),copy:rows.find(p=>p.id===copyId),live:PresetTest.getConfig().card.image_max};
    },{id,copyId});
    assert.deepEqual(originalAndCopy.copy.settings,originalAndCopy.original.settings,'copy uses the saved preset, not current settings');
    assert.deepEqual(originalAndCopy.copy.prompts,originalAndCopy.original.prompts);
    assert.equal(originalAndCopy.copy.settings.card.image_max,7);
    assert.equal(originalAndCopy.live,8,'copy does not apply itself');
    await ui.locator('#nx-sp-edit').click();
    await ui.locator('dialog summary').click();
    await ui.locator('dialog textarea[name=author_note]').fill('복사본만 수정');
    await ui.locator('dialog [data-save]').click();
    await ui.waitForFunction(()=>!document.querySelector('dialog[open]'));
    assert.equal(await ui.evaluate(async id=>(await PresetTest.listSettingsPresets()).items.find(p=>p.id===id).prompts.author_note,id),'수정한 작가 노트');
    await ui.evaluate(()=>paint());
    await ui.waitForFunction(()=>!document.querySelector('#nx-sp-select').disabled);
    assert.equal(await ui.locator('#nx-sp-select').inputValue(),copyId,'copy survives dashboard remount');
    await ui.locator('#nx-sp-select').selectOption(id);
    const downloadPromise=page.waitForEvent('download');await ui.locator('#nx-sp-export').click();
    const download=await downloadPromise;await download.saveAs('.test-build/settings-presets/export.json');
    const exported=JSON.parse(await readFile('.test-build/settings-presets/export.json','utf8'));
    assert.equal(exported.prompts.author_note,'수정한 작가 노트');
    assert.equal(exported.settings.card.image_max,7,'editing name and notes keeps the saved general settings');
    assert.doesNotMatch(JSON.stringify(exported),/keep-secret|keep-private|unchanged|active_preset_id/);
    await ui.locator('#nx-sp-file').setInputFiles({name:'import.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({card:{image_min:1,image_max:1,comic_author_note:'만화 노트',presets:[{id:'foreign'}]},prompts:{author_note:'불러온 노트',tagger:'DO NOT IMPORT'}}))});
    await ui.waitForFunction(()=>document.querySelector('#nx-sp-select option:checked')?.textContent==='import');
    await ui.locator('#nx-sp-apply').click();
    await ui.waitForFunction(()=>PresetTest.getConfig().card.image_min===1&&!document.getElementById('nx-shell').inert);
    const state=await ui.evaluate(async()=>({settings:PresetTest.getConfig(),prompts:(await PresetTest.exportPromptsPack()).prompts,flushes}));
    assert.deepEqual(state.settings.card.presets,[{id:'keep',name:'내 스타일',positive:'unchanged',negative:'negative'}]);
    assert.equal(state.settings.card.active_preset_id,'keep');assert.equal(state.settings.llm.api_key,'keep-secret');
    assert.equal(state.prompts.author_note,'불러온 노트');assert.notEqual(state.prompts.tagger,'DO NOT IMPORT');assert.ok(state.flushes>=3);
    await ui.locator('#nx-sp-delete').click();await ui.locator('dialog button[value=delete]').click();
    await ui.waitForFunction(()=>![...document.querySelectorAll('#nx-sp-select option')].some(el=>el.textContent==='import'));
    assert.equal(await ui.evaluate(()=>PresetTest.getConfig().card.image_min),1,'deleting a preset leaves live settings alone');
    await ui.locator('#nx-sp-select').selectOption('example-pov');
    await ui.locator('#nx-sp-duplicate').click();
    await ui.locator('dialog input[name=name]').fill('예제 복사본');
    await ui.locator('dialog [data-save]').click();
    await ui.waitForFunction(()=>document.querySelector('#nx-sp-select option:checked')?.textContent==='예제 복사본');
    assert.equal(await ui.locator('#nx-sp-select option:checked').evaluate(el=>el.parentElement.label),'내 프리셋');
    await ui.locator('#nx-sp-select').selectOption('example-pov');await ui.locator('#nx-sp-delete').click();await ui.locator('dialog button[value=delete]').click();
    await ui.waitForFunction(()=>!document.querySelector('#nx-sp-select option[value="example-pov"]'));
    await ui.evaluate(()=>paint());await ui.waitForFunction(()=>!document.querySelector('#nx-sp-select').disabled);
    assert.equal(await ui.locator('#nx-sp-select option[value="example-pov"]').count(),0,'deleted examples stay hidden on reopen');
  } finally { await browser.close(); }
});
