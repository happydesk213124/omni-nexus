import {test,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const bundle=await build({stdin:{contents:`export * from './src/storage/character-roster';export {sessionIdHash,unifiedSessionIdForCharacter} from './src/core/util/text';export {ensureCastIds,resolveCastNames,resolveCastCharacters} from './src/services/cast-ids';export {seedCastId} from './src/domain/gallery/cast-ids';`,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'esm',platform:'node'});
const api=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
let chars,old,discard;
beforeEach(()=>{
 chars=['bot-a','bot-b'].map(chaId=>({chaId,globalLore:[{comment:'unrelated',content:'keep'}],chats:[{id:'one'},{id:'two'}]}));
 old=new Map([['onx_old_roster',{name:'legacy'}]]);discard=false;
 globalThis.risuai={getCurrentCharacterIndex:async()=>0,getDatabase:async()=>({characters:structuredClone(chars)}),getCharacterFromIndex:async i=>structuredClone(chars[i]),setCharacterToIndex:async(i,c)=>{if(!discard)chars[i]=structuredClone(c);},pluginStorage:{getItem:async k=>old.get(k),setItem:async()=>assert.fail('must not write plugin storage')}};
});
const scope=(chat)=>'risu_'+api.sessionIdHash('bot-a|'+chat);
const row={id:'alice',name:'Alice',appearance:'blue eyes',attire:'shirt',costumes:[{name:'default',attire:'shirt'}]};

test('copied bot owns its lore despite the old ID; both save paths rebind without losing data',async()=>{
 await api.mutateCharacterRoster('bot-a',()=>[row]);
 await api.writeCharacterEntryKey('bot-a','lorefilter',['t:Alice']);
 chars[1].globalLore=structuredClone(chars[0].globalLore);
 const original=JSON.stringify(chars[0]);
 const copied=JSON.stringify(chars[1]);
 assert.equal((await api.readCharacterRoster('bot-b'))[0].name,'Alice');
 assert.deepEqual(await api.readCharacterEntryKey('bot-b','lorefilter'),['t:Alice']);
 assert.equal(JSON.stringify(chars[1]),copied,'reads must not rewrite lore');
 await api.mutateCharacterRoster('bot-b',rows=>rows.map(r=>({...r,name:'Copy'})));
 let saved=JSON.parse(chars[1].globalLore[1].content);
 assert.equal(saved.characterId,'bot-b');assert.deepEqual(saved.lorefilter,['t:Alice']);
 saved.characterId='old-import-id';chars[1].globalLore[1].content=JSON.stringify(saved);
 await api.writeCharacterEntryKey('bot-b','lorefilter',[]);
 saved=JSON.parse(chars[1].globalLore[1].content);
 assert.equal(saved.characterId,'bot-b');assert.equal(saved.roster[0].name,'Copy');
 assert.deepEqual(saved.lorefilter,[]);assert.equal(JSON.stringify(chars[0]),original);
});

test('optional partial scans isolate each bad bot and shared roster without weakening direct reads',async()=>{
 await api.mutateCharacterRoster('bot-b',()=>[row]);
 chars[0].globalLore.push({comment:'omni.nexus.data.global',content:'broken'});
 const before=JSON.stringify(chars),errors=[];
 assert.equal((await api.allCharacterRosters((scope,error)=>errors.push({scope,error}))).length,1);
 assert.equal(errors.length,1);assert.equal(errors[0].scope,api.unifiedSessionIdForCharacter('bot-a'));
 assert.match(errors[0].error.message,/bot-a/);
 await assert.rejects(api.allCharacterRosters());
 await assert.rejects(api.mutateCharacterRoster('bot-a',()=>[]));
 const get=globalThis.risuai.getDatabase;
 globalThis.risuai.getDatabase=async()=>({...await get(),modules:[{id:'inlay-inray-display',lorebook:[{comment:'omni.nexus.data.globalcharacter',content:'broken'}]}]});
 errors.length=0;
 assert.equal((await api.allCharacterRosters((scope,error)=>errors.push({scope,error}))).length,1);
 assert.equal(errors.length,2);assert.equal(errors[0].scope,'__global__');
 assert.equal(JSON.stringify(chars),before);
});

test('existing cast IDs never read other bots; new IDs and viewer lookup survive a bad bot',async()=>{
 await api.mutateCharacterRoster('bot-a',()=>[{...row,cast_id:'abcd'},{...row,id:'bob',name:'Bob',cast_id:''}]);
 chars[1].globalLore.push({comment:'omni.nexus.data.global',content:'broken'});
 const before=JSON.stringify(chars[1]);
 const get=globalThis.risuai.getCharacterFromIndex;let otherReads=0;
 globalThis.risuai.getCharacterFromIndex=async i=>{if(i===1)otherReads++;return get(i);};
 assert.deepEqual(await api.ensureCastIds('bot-a',[{id:'alice'}]),{alice:'abcd'});
 assert.equal(otherReads,0);
 const issued=await api.ensureCastIds('bot-a',[{id:'bob'}]);
 assert.match(issued.bob,/^[0-9a-f]{4}$/);
 assert.equal((await api.readCharacterRoster('bot-a')).find(r=>r.id==='bob').cast_id,issued.bob);
 assert.deepEqual(await api.resolveCastNames(['abcd',issued.bob]),{abcd:'Alice',[issued.bob]:'Bob'});
 assert.equal((await api.resolveCastCharacters(['abcd'])).characters[0].id,'alice');
 assert.ok(otherReads>0);assert.equal(JSON.stringify(chars[1]),before);
});

test('new cast IDs still avoid healthy-bot collisions and duplicate requests reuse the issued ID',async()=>{
 await api.mutateCharacterRoster('bot-a',()=>[row]);
 const taken=api.seedCastId('Alice||');
 await api.mutateCharacterRoster('bot-b',()=>[{...row,id:'other',name:'Other',cast_id:taken}]);
 const random=Math.random;Math.random=()=>taken==='0000'?0.5:0;
 try {
  const issued=await api.ensureCastIds('bot-a',[{id:'alice'},{id:'alice'}]);
  assert.notEqual(issued.alice,taken);
  assert.equal(issued.alice,taken==='0000'?'8888':'0000');
  assert.equal((await api.readCharacterRoster('bot-a'))[0].cast_id,issued.alice);
  assert.equal((await api.readCharacterRoster('bot-b'))[0].cast_id,taken);
 } finally {Math.random=random;}
});

test('viewer cast lookup reads only the current bot and shared roster, including after a switch',async()=>{
 await api.mutateCharacterRoster('bot-a',()=>[{...row,cast_id:'aaaa'}]);
 await api.mutateCharacterRoster('bot-b',()=>[{...row,id:'other',name:'Other',cast_id:'bbbb'}]);
 const shared={id:'inlay-inray-display',lorebook:[{comment:'omni.nexus.data.globalcharacter',key:'',alwaysActive:false,content:JSON.stringify({version:1,roster:[{...row,id:'shared',name:'Shared',cast_id:'cccc'}]})}]};
 let current=0;const reads=[];
 globalThis.risuai.getCurrentCharacterIndex=async()=>current;
 globalThis.risuai.getDatabase=async keys=>{
   assert.deepEqual(keys,['modules'],'viewer must not request the directory of every bot');
   return {modules:[structuredClone(shared)]};
 };
 globalThis.risuai.getCharacterFromIndex=async i=>{
   assert.equal(i,current,'viewer must never fetch another bot');reads.push(i);return structuredClone(chars[i]);
 };
 assert.deepEqual(await api.resolveCastNames(['aaaa','bbbb','cccc']),{aaaa:'Alice',cccc:'Shared'});
 const details=await api.resolveCastCharacters(['aaaa','bbbb','cccc']);
 assert.deepEqual(details.characters.map(r=>r.id),['shared','alice']);
 assert.deepEqual(reads,[0,0],'one current-bot snapshot per lookup');
 current=1;
 assert.deepEqual(await api.resolveCastNames(['aaaa','bbbb','cccc']),{bbbb:'Other',cccc:'Shared'});
 assert.deepEqual(reads,[0,0,1]);
});

test('invalid lore reports the affected bot and exact failed setting',async()=>{
 await api.mutateCharacterRoster('bot-a',()=>[row]);
 chars[0].name='문제 봇';chars[0].globalLore[1].alwaysActive=true;
 await assert.rejects(api.readCharacterRoster('bot-a'),/문제 봇.*항상 활성화/);
});
test('one bot roster is shared by its chats and isolated from another bot without legacy fallback',async()=>{
 assert.deepEqual(await api.readCharacterRoster(scope('one')),[]);
 await api.mutateCharacterRoster(scope('one'),()=>[row]);
 assert.equal((await api.readCharacterRoster(scope('two')))[0].name,'Alice');
 assert.deepEqual(await api.readCharacterRoster('bot-b'),[]);
 assert.deepEqual(old.get('onx_old_roster'),{name:'legacy'});
 const entry=chars[0].globalLore[1];assert.equal(entry.comment,'omni.nexus.data.global');assert.equal(entry.key,'');assert.equal(entry.alwaysActive,false);assert.equal(entry.mode,'normal');
 assert.deepEqual(chars[0].globalLore[0],{comment:'unrelated',content:'keep'});
});

test('roster edits preserve the bot lorefilter, including an intentionally empty selection',async()=>{
 for(const selected of [['t:alice'],[]]) {
  await api.writeCharacterEntryKey('bot-a','lorefilter',selected);
  await api.mutateCharacterRoster('bot-a',()=>[row]);
  assert.deepEqual(await api.readCharacterEntryKey('bot-a','lorefilter'),selected);
 }
});

test('costume appearance and inheritance survive lore serialization without secret fields', async () => {
 const costume={name:'magic',note:'transformed',appearance:'[base]',hair_color:'pink hair',hair_style:'long hair',eye_color:'blue eyes',height:'[base]',age:'',penis_size:'',attire:'bodice',bottoms:'skirt',accessories:'wand'};
 await api.mutateCharacterRoster('bot-a',()=>[{...row,costumes:[row.costumes[0],{...costume,api_key:'do-not-store'}]}]);
 const loaded=await api.readCharacterRoster(scope('two'));
 assert.deepEqual(loaded[0].costumes[1],costume);
});
test('serialization retains both concurrent edits and omits scene wear, secret fields and preview bytes',async()=>{
 await api.mutateCharacterRoster('bot-a',()=>[{...row,wear_state:'nude',api_key:'secret',ref_preview_url:'data:image/png;base64,pixels'}]);
 await Promise.all([api.mutateCharacterRoster('bot-a',rows=>[...rows,{...row,id:'bob',name:'Bob'}]),api.mutateCharacterRoster('bot-a',rows=>rows.map(r=>r.id==='alice'?{...r,name:'Alicia'}:r))]);
 const saved=await api.readCharacterRoster('bot-a');assert.deepEqual(saved.map(r=>r.name),['Alicia','Bob']);
 assert.doesNotMatch(chars[0].globalLore[1].content,/nude|secret|data:image|api_key|ref_preview/);
 await api.mutateCharacterRoster('bot-a',rows=>rows.filter(r=>r.id!=='alice'));
 assert.equal((await api.readCharacterRoster('bot-a')).length,1);
});
test('corrupt, duplicate, activated and discarded saves fail without replacing lore',async()=>{
 await api.mutateCharacterRoster('bot-a',()=>[row]);
 const valid=structuredClone(chars[0].globalLore);
 for(const damage of [l=>l.push(structuredClone(l[1])),l=>l[1].content='{',l=>l[1].alwaysActive=true]){
  chars[0].globalLore=structuredClone(valid);damage(chars[0].globalLore);const before=JSON.stringify(chars[0]);
  await assert.rejects(()=>api.mutateCharacterRoster('bot-a',()=>[]));assert.equal(JSON.stringify(chars[0]),before);
 }
 chars[0].globalLore=valid;discard=true;await assert.rejects(()=>api.mutateCharacterRoster('bot-a',()=>[]),/verification failed/);
});

test('shared roster lives in display module and rejects a lost write',async()=> {
 let modules=[{id:'inlay-inray-display',namespace:'inlay.inray_display',regex:[{comment:'keep'}],lorebook:[]}];
 const get=globalThis.risuai.getDatabase;
 globalThis.risuai.getDatabase=async()=>({...await get(),modules:structuredClone(modules)});
 globalThis.risuai.setDatabase=async db=>{if(!discard)modules=structuredClone(db.modules);};
 await api.mutateCharacterRoster('__global__',()=>[row]);
 assert.equal((await api.readCharacterRoster('__global__'))[0].name,'Alice');
 assert.deepEqual(await api.readCharacterRoster('bot-a'),[]);
 const e=modules[0].lorebook[0];assert.equal(e.comment,'omni.nexus.data.globalcharacter');assert.equal(e.key,'');assert.equal(e.alwaysActive,false);
 assert.equal(modules[0].regex[0].comment,'keep');
 discard=true;await assert.rejects(()=>api.mutateCharacterRoster('__global__',()=>[]),/verification/);
 discard=false;modules[0].lorebook.push(structuredClone(e));
 await assert.rejects(()=>api.mutateCharacterRoster('__global__',()=>[]),/Duplicate/);
});


test('empty disabled roster placeholders initialize without erasing nonempty corrupt content',async()=>{
  const entry={comment:'omni.nexus.data.global',key:'',alwaysActive:false,mode:'normal',content:'  '};
  chars[0].globalLore.push(entry);
  assert.deepEqual(await api.readCharacterRoster('bot-a'),[]);
  await api.mutateCharacterRoster('bot-a',()=>[row]);
  assert.equal((await api.readCharacterRoster('bot-a'))[0].name,'Alice');
  chars[0].globalLore[1].content='{"roster":[';
  const before=JSON.stringify(chars);
  await assert.rejects(api.mutateCharacterRoster('bot-a',()=>[]),/캐릭터 저장 데이터 오류.*bot-a.*omni.nexus.data.global/);
  assert.equal(JSON.stringify(chars),before);
});
