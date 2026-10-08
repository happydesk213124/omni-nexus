import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {chromium} from 'playwright';

test('actual settings bundle paints before blocked catalog/cleanup and preserves edits when the catalog arrives',async()=>{
  const source=readFileSync(new URL('../dist/omninexus.js',import.meta.url),'utf8');
  assert.equal(source.split('  await Qa();').length,2);
  const browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
  try {
    const page=await browser.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto('about:blank');
    await page.evaluate(()=>{
      const kv=new Map(),character={chaId:'c',name:'catalog character',chats:[{id:'chat',name:'catalog chat',message:[]}]};
      const probe=globalThis.openProbe={shows:0,block:false,releases:[]};
      globalThis.risuai={
        pluginStorage:{getItem:async key=>structuredClone(kv.get(key)),setItem:async(key,value)=>kv.set(key,structuredClone(value)),removeItem:async key=>kv.delete(key)},
        getArgument:async()=>'',
        getDatabase:async()=>{if(probe.block)await new Promise(resolve=>probe.releases.push(resolve));return {characters:[structuredClone(character)],modules:[]};},
        setDatabase:async()=>{},getCharacterFromIndex:async()=>structuredClone(character),getChatFromIndex:async()=>structuredClone(character.chats[0]),
        getCurrentCharacterIndex:async()=>0,getCurrentChatIndex:async()=>0,
        showContainer:async()=>{probe.shows++;},hideContainer:async()=>{},
      };
    });
    await page.addScriptTag({type:'module',content:source.replace('  await Qa();',`
      await le();t.uiTab='dashboard';t.backendSettings.card.floating_viewer=false;
      globalThis.openRuntime={t,open:At};
    `)});
    await page.waitForFunction(()=>!!globalThis.openRuntime);
    await page.evaluate(()=>{
      const {t,open}=openRuntime;
      t.charCatalog=[];
      openProbe.block=true;
      t.overlayUi={root:{setStyleAttribute:()=>new Promise(resolve=>openProbe.releases.push(resolve))}};
      openProbe.work=open();
    });
    await page.waitForSelector('#nx-close');
    assert.equal(await page.evaluate(()=>openProbe.shows),1);
    assert.ok(await page.evaluate(()=>openProbe.releases.length)>0,'the bridge is still blocked while the real controls are mounted');
    const field=page.locator('#nx-inline-chat-scale');
    await field.fill('137');
    await page.evaluate(()=>{openProbe.block=false;for(const release of openProbe.releases.splice(0))release();});
    await page.evaluate(()=>openProbe.work);
    await page.waitForFunction(()=>!openRuntime.t._settingsCatalogLoad);
    assert.equal(await field.inputValue(),'137','a delayed catalog must not repaint the edited settings');
    assert.deepEqual(await page.evaluate(()=>openRuntime.t.charCatalog.map(row=>row.name)),['catalog character']);
    assert.deepEqual(errors,[]);
  } finally {await browser.close();}
});
