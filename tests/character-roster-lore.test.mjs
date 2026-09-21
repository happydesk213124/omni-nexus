import {test,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const bundle=await build({stdin:{contents:`export * from './src/storage/character-roster';export {sessionIdHash} from './src/core/util/text';`,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'esm',platform:'node'});
const api=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
let chars,old,discard;
beforeEach(()=>{
 chars=['bot-a','bot-b'].map(chaId=>({chaId,globalLore:[{comment:'unrelated',content:'keep'}],chats:[{id:'one'},{id:'two'}]}));
 old=new Map([['onx_old_roster',{name:'legacy'}]]);discard=false;
 globalThis.risuai={getDatabase:async()=>({characters:structuredClone(chars)}),getCharacterFromIndex:async i=>structuredClone(chars[i]),setCharacterToIndex:async(i,c)=>{if(!discard)chars[i]=structuredClone(c);},pluginStorage:{getItem:async k=>old.get(k),setItem:async()=>assert.fail('must not write plugin storage')}};
});
const scope=(chat)=>'risu_'+api.sessionIdHash('bot-a|'+chat);
const row={id:'alice',name:'Alice',appearance:'blue eyes',attire:'shirt',costumes:[{name:'default',attire:'shirt'}]};
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
