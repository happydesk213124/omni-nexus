import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const compiled=await build({stdin:{contents:"export * from './src/domain/tts/queue';export {hasTtsSpeech} from './src/domain/tts/filter';export * from './src/domain/tts/identity';export * from './src/domain/tts/library';export * from './src/domain/tts/segment';export * from './src/config/tts-defaults';export * from './src/providers/tts/player';export * from './src/tts-ui/host-utils';",resolveDir:process.cwd()},bundle:true,write:false,format:'esm'});
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

test('illustration speakers map to TTS characters by trigger words, then surname and given name',()=>{
  const tts=(id,name,o={})=>({id,name,surname:'',givenName:'',surnameAliases:[],givenAliases:[],triggers:[name],tags:[],gender:'unknown',scope:'bot:b',voiceKey:'',fishId:'',fixed:false,gain:0,...o});
  const roster=[tts('1','Bomin'),tts('2','Mashal',{triggers:['Mashal','마샬']}),tts('3','Zet Kim',{surname:'Kim',givenName:'Zet',triggers:['Zet']}),tts('4','Zet Park',{surname:'Park',givenName:'Zet',triggers:['Zet']})];
  const m=(person)=>api.matchIllustrationSpeaker(person,roster,'bot:b')?.id||null;
  assert.equal(m({name:'보민',aliases:['Bomin','보민']}),'1','an English trigger word links the Korean display name');
  assert.equal(m({name:'마샬',aliases:[]}),'2','a Korean trigger on the TTS side works too');
  assert.equal(m({name:'제트',aliases:['Zet'],surname:'박',surname_variants:['Park'],given_name:'제트',given_name_variants:['Zet']}),'4','a shared trigger is settled by surname');
  assert.equal(m({name:'민지',aliases:[],surname:'김',surname_variants:['Kim'],given_name:'민지',given_name_variants:['Minji']}),null,'a surname alone never picks someone');
  assert.equal(m({name:'제트',aliases:[],surname:'김',surname_variants:['Kim'],given_name:'제트',given_name_variants:['Zet']}),'3','without a trigger, given name plus surname finds the person');
});

test('per-character gain applies only when automatic loudness is switched off',()=>{
  assert.equal(api.ttsCharacterGain({gain:-6,autoGain:true}),0,'auto ignores a stored correction');
  assert.equal(api.ttsCharacterGain({gain:-6,autoGain:false}),-6);
  assert.equal(api.ttsCharacterGain({gain:4}),4,'older rows with a correction keep it');
  assert.equal(api.ttsCharacterGain({gain:0}),0);
});

test('a JEV pick fills only an empty tag list and an unknown gender',()=>{
  const c={tags:[],gender:'unknown'};api.adoptVoiceTags(c,{tags:['calm'],gender:'female'});assert.deepEqual(c,{tags:['calm'],gender:'female'});
  const set={tags:['bright'],gender:'male'};api.adoptVoiceTags(set,{tags:['calm'],gender:'female'});assert.deepEqual(set,{tags:['bright'],gender:'male'},'known values stay');
  const vague={tags:[],gender:'unknown'};api.adoptVoiceTags(vague,{tags:[],gender:'unknown'});assert.deepEqual(vague,{tags:[],gender:'unknown'});
});


test('role cards: narrator and monologue always exist, bot cards follow the global ones until switched off',()=>{
  const voices=[{key:'v1',fishId:'f1'}];
  let roster=api.ensureTtsRoleCards([],'global',voices,'v1');
  assert.deepEqual(roster.map(c=>[c.role,c.scope]),[['narrator','global'],['monologue','global']]);
  assert.equal(roster[0].fishId,'f1','the saved narration voice moves onto the global narrator card');
  assert.equal(api.ensureTtsRoleCards(roster,'global'),roster,'nothing is added twice');
  roster=api.ensureTtsRoleCards(roster,'bot:a');
  assert.equal(roster.length,4);
  const bot=roster.find(c=>c.role==='monologue'&&c.scope==='bot:a'),global=roster.find(c=>c.role==='monologue'&&c.scope==='global');
  assert.equal(api.resolveTtsRole('monologue',roster,'bot:a').id,global.id,'following the global card by default');
  bot.followGlobal=false;
  assert.equal(api.resolveTtsRole('monologue',roster,'bot:a').id,bot.id,'its own card once following is off');
  assert.equal(api.resolveTtsRole('monologue',roster,'bot:b').id,global.id,'other bots keep the global card');
  const person={...bot,id:'p',role:undefined,name:'Jet',triggers:['Jet'],voiceKey:'v9',fishId:'f9',gain:3};
  bot.followId='p';roster.push(person);
  assert.equal(api.resolveTtsRole('monologue',roster,'bot:a').fishId,'f9','a role card can borrow an ordinary character voice');
  assert.equal(api.resolveTtsSpeaker('나레이션',roster,'bot:a'),null,'role cards are never matched by speaker name');
  assert.equal(api.ttsSegmentOwner({kind:'dialogue',speaker:'',monologue:true},roster,'bot:a').fishId,'f9');
  assert.equal(api.ttsSegmentOwner({kind:'narration',speaker:''},roster,'bot:a').role,'narrator');
});

test('a whole line in single quotes without a speaker is a monologue; emphasis inside prose is not',()=>{
  const line="'반사적으로 속마음이 튀어나왔잖아 바보야! don't panic!'";
  const parsed=api.parseCueLine(line,'a');
  assert.equal(parsed.kind,'dialogue');assert.equal(parsed.monologue,true);assert.equal(parsed.speaker,'');
  assert.equal(parsed.text,"반사적으로 속마음이 튀어나왔잖아 바보야! don't panic!");
  assert.equal(api.parseCueLine("그는 '이건 아니야' 하고 생각했다.",'a').kind,'narration');
  assert.equal(api.parseCueLine("Jet: 'Thought'",'a').speaker,'Jet');
  assert.equal(api.parseCueLine("'a' and 'b'",'a'),null,'several quoted parts are not one thought');
});

test('a voice pick fills the gender only while it is unknown; 기타 characters keep theirs',()=>{
  const fill=gender=>{const c={tags:[],gender};api.adoptVoiceTags(c,{tags:['calm'],gender:'female'});return c;};
  assert.equal(fill('unknown').gender,'female');assert.deepEqual(fill('unknown').tags,['calm']);
  assert.equal(fill('other').gender,'other');assert.equal(fill('male').gender,'male');
});

test('a limit of 0 keeps every line that has at least one spoken character',()=>{
  assert.equal(api.hasTtsSpeech('네',1),false);assert.equal(api.hasTtsSpeech('네',0),true);
  assert.equal(api.hasTtsSpeech('…!?',0),false,'punctuation alone is still not speech');
  assert.equal(api.hasTtsSpeech('',0),false);
});
