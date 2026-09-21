import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build,transform} from 'esbuild';
import {readFileSync} from 'node:fs';
import {installHost, PNG_1X1, PNG_NAI_1X1} from '../tools/parity/host.mjs';

// Remove metadata chunks from a valid PNG to exercise genuinely metadata-free images.
const PNG_NO_META=(()=>{
  const bytes=Buffer.from(PNG_NAI_1X1),parts=[bytes.subarray(0,8)];
  for(let offset=8;offset+12<=bytes.length;) {
    const end=offset+12+bytes.readUInt32BE(offset),kind=bytes.toString('ascii',offset+4,offset+8);
    if(!['tEXt','zTXt','iTXt'].includes(kind)) parts.push(bytes.subarray(offset,end));
    offset=end;
  }
  return new Uint8Array(Buffer.concat(parts));
})();

const PNG_COMPLETE_META=(()=>{
 const bytes=Buffer.from(PNG_NAI_1X1),parts=[bytes.subarray(0,8)];
 for(let offset=8;offset+12<=bytes.length;) {
  const end=offset+12+bytes.readUInt32BE(offset),kind=bytes.toString('ascii',offset+4,offset+8);
  const data=bytes.subarray(offset+8,end-4);
  if(kind==='tEXt'&&data.toString().startsWith('Comment\0')) {
   const next=Buffer.from(data.toString().replace('boy, black hair','boy, black hair, short hair, blue eyes, tsurime'));
   const chunk=Buffer.alloc(next.length+12);chunk.writeUInt32BE(next.length);chunk.write(kind,4);next.copy(chunk,8);
   let crc=0xffffffff;for(const byte of chunk.subarray(4,-4)){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
   chunk.writeUInt32BE((crc^0xffffffff)>>>0,chunk.length-4);parts.push(chunk);
  } else parts.push(bytes.subarray(offset,end));
  offset=end;
 }
 return new Uint8Array(Buffer.concat(parts));
})();

const bundle = await build({stdin:{contents:`
 export {getConfig,setConfig} from './src/services/context';
 export {openDb,idbPut,idbDelete} from './src/storage/stores';
 export {seedPrompts,getPrompt,setPrompt,resetPrompt} from './src/services/settings';
 export {pendingPromptDefaults} from './src/services/prompt-revisions';
 export {characterPrompt} from './src/services/character-prompt';
 export {characterImageInput} from './src/services/character-image-input';
 export {buildCharacterLooksMessages,buildTaggerMessages,collectGenerationAssets} from './src/services/tagger';
 export {getLastAssetWeightMap,setLastAssetWeightMap} from './src/services/asset-tags';
 export {characterSource} from './src/services/character-source';
 export {runImportFill,analyzeAssetLook} from './src/services/char-import';
 export {metadataHasHairAndEyes} from './src/domain/nai-meta/look-completeness';
 export {fetchCharacterLorebookEntries} from './src/services/lorefilter';
 export {collectTriggeredLoreKeys} from './src/domain/lore/assemble';
 export {joinTags} from './src/core/util/text';
 export {characterHasAppearance,syncGenderIntoAppearance,composeCharacterCaptionTags} from './src/domain/character/tags';
 `,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'esm',platform:'node',define:{__PLUGIN_ID__:'"omni-nexus"'},plugins:process.env.BREAK_META_COMPLETENESS?[{name:'break-completeness',setup(builder){
 builder.onLoad({filter:/look-completeness\.ts$/},()=>({loader:'ts',contents:'export function metadataHasHairAndEyes(){return true;}'}));
 }}]:[]});
let sequence=0;
async function runtime() {
  const host=installHost({promptsDir:'prompts',seed:42});
  const api=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text+`\n// instance ${sequence++}`).toString('base64'));
  await api.openDb(); await api.seedPrompts();
  const config=api.getConfig();
  config.card={...config.card,preprocessing:false,llm_reverse_bar:false,llm_tag_cal:false,comic_gen:false,char_info:false,user_info:false,lorebook:false};
  config.llm={source:'custom',provider:'openai',endpoint:'https://api.openai.com/v1/chat/completions',model:'main-text',api_key:'test'};
  config.llm_roles={...config.llm_roles,autotag:{...config.llm,model:'vision-only',follow_main:false}};
  api.setConfig(config);
  return {api,host,config};
}

