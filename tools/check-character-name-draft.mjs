import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

let full = await readFile('dist/omninexus.js','utf8');
assert.equal(full.split('  await Qa();').length,2);
if(process.argv.includes('--break-identity')) full=full.replace('if (!event.detail?.omniIdentityCommit &&','if (false &&');
const browser = await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
try {
  const page = await browser.newPage(), errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto('about:blank');
  await page.evaluate(()=>{
    const kv=new Map();
    let bot={chaId:'draft-bot',name:'Draft bot',globalLore:[],chats:[{id:'draft-chat',message:[]}]};
    let modules=[];
    globalThis.risuai={pluginStorage:{getItem:async key=>kv.get(key),setItem:async(key,value)=>kv.set(key,value)},
      getArgument:async()=>'',getDatabase:async()=>({characters:[structuredClone(bot)],modules:structuredClone(modules),enabledModules:[]}),
      setDatabase:async value=>{if(value.modules)modules=structuredClone(value.modules);},
      getCharacterFromIndex:async()=>structuredClone(bot),setCharacterToIndex:async(_i,value)=>{bot=structuredClone(value);},
      getCurrentCharacterIndex:async()=>0,getCurrentChatIndex:async()=>0,getChatFromIndex:async()=>structuredClone(bot.chats[0])};
  });
  await page.addScriptTag({type:'module',content:full.replace('  await Qa();',`
    await le(); await ia(); t.lastScope=await Z(); t.uiOpen=true; t.uiTab='characters';
    const scope=t.lastScope;
    const initial=await globalThis.__INLAY_NATIVE__.fetch('/v1/characters',{method:'POST',body:{session_id:scope.sessionId,character_id:scope.characterId,characters:[
      {id:'lee',name:'이한',surname:'이',given_name:'한',aliases:['한'],appearance:'boy, pale skin',hair_color:'black hair',hair_style:'short hair',attire:'shirt'},
      {id:'kim',name:'김한영',surname:'김',given_name:'',aliases:['한영'],appearance:'boy, dark skin',hair_color:'red hair',hair_style:'long hair',attire:'coat'}
    ]}});
    t.charactersSession=initial.characters;t.charactersGlobal=initial.global;
    const actualK=K;
    globalThis.nameDraftTest={t,posts:0};
    K=async(url,options,...rest)=>{
      if(url.includes('/v1/characters/lorefilter'))return {ok:true,initialized:true,selected:[],catalog:[]};
      if(url==='/v1/characters' && options?.method==='POST')nameDraftTest.posts++;
      return actualK(url,options,...rest);
    };
    await P();
  `)});
  await page.waitForFunction(()=>globalThis.nameDraftTest && document.querySelectorAll('.char-card[data-char-id]').length===2);
  assert.equal(await page.evaluate(()=>__INLAY_SETTINGS_UX__.openCharacterEditor({id:'kim',scope:'session'})),true);
  const input=page.locator('#nx-char-edit-body [data-char-given]');
  const snapshot=()=>page.evaluate(async()=>__INLAY_NATIVE__.fetch('/v1/characters?session_id='+encodeURIComponent(nameDraftTest.t.lastScope.sessionId),{method:'GET'}));
  await input.fill('한');
  await page.waitForTimeout(1400);
  await page.evaluate(()=>__OMNI_FLUSH_CHARACTERS__());
  assert.equal(await page.evaluate(()=>nameDraftTest.posts),0,'partial 한 must never submit a merge');
  assert.equal((await snapshot()).characters.length,2);
  await input.fill('한영');
  await input.press('Tab');
  await page.waitForFunction(()=>nameDraftTest.posts>0);
  await page.evaluate(()=>__OMNI_FLUSH_CHARACTERS__());
  const completed=(await snapshot()).characters;
  assert.equal(completed.length,2);
  assert.equal(completed.find(row=>row.id==='kim').given_name,'한영');
  const original=completed.find(row=>row.id==='lee');
  const posts=await page.evaluate(()=>nameDraftTest.posts);
  await input.fill('한');
  await page.waitForTimeout(1400);
  assert.equal(await page.evaluate(()=>nameDraftTest.posts),posts,'a second partial matching name is still a draft');
  await input.press('Tab');
  await page.evaluate(()=>__OMNI_FLUSH_CHARACTERS__());
  const merged=(await snapshot()).characters;
  assert.equal(merged.length,1,'a completed, exact matching name consolidates only on change');
  assert.equal(merged[0].id,'lee');
  assert.equal(merged[0].name,original.name);
  assert.deepEqual(merged[0].aliases,original.aliases);
  assert.equal(merged[0].appearance,original.appearance);
  assert.ok(merged[0].costumes.some(costume=>costume.note.startsWith('김한영 · ') && costume.hair_color==='red hair'));
  await page.waitForFunction(()=>document.querySelectorAll('.char-card[data-char-id]').length===1);
  assert.deepEqual(errors,[]);
  console.log('[character name draft] PASS: typing, blur, exact matching and costume preservation through the built UI');
} finally {await browser.close();}
