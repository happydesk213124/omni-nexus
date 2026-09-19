import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const bundle=await build({stdin:{contents:`export * from './src/services/chat-bake'; export * from './src/domain/chat-bake'; export {setConfig} from './src/services/context';export {idbPut,resetStores} from './src/storage/stores';`,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'esm',platform:'node'});
const api=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const target={charIndex:0,chatIndex:0,messageIndex:0,jobId:'job-a'};
test('deleting a completed image also removes its reserved frame but keeps other slots',()=>{
 const frame=api.spinnerToken('job-a',0),other=api.spinnerToken('job-a',1);
 assert.equal(api.stripBakeTokenForCard('text'+frame+'[[@inray::ready::inxshot_ready.webp]]'+other,'ready'),'text'+other);
});
for(const side of ['before','after']) test('persist spinner at '+side+' of line and retain overflow shot order',async()=>{
 let chat={id:'chat',message:[{data:'first\nsecond'}]};let db={modules:[],enabledModules:[]};
 globalThis.risuai={getChatFromIndex:async()=>structuredClone(chat),setChatToIndex:async(_i,_j,c)=>{chat=structuredClone(c);},getDatabase:async()=>structuredClone(db),setDatabase:async next=>{db={...db,...next};}};
 api.setConfig({card:{inline_chat_text_side:side}});
 assert.equal(await api.writeJobSpinners({...target,shots:[{line:999,shot_index:0,width:512,height:768},{line:1000,shot_index:1,width:768,height:512}]}),true);
 const text=chat.message[0].data,t0=api.spinnerToken('job-a',0,512,768),t1=api.spinnerToken('job-a',1,768,512);
 assert.ok(text.indexOf(t0)<text.indexOf(t1));assert.equal(text.indexOf(t0)<text.indexOf('second'),side==='before');
 const ready=api.replaceSpinner(text,'job-a',0,'[[@inray::card::inxshot_card.webp]]');
 assert.equal(ready.indexOf('[[@inray::'),text.indexOf(t0));assert.ok(ready.includes(t1));
 assert.ok(api.removeJobSpinners(ready,'job-a').includes('[[@inray::card'));
 assert.equal(api.proseForHash(text),'first\nsecond');
 await api.clearJobSpinners(target);assert.doesNotMatch(chat.message[0].data,/inrayspinner/);assert.equal(chat.message[0].data,'first\nsecond');
});


test('completed shot replaces its exact slot, cancelled siblings disappear, restart keeps baked shots',async()=>{
 let chat={id:'chat-final',message:[{data:'first\nsecond'}]};let db={modules:[],enabledModules:[],characters:[{chaId:'bot',chats:[{id:'chat-final'}]}]};const kv=new Map();
 globalThis.risuai={pluginStorage:{getItem:async k=>kv.get(k),setItem:async(k,v)=>kv.set(k,v),removeItem:async k=>kv.delete(k)},getChatFromIndex:async()=>structuredClone(chat),setChatToIndex:async(_i,_j,c)=>{chat=structuredClone(c);},getDatabase:async()=>structuredClone(db),setDatabase:async next=>{db={...db,...next};}};
 api.resetStores();api.setConfig({card:{inline_chat_text_side:'after'}});
 await api.writeJobSpinners({...target,shots:[{line:1,shot_index:0},{line:2,shot_index:1}]});
 const before=chat.message[0].data,position=before.indexOf('[[@inrayspinner');
 await api.idbPut('images',{id:'ready',location:{asset_path:'assets/ready.webp',asset_name:'inxshot_ready.webp'}},{persist:false});
 assert.equal(await api.finishJobSpinner({...target,shot:0,cardId:'ready'}),true);
 assert.equal(chat.message[0].data.indexOf('[[@inray::ready'),position+api.spinnerToken('job-a',0).length);
 assert.ok(chat.message[0].data.includes(api.spinnerToken('job-a',0)),'completed slot retains its permanent frame');
 const partial=chat.message[0].data;
 await assert.rejects(()=>api.finishJobSpinner({...target,shot:1,cardId:'missing'}),/asset missing/);
 assert.equal(chat.message[0].data,partial,'failed asset must not replace its spinner or the previous shot');
 await api.clearAbandonedSpinners();
 assert.ok(chat.message[0].data.includes('[[@inray::ready::inxshot_ready.webp::1024::1024]]'));
 assert.ok(chat.message[0].data.includes(api.spinnerToken('job-a',0)),'completed pair survives restart');
 assert.ok(!chat.message[0].data.includes(api.spinnerToken('job-a',1)),'only failed slots are removed');
});

test('completed shots replace all durable slots in one chat write',async()=>{
 let writes=0;let chat={id:'chat-batch',message:[{data:'first\nsecond'}]};let db={modules:[],enabledModules:[],characters:[{chaId:'bot',chats:[{id:'chat-batch'}]}]};const kv=new Map();
 globalThis.risuai={pluginStorage:{getItem:async k=>kv.get(k),setItem:async(k,v)=>kv.set(k,v),removeItem:async k=>kv.delete(k)},getChatFromIndex:async()=>structuredClone(chat),setChatToIndex:async(_i,_j,c)=>{writes++;chat=structuredClone(c);},getDatabase:async()=>structuredClone(db),setDatabase:async next=>{db={...db,...next};}};
 api.resetStores();api.setConfig({card:{inline_chat_text_side:'after'}});
 await api.writeJobSpinners({...target,shots:[{line:1,shot_index:0,width:512,height:768},{line:2,shot_index:1,width:768,height:512}]});
 await api.idbPut('cards',{id:'ready-a',meta_json:JSON.stringify({width:512,height:768})},{persist:false});
 await api.idbPut('images',{id:'ready-a',location:{asset_path:'assets/a.webp',asset_name:'inxshot_ready-a.webp'}},{persist:false});
 await api.idbPut('images',{id:'ready-b',location:{asset_path:'assets/b.webp',asset_name:'inxshot_ready-b.webp'}},{persist:false});
 const beforeFinish=writes;
 assert.equal(await api.finishJobSpinners({...target,cards:[{shot:0,cardId:'ready-a'},{shot:1,cardId:'ready-b'}]}),true);
 assert.equal(writes,beforeFinish+1);
 assert.equal((chat.message[0].data.match(/inrayspinner/g)||[]).length,2);
 assert.match(chat.message[0].data,/inray::ready-a/);
 assert.match(chat.message[0].data,/inray::ready-b/);
 assert.match(chat.message[0].data,/inxshot_ready-a.webp::512::768/);
 assert.match(chat.message[0].data,/inxshot_ready-b.webp::768::512/);
});

test('four shots publish individually and successful cleanup never rewrites the message',async()=>{
 let writes=0;let chat={id:'four',message:[{data:'first\nsecond'}]};let db={modules:[],enabledModules:[]};const kv=new Map();
 globalThis.risuai={pluginStorage:{getItem:async k=>kv.get(k),setItem:async(k,v)=>kv.set(k,v),removeItem:async k=>kv.delete(k)},getChatFromIndex:async()=>structuredClone(chat),setChatToIndex:async(_i,_j,c)=>{writes++;chat=structuredClone(c);},getDatabase:async()=>structuredClone(db),setDatabase:async next=>{db={...db,...next};}};
 api.resetStores();api.setConfig({card:{inline_chat_text_side:'after'}});
 await api.writeJobSpinners({...target,shots:[0,1,2,3].map(shot_index=>({line:2,shot_index}))});
 for(const shot of [2,0,3,1]) {
   const id='shot-'+shot;
   await api.idbPut('images',{id,location:{asset_path:'assets/'+id+'.webp',asset_name:'inxshot_'+id+'.webp'}},{persist:false});
   const before=writes;
   assert.equal(await api.finishJobSpinner({...target,shot,cardId:id}),true);
   assert.equal(writes,before+1);
   assert.ok(chat.message[0].data.includes(api.bakeTokenForCard(id,'inxshot_'+id+'.webp',{width:1024,height:1024})));
   assert.ok(chat.message[0].data.includes(api.spinnerToken(target.jobId,shot)));
   assert.equal(api.proseForHash(chat.message[0].data),'first\nsecond');
 }
 const complete=chat.message[0].data,before=writes;
 await api.clearJobSpinners(target);
 assert.equal(writes,before,'no final clear/replace jump for successful slots');assert.equal(chat.message[0].data,complete);
 assert.equal(await api.finishJobSpinner({...target,shot:0,cardId:'shot-0'}),false,'duplicate completion does not duplicate the asset');
 assert.equal(db.modules[0].regex[0].comment,'omni-framed-asset-display','pair rule must run before either standalone token');
});

test('reroll follows stable bot/chat and baked token after indices move; second reroll uses new id',async()=>{
 let chat={id:'moved',message:[{data:'inserted message'},{data:'text [[@inray::old::inxshot_old.webp]]'}]};
 let db={modules:[],enabledModules:[],characters:[{chaId:'unrelated',chats:[]},{chaId:'owner',chats:[{id:'other'},{id:'moved'}]}]};
 const kv=new Map();let writes=0;
 globalThis.risuai={pluginStorage:{getItem:async k=>kv.get(k),setItem:async(k,v)=>kv.set(k,v),removeItem:async k=>kv.delete(k)},getChatFromIndex:async(ci,ti)=>{assert.equal(ci,1);assert.equal(ti,1);return structuredClone(chat);},setChatToIndex:async(ci,ti,c)=>{assert.equal(ci,1);assert.equal(ti,1);writes++;chat=structuredClone(c);},getDatabase:async()=>structuredClone(db),setDatabase:async next=>{db={...db,...next};}};
 api.resetStores();api.setConfig({card:{}});
 for(const id of ['next','again'])await api.idbPut('images',{id,location:{asset_path:'assets/'+id+'.webp',asset_name:'inxshot_'+id+'.webp'}},{persist:false});
 const where={charIndex:0,chatIndex:0,messageIndex:0,characterId:'owner',chatId:'moved'};
 assert.equal(await api.rewriteBakedCardInChatMessage({...where,prevCardId:'old',nextCardId:'next'}),true);
 assert.equal(await api.rewriteBakedCardInChatMessage({...where,prevCardId:'next',nextCardId:'again'}),true);
 assert.equal(writes,2);assert.match(chat.message[1].data,/inray::again/);assert.equal(chat.message[0].data,'inserted message');
 const before=chat.message[1].data;
 await assert.rejects(()=>api.rewriteBakedCardInChatMessage({...where,prevCardId:'again',nextCardId:'missing'}),/에셋/);
 assert.equal(chat.message[1].data,before);
});
