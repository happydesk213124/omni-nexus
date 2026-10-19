import { png } from './fixtures/upscale-image.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { installHost, PNG_NAI_1X1, zipStore } from '../tools/parity/host.mjs';
import { emptyState, hydrateFromNai } from '../.test-build/tag-studio-model.mjs';
import { sessionIdHash } from '../.test-build/text-util.mjs';
let serial=0;
async function fixture() {
  const host=installHost({promptsDir:'prompts'});
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
  return {api,host,requests,config,recipe,chat:()=>risuai.getChatFromIndex(0,0)};
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

test('studio and reroll images reopen with scoped identity, costume and nude state; dropped files do too', async () => {
  const f = await fixture();
  const stored = await f.api.upsertCharacter('owner', { id: 'a', name: 'A', gender: 'girl', appearance: '2::black hair::',
    costumes: [{ name: 'school', attire: 'shirt', bottoms: 'skirt' }] });
  const prompt = '0.5::girl, black hair, completely nude, nipples, pussy, smile::';
  const result = await f.api.studioGenerate('root', { characters: [{ id: stored.id, scope: stored.scope, name: stored.name,
    costume: 'school', wear_state: 'completely', prompt }] });
  assert.equal(result.ok, true);
  const verify = async id => {
    const reopened = await f.api.readCardNaiPrompts(id);
    assert.equal(reopened.characters[0].id, stored.id);
    assert.equal(reopened.characters[0].scope, 'risu_'+sessionIdHash('owner|__unified__'));
    assert.equal(reopened.characters[0].costume, 'school');
    assert.equal(reopened.characters[0].wear_state, 'completely');
    assert.equal(reopened.characters[0].prompt, prompt);
  };
  await verify(result.card.id);
  const reroll = await f.api.rerollCard(result.card.id);
  assert.equal(reroll.ok, true);
  await verify(reroll.card.id);
  const bytes = (await f.api.idbGet('images', reroll.card.id)).png;
  const imported = await f.api.readImageNaiPrompts({ image_b64: Buffer.from(bytes).toString('base64') });
  assert.equal(imported.characters[0].id, stored.id);
  assert.equal(imported.characters[0].wear_state, 'completely');
});

test('a dropped or loaded file finds its people like the card did: by its file name\'s cast, then id, then name', async () => {
  const f = await fixture();
  const a = await f.api.upsertCharacter('owner', { name: '하나', appearance: 'girl, red hair' });
  const b = await f.api.upsertCharacter('owner', { name: '민아', appearance: 'girl, blue hair' });
  const ids = await f.api.ensureStudioCastIds([a, b], 'owner');
  const location = { session_id: 'session', character_id: 'owner', chat_id: 'chat', char_index: 0, chat_index: 0, message_index: -1, cast_ids: ids };
  const recipe = { ...f.recipe, prompt: 'style, park', characters: [{ ...f.recipe.characters[0], prompt: 'girl, red hair, smile' }, { ...f.recipe.characters[1], prompt: 'girl, blue hair, wave' }] };
  const png = () => PNG_NAI_1X1.buffer.slice(PNG_NAI_1X1.byteOffset, PNG_NAI_1X1.byteOffset + PNG_NAI_1X1.byteLength);
  // Saved under the bot's own scope, while this chat's roster lists the rows under a chat alias.
  await f.api.publishImage('drop_s1', png(), location, { recipe, characters: [{ id: a.id, scope: 'owner', name: a.name }, { id: b.id, scope: 'owner', name: b.name }] });
  const image_b64 = Buffer.from((await f.api.idbGet('images', 'drop_s1')).png).toString('base64');
  const payload = await f.api.getCharactersPayload('risu_' + sessionIdHash('owner|chat'), 'owner');
  const names = nai => { const state = emptyState(); hydrateFromNai({ state, nai, settings: {}, rosterPayload: payload, card: {} }); return Object.values(state.chars).map(c => c.charName); };
  assert.deepEqual(names(await f.api.readImageNaiPrompts({ image_b64 })), ['하나', '민아'], 'the saved id finds its row whatever scope it was written under');
  // No identity inside the file (another tool rewrote it): its name still carries the cast.
  await f.api.publishImage('drop_s2', png(), location, { recipe, characters: [] });
  const bare = Buffer.from((await f.api.idbGet('images', 'drop_s2')).png).toString('base64');
  assert.deepEqual(names(await f.api.readImageNaiPrompts({ image_b64: bare })), ['', ''], 'nothing to go on');
  const fileName = (await f.api.imageAssetRef('drop_s2')).name;
  assert.match(fileName, new RegExp('c' + ids.join('-')), 'a shot file carries its cast in its name');
  const named = await f.api.readImageNaiPrompts({ image_b64: bare, file_name: fileName });
  assert.deepEqual(named.characters.map(c => c.cast_id), ids);
  assert.deepEqual(names(named), ['하나', '민아'], 'the file name\'s cast ids name them');
});

test('a history revision can be deleted, but not the one a chat message shows', async () => {
  const f = await fixture();
  // A studio image is a history revision no message shows until it is saved.
  const revision = await f.api.studioGenerate('root', { characters: [] });
  assert.equal(revision.ok, true);
  const shown = (await f.chat()).message[0].data;
  const refused = await f.api.deleteImageRevision('root');
  assert.equal(refused.ok, false); assert.equal(refused.error.code, 'in_chat');
  assert.ok(await f.api.idbGet('cards', 'root'), 'the chat\'s image stays');
  const kept = (await f.api.readImageHistory('root')).cards.map(c => c.id);
  const other = kept.find(id => !shown.includes(`::${id}::`));
  assert.ok(other, 'one revision the chat does not show');
  assert.equal((await f.api.deleteImageRevision(other)).ok, true);
  assert.equal(await f.api.idbGet('cards', other), undefined);
  assert.deepEqual((await f.api.readImageHistory('root')).cards.map(c => c.id), kept.filter(id => id !== other));
  assert.equal((await f.chat()).message[0].data, shown, 'the chat is untouched');
  assert.equal((await f.api.deleteImageRevision('nope')).error.code, 'not_found');
});

test('studio restores filename cast across bot/chat scopes ahead of stale image identities', async () => {
  const f = await fixture();
  await risuai.setDatabase({modules:[...(await risuai.getDatabase(['modules'])).modules,
    {id:'inlay-inray-display',namespace:'inlay.inray_display',lorebook:[]}]});
  const appearance = '1boy, otoko no ko, {pale skin}, {white skin}, {{shiny skin}}, white hair, very long hair, blunt bangs, high ponytail, blunt ends, red eyes, tsurime';
  const prompt = 'boy, otoko no ko, {pale skin}, {white skin}, {{shiny skin}}, white hair, very long hair, blunt bangs, high ponytail, blunt ends, red eyes, tsurime, 2.5::completely nude::, small penis, kneeling, looking up, cold smile, upperbody, speechbubble, korean text:주인님... 페퍼의 표정을 보십시오.';
  const local = await f.api.upsertCharacter('owner',{id:'pepper',name:'페퍼',gender:'boy',appearance,penis_size:'small penis'});
  const shared = await f.api.upsertCharacter('__global__',{id:'shared',name:'페퍼',appearance:'girl, blue hair'});
  const ids = await f.api.ensureStudioCastIds([local,shared],'owner');
  const cardId = 'cast_probe_s1';
  const location = {session_id:'session',character_id:'owner',chat_id:'chat',char_index:0,chat_index:0,message_index:-1,cast_ids:ids};
  const recipe = {...f.recipe,characters:[{...f.recipe.characters[0],prompt,uc:''},
    {...f.recipe.characters[1],prompt:'girl, blue hair, smile',uc:''}]};
  await f.api.publishImage(cardId,PNG_NAI_1X1.buffer.slice(PNG_NAI_1X1.byteOffset,PNG_NAI_1X1.byteOffset+PNG_NAI_1X1.byteLength),location,
    {recipe,characters:[{id:'stale',scope:'wrong',name:'Wrong',wear_state:'completely'},
      {id:local.id,scope:'owner',name:local.name}]});
  await f.api.idbPut('cards',{...await f.api.idbGet('cards','root'),id:cardId});
  await risuai.setCharacterToIndex(1,{chaId:'other',name:'Other',chats:[]});
  risuai.getCurrentCharacterIndex = async () => 1;
  const nai = await f.api.readCardNaiPrompts(cardId);
  assert.equal(nai.ok,true,JSON.stringify(nai));
  assert.deepEqual(nai.characters.map(row => row.id),[local.id,shared.id]);
  assert.deepEqual(nai.characters.map(row => row.cast_id),ids,'filename order must survive the roster lookup');
  const sid = 'risu_'+sessionIdHash('owner|chat');
  const payload = await f.api.getCharactersPayload(sid,'owner');
  const state = emptyState();
  hydrateFromNai({state,nai,settings:{},rosterPayload:payload,card:{}});
  const [first,second] = Object.values(state.chars);
  assert.equal(first.charName,'페퍼');
  assert.equal(first.rosterId,local.id);
  assert.equal(first.tags,'boy, otoko no ko, {pale skin}, {white skin}, {{shiny skin}}, white hair, very long hair, blunt bangs, high ponytail, blunt ends, red eyes, tsurime, small penis');
  assert.equal(first.costumeTags,'2.5::completely nude::');
  assert.equal(first.post,'kneeling, looking up, cold smile, upperbody, speechbubble, korean text:주인님... 페퍼의 표정을 보십시오.');
  assert.equal(second.rosterId,shared.id);
  assert.equal(second.tags,'girl, blue hair');
  const repeatedId = 'comic_probe_s1';
  const repeatedRecipe = {...recipe,characters:[...recipe.characters,
    {...recipe.characters[0],prompt:'0.5::boy, white hair, red eyes::, 2.5::completely nude::, looking up'},
    {...recipe.characters[0],prompt:'boy, white hair, looking down'}]};
  await f.api.publishImage(repeatedId,PNG_NAI_1X1.buffer.slice(PNG_NAI_1X1.byteOffset,PNG_NAI_1X1.byteOffset+PNG_NAI_1X1.byteLength),location,
    {recipe:repeatedRecipe,characters:[local,shared,{...local,scope:sid},{id:'stale',scope:'wrong',name:'Wrong'}]});
  await f.api.idbPut('cards',{...await f.api.idbGet('cards','root'),id:repeatedId});
  const repeated = await f.api.readCardNaiPrompts(repeatedId);
  assert.deepEqual(repeated.characters.map(row => row.id),[local.id,shared.id,local.id,undefined],
    'repeated comic slots may only reuse the filename cast, not revive an extra metadata identity');
  const comic = emptyState();
  hydrateFromNai({state:comic,nai:repeated,settings:{},rosterPayload:payload,card:{kind:'comic'}});
  assert.equal(Object.values(comic.chars)[2].rosterId,local.id);
  assert.equal(Object.values(comic.chars)[2].halfWeight,true);
  assert.equal(Object.values(comic.chars)[3].charName,'');
  // A removed filename identity must not revive through stale image metadata.
  await f.api.deleteCharacter('owner',local.id);
  const missing = await f.api.readCardNaiPrompts(cardId);
  assert.equal(missing.characters[0].id,undefined);
  const reopened = emptyState();
  hydrateFromNai({state:reopened,nai:missing,settings:{},rosterPayload:await f.api.getCharactersPayload(sid,'owner'),card:{}});
  assert.equal(Object.values(reopened.chars)[0].charName,'');
  assert.equal(Object.values(reopened.chars)[0].post,prompt);
  assert.equal(Object.values(reopened.chars)[1].rosterId,shared.id,'unknown slots must not shift a later character into c1');
});


test('manual upscale replaces the displayed revision with doubled geometry and preserves tags and cast',async()=>{
  const f=await fixture();
  const local=await f.api.upsertCharacter('owner',{id:'upscale-cast',name:'A',appearance:'red hair'});
  const saved=await f.api.studioCommit('root',{image_data_url:'data:image/png;base64,'+png(832,1216).toString('base64'),
    recipe:{...f.recipe,seed:777},seed:777,width:832,height:1216,characters:[{id:local.id,scope:local.scope,name:local.name,prompt:'girl, red hair'}]});
  const sourceId=saved.card.id;
  const cast=await f.api.shotCastIds(sourceId);
  const before=(await f.chat()).message[0].data;
  let release;const gate=new Promise(r=>release=r);let calls=0;
  risuai.nativeFetch=async(url)=>{assert.ok(url.endsWith('/upscale'));calls++;await gate;return new Response(zipStore('image.png',png(1664,2432)));};
  const work=f.api.upscaleCard('root',{source_id:sourceId,characters:[{id:local.id,scope:local.scope,name:local.name,prompt:'girl, red hair'}]});
  for(let i=0;i<100 && !calls;i++)await new Promise(r=>setTimeout(r,5));
  assert.equal(calls,1);assert.equal((await f.chat()).message[0].data,before,'no replacement while upscale is pending');
  release();const result=await work;
  assert.equal(result.ok,true);assert.notEqual(result.card.id,sourceId);
  assert.deepEqual([result.card.width,result.card.height],[1664,2432]);
  assert.deepEqual((await f.api.shotCastIds(result.card.id)).ids,cast.ids);
  const recipe=await f.api.readCardNaiPrompts(result.card.id);
  assert.equal(recipe.main_prompt,f.recipe.prompt);assert.equal(recipe.width,1664);assert.equal(recipe.height,2432);assert.equal(recipe.seed,777);assert.equal(result.card.seed,777);
  assert.match((await f.chat()).message[0].data,/::1664::2432/);
  assert.ok(await f.api.idbGet('cards',sourceId),'original revision remains recoverable');
  const current=(await f.chat()).message[0].data;
  risuai.nativeFetch=async()=>new Response('Not enough Anlas',{status:402});
  await assert.rejects(f.api.upscaleCard(sourceId),/402/);
  assert.equal((await f.chat()).message[0].data,current,'failure cannot replace the existing image');
});

// 원본으로 저장 keeps a NAI PNG as NAI delivered it. Two things must survive that.
const rawPng = () => PNG_NAI_1X1.buffer.slice(PNG_NAI_1X1.byteOffset, PNG_NAI_1X1.byteOffset + PNG_NAI_1X1.byteLength);

test('원본으로 저장 and 메타데이터 쓰기 off never apply to ComfyUI: its recipe exists only in the Omni data we embed', async () => {
  const f = await fixture();
  Object.assign(f.config.card, { image_png_original: true, image_webp_metadata: false }); f.api.setConfig(f.config);
  const reroll = await f.api.rerollCard('root');
  assert.equal(reroll.ok, true);
  const stored = Buffer.from((await f.api.idbGet('images', reroll.card.id)).png);
  assert.notDeepEqual(stored, Buffer.from(PNG_NAI_1X1), 'the Comfy result carries Omni data, not the bare file Comfy sent');
  assert.equal((await f.api.rerollCard(reroll.card.id)).ok, true, 'so it can be rerolled again');
});

test('원본으로 저장: a NAI PNG is stored bare, and its reroll finds the cast\'s reference by its file name', async () => {
  const f = await fixture();
  Object.assign(f.config.card, { image_png_original: true, char_ref_mode: 'image' });
  f.config.nai = { ...f.config.nai, backend: 'nai', api_key: 'test' };
  f.api.setConfig(f.config);
  const a = await f.api.upsertCharacter('owner', { name: '하나', appearance: 'girl, red hair' });
  const ref = await f.api.putCharRefAsset(png(64, 64));
  await f.api.idbPut('characters', { ...(await f.api.idbGet('characters', { scope: a.scope, id: a.id })), ref_hash: ref.hash });
  const ids = await f.api.ensureStudioCastIds([a], 'owner');
  const location = { session_id: 'session', character_id: 'owner', character_name: 'Owner', chat_id: 'chat', char_index: 0, chat_index: 0, message_index: 0, shot_index: 0, cast_ids: ids };
  await f.api.publishImage('bare', rawPng(), location, { original: true, characters: [{ id: a.id, scope: a.scope, name: a.name }] });
  await f.api.idbPut('cards', { id: 'bare', session_id: 'session', job_id: 'job', shot_index: 0, paragraph: 0, characters_json: '[]', main_prompt: '', negative_prompt: '', seed: 1, meta_json: JSON.stringify({ ...location, width: 832, height: 1216 }), created_at: 2 });
  assert.deepEqual(Buffer.from((await f.api.idbGet('images', 'bare')).png), Buffer.from(PNG_NAI_1X1), 'stored exactly as delivered: no Omni data inside');
  const asset = await f.api.imageAssetRef('bare');
  assert.match(asset.name, new RegExp('c' + ids.join('-')), 'the file name carries the cast');
  const chat = await f.chat();
  chat.message[0].data = `text [[@inray::bare::${asset.name}::832::1216]]`;
  await risuai.setChatToIndex(0, 0, chat);
  const reads = [];
  const readImage = risuai.readImage;
  risuai.readImage = async path => { reads.push(path); return readImage(path); };
  const reroll = await f.api.rerollCard('bare');
  risuai.readImage = readImage;
  assert.equal(reroll.ok, true, JSON.stringify(reroll.error || ''));
  assert.ok(reads.includes(ref.path), 'the reroll read 하나\'s reference, named only by the file name');
});

test('박제는 PNG 원본: a NAI reroll stores the PNG as delivered and previews a WebP; ComfyUI never', async () => {
  const f = await fixture();
  Object.assign(f.config.card, { image_png_bake: true }); f.api.setConfig(f.config);
  assert.equal(f.api.keepsOriginalPng(), false, 'ComfyUI keeps its Omni data');
  assert.equal(f.api.previewsWebp(), false);
  f.config.nai = { ...f.config.nai, backend: 'nai', api_key: 'test' }; f.api.setConfig(f.config);
  assert.equal(f.api.keepsOriginalPng(), true);
  assert.equal(f.api.previewsWebp(), true);
  const reroll = await f.api.rerollCard('root');
  assert.equal(reroll.ok, true, JSON.stringify(reroll.error || ''));
  assert.deepEqual(Buffer.from((await f.api.idbGet('images', reroll.card.id)).png), Buffer.from(PNG_NAI_1X1), 'baked from the bare PNG');
  Object.assign(f.config.card, { image_png_bake: false, image_png_original: true }); f.api.setConfig(f.config);
  assert.equal(f.api.previewsWebp(), false, '원본으로 저장 alone previews the PNG itself');
});

// A browser that can encode WebP, so storing a PNG is a choice rather than the
// only thing Node can do.
const WEBP_1X1 = Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA', 'base64');
async function withWebpEncoder(run) {
  const previous = { document: globalThis.document, bitmap: globalThis.createImageBitmap, canvas: globalThis.OffscreenCanvas };
  const canvas = { width: 0, height: 0, getContext() { return { drawImage() {} }; },
    toBlob(callback) { callback(new Blob([WEBP_1X1], { type: 'image/webp' })); },
    toDataURL() { return 'data:image/webp;base64,' + WEBP_1X1.toString('base64'); } };
  globalThis.OffscreenCanvas = undefined;
  globalThis.createImageBitmap = async () => ({ width: 1, height: 1, close() {} });
  globalThis.document = { createElement() { return canvas; } };
  try { return await run(); }
  finally { globalThis.document = previous.document; globalThis.createImageBitmap = previous.bitmap; globalThis.OffscreenCanvas = previous.canvas; }
}
const isPng = bytes => Buffer.from(bytes).subarray(1, 4).toString() === 'PNG';

test("PNG 원본 받아오기 replays the image's own recipe and seed and keeps NAI's PNG; the image it replaces stays", async () => {
  const f = await fixture();
  f.config.nai = { ...f.config.nai, backend: 'nai', api_key: 'test' }; f.api.setConfig(f.config);
  const before = f.host.naiRequests.length;
  const result = await withWebpEncoder(() => f.api.fetchOriginalCard('root'));
  assert.equal(result.ok, true, JSON.stringify(result.error || ''));
  const sent = f.host.naiRequests.slice(before).filter(r => r.kind === 'generate');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].body.parameters.seed, f.recipe.seed, 'the same seed, not a new one');
  assert.equal(sent[0].body.parameters.width, f.recipe.width);
  const kept = Buffer.from((await f.api.idbGet('images', result.card.id)).png);
  assert.ok(isPng(kept), "NAI's PNG, though WebP was available");
  assert.deepEqual(kept.subarray(0, 33), Buffer.from(PNG_NAI_1X1).subarray(0, 33), 'its header as delivered: not drawn again');
  assert.equal(f.api.readGenerationImageData(kept).recipe.seed, f.recipe.seed, 'and it carries its recipe for the next reroll');
  assert.match((await f.chat()).message[0].data, new RegExp(result.card.id), "it takes the image's place in the chat");
  assert.ok(await f.api.idbGet('cards', 'root'), 'the image it replaced stays in the history');
});

