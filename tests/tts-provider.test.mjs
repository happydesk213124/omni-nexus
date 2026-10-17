import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

const built=await build({stdin:{contents:`export * from './src/config/tts-defaults';export * from './src/providers/tts/fish';export * from './src/providers/tts/translation';export * from './src/providers/tts/selection';export * from './src/services/tts-characters';export * from './src/storage/tts-store';export {resolveTtsSpeaker,mergeTtsCharacter} from './src/domain/tts/identity';export * from './src/tts-ui/settings-transfer';`,resolveDir:process.cwd()},bundle:true,write:false,format:'esm'});
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
    assert.equal(voice.gender,'female');assert.deepEqual(voice.tags,['female','calm']);assert.deepEqual(voice.languages,['ko'],'a Korean title predicts ko when Fish lists no language');
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

test('Fish through OpenRouter: the same voice, tone and loudness on its speech route, with its own key or JEV\'s',async()=>{
  const settings=api.ttsDefaults();Object.assign(settings.fish,{via:'openrouter',model:'s2.1-pro-free',key:''});
  let request;
  globalThis.risuai={nativeFetch:async(url,options)=>{request={url,...options};return {status:200,data:new Uint8Array(32)};}};
  try{
    await assert.rejects(api.synthesizeFish('반가워요.','happy',voiceId,settings),/OpenRouter API 키/,'no key anywhere: says which one');
    Object.assign(settings.jev,{url:'https://openrouter.ai/api/alpha/decisions',key:'jev-or-key'});
    assert.equal((await api.synthesizeFish('반가워요.','happy',voiceId,settings)).byteLength,32,'no Fish key needed');
    assert.equal(request.url,'https://openrouter.ai/api/v1/audio/speech');assert.equal(request.headers.Authorization,'Bearer jev-or-key','JEV\'s OpenRouter key when Fish has none of its own');
    const body=JSON.parse(request.body);
    assert.deepEqual([body.model,body.voice,body.input,body.response_format],['fish-audio/s2.1-pro-free',voiceId,'[happy]반가워요.','mp3']);
    assert.equal(body.provider.options['fish-audio'].prosody.normalize_loudness,true,'Fish\'s own options under provider.options');
    settings.fish.routerKey='own-key';await api.synthesizeFish('테스트','',voiceId,settings);
    assert.equal(request.headers.Authorization,'Bearer own-key');
    settings.fish.model='fish-audio/s2-pro';await api.synthesizeFish('테스트','',voiceId,settings);
    assert.equal(JSON.parse(request.body).model,'fish-audio/s2-pro','a full model id is kept');
    // Voice details: a public voice needs no key, so OpenRouter-only setups can still add voices.
    globalThis.risuai.nativeFetch=async(url,options)=>{request={url,...options};return {ok:true,json:async()=>({title:'음성',tags:['female']})};};
    await api.fetchFishVoice(voiceId,settings);
    assert.equal(request.headers?.Authorization,undefined);assert.match(request.url,/api\.fish\.audio\/model\//);
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
    const context={scope:'jev-auto',rosterScope:'bot:auto-char',characterId:'auto-char',chatId:'auto-chat',sessionId:'auto-session',character:{},chat:{},messages:[]};
    await api.ensureTtsSpeakers(context,['Sora'],()=>true);
    assert.equal(data.characters.length,1);assert.equal(data.characters[0].fishId,voiceId);assert.equal(data.characters[0].name,'Sora');assert.deepEqual(data.characters[0].tags,['male','calm'],'an empty mood-tag field takes the JEV preset tags');assert.equal(data.characters[0].gender,'male','an unknown gender takes the JEV preset gender');assert.ok(saved.has('omnitts.data'));
    await api.ensureTtsSpeakers(context,['Sora'],()=>true);assert.equal(calls,1);
  }finally{delete globalThis.risuai;}
});


test('a speaker no lorebook knows is chosen from the message being voiced, and only that message goes',async()=>{
  const saved=new Map();let sent;
  globalThis.risuai={pluginStorage:{getItem:async k=>saved.get(k),setItem:async(k,v)=>saved.set(k,v)},getCurrentLorebookEntries:async()=>[],getDatabase:async()=>({personas:[]}),
    nativeFetch:async(_url,options)=>{sent=JSON.parse(options.body);return {ok:true,json:async()=>({answers:{0:{choice:'1001'}}})};}};
  try{
    const data=await api.loadTtsData();data.settings.enabled=true;data.settings.autoAssign=true;data.settings.selector='jev';data.settings.jev.key='fake';data.voices=[{key:'male',name:'voice',fishId:voiceId,gender:'male',tags:['male','old'],folder:''}];data.characters=[];
    const messages=[{role:'char',chatId:'old',data:'An unrelated earlier message.'},
      {role:'char',chatId:'now',data:['The old blacksmith Gorn wiped his beard.','[[@inray::card::inxshot_card.webp::832::1216]]','Gorn: "Back in my day, lad, we forged by hand."','[[inx1]]{"place":"forge"}[[/inx1]]'].join('\n')}];
    const context={scope:'jev-chat',rosterScope:'bot:chat-char',characterId:'chat-char',chatId:'chat',sessionId:'s',character:{},chat:{},messages};
    await api.ensureTtsSpeakers(context,['Gorn'],()=>true,['now']);
    const chat=sent.questions[0].instructions.sources.chat;
    assert.equal(chat.length,1,'only the message being voiced');
    assert.match(chat[0],/old blacksmith Gorn[\s\S]*Back in my day, lad/,'its whole text, so his age and manner show');
    assert.doesNotMatch(chat[0],/inray::|inx1|"place"/,'never our tokens or blocks');
    assert.doesNotMatch(JSON.stringify(sent),/unrelated earlier/,'never the rest of the chat');
    // 「음성 고를 때 채팅 내용 포함」 off: the message stays home.
    data.settings.assignWithChat=false;data.characters=[];sent=null;
    await api.ensureTtsSpeakers(context,['Gorn'],()=>true,['now']);
    assert.ok(sent,'a voice is still chosen');
    assert.equal(sent.questions[0].instructions.sources.chat,undefined);
    assert.doesNotMatch(JSON.stringify(sent),/Back in my day/);
  }finally{delete globalThis.risuai;}
});

test('LLM auto-fill assigns a supplied preset and known speakers require no repeat model call',async()=>{
  let calls=0;const saved=new Map();
  globalThis.risuai={pluginStorage:{getItem:async k=>saved.get(k),setItem:async(k,v)=>saved.set(k,v)},getCurrentLorebookEntries:async()=>[{key:'하린',content:'하린은 차분한 청년 여성이다.'}],getDatabase:async()=>({personas:[]}),runLLMModel:async options=>{calls++;const data=JSON.parse(options.messages.at(-1).content);assert.deepEqual(data.requested_names,['하린']);assert.match(JSON.stringify(data.sources),/차분한/);return {success:true,content:'[[-1,"하린","","하린",["Harin"],["청년","차분한"],"female",1]]'};}};
  try{
    const data=api.ttsData();data.settings.selector='llm';data.settings.enabled=true;data.characters=[];data.voices=[{key:'female',name:'voice',fishId:voiceId,gender:'female',tags:['female','calm'],folder:''}];
    const context={scope:'llm-auto',rosterScope:'bot:llm-char',characterId:'llm-char',chatId:'llm-chat',sessionId:'llm-session',character:{},chat:{},messages:[]};
    await api.ensureTtsSpeakers(context,['하린'],()=>true);assert.equal(data.characters[0].fishId,voiceId);assert.deepEqual(data.characters[0].tags,['청년','차분한']);
    await api.ensureTtsSpeakers(context,['하린'],()=>true);assert.equal(calls,1);
  }finally{delete globalThis.risuai;}
});

test('speaker names are case-insensitive, and a deleted speaker is assigned again on the next play',async()=>{
  let calls=0;const saved=new Map();
  globalThis.risuai={pluginStorage:{getItem:async k=>saved.get(k),setItem:async(k,v)=>saved.set(k,v)},getCurrentLorebookEntries:async()=>[],getDatabase:async()=>({personas:[]}),runLLMModel:async()=>{calls++;return {success:true,content:'[[-1,"Jet","","Jet",["jet"],["calm"],"male",1001]]'};}};
  try{
    const data=api.ttsData();data.settings.selector='llm';data.settings.enabled=true;data.settings.autoAssign=true;data.characters=[];data.voices=[{key:'male',name:'voice',fishId:voiceId,gender:'male',tags:['male'],folder:''}];
    const context={scope:'case',rosterScope:'bot:case-char',characterId:'case-char',chatId:'case-chat',sessionId:'case-session',character:{},chat:{},messages:[]};
    await api.ensureTtsSpeakers(context,['JET'],()=>true);
    assert.equal(data.characters.length,1,'the model may answer "Jet" for the requested "JET"');
    assert.equal(api.resolveTtsSpeaker('jet',data.characters,context.rosterScope)?.name,'Jet');
    await api.ensureTtsSpeakers(context,['jet','JET'],()=>true);assert.equal(calls,1,'other spellings reuse the same person');
    const merged=api.mergeTtsCharacter(data.characters,{...data.characters[0],id:'other',name:'JET',triggers:['JET']});
    assert.equal(merged.length,1,'JET and Jet merge into one record');
    api.deleteTtsCharacters([data.characters[0]]);assert.equal(data.characters.length,0);
    await api.ensureTtsSpeakers(context,['Jet'],()=>true);
    assert.equal(data.characters.length,1,'playing a deleted speaker assigns a voice again instead of failing');assert.equal(calls,2);
  }finally{delete globalThis.risuai;}
});

test('LLM JSON survives reasoning blocks, fences, prose and bare keys',()=>{
  assert.deepEqual(api.parseLlmJson('<Thoughts>\n\n**Exploring Voice Candidates**\n{not json}\n</Thoughts>\n\n{0:[1022,1041,1001]}'),{0:[1022,1041,1001]});
  assert.deepEqual(api.parseLlmJson('```json\n[[0,"a, b: c"]]\n```'),[[0,'a, b: c']]);
  assert.deepEqual(api.parseLlmJson('결과입니다: {voices:[{name:"x:y",fishId:"1",tags:[],}],} 끝'),{voices:[{name:'x:y',fishId:'1',tags:[]}]});
  assert.throws(()=>api.parseLlmJson('<think>[1]</think> no json here'),/JSON/);
});

test('voice language guess follows Fish, else the title script',()=>{
  assert.deepEqual(api.guessVoiceLanguages('さくら 優しい声'),['ja']);
  assert.deepEqual(api.guessVoiceLanguages('하린 voice'),['ko']);
  assert.deepEqual(api.guessVoiceLanguages('Calm narrator'),['en']);
  assert.deepEqual(api.guessVoiceLanguages('123'),[]);
});

test('settings files never carry API keys, and importing keeps the device keys',async()=>{
  globalThis.risuai={pluginStorage:{getItem:async()=>null,setItem:async()=>{}}};
  try{
    const data=await api.loadTtsData();Object.assign(data.settings,{rate:1.5,hideName:true});data.settings.fish.key='fish-secret';data.settings.fish.routerKey='router-secret';data.settings.llm.api_key='llm-secret';data.settings.jev.key='jev-secret';data.settings.translation.key='tr-secret';
    const file=api.exportableTtsSettings(data.settings),text=JSON.stringify(file);
    for(const secret of ['fish-secret','router-secret','llm-secret','jev-secret','tr-secret'])assert.ok(!text.includes(secret),'no '+secret+' in the file');
    assert.equal(file.settings.rate,1.5);
    data.settings.rate=1;data.settings.hideName=false;
    await api.importTtsSettings(JSON.parse(text));
    assert.equal(data.settings.rate,1.5);assert.equal(data.settings.hideName,true);
    assert.equal(data.settings.fish.key,'fish-secret');assert.equal(data.settings.fish.routerKey,'router-secret');assert.equal(data.settings.llm.api_key,'llm-secret');assert.equal(data.settings.jev.key,'jev-secret');
    await assert.rejects(api.importTtsSettings({foo:1}),/TTS 설정 파일/);
  }finally{delete globalThis.risuai;}
});

test('a 402 from Fish explains that API credit is separate from the web plan', async () => {
  const { TtsHttpError } = await import('data:text/javascript;base64,' + Buffer.from((await build({ stdin: { contents: "export * from './src/providers/tts/http';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'neutral' })).outputFiles[0].text).toString('base64'));
  assert.match(new TtsHttpError(402).message, /402.*API 크레딧.*s2\.1-pro-free/);
  assert.equal(new TtsHttpError(400).message, '음성 API 요청 실패 (400)');
});
