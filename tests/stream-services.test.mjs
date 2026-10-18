import { png } from './fixtures/upscale-image.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {installHost,PNG_1X1,zipStore} from '../tools/parity/host.mjs';
import {analysisBody} from '../.test-build/message-body.mjs';
import {sessionIdHash} from '../.test-build/text-util.mjs';
let instance=0;
const sleep=()=>new Promise(r=>setTimeout(r,10));
const body='First narrative paragraph long enough for generating images.\nSecond dialogue in the scene.';
async function fixture() {
  const host=installHost({promptsDir:'prompts'});
  const api=await import(`../.test-build/stream-services.mjs?instance=${++instance}`);
  await api.openDb();await api.seedPrompts();
  const config=api.getConfig();
  Object.assign(config.card,{power:true,image_min:1,image_max:1,preprocessing:false,llm_reverse_bar:false,llm_tag_cal:false,lorebook:false,asset_nai_tags:'off',char_info:false,user_info:false,comic_gen:'off',nai5_first:false,nai5_only:false,include_max:0,inline_chat_text_side:'before'});
  config.llm={source:'custom',provider:'openai',endpoint:'https://api.openai.com/v1/chat/completions',model:'test',api_key:'test'};
  config.nai={...config.nai,api_key:'test',model:'nai-diffusion-4-5-full'};
  api.setConfig(config);
  host.setLlmReply(JSON.stringify({new_characters:[],scenes:[{place:'garden',shots:[{line:2,paragraph:0,characters:[],composition:'flowers'}]}]}));
  await risuai.setCharacterToIndex(0,{chaId:'c',name:'C',chats:[{id:'chat',isStreaming:true,message:[{role:'char',chatId:'m',data:'<Thoughts>\nSECRET [[imgstart]]\n</Thoughts>\n'+body+'\n[[imgstart]]\nSTATUS'}]}]});
  const request={session_id:'session',character_id:'c',chat_id:'chat',char_index:0,chat_index:0,host_message_id:'m',message_index:0,message_role:'char',stream_id:'s',defer_attachment:true,assistant_text:body,content_hash:'partial'};
  const chat=()=>risuai.getChatFromIndex(0,0);
  const wait=async(id,predicate)=>{for(let n=0;n<400;n++){const job=await api.getJob(id);if(predicate(job))return job;if(job.state==='error')throw Error(job.error);await sleep();}throw Error('job timeout');};
  const commit=async(id,extra={})=>api.commitStreamOutput({...request,job_id:id,assistant_text:(await chat()).message[0].data,content_hash:'final',...extra});
  return {api,host,request,chat,wait,commit};
}

async function assertRuntimeReleased(f, id) {
  for(let i=0;i<100 && f.api.jobRunMeta.has(id);i++) await sleep();
  assert.equal(f.api.jobRunMeta.has(id),false,'finished job must release its body and runtime metadata');
  assert.equal([...f.api.jobEpochByKey.values()].some(row=>row.jobId===id),false);
  assert.equal(f.api.jobLlmControllers.has(id),false);
  assert.equal(f.api.streamJob(id),undefined);
}

test('line batches cap paid images at their own limit despite a general five-image setting',async()=>{
  const f=await fixture();Object.assign(f.api.getConfig().card,{image_min:5,image_max:5,stream_lines_image_min:1,stream_lines_image_max:2,preprocessing:true});
  f.host.setLlmReply(JSON.stringify({new_characters:[],scenes:[{shots:Array.from({length:5},()=>({line:2,composition:'scene'}))}]}));
  const created=await f.api.createJob({...f.request,stream_line_start:1,stream_line_end:2});
  const waiting=await f.wait(created.job_id,j=>j.progress.phase==='waiting_output');
  assert.equal(waiting.progress.shot_count,2);assert.equal(f.host.naiRequests.filter(r=>r.kind==='generate').length,2);
  const prompt=f.host.llmRequests.at(-1).messages.map(m=>m.content).join('\n');
  assert.match(prompt,/between 1 and 2 shots/);assert.doesNotMatch(prompt,/exactly 5 shot/);
  await f.commit(created.job_id);await assertRuntimeReleased(f,created.job_id);
  assert.equal(f.api.getConfig().card.image_max,5);
  const normal=await f.api.createJob({...f.request,content_hash:'normal-after-batch'});
  await f.wait(normal.job_id,j=>j.progress.phase==='waiting_output');
  assert.equal(f.host.naiRequests.filter(r=>r.kind==='generate').length,7,'keyword generation still uses the general five-image count');
  await f.commit(normal.job_id);await assertRuntimeReleased(f,normal.job_id);
});

