import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {readFileSync} from 'node:fs';
import {installHost, PNG_1X1, PNG_NAI_1X1} from '../tools/parity/host.mjs';

const bundle = await build({stdin:{contents:`
 export {getConfig,setConfig} from './src/services/context';
 export {openDb,idbPut,idbDelete} from './src/storage/stores';
 export {seedPrompts,getPrompt,setPrompt,resetPrompt} from './src/services/settings';
 export {pendingPromptDefaults} from './src/services/prompt-revisions';
 export {characterPrompt} from './src/services/character-prompt';
 export {characterImageInput} from './src/services/character-image-input';
 export {buildCharacterLooksMessages,buildTaggerMessages} from './src/services/tagger';
 export {characterSource} from './src/services/character-source';
 export {runImportFill} from './src/services/char-import';
 export {fetchCharacterLorebookEntries} from './src/services/lorefilter';
 export {collectTriggeredLoreKeys} from './src/domain/lore/assemble';
 export {joinTags} from './src/core/util/text';
 export {characterHasAppearance,syncGenderIntoAppearance,composeCharacterCaptionTags} from './src/domain/character/tags';
 `,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'esm',platform:'node',define:{__PLUGIN_ID__:'"omni-nexus"'}});
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

test('inline main builder uses metadata as text and branches only missing-metadata images',async()=>{
  for (const metadata of [true,false]) for (const separate of [true,false]) {
    const {api,host,config}=await runtime();
    const png=metadata ? PNG_NAI_1X1 : PNG_1X1;
    const bot={chaId:'bot',additionalAssets:[['Alice default','alice-asset']],chats:[]};
    globalThis.risuai.getCharacter=async()=>bot;
    globalThis.risuai.readImage=async()=>png;
    config.card.asset_nai_tags='inline';config.card.image_analysis_separate=separate;api.setConfig(config);
    const messages=await api.buildTaggerMessages({session_id:'',assistant_text:'Alice',lore_trigger_keys:['Alice']});
    const hasPixels=messages.some(m=>Array.isArray(m.content)&&m.content.some(p=>p.type==='image_url'));
    assert.equal(hasPixels,!metadata&&!separate);
    assert.equal(host.llmRequests.length,!metadata&&separate?1:0);
    if(metadata) assert.match(JSON.stringify(messages),/black hair/);
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