test('shared prompt edit reaches main, asset and single-image builders exactly once',async()=>{
  const {api,config}=await runtime();
  await api.setPrompt('character_common','UNIQUE SHARED LOOK RULE');
  const single=await api.characterPrompt('single');
  const asset=await api.buildCharacterLooksMessages({session_id:'',assistant_text:'Alice'},'asset tags');
  config.card.asset_nai_tags='off'; api.setConfig(config);
  const main=await api.buildTaggerMessages({session_id:'',assistant_text:'Alice'});
  for(const value of [single,JSON.stringify(asset),JSON.stringify(main)]) assert.equal(value.split('UNIQUE SHARED LOOK RULE').length-1,1);
  assert.ok(single.includes('one character JSON'));
  assert.ok(JSON.stringify(asset).includes('new_characters'));
});

test('image separation sends pixels only to autotag and returns text, independent of asset mode',async()=>{
  const {api,host,config}=await runtime();
  host.setLlmReply(JSON.stringify({gender:'girl',hair_color:'blue hair',hair_style:'long hair, braid',eye_color:'blue eyes, tsurime',appearance:'girl'}));
  const assets=[{name:'Alice.png',trigger:'Alice',bytes:PNG_1X1}];
  for(const mode of ['inline','prepass']) for(const separate of [false,true]) {
    config.card.asset_nai_tags=mode;config.card.image_analysis_separate=separate;api.setConfig(config);
    const before=host.llmRequests.length;
    const messages=await api.characterImageInput(assets,separate);
    assert.equal(host.llmRequests.length-before,separate?1:0);
    if(separate) {
      assert.ok(messages.every(m=>typeof m.content==='string'));
      assert.match(messages[0].content,/long silver hair/);
      assert.match(JSON.stringify(host.llmRequests.at(-1)),/vision-only/);
    } else assert.equal(messages[0].content[1].type,'image_url');
    const metadataOnly=await api.characterImageInput([],separate);
    assert.deepEqual(metadataOnly,[]);
  }
});

test('metadata coverage requires hair styling plus eye color and shape',async()=>{
 const {api}=await runtime();
 for(const tags of [[],['boy','black hair'],['short hair','blue eyes'],['bangs','tsurime']]) assert.equal(api.metadataHasHairAndEyes(tags),false);
 assert.equal(api.metadataHasHairAndEyes(['short hair','blue eyes','tsurime']),true);
 assert.equal(api.metadataHasHairAndEyes(['bald','eyeless']),true);
});

test('manual metadata analysis also supplies missing visual details using the chosen image route',async()=>{
 for(const separate of [false,true]) {
 const {api,host,config}=await runtime();
  config.llm_roles.asset_char={...config.llm,model:'asset-test',follow_main:false};
  config.card.image_analysis_separate=separate;api.setConfig(config);
  const result=await api.analyzeAssetLook(PNG_NAI_1X1,{name:'Alice'});
  assert.equal(result.ok,true);
  assert.equal(host.llmRequests.length,separate?2:1);
  const imageRequests=host.llmRequests.filter(request=>JSON.stringify(request).includes('image_url'));
  assert.equal(imageRequests.length,1);
  if(separate) assert.match(JSON.stringify(imageRequests[0]),/vision-only/);
 }
});

