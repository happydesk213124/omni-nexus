import test from 'node:test';
import assert from 'node:assert/strict';
import {installHost,PNG_1X1} from '../tools/parity/host.mjs';
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
