import test from 'node:test';
import assert from 'node:assert/strict';
import { installHost, PNG_NAI_1X1 } from '../tools/parity/host.mjs';
let serial=0;
async function fixture() {
  installHost({promptsDir:'prompts'});
  const api=await import('../.test-build/history-services.mjs?instance='+ ++serial);
  await api.openDb();
  const config=api.getConfig();
  Object.assign(config.card,{active_preset_id:'p',presets:[{id:'p',name:'P',positive:'style, @ch1@'}],nai5_only:false,nai5_first:false});
  config.nai={...config.nai,api_key:'test',backend:'comfy',comfy_url:'http://test-comfy:8188',comfy_workflow_json:JSON.stringify({1:{class_type:'CLIPTextEncode',inputs:{text:'[[pos]]'}},2:{class_type:'CLIPTextEncode',inputs:{text:'[[neg]]'}},3:{class_type:'CLIPTextEncode',inputs:{text:'[[char1]]'}},4:{class_type:'CLIPTextEncode',inputs:{text:'[[char2]]'}}})};
  api.setConfig(config);
  const requests=[];
  const nativeFetch=risuai.nativeFetch;
  risuai.nativeFetch=async(url,options)=>{
    if(String(url).startsWith('http://test-comfy:8188')) {
      if(String(url).endsWith('/prompt')) {requests.push(JSON.parse(options.body).prompt);return new Response(JSON.stringify({prompt_id:'test'}));}
      if(String(url).includes('/history/'))return new Response(JSON.stringify({test:{status:{completed:true},outputs:{1:{images:[{filename:'result.png',type:'output'}]}}}}));
      if(String(url).includes('/view?'))return new Response(PNG_NAI_1X1);
    }
    return nativeFetch(url,options);
  };
  let chat={id:'chat',message:[{role:'char',chatId:'message',data:'text [ [ ] ]'}]};
  await risuai.setCharacterToIndex(0,{chaId:'owner',name:'Owner',chats:[chat]});
  const location={session_id:'session',character_id:'owner',character_name:'Owner',chat_id:'chat',char_index:0,chat_index:0,message_index:0,shot_index:0};
  const recipe={prompt:'style, @ch1@, scene',negative_prompt:'bad anatomy',characters:[{name:'A',prompt:'girl, red hair, -2::blonde hair::',uc:'hat',center_x:0.3,center_y:0.5},{name:'B',prompt:'boy, blue hair',uc:'glasses',center_x:0.7,center_y:0.5}],width:832,height:1216,model:'nai-diffusion-4-5-full',steps:28,cfg_scale:5,cfg_rescale:0,sampler:'k_euler',scheduler:'native',seed:1,use_coords:false};
  await api.publishImage('root',PNG_NAI_1X1.buffer.slice(PNG_NAI_1X1.byteOffset,PNG_NAI_1X1.byteOffset+PNG_NAI_1X1.byteLength),location,{recipe});
  await api.idbPut('cards',{id:'root',session_id:'session',job_id:'job',shot_index:0,paragraph:0,characters_json:'[]',main_prompt:'',negative_prompt:'',seed:1,meta_json:JSON.stringify({...location,width:832,height:1216}),created_at:1});
  const asset=await api.imageAssetRef('root');
  chat.message[0].data=`text [[@inrayspinner::job_0::832::1216]][[@inray::root::${asset.name}::832::1216]]`;
  await risuai.setChatToIndex(0,0,chat);
  return {api,requests,config,recipe,chat:()=>risuai.getChatFromIndex(0,0)};
}

test('Comfy reroll and studio generation share conversion and preserve durable revision history',async()=>{
  const f=await fixture();
  const first=await f.api.rerollCard('root');
  assert.equal(first.ok,true);assert.equal(first.card.id,'root_r1');
  assert.equal(f.requests[0][1].inputs.text,'style, scene, girl, red hair');
  assert.equal(f.requests[0][2].inputs.text,'bad anatomy, hat, (blonde hair:2), glasses');
  assert.equal(f.requests[0][3].inputs.text,'');assert.equal(f.requests[0][4].inputs.text,'boy, blue hair');
  const before=(await f.chat()).message[0].data;
  assert.match(before,/root::/);assert.match(before,/1216_r1_pin\]\]$/);
  f.config.card.presets[0].positive='style, @ch2@';
  const studio=await f.api.studioGenerate('root_r1',{});
  assert.equal(studio.ok,true);assert.equal(studio.card.id,'root_s1');
  assert.equal(f.requests[1][1].inputs.text,'style, scene, boy, blue hair');
  assert.equal(f.requests[1][3].inputs.text,'girl, red hair');assert.equal(f.requests[1][4].inputs.text,'');
  assert.equal((await f.chat()).message[0].data,before,'studio generated history does not append message tokens');
  const history=await f.api.readImageHistory('root_s1');
  assert.deepEqual(history.cards.map(row=>row.id).sort(),['root','root_r1','root_s1']);
  assert.equal(history.cards.find(row=>row.id==='root_r1').asset_name,(await f.api.imageAssetRef('root')).name.replace('.webp','_r1.webp').replace('.png','_r1.png'));
  const committed=await f.api.studioCommit('root_r1',{revision_id:'root_s1',image_data_url:studio.image_data_url});
  assert.equal(committed.card.id,'root_s1');
  const selected=(await f.chat()).message[0].data;
  assert.match(selected,/root_s1::/);assert.match(selected,/root::/);
  assert.match(selected,/1216_s1_pin\]\]$/,'saving a studio revision pins the selected image');
  assert.equal((selected.match(/root_s1::/g)||[]).length,1,'saving a generated revision selects it without duplicating its history');
  assert.deepEqual((await f.api.readImageHistory('root')).cards.map(row=>row.id).sort(),['root','root_r1','root_s1']);
  const pinned=await f.api.pinImageRevision('root');
  assert.equal(pinned.ok,true);assert.match((await f.chat()).message[0].data,/1216_pin\]\]$/);
  const second=await f.api.rerollCard('root_s1');
  assert.equal(second.card.id,'root_r2');
  assert.match((await f.chat()).message[0].data,/1216_r2_pin\]\]$/,'a new reroll replaces the user pin automatically');
  assert.equal(((await f.chat()).message[0].data.match(/_pin\]\]/g)||[]).length,1,'only the current selection is pinned');
  assert.deepEqual((await f.api.readImageHistory('root')).cards.map(row=>row.id).sort(),['root','root_r1','root_r2','root_s1']);
});

