import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { installHost } from '../tools/parity/host.mjs';

const bundled = await build({stdin:{contents:`
 export * from './src/domain/character/create';
 export {getConfig,setConfig} from './src/services/context';
 export {openDb} from './src/storage/stores';
 export {seedPrompts,setPrompt} from './src/services/settings';
 export {upsertCharacter,listCharacters} from './src/services/characters';
 export {buildTaggerMessages,assetTriggerPoolForRequest} from './src/services/tagger';
 export {routeFetch} from './src/api/router';
 export {callLlm} from './src/services/llm-call';
 `,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'esm',platform:'node',define:{__PLUGIN_ID__:'"omni-nexus"'},plugins:process.env.BREAK_CREATE_BATCH_GUARD?[{
 name:'break-batch-validation',setup(builder){builder.onLoad({filter:/domain[\\/]character[\\/]create\.ts$/},args=>({loader:'ts',contents:readFileSync(args.path,'utf8').replace("if (!row || !characterHasAppearance(row))",'if (!row)')}));},
}]:process.env.BREAK_TAGGER_LENGTH?[{
 name:'restore-short-limit',setup(builder){builder.onLoad({filter:/tagging[\\/]limits\.ts$/},args=>({loader:'ts',contents:readFileSync(args.path,'utf8').replace('50_000','20_000')}));},
}]:[]});
let instance=0;
async function runtime() {
 const host=installHost({promptsDir:'prompts',seed:42});
 await mkdir('.test-build/character-create',{recursive:true});
 const modulePath=resolve(`.test-build/character-create/runtime-${instance++}.mjs`);
 await writeFile(modulePath,bundled.outputFiles[0].text);
 const api=await import(pathToFileURL(modulePath).href);
 await globalThis.risuai.setDatabase({modules:[{id:'inlay-inray-display',namespace:'inlay.inray_display',lorebook:[],assets:[]}],enabledModules:[]});
 await api.openDb();await api.seedPrompts();
 const config=api.getConfig();
 config.card={...config.card,preprocessing:false,llm_reverse_bar:false,llm_tag_cal:false,comic_gen:false,char_info:false,user_info:false,lorebook:true,asset_nai_tags:'off',include_max:0};
 config.llm={source:'custom',provider:'openai',endpoint:'https://api.openai.com/v1/chat/completions',model:'main-text',api_key:'test'};
 config.llm_roles={...config.llm_roles,asset_char:{...config.llm,model:'character-text',follow_main:false}};
 api.setConfig(config);
 return {host,api,config};
}
const hajin={name:'하진',aliases:['하진','Hajin'],given_name:'하진',given_name_variants:['하진','Hajin'],gender:'female',appearance:'mature female',hair_color:'brown hair',hair_style:'side ponytail',eye_color:'brown eyes',attire:'white shirt',bottoms:'black pants'};
const minji={name:'민지',aliases:['민지','Minji'],given_name:'민지',given_name_variants:['민지','Minji'],gender:'female',appearance:'girl',hair_color:'blue hair',hair_style:'long hair',eye_color:'blue eyes',attire:'gray hoodie',bottoms:'jeans'};
const body={session_id:'char_parity',character_id:'char_parity',scope:'char_parity',instruction:'하진: 중년 여성, 갈색 머리·갈색 눈, 사이드테일, 흰 셔츠, 검은 바지.\n\n민지: 파란 머리와 파란 눈, 긴 생머리, 회색 후드와 청바지.'};

test('actual tagging request carries 50,000 characters; lore/assets search stops at 30,000',async()=>{
 const {api,host}=await runtime();
 const story='x'.repeat(25_000)+'EARLY_LORE'+'y'.repeat(10_000)+'LATE_LORE'+'z'.repeat(14_950)+'STORY_END';
 const lorebook=[{key:'EARLY_LORE',content:'EARLY_REFERENCE'}, {key:'LATE_LORE',content:'LATE_REFERENCE'}];
 const messages=await api.buildTaggerMessages({session_id:'',assistant_text:story,lorebook});
 const prose=messages.at(-1).content;
 assert.ok(prose.includes('STORY_END'));
 assert.ok(prose.includes('LATE_LORE'));
 await api.callLlm(api.getConfig().llm,messages);
 assert.ok(host.llmRequests.at(-1).messages.at(-1).content.includes('STORY_END'),'the provider receives the long message tail');
 assert.ok(JSON.stringify(messages).includes('EARLY_REFERENCE'));
 assert.ok(!JSON.stringify(messages).includes('LATE_REFERENCE'));
 assert.deepEqual(api.assetTriggerPoolForRequest({assistant_text:story,lorebook}),['EARLY_LORE']);
 const long=await api.buildTaggerMessages({session_id:'',assistant_text:'x'.repeat(49_990)+'KEPT_END!!'+'OUTSIDE_LIMIT'});
 assert.ok(long.at(-1).content.includes('KEPT_END!!'));
 assert.ok(!long.at(-1).content.includes('OUTSIDE_LIMIT'));
 // Existing characters near the end still reach the main tagger, independently of asset lookup.
 await api.upsertCharacter('char_parity',{id:'tail',name:'LATE_LORE',aliases:['LATE_LORE'],appearance:'TAIL_CHARACTER_LOOK'});
 const cast=await api.buildTaggerMessages({session_id:'char_parity',character_id:'char_parity',assistant_text:story});
 assert.ok(JSON.stringify(cast).includes('TAIL_CHARACTER_LOOK'));
});

test('one description call adds multiple characters with names, aliases, look slots and clothes',async()=>{
 const {api,host}=await runtime();
 const db=await globalThis.risuai.getDatabase();
 const index=db.characters.findIndex(c=>c.chaId==='char_parity');
 await globalThis.risuai.setCharacterToIndex(index,{...db.characters[index],globalLore:[{key:'하진',content:'HAJIN_LORE_REFERENCE'},{key:'무관한사람',content:'UNRELATED_LORE'}]});
 await api.upsertCharacter('char_parity',{id:'existing',name:'Existing',aliases:['기존인물'],appearance:'EXISTING_ROSTER_LOOK'});
 await api.setPrompt('character_common','SHARED_CHARACTER_RULE');
 host.setLlmReply(JSON.stringify({new_characters:[hajin,minji]}));
 const result=(await api.routeFetch('/v1/characters/create-from-description',{method:'POST',body})).data;
 assert.equal(result.ok,true);assert.equal(result.added,2);assert.deepEqual(result.names.sort(),['하진','민지'].sort());
 assert.equal(host.llmRequests.length,1);assert.equal(host.llmRequests[0].model,'character-text');
 const text=JSON.stringify(host.llmRequests[0].messages);
 for(const term of ['SHARED_CHARACTER_RULE','new_characters','HAJIN_LORE_REFERENCE','EXISTING_ROSTER_LOOK',body.instruction.split('\n')[0]]) assert.ok(text.includes(term),term);
 assert.ok(!text.includes('UNRELATED_LORE'));
 assert.doesNotMatch(text,/\b(?:NPC|mob|extra character)\b/i);
 const rows=await api.listCharacters('char_parity');
 assert.equal(rows.length,3);
 for(const expected of [hajin,minji]) {
  const row=rows.find(r=>r.name===expected.name);assert.ok(row);
  assert.ok(row.aliases.includes(expected.name));assert.ok(row.aliases.includes(expected.aliases[1]));
  for(const key of ['given_name','hair_color','hair_style','eye_color','attire','bottoms']) assert.equal(row[key],expected[key],key);
 }
 assert.deepEqual(await api.listCharacters('__global__'),[]);
});

test('existing identity and filled appearance survive repeated creation; global scope works',async()=>{
 const {api,host}=await runtime();
 await api.upsertCharacter('char_parity',{...hajin,id:'kept',appearance:'KEEP_APPEARANCE',attire:'KEEP_SHIRT'});
 const before=await api.listCharacters('char_parity');
 host.setLlmReply(JSON.stringify({new_characters:[{...hajin,appearance:'red hair',attire:'red shirt'}]}));
 const result=(await api.routeFetch('/v1/characters/create-from-description',{method:'POST',body})).data;
 assert.equal(result.added,0);
 const after=await api.listCharacters('char_parity');
 assert.equal(after.length,1);assert.equal(after[0].id,'kept');assert.equal(after[0].appearance,before[0].appearance);
 assert.equal(after[0].attire,before[0].attire);assert.deepEqual(after[0].aliases,before[0].aliases);
 assert.ok(after[0].costumes.some(c=>c.note.startsWith('하진 · ') && c.appearance.includes('red hair') && c.attire==='red shirt'));
 assert.match(textForCreation(host),/application adds them/);
 host.setLlmReply(JSON.stringify({new_characters:[minji]}));
 const global=(await api.routeFetch('/v1/characters/create-from-description',{method:'POST',body:{...body,scope:'__global__'}})).data;
 assert.equal(global.added,1);assert.equal((await api.listCharacters('__global__'))[0].name,'민지');
 assert.equal((await api.listCharacters('char_parity')).length,1);
});

function textForCreation(host) { return JSON.stringify(host.llmRequests.at(-1).messages); }

test('the triggered roster sends full-name costume notes and the selection instruction to the LLM',async()=>{
 const {api,host}=await runtime();
 await api.upsertCharacter('char_parity',{id:'kim',name:'김지수',surname:'김',given_name:'지수',aliases:['지수'],appearance:'girl, pale skin',eye_color:'blue eyes',attire:'uniform'});
 await api.upsertCharacter('char_parity',{id:'han',name:'한지수',surname:'한',given_name:'지수',aliases:['한지수'],appearance:'girl, dark skin',eye_color:'green eyes',attire:'coat'});
 const messages=await api.buildTaggerMessages({session_id:'char_parity',character_id:'char_parity',assistant_text:'한지수가 교실로 들어왔다.',card:{costume:true}});
 const text=JSON.stringify(messages);
 for(const term of ['김지수 · ','한지수 · ','Compare that name with the person in the story','exact supplied roster name'])assert.ok(text.includes(term),term);
 await api.callLlm(api.getConfig().llm,messages);
 assert.ok(JSON.stringify(host.llmRequests.at(-1).messages).includes('한지수 · '));
});

test('a malformed member prevents the entire batch from being saved; empty input never calls LLM',async()=>{
 const {api,host}=await runtime();
 for(const reply of [{new_characters:[hajin,{name:'EmptyLook'}]},{new_characters:[hajin,{}]},{scenes:[]},{new_characters:[]}]) {
  host.setLlmReply(JSON.stringify(reply));
  await assert.rejects(api.routeFetch('/v1/characters/create-from-description',{method:'POST',body}),/외형 정보|이름이 없는|new_characters/);
  assert.deepEqual(await api.listCharacters('char_parity'),[]);
 }
 const before=host.llmRequests.length;
 for(const instruction of ['', '  ', 'x'.repeat(20_001)]) await assert.rejects(api.routeFetch('/v1/characters/create-from-description',{method:'POST',body:{...body,instruction}}));
 assert.equal(host.llmRequests.length,before);
});

test('the settings-selected bot receives characters and references even if another chat is live',async()=>{
 const {api,host}=await runtime();
 const db=await globalThis.risuai.getDatabase();
 const selected=db.characters.findIndex(row=>row.chaId==='char_style');
 await globalThis.risuai.setCharacterToIndex(selected,{...db.characters[selected],globalLore:[{key:'민지',content:'SELECTED_BOT_REFERENCE'}]});
 host.setLlmReply(JSON.stringify({new_characters:[minji]}));
 const result=(await api.routeFetch('/v1/characters/create-from-description',{method:'POST',body:{...body,character_id:'char_style',session_id:'char_style',scope:'char_style'}})).data;
 assert.equal(result.added,1);
 assert.ok(JSON.stringify(host.llmRequests[0]).includes('SELECTED_BOT_REFERENCE'));
 assert.equal((await api.listCharacters('char_style'))[0].name,'민지');
 assert.deepEqual(await api.listCharacters('char_parity'),[]);
});