test('streaming tags: each block is its own tagger-free slot at its position; a broken one asks the tagger for that slot only',async()=>{
  const f=await fixture();Object.assign(f.api.getConfig().card,{stream_inline_tags:true,image_min:3,image_max:3,preprocessing:true,lorebook:true});
  const first='First narrative paragraph long enough for generating images.';
  const block=(n,aspect)=>`[[inx${n}]]{"place":"garden, outdoor","aspect":"${aspect}","characters":[]}[[/inx${n}]]`;
  const reply=`${first}\n${block(1,'portrait')}\n${block(2,'landscape')}\nSecond dialogue in the scene.\n[[inx3]]{"place":"broken"[[/inx3]]\nLast line.`;
  await risuai.setCharacterToIndex(0,{chaId:'c',name:'C',chats:[{id:'chat',isStreaming:true,message:[{role:'char',chatId:'m',data:reply}]}]});
  const tagged=aspect=>({new_characters:[],scenes:[{place:'garden, outdoor',shots:[{aspect,characters:[],line:1,paragraph:0}]}]});
  const job=extra=>f.api.createJob({...f.request,assistant_text:first,stream_line_start:1,stream_line_end:1,...extra});
  const a=await job({inline_block:1,inline_tagged:tagged('portrait')}),b=await job({inline_block:2,inline_tagged:tagged('landscape')});
  assert.equal(a.accepted,true);assert.equal(b.accepted,true,'two blocks after the same line are two slots, not one busy range');
  for(const id of [a.job_id,b.job_id])await f.wait(id,j=>j.progress.phase==='waiting_output');
  assert.equal(f.host.llmRequests.length,0,'no tagger, preprocess or lorebook filter: the chat model already wrote the shot');
  assert.equal(f.host.naiRequests.filter(r=>r.kind==='generate').length,2);
  f.host.setLlmReply(JSON.stringify({new_characters:[],scenes:[{place:'garden',shots:[{line:2,composition:'flowers'}]}]}));
  const c=await f.api.createJob({...f.request,assistant_text:first+'\nSecond dialogue in the scene.',stream_line_start:2,stream_line_end:2,inline_block:3});
  await f.wait(c.job_id,j=>j.progress.phase==='waiting_output');
  const asked=f.host.llmRequests.map(r=>r.messages.map(m=>m.content).join('\n')).join('\n');
  assert.match(asked,/ONLY from L2 through L2/);assert.match(asked,/Produce 1 to 1 shots/,'the broken block gets exactly its one slot');
  await f.commit(a.job_id,{job_ids:[a.job_id,b.job_id,c.job_id]});
  for(const id of [a.job_id,b.job_id,c.job_id])await f.wait(id,j=>j.state==='done');
  const saved=(await f.chat()).message[0].data;
  assert.doesNotMatch(saved,/\[\[\/?inx/,'no block survives in the saved reply');
  const slot='\\[\\[@inray::[^\\]]+\\]\\]';
  assert.match(saved,new RegExp(`^${first}\\n${slot}\\n${slot}\\nSecond dialogue in the scene\\.\\n${slot}\\nLast line\\.$`),'each image sits exactly where its block was');
  assert.doesNotMatch(saved,/inrayspinner/,'no block ever becomes a purple spinner');
  for(const id of [a.job_id,b.job_id,c.job_id])await assertRuntimeReleased(f,id);
});

test('streaming blocks of one reply carry wear_state on: a block that leaves it out keeps the earlier block\'s, and the note gets the last once',{timeout:15000},async()=>{
  const f=await fixture();Object.assign(f.api.getConfig().card,{stream_inline_tags:true,image_min:3,image_max:3});
  await f.api.upsertCharacter('c',{name:'세라',aliases:['Sera'],gender:'girl',appearance:'1girl, red hair',attire:'office suit',bottoms:'pencil skirt'});
  const first='First narrative paragraph long enough for generating images.';
  const shot=character=>({new_characters:[],scenes:[{place:'office, indoor',shots:[{aspect:'portrait',characters:[{name:'세라',action:'standing',...character}],line:1,paragraph:0}]}]});
  // The alias in block 2: the same person, so the same running state.
  const blocks=[shot({wear_state:'nude'}),shot({name:'Sera'}),shot({wear_state:'topless'}),shot({})];
  const ids=[];
  for(const [i,tagged] of blocks.entries())ids.push((await f.api.createJob({...f.request,assistant_text:first,stream_line_start:1,stream_line_end:1,inline_block:i+1,inline_tagged:tagged})).job_id);
  for(const id of ids)await f.wait(id,j=>j.progress.phase==='waiting_output');
  const captions=f.host.naiRequests.filter(r=>r.kind==='generate').map(r=>JSON.stringify(r.body.parameters?.v4_prompt?.caption?.char_captions ?? r.body));
  assert.equal(captions.length,4);
  // nude shows the whole body (pussy), topless only the chest; clothed shows neither.
  const nude=/pussy/, chest=/nipples/;
  assert.match(captions[0],nude,'block 1 states nude');
  assert.match(captions[1],nude,'block 2 says nothing: still nude, not back in the suit');
  assert.match(captions[2],chest);assert.doesNotMatch(captions[2],nude,'block 3 states topless');
  assert.match(captions[3],chest);assert.doesNotMatch(captions[3],nude,'block 4 keeps block 3, not block 1');
  const note=async()=>JSON.parse((await f.chat()).localLore?.find(e=>e.comment==='omni.nexus.note')?.content ?? '{"note":{}}').note;
  assert.equal((await note()).wear,undefined,'nothing written to the chat while the reply streams');
  await f.commit(ids[0],{job_ids:ids});
  for(const id of ids)await f.wait(id,j=>j.state==='done');
  const wear=Object.values((await note()).wear ?? {});
  assert.deepEqual(wear.map(row=>[row.name,row.wear]),[['세라','topless']],'the reply\'s last stated state, once the reply is done');
});

test('a pink slot tapped later follows its own message\'s earlier block, not the chat\'s state now',{timeout:15000},async()=>{
  const f=await fixture();Object.assign(f.api.getConfig().card,{stream_inline_tags:true,stream_inline_autogen:false,llm_json_retry:false});
  const first='First narrative paragraph long enough for generating images.';
  const block=(n,extra)=>`[[inx${n}]]{"place":"office, indoor","aspect":"portrait","characters":[{"name":"세라","action":"standing"${extra}}]}[[/inx${n}]]`;
  const reply=`${first}\n${block(1,',"wear_state":"nude"')}\nSecond dialogue in the scene.\n${block(2,'')}\nLast line.`;
  await risuai.setCharacterToIndex(0,{chaId:'c',name:'C',chats:[{id:'chat',message:[{role:'char',chatId:'m',data:reply}]}]});
  // After the chat is in place: the roster lives in the character.
  await f.api.upsertCharacter('c',{name:'세라',gender:'girl',appearance:'1girl, red hair',attire:'office suit',bottoms:'pencil skirt'});
  const tapped=await f.api.generateInlineWait({character_id:'c',chat_id:'chat',char_index:0,chat_index:0,host_message_id:'m',message_index:0,session_id:'session',wait_id:'b2'});
  assert.equal(tapped.accepted,true);
  await f.wait(tapped.job_id,j=>j.state==='done'||j.state==='error');
  const caption=JSON.stringify(f.host.naiRequests.filter(r=>r.kind==='generate').at(-1)?.body.parameters?.v4_prompt?.caption?.char_captions);
  assert.match(caption,/pussy/,'block 1 left her nude; block 2 says nothing, so it stays nude');
});

test('streaming tags bake by message id: an edited reply or a shifted index still bakes, and a lost slot holds back only itself',{timeout:15000},async()=>{
  const f=await fixture();Object.assign(f.api.getConfig().card,{stream_inline_tags:true});
  const lines=['First narrative paragraph long enough for generating images.','Second dialogue in the scene.','Third line of the reply here.','Fourth line closes it.'];
  const block=n=>`[[inx${n}]]{"place":"garden, outdoor","aspect":"portrait","characters":[]}[[/inx${n}]]`;
  const reply=lines.map((line,i)=>`${line}\n${block(i+1)}`).join('\n');
  await risuai.setCharacterToIndex(0,{chaId:'c',name:'C',chats:[{id:'chat',isStreaming:true,message:[{role:'char',chatId:'m',data:reply}]}]});
  const tagged=line=>({new_characters:[],scenes:[{place:'garden, outdoor',shots:[{aspect:'portrait',characters:[],line,paragraph:0}]}]});
  const job=n=>f.api.createJob({...f.request,assistant_text:lines.slice(0,n).join('\n'),stream_line_start:n,stream_line_end:n,inline_block:n,inline_tagged:tagged(n)});
  const ids=[];
  for(const n of [1,2]){const r=await job(n);ids.push(r.job_id);await f.wait(r.job_id,j=>j.progress.phase==='waiting_output');}
  const gate=f.host.pauseGeneration();
  for(const n of [3,4]){const r=await job(n);assert.equal(r.accepted,true);ids.push(r.job_id);}
  await gate.started;
  // After the reply: its text was edited and a message appeared before it. Neither moves a block.
  const chat=await f.chat();chat.isStreaming=false;
  chat.message[0].data=chat.message[0].data.replace('Second dialogue','Second (edited) dialogue');
  chat.message.unshift({role:'user',chatId:'u',data:'hello'});await risuai.setChatToIndex(0,0,chat);
  const result=await f.api.commitStreamOutput({...f.request,job_id:ids[0],job_ids:ids,assistant_text:reply,content_hash:'final',message_index:0});
  assert.equal(result.ok,true,'the reply text is not compared, and the message is found by its id');
  const images=t=>(t.match(/\[\[@inray::[^\]]+\]\]/g) || []).length;
  let saved=(await f.chat()).message[1].data;
  assert.equal(images(saved),2,'images finished before the reply ended bake in the first write');
  assert.match(saved,new RegExp(`^${lines[0]}\\n\\[\\[@inray::[^\\]]+\\]\\]\\nSecond \\(edited\\)`),'each in place of its own block');
  assert.ok(saved.includes(block(3)) && saved.includes(block(4)),'the two still drawing stay their blocks: the pink slot, their previews painted over it');
  assert.doesNotMatch(saved,/inrayspinner/,'no block becomes a purple spinner');
  // A slot that is gone before the last write (the user deleted it) leaves only its own image out.
  const now=await f.chat();now.message[1].data=now.message[1].data.replace(block(3),'');
  await risuai.setChatToIndex(0,0,now);
  gate.release();
  for(const id of ids)await f.wait(id,j=>j.state==='done');
  saved=(await f.chat()).message[1].data;
  assert.equal(images(saved),3,'the image without a place is left out alone');
  assert.match(saved,new RegExp(`Fourth line closes it.\\n\\[\\[@inray::`),'the last one where its block was');
  assert.doesNotMatch(saved,/\[\[\/?inx/);assert.match(saved,/Second \(edited\) dialogue/);
  assert.equal((await f.chat()).message[0].data,'hello');
  assert.equal((await f.api.getJob(ids[3])).progress.line_group.unplaced,1,'the toast can say one image had no place');
});

test('a streaming-tag write that crosses another save reads again and keeps both',async()=>{
  const f=await fixture(),get=risuai.getChatFromIndex;let cross=true;
  risuai.getChatFromIndex=async(...args)=>{
    const chat=await get(...args);
    if(cross){cross=false;const other=await get(...args);other.message[0].data+='\nOTHER';await risuai.setChatToIndex(args[0],args[1],other);}
    return chat;
  };
  try {assert.equal(await f.api.rewriteMessageById({charIndex:0,chatIndex:0,messageIndex:5,hostMessageId:'m'},body=>body.replace('First','FIRST')),true);}
  finally {risuai.getChatFromIndex=get;}
  const body=(await f.chat()).message[0].data;
  assert.match(body,/FIRST/);assert.match(body,/OTHER$/,'the other save is kept, not overwritten');
});

test('streaming tag rules reach only the chat model: after the first message, once, never on our own tagger calls',async()=>{
  const f=await fixture();const card=f.api.getConfig().card;
  let replacer;risuai.addRisuReplacer=async(type,fn)=>{if(type==='beforeRequest')replacer=fn;};
  await f.api.installInlineTags();
  const chat=[{role:'system',content:'main prompt'},{role:'user',content:'hi'},{role:'assistant',content:'hello'},{role:'user',content:'go'}];
  assert.equal(await replacer(chat,'model'),chat,'switched off: the request is untouched');
  card.stream_inline_tags=true;
  const rules=await f.api.inlineTagRules();
  assert.ok(rules.startsWith(f.api.INLINE_RULES_MARK));assert.match(rules,/\[\[inx1\]\]\{\.\.\.\}\[\[\/inx1\]\]/);assert.match(rules,/between 1 and 1 blocks|exactly 1 blocks/);
  assert.match(rules,/Always close every block with its own closing tag[^\n]*\[\[\/inxN\]\] is discarded/,'models drop [[/inxN]] now and then: the rules insist on it');
  assert.doesNotMatch(rules,/Matched Lorebook|Characters in this message" packs|LINE: `line` is the matching/,'no lore or reference-pack how-to: Risu already sends lore and descriptions');
  assert.equal(await f.api.inlineTagRules(),rules,'same settings, same text: the cached prefix holds');
  const sent=await replacer(chat,'model');
  const state=m=>String(m.content).startsWith(f.api.INLINE_STATE_MARK);
  assert.deepEqual(sent.map(m=>m.content===rules?'RULES':state(m)?'STATE':m.content),['main prompt','RULES','hi','hello','STATE','go'],'the open chat\'s state too, from the first request (it once never got there)');
  assert.equal((await replacer(sent,'model')).length,sent.length,'a retry or fallback model gets the rules once');
  assert.equal(await replacer(chat,'submodel'),chat,'memory, translation and other model calls are not replies');
  const own=[{role:'system',content:'# Image tagging\nTurn ONE labeled chat message into tags.'},{role:'user',content:'L1| text'}];
  const release=f.api.markOwnLlmRequest(own);
  assert.equal(await replacer(own,'model'),own,'our tagger borrowing the main model is left alone');
  release();assert.notEqual(await replacer(own,'model'),own);
  assert.deepEqual(f.api.placeInlineTagPrompts(chat,rules,'# state').map(m=>m.content===rules?'RULES':m.content),['main prompt','RULES','hi','hello','# state','go'],'the chat state goes last, before the newest user turn');
});

test('the request hook notes which of our lorebook instructions reached the chat model, switch on or off',async()=>{
  const f=await fixture();f.api.getConfig().card.stream_inline_tags=false;
  let replacer;risuai.addRisuReplacer=async(type,fn)=>{if(type==='beforeRequest')replacer=fn;};
  await f.api.installInlineTags();const cues=()=>globalThis.__OMNI_INLINE_TAGS__.cues();
  assert.equal(cues(),null,'nothing seen yet');
  await replacer([{role:'system',content:'main'},{role:'system',content:'<OmniTTS>\nx\n</OmniTTS>\n<OmniBGM>\ny\n</OmniBGM>'},{role:'user',content:'go'}],'model');
  assert.deepEqual({...cues(),at:0},{at:0,tts:true,bgm:true,sfx:false},'the effect instruction was cut: the settings can say so');
  await replacer([{role:'system',content:[{type:'text',text:'<OmniSFX>\nz\n</OmniSFX>'}]},{role:'user',content:'go'}],'model');
  assert.equal(cues().sfx,true,'array content counts too');
  await replacer([{role:'user',content:'translate'}],'submodel');
  assert.equal(cues().sfx,true,'other model calls are not the chat reply');
});

test('a chat request that comes before the settings load waits for them, instead of reading the switch as off',async()=>{
  const f=await fixture();
  let replacer;risuai.addRisuReplacer=async(type,fn)=>{if(type==='beforeRequest')replacer=fn;};
  let loads=0;
  // Stands in for the bridge's lazy boot: only after it does the saved switch exist.
  await f.api.installInlineTags({ready:async()=>{loads++;const c=f.api.getConfig();c.card.stream_inline_tags=true;f.api.setConfig(c);}});
  const chat=[{role:'system',content:'main prompt'},{role:'user',content:'go'}];
  const sent=await replacer(chat,'model');
  assert.equal(loads,1);assert.equal(sent.length,4,'the rules and the chat state went out on the first request');
  assert.equal(f.api.inlineTagStatus().last.startsWith('inserted'),true);
});

test('the chat model gets this chat\'s people, most recently named first, with their costumes; the order is kept in the note once a reply is done',async()=>{
  const f=await fixture();Object.assign(f.api.getConfig().card,{stream_inline_tags:true,costume:true});
  let replacer;risuai.addRisuReplacer=async(type,fn)=>{if(type==='beforeRequest')replacer=fn;};
  await f.api.installInlineTags();
  const sid='risu_'+sessionIdHash('c|chat');
  const names=['하나','민아','민지','채원','예원','해린',...Array.from({length:20},(_,i)=>'단역'+String.fromCharCode(0xAC00+i*28))];
  for(const name of names)await f.api.upsertCharacter('c',{name,appearance:'1girl, blue hair',attire:'school uniform'});
  const hana=(await f.api.loadTaggerRoster({sessionId:sid,unifiedSessionId:sid,characterId:'c'})).find(c=>c.name==='하나');
  await f.api.upsertCharacter('c',{id:hana.id,name:'하나',costumes:[...hana.costumes,{name:'swim',note:'수영복',attire:'swimsuit'}]});
  const say=async(...replies)=>{
    const message=replies.flatMap((data,i)=>[{role:'user',chatId:'u'+i,data:'계속'},{role:'char',chatId:'r'+i,data}]);
    const character=await risuai.getCharacterFromIndex(0);await risuai.setCharacterToIndex(0,{...character,chats:[{...character.chats[0],message}]});
    const sent=await replacer([{role:'system',content:'main'},{role:'user',content:'go'}],'model');
    const state=sent.find(m=>String(m.content).startsWith(f.api.INLINE_STATE_MARK))?.content ?? '';
    return {state,order:[...state.matchAll(/^- (\S+)/gm)].map(m=>m[1])};
  };
  const note=async()=>JSON.parse((await f.chat()).localLore?.find(e=>e.comment==='omni.nexus.note')?.content ?? '{"note":{}}').note;
  // Older replies are not read: only the last two.
  let {state,order}=await say('예원이 노래했다.','하나가 민아를 불렀다.','조용한 밤이었다.');
  assert.deepEqual(order.slice(0,2),['하나','민아'],'named in the last two replies: first');
  assert.notEqual(order[2],'예원','예원, three replies back, is not read');
  assert.equal(order.length,20,'twenty at most');
  assert.ok(!order.includes(names.at(-1)),'the rest wait their turn');
  assert.match(state,/- 하나 — looks saved \| costumes: default\[0\][^;]*; swim\[1\] 수영복 \| wearing default\[0\] \| wear_state=clothed/,'each person: costumes by name and note, what they wear now');
  assert.doesNotMatch(state,/blue hair|school uniform/,'saved looks stay with the generator');
  assert.equal((await note()).recent_cast,undefined,'nothing written while the reply could still be streaming');
  // Later: 민지 and 채원 in the last two; 하나 and 민아 stay right behind them without being read again.
  ({order}=await say('민지와 채원이 들어왔다.','채원이 웃었다.'));
  assert.deepEqual(order.slice(0,4),['채원','민지','하나','민아'],'the newest reply first, then the remembered order');
  await f.api.persistSessionLocation(sid,'');
  const kept=(await note()).recent_cast;
  assert.equal(kept.length,names.length);
  const roster=await f.api.loadTaggerRoster({sessionId:sid,unifiedSessionId:sid,characterId:'c'});
  assert.deepEqual(kept.slice(0,4).map(id=>roster.find(c=>c.id===id)?.name),['채원','민지','하나','민아'],'saved in this chat\'s note once a reply is done');
  assert.equal(f.api.inlineTagStatus().last.startsWith('inserted'),true);
});

test('⚛️ omni 스트리밍태그 draws blocks as slots, never hides the story after an unclosed one, and keeps them out of requests',async()=>{
  const f=await fixture();
  await risuai.setDatabase({modules:[],enabledModules:[]});
  assert.equal(await f.api.ensureInlineTagModule(false),true);assert.equal((await risuai.getDatabase()).modules.length,0,'never used: nothing installed');
  await f.api.ensureInlineTagModule(true);
  let db=await risuai.getDatabase();const module=db.modules.find(m=>m.id==='omni-inline-tags');
  assert.equal(module.name,'⚛️ omni 스트리밍태그');assert.ok(db.enabledModules.includes('omni-inline-tags'));assert.deepEqual(module.lorebook,[],'rules go by beforeRequest: a lorebook entry this size would be cut by the 800-token budget');
  const display=text=>{for(const r of module.regex.filter(r=>r.type==='editdisplay').sort((a,b)=>Number(/order (-?\d+)/.exec(b.flag)[1])-Number(/order (-?\d+)/.exec(a.flag)[1])))text=text.replace(new RegExp(r.in,r.flag.replace(/<[^>]*>/g,'')),r.out);return text;};
  const wide=display('앞\n[[inx2]]{"aspect":"landscape","characters":[]}[[/inx2]]\n뒤');
  assert.match(wide,/data-inx-slot="2"/);assert.match(wide,/viewBox="0 0 1216 832"/);assert.doesNotMatch(wide,/inx2\]\]|"aspect"/);
  assert.match(display('[[inx1]]{"characters":[]}[[/inx1]]'),/viewBox="0 0 832 1216"/,'portrait unless the block says otherwise');
  // An unclosed block once hid everything after it to the end of the message: a forgotten [[/inxN]] took the story off the screen.
  assert.equal(display('본문\n[[inx3]]{"place":"room"}\n뒤 이야기가 이어진다.'),'본문\n[[inx3]]{"place":"room"}\n뒤 이야기가 이어진다.','an unclosed block hides nothing after it');
  assert.ok(!module.regex.some(r=>r.comment==='omni-inline-shot-display-open'),'the hide-to-the-end rule is gone');
  assert.equal(display('<Thoughts>\n생각 [[inx1]]{"characters":[]}[[/inx1]]\n</Thoughts>\n본문'),'<Thoughts>\n생각 \n</Thoughts>\n본문','a draft in the thoughts is never drawn');
  assert.equal(display('<think>생각 중 [[inx1]]{"characters":[]}[[/inx1]] 더'),'<think>생각 중  더','nor while the thoughts are still streaming');
  assert.match(display('<Thoughts>a</Thoughts>\n본문\n[[inx1]]{"characters":[]}[[/inx1]]'),/data-inx-slot="1"/,'a story block after the thoughts is a slot');
  assert.match(display('본문 [[inx3]]{"place":"x"}[[/inx4]] 뒤'),/뒤/,'a misnumbered block never hides the story after it');
  const request=module.regex.find(r=>r.type==='editprocess');
  assert.equal('앞\n[[inx1]]{"a":1}[[/inx1]]\n뒤'.replace(new RegExp(request.in,request.flag),request.out),'앞\n뒤');
  await f.api.ensureInlineTagModule(false);db=await risuai.getDatabase();
  assert.ok(!db.enabledModules.includes('omni-inline-tags'));assert.ok(db.modules.some(m=>m.id==='omni-inline-tags'),'off keeps it installed, disabled');
});

test('이미지 바로 생성 off: blocks stay as written and are the pink slots; a double-tapped one draws there, a failed one waits again; never while streaming or already drawing',async()=>{
  const f=await fixture();Object.assign(f.api.getConfig().card,{stream_inline_tags:true,stream_inline_autogen:false,llm_json_retry:false});
  const first='First narrative paragraph long enough for generating images.';
  const shot='{"place":"garden","aspect":"landscape","characters":[]}',broken='{"place":"bro';
  const reply=`${first}\n[[inx1]]${shot}[[/inx1]]\nSecond dialogue in the scene.\n[[inx2]]${broken}[[/inx2]]\nLast line.`;
  await risuai.setCharacterToIndex(0,{chaId:'c',name:'C',chats:[{id:'chat',message:[{role:'char',chatId:'m',data:reply}]}]});
  const target={character_id:'c',chat_id:'chat',char_index:0,chat_index:0,host_message_id:'m',message_index:0};
  const tagged={new_characters:[],scenes:[{place:'garden',shots:[{aspect:'landscape',characters:[],line:1,paragraph:0}]}]};
  // The reply's end renames nothing any more (that write could land late or not at all in Risu).
  const parked=await f.api.parkInlineShots({...target,assistant_text:reply+' changed',blocks:[{n:1,line:1,tagged},{n:2,line:2,tagged:null}]});
  assert.equal(parked.ok,true);assert.deepEqual(parked.wait_ids,['b1','b2']);
  let saved=(await f.chat()).message[0].data;
  assert.equal(saved,reply,'nothing is written: each block, as the model wrote it, is the slot');
  assert.equal(await f.api.inlineWaitCount(),0,'nothing goes to plugin storage');
  assert.equal(f.host.naiRequests.length,0);assert.equal(f.host.llmRequests.length,0,'parking costs nothing');
  await f.api.ensureInlineTagModule(true,100,true);
  const display=(await risuai.getDatabase()).modules.find(m=>m.id==='omni-inline-tags').regex;
  const order=r=>Number(/<order (-?\d+)/.exec(r.flag)?.[1]??0);
  const draw=text=>{for(const r of display.filter(r=>r.type==='editdisplay'&&/^omni-inline-shot-display/.test(r.comment)).sort((a,b)=>order(b)-order(a)))text=text.replace(new RegExp(r.in,r.flag.replace(/<[^>]*>/g,'')),r.out);return text;};
  assert.match(draw(saved),/data-inray-wait="b1" data-inx-slot="1"[^]*viewBox="0 0 1216 832"/,'drawn as the pink waiting frame, double-tappable as b1, sized by its aspect');
  assert.match(draw(saved),/data-inray-wait="b2" data-inx-slot="2"[^]*viewBox="0 0 832 1216"/);
  assert.match(draw(saved),/stroke="#ec4899"/);assert.doesNotMatch(draw(saved),/inx\d\]\]|"place"/,'no JSON shows');
  const request=display.find(r=>r.comment==='omni-inline-shot-request');
  assert.equal(saved.replace(new RegExp(request.in,request.flag),request.out),`${first}\nSecond dialogue in the scene.\nLast line.`,'and no request carries it');
  const tap=async id=>f.api.generateInlineWait({...target,session_id:'session',wait_id:id});
  // Never while the reply is still being written, nor while this block's own streaming job draws it.
  const live=await risuai.getChatFromIndex(0,0);await risuai.setChatToIndex(0,0,{...live,isStreaming:true});
  assert.equal((await tap('b1')).error?.code,'busy','not during streaming');
  await risuai.setChatToIndex(0,0,{...live,isStreaming:false});
  f.api.registerStreamJob('drawing',{defer_attachment:true,stream_id:'s2',host_message_id:'m',inline_block:1,character_id:'c',chat_id:'chat',session_id:'session',stream_line_start:1,stream_line_end:1});
  assert.equal((await tap('b1')).error?.code,'busy','not while its streaming job runs');
  f.api.closeStreamJob('drawing');
  assert.equal(f.host.naiRequests.length,0,'refused taps spend nothing');
  // The bake write holds scroll on the tapped slot itself.
  f.api.getConfig().card.scroll_hold=true;const holds=[];
  globalThis.__INLAY_SCROLL_HOLD__=async(work,options)=>{holds.push(options);await work();};
  const job=await tap('b1');assert.equal(job.accepted,true);
  await f.wait(job.job_id,j=>j.state==='done');
  delete globalThis.__INLAY_SCROLL_HOLD__;
  const held=holds.find(o=>o?.slot);
  assert.ok(held,'the tapped slot is the scroll anchor');
  assert.equal(held.slot.waitId,'b1');assert.equal(held.slot.index,0);assert.match(held.slot.cardId,/^[a-zA-Z0-9_-]+$/);
  saved=(await f.chat()).message[0].data;
  assert.match(saved,new RegExp(`^${first}\\n\\[\\[@inray::[^\\]]+\\]\\]\\nSecond dialogue`),'the image sits where the block was, in one write: no spinner was ever written');
  assert.doesNotMatch(saved,/inrayspinner/);
  assert.ok(saved.includes(`[[inx2]]${broken}[[/inx2]]`),'the other block is untouched');
  assert.equal(f.host.llmRequests.length,0,'the block\'s own JSON is the shot: no tagger');
  assert.equal((await tap('b1')).ok,false,'a block already drawn cannot be generated twice');
  // A broken block: fixed first, then the tagger; both failing gives the block back as it was.
  f.host.setLlmReply('not json');
  const retry=await tap('b2');await f.wait(retry.job_id,j=>j.state==='error');
  for(let i=0;i<100 && !(await f.chat()).message[0].data.includes('[[inx2]]');i++)await sleep();
  saved=(await f.chat()).message[0].data;
  assert.ok(saved.includes(`[[inx2]]${broken}[[/inx2]]`),'a failed block waits again, its JSON exactly as written');
  assert.doesNotMatch(saved,new RegExp(`inrayspinner::${retry.job_id}`));
  const asked=f.host.llmRequests.map(r=>r.messages.map(m=>m.content).join('\n')).join('\n');
  assert.match(asked,/broken_block/,'the broken JSON is sent to be fixed');assert.match(asked,/ONLY from L2 through L2/,'then the tagger draws its own line');
  // Generation fails: the block was never written while it was drawn, so nothing changes.
  f.host.setLlmReply(JSON.stringify({new_characters:[],scenes:[{place:'garden',shots:[{line:2,composition:'flowers'}]}]}));
  const nativeFetch=risuai.nativeFetch;
  risuai.nativeFetch=async(url,opts)=>String(url).includes('generate-image')?new Response('down',{status:500}):nativeFetch(url,opts);
  try {
    const untouched=(await f.chat()).message[0].data;
    const failed=await tap('b2');await f.wait(failed.job_id,j=>j.state==='error');
    for(let i=0;i<200 && (await f.chat()).message[0].data.includes(`inrayspinner::${failed.job_id}`);i++)await sleep();
    saved=(await f.chat()).message[0].data;
    assert.ok(saved.includes(`[[inx2]]${broken}[[/inx2]]`),'the block waits again after a failed generation');
    assert.equal(saved,untouched,'a failed run writes nothing at all');
    assert.doesNotMatch(saved,new RegExp(`inrayspinner::${failed.job_id}`));
  } finally {risuai.nativeFetch=nativeFetch;}
});