test('PNG 원본 받아오기 refuses ComfyUI and a missing card before drawing anything', async () => {
  const f = await fixture();
  await assert.rejects(f.api.fetchOriginalCard('root'), /NovelAI/);
  assert.equal(f.requests.length, 0);
  f.config.nai = { ...f.config.nai, backend: 'nai', api_key: 'test' }; f.api.setConfig(f.config);
  assert.equal((await f.api.fetchOriginalCard('not-there')).error.code, 'not_found');
});

test("a 🆙 upscale keeps NAI's PNG even where WebP is available; a studio save does not", async () => {
  const f = await fixture();
  f.config.nai = { ...f.config.nai, backend: 'nai', api_key: 'test' }; f.api.setConfig(f.config);
  risuai.nativeFetch = async () => new Response(zipStore('image.png', png(2, 2)));
  const up = await withWebpEncoder(() => f.api.upscaleCard('root', {}));
  assert.equal(up.ok, true, JSON.stringify(up.error || ''));
  const upscaled = (await f.api.idbGet('images', up.card.id)).png;
  assert.ok(isPng(upscaled), 'upscale stored as PNG');
  assert.deepEqual([f.api.readGenerationImageData(upscaled).recipe.width, f.api.readGenerationImageData(upscaled).recipe.height], [2, 2], 'its recipe has the new size');
  f.config.card.upscale_button_mode = 'upscale_webp'; f.api.setConfig(f.config);
  const squeezed = await withWebpEncoder(() => f.api.upscaleCard('root', {}));
  assert.equal(squeezed.ok, true, JSON.stringify(squeezed.error || ''));
  assert.equal(Buffer.from((await f.api.idbGet('images', squeezed.card.id)).png).subarray(0, 4).toString(), 'RIFF', 'Anlas 업스케일 · WebP 압축 저장 stores a WebP');
  const saved = await withWebpEncoder(() => f.api.studioCommit('root', { image_data_url: 'data:image/png;base64,' + png(832, 1216).toString('base64'), recipe: { ...f.recipe, seed: 5 }, seed: 5, width: 832, height: 1216 }));
  assert.equal(Buffer.from((await f.api.idbGet('images', saved.card.id)).png).subarray(0, 4).toString(), 'RIFF', 'an ordinary studio save is still a WebP');
});
