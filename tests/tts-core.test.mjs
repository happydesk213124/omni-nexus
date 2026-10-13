import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const compiled=await build({stdin:{contents:"export * from './src/domain/tts/queue';export * from './src/domain/tts/identity';export * from './src/domain/tts/library';export * from './src/domain/tts/segment';export * from './src/config/tts-defaults';export * from './src/providers/tts/player';export * from './src/tts-ui/host-utils';",resolveDir:process.cwd()},bundle:true,write:false,format:'esm'});
const api=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const deferred=()=>{let resolve,reject;const promise=new Promise((y,n)=>{resolve=y;reject=n;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('five running Fish requests reserve slots and the latest user request precedes background',async()=>{
  const queue=new api.TtsQueue(),running=[],started=[];
  const run=id=>()=>{started.push(id);const task=deferred();running.push(task);return task.promise;};
  const jobs=Array.from({length:5},(_,i)=>queue.request('a'+i,run(i),i+1));
  const distant=queue.request('distant',run('background'),8).catch(e=>e.message);
  const click=queue.request('clicked',run('click'),0);
  await tick();assert.equal(started.length,5);
  queue.retainBackground(new Set());
  assert.equal(started.length,5,'UI cancellation must not release running server slots');
  assert.match(await distant,/준비 범위/);
  running[0].resolve('first');await tick();
  assert.deepEqual(started,[0,1,2,3,4,'click']);
  assert.equal(queue.status.active,5);
  for(const task of running)task.resolve('ok');
  await Promise.all([...jobs,click]);await tick();assert.equal(queue.status.active,0);
});

test('same synthesis in different messages joins one job, including a priority upgrade',async()=>{
  const queue=new api.TtsQueue();queue.configure(1,1);
  const occupied=deferred();const blocker=queue.request('block',()=>occupied.promise);
  let calls=0;
  const a=queue.request('same',async()=>{calls++;return 42;},10);
  const b=queue.request('same',async()=>{throw Error('must not run');},0);
  assert.equal(a,b);occupied.resolve();await blocker;
  assert.equal(await a,42);assert.equal(await b,42);assert.equal(calls,1);
});

const person=(name,surname,scope='chat')=>({id:name+scope,name,surname,givenName:'민지',surnameAliases:[],givenAliases:[],triggers:['민지'],tags:[],gender:'female',scope,voiceKey:'voice',fishId:'a'.repeat(32),fixed:false,gain:0});
test('Kim/Lee Minji remain distinct; ambiguous given name cannot merge them through a surname-less record',()=>{
  const kim=person('김민지','김'),lee=person('이민지','이');
  assert.equal(api.resolveTtsSpeaker('김민지',[kim,lee],'chat')?.id,kim.id);
  assert.equal(api.resolveTtsSpeaker('민지',[kim,lee],'chat'),null);
  assert.throws(()=>api.mergeTtsCharacter([kim,lee],person('민지','')),/성을 입력/);
  const global=person('김민지','김','global');
  assert.equal(api.resolveTtsSpeaker('김민지',[kim,global],'chat')?.id,kim.id);
  assert.equal(api.mergeTtsCharacter([kim],{...person('김민지','김'),id:'new',voiceKey:'other'}).length,1);
  const edited=api.mergeTtsCharacter([kim],{...kim,surname:'',givenName:''});
  assert.equal(edited[0].surname,'','clearing an existing identity field must not restore its old value');
  assert.equal(edited[0].givenName,'');
});

test('voice URLs, literal boolean search, and import validation preserve stable voice IDs',()=>{
  const id='4e118bfbb83e401c84699c09b5f08257';
  for(const input of [id,`https://fish.audio/ko/app/m/${id}/`,`https://fish.audio/m/${id}?x=1`])assert.equal(api.fishVoiceId(input),id);
  assert.equal(api.fishVoiceId(`https://notfish.audio/m/${id}`),'');
  const voice={name:'(하린)',fishId:id,tags:['여성','차분']};
  assert.equal(api.matchesVoiceSearch(voice,'여성 & 차분 | 남성'),true);
  assert.equal(api.matchesVoiceSearch(voice,'여성 & 밝은'),false);
  assert.equal(api.matchesVoiceSearch(voice,'('),true);
  assert.throws(()=>api.parseVoiceImport([{name:'하린',id:'bad'}]),/ID/);
  assert.deepEqual(api.parseRates('3.5,1,2.5,1',[]),[1,2.5,3.5]);
});

test('cache signatures reuse speed/volume changes but separate voice, tone, language output and normalization',()=>{
  const settings=api.ttsDefaults();
  const signature=api.synthesisSignature('안녕','happy','id',settings);
  assert.equal(signature,api.synthesisSignature('안녕','happy','id',{...settings,rate:3,volume:.2}));
  for(const [text,tone,id,config] of [['Hello','happy','id',settings],['안녕','sad','id',settings],['안녕','happy','other',settings],['안녕','happy','id',{...settings,normalize:false}]])assert.notEqual(signature,api.synthesisSignature(text,tone,id,config));
});

test('a late generation cannot play after a newer click or stop',async()=>{
  const originalAudio=globalThis.Audio, originalContext=globalThis.AudioContext;
  const playCalls=[];
  class AudioMock {
    pause(){}load(){}removeAttribute(){this.src='';}
    play(){playCalls.push(this.src);return Promise.resolve();}
  }
  class ContextMock {
    state='running';destination={};
    createGain(){return {gain:{value:0},connect(){return this;}};}
    createMediaElementSource(){return {connect(node){return node;}};}
    resume(){return Promise.resolve();}
  }
  globalThis.Audio=AudioMock;globalThis.AudioContext=ContextMock;
  try {
    const player=new api.TtsPlayer(),old=deferred(),fresh=deferred();
    const first=player.play('old',()=>old.promise);
    const second=player.play('new',()=>fresh.promise);
    fresh.resolve(new ArrayBuffer(32));await second;
    old.resolve(new ArrayBuffer(32));await first;
    assert.equal(playCalls.length,1);assert.equal(player.key,'new');
    const late=deferred();const third=player.play('pending',()=>late.promise);player.stop();late.resolve(new ArrayBuffer(32));await third;
    assert.equal(playCalls.length,1);assert.equal(player.status,'idle');
  } finally {globalThis.Audio=originalAudio;globalThis.AudioContext=originalContext;}
});


test('SafeDOM accepts native arrays without calling the wrapped-array helper',async()=>{
  const previous=globalThis.risuai;
  globalThis.risuai={unwarpSafeArray:async a=>{const result=[];for(let i=0,n=await a.length();i<n;i++)result.push(await a.at(i));return result;}};
  try {assert.deepEqual(await api.safeArray([1,2]),[1,2]);assert.deepEqual(await api.safeArray({length:async()=>2,at:async i=>i+1}),[1,2]);}
  finally {globalThis.risuai=previous;}
});

test('stopping pending activation absorbs the browser AbortError',async()=>{
  const originalAudio=globalThis.Audio,originalContext=globalThis.AudioContext,plays=[];
  class AudioMock {pause(){plays.splice(0).forEach(p=>p.reject(new DOMException('The fetching process was aborted','AbortError')));}load(){}removeAttribute(){}play(){const d=deferred();plays.push(d);return d.promise;}}
  class ContextMock {state='running';destination={};resume(){return Promise.resolve();}createGain(){return {gain:{value:0},connect(){return this;}};}createMediaElementSource(){return {connect(node){return node;}};}}
  globalThis.Audio=AudioMock;globalThis.AudioContext=ContextMock;
  try {const p=new api.TtsPlayer();const pending=p.unlock();p.stop();await assert.doesNotReject(pending);assert.equal(p.ready,false);}
  finally {globalThis.Audio=originalAudio;globalThis.AudioContext=originalContext;}
});