test('inline main builder supplements incomplete metadata with images',async()=>{
  for (const metadata of [true,false]) for (const separate of [true,false]) {
    const {api,host,config}=await runtime();
    const png=metadata ? PNG_NAI_1X1 : PNG_1X1;
    const bot={chaId:'bot',additionalAssets:[['Alice default','alice-asset']],chats:[]};
    globalThis.risuai.getCharacter=async()=>bot;
    globalThis.risuai.readImage=async()=>png;
    config.card.asset_nai_tags='inline';config.card.image_analysis_separate=separate;api.setConfig(config);
    const messages=await api.buildTaggerMessages({session_id:'',assistant_text:'Alice',lore_trigger_keys:['Alice']});
    const hasPixels=messages.some(m=>Array.isArray(m.content)&&m.content.some(p=>p.type==='image_url'));
    assert.equal(hasPixels,!separate);
    assert.equal(host.llmRequests.length,separate?1:0);
    if(metadata) assert.match(JSON.stringify(messages),/black hair/);
  }
});

test('complete metadata stays text-only in both modes and both image routing settings',async()=>{
 for(const mode of ['inline','prepass']) for(const separate of [false,true]) {
  const {api,host,config}=await runtime();
  const bot={chaId:'bot',additionalAssets:[['Alice default','alice-asset']],chats:[]};
  globalThis.risuai.getCharacter=async()=>bot;globalThis.risuai.readImage=async()=>PNG_COMPLETE_META;
  config.card.asset_nai_tags=mode;config.card.image_analysis_separate=separate;api.setConfig(config);
  const request={session_id:'',assistant_text:'Alice',lore_trigger_keys:['Alice']};
  const collected=await api.collectGenerationAssets(request);
  assert.match(collected.collected.block,/tsurime/);assert.equal(collected.images.length,0);
  const messages=mode==='inline'?await api.buildTaggerMessages(request):await api.buildCharacterLooksMessages(request,collected.collected.block);
  assert.ok(messages.every(message=>typeof message.content==='string'));
  assert.equal(host.llmRequests.length,0);
 }
});

test('failed image analysis propagates without a main-model retry or gender-only success',async()=>{
  const {api,host,config}=await runtime();
  config.llm_roles.autotag={...config.llm_roles.autotag,provider:'anthropic',endpoint:'https://api.anthropic.com/v1/messages'};
  api.setConfig(config);
  host.setLlmReply('{"gender":"girl"}');
  await assert.rejects(api.characterImageInput([{name:'Alice',trigger:'Alice',bytes:PNG_1X1}],true),/외형·의상 태그가 없습니다/);
  assert.equal(host.llmRequests.length,1);
  assert.equal(host.llmRequests[0].model,'vision-only');
});

test('default update preserves edits, survives viewing and clears only after applying default',async()=>{
  const {api}=await runtime();
  await api.setPrompt('character_common','MY CUSTOM RULE');
  const before=await api.getPrompt('character_common');
  globalThis.__INLAY_NATIVE_PROMPTS__={character_common:'UPDATED DEFAULT hair_style eye_color'};
  await api.seedPrompts();
  assert.equal(await api.getPrompt('character_common'),before);
  assert.ok((await api.pendingPromptDefaults()).includes('character_common'));
  await api.getPrompt('character_common');
  assert.ok((await api.pendingPromptDefaults()).includes('character_common'));
  await api.setPrompt('character_common','UPDATED DEFAULT hair_style eye_color');
  assert.ok((await api.pendingPromptDefaults()).includes('character_common'),'saving identical text is not a default reset');
  await api.resetPrompt('character_common');
  assert.ok(!(await api.pendingPromptDefaults()).includes('character_common'));
  await api.setPrompt('character_common','CUSTOM AFTER RESET');
  assert.ok(!(await api.pendingPromptDefaults()).includes('character_common'));
});

test('selected bot lore includes its modules and sibling keys, never the live bot',async()=>{
  const {api}=await runtime();
  const bots=[{chaId:'a',globalLore:[{key:'other',content:'wrong'}]},{chaId:'b',modules:['m'],globalLore:[{key:'kimherin, herin, marin',content:'character'}]}];
  globalThis.risuai.getDatabase=async()=>({characters:bots,modules:[{id:'m',lorebook:[{comment:'lb-xnai.lb.extra',content:'### Herin\nblue hair'}]}],enabledModules:[]});
  globalThis.risuai.getCharacter=async()=>bots[0];
  assert.equal((await api.characterSource('b')).chaId,'b');
  assert.equal(await api.characterSource('missing'),null);
  const lore=await api.fetchCharacterLorebookEntries('b');
  assert.equal(lore.length,2);
  assert.deepEqual(api.collectTriggeredLoreKeys(lore,'kimherin appeared'),['kimherin','herin','marin']);
});

