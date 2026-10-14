import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

const built=await build({stdin:{contents:`export * from './src/services/tts-runtime';export * from './src/services/tts-characters';export * from './src/storage/tts-cache';export * from './src/storage/tts-store';export * from './src/domain/tts/segment';`,resolveDir:process.cwd()},bundle:true,write:false,format:'esm'});
const api=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const tick=()=>new Promise(r=>setImmediate(r));
async function completes(promise,label){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error(label)),1000))]);}finally{clearTimeout(timer);}}
const voiceId='4e118bfbb83e401c84699c09b5f08257';
const context={scope:'latency',rosterScope:'bot:c',characterId:'c',chatId:'chat',sessionId:'session',character:{},chat:{},messages:[]};
const request=(text,speaker='Ready')=>({context,messageId:text,segment:{id:'1',kind:'dialogue',speaker,tone:'happy',text,start:0,end:text.length}});

test('ready playback bypasses unrelated voice assignment, audio writes and translation writes',async()=>{
  const originalAudio=globalThis.Audio,originalContext=globalThis.AudioContext;
  const local=new Map(),saved=new Map(),played=[],fish=[],held=[],jev=deferred();const translateCalls=[];let blockWrites=false,reads=0,jevCalls=0;
  globalThis.Audio=class{src='';pause(){}load(){}removeAttribute(){}async play(){played.push(this.src);}};
  globalThis.AudioContext=class{state='running';destination={};createGain(){return {gain:{value:1},connect(){return this;}};}createMediaElementSource(){return {connect(node){return node;}};}};
  globalThis.risuai={pluginStorage:{getItem:async k=>saved.get(k),setItem:async(k,v)=>saved.set(k,v)},
    getLocalPluginStorage:async()=>({getItem:async k=>{if(k!=='omnitts.cache.index')reads++;return local.get(k);},setItem:async(k,v)=>{if(blockWrites){const wait=deferred();held.push(wait);await wait.promise;}local.set(k,v);},removeItem:async k=>local.delete(k),keys:async()=>[...local.keys()]}),
    getDatabase:async()=>({modules:[],enabledModules:[],personas:[]}),setDatabase:async()=>{},getCurrentLorebookEntries:async()=>[],
    nativeFetch:async(_url,options)=>{if(String(_url).includes('translate.googleapis.com')){translateCalls.push(String(_url));return {ok:true,json:async()=>[[['こんにちは']]]};}const body=JSON.parse(options.body);if(body.questions){jevCalls++;await jev.promise;return {ok:true,json:async()=>({answers:{0:{choice:'1'}}})};}fish.push(body.text);return {ok:true,data:new Uint8Array(32)};},
    runLLMModel:async()=>({success:true,content:'[[0,"Hello"]]'})};
  let assigning;
  try{
    const data=await api.loadTtsData();data.settings.translation.provider='off';Object.assign(data.settings,{enabled:true,autoAssign:true,selector:'jev',continuous:false});data.settings.fish.key='fake';data.settings.jev.key='fake';
    data.voices=[{key:'voice',name:'voice',fishId:voiceId,gender:'female',tags:[],folder:''}];
    data.characters=[{...api.blankTtsCharacter('global','Ready'),fishId:voiceId,voiceKey:'voice'}];
    const runtime=new api.OmniTtsRuntime();await runtime.init();
    const warm=request('cached');await runtime.cache.put(api.synthesisSignature(warm.segment.text,'happy',voiceId,data.settings),new ArrayBuffer(32));
    assigning=api.ensureTtsSpeakers(context,['Unknown'],()=>true);
    while(!jevCalls)await tick();
    const beforeReads=reads;
    await completes(runtime.play([warm],0),'cached voice waited for unrelated JEV');
    assert.equal(runtime.player.status,'playing');assert.equal(fish.length,0);assert.equal(reads,beforeReads,'warm bytes do not cross the storage bridge');
    blockWrites=true;
    await completes(runtime.play([request('fresh')],0),'playback waited for audio persistence');
    while(!held.length)await tick();
    assert.equal(runtime.player.status,'playing');await tick();assert.equal(runtime.queue.status.active,0,'storage cannot occupy a Fish slot');
    await completes(runtime.play([{...request('fresh'),messageId:'duplicate'}],0),'pending cached bytes were not reusable');
    assert.deepEqual(fish,['[happy]fresh'],'duplicate playback joins pending cache data without another Fish request');
    // Known voices must also prefetch while a new speaker waits for JEV.
    const prefetch=runtime.prefetch([request('prefetched'),request('unknown','Unknown')]);
    await completes((async()=>{while(!fish.includes('[happy]prefetched'))await tick();})(),'known prefetch waited for unknown speaker');
    jev.resolve();await assigning;await prefetch;
    data.settings.translation.provider='llm';
    await completes(runtime.play([request('translated')],0),'translation persistence blocked synthesis/playback');
    assert.ok(fish.includes('[happy]Hello'));assert.equal(runtime.player.status,'playing');
    // Translation OFF, but this character has its own language: only its lines are translated.
    data.settings.translation.provider='off';data.characters[0].language='ja';
    await completes(runtime.play([request('per character')],0),'per-character translation blocked playback');
    assert.ok(fish.includes('[happy]こんにちは'),'the character language translates through key-free Google');
    assert.ok(translateCalls.some(u=>u.includes('tl=ja')),'its own target language is used');
    data.characters[0].language='';await completes(runtime.play([request('untranslated line')],0),'plain line');
    assert.ok(fish.includes('[happy]untranslated line'),'without a character language, OFF means no translation');
    const beforeExcluded=fish.length;
    await runtime.play([request('응.')],0);
    await runtime.prefetch([request('A.'),request('え？')]);
    data.settings.excludeText='[차단]';
    await runtime.play([request('[차단] 들리지 않아야 합니다.')],0);
    await runtime.prefetch([request('[차단] 들리지 않아야 합니다.')]);
    assert.equal(fish.length,beforeExcluded,'direct requests and background generation apply the same single-character and literal exclusions');
    runtime.stop();runtime.reading([request('응.'),request('[차단] 문장입니다.'),request('읽을 문장입니다.')]);
    assert.deepEqual(runtime.list.map(r=>r.segment.text),['읽을 문장입니다.']);data.settings.excludeText='';
    runtime.stop();blockWrites=false;held.splice(0).forEach(wait=>wait.resolve());await tick();
    assert.equal(played.length,6);
  }finally{jev.resolve();blockWrites=false;held.forEach(wait=>wait.resolve());await assigning?.catch(()=>{});delete globalThis.risuai;globalThis.Audio=originalAudio;globalThis.AudioContext=originalContext;}
});

