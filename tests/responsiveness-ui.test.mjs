import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {build} from 'esbuild';
import {chromium} from 'playwright';

const bundle=await build({stdin:{contents:"export {openCharacterEditor} from './src/settings-ux/character-bindings';export {installSearchClear} from './src/settings-ux/search-clear';export {pickCharacterAsset} from './src/settings-ux/asset-picker';",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'iife',globalName:'UX'});
const order=readFileSync(new URL('../tools/vendor-patches/preset-order.js',import.meta.url),'utf8');
test('search clears late dialogs, asset shell precedes I/O, and presets move without rereading',async()=>{
  const browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
  try{
    const page=await browser.newPage();await page.setContent('<input id="nx-char-search" value="query"><div id="card" data-char-ref-scope="__global__"></div>');
    await page.addScriptTag({content:bundle.outputFiles[0].text});
    await page.evaluate(()=>{
      UX.installSearchClear();window.inputs=0;document.querySelector('input').addEventListener('input',()=>window.inputs++);
      window.risuai={getCurrentCharacterIndex:async()=>1,getCharacterFromIndex:async i=>{window.requestedIndex=i;return new Promise(resolve=>window.finishAssets=resolve);},getDatabase:async keys=>{window.dbKeys=keys;return {modules:[],enabledModules:[]};},readImage:async()=>null};
      window.opening=UX.pickCharacterAsset(document.getElementById('card'));
    });
    assert.equal(await page.locator('dialog').isVisible(),true,'slow asset read cannot delay shell');
    await page.waitForFunction(()=>!!window.finishAssets);
    await page.evaluate(()=>window.finishAssets({chaId:'current',additionalAssets:[['current-image','file-key','png']]}));
    await page.evaluate(()=>window.opening);
    assert.equal(await page.locator('dialog button[title="current-image"]').count(),1);
    assert.equal(await page.evaluate(()=>window.requestedIndex),1,'editor global scope must not select assets');
    assert.deepEqual(await page.evaluate(()=>window.dbKeys),['modules','enabledModules'],'avoid copying every character');
    await page.locator('dialog input[type="search"]').fill('missing');
    assert.equal(await page.locator('dialog button[title="current-image"]').count(),0);
    await page.locator('dialog .nx-search-clear').click();
    assert.equal(await page.locator('dialog button[title="current-image"]').count(),1);
    await page.getByRole('button',{name:'닫기',exact:true}).click();
    await page.locator('.nx-search-clear').click();
    assert.equal(await page.locator('#nx-char-search').inputValue(),'');assert.equal(await page.evaluate(()=>window.inputs),1);
    const globalOpen=await page.evaluate(()=>{
      document.body.innerHTML='<div class="char-card" data-char-id="local" data-char-scope="session"><input data-char-name value="Twin"></div><div class="char-card" data-char-id="global" data-char-scope="global"><input data-char-name value="Twin"></div><button data-ux-scope="global"></button><button data-ux-character-tile="global" data-ux-character-scope="global"></button><button id="nx-char-edit-btn"></button>';
      window.clicked=[];for(const el of document.querySelectorAll('button'))el.onclick=()=>window.clicked.push(el.dataset.uxScope||el.dataset.uxCharacterTile||el.id);
      return {opened:UX.openCharacterEditor({name:'Twin',roster:{id:'global',scope:'__global__'}}),clicked:window.clicked};
    });
    assert.deepEqual(globalOpen,{opened:true,clicked:['global','global','nx-char-edit-btn']},'global cast identity must not open a session namesake');
    await page.evaluate(order=>{
      document.body.innerHTML='<div id="nx-preset-chips">'+['a','b','c'].map(id=>'<button draggable="true" data-preset-select="'+id+'">'+id+'</button>').join('')+'</div><select id="nx-preset-select"><option>a</option><option selected>b</option><option>c</option></select>';
      const t={backendSettings:{card:{presets:['a','b','c'].map(id=>({id,name:id}))}}};window.saves=[];
      new Function('t','kt','presetIdEq','queueSettingsSave','e',order)(t,c=>structuredClone(c),(a,b)=>a===b,p=>window.saves.push(p),()=>{});
      window.dragData=new DataTransfer();
    },order);
    await page.locator('[data-preset-select="a"]').dispatchEvent('dragstart',{dataTransfer:await page.evaluateHandle(()=>window.dragData)});
    await page.locator('[data-preset-select="c"]').dispatchEvent('dragover');
    assert.deepEqual(await page.locator('[data-preset-select]').allTextContents(),['b','c','a']);
    assert.equal(await page.evaluate(()=>window.saves.length),0,'hovering only reorders local DOM');
    await page.locator('[data-preset-select="c"]').dispatchEvent('drop');
    await page.locator('[data-preset-select="a"]').dispatchEvent('dragend');
    assert.deepEqual(await page.evaluate(()=>window.saves[0].card.presets.map(p=>p.id)),['b','c','a']);
    assert.equal(await page.locator('#nx-preset-select').inputValue(),'b','dragging keeps active preset');
  }finally{await browser.close();}
});
