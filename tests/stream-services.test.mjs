import test from 'node:test';
import assert from 'node:assert/strict';
import {installHost,PNG_1X1} from '../tools/parity/host.mjs';
import {analysisBody} from '../.test-build/message-body.mjs';
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

test('a line group waits for every tagger and inserts already generated images in one write',async()=>{
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
    await sleep();assert.equal(writes.length,0,'a slow earlier tagger blocks all insertion');
    f.host.setLlmReply(JSON.stringify({new_characters:[],scenes:[{shots:[{line:1,composition:'earlier scene'}]}]}));
    release();assert.equal((await committing).ok,true);
    await f.wait(first.job_id,j=>j.state==='done');await assertRuntimeReleased(f,first.job_id);
    await f.wait(second.job_id,j=>j.state==='done');await assertRuntimeReleased(f,second.job_id);
    assert.ok(writes.length<=2,'one initial group write and at most one final group write');
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
  assert.equal(tts.length,1);
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

test('helper module toggles only itself, hides the marker only in display, and serializes with gallery/display writes',async()=>{
  const f=await fixture();
  await risuai.setDatabase({modules:[{id:'user',assets:[['keep','path','keep']]}],enabledModules:['user']});
  await Promise.all([f.api.ensureOmniHelperModule(true),f.api.ensureInrayDisplayModule(),f.api.putShotAsset('test',PNG_1X1,'session')]);
  let db=await risuai.getDatabase();
  const helper=db.modules.find(m=>m.id===f.api.OMNI_HELPER_ID);
  assert.equal(helper.name,'⚛️ omni 보조 프롬');assert.equal(helper.lorebook[0].alwaysActive,true);
  assert.equal(helper.regex[0].type,'editdisplay');assert.equal('before [[imgstart]] after'.replace(new RegExp(helper.regex[0].in,helper.regex[0].flag),helper.regex[0].out),'before  after');
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