test('studio filenames carry the edited roster cast and keep each history revision’s own cast',async()=>{
  const f=await fixture();
  await risuai.setDatabase({modules:[...(await risuai.getDatabase(['modules'])).modules,{id:'inlay-inray-display',namespace:'inlay.inray_display',lorebook:[]}]});
  const local=await f.api.upsertCharacter('owner',{id:'local-a',name:'동명이인',appearance:'red hair'});
  const shared=await f.api.upsertCharacter('__global__',{id:'shared-a',name:'동명이인',appearance:'blue hair'});
  const chars=(...rows)=>rows.map(row=>({id:row.id,scope:row.scope,name:row.name,prompt:row.appearance}));
  const first=await f.api.studioGenerate('root',{characters:chars(local,shared)});
  assert.equal(first.ok,true);assert.equal(first.card.id,'root_s1');
  const firstCast=await f.api.shotCastIds('root_s1');
  assert.equal(firstCast.ids.length,2,'castless original gets the current tabs’ filename cast');
  const resolved=await f.api.resolveCastCharacters(firstCast.ids);
  assert.deepEqual(resolved.characters.map(row=>row.id).sort(),[local.id,shared.id].sort(),
    'existing filename resolver can produce both character chips without new chip UI');
  assert.equal(new Set(firstCast.ids).size,2,'shared and local namesakes have distinct identities');
  const localCast=(await f.api.listCharacters('owner')).find(row=>row.id===local.id).cast_id;
  const sharedCast=(await f.api.listCharacters('__global__')).find(row=>row.id===shared.id).cast_id;
  assert.deepEqual(firstCast.ids,[localCast,sharedCast]);
  const second=await f.api.studioGenerate('root_s1',{characters:chars(shared)});
  assert.equal(second.card.id,'root_s2');
  const secondCast=await f.api.shotCastIds('root_s2');
  assert.deepEqual(secondCast.ids,[sharedCast],'removed local tab disappears from the new filename');
  const reopened=await f.api.readCardNaiPrompts('root_s2');
  assert.deepEqual(reopened.characters.map(({id,scope})=>({id,scope})),[{id:shared.id,scope:shared.scope}],
    'reopening the studio keeps the edited identity instead of the original image’s cast');
  assert.equal(secondCast.name.match(/\.s[^.]+/)[0],firstCast.name.match(/\.s[^.]+/)[0],'room hash stays stable');
  assert.match(secondCast.name,/_s2\.(?:webp|png)$/);
  const selected=await f.api.studioCommit('root_s2',{revision_id:'root_s1',image_data_url:first.image_data_url,characters:chars(shared)});
  assert.equal(selected.card.id,'root_s1');
  assert.deepEqual((await f.api.shotCastIds('root_s1')).ids,[localCast,sharedCast],
    'saving old history preserves the identities from that image’s generation');
  assert.ok((await f.chat()).message[0].data.includes(firstCast.name),'chat references the cast-bearing saved filename');
  const inherited=await f.api.studioGenerate('root_s1',{});
  assert.deepEqual((await f.api.shotCastIds(inherited.card.id)).ids,[localCast,sharedCast],
    'legacy callers without character overrides still inherit the source cast');
  const empty=await f.api.studioGenerate('root_s1',{characters:[]});
  assert.deepEqual((await f.api.shotCastIds(empty.card.id)).ids,[],'explicitly removed tabs clear the old cast');
  const unknown=await f.api.studioCommit('root_s1',{image_data_url:first.image_data_url,
    characters:[{id:'missing',scope:'owner',name:local.name,prompt:'girl'}]});
  assert.deepEqual((await f.api.shotCastIds(unknown.card.id)).ids,[],
    'unknown roster IDs do not mint an unresolvable identity or match a namesake');
});
