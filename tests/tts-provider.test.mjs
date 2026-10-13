import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

const built=await build({stdin:{contents:`export * from './src/config/tts-defaults';export * from './src/providers/tts/fish';export * from './src/providers/tts/translation';export * from './src/providers/tts/selection';export * from './src/services/tts-characters';export * from './src/storage/tts-store';`,resolveDir:process.cwd()},bundle:true,write:false,format:'esm'});
const api=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text+'\n//# sourceURL=tts-provider-check.mjs').toString('base64'));
const voiceId='4e118bfbb83e401c84699c09b5f08257';

test('Fish metadata and free Google translation explicitly use GET on Risu nativeFetch',async()=>{
  const settings=api.ttsDefaults(),calls=[];
  settings.fish.key='fake';settings.translation.provider='google-free';
  globalThis.risuai={nativeFetch:async(url,options)=>{
    calls.push([url,options]);
    // The real host defaults to POST and rejects an absent request body.
    const method=options.method??'POST';if(method==='POST'&&options.body===undefined)throw Error('Invalid body type');
    return {ok:true,json:async()=>url.includes('/model/')?{title:'음성',tags:['female','calm']}:[[['こんにちは。']]]};
  }};
  try{
    const voice=await api.fetchFishVoice('https://fish.audio/ko/app/m/'+voiceId+'/',settings);
    assert.equal(voice.gender,'female');assert.deepEqual(voice.tags,['female','calm']);
    const result=await api.translateTts([{id:'1',kind:'narration',text:'안녕하세요.',speaker:'',tone:'',start:0,end:6}],settings);
    assert.deepEqual(result,['こんにちは。']);
    assert.ok(calls.every(([,o])=>o.method==='GET'&&o.requestTimeoutMs===90000));
  }finally{delete globalThis.risuai;}
});

test('Fish synthesis sends the selected model, voice and English delivery through the binary host reader',async()=>{
  const settings=api.ttsDefaults();settings.fish.key='fake';settings.fish.model='s2.1-pro-free';
  let request;
  globalThis.risuai={nativeFetch:async(url,options)=>{request={url,...options};return {status:200,data:new Uint8Array(32)};}};
  try{
    assert.equal((await api.synthesizeFish('반가워요.','happy',voiceId,settings)).byteLength,32);
    assert.equal(request.method,'POST');assert.equal(request.headers.model,'s2.1-pro-free');
    const body=JSON.parse(request.body);assert.equal(body.reference_id,voiceId);assert.equal(body.text,'[happy]반가워요.');assert.equal(body.prosody.normalize_loudness,true);
    globalThis.risuai.nativeFetch=async()=>({ok:false,status:401});
    await assert.rejects(api.synthesizeFish('테스트','',voiceId,settings),/401/);
  }finally{delete globalThis.risuai;}
});

test('Risu LLM translation sends a whole numbered batch and JEV honors gender-filtered numbered candidates',async()=>{
  const settings=api.ttsDefaults();settings.translation.provider='llm';settings.jev.key='fake';
  const segments=['첫 대사','다음 대사'].map((text,i)=>({id:String(i),kind:'dialogue',text,speaker:'하린',tone:'happy',start:0,end:4}));
  let llmCalls=0,jevBody;
  globalThis.risuai={runLLMModel:async options=>{
    llmCalls++;const sent=JSON.parse(options.messages.at(-1).content);assert.equal(sent.lines.length,2);return {success:true,content:'[[1,"Next"],[0,"First"]]'};
  },nativeFetch:async(_url,options)=>{jevBody=JSON.parse(options.body);return {ok:true,json:async()=>({answers:{0:{choice:'1',probabilities:{1:1}}}})};}};
  try{
    assert.deepEqual(await api.translateTts(segments,settings),['First','Next']);assert.equal(llmCalls,1);
    const character=api.blankTtsCharacter('global','하린');character.gender='female';character.tags=['청년','차분한'];
    const voices=[{key:'f',name:'여성',fishId:voiceId,tags:['female','calm'],gender:'female',folder:''},{key:'m',name:'남성',fishId:voiceId,tags:['male'],gender:'male',folder:''}];
    const chosen=await api.selectTtsVoices([character],voices,settings,'jev');assert.equal(chosen.get(character.id)[0].key,'f');
    assert.deepEqual(Object.keys(jevBody.questions['0'].criteria),['1']);
    globalThis.risuai.nativeFetch=async()=>({ok:true,json:async()=>({answers:{0:{choice:'1001'}}})});
    await assert.rejects(api.selectTtsVoices([character],voices,settings,'jev'),/유효한 음성 추천/);
  }finally{delete globalThis.risuai;}
});


