import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const bundled = await build({ entryPoints: ['src/settings-ux/tab-html.ts'], bundle: true, write: false, format: 'iife', globalName: 'SettingsTabs' });
const cssModule = await build({ entryPoints: ['src/settings-ux/preview-css.ts'], bundle: true, write: false, format: 'iife', globalName: 'SettingsCss' });
const pack = JSON.parse(await readFile('src/settings-ux/preview-panes.json', 'utf8'));
const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
try {
  const page = await browser.newPage();
  await page.setContent('<!doctype html><html><head></head><body></body></html>');
  await page.addScriptTag({ content: bundled.outputFiles[0].text });
  await page.addScriptTag({ content: cssModule.outputFiles[0].text });
  const changelog = await page.evaluate(() => {
    const html = '<div class="card"><strong>0.1.2</strong><ul><li>Latest release</li></ul></div><div class="card"><strong>0.1.1</strong><ul><li>Previous release</li></ul></div>';
    document.body.innerHTML = SettingsTabs.tabHtml('changelog', html);
    return { text: document.body.textContent, entries: document.querySelectorAll('#changelog .block').length };
  });
  assert.match(changelog.text, /0\.1\.2[\s\S]*Latest release[\s\S]*0\.1\.1[\s\S]*Previous release/, 'changelog must preserve current and previous release entries');
  assert.equal(changelog.entries, 2);
  assert.doesNotMatch(changelog.text, /선택해도 겹침을 안 붙임|말 끝 단추/);
  const values = await page.evaluate(() => {
    const vendor = '<div id="legacy-parent"><input id="nx-power" type="checkbox"><input id="nx-scroll-hold" type="checkbox" checked></div><textarea id="nx-preset-positive">custom &lt;tag&gt;</textarea>';
    document.body.innerHTML = SettingsTabs.tabHtml('dashboard', vendor);
    const power = document.getElementById('nx-power').checked;
    const scroll = document.getElementById('nx-scroll-hold').checked;
    const ids = [...document.querySelectorAll('[id]')].map(el => el.id);
    const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
    document.body.innerHTML = SettingsTabs.tabHtml('style_presets', '<textarea id="nx-preset-positive">custom &lt;tag&gt;</textarea><input id="nx-preset-name" value="saved name">');
    const positive=document.getElementById('nx-preset-positive')?.value, name=document.getElementById('nx-preset-name')?.value;
    document.body.innerHTML = SettingsTabs.tabHtml('characters', '<details id="nx-lorefilter"><summary>캐릭터 로어북</summary><button id="nx-lorefilter-rescan">자동채우기</button></details>');
    return { power, scroll, duplicates, positive, name, loreParent:document.getElementById('nx-lorefilter')?.parentElement?.id, loreRescan:document.querySelectorAll('#nx-lorefilter-rescan').length };
  });
  assert.equal(values.power, false, 'unchecked saved value must override preview checked default');
  assert.equal(values.scroll, true, 'checked saved value survives HTML serialization');
  assert.deepEqual(values.duplicates, [], 'one live node per id');
  assert.equal(values.positive, 'custom <tag>');
  assert.equal(values.name, 'saved name');
  assert.equal(values.loreParent,'nx-lorefilter-slot');
  assert.equal(values.loreRescan,1);
  const streamingControls = await page.evaluate(() => {
    document.body.innerHTML = SettingsTabs.tabHtml('dashboard', '<input id="nx-inline-chat" type="checkbox"><input id="nx-persist-chat" type="checkbox">');
    const required = ['nx-inline-chat','nx-persist-chat'].map(id=>{const el=document.getElementById(id);return el.checked && el.disabled;});
    document.body.innerHTML = SettingsTabs.tabHtml('gen_options', '', {card:{omni_helper_prompt:true}});
    const helper=document.getElementById('nx-omni-helper'), keywords=document.getElementById('nx-stream-keywords-on');
    const helperOn=helper.checked, above=!!(helper.compareDocumentPosition(keywords)&Node.DOCUMENT_POSITION_FOLLOWING);
    document.body.innerHTML = SettingsTabs.tabHtml('gen_options', '', {card:{}});
    const helperOff=!document.getElementById('nx-omni-helper').checked;
    document.body.innerHTML = SettingsTabs.tabHtml('prompts', '<textarea id="nx-prompt-char_looks"></textarea>');
    return {required,helperOn,above,helperOff,retired:document.querySelectorAll('#nx-prompt-char_looks,#nx-prompt-autotag,#nx-prompt-asset_tags_inject,#nx-prompt-asset_author_note').length,reset:document.querySelectorAll('[data-reset-prompt="character_common"]').length};
  });
  assert.deepEqual(streamingControls,{required:[true,true],helperOn:true,above:true,helperOff:true,retired:0,reset:0});

  await mkdir('.test-build/settings-ux', { recursive: true });
  for (const width of [320, 375, 425, 768, 1440, 3440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const tab of ['dashboard', 'style_presets', 'characters', 'models', 'comic_gen']) {
      await page.evaluate(({ chrome, pane }) => {
        document.documentElement.className = 'nx-ux-on';
        document.head.innerHTML = '<style>' + SettingsCss.previewCss + '</style>';
        document.body.innerHTML = '<div id="nx-shell" class="nx-ux">' + chrome + '</div>';
        document.getElementById('nx-main').innerHTML = pane;
      }, { chrome: pack.chrome, pane: pack.panes[tab] });
      const layout = await page.evaluate(() => {
        const shell = document.getElementById('nx-shell');
        const switches = [...document.querySelectorAll('.sw input')].filter(el => el.getClientRects().length);
        const main = document.getElementById('nx-main');
        return {
          width: shell.getBoundingClientRect().width,
          height: shell.getBoundingClientRect().height,
          mainLeft: main.getBoundingClientRect().left,
          overflow: main.scrollWidth - main.clientWidth,
          switches: switches.map(el => ({ width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height, appearance: getComputedStyle(el).appearance })),
          shadow: getComputedStyle(document.querySelector('#nx-tabs button')).boxShadow,
          headerBottom: document.querySelector('.head').getBoundingClientRect().bottom,
          closeBottom: document.getElementById('nx-close').getBoundingClientRect().bottom,
          charActionTops: [...document.querySelectorAll('#characters .preset-current .actions button')].filter(el=>el.getClientRects().length).map(el=>Math.round(el.getBoundingClientRect().top)),
        };
      });
      assert.equal(layout.width, width);
      assert.equal(layout.height, 900);
      assert.equal(layout.shadow, 'none');
      assert.ok(layout.closeBottom <= layout.headerBottom, `${tab}@${width}: header actions overlap content`);
      if (width <= 768) assert.equal(layout.mainLeft, 0, `${tab}: mobile sidebar must not consume a grid column`);
      assert.ok(layout.overflow <= 1, `${tab}@${width}: horizontal overflow ${layout.overflow}`);
      if(width===320 && tab==='characters') assert.equal(new Set(layout.charActionTops).size,1,'character action buttons must remain on one mobile row');
      if (width <= 768 && tab === 'dashboard') {
        const mobile = await page.evaluate(() => {
          const nav = document.getElementById('nx-tabs');
          const hidden = getComputedStyle(nav).display === 'none';
          document.documentElement.classList.add('nx-nav-open');
          const visible = nav.getBoundingClientRect().width > 100 && getComputedStyle(nav).display !== 'none';
          document.documentElement.classList.remove('nx-nav-open');
          return {hidden,visible,brandHidden:getComputedStyle(document.querySelector('.head-brand')).display === 'none'};
        });
        assert.deepEqual(mobile, {hidden:true,visible:true,brandHidden:true});
      }
      for (const sw of layout.switches) {
        assert.ok(sw.width >= 36 && sw.height >= 22, `${tab}: switch must retain dimensions`);
        assert.equal(sw.appearance, 'none');
      }
      if (tab === 'dashboard' && [320, 1440].includes(width)) await page.screenshot({ path: `.test-build/settings-ux/dashboard-${width}.png` });
    }
  }
  const assetPickerBundle = await build({entryPoints:['src/settings-ux/asset-picker.ts'],bundle:true,write:false,format:'iife',globalName:'AssetPicker'});
  const searchClearBundle = await build({entryPoints:['src/settings-ux/search-clear.ts'],bundle:true,write:false,format:'iife',globalName:'SearchClear'});
  await page.addScriptTag({content:assetPickerBundle.outputFiles[0].text});
  await page.addScriptTag({content:searchClearBundle.outputFiles[0].text});
  const vendorCss = (await readFile('vendor/inlay-nexus-ui.js','utf8')).match(/\.explorer-lightbox\{[\s\S]*?\.explorer-lightbox \.lb-bar \.ex-mobile-select.active\{[^}]*\}/)[0];
  for (const width of [320,1440]) {
    await page.setViewportSize({width,height:900});
    const result=await page.evaluate(async ({chrome,vendorCss})=>{
      document.head.innerHTML='<style>'+vendorCss+'\n'+SettingsCss.previewCss+'</style>';
      document.body.innerHTML='<div id="nx-shell" class="nx-ux">'+chrome+'<div class="risu-pick open"><div class="risu-pick-head">캐릭터</div><div class="risu-pick-tiles" id="nx-risu-pick-tiles"></div></div></div>';
      const tiles=document.getElementById('nx-risu-pick-tiles');
      const src='data:image/svg+xml;base64,'+btoa('<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="3000"></svg>');
      tiles.innerHTML=Array.from({length:40},(_,i)=>`<button class="risu-tile"><img src="${src}"><span>Character ${i}</span></button>`).join('');
      const measure=(grid,columns)=>{const nodes=[...grid.children];const a=nodes[0].getBoundingClientRect(),b=nodes[columns].getBoundingClientRect();return {gap:b.top-a.bottom,square:Math.abs(a.width-a.height),scroll:grid.scrollHeight>grid.clientHeight};};
      const bots=measure(tiles,2);
      SearchClear.installSearchClear();
      globalThis.risuai={getCurrentCharacterIndex:async()=>0,getDatabase:async()=>({characters:[{chaId:'bot',additionalAssets:Array.from({length:40},(_,i)=>['Asset '+i,'file/'+i])}],modules:[],enabledModules:[]}),readImage:async()=>src};
      const card=document.createElement('div');document.body.append(card);
      await AssetPicker.pickCharacterAsset(card);
      const dialog=document.querySelector('dialog');const assets=measure(dialog.firstElementChild.lastElementChild,3);
      assets.headerHeight=dialog.firstElementChild.lastElementChild.getBoundingClientRect().top-dialog.getBoundingClientRect().top;
      dialog.close();dialog.remove();
      const lb=document.createElement('div');lb.id='nx-explorer-lightbox';lb.className='explorer-lightbox show';
      lb.innerHTML='<div class="lb-stage"><img></div><div class="lb-bar"><button>◀</button><span data-lb-meta>1/40</span><button>▶</button><button>즐겨찾기</button><button>수정</button><button>닫기</button></div>';
      document.getElementById('nx-shell').append(lb);
      const positions=[];
      for(const [w,h] of [[832,1216],[1216,832],[1024,1024]]) {
        lb.querySelector('img').src='data:image/svg+xml;base64,'+btoa(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"></svg>`);
        await lb.querySelector('img').decode();
        const r=lb.querySelector('.lb-bar').getBoundingClientRect(),stage=lb.querySelector('.lb-stage').getBoundingClientRect(),img=lb.querySelector('img').getBoundingClientRect();
        positions.push({top:r.top,bottom:r.bottom,cx:img.x+img.width/2-(stage.x+stage.width/2),cy:img.y+img.height/2-(stage.y+stage.height/2)});
      }
      return {bots,assets,positions};
    },{chrome:pack.chrome,vendorCss});
    for(const grid of [result.bots,result.assets]) {assert.ok(grid.gap>=7,`picker rows overlap @${width}: ${JSON.stringify(grid)}`);assert.ok(grid.square<=1);assert.equal(grid.scroll,true);}
    assert.ok(result.assets.headerHeight<220,`asset toolbar consumes the list @${width}: ${result.assets.headerHeight}`);
    assert.ok(result.positions.every(p=>p.top===result.positions[0].top && p.bottom<=900 && Math.abs(p.cx)<1 && Math.abs(p.cy)<1),`lightbox geometry changes @${width}`);
  }
  const full = await readFile('dist/omninexus.js', 'utf8');
  assert.equal(full.split('  await Qa();').length, 2, 'test boot seam must match exactly once');
  await page.goto('about:blank');
  await page.evaluate(() => {
    const kv = new Map();
    let character={chaId:'ux-character',name:'UX',globalLore:[],chats:[{id:'ux-chat',message:[]}]}, modules=[];
    globalThis.risuai = {
      pluginStorage: {getItem: async k => kv.get(k), setItem: async (k,v) => kv.set(k,v), removeItem: async k => kv.delete(k)},
      getArgument: async () => '', getDatabase: async () => ({characters:[structuredClone(character)], modules:structuredClone(modules)}),
      setDatabase:async db=>{if(db.modules)modules=structuredClone(db.modules);},
      getCharacterFromIndex:async()=>structuredClone(character),setCharacterToIndex:async(_i,c)=>{character=structuredClone(c);},
      getChatFromIndex:async()=>structuredClone(character.chats[0]),
      getCurrentCharacterIndex: async () => 0, getCurrentChatIndex: async () => 0,
    };
  });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addScriptTag({ type: 'module', content: full.replace('  await Qa();', `
    await le();
    t.uiOpen = true;
    globalThis.uxTestRuntime = {t, paint:P, flush:flushSettingsSave, readCharacters:oe, paintExplorerWindow, openExplorerLightbox};
    await P();
  `) });
  await page.waitForFunction(() => !!globalThis.uxTestRuntime);
  for (const tab of ['dashboard','gen_options','comic_gen','style_presets','characters','models','prompts','debug']) {
    await page.evaluate(async tab => { const {t,paint}=globalThis.uxTestRuntime; t.uiTab=tab; await paint(); }, tab);
    const live = await page.evaluate(() => {
      const ids=[...document.querySelectorAll('[id]')].map(el=>el.id);
      return {duplicates:ids.filter((id,i)=>ids.indexOf(id)!==i), pane:!!document.querySelector('#nx-main .pane'), shadow:getComputedStyle(document.querySelector('#nx-tabs button')).boxShadow};
    });
    assert.deepEqual(live.duplicates, [], `${tab}: duplicate mounted ids`);
    assert.ok(live.pane, `${tab}: preview pane missing`);
    assert.equal(live.shadow,'none');
    if (tab === 'comic_gen') {
      const toggle = page.locator('#nx-comic-natural-supplement');
      assert.equal(await toggle.isVisible(), true, 'comic natural toggle must be visible');
      for (const enabled of [true, false]) {
        await toggle.setChecked(enabled);
        await page.evaluate(() => globalThis.uxTestRuntime.flush());
        assert.equal(await page.evaluate(() => globalThis.uxTestRuntime.t.backendSettings.card.comic_natural_supplement), enabled);
      }
    }
  }
  await page.evaluate(async () => {
    await globalThis.__OMNI_SETTINGS_ACTIONS__.save({card:{presets:[{id:'rename-probe',name:'Before rename',positive:'probe',negative:''}],active_preset_id:'rename-probe'}});
    const {t,paint}=globalThis.uxTestRuntime;t.uiTab='style_presets';await paint();
    globalThis.renamePresetTile=document.querySelector('[data-preset-select="rename-probe"]');
    globalThis.renamePresetList=document.getElementById('nx-preset-chips');
  });
  await page.locator('#nx-preset-edit-btn').click();
  await page.locator('#nx-preset-name').fill('Renamed immediately');
  assert.equal(await page.locator('[data-preset-select="rename-probe"] [data-preset-label]').textContent(),'Renamed immediately');
  await page.evaluate(()=>globalThis.uxTestRuntime.flush());
  assert.equal(await page.evaluate(()=>globalThis.renamePresetTile===document.querySelector('[data-preset-select="rename-probe"]')
    && globalThis.renamePresetList===document.getElementById('nx-preset-chips')),true,'preset autosave must preserve mounted tiles');
  assert.equal(await page.evaluate(()=>globalThis.uxTestRuntime.t.backendSettings.card.presets.find(p=>p.id==='rename-probe')?.name),'Renamed immediately');
  await page.locator('#nx-preset-sheet-close').click();
  for (const [tab,id] of [['style_presets','nx-preset-search'],['characters','nx-char-search'],['style_presets','nx-preset-search']]) {
    await page.evaluate(async tab=>{const {t,paint}=globalThis.uxTestRuntime;t.uiTab=tab;await paint();},tab);
    await page.locator('#'+id).fill('no matching entry');
    const clear=page.locator('.nx-search-wrap').filter({has:page.locator('#'+id)}).getByRole('button',{name:'검색어 지우기'});
    assert.equal(await clear.isVisible(),true,`${tab}: clear button visible after typing`);
    await clear.click();
    assert.equal(await page.locator('#'+id).inputValue(),'');
    assert.equal(await clear.isVisible(),true,`${tab}: empty search keeps its clear button`);
    assert.equal(await clear.isDisabled(),true);
    assert.equal(await page.locator('#'+id).evaluate(el=>el===document.activeElement),true);
  }
  await page.evaluate(async () => {
    const {t,paint}=globalThis.uxTestRuntime;
    await globalThis.__OMNI_SETTINGS_ACTIONS__.save({card:{...t.backendSettings.card, secondary_preset_id:'rename-probe'}});
    t.uiTab='style_presets';await paint();
  });
  assert.equal(await page.locator('[data-preset-select="rename-probe"].second').count(),1,'secondary preset tile keeps its green mark');
  assert.equal(await page.evaluate(()=>getComputedStyle(document.querySelector('[data-preset-select="rename-probe"].second')).outlineColor),'rgb(20, 158, 97)');
  assert.equal(await page.evaluate(()=>getComputedStyle(document.querySelector('[data-preset-select="rename-probe"].second'),'::after').content),'"적용 중 · 2순위"');
  await page.locator('#nx-preset-second').click();
  await page.waitForFunction(()=>!globalThis.uxTestRuntime.t.backendSettings.card.secondary_preset_id);
  assert.equal(await page.locator('[data-preset-select="rename-probe"].second').count(),0,'unsetting secondary clears the mark without reopening settings');
  await page.locator('#nx-preset-second').click();
  await page.waitForFunction(()=>globalThis.uxTestRuntime.t.backendSettings.card.secondary_preset_id==='rename-probe');
  assert.equal(await page.locator('[data-preset-select="rename-probe"].second').count(),1,'setting secondary marks the tile without reopening settings');
  await page.evaluate(async () => { const {t,paint}=globalThis.uxTestRuntime; t.uiTab='dashboard'; await paint(); });
  const previous = await page.locator('#nx-scroll-hold').isChecked();
  await page.locator('#nx-scroll-hold').setChecked(!previous);
  await page.evaluate(async () => { await globalThis.uxTestRuntime.flush(); });
  await page.waitForFunction(expected => globalThis.uxTestRuntime.t.backendSettings.card.scroll_hold === expected, !previous);
  await page.evaluate(async () => { const {t,paint}=globalThis.uxTestRuntime; t.uiTab='models'; await paint(); t.uiTab='dashboard'; await paint(); });
  assert.equal(await page.locator('#nx-scroll-hold').isChecked(), !previous, 'real checkbox persists through tab remount');
  for (const checked of [true,false]) {
    await page.evaluate(async () => {const {t,paint}=globalThis.uxTestRuntime;t.uiTab='gen_options';await paint();});
    for(const id of ['nx-appearance','nx-llm-json-retry','nx-llm-reverse-bar','nx-llm-tag-cal','nx-preprocess','nx-stream-keywords-on']) await page.locator('#'+id).setChecked(checked);
    await page.evaluate(()=>globalThis.uxTestRuntime.flush());
    await page.evaluate(async()=>{const {t,paint}=globalThis.uxTestRuntime;t.uiTab='dashboard';await paint();t.uiTab='gen_options';await paint();});
    for(const id of ['nx-appearance','nx-llm-json-retry','nx-llm-reverse-bar','nx-llm-tag-cal','nx-preprocess','nx-stream-keywords-on']) assert.equal(await page.locator('#'+id).isChecked(),checked,`${id}: moved habit restores persisted value`);
  }
  for(const nai of [{},{api_keys_v4_configured:1},{api_keys_v5_configured:1},{comfy_workflow_json:'{}'}]) {
    await page.evaluate(async nai=>{const {t,paint}=globalThis.uxTestRuntime;t.backendSettings.nai=nai;await paint();},nai);
    assert.equal(await page.locator('#nx-tabs [data-nx-tab="models"] .alarm').isVisible(),Object.keys(nai).length===0,'any image backend removes preview warning dot');
  }
  await page.evaluate(async()=>{await globalThis.__OMNI_SETTINGS_ACTIONS__.save({});});
  await page.evaluate(async () => { const {t,paint}=globalThis.uxTestRuntime; t.uiTab='models'; await paint(); });
  const family5 = await page.locator('#nx-nai-model').inputValue();
  assert.equal(await page.locator('#nx-nai-keys-v5').isVisible(),family5.includes('nai-diffusion-5'));
  assert.equal(await page.locator('#nx-nai-keys-v4').isVisible(),!family5.includes('nai-diffusion-5'));
  await page.locator('#nx-nai-w').fill('960');
  await page.evaluate(() => globalThis.uxTestRuntime.flush());
  await page.waitForFunction(() => globalThis.uxTestRuntime.t.backendSettings.nai.width === 960);
  await page.evaluate(async () => { const {t,paint}=globalThis.uxTestRuntime; t.uiTab='dashboard'; await paint(); t.uiTab='models'; await paint(); });
  assert.equal(await page.locator('#nx-nai-w').inputValue(),'960','models tab autosaves without dashboard DOM');
  await page.locator('[data-llm-role="autotag"]').click();
  await page.locator('#nx-llm-autotag-source').selectOption('custom');
  await page.locator('#nx-llm-autotag-model').fill('omni-autotag-test');
  await page.evaluate(() => globalThis.uxTestRuntime.flush());
  await page.locator('[data-llm-role="main"]').click();
  await page.locator('[data-llm-role="autotag"]').click();
  assert.equal(await page.locator('#nx-llm-autotag-model').inputValue(),'omni-autotag-test');
  await page.locator('[data-llm-role="comic"]').click();
  assert.equal(await page.locator('#nx-llm-comic-source').isVisible(),true);
  await page.locator('[data-llm-role="curator"]').click();
  assert.equal(await page.locator('[data-ux-llm-role="curator"]').isVisible(),true);
  await page.locator('[data-backend="comfy"]').click();
  assert.equal(await page.locator('#nx-comfy-url').isVisible(),true);
  await page.locator('[data-backend="nai"]').click();
  assert.equal(await page.locator('#nx-comfy-url').isVisible(),false);
  await page.evaluate(async () => {
    await globalThis.__OMNI_SETTINGS_ACTIONS__.save({nai:{api_keys_v4:['test-v4-key'],api_keys_v5:['test-v5-key']}});
    await globalThis.uxTestRuntime.paint();
  });
  const clearButton=page.getByRole('button',{name:'이 탭 키 모두 지우기'}).filter({visible:true});
  assert.equal(await clearButton.count(),1,JSON.stringify(await page.evaluate(()=>[...document.querySelectorAll('button')].filter(b=>b.textContent.includes('이 탭 키')).map(b=>({html:b.outerHTML,parent:b.parentElement.outerHTML.slice(0,900)})))));
  const deletingV5=(await page.locator('#nx-nai-model').inputValue()).includes('nai-diffusion-5');
  await clearButton.click();
  await page.waitForFunction(v5=> {
    const cfg=globalThis.__OMNI_SETTINGS_ACTIONS__.config().nai;
    return v5 ? !cfg.api_keys_v5_configured && !!cfg.api_keys_v4_configured : !cfg.api_keys_v4_configured && !!cfg.api_keys_v5_configured;
  },deletingV5);
  await page.evaluate(async () => {const {t,paint}=globalThis.uxTestRuntime;t.uiTab='dashboard';await paint();});
  await page.locator('#nx-help-toggle').click();
  await page.locator('#nx-scroll-hold').hover();
  assert.equal(await page.locator('#nx-head-help').isVisible(),true);
  assert.match(await page.locator('#nx-head-help-title').textContent(),/스크롤/);
  await page.locator('#nx-help-toggle').click();
  await page.evaluate(async () => {
    const {t,paint}=globalThis.uxTestRuntime;
    await globalThis.__OMNI_SELECT_CHARACTER_SCOPE__('0');
    t._charsBgRefresh=true;
    t.charCatalog=[{index:0,name:'UX',chats:[{index:0,name:'Chat'}]}];
    t.charactersSession=[{id:'a',name:'Alice',appearance:'blue eyes',attire:'shirt',bottoms:'skirt'},{id:'b',name:'Bob',appearance:'brown eyes'}];
    t.charactersGlobal=[{id:'g',name:'Global',appearance:'green eyes'}];
    t.uiTab='characters'; await paint();
  });
  assert.equal(await page.locator('#nx-char-session-list .preset-tile').count(),2);
  assert.equal(await page.locator('#nx-char-global-list').isVisible(),false);
  await page.locator('#nx-char-edit-btn').click();
  await page.evaluate(()=>{globalThis.renameCharacterTile=document.querySelector('[data-ux-character-tile="a"]');});
  await page.locator('#nx-char-edit-name').fill('Alice edited');
  assert.equal(await page.evaluate(() => globalThis.uxTestRuntime.readCharacters('session')[0].name), 'Alice edited');
  assert.equal(await page.locator('[data-ux-character-tile="a"] [data-character-label]').textContent(),'Alice edited');
  await page.evaluate(()=>globalThis.__OMNI_FLUSH_CHARACTERS__());
  assert.equal(await page.evaluate(()=>globalThis.renameCharacterTile===document.querySelector('[data-ux-character-tile="a"]')),true,'character autosave must preserve mounted tiles');
  const characterUiBundle=await build({stdin:{contents:"export {applyCharacterToForm,readCharacterFromForm} from './src/char-command/form'; export {publishCharacterImage} from './src/core/character-ui-events'; export {connectCharacterImages} from './src/settings-ux/reference-progress'; export {registerCharacterPreview} from './src/settings-ux/character-preview-index';",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'iife',globalName:'CharacterUi'});
  await page.addScriptTag({content:characterUiBundle.outputFiles[0].text});
  const refresh=await page.evaluate(()=>{
    const card=document.querySelector('.char-card[data-char-id="a"]');
    const record=CharacterUi.readCharacterFromForm(card,'char',{id:'a'});
    record.costumes=[{name:'default',appearance:'freckles',hair_color:'red hair',attire:'shirt',bottoms:'skirt',accessories:''},{name:'magic',appearance:'[base]',hair_color:'pink hair',attire:'dress',bottoms:'',accessories:'wand'}];record.active_costume=1;
    CharacterUi.applyCharacterToForm(card,'char',record);
    const displayed=document.querySelector('#nx-char-edit-body [data-char-hair-color]').value;
    const selector=card.querySelector('[data-char-costume]');selector.value='0';selector.dispatchEvent(new Event('change',{bubbles:true}));
    selector.value='1';selector.dispatchEvent(new Event('change',{bubbles:true}));
    const roundtrip=CharacterUi.readCharacterFromForm(card,'char',record);
    // This separately compiled helper has its own index, unlike the production
    // bundle where bindCharacterSheet and image events share one module instance.
    CharacterUi.registerCharacterPreview(card,document.querySelector('[data-ux-character-tile="a"]'));
    CharacterUi.connectCharacterImages();
    const uri='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"></svg>');
    const scope=card.dataset.charRefScope;
    CharacterUi.publishCharacterImage({scope,id:'a',kind:'example',url:uri,configured:true});
    const example=document.querySelector('[data-ux-character-tile="a"] img')?.src;
    CharacterUi.publishCharacterImage({scope,id:'a',kind:'ref',url:uri+'#ref',configured:true});
    CharacterUi.publishCharacterImage({scope:'other-bot',id:'a',kind:'ref',url:uri+'#wrong',configured:true});
    const ref=document.querySelector('[data-ux-character-tile="a"] img')?.src;
    const editor=document.querySelector('#nx-char-edit-body [data-char-ref-preview] img')?.src;
    CharacterUi.publishCharacterImage({scope,id:'a',kind:'ref',url:'',hash:'',configured:false});
    const fallback=document.querySelector('[data-ux-character-tile="a"] img')?.src;
    return {displayed,costume:roundtrip.costumes[1],example,ref,editor,fallback};
  });
  assert.equal(refresh.displayed,'pink hair','command result refreshes the already-open sheet');
  assert.equal(refresh.costume.hair_color,'pink hair','rebuilt options retain the active reference');
  assert.equal(refresh.costume.appearance,'[base]');assert.equal(refresh.costume.bottoms,'');
  assert.ok(refresh.example?.startsWith('data:image/'));
  assert.ok(refresh.ref?.endsWith('#ref'));assert.equal(refresh.editor,refresh.ref);
  assert.equal(refresh.fallback,refresh.example,'removing reference immediately restores example fallback');
  await page.locator('#nx-char-sheet-close').click();
  assert.equal(await page.locator('#nx-risu-pick').getAttribute('aria-hidden'),'true');
  await page.locator('#nx-char-risu-open').click();
  const currentTile = page.locator('#nx-risu-pick-tiles [data-risu-value="live"]');
  const globalTile = page.locator('#nx-risu-pick-tiles [data-risu-value="__global__"]');
  await currentTile.waitFor({state:'visible'});
  assert.equal(await currentTile.textContent(),'현재 캐릭터 챗');
  assert.deepEqual(await page.locator('#nx-risu-pick-tiles > button').evaluateAll(tiles => tiles.slice(0,2).map(tile=>tile.dataset.risuValue)),['live','__global__']);
  const currentRect = await currentTile.boundingBox(), globalRect = await globalTile.boundingBox();
  assert.ok(currentRect && globalRect, 'both scope tiles must be visible');
  assert.ok(Math.abs(currentRect.width-currentRect.height)<=1 && Math.abs(globalRect.width-globalRect.height)<=1,'scope tiles must be square');
  assert.ok(Math.abs(currentRect.y-globalRect.y)<=1 && globalRect.x>currentRect.x,'scope tiles share the first row');
  assert.equal(await page.locator('#nx-char-scope-bar').isVisible(),false,'separate scope bar stays hidden');
  const botBeforeGlobal = await page.locator('#nx-scope-char').inputValue();
  await globalTile.click();
  assert.equal(await globalTile.getAttribute('aria-pressed'),'true');
  assert.equal(await currentTile.getAttribute('aria-pressed'),'false');
  assert.equal(await page.locator('#nx-risu-pick-tiles .on').count(),1,'exactly one picker tile is selected');
  assert.equal(await page.locator('#nx-scope-char').inputValue(),botBeforeGlobal,'global roster must not change the bot scope');
  assert.equal(await page.locator('#nx-char-global-list').isVisible(),true);
  assert.equal(await page.locator('#nx-char-session-list').isVisible(),false);
  await page.locator('#nx-risu-pick-close').click();
  await page.locator('#nx-char-risu-open').click();
  await globalTile.waitFor({state:'visible'});
  assert.equal(await globalTile.getAttribute('aria-pressed'),'true','global selection survives picker refill');
  assert.equal(await page.locator('#nx-char-global-list').isVisible(),true);
  await currentTile.click();
  await page.waitForFunction(() => document.getElementById('nx-scope-char')?.value === '0' && !document.getElementById('nx-char-session-list')?.hidden);
  assert.equal(await page.locator('#nx-risu-pick').getAttribute('aria-hidden'),'false','scope change retains open picker');
  await currentTile.waitFor({state:'visible'});
  assert.equal(await currentTile.getAttribute('aria-pressed'),'false');
  assert.equal(await page.locator('[data-risu-value="0"]').getAttribute('aria-pressed'),'true');
  assert.equal(await globalTile.getAttribute('aria-pressed'),'false');
  assert.equal(await page.locator('#nx-risu-pick-tiles .on').count(),1);
  assert.equal(await page.locator('#nx-char-session-list').isVisible(),true);
  assert.equal(await page.locator('#nx-char-global-list').isVisible(),false);
  await page.locator('#nx-risu-pick-close').click();
  await page.locator('#nx-char-risu-open').click();
  await currentTile.waitFor({state:'visible'});
  assert.equal(await currentTile.getAttribute('aria-pressed'),'false','shortcut itself is never selected');
  assert.equal(await page.locator('[data-risu-value="0"]').getAttribute('aria-pressed'),'true','actual bot selection survives picker refill');
  await page.locator('#nx-risu-pick-close').click();
  await page.locator('#nx-char-add-session').click();
  await page.waitForFunction(() => globalThis.uxTestRuntime.t.charactersSession.some(c=>c.name==='New Character'));
  await page.evaluate(async () => { const {t,paint}=globalThis.uxTestRuntime; t.uiTab='dashboard'; await paint(); t.uiTab='characters'; await paint(); });
  assert.ok((await page.locator('#nx-char-session-list').textContent()).includes('New Character'),'new character survives remount');
  const countBeforeDelete = await page.locator('#nx-char-session-list .preset-tile').count();
  assert.ok(countBeforeDelete >= 2);
  await page.locator('#nx-char-session-list .preset-tile').first().click();
  if (!await page.locator('#nx-char-sheet').evaluate(el=>el.classList.contains('open'))) await page.locator('#nx-char-edit-btn').click();
  const editedName = await page.locator('#nx-char-edit-name').inputValue();
  assert.ok((await page.locator('#nx-char-sheet-close').textContent()).includes(editedName));
  assert.equal(await page.locator('.char-edit-head #nx-char-edit-title').count(),0,'no duplicate editor heading');
  await page.evaluate(async()=>{
    await globalThis.__OMNI_FLUSH_CHARACTERS__();
    globalThis.uxSavedWriter=risuai.setCharacterToIndex;
    risuai.setCharacterToIndex=()=>new Promise((_resolve,reject)=>{globalThis.uxDeleteReject=reject;});
    globalThis.uxAlerts=[];window.alert=text=>uxAlerts.push(String(text));
  });
  await page.locator('#nx-char-edit-body [data-char-delete]').click();
  assert.equal(await page.locator('#nx-char-session-list .preset-tile').count(),countBeforeDelete-1,'optimistic deletion must precede the host write');
  await page.waitForFunction(()=>!!globalThis.uxDeleteReject);
  await page.evaluate(()=>uxDeleteReject(new Error('deliberate storage failure')));
  await page.waitForFunction(()=>globalThis.uxAlerts.length>0 && !document.getElementById('nx-char-edit-body').inert);
  assert.equal(await page.locator('#nx-char-session-list .preset-tile').count(),countBeforeDelete);
  assert.equal(await page.locator('#nx-char-edit-name').inputValue(),editedName);
  await page.evaluate(()=>{risuai.setCharacterToIndex=globalThis.uxSavedWriter;});
  await page.locator('#nx-char-edit-body [data-char-delete]').click();
  await page.waitForFunction(n=>document.querySelectorAll('#nx-char-session-list .preset-tile').length===n,countBeforeDelete-1);
  assert.notEqual(await page.locator('#nx-char-edit-name').inputValue(),editedName,'next character is selected immediately');
  await page.locator('#nx-char-sheet-close').click();
  await page.evaluate(()=>{window.confirm=()=>true;});
  await page.locator('#nx-char-del-all').click();
  await page.waitForFunction(()=>document.querySelectorAll('#nx-char-session-list .preset-tile').length===0);
  assert.equal(await page.locator('#nx-char-empty').isVisible(),true);
  await page.evaluate(async()=>{const {t,paint}=uxTestRuntime;t.uiTab='dashboard';await paint();t.uiTab='characters';await paint();});
  assert.equal(await page.locator('#nx-char-session-list .preset-tile').count(),0,'deleted records stay deleted after remount');
  assert.deepEqual(errors, [], 'real vendor handlers must mount without runtime errors');
  // Drive the actual runtime, not a static lightbox copy: old body nodes survived P().
  await page.evaluate(async()=>{
    const N=globalThis.__INLAY_NATIVE__;
    globalThis.exReads=0; globalThis.base64Reads=0;
    const src='data:image/svg+xml;base64,'+btoa('<svg xmlns="http://www.w3.org/2000/svg" width="832" height="1216"></svg>');
    N.resolveExplorerThumbUrl=()=>src;
    N.ensureExplorerThumbUrl=async()=>{exReads++;return src;};
    N.ensureImageUrl=async()=>{base64Reads++;throw new Error('unexpected base64 path');};
    globalThis.seedExplorer=async()=>{
      const {t,paint,paintExplorerWindow}=uxTestRuntime;t.uiTab='explorer';t.explorer.loadedAt=Date.now();await paint();
      t.explorer.items=Array.from({length:300},(_,i)=>({id:'ex-'+i,folder_key:'a|chat',character_order:0,asset_order:300-i}));
      t.explorer.folders=[{key:'a|chat',character_id:'a',chat_id:'chat'}];
      t.explorer.folderKey='__all__';t.explorer.folderScroll={};paintExplorerWindow(false);
    };
  });
  for (const width of [320,1440]) {
    await page.setViewportSize({width,height:900});
    await page.evaluate(()=>seedExplorer());
    const first=await page.locator('#nx-explorer-grid').evaluate(grid=>({height:grid.clientHeight,parent:grid.parentElement.clientHeight,mounted:grid.querySelectorAll('[data-explorer-id]').length}));
    assert.ok(first.height<=first.parent+1 && first.mounted<100,'viewport must not expand to the whole virtual list');
    await page.locator('#nx-explorer-grid').evaluate(grid=>{grid.scrollTop=grid.scrollHeight;grid.dispatchEvent(new Event('scroll'));});
    await page.waitForFunction(()=>!!document.querySelector('[data-explorer-id="ex-299"]'));
    assert.ok(await page.locator('#nx-explorer-grid [data-explorer-id]').count()<100);
    await page.evaluate(()=>seedExplorer());
    await page.locator('[data-explorer-id="ex-0"]').dblclick();
    await page.locator('#nx-explorer-lightbox.show').waitFor({state:'visible',timeout:5000});
    await page.locator('#nx-explorer-lightbox').click({position:{x:2,y:2}});
    assert.equal(await page.locator('#nx-explorer-lightbox.show').count(),0);
    await page.evaluate(()=>seedExplorer());
    await page.locator('[data-explorer-id="ex-0"]').dblclick();
    assert.equal(await page.locator('#nx-explorer-lightbox').count(),1,'repaint must not leave duplicate lightboxes');
    const before=await page.evaluate(()=>({reads:exReads,base64:base64Reads}));
    await page.evaluate(()=>{for(let i=0;i<20;i++){uxTestRuntime.t.explorer.lbPanX=i;uxTestRuntime.t.explorer.lbZoom=2;uxTestRuntime.t._explorerLbPaint();}});
    assert.deepEqual(await page.evaluate(()=>({reads:exReads,base64:base64Reads})),before,'pan/zoom must not reload pixels');
    assert.equal(before.base64,0,'lightbox must reuse original explorer blob');
    await page.evaluate(()=>{uxTestRuntime.t.explorer.favorites=['ex-0'];uxTestRuntime.t._explorerLbPaint();});
    assert.equal(await page.locator('#nx-lb-fav').evaluate(n=>n.classList.contains('active')),true);
    await page.locator('#nx-lb-close').click();
    assert.equal(await page.locator('#nx-explorer-lightbox.show').count(),0);
  }
  const geometry = await build({ stdin: {contents: "export {inrayDisplayOut,spinnerDisplayRegexScript} from './src/domain/inray-display'; export {inlineChatStackStyle,inlineChatSpinnerImgStyle,inlineChatOverlayImgStyle,inlineChatOverlayPhotoStyle} from './src/ui-contract/viewer-core';", resolveDir:process.cwd(),loader:'ts'}, bundle:true,write:false,format:'iife',globalName:'ChatGeometry'});
  await page.goto('about:blank');
  await page.addScriptTag({content:geometry.outputFiles[0].text});
  for (const width of [320,1440]) {
    await page.setViewportSize({width,height:900});
    for (const [w,h] of [[832,1216],[1216,832],[1024,1024]]) for (const scale of [50,100,200]) {
      const dimensions = await page.evaluate(async ({w,h,scale}) => {
        const src='data:image/svg+xml,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="purple"/></svg>`);
        document.body.style.margin='0';
        const baked = ChatGeometry.inrayDisplayOut(false,scale).replaceAll('$1','test').replace('{{$'+'2}}',src).replaceAll('{{raw::$2}}',src).replaceAll('$3',String(w)).replaceAll('$4',String(h));
        document.body.innerHTML=`<div style="text-align:center"><span style="${ChatGeometry.inlineChatStackStyle(scale)}"><img id="spinner-test" src="${src}" style="${ChatGeometry.inlineChatSpinnerImgStyle(scale)}"><span style="${ChatGeometry.inlineChatOverlayImgStyle(true,scale)}"><img id="photo-test" src="${src}" style="${ChatGeometry.inlineChatOverlayPhotoStyle()}"></span></span></div>`+baked;
        const rule=ChatGeometry.spinnerDisplayRegexScript(scale);
        document.body.insertAdjacentHTML('beforeend',`[[@inrayspinner::job_0::${w}::${h}]]`.replace(new RegExp(rule.in,rule.flag),rule.out));
        await Promise.all([...document.images].map(image=>image.decode()));
        const spin=document.getElementById('spinner-test').getBoundingClientRect(), bake=document.querySelector('.inray-shot-img').getBoundingClientRect();
        const persisted=document.querySelector('[data-inray-spinner] svg').getBoundingClientRect();
        return {persisted:{width:persisted.width,height:persisted.height},spin:{width:spin.width,height:spin.height},bake:{width:bake.width,height:bake.height},photo:{width:document.getElementById("photo-test").getBoundingClientRect().width,height:document.getElementById("photo-test").getBoundingClientRect().height}};
      },{w,h,scale});
      assert.ok(Math.abs(dimensions.persisted.width-dimensions.bake.width)<=1 && Math.abs(dimensions.persisted.height-dimensions.bake.height)<=1, `persisted spinner mismatch ${width}/${w}x${h}/${scale}: ${JSON.stringify(dimensions)}`);
      assert.ok(dimensions.photo.width<=dimensions.spin.width+1 && dimensions.photo.height<=dimensions.spin.height+1, "overlay must not exceed spinner bounds");
      assert.ok(Math.abs(dimensions.spin.width-dimensions.bake.width)<=1 && Math.abs(dimensions.spin.height-dimensions.bake.height)<=1, `bake/spinner size mismatch ${width}/${w}x${h}/${scale}`);
    }
  }
  console.log('Settings UX: values, responsive layouts, and real bundle tab mounting passed.');
} finally {
  await browser.close();
}
