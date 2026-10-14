import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const compiled = await build({stdin:{contents:"export * from './src/domain/tts/identity';",resolveDir:process.cwd()},bundle:true,write:false,format:'esm'});
const identity = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const person = (id, fields = {}) => ({id,scope:'global',name:id,surname:'',givenName:id,surnameAliases:[],givenAliases:[],triggers:[id],tags:[],gender:'unknown',voiceKey:'',fishId:'',fixed:false,gain:0,...fields});

test('TTS surname and given-name merging ignores letter case, including aliases', () => {
  const alice = person('alice',{name:'Alice Kim',surname:'Kim',givenName:'Alice',surnameAliases:['Gim'],givenAliases:['Alicia']});
  for (const fields of [{name:'ALICE KIM',surname:'KIM',givenName:'ALICE'},{name:'alicia gim',surname:'gim',givenName:'alicia'}]) {
    const draft = person('new',fields);
    assert.equal(identity.sameTtsPerson(alice,draft),true);
    assert.equal(identity.mergeTtsCharacter([alice],draft).length,1);
  }
  assert.equal(identity.sameTtsPerson(alice,person('different',{surname:'Lee',givenName:'ALICE'})),false);
});

test('updates and duplicate merges retain the surviving character tile position', () => {
  const rows = [person('first'),person('middle'),person('last')];
  const updated = identity.mergeTtsCharacter(rows,{...rows[0],tags:['edited']});
  assert.deepEqual(updated.map(c=>c.id),['first','middle','last']);
  assert.deepEqual(updated[0].tags,['edited']);
  const duplicate = identity.mergeTtsCharacter(rows,person('new',{name:'MIDDLE',givenName:'MIDDLE'}));
  assert.deepEqual(duplicate.map(c=>c.id),['first','middle','last']);
  const consolidated = identity.mergeTtsCharacter([...rows,person('duplicate',{givenName:'first'})],{...rows[0],gain:2});
  assert.deepEqual(consolidated.map(c=>c.id),['first','middle','last']);
  assert.deepEqual(identity.mergeTtsCharacter(rows,person('new')).map(c=>c.id),['first','middle','last','new']);
});