test('automatic JEV assignment uses lore directly, persists once and reuses the voice without an LLM',async()=>{
  const saved=new Map();let calls=0;
  globalThis.risuai={pluginStorage:{getItem:async k=>saved.get(k),setItem:async(k,v)=>saved.set(k,v)},getCurrentLorebookEntries:async()=>[{key:'Sora',comment:'Sora',content:'Sora is a calm young man.'}],getDatabase:async()=>({personas:[]}),runLLMModel:async()=>{throw Error('JEV must not require LLM credentials');},nativeFetch:async(_url,options)=>{calls++;const body=JSON.parse(options.body);assert.match(JSON.stringify(body.questions[0].instructions.sources),/calm young man/);return {ok:true,json:async()=>({answers:{0:{choice:'1001'}}})};}};
  try{
    const data=await api.loadTtsData();data.settings.enabled=true;data.settings.selector='jev';data.settings.jev.key='fake';data.voices=[{key:'male',name:'voice',fishId:voiceId,gender:'male',tags:['male','calm'],folder:''}];data.characters=[];
    const context={scope:'jev-auto',characterId:'auto-char',chatId:'auto-chat',sessionId:'auto-session',character:{},chat:{},messages:[]};
    await api.ensureTtsSpeakers(context,['Sora'],()=>true);
    assert.equal(data.characters.length,1);assert.equal(data.characters[0].fishId,voiceId);assert.equal(data.characters[0].name,'Sora');assert.ok(saved.has('omnitts.data'));
    await api.ensureTtsSpeakers(context,['Sora'],()=>true);assert.equal(calls,1);
  }finally{delete globalThis.risuai;}
});


test('LLM auto-fill assigns a supplied preset and known speakers require no repeat model call',async()=>{
  let calls=0;const saved=new Map();
  globalThis.risuai={pluginStorage:{getItem:async k=>saved.get(k),setItem:async(k,v)=>saved.set(k,v)},getCurrentLorebookEntries:async()=>[{key:'하린',content:'하린은 차분한 청년 여성이다.'}],getDatabase:async()=>({personas:[]}),runLLMModel:async options=>{calls++;const data=JSON.parse(options.messages.at(-1).content);assert.deepEqual(data.requested_names,['하린']);assert.match(JSON.stringify(data.sources),/차분한/);return {success:true,content:'[[-1,"하린","","하린",["Harin"],["청년","차분한"],"female",1]]'};}};
  try{
    const data=api.ttsData();data.settings.selector='llm';data.settings.enabled=true;data.characters=[];data.voices=[{key:'female',name:'voice',fishId:voiceId,gender:'female',tags:['female','calm'],folder:''}];
    const context={scope:'llm-auto',characterId:'llm-char',chatId:'llm-chat',sessionId:'llm-session',character:{},chat:{},messages:[]};
    await api.ensureTtsSpeakers(context,['하린'],()=>true);assert.equal(data.characters[0].fishId,voiceId);assert.deepEqual(data.characters[0].tags,['청년','차분한']);
    await api.ensureTtsSpeakers(context,['하린'],()=>true);assert.equal(calls,1);
  }finally{delete globalThis.risuai;}
});
