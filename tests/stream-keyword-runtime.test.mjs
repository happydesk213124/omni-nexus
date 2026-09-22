import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {findStreamSignal,analysisBody} from '../.test-build/message-body.mjs';
import {retirePercentPlacement} from '../tools/vendor-patches/runtime-rebuild.mjs';
import {parseStreamKeywords} from '../.test-build/stream-keywords.mjs';
const source=readFileSync('tools/vendor-patches/stream-keyword-runtime.js','utf8');
const tick=()=>new Promise(r=>setImmediate(r));
function fixture(card={}) {
  const prose='First narrative paragraph that is long enough.\nSecond spoken dialogue.';
  const msg={role:'char',chatId:'m',data:prose},chat={id:'room',isStreaming:true,message:[{role:'user',data:'previous'},msg]};
  const scope={characterId:'c',chatId:'room',charIndex:0,chatIndex:0,sessionId:'s',chat};
  const t={backendSettings:{card:{power:true,stream_keywords_enabled:true,stream_keywords:'RP-Guide',...card}}};
  const calls=[],polls=[],timers=new Map();let scans=0,seq=0;
  const context={t,console,Promise,Date,Math,setTimeout:(fn,ms)=>{timers.set(++seq,{fn,ms});return seq;},clearTimeout:id=>timers.delete(id),
    __INLAY_STREAM_KW__:{parseStreamKeywords,analysisBody,findStreamSignal:(...args)=>{scans++;return findStreamSignal(...args);}},
    omniStreamHint:()=>{},Z:async()=>scope,k:{getCurrentCharacterIndex:async()=>0,getCurrentChatIndex:async()=>0},
    isSelectedCharRole:role=>role==='char',messageBodyChars:s=>s.length,ve:async()=>({enabled:true}),la:async()=>[],
    re:(v,_a,_b,f)=>v??f,Xe:chat=>chat.message,ye:s=>'hash:'+s,y:()=>{},ua:(...args)=>polls.push(args),
    K:async(path,options)=>{calls.push({path,body:options.body});return path.endsWith('/create')?{accepted:true,job_id:'j'}:{ok:true};}};
  runInNewContext(source+';this.api={onScriptOutput,omniCommitStreamReply,omniKeywordScope,omniCancelKeywordRun,omniKeywordStreamEnded};',context);
  const fire=async(ms=1000)=>{for(const [id,row]of [...timers])if(row.ms===ms){timers.delete(id);row.fn();}await tick();};
  return {...context.api,t,scope,msg,prose,calls,polls,timers,fire,scans:()=>scans,arg:()=>({char:{chaId:'c'},chat,messageIndex:1,characterIndex:0,chatIndex:0})};
}
test('10,000 incoming callbacks coalesce to one scan per changed 1-second window; detection stops scans',async()=>{
  const f=fixture();
  for(let n=0;n<10000;n++)assert.equal(f.onScriptOutput(f.prose+n),f.prose+n);
  assert.equal(f.scans(),0);assert.equal(f.timers.size,1);
  await f.fire();assert.equal(f.scans(),1);assert.equal(f.timers.size,0);
  await f.fire();assert.equal(f.scans(),1);
  f.onScriptOutput(f.prose+'\nRP-');await f.fire();assert.equal(f.calls.length,0);
  f.onScriptOutput('<Thoughts>RP-Guide [[imgstart]]</Thoughts>\n'+f.prose+'\nRP-Guide\nSTATUS');
  await f.fire();assert.equal(f.calls.length,1);assert.equal(f.calls[0].body.assistant_text,f.prose);
  assert.equal(f.calls[0].body.recent_messages.length,1,'current accumulated message must not leak through context');
  assert.equal(f.calls[0].body.defer_attachment,true);assert.equal(f.polls.length,0);
  for(let i=0;i<10000;i++)f.onScriptOutput('later '+i);await f.fire();assert.equal(f.scans(),3);
  f.msg.data=f.prose+'\nRP-Guide\nSTATUS';
  assert.equal(f.omniCommitStreamReply(f.arg(),f.msg,f.msg.data),true);await tick();
  assert.equal(f.calls[1].path,'/v1/jobs/commit-output');assert.equal(f.polls.length,1);
  f.omniCommitStreamReply(f.arg(),f.msg,f.msg.data);await tick();assert.equal(f.calls.length,2);
  f.msg.data='[[@inrayspinner::j_0::832::1216]][[@inray::card::inxshot_test.webp]]\n'+f.msg.data;
  f.omniCommitStreamReply(f.arg(),f.msg,f.msg.data);await tick();assert.equal(f.calls.length,2,'baked output notifications must not generate again');
  assert.doesNotMatch(source,/querySelector|MutationObserver|setInterval|runAutoGenFromDom|scheduleAutoGenOnReply/);
});

test('percent retirement build guard rejects missing or drifted frozen viewer readers',()=>{
  const expressions=['c?.y_percent ?? c?.anchor_percent ?? c?.read_percent','e?.y_percent ?? e?.anchor_percent ?? e?.read_percent','Q.y_percent ?? Q.anchor_percent ?? Q.read_percent'];
  const fixture=[expressions[0],expressions[0],expressions[1],expressions[1],expressions[2]].join('\n');
  assert.doesNotMatch(retirePercentPlacement(fixture),/y_percent/);
  assert.throws(()=>retirePercentPlacement(fixture.replace(expressions[2],'changed')),/percent placement drift/);
  assert.throws(()=>retirePercentPlacement(''),/percent placement drift/);
});
test('built-in marker triggers at final output without intermediate callbacks or keyword toggle',async()=>{
  const f=fixture({stream_keywords_enabled:false,auto_gen_on_reply:false});
  f.msg.data=f.prose+'\n[[imgstart]]\nSTATUS';f.scope.chat.isStreaming=false;
  assert.equal(f.omniCommitStreamReply(f.arg(),f.msg,f.msg.data),true);await tick();
  assert.deepEqual(f.calls.map(c=>c.path),['/v1/jobs/create','/v1/jobs/commit-output']);
  assert.equal(f.calls[0].body.assistant_text,f.prose);
});
test('thought-only signals do nothing; switching chats cancels without attaching',async()=>{
  const f=fixture();f.onScriptOutput('<think>'+f.prose+' [[imgstart]]');await f.fire();assert.equal(f.calls.length,0);
  f.onScriptOutput(f.prose+'[[imgstart]]');await f.fire();assert.equal(f.calls.length,1);
  f.omniKeywordScope({...f.scope,chatId:'other'});await tick();
  assert.equal(f.calls[1].body.cancel,true);assert.equal(f.polls.length,0);
});
test('abort expiry cancels a pending job, and a later stream can start afresh',async()=>{
  const f=fixture();f.onScriptOutput(f.prose+'[[imgstart]]');await f.fire();f.omniKeywordStreamEnded();
  await f.fire(30000);assert.equal(f.calls[1].body.cancel,true);
  f.onScriptOutput(f.prose+'[[imgstart]]');await f.fire();assert.equal(f.calls[2].path,'/v1/jobs/create');
});