test('an older stored waiting slot ([[@inraywait]]) still generates from its saved shot',async()=>{
  const f=await fixture();Object.assign(f.api.getConfig().card,{stream_inline_tags:true,stream_inline_autogen:false});
  const first='First narrative paragraph long enough for generating images.';
  await risuai.setCharacterToIndex(0,{chaId:'c',name:'C',chats:[{id:'chat',message:[{role:'char',chatId:'m',data:`${first}\n[[@inraywait::wold1::832::1216]]\nLast line.`}]}]});
  await f.api.putInlineWaits([{id:'wold1',tagged:{new_characters:[],scenes:[{place:'hall',shots:[{characters:[],line:1,paragraph:0}]}]},line:1,characterId:'c',chatId:'chat',hostMessageId:'m',createdAt:1}]);
  const job=await f.api.generateInlineWait({character_id:'c',chat_id:'chat',char_index:0,chat_index:0,host_message_id:'m',message_index:0,session_id:'session',wait_id:'wold1'});
  assert.equal(job.accepted,true);await f.wait(job.job_id,j=>j.state==='done');
  assert.match((await f.chat()).message[0].data,new RegExp(`^${first}\\n\\[\\[@inray::`),'the image replaces the old slot token');
  assert.equal(f.host.llmRequests.length,0);assert.equal(await f.api.getInlineWait('wold1'),undefined);
});