test('persona import includes its alias-matched module extra without another person',async()=>{
  const {api,host}=await runtime();
  globalThis.risuai.getDatabase=async()=>({
    characters:[{chaId:'selected',globalLore:[],modules:['m'],chats:[]}],
    personas:[{id:'p',name:'Herin',aliases:['Marin'],personaPrompt:'A named persona'}],enabledModules:[],
    modules:[{id:'m',lorebook:[{comment:'lb-xnai.lb.extra',content:'## Character Image Tags\n### Marin\nblue hair, tsurime\n### Other Person\nUNRELATED APPEARANCE'}]}],
  });
  host.setLlmReply(JSON.stringify({new_characters:[{name:'Herin',aliases:['Marin'],gender:'girl',hair_color:'blue hair',hair_style:'long hair',appearance:'girl'}]}));
  await api.runImportFill({scope:'__global__',character_id:'selected',picks:[{kind:'persona',id:'p'}],xnai:true});
  assert.ok(host.llmRequests.length>0);
  const requests=JSON.stringify(host.llmRequests);
  assert.match(requests,/blue hair, tsurime/);
  assert.doesNotMatch(requests,/UNRELATED APPEARANCE/);
});

test('revision migration alerts only for the newly introduced shared prompt',async()=>{
  const {api}=await runtime();
  for(const key of ['tagger','format','appearance_inject','character_common']) {
    await api.idbDelete('meta',`prompt:__applied__:${key}`);
  }
  await api.seedPrompts();
  assert.deepEqual(await api.pendingPromptDefaults(),['character_common']);
});

test('gender-only remains incomplete; final caption deduplicates while preserving emphasis',async()=>{
  const {api}=await runtime();
  assert.equal(api.characterHasAppearance({appearance:'girl'}),false);
  assert.equal(api.syncGenderIntoAppearance('', 'other'),'other');
  assert.equal(api.joinTags('boy, boy, happy, happy,, 2::blue eyes, tsurime::, 2::blue eyes, tsurime::, 3::blue eyes::'),
    'boy, happy, 2::blue eyes, tsurime::, 3::blue eyes::');
  assert.equal(api.joinTags('happy, {happy, blue eyes}, happy, [blue eyes, happy], (happy, blue eyes:1.2)'),
    'happy, {happy, blue eyes}, [blue eyes, happy], (happy, blue eyes:1.2)');
  const common=readFileSync('prompts/character_common.txt','utf8');
  assert.match(common,/height and age: optional/);
  assert.match(common,/eye color and stable eye shape/);
  assert.match(common,/Never store expressions/);
});


