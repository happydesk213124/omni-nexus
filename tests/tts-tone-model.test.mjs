import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

const built=await build({stdin:{contents:`export * from './src/services/tts-runtime';export * from './src/services/tts-characters';export * from './src/storage/tts-store';export * from './src/domain/tts/segment';export * from './src/config/tts-defaults';`,resolveDir:process.cwd()},bundle:true,write:false,format:'esm'});
const api=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const tick=()=>new Promise(r=>setImmediate(r));
const voiceA='4e118bfbb83e401c84699c09b5f08257',voiceB='0123456789abcdef0123456789abcdef';
const context={scope:'tone',rosterScope:'global',characterId:'c',chatId:'chat',sessionId:'session',character:{},chat:{},messages:[]};
const line=(speaker,tone,text)=>({context,messageId:text,segment:{id:text,kind:'dialogue',speaker,tone,text,start:0,end:text.length}});

test('a line keeps its own delivery first, then the speaker\'s base delivery; four cues at most, each once', () => {
  assert.equal(api.speechTone('angry', 'husky, slow'), 'angry, husky, slow');
  assert.equal(api.speechTone('happy, sad, curious', 'soft tone'), 'happy, sad, soft tone', 'the line keeps two of its own, as before');
  assert.equal(api.speechTone('calm', 'calm, slow'), 'calm, slow', 'a cue is not doubled');
  assert.equal(api.speechTone('angry, loud', 'a, b, c, d'), 'angry, loud, a, b', 'four in all');
  assert.equal(api.speechTone('happy, sad, curious', ''), 'happy, sad, curious', 'no base: the tone stays exactly as written, so cached audio keeps its key');
  assert.equal(api.speechTone('happy', '부드럽게, 느리게'), 'happy', 'only English cues reach Fish');
  assert.equal(api.fishText('안녕', 'angry, husky, slow'), '[angry][husky][slow]안녕');
  assert.equal(api.ttsDefaults().tone, '', 'no global base delivery until one is set');
});

test('each character speaks with its own base delivery and model; the settings\' ones fill in', async () => {
  const saved=new Map(),local=new Map(),fish=[];
  globalThis.Audio=class{src='';pause(){}load(){}removeAttribute(){}async play(){}};
  globalThis.AudioContext=class{state='running';destination={};createGain(){return {gain:{value:1},connect(){return this;}};}createMediaElementSource(){return {connect(node){return node;}};}};
  globalThis.risuai={pluginStorage:{getItem:async k=>saved.get(k),setItem:async(k,v)=>saved.set(k,v)},
    getLocalPluginStorage:async()=>({getItem:async k=>local.get(k),setItem:async(k,v)=>local.set(k,v),removeItem:async k=>local.delete(k),keys:async()=>[...local.keys()]}),
    getDatabase:async()=>({modules:[],enabledModules:[],personas:[]}),setDatabase:async()=>{},getCurrentLorebookEntries:async()=>[],
    nativeFetch:async(url,options)=>{const body=JSON.parse(options.body);fish.push({url:String(url),model:options.headers.model??body.model,text:body.text??body.input,voice:body.reference_id??body.voice});return {ok:true,data:new Uint8Array(32)};}};
  try{
    const data=await api.loadTtsData();Object.assign(data.settings,{enabled:true,autoAssign:false,continuous:false,tone:'calm'});data.settings.translation.provider='off';data.settings.fish.key='fake';data.settings.fish.model='s2.1-pro';
    data.characters=[{...api.blankTtsCharacter('global','하린'),fishId:voiceA,tone:'husky, slow',model:'drama-3'},{...api.blankTtsCharacter('global','민수'),fishId:voiceB}];
    const runtime=new api.OmniTtsRuntime();await runtime.init();
    const say=async request=>{const before=fish.length;await runtime.play([request],0);while(fish.length===before)await tick();return fish.at(-1);};
    const harin=await say(line('하린','angry','그만해'));
    assert.equal(harin.text,'[angry][husky][slow]그만해','the line\'s delivery, then the character\'s base');
    assert.equal(harin.model,'drama-3','the character\'s own model');
    const minsu=await say(line('민수','happy','좋아'));
    assert.equal(minsu.text,'[happy][calm]좋아','no base of their own: the settings\' base delivery');
    assert.equal(minsu.model,'s2.1-pro','no model of their own: the model settings');
    // The same words in another model are other audio: the cache keeps them apart.
    data.characters[1].model='s1';
    const again=await say({...line('민수','happy','좋아'),messageId:'again'});
    assert.equal(again.model,'s1','a changed model is synthesized again, not served from the cache');
    // Through OpenRouter the per-character model is the router model name.
    data.settings.fish.via='openrouter';data.settings.fish.routerKey='or-key';
    const routed=await say(line('하린','sad','왜 그래'));
    assert.equal(routed.model,'fish-audio/drama-3');assert.equal(routed.text,'[sad][husky][slow]왜 그래');
    // Parentheses: the marks never reach Fish (it reads (..) as a tag); the words inside go only with the toggle off.
    data.settings.tone='';data.characters[0].tone='';
    assert.equal((await say(line('하린','','그는 (작게) 웃었다'))).text,'그는 작게 웃었다','by default the words inside are read');
    data.settings.omitParenText=true;
    assert.equal((await say(line('하린','','그녀는 (조용히) 웃었다'))).text,'그녀는 웃었다','「괄호 안의 말도 빼고 읽기」 drops them whole');
    data.settings.omitParenText=false;data.characters[0].tone='husky, slow';
    // A preview carries the popup's unsaved base delivery and model.
    const preview=await say({context,messageId:'audition',fishId:voiceB,tone:'whispering',model:'s2-pro',segment:{id:voiceB,kind:'audition',speaker:'',tone:'',text:'안녕하세요',start:0,end:0}});
    assert.equal(preview.text,'[whispering]안녕하세요');assert.equal(preview.model,'fish-audio/s2-pro');
  }finally{delete globalThis.risuai;}
});