test('audio memory stays bounded, cold reads bypass writes, and clearing invalidates pending bytes',async()=>{
  const local=new Map();let reads=0,held;const started=deferred();
  globalThis.risuai={getLocalPluginStorage:async()=>({getItem:async k=>{reads++;return local.get(k);},setItem:async(k,v)=>{if(held){started.resolve();await held.promise;}local.set(k,v);},removeItem:async k=>local.delete(k),keys:async()=>[...local.keys()]})};
  try{
    const cache=new api.TtsAudioCache();await cache.configure(100);
    for(const key of ['a','b','c'])await cache.put(key,new ArrayBuffer(3*1024*1024));
    const before=reads;await cache.get('a');assert.equal(reads,before+1,'oldest bytes were evicted from the 8 MB memory tier');
    await cache.get('a');assert.equal(reads,before+1,'recent replay reuses memory');
    held=deferred();const write=cache.put('pending',new ArrayBuffer(32));await started.promise;
    assert.equal((await completes(cache.get('b'),'cold cached read queued behind a write')).byteLength,3*1024*1024);
    assert.equal((await cache.get('pending')).byteLength,32);
    const clearing=cache.clear();assert.equal(cache.has('pending'),false);
    held.resolve();held=undefined;await write;await clearing;
    assert.equal(await cache.get('pending'),null);assert.equal(cache.count,0);
  }finally{held?.resolve();delete globalThis.risuai;}
});