test('a broken block is fixed from its own JSON with the shape; one that ends without an image stays in place as its block with its JSON',{timeout:15000},async()=>{
  const f=await fixture();Object.assign(f.api.getConfig().card,{stream_inline_tags:true,llm_json_retry:false});
  const lines=['First narrative paragraph long enough for generating images.','Second dialogue in the scene.','Third line of the reply here.'];
  const brokenA='{"place":"garden","aspect":"portrait","characters":[{"name":"A","action":"waving"}',brokenC='{"place":"roof" "characters":[{"name":"C"}]}';
  const good='{"place":"hall","aspect":"portrait","characters":[]}';
  const reply=`${lines[0]}\n[[inx1]]${brokenA}[[/inx1]]\n${lines[1]}\n[[inx2]]${good}[[/inx2]]\n${lines[2]}\n[[inx3]]${brokenC}[[/inx3]]\nLast line.`;
  await risuai.setCharacterToIndex(0,{chaId:'c',name:'C',chats:[{id:'chat',isStreaming:true,message:[{role:'char',chatId:'m',data:reply}]}]});
  const job=(n,extra)=>f.api.createJob({...f.request,assistant_text:lines.slice(0,n).join('\n'),stream_line_start:n,stream_line_end:n,inline_block:n,...extra});
  const asked=from=>f.host.llmRequests.slice(from).map(r=>r.messages.map(m=>m.content).join('\n')).join('\n');
  f.host.setLlmReply('{"place":"garden","aspect":"portrait","characters":[{"name":"A","action":"waving"}]}');
  const a=await job(1,{inline_raw:brokenA,inline_body:brokenA});
  await f.wait(a.job_id,j=>j.progress.phase==='waiting_output');
  assert.equal(f.host.llmRequests.length,1,'one short request, no tagger');
  assert.match(asked(0),/broken_block/);assert.match(asked(0),/"characters":\[\{"name":"하린"/,'the model is shown the shape we want');
  assert.doesNotMatch(asked(0),/ONLY from L/,'the scene is never re-tagged from the reply');
  assert.equal(f.host.naiRequests.filter(r=>r.kind==='generate').length,1,'the fixed shot is drawn');
  f.host.setLlmReply('still not json');
  const c=await job(3,{inline_raw:brokenC,inline_body:brokenC});
  await f.wait(c.job_id,j=>j.progress.phase==='waiting_output');
  assert.equal(f.host.naiRequests.filter(r=>r.kind==='generate').length,1,'an unfixable block spends nothing');
  const nativeFetch=risuai.nativeFetch;
  risuai.nativeFetch=async(url,opts)=>String(url).includes('generate-image')?new Response('down',{status:500}):nativeFetch(url,opts);
  let saved;
  try {
    const b=await job(2,{inline_body:good,inline_tagged:{new_characters:[],scenes:[{place:'hall',shots:[{aspect:'portrait',characters:[],line:2,paragraph:0}]}]}});
    await f.commit(a.job_id,{job_ids:[a.job_id,b.job_id,c.job_id]});
    for(const id of [a.job_id,b.job_id,c.job_id])await f.wait(id,j=>j.state==='done' || j.state==='error');
    // Done: one image, no spinner left without one, block 1 gone, blocks 2 and 3 back.
    const settled=t=>/\[\[@inray::/.test(t) && !/\[\[@inrayspinner::[^\]]+\]\](?!\[\[@inray::)/.test(t) && !t.includes('[[inx1]]') && t.includes('[[inx2]]') && t.includes('[[inx3]]');
    for(let i=0;i<200 && !settled(saved=(await f.chat()).message[0].data);i++)await sleep();
  } finally {risuai.nativeFetch=nativeFetch;}
  assert.equal(saved,`${lines[0]}\n${saved.match(/\[\[@inray::[^\]]+\]\]/)[0]}\n${lines[1]}\n[[inx2]]${good}[[/inx2]]\n${lines[2]}\n[[inx3]]${brokenC}[[/inx3]]\nLast line.`,
    'the fixed block has its image; the failed one and the unfixable one stay in their places as the blocks the model wrote');
  assert.equal(await f.api.inlineWaitCount(),0,'nothing goes to plugin storage');
  // The reply is over: a double tap fixes the unfixable one again first, reading it from the message.
  const ended=await risuai.getChatFromIndex(0,0);await risuai.setChatToIndex(0,0,{...ended,isStreaming:false});
  const before=f.host.llmRequests.length;
  f.host.setLlmReply('{"place":"roof","characters":[{"name":"C"}]}');
  const tap=await f.api.generateInlineWait({character_id:'c',chat_id:'chat',char_index:0,chat_index:0,host_message_id:'m',message_index:0,session_id:'session',wait_id:'b3'});
  assert.equal(tap.accepted,true);await f.wait(tap.job_id,j=>j.state==='done');
  assert.equal(f.host.llmRequests.length,before+1);assert.match(asked(before),/broken_block/);assert.doesNotMatch(asked(before),/ONLY from L/);
  saved=(await f.chat()).message[0].data;
  assert.match(saved,new RegExp(`${lines[2]}\\n\\[\\[@inray::[^\\]]+\\]\\]\\nLast line\\.$`));
  assert.ok(saved.includes(`[[inx2]]${good}[[/inx2]]`),'the other waiting block is untouched');
});

test('zero-shot line batches wait for output without NAI, spinners, errors or JSON retries',async()=>{
  const f=await fixture();Object.assign(f.api.getConfig().card,{image_min:5,image_max:5,stream_lines_image_min:0,stream_lines_image_max:1,llm_json_retry:true,preprocessing:true});
  f.host.setLlmReply(JSON.stringify({new_characters:[],scenes:[]}));
  const created=await f.api.createJob({...f.request,stream_line_start:1,stream_line_end:2});
  await f.wait(created.job_id,j=>j.progress.phase==='waiting_output');
  assert.equal(f.host.llmRequests.length,2,'one preprocess and one main tagging call, without JSON retry');assert.equal(f.host.naiRequests.filter(r=>r.kind==='generate').length,0);
  const previous=(await f.chat()).message[0].data;
  assert.match(f.host.llmRequests[0].messages[0].content,/select 0-1 distinct visual moments/);
  assert.match(f.host.llmRequests[1].messages.map(m=>m.content).join('\n'),/scenes: \[\]/);
  assert.equal((await f.commit(created.job_id)).ok,true);await assertRuntimeReleased(f,created.job_id);
  const done=await f.api.getJob(created.job_id);assert.equal(done.state,'done');assert.equal(done.result.shot_count,0);
  assert.equal((await f.chat()).message[0].data,previous);
});

test('zero-shot allowance does not accept malformed JSON or change normal generation',async()=>{
  for(const mode of ['missing-scenes','positive-min','normal']) {
    const f=await fixture();Object.assign(f.api.getConfig().card,{stream_lines_image_min:mode==='positive-min'?1:0,stream_lines_image_max:1,llm_json_retry:false});
    f.host.setLlmReply(JSON.stringify(mode==='missing-scenes'?{}:{scenes:[]}));
    const created=await f.api.createJob({...f.request,...(mode==='normal'?{}:{stream_line_start:1,stream_line_end:2})});
    const failed=await f.wait(created.job_id,j=>j.state==='error');assert.ok(failed.error);
    assert.equal(f.host.naiRequests.filter(r=>r.kind==='generate').length,0);await assertRuntimeReleased(f,created.job_id);
  }
});

test('an empty line batch can commit alongside a sibling with an image',async()=>{
  const f=await fixture(),chat=await f.chat();
  const text=Array.from({length:4},(_,i)=>`Narrative paragraph long enough for the scene ${i+1}.`).join('\n');
  chat.message[0].data=text;await risuai.setChatToIndex(0,0,chat);
  const request=(start,end)=>({...f.request,assistant_text:text.split('\n').slice(0,end).join('\n'),stream_line_start:start,stream_line_end:end});
  f.host.setLlmReply(JSON.stringify({new_characters:[],scenes:[]}));
  const first=await f.api.createJob(request(1,2));await f.wait(first.job_id,j=>j.progress.phase==='waiting_output');
  f.host.setLlmReply(JSON.stringify({new_characters:[],scenes:[{shots:[{line:4,composition:'scene'}]}]}));
  const second=await f.api.createJob(request(3,4));await f.wait(second.job_id,j=>j.progress.phase==='waiting_output');
  const result=await f.api.commitStreamOutput({...f.request,job_ids:[first.job_id,second.job_id],assistant_text:text,content_hash:'final'});
  assert.equal(result.ok,true);await assertRuntimeReleased(f,first.job_id);await assertRuntimeReleased(f,second.job_id);
  assert.equal(((await f.chat()).message[0].data.match(/\[\[@inray::/g)||[]).length,1);
  assert.equal(f.host.naiRequests.filter(r=>r.kind==='generate').length,1);
});

test('sibling line batches generate ahead without chat writes and preserve both images on group commit',async()=>{
  const f=await fixture(),chat=await f.chat();
  const text=Array.from({length:25},(_,i)=>`Narrative line ${i+1} in the same scene.`).join('\n');
  chat.message[0].data=text;await risuai.setChatToIndex(0,0,chat);
  const batch=(start,end)=>({...f.request,assistant_text:text.split('\n').slice(0,end).join('\n'),content_hash:'batch-'+end,stream_line_start:start,stream_line_end:end});
  f.host.setLlmReply(JSON.stringify({new_characters:[],scenes:[{shots:[{line:4,composition:'first batch'}]}]}));
  const first=await f.api.createJob(batch(1,10));
  await f.wait(first.job_id,j=>j.progress.phase==='waiting_output');
  f.host.setLlmReply(JSON.stringify({new_characters:[],scenes:[{shots:[{line:14,composition:'second batch'}]}]}));
  const second=await f.api.createJob(batch(11,20));
  assert.equal(second.accepted,true);
  await f.wait(second.job_id,j=>j.progress.phase==='waiting_output');
  assert.equal((await f.chat()).message[0].data,text,'neither spinner nor image touches a streaming reply');
  const prompt=f.host.llmRequests.at(-1).messages;
  assert.match(prompt.at(-1).content,/L1\|Narrative line 1/);
  assert.match(prompt.at(-1).content,/L20\|Narrative line 20/);
  assert.match(prompt.map(m=>m.content).join('\n'),/L11.*L20/);
  assert.equal((await f.api.createJob(batch(11,20))).busy,true,'duplicate ranges cannot be paid twice');
  assert.equal((await f.api.createJob({...batch(21,25),stream_id:'other-stream'})).busy,true);
  chat.isStreaming=false;await risuai.setChatToIndex(0,0,chat);
  const setChat=risuai.setChatToIndex,writes=[];
  risuai.setChatToIndex=async(...args)=>{if((await f.chat()).message[0].data!==args[2].message[0].data)writes.push(args[2].message[0].data);return setChat(...args);};
  const result=await f.api.commitStreamOutput({...f.request,job_ids:[first.job_id,second.job_id],assistant_text:text,content_hash:'final',message_index:0});
  assert.equal(result.ok,true);
  for(const id of [first.job_id,second.job_id]) {await f.wait(id,j=>j.state==='done');await assertRuntimeReleased(f,id);}
  const body=(await f.chat()).message[0].data;
  assert.equal((body.match(/\[\[@inray::/g)||[]).length,2);
  assert.ok(body.indexOf('::inxshot_')<body.indexOf('Narrative line 4'));
  assert.equal(analysisBody(body),text);
  assert.equal(writes.length,1,'all images already generated: only one initial message write');
  risuai.setChatToIndex=setChat;
});

test('a slow tagger does not block insertion of a completed sibling',async()=>{
  const f=await fixture(),chat=await f.chat();
  const text=Array.from({length:4},(_,i)=>`A sufficiently long narrative paragraph ${i+1}.`).join('\n');
  chat.message[0].data=text;await risuai.setChatToIndex(0,0,chat);
  const request=(start,end)=>({...f.request,assistant_text:text.split('\n').slice(0,end).join('\n'),content_hash:'partial-'+end,stream_line_start:start,stream_line_end:end});
  const nativeFetch=risuai.nativeFetch;let release,blocked=false;
  const gate=new Promise(r=>release=r);
  risuai.nativeFetch=async(url,options)=>{
    if(String(url).includes('completions') && !blocked){blocked=true;await gate;}
    return nativeFetch(url,options);
  };
  try {
    const first=await f.api.createJob(request(1,2));
    f.host.setLlmReply(JSON.stringify({new_characters:[],scenes:[{shots:[{line:4,composition:'later scene'}]}]}));
    const second=await f.api.createJob(request(3,4));
    await f.wait(second.job_id,j=>j.progress.phase==='waiting_output');
    const writes=[],setChat=risuai.setChatToIndex;
    risuai.setChatToIndex=async(...args)=>{if((await f.chat()).message[0].data!==args[2].message[0].data)writes.push(args[2].message[0].data);return setChat(...args);};
    const committing=f.api.commitStreamOutput({...f.request,job_ids:[first.job_id,second.job_id],assistant_text:text,content_hash:'final',message_index:0});
    for(let n=0;n<100 && !writes.length;n++)await sleep();
    assert.equal(writes.length,1,'insert the ready sibling before the slow tagger finishes');
    assert.equal((writes[0].match(/@inray::/g)||[]).length,1);
    f.host.setLlmReply(JSON.stringify({new_characters:[],scenes:[{shots:[{line:1,composition:'earlier scene'}]}]}));
    release();assert.equal((await committing).ok,true);
    await f.wait(first.job_id,j=>j.state==='done');await assertRuntimeReleased(f,first.job_id);
    await f.wait(second.job_id,j=>j.state==='done');await assertRuntimeReleased(f,second.job_id);
    assert.ok(writes.length<=3,'ready insertion, remaining tag plans, and final images only');
    assert.match(writes[0],/@inray::/,'already completed images are in the first insertion');
    risuai.setChatToIndex=setChat;
    const final=(await f.chat()).message[0].data;
    assert.equal((final.match(/\[\[@inray::/g)||[]).length,2);assert.equal(analysisBody(final),text);
  } finally {release();risuai.nativeFetch=nativeFetch;}
});

test('out-of-range tagging fails before paid generation and does not prevent a valid sibling from attaching',async()=>{
  const f=await fixture(),chat=await f.chat();
  const text=Array.from({length:4},(_,i)=>`A sufficiently long narrative paragraph ${i+1}.`).join('\n');
  chat.message[0].data=text;await risuai.setChatToIndex(0,0,chat);
  const request=(start,end)=>({...f.request,assistant_text:text.split('\n').slice(0,end).join('\n'),content_hash:'partial-'+end,stream_line_start:start,stream_line_end:end});
  f.host.setLlmReply(JSON.stringify({new_characters:[],scenes:[{shots:[{line:1,composition:'allowed first scene'}]}]}));
  const first=await f.api.createJob(request(1,2));await f.wait(first.job_id,j=>j.progress.phase==='waiting_output');
  const count=f.host.naiRequests.filter(r=>r.kind==='generate').length;
  const failed=await f.api.createJob(request(3,4));
  const failure=await f.wait(failed.job_id,j=>j.state==='error');await assertRuntimeReleased(f,failed.job_id);
  assert.match(failure.error,/L3~L4/);
  assert.equal(f.host.naiRequests.filter(r=>r.kind==='generate').length,count);
  assert.equal((await f.api.commitStreamOutput({...f.request,job_ids:[first.job_id,failed.job_id],assistant_text:text,content_hash:'final',message_index:0})).ok,true);
  await f.wait(first.job_id,j=>j.state==='done');await assertRuntimeReleased(f,first.job_id);
  assert.equal(((await f.chat()).message[0].data.match(/\[\[@inray::/g)||[]).length,1);
});

test('line images update base64 previews without further message writes until all sibling images finish',{timeout:12000},async()=>{
  const f=await fixture(),chat=await f.chat();
  const text=Array.from({length:4},(_,i)=>`Narrative scene paragraph number ${i+1}, long enough to depict.`).join('\n');
  chat.message[0].data=text;await risuai.setChatToIndex(0,0,chat);
  Object.assign(f.api.getConfig().card,{stream_lines_image_min:2,stream_lines_image_max:2});
  const request=(start,end)=>({...f.request,assistant_text:text.split('\n').slice(0,end).join('\n'),stream_line_start:start,stream_line_end:end});
  const fetch=risuai.nativeFetch,setChat=risuai.setChatToIndex,preview=globalThis.__OMNI_SPINNER_PREVIEW__;
  let releaseSecond,releaseFourth,enterSecond,enterFourth,calls=0;
  const secondGate=new Promise(r=>releaseSecond=r),fourthGate=new Promise(r=>releaseFourth=r);
  const secondStarted=new Promise(r=>enterSecond=r),fourthStarted=new Promise(r=>enterFourth=r),writes=[],previews=[];
  risuai.nativeFetch=async(url,...args)=>{
    if(String(url).includes('generate-image')){calls++;if(calls===2){enterSecond();await secondGate;}if(calls===4){enterFourth();await fourthGate;}}
    return fetch(url,...args);
  };
  risuai.setChatToIndex=async(...args)=>{if((await f.chat()).message[0].data!==args[2].message[0].data)writes.push(args[2].message[0].data);return setChat(...args);};
  globalThis.__OMNI_SPINNER_PREVIEW__=async row=>previews.push(row);
  try {
    f.host.setLlmReply(JSON.stringify({scenes:[{shots:[{line:1,composition:'one'},{line:2,composition:'two'}]}]}));
    const first=await f.api.createJob(request(1,2));await secondStarted;
    await f.wait(first.job_id,j=>j.progress.shot_done===1);
    f.host.setLlmReply(JSON.stringify({scenes:[{shots:[{line:3,composition:'three'},{line:4,composition:'four'}]}]}));
    const second=await f.api.createJob(request(3,4));await f.wait(second.job_id,j=>j.state==='generating');
    assert.equal(writes.length,0,'no insertion while output is streaming');
    assert.equal((await f.api.commitStreamOutput({...f.request,job_ids:[first.job_id,second.job_id],assistant_text:text,content_hash:'final'})).ok,true);
    assert.equal(writes.length,1);assert.equal((writes[0].match(/@inray::/g)||[]).length,1);assert.equal((writes[0].match(/\[\[@inrayspinner::[^\]]+\]\](?!\[\[@inray::)/g)||[]).length,3);
    releaseSecond();await fourthStarted;
    await f.wait(first.job_id,j=>j.progress.shot_done===2);await f.wait(second.job_id,j=>j.progress.shot_done===1);
    assert.equal(writes.length,1,'intermediate completions never save the message body');
    assert.ok(previews.filter(row=>!row.deferPaint).length>=2);
    assert.ok(previews.every(row=>/^data:image\/\w+;base64,/.test(row.url)));
    releaseFourth();for(const id of [first.job_id,second.job_id]){await f.wait(id,j=>j.state==='done');await assertRuntimeReleased(f,id);}
    assert.equal(writes.length,2);assert.equal((writes[1].match(/@inray::/g)||[]).length,4);assert.doesNotMatch(writes[1],/\[\[@inrayspinner::[^\]]+\]\](?!\[\[@inray::)/);
    assert.equal(analysisBody(writes[1]),text);
  } finally {releaseSecond();releaseFourth();risuai.nativeFetch=fetch;risuai.setChatToIndex=setChat;globalThis.__OMNI_SPINNER_PREVIEW__=preview;}
});

test('96 lines at size 20 insert ready slots, remaining plans, then final assets in exactly three writes',{timeout:12000},async()=>{
  const f=await fixture(),chat=await f.chat();
  const text=Array.from({length:96},(_,i)=>`Narrative line ${i+1}, long enough to depict.`).join('\n');
  chat.message[0].data=text;await risuai.setChatToIndex(0,0,chat);
  const fetch=risuai.nativeFetch,setChat=risuai.setChatToIndex,preview=globalThis.__OMNI_SPINNER_PREVIEW__;
  const images=f.host.pauseGeneration();let releaseTags,calls=0;
  const tags=new Promise(r=>releaseTags=r),writes=[],previews=[],ids=[];
  risuai.nativeFetch=async(url,...args)=>{
    if(String(url).includes('completions')) {
      const index=++calls,response=await fetch(url,...args);
      if(index>2)await tags;
      return response;
    }
    return fetch(url,...args);
  };
  risuai.setChatToIndex=async(...args)=>{if((await f.chat()).message[0].data!==args[2].message[0].data)writes.push(args[2].message[0].data);return setChat(...args);};
  globalThis.__OMNI_SPINNER_PREVIEW__=async row=>previews.push(row);
  try {
    for(const [start,end] of [[1,20],[21,40],[41,60],[61,80],[81,96]]) {
      f.host.setLlmReply(JSON.stringify({scenes:[{shots:[{line:end,composition:'scene '+end}]}]}));
      const created=await f.api.createJob({...f.request,assistant_text:text.split('\n').slice(0,end).join('\n'),stream_line_start:start,stream_line_end:end});
      assert.equal(created.accepted,true);ids.push(created.job_id);
      if(ids.length<=2)await f.wait(created.job_id,j=>j.state==='generating');
      else for(let n=0;n<100 && calls<ids.length;n++)await sleep();
    }
    await images.started;assert.equal(writes.length,0);
    // Host postprocessing changes wording before output commits; paid L ranges remain usable.
    const finalText=text.replace('Narrative line 1,','Final narrative line one,');
    const finalChat=await f.chat();finalChat.isStreaming=false;finalChat.message[0].data=finalText;
    await setChat(0,0,finalChat);
    const committing=f.api.commitStreamOutput({...f.request,job_ids:ids,assistant_text:finalText,content_hash:'final'});
    for(let n=0;n<100 && !writes.length;n++)await sleep();
    assert.equal(writes.length,1);assert.equal((writes[0].match(/@inrayspinner::/g)||[]).length,2);
    releaseTags();assert.equal((await committing).ok,true);
    assert.equal(writes.length,2);assert.equal((writes[1].match(/@inrayspinner::/g)||[]).length,5);
    assert.equal(analysisBody(writes[1]),finalText);
    images.release();
    for(const id of ids){await f.wait(id,j=>j.state==='done');await assertRuntimeReleased(f,id);}
    assert.equal(writes.length,3,'five image completions share one final message save');
    assert.equal((writes[2].match(/@inray::/g)||[]).length,5);
    assert.doesNotMatch(writes[2],/\[\[@inrayspinner::[^\]]+\]\](?!\[\[@inray::)/);
    assert.equal(analysisBody(writes[2]),finalText);
    assert.equal(calls,5,'no retagging after the final body rewrite');
    assert.equal(previews.length,5);assert.ok(previews.every(row=>/^data:image\/\w+;base64,/.test(row.url)));
    assert.equal(f.host.naiRequests.filter(row=>row.kind==='generate').length,5);
  } finally {releaseTags();images.release();risuai.nativeFetch=fetch;risuai.setChatToIndex=setChat;globalThis.__OMNI_SPINNER_PREVIEW__=preview;}
});

test('line group keeps paid images and removes pending slots after a later NAI failure',{timeout:12000},async()=>{
  const f=await fixture();Object.assign(f.api.getConfig().card,{stream_lines_image_min:2,stream_lines_image_max:2});
  f.host.setLlmReply(JSON.stringify({scenes:[{shots:[{line:1,composition:'one'},{line:2,composition:'two'}]}]}));
  const fetch=risuai.nativeFetch;let calls=0,release,entered;
  const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);
  risuai.nativeFetch=async(url,...args)=>{
    if(String(url).includes('generate-image')&&++calls===2){entered();await gate;throw Error('NAI fixture failure');}
    return fetch(url,...args);
  };
  try {
    const created=await f.api.createJob({...f.request,stream_line_start:1,stream_line_end:2});await started;
    await f.wait(created.job_id,j=>j.progress.shot_done===1);
    assert.equal((await f.commit(created.job_id)).ok,true);
    assert.equal(((await f.chat()).message[0].data.match(/@inray::/g)||[]).length,1);
    release();await f.wait(created.job_id,j=>j.state==='error');await assertRuntimeReleased(f,created.job_id);
    const final=(await f.chat()).message[0].data;
    assert.equal((final.match(/@inray::/g)||[]).length,1);
    assert.doesNotMatch(final,/\[\[@inrayspinner::[^\]]+\]\](?!\[\[@inray::)/);
    assert.equal((await f.api.getJob(created.job_id)).progress.line_group.failed,1);
  } finally {release();risuai.nativeFetch=fetch;}
});

test('line commit rechecks changed host text after waiting for a slow tagger',{timeout:12000},async()=>{
  const f=await fixture(),fetch=risuai.nativeFetch;let release,entered;
  const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);
  risuai.nativeFetch=async(url,...args)=>{if(String(url).includes('completions')){entered();await gate;}return fetch(url,...args);};
  try {
    const created=await f.api.createJob({...f.request,stream_line_start:1,stream_line_end:2});await started;
    const committing=f.commit(created.job_id);await sleep();
    const chat=await f.chat();chat.message[0].data='User replaced this reply while the tagger was pending.';await risuai.setChatToIndex(0,0,chat);
    release();assert.equal((await committing).error.code,'message_changed');
    await f.wait(created.job_id,j=>j.state==='cancelled');await assertRuntimeReleased(f,created.job_id);
    assert.equal((await f.chat()).message[0].data,chat.message[0].data);
  } finally {release();risuai.nativeFetch=fetch;}
});

test('sibling NAI requests share a key slot while tagging proceeds, and cancelled queued batches spend nothing',async()=>{
  const f=await fixture(),chat=await f.chat();
  const text=Array.from({length:6},(_,i)=>`A sufficiently long narrative paragraph ${i+1}.`).join('\n');
  chat.message[0].data=text;await risuai.setChatToIndex(0,0,chat);
  const request=(start,end)=>({...f.request,assistant_text:text.split('\n').slice(0,end).join('\n'),content_hash:'partial-'+end,stream_line_start:start,stream_line_end:end});
  const gate=f.host.pauseGeneration();
  const first=await f.api.createJob(request(1,2));await gate.started;
  f.host.setLlmReply(JSON.stringify({new_characters:[],scenes:[{shots:[{line:4,composition:'later scene'}]}]}));
  const second=await f.api.createJob(request(3,4));
  await f.wait(second.job_id,j=>j.state==='generating');
  assert.equal(f.host.llmRequests.length,2);
  assert.equal(f.host.naiRequests.filter(r=>r.kind==='generate').length,1);
  await f.commit(second.job_id,{cancel:true});
  await f.wait(second.job_id,j=>j.state==='cancelled');await assertRuntimeReleased(f,second.job_id);
  f.host.setLlmReply(JSON.stringify({new_characters:[],scenes:[{shots:[{line:6,composition:'third scene'}]}]}));
  const third=await f.api.createJob(request(5,6));await f.wait(third.job_id,j=>j.state==='generating');
  assert.equal(f.host.naiRequests.filter(r=>r.kind==='generate').length,1,'cancelling a queued job cannot let the next one bypass a running request');
  assert.equal((await f.api.getJob(second.job_id)).error?.code,'not_found','another active write prunes the cancelled storage row');
  gate.release();
  await f.wait(first.job_id,j=>j.progress.phase==='waiting_output');
  await f.wait(third.job_id,j=>j.progress.phase==='waiting_output');
  assert.equal(f.host.naiRequests.filter(r=>r.kind==='generate').length,2);
  const committed=await f.api.commitStreamOutput({...f.request,job_ids:[first.job_id,second.job_id,third.job_id],assistant_text:text,content_hash:'final',message_index:0});
  assert.equal(committed.ok,true);assert.deepEqual(committed.job_ids,[first.job_id,third.job_id]);
  await assertRuntimeReleased(f,first.job_id);await assertRuntimeReleased(f,third.job_id);
  assert.equal(((await f.chat()).message[0].data.match(/\[\[@inray::/g)||[]).length,2);
});

test('manual generation sends saved prose with unclosed thought tags to the tagger',async()=>{
  const f=await fixture(),chat=await f.chat();
  chat.isStreaming=false;
  chat.message[0].data='<Thoughts><think>\n'+body;
  await risuai.setChatToIndex(0,0,chat);
  const created=await f.api.createJob({...f.request,defer_attachment:false,stream_id:undefined,force:true});
  const job=await f.wait(created.job_id,j=>j.state==='done');
  assert.equal(job.state,'done');
  assert.match(f.host.llmRequests.at(-1).messages.at(-1).content,/L1\|First narrative/);
  assert.match(f.host.llmRequests.at(-1).messages.at(-1).content,/L2\|Second dialogue/);
  assert.doesNotMatch(f.host.llmRequests.at(-1).messages.at(-1).content,/<Thoughts>|<think>/);
  assert.match((await f.chat()).message[0].data,/\[\[@inray::/);
  await assertRuntimeReleased(f,created.job_id);
});

test('preprocessing resolves legacy limits and preserves original input for final tagging',async()=>{
  const f=await fixture();
  Object.assign(f.api.getConfig().card,{preprocessing:true,image_min:2,image_max:4});
  await f.api.setPrompt('preprocess','Select {{getglobalvar::toggle_Card.Image.Min}}–{{getglobalvar::toggle_Card.Image.Max}} moments. SAVED CUSTOM RULE');
  const created=await f.api.createJob(f.request);
  await f.wait(created.job_id,j=>j.progress.phase==='waiting_output');
  assert.equal(f.host.llmRequests.length,2);
  const [pre,main]=f.host.llmRequests.map(r=>r.messages);
  assert.match(pre[0].content,/Select 2–4 moments/);
  assert.match(pre[0].content,/SAVED CUSTOM RULE/);
  assert.doesNotMatch(pre[0].content,/\{\{|getglobalvar/);
  assert.match(pre.at(-1).content,/L1\|First narrative/);
  assert.equal(main.at(-1).content,pre.at(-1).content);
  assert.match(main.at(-2).content,/Preprocess reference/);
  assert.match(main.at(-2).content,/Verify it against the original/);
  assert.equal(await f.api.getPrompt('preprocess'),'Select {{getglobalvar::toggle_Card.Image.Min}}–{{getglobalvar::toggle_Card.Image.Max}} moments. SAVED CUSTOM RULE');
  await f.commit(created.job_id);await f.wait(created.job_id,j=>j.state==='done');
  await assertRuntimeReleased(f,created.job_id);
});

test('tagger retries one HTTP 429 or empty-choice response and then succeeds',async()=>{
  for(const failure of ['rate-limit','empty-choice']) {
    const f=await fixture(),nativeFetch=risuai.nativeFetch;
    Object.assign(f.api.getConfig().card,{preprocessing:false,llm_json_retry:true});
    let failed=false,taggerCalls=0;
    risuai.nativeFetch=async(url,options)=>{
      if(String(url).includes('completions')) {
        taggerCalls++;
        if(!failed) {
          failed=true;
          return failure==='rate-limit'
            ? {status:429,json:async()=>({error:{message:'rate limit'}})}
            : {status:200,json:async()=>({choices:[]})};
        }
      }
      return nativeFetch(url,options);
    };
    try {
      const created=await f.api.createJob(f.request);
      await f.wait(created.job_id,j=>j.progress.phase==='waiting_output');
      assert.equal(taggerCalls,2,failure);
      assert.ok(f.host.llmRequests.length>=1);
      await f.commit(created.job_id);await f.wait(created.job_id,j=>j.state==='done');
      await assertRuntimeReleased(f,created.job_id);
    } finally { risuai.nativeFetch=nativeFetch; }
  }
});

test('failed jobs do not accumulate runtime metadata across repeated generations',async()=>{
  const f=await fixture();
  f.host.setLlmReply(JSON.stringify({new_characters:[{name:'New',appearance:'black hair'}],scenes:[{shots:[{line:1,characters:['New'],composition:'garden'}]}]}));
  for(let i=0;i<5;i++) {
    const created=await f.api.createJob({session_id:'missing-owner',force:true,assistant_text:body,content_hash:'failure-'+i});
    assert.equal(created.accepted,true);
    await f.wait(created.job_id,j=>j.state==='error');
    await assertRuntimeReleased(f,created.job_id);
  }
  assert.equal(f.api.jobRunMeta.size,0);assert.equal(f.api.jobEpochByKey.size,0);
});

test('stream metadata survives paid image waiting and is released only after committed attachment',async()=>{
  const f=await fixture(),created=await f.api.createJob(f.request);
  await f.wait(created.job_id,j=>j.progress.phase==='waiting_output');
  assert.ok(f.api.jobRunMeta.has(created.job_id));
  const meta=f.api.jobRunMeta.get(created.job_id);
  assert.equal(meta.hostMessageId,'m');
  assert.equal(meta.sourcePreview,'','stable IDs do not retain prose for fuzzy matching');
  assert.equal(meta.saveAssistantPreview,'','save preview is only populated when retargeted/committed');
  const retarget={session_id:'session',character_id:'c',chat_id:'chat',message_index:0,role:'char',to_hash:'retargeted',assistant_text:'A completely different final paragraph.'};
  assert.equal((await f.api.retargetJobSaveHash({...retarget,host_message_id:'other'})).retargeted,false);
  assert.equal((await f.api.retargetJobSaveHash({...retarget,host_message_id:'m'})).retargeted,true);
  assert.ok(f.api.streamJob(created.job_id));
  assert.equal((await f.commit(created.job_id)).ok,true);
  await f.wait(created.job_id,j=>j.state==='done');
  await assertRuntimeReleased(f,created.job_id);
  assert.match((await f.chat()).message[0].data,/@inray::/);
});

test('cancelled paid work releases runtime metadata after preserving its image',async()=>{
  const f=await fixture(),gate=f.host.pauseGeneration();
  const created=await f.api.createJob(f.request);await gate.started;
  await f.commit(created.job_id,{cancel:true});
  assert.ok(f.api.jobRunMeta.has(created.job_id),'in-flight paid request still needs its metadata');
  gate.release();await f.wait(created.job_id,j=>j.state==='cancelled');
  await assertRuntimeReleased(f,created.job_id);
  assert.ok(f.api.storeSize('images')>0);assert.doesNotMatch((await f.chat()).message[0].data,/@inray/);
});

test('cleanup failure still releases old metadata without deleting a replacement owner',{timeout:12000},async()=>{
  const f=await fixture();let entered,release;
  const started=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
  globalThis.__OMNI_CLEAR_SPINNER_PREVIEW__=async id=>{
    if((await f.api.getJob(id)).state==='done') {entered();await gate;throw Error('preview cleanup failed');}
  };
  try {
    const created=await f.api.createJob(f.request);
    await f.wait(created.job_id,j=>j.progress.phase==='waiting_output');
    await f.commit(created.job_id);await started;
    const old=f.api.jobRunMeta.get(created.job_id);
    assert.ok(old,'postprocessing still owns the old metadata');
    const replacement={jobId:'newer-job',epoch:old.epoch+1};
    f.api.jobEpochByKey.set(old.key,replacement);
    release();await assertRuntimeReleased(f,created.job_id);
    assert.deepEqual(f.api.jobEpochByKey.get(old.key),replacement);
    assert.match((await f.chat()).message[0].data,/@inray::/);
  } finally {release();delete globalThis.__OMNI_CLEAR_SPINNER_PREVIEW__;}
});

for (const mode of ['manual','automatic','stream']) test(`${mode} replaces old image and spinner tokens in the single write that inserts new slots`,{timeout:12000},async()=>{
  const f=await fixture(),chat=await f.chat();
  const oldPair='[[@inrayspinner::old_0::512::768]][[@inray::old-card::inxshot_old-card.webp::512::768]]';
  const abandoned='[[@inrayspinner::abandoned_1::768::512]]';
  chat.message[0].data=oldPair+'\n'+chat.message[0].data+'\n'+abandoned;
  chat.message.push({role:'char',chatId:'other',data:'Other message '+oldPair});
  await risuai.setChatToIndex(0,0,chat);
  const original=chat.message[0].data,writes=[],write=risuai.setChatToIndex;
  let previousMessages=JSON.stringify(chat.message);
  risuai.setChatToIndex=async(...args)=>{
    // Session lore persistence can share this API without changing any message.
    const messages=JSON.stringify(args[2].message);
    if(messages!==previousMessages)writes.push(structuredClone(args[2]));
    previousMessages=messages;
    return write(...args);
  };
  const gate=f.host.pauseGeneration();
  const request={...f.request,force:mode==='manual',defer_attachment:mode==='stream'};
  const created=await f.api.createJob(request);
  try {
    assert.equal(created.accepted,true);
    await gate.started;
    if(mode==='stream') {
      assert.equal(writes.length,0,'deferred work must leave old images until commit');
      assert.equal((await f.chat()).message[0].data,original);
      assert.equal((await f.commit(created.job_id)).ok,true);
    }
    assert.equal(writes.length,1,'no separate clear-only message write');
    const inserted=writes[0].message[0].data;
    assert.doesNotMatch(inserted,/old_0|old-card|abandoned_1|\[\[@inray::/);
    assert.equal((inserted.match(/\[\[@inrayspinner::/g)||[]).length,1);
    assert.ok(inserted.includes(`[[@inrayspinner::${created.job_id}_0::`));
    assert.ok(inserted.indexOf('[[@inrayspinner')>inserted.indexOf('First narrative'));
    assert.ok(inserted.indexOf('[[@inrayspinner')<inserted.indexOf('Second dialogue'));
    assert.ok(inserted.includes('<Thoughts>\nSECRET [[imgstart]]\n</Thoughts>'));
    assert.equal(writes[0].message[1].data,chat.message[1].data);
  } finally {
    gate.release();
    await f.wait(created.job_id,j=>j.state==='done');
  }
});

test('paid images finish in background with no chat writes until exact committed output; body L2 maps past thoughts', {timeout:12000},async()=>{
  const f=await fixture(),writes=[],tts=[];
  const write=risuai.setChatToIndex;risuai.setChatToIndex=async(...args)=>{writes.push(structuredClone(args[2]));return write(...args);};
  f.api.getConfig().card.tts_on=true;
  risuai.speak=()=>tts.push(true);
  const created=await f.api.createJob(f.request);assert.equal(created.accepted,true);
  const waiting=await f.wait(created.job_id,j=>j.progress.phase==='waiting_output');
  assert.equal(writes.length,0);assert.equal(tts.length,0);assert.equal(f.host.naiRequests.length,1);
  assert.equal(waiting.progress.pending_inline,undefined);
  assert.equal((await f.api.createJob(f.request)).busy,true);
  const prompt=f.host.llmRequests.map(r=>JSON.stringify(r)).join('\n');
  assert.match(prompt,/L1\|First narrative/);assert.match(prompt,/L2\|Second dialogue/);
  assert.doesNotMatch(prompt,/SECRET|STATUS/);
  assert.equal((await f.commit(created.job_id,{host_message_id:'other'})).error.code,'identity_mismatch');assert.equal(writes.length,0);
  assert.equal((await f.commit(created.job_id)).ok,true);
  await f.wait(created.job_id,j=>j.state==='done');
  const result=(await f.chat()).message[0].data;
  assert.equal(tts.length,0,'image completion must not start the retired browser speech lane; independent OmniTTS owns playback');
  assert.match(result,/\[\[@inray::/);
  assert.ok(result.indexOf('[[@inrayspinner')>result.indexOf('First narrative'));
  assert.ok(result.indexOf('[[@inrayspinner')<result.indexOf('Second dialogue'));
  const count=writes.length;await f.commit(created.job_id);assert.equal(writes.length,count);
});

test('commit while image request is pending shows a spinner and fills the same slot later',{timeout:12000},async()=>{
  const f=await fixture(),gate=f.host.pauseGeneration();
  const created=await f.api.createJob(f.request);await gate.started;
  assert.doesNotMatch((await f.chat()).message[0].data,/@inrayspinner/);
  assert.equal((await f.commit(created.job_id)).ok,true);
  assert.match((await f.chat()).message[0].data,/@inrayspinner/);assert.doesNotMatch((await f.chat()).message[0].data,/@inray::/);
  gate.release();await f.wait(created.job_id,j=>j.state==='done');
  assert.match((await f.chat()).message[0].data,/@inray::/);
});

test('completion before analysis waits for L-numbers, and simultaneous starts create one job',{timeout:12000},async()=>{
  const f=await fixture();let release,entered;
  const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r),fetch=risuai.nativeFetch;
  risuai.nativeFetch=async(url,...args)=>{if(String(url).includes('/chat/completions')){entered();await gate;}return fetch(url,...args);};
  const results=await Promise.all([f.api.createJob(f.request),f.api.createJob(f.request)]);
  assert.equal(results.filter(r=>r.accepted).length,1);assert.equal(results.filter(r=>r.busy).length,1);
  const id=results.find(r=>r.accepted).job_id;
  await started;assert.equal((await f.commit(id)).ok,true);
  assert.doesNotMatch((await f.chat()).message[0].data,/@inrayspinner/);
  release();const finished=await f.wait(id,j=>j.state==='done');
  assert.match((await f.chat()).message[0].data,/@inray::/);
  assert.equal(finished.result.cards[0].content_hash,'final');
});

test('cancellation during a paid request keeps its result and never attaches it',{timeout:12000},async()=>{
  const f=await fixture(),gate=f.host.pauseGeneration();
  const created=await f.api.createJob(f.request);await gate.started;
  assert.equal((await f.commit(created.job_id,{cancel:true})).cancelled,true);
  gate.release();await f.wait(created.job_id,j=>j.state==='cancelled');
  assert.ok(f.api.storeSize('images')>0);assert.doesNotMatch((await f.chat()).message[0].data,/@inray/);
});

test('changed committed text cancels attachment and preserves paid image bytes', {timeout:12000},async()=>{
  const f=await fixture(),created=await f.api.createJob(f.request);
  await f.wait(created.job_id,j=>j.progress.phase==='waiting_output');
  const before=f.api.storeSize('images');assert.ok(before>0);
  const chat=await f.chat();chat.message[0].data='Completely replaced output';await risuai.setChatToIndex(0,0,chat);
  assert.equal((await f.commit(created.job_id)).error.code,'message_changed');
  await f.wait(created.job_id,j=>j.state==='cancelled');
  assert.equal(f.api.storeSize('images'),before);assert.equal((await f.chat()).message[0].data,'Completely replaced output');
});

test('명령수정 sends this character\'s lb-xnai section and lorebook entries only when its switches are on',async()=>{
  const f=await fixture();
  const bot=await risuai.getCharacterFromIndex(0);
  await risuai.setCharacterToIndex(0,{...bot,globalLore:[
    {comment:'lb-xnai.lb.extra',key:'',content:'### 하나\nred hair, school uniform\n\n### 민아\nblue hair'},
    {comment:'하나 · 설정',key:'하나',content:'하나는 늘 교복을 입는다.'},
    {comment:'민아',key:'민아',content:'민아는 메이드다.'}]});
  f.host.setLlmReply('{}');
  const sent=async body=>{
    await f.api.commandRewriteCharacter('h1',{instruction:'교복으로',character:{id:'h1',name:'하나',appearance:'girl'},scope:'c',...body});
    return JSON.parse(f.host.llmRequests.at(-1).messages.findLast(m=>m.role==='user').content);
  };
  assert.equal((await sent({})).reference,undefined,'switches off: nothing from the lorebook');
  const both=await sent({xnai:true,lore:true});
  assert.match(both.reference.lb_xnai,/### 하나\nred hair, school uniform/);assert.doesNotMatch(both.reference.lb_xnai,/민아/);
  assert.deepEqual(both.reference.lorebook,[{title:'하나 · 설정',text:'하나는 늘 교복을 입는다.'}],'the bot\'s own lorebook, entries naming her only');
  assert.match(both.reference.note,/never copy story text/);
  assert.deepEqual(Object.keys((await sent({xnai:true})).reference).sort(),['lb_xnai','note']);
});

test('helper module toggles only itself, hides the marker only in display, and serializes with gallery/display writes',async()=>{
  const f=await fixture();
  await risuai.setDatabase({modules:[{id:'user',assets:[['keep','path','keep']]}],enabledModules:['user']});
  await Promise.all([f.api.ensureOmniHelperModule(true),f.api.ensureInrayDisplayModule(),f.api.putShotAsset('test',PNG_1X1,'session')]);
  let db=await risuai.getDatabase();
  const helper=db.modules.find(m=>m.id===f.api.OMNI_HELPER_ID);
  assert.equal(helper.name,'⚛️ omni 보조 프롬');assert.equal(helper.lorebook[0].alwaysActive,true);
  // The marker rule runs right after the token guard unmasks it (its <order …> is Risu's, not a RegExp flag).
  const marker=helper.regex.find(r=>r.comment==='omni-imgstart-display');
  assert.equal(marker.type,'editdisplay');assert.match(marker.flag,/<order -10006>/);
  assert.equal('before [[imgstart]] after'.replace(new RegExp(marker.in,marker.flag.replace(/<[^>]*>/g,'')),marker.out),'before  after');
  assert.deepEqual(helper.regex.map(r=>r.comment),['omni-imgstart-display','omni-token-guard','omni-token-unguard']);
  assert.ok(db.enabledModules.includes(helper.id));assert.equal(db.modules.length,4);
  helper.lorebook.push({comment:'custom',content:'keep'});await risuai.setDatabase(db);
  await f.api.ensureOmniHelperModule(false);db=await risuai.getDatabase();
  assert.ok(!db.enabledModules.includes(helper.id));assert.ok(db.enabledModules.includes('user'));
  assert.equal(db.modules.find(m=>m.id==='user').assets[0][0],'keep');
  assert.ok(db.modules.find(m=>m.id===helper.id).lorebook.some(l=>l.comment==='custom'));
  const read=risuai.getDatabase;
  risuai.getDatabase=async()=>{const current=await read();return {...current,modules:{...current.modules,length:current.modules.length},enabledModules:{...current.enabledModules,length:current.enabledModules.length}};};
  await f.api.ensureOmniHelperModule(true);const wrapped=await read();
  assert.equal(wrapped.modules.length,4);assert.ok(wrapped.enabledModules.includes('user'));
  assert.ok(wrapped.modules.find(m=>m.id===helper.id).lorebook.some(l=>l.comment==='custom'));
});


test('image markers leave only the request: 리퀘스트 데이터 수정 strips them, the retired lore goes, user lore stays',async()=>{
  const f=await fixture();
  await risuai.setDatabase({modules:[{id:'inlay-inray-display',namespace:'inlay.inray_display',name:'old',lorebook:[{comment:'omni-display-marker-instructions',content:'Do not imitate'},{comment:'mine',content:'keep'}],regex:[]}],enabledModules:['inlay-inray-display']});
  await f.api.ensureInrayDisplayModule();
  const display=(await risuai.getDatabase()).modules.find(m=>m.id==='inlay-inray-display');
  assert.deepEqual(display.lorebook.map(l=>l.comment),['mine'],'the do-not-imitate lore is gone; nothing else is touched');
  const strip=display.regex.find(r=>r.comment==='omni-request-strip-markers');
  assert.equal(strip.type,'editprocess','request only: stored chat and display keep the markers');
  const sent='앞 문단\n[[@inrayspinner::job_1::832::1216]][[@inray::card::inxshot_a.png::832::1216]]\n[[@inraywait::w_2::1024::1024]]\n뒤 [[other::x]]'.replace(new RegExp(strip.in,strip.flag),strip.out);
  assert.equal(sent,'앞 문단\n\n\n뒤 [[other::x]]','only our markers go; other modules\' [[…]] stay');
  assert.ok(display.regex.some(r=>r.type==='editdisplay'&&r.comment==='omni-spinner-display'),'display rules are still there');
  const writes=JSON.stringify((await risuai.getDatabase()).modules);await f.api.ensureInrayDisplayModule();
  assert.equal(JSON.stringify((await risuai.getDatabase()).modules),writes,'a second run changes nothing');
});

test('automatic upscale previews raw pixels before upscale and bakes only the doubled result',async()=>{
  const f=await fixture();f.api.getConfig().card.nai_auto_upscale=true;
  const nativeFetch=risuai.nativeFetch;let release;const gate=new Promise(r=>release=r);let calls=0,previewed=false;
  globalThis.__OMNI_SPINNER_PREVIEW__=async args=>{assert.match(args.url,/^data:image/);previewed=true;};
  risuai.nativeFetch=async(url,opts)=>{
    if(String(url).endsWith('/upscale')){calls++;assert.equal(previewed,true);await gate;return new Response(zipStore('image.png',png(2,2)));}
    return nativeFetch(url,opts);
  };
  try {
    const created=await f.api.createJob({...f.request,stream_line_start:1,stream_line_end:2});
    await f.wait(created.job_id,j=>j.progress.phase==='upscaling');
    assert.doesNotMatch((await f.chat()).message[0].data,/\[\[@inray::/,'no final bake before upscale');
    release();await f.wait(created.job_id,j=>j.progress.phase==='waiting_output');
    await f.commit(created.job_id);await assertRuntimeReleased(f,created.job_id);
    const done=await f.api.getJob(created.job_id);
    assert.equal(calls,1);assert.equal(done.state,'done');
    assert.deepEqual([done.result.cards[0].width,done.result.cards[0].height],[2,2]);
    assert.match((await f.chat()).message[0].data,/\[\[@inray::/);
  } finally {release();delete globalThis.__OMNI_SPINNER_PREVIEW__;}
});

test('automatic upscale failure saves the original once without regenerating or retrying',async()=>{
  const f=await fixture();f.api.getConfig().card.nai_auto_upscale=true;
  const nativeFetch=risuai.nativeFetch;let calls=0;
  risuai.nativeFetch=async(url,opts)=>String(url).endsWith('/upscale')?(calls++,new Response('busy',{status:429})):nativeFetch(url,opts);
  const created=await f.api.createJob({...f.request,stream_line_start:1,stream_line_end:2});
  await f.wait(created.job_id,j=>j.progress.phase==='waiting_output');
  await f.commit(created.job_id);await assertRuntimeReleased(f,created.job_id);
  const done=await f.api.getJob(created.job_id);
  assert.equal(calls,1);assert.equal(done.state,'done');assert.equal(done.result.cards.length,1);
  assert.equal(f.host.naiRequests.filter(r=>r.kind==='generate').length,1);
  assert.equal(done.result.warnings.length,1);assert.match(done.result.message,/원본 저장/);
});
