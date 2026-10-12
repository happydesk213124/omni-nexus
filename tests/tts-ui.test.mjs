import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';

test('production settings persist independently, edit voice tiles and survive reopening',async()=>{
  const built=await build({stdin:{contents:`import {mountTts,ttsSettingsHtml} from './src/tts-ui/mount';import {ttsData} from './src/storage/tts-store';Object.assign(window,{mountTts,ttsSettingsHtml,ttsData});`,resolveDir:process.cwd()},bundle:true,write:false,format:'iife'});
  const browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
  try {
    const page=await browser.newPage({viewport:{width:1360,height:900}}),errors=[];
    page.setDefaultTimeout(8000);page.setDefaultNavigationTimeout(8000);page.on('pageerror',error=>errors.push(error.message));page.on('dialog',d=>d.dismiss());
    await page.route('https://tts.test/',route=>route.fulfill({contentType:'text/html',body:'<html><head></head><body style="background:#0b0f18;color:#eee;font:14px sans-serif"></body></html>'}));await page.goto('https://tts.test/');
    await page.evaluate(()=>{const save=new Map(),local=new Map();window.risuai={pluginStorage:{getItem:async k=>save.get(k),setItem:async(k,v)=>save.set(k,v)},getLocalPluginStorage:async()=>({getItem:async k=>local.get(k),setItem:async(k,v)=>local.set(k,v),removeItem:async k=>local.delete(k)}),requestPluginPermission:async()=>true,getDatabase:async()=>({modules:[],enabledModules:[]}),setDatabase:async()=>{},getCharacter:async()=>({chaId:'test-char',chatPage:0,chats:[{id:'test-chat',message:[]}]})};});
    await page.addScriptTag({content:built.outputFiles[0].text});
    await page.evaluate(async()=>{document.body.insertAdjacentHTML('beforeend',window.ttsSettingsHtml());await window.mountTts();});
    assert.equal(await page.locator('#speed').isDisabled(),true);
    await page.locator('#tts-power').check();
    await page.waitForFunction(()=>!document.getElementById('tts-controls').disabled,undefined,{timeout:8000});
    await page.locator('#speed-presets').fill('1, 2, 2.5, 3.5');await page.locator('#speed-presets').dispatchEvent('change');
    assert.deepEqual(await page.evaluate(()=>window.ttsData().settings.rates),[1,2,2.5,3.5]);
    await page.locator('#tab-voices').click();
    assert.equal(await page.locator('#voice-list .voice-row').count(),176);
    assert.equal(await page.locator('#voice-list').evaluate(node=>node.scrollHeight>node.clientHeight&&getComputedStyle(node).overflowY==='auto'),true,'voice tiles must scroll inside their own panel');
    await page.locator('#voice-search').fill('여성 & 차분 | 남성 & 파워풀');
    assert.ok(await page.locator('#voice-list .voice-row').count()>0);
    await page.locator('#clear-voice-search').click();
    await page.locator('#voice-multiselect').click();await page.locator('#voice-list .voice-row').nth(0).click();await page.locator('#voice-list .voice-row').nth(1).click();
    assert.equal(await page.locator('#voice-list .voice-row[aria-selected=true]').count(),2);
    await page.locator('#clear-voice-selection').click();await page.locator('#voice-multiselect').click();
    await page.locator('#voice-list .voice-row').nth(0).click();await page.locator('#voice-list .voice-row').nth(0).click();
    assert.equal(await page.locator('#voice-dialog').isVisible(),true);
    await page.locator('#v-name').fill('수정 테스트');await page.locator('#voice-form button[type=submit]').click();
    assert.equal(await page.evaluate(()=>window.ttsData().voices[0].name),'수정 테스트');
    await page.locator('#new-voice-folder').click();await page.locator('#voice-folder-name').fill('폴더 테스트');await page.locator('#voice-folder-form button[type=submit]').click();
    assert.deepEqual(await page.evaluate(()=>window.ttsData().folders),['폴더 테스트']);
    await page.locator('#tab-characters').click();await page.locator('#add-character').click();await page.locator('#c-name').fill('하린');await page.locator('#c-triggers').fill('하린,Harin');await page.locator('#c-id').fill('https://fish.audio/ko/app/m/4e118bfbb83e401c84699c09b5f08257/');await page.locator('#character-form button[type=submit]').click();
    assert.equal(await page.locator('#character-list .char-card').count(),1);
    await page.locator('#tts-power').uncheck();await page.waitForFunction(()=>document.getElementById('tts-controls').disabled,undefined,{timeout:8000});
    assert.equal(await page.evaluate(()=>window.ttsData().settings.enabled),false);
    await page.evaluate(async()=>{document.getElementById('tts-settings-root').remove();await new Promise(resolve=>setTimeout(resolve,0));document.body.insertAdjacentHTML('beforeend',window.ttsSettingsHtml());await window.mountTts();});
    assert.equal(await page.locator('#speed').isDisabled(),true);
    assert.deepEqual(await page.evaluate(()=>window.ttsData().settings.rates),[1,2,2.5,3.5]);
    await page.screenshot({path:'.tts-ui-check.png',fullPage:true});
    assert.deepEqual(errors,[]);
  } finally {await browser.close();}
});