test('generation prepass and inline route new image-only people and metadata through all four settings', async()=> {
  const source=readFileSync('src/services/jobs.ts','utf8');
  const start=source.indexOf("    if (assetMode === 'prepass') {");
  const end=source.indexOf("\n    await setJob(jobId, 'tagging', {",start);
  assert.ok(start>=0 && end>start);
  let body=source.slice(start,end);
  if(process.env.BREAK_IMAGE_ROUTING) body=body.replace('getConfig().card.image_analysis_separate === true','false');
  const {code}=await transform(`return (async()=>{${body};return {skipAssetInject};})();`,{loader:'ts'});
  for(const mode of ['inline','prepass']) for(const separate of [false,true]) for(const material of ['text','image','metadata']) {
    const metadata=material==='metadata',hasAssets=material!=='text';
    const {api,host,config}=await runtime();
    config.card.asset_nai_tags=mode;config.card.image_analysis_separate=separate;api.setConfig(config);
    const bot={chaId:'bot',additionalAssets:hasAssets?[['Alice default','alice-asset']]:[],chats:[]};
    globalThis.risuai.getCharacter=async()=>bot;
    globalThis.risuai.readImage=async()=>metadata?PNG_NAI_1X1:PNG_NO_META;
    const request={session_id:'',assistant_text:'Alice',lore_trigger_keys:['Alice']};
    const calls=[],saves=[];
    const scope={assetMode:mode,request,jobId:'j',sessionId:'',unifiedSessionId:'',characterId:'',sourceSessionIds:[],skipAssetInject:false,referenceCandidates:undefined,llmOptions:{},
      collectGenerationAssets:api.collectGenerationAssets,characterImageInput:api.characterImageInput,
      buildCharacterLooksMessages:api.buildCharacterLooksMessages,getConfig:api.getConfig,
      setJob:async()=>{},cancelJobIfStale:async()=>false,dbg:()=>{},resolveLlmRole:(_,role)=>role,
      callLlm:async(role,messages)=>{calls.push({role,messages});return '{"new_characters":[{"name":"Alice","hair_style":"braid"}]}';},parseJsonLoose:JSON.parse,
      mergeRosterFromTagged:async args=>{saves.push(args);},characterHasAppearance:api.characterHasAppearance};
    const pipeline=await new Function(...Object.keys(scope),code)(...Object.values(scope));
    calls.push({role:'main',messages:await api.buildTaggerMessages(request,{skipAssetInject:pipeline.skipAssetInject})});
    assert.equal(calls.length,mode==='prepass'&&hasAssets?2:1,`${mode}/${separate}/${metadata}`);
    assert.equal(host.llmRequests.length,hasAssets&&separate?1:0);
    for(const call of calls) {
      const pixels=call.messages.some(m=>Array.isArray(m.content)&&m.content.some(p=>p.type==='image_url'));
      assert.equal(pixels,hasAssets&&!separate&&call.role===(mode==='prepass'?'asset_char':'main'));
    }
    if(hasAssets&&separate) {
      assert.equal(host.llmRequests[0].model,'vision-only');
      assert.match(JSON.stringify(calls[0].messages),/Image analysis/);
    }
    if(metadata) assert.match(JSON.stringify(calls[0].messages),/black hair/);
  }
});

test('legacy asset writing overrides are preserved but not injected',async()=>{
  const {api}=await runtime();
  await api.setPrompt('asset_author_note','LEGACY INVENT ALL HAIR');
  const messages=await api.buildCharacterLooksMessages({session_id:'',assistant_text:'Alice'},'tags');
  assert.doesNotMatch(JSON.stringify(messages),/LEGACY INVENT ALL HAIR/);
  assert.equal(await api.getPrompt('asset_author_note'),'LEGACY INVENT ALL HAIR');
});


test('malformed image JSON fails instead of becoming saved appearance text',async()=>{
  const {api,host,config}=await runtime();
  config.llm_roles.autotag={...config.llm_roles.autotag,provider:'anthropic',endpoint:'https://api.anthropic.com/v1/messages'};
  api.setConfig(config);host.setLlmReply('{"hair_color":');
  await assert.rejects(api.characterImageInput([{name:'Alice',trigger:'Alice',bytes:PNG_1X1}],true),/오토태그 응답 오류/);
  assert.equal(host.llmRequests.length,1);
});


test('asset collection clears previous request weights when no references exist',async()=>{
  const {api,config}=await runtime();config.card.asset_nai_tags='inline';api.setConfig(config);
  globalThis.risuai.getCharacter=async()=>({additionalAssets:[]});
  api.setLastAssetWeightMap(new Map([['blue hair','2::blue hair::']]));
  const result=await api.collectGenerationAssets({session_id:'',assistant_text:'Alice',lore_trigger_keys:['Alice']});
  assert.equal(result.collected,null);assert.equal(result.images.length,0);
  assert.equal(api.getLastAssetWeightMap().size,0);
});