const uiBuild = await build({stdin:{contents:"import {TtsCharacters} from './src/tts-ui/characters';import {ttsData,loadTtsData} from './src/storage/tts-store';import layout from './src/tts-ui/layout.json';Object.assign(window,{TtsCharacters,ttsData,loadTtsData,layout});",resolveDir:process.cwd()},bundle:true,write:false,format:'iife',plugins:[{name:'character-preview-fixture',setup(build){build.onResolve({filter:/char-ref-module$/},args=>args.importer.endsWith('/tts-ui/characters.ts')||args.importer.endsWith('\\tts-ui\\characters.ts')?{path:'character-preview-fixture',namespace:'test'}:undefined);build.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export async function getCharRefAssetPreviewUrl(hash){return window.fixture.preview(hash);}',loader:'js'}));}}]});

async function pageFixture(browser) {
  const page = await browser.newPage();
  await page.route('https://tts-character.test/',route=>route.fulfill({contentType:'text/html',body:'<body></body>'}));
  await page.goto('https://tts-character.test/');
  await page.evaluate(()=>{
    window.risuai={pluginStorage:{getItem:async()=>null,setItem:async()=>{}},getLocalPluginStorage:async()=>({getItem:async()=>null,setItem:async()=>{}})};
    window.fixture={requests:[],preview:async hash=>{fixture.requests.push(hash);return 'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"><rect fill="purple" width="100%" height="100%"/></svg>');}};
  });
  await page.addScriptTag({content:uiBuild.outputFiles[0].text});
  await page.evaluate(async()=>{
    await loadTtsData();ttsData().settings.enabled=true;
    document.body.innerHTML=layout.html+layout.dialogs;
    document.getElementById('tts-controls').disabled=false;
    for(const panel of document.querySelectorAll('section.panel'))panel.hidden=panel.id!=='tts-characters';
    const style=document.createElement('style');style.textContent=layout.css+'#character-list{display:flex;width:600px;height:220px;padding:8px;gap:12px;box-sizing:border-box}#tts-settings-root #character-list .char-card{position:relative;flex:none;width:180px;height:180px}';document.head.append(style);
    window.characters=new TtsCharacters({},()=>{});await characters.bind();
  });
  return page;
}

test('character selection and autosave preserve loaded image elements without repeated preview reads',async()=>{
  const browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
  try {
    const page=await pageFixture(browser);
    await page.evaluate(rows=>{
      ttsData().characters=rows;
      characters.references=rows.map(c=>({id:c.id,name:c.name,surname:'',given_name:c.givenName,surname_variants:[],given_name_variants:[],aliases:[],ref_hash:c.id}));
      characters.render();
    },[person('first'),person('second')]);
    await page.waitForFunction(()=>fixture.requests.length===2);
    await page.evaluate(()=>{window.beforeTiles=[...document.querySelectorAll('#character-list .char-card')];window.beforeImages=beforeTiles.map(n=>n.style.backgroundImage);window.beforeButtons=beforeTiles.map(n=>n.querySelector('.tile-audition'));});
    await page.locator('#character-list .char-card').first().click();
    assert.equal(await page.evaluate(()=>beforeTiles.every((n,i)=>n===document.querySelectorAll('#character-list .char-card')[i])),true,'selecting must retain loaded tiles');
    await page.locator('#character-list .char-card').first().click();
    await page.locator('#c-tags').fill('changed');
    await page.locator('#character-done').click();
    assert.deepEqual(await page.evaluate(()=>ttsData().characters.map(c=>c.id)),['first','second']);
    assert.equal(await page.evaluate(()=>beforeTiles.every((n,i)=>n===document.querySelectorAll('#character-list .char-card')[i]&&n.style.backgroundImage===beforeImages[i]&&n.querySelector('.tile-audition')===beforeButtons[i])),true,'autosave must retain tiles, backgrounds, and listening buttons');
    assert.equal(await page.evaluate(()=>fixture.requests.length),2,'unchanged references are not loaded again');
    await page.close();
  } finally {await browser.close();}
});

test('character voice labels resolve actual Fish IDs and missing images use gender SVGs',async()=>{
  const browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
  try {
    const page=await pageFixture(browser),id='56e72b73664c4f2da594b5344ab1b71b';
    await page.evaluate(({rows,id})=>{
      ttsData().voices=[{key:'actual',name:'실제 음성',fishId:id,tags:[],gender:'female',folder:''},{key:'stale',name:'다른 음성',fishId:'a'.repeat(32),tags:[],gender:'male',folder:''}];
      ttsData().characters=rows;characters.render();
    },{id,rows:[person('female',{gender:'female',fishId:id}),person('male',{gender:'male',fishId:id.toUpperCase(),voiceKey:'stale'}),person('other')]});
    assert.deepEqual(await page.locator('.char-voice-label').allTextContents(),['실제 음성','실제 음성','음성 미지정']);
    const backgrounds=await page.locator('#character-list .char-card').evaluateAll(nodes=>nodes.map(n=>n.style.backgroundImage));
    assert.ok(backgrounds.every(value=>value.includes('data:image/svg+xml')),'all missing images have SVG placeholders');
    assert.equal(new Set(backgrounds).size,3,'female, male, and unknown placeholders are distinct');
    await page.locator('#character-list').screenshot({path:'.tts-character-regression.png'});
    await page.evaluate(()=>characters.edit(ttsData().characters[1]));
    assert.equal(await page.locator('#character-voice-choice').textContent(),'실제 음성');
    await page.locator('#character-done').click();
    assert.equal(await page.evaluate(()=>ttsData().characters[1].voiceKey),'actual');
    await page.evaluate(()=>characters.edit(ttsData().characters[2]));
    await page.locator('#c-id').fill(id);
    assert.equal(await page.locator('#character-voice-choice').textContent(),'실제 음성','pasting an existing model ID updates the choice immediately');
    await page.close();
  } finally {await browser.close();}
});
