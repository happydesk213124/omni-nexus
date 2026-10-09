import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {findStreamSignal,analysisBody} from '../.test-build/message-body.mjs';
import {retirePercentPlacement} from '../tools/vendor-patches/runtime-rebuild.mjs';
import {parseStreamKeywords} from '../.test-build/stream-keywords.mjs';
import {createStreamSignalScanner} from '../.test-build/stream-signal.mjs';
import {createStreamLineBatcher} from '../.test-build/stream-lines.mjs';
const source=readFileSync('tools/vendor-patches/stream-keyword-runtime.js','utf8')+'\n'+readFileSync('tools/vendor-patches/stream-lines-runtime.js','utf8');
const tick=()=>new Promise(r=>setImmediate(r));
function fixture(card={}) {
  const prose='First narrative paragraph that is long enough.\nSecond spoken dialogue.';
  const msg={role:'char',chatId:'m',data:prose},chat={id:'room',isStreaming:true,message:[{role:'user',data:'previous'},msg]};
  const scope={characterId:'c',chatId:'room',charIndex:0,chatIndex:0,sessionId:'s',chat};
  const t={backendSettings:{card:{power:true,stream_keywords_enabled:true,stream_keywords:'RP-Guide',...card}}};
  const calls=[],polls=[],galleries=[],jobStates=new Map(),timers=new Map();let scans=0,seq=0,reads=0,now=Date.now(),timerWrites=0;
  const context={t,console,Promise,Date:class extends Date {static now(){return now;}},Math,setTimeout:(fn,ms)=>{timerWrites++;timers.set(++seq,{fn,ms});return seq;},clearTimeout:id=>timers.delete(id),
    clearInterval:id=>timers.delete(id),ce:async id=>galleries.push(id),onSelectionChanged:async()=>{},Se:async()=>{},
    __INLAY_STREAM_KW__:{parseStreamKeywords,analysisBody,findStreamSignal,createStreamLineBatcher,
      createStreamSignalScanner:()=>{const scanner=createStreamSignalScanner();return {scan:(...args)=>{scans++;return scanner.scan(...args);}};}},
    Z:async()=>{reads++;return scope;},k:{getCurrentCharacterIndex:async()=>0,getCurrentChatIndex:async()=>0},
    isSelectedCharRole:role=>role==='char',messageBodyChars:s=>s.length,ve:async()=>({enabled:true}),la:async()=>[],
    re:(v,_a,_b,f)=>v??f,Xe:chat=>chat.message,ye:s=>'hash:'+s,y:()=>{},ua:(...args)=>polls.push(args),
    K:async(path,options)=>{calls.push({path,body:options.body});return path.endsWith('/create')?{accepted:true,job_id:'j'+calls.filter(c=>c.path.endsWith('/create')).length}:options.method==='GET'?{ok:true,state:jobStates.get(path.split('/').at(-1)) || 'done',progress:{shot_done:1}}:{ok:true};}};
  runInNewContext(source+';this.api={onScriptOutput,omniCommitStreamReply,omniKeywordScope,omniCancelKeywordRun};',context);
  const fire=async(ms=1000,elapsed=ms)=>{now+=elapsed;for(const [id,row]of [...timers])if(row.ms===ms){timers.delete(id);row.fn();}await tick();};
  return {...context.api,t,scope,msg,prose,calls,polls,galleries,jobStates,timers,fire,advance:ms=>now+=ms,scans:()=>scans,reads:()=>reads,timerWrites:()=>timerWrites,arg:()=>({char:{chaId:'c'},chat,messageIndex:1,characterIndex:0,chatIndex:0})};
}

test('incoming chunks allocate only one scan timer and one idle timer per window',async()=>{
  const f=fixture();
  for(let n=0;n<10000;n++)f.onScriptOutput(f.prose+n);
  assert.equal(f.timerWrites(),2);
  await f.fire();
  for(let n=0;n<10000;n++)f.onScriptOutput(f.prose+' more '+n);
  assert.equal(f.timerWrites(),3);
  await f.fire();
  assert.equal(f.calls.length,0);
});

test('idle cleanup reschedules from activity without resetting its timer on each chunk',async()=>{
  const f=fixture();f.onScriptOutput(f.prose+'[[imgstart]]');await f.fire();
  f.advance(24000);f.onScriptOutput(f.prose+'[[imgstart]]\nMore status');
  await f.fire(30000,5000);
  assert.equal(f.calls.length,1);
  assert.ok([...f.timers.values()].some(row=>row.ms===25000));
  await f.fire(25000);assert.equal(f.calls[1].body.cancel,true);
});

test('replaced replies cancel paid attachment at the scan window or at completion before that window',async()=>{
  for(const immediate of [false,true]) {
    const f=fixture();f.onScriptOutput(f.prose+'[[imgstart]]');await f.fire();
    const replacement='Entirely different narrative that is sufficiently long. image/start';
    f.t.backendSettings.card.stream_keywords='image/start';
    f.msg.data=replacement;f.onScriptOutput(replacement);
    if(!immediate)await f.fire();
    f.omniCommitStreamReply(f.arg(),f.msg,replacement);await tick();
    assert.deepEqual(f.calls.map(call=>call.path),['/v1/jobs/create','/v1/jobs/commit-output','/v1/jobs/create','/v1/jobs/commit-output']);
    assert.equal(f.calls[1].body.cancel,true);
    assert.equal(f.calls[2].body.assistant_text,replacement.slice(0,replacement.indexOf('image/start')).trim());
  }
});
test('10,000 incoming callbacks coalesce to one scan per changed 1-second window; detection stops scans',async()=>{
  const f=fixture();
  for(let n=0;n<10000;n++)assert.equal(f.onScriptOutput(f.prose+n),f.prose+n);
  assert.equal(f.scans(),0);assert.equal(f.timers.size,2);assert.equal(f.reads(),0);
  await f.fire();assert.equal(f.scans(),1);assert.equal(f.timers.size,1);
  await f.fire();assert.equal(f.scans(),1);
  f.onScriptOutput(f.prose+'\nRP-');await f.fire();assert.equal(f.calls.length,0);
  f.onScriptOutput('<Thoughts>RP-Guide [[imgstart]]</Thoughts>\n'+f.prose+'\nRP-Guide\nSTATUS');
  await f.fire();assert.equal(f.calls.length,1);assert.equal(f.calls[0].body.assistant_text,f.prose);
  assert.equal(f.calls[0].body.recent_messages.length,1,'current accumulated message must not leak through context');
  assert.equal(f.calls[0].body.defer_attachment,true);assert.equal(f.polls.length,0);
  for(let i=0;i<10000;i++)f.onScriptOutput('<Thoughts>RP-Guide [[imgstart]]</Thoughts>\n'+f.prose+'\nRP-Guide\nSTATUS'+'x'.repeat(i));await f.fire();assert.equal(f.scans(),3);
  f.msg.data=f.prose+'\nRP-Guide\nSTATUS';
  assert.equal(f.omniCommitStreamReply(f.arg(),f.msg,f.msg.data),true);await tick();
  assert.equal(f.calls[1].path,'/v1/jobs/commit-output');assert.equal(f.polls.length,1);
  f.omniCommitStreamReply(f.arg(),f.msg,f.msg.data);await tick();assert.equal(f.calls.length,2);
  f.msg.data='[[@inrayspinner::j_0::832::1216]][[@inray::card::inxshot_test.webp]]\n'+f.msg.data;
  f.omniCommitStreamReply(f.arg(),f.msg,f.msg.data);await tick();assert.equal(f.calls.length,2,'baked output notifications must not generate again');
  assert.doesNotMatch(source,/querySelector|MutationObserver|setInterval\(|runAutoGenFromDom|scheduleAutoGenOnReply/);
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
  const f=fixture();f.onScriptOutput(f.prose+'[[imgstart]]');await f.fire();
  await f.fire(30000);assert.equal(f.calls[1].body.cancel,true);
  f.onScriptOutput(f.prose+'[[imgstart]]');await f.fire();assert.equal(f.calls[2].path,'/v1/jobs/create');
});

test('keyword OFF and ordinary chunks perform no host chat reads or generation',async()=>{
  const f=fixture({stream_keywords_enabled:false});
  for(let i=0;i<20;i++){f.onScriptOutput(f.prose+' RP-Guide '+i);await f.fire();}
  assert.equal(f.reads(),0);assert.equal(f.calls.length,0);
  await f.fire(30000);assert.equal(f.timers.size,0);
});

test('line mode sends 1-10 and 11-20 during streaming, then commits both without a tail or keyword duplicate',async()=>{
  const f=fixture({stream_lines_enabled:true,stream_lines_count:10});
  const lines=n=>Array.from({length:n},(_,i)=>`Narrative line ${i+1}, long enough to depict.`).join('\n');
  for(let n=1;n<=25;n++){f.onScriptOutput(lines(n)+'\n');await f.fire();}
  assert.deepEqual(f.calls.map(c=>[c.body.stream_line_start,c.body.stream_line_end]),[[1,10],[11,20]]);
  assert.equal(f.polls.length,0,'no UI job polling before committed output');
  assert.equal(f.reads(),1,'all sibling jobs share one captured target');
  f.msg.data=lines(25)+'\nRP-Guide\nSTATUS';f.scope.chat.isStreaming=false;
  assert.equal(f.omniCommitStreamReply(f.arg(),f.msg,f.msg.data),true);await tick();
  assert.equal(f.calls.length,3);
  assert.deepEqual(Array.from(f.calls.at(-1).body.job_ids),['j1','j2']);
  assert.equal(f.galleries.length,0);
  f.omniCommitStreamReply(f.arg(),f.msg,f.msg.data);await tick();assert.equal(f.calls.length,3);
  f.jobStates.set('j1','tagging');await f.fire(1);
  assert.equal(f.galleries.length,1);
  assert.equal(f.t.activeJobId,'j1','a later completed batch cannot end polling of the earlier tagger');
  f.jobStates.set('j1','done');await f.fire();
  assert.equal(f.galleries.length,2);assert.equal(f.t.pollTimer,null);
});
test('line mode handles a final short reply and a final burst without streaming callbacks',async()=>{
  for(const count of [8,25]) {
    const f=fixture({stream_lines_enabled:true,stream_lines_count:10,auto_gen_on_reply:true});
    f.msg.data=Array.from({length:count},(_,i)=>`Final prose line ${i+1}, describing a scene.`).join('\n');
    f.scope.chat.isStreaming=false;
    assert.equal(f.omniCommitStreamReply(f.arg(),f.msg,f.msg.data),true);await tick();
    const creates=f.calls.filter(c=>c.path.endsWith('/create'));
    assert.deepEqual(creates.map(c=>[c.body.stream_line_start,c.body.stream_line_end]),count===8?[[1,8]]:[[1,10],[11,20]]);
    assert.equal(f.calls.at(-1).path,'/v1/jobs/commit-output');
    await f.fire(1);assert.equal(f.galleries.length,1);assert.equal(f.t.pollTimer,null);
  }
});

test('final 80-percent tails create one additional global range, while smaller tails stay skipped',async()=>{
  for(const [size,tail,accepted] of [[10,7,false],[10,8,true],[30,23,false],[30,24,true]]) {
    const f=fixture({stream_lines_enabled:true,stream_lines_count:size,auto_gen_on_reply:true});
    const text=Array.from({length:size+tail},(_,i)=>`Final narrative line ${i+1}, describing a scene.`).join('\n');
    f.onScriptOutput(text+'\n');await f.fire();
    assert.equal(f.calls.filter(c=>c.path.endsWith('/create')).length,1);
    f.msg.data=text;f.scope.chat.isStreaming=false;
    assert.equal(f.omniCommitStreamReply(f.arg(),f.msg,text),true);await tick();
    assert.deepEqual(f.calls.filter(c=>c.path.endsWith('/create')).map(c=>[c.body.stream_line_start,c.body.stream_line_end]),accepted?[[1,size],[size+1,size+tail]]:[[1,size]]);
    const commits=f.calls.filter(c=>c.path.endsWith('/commit-output'));
    assert.equal(commits.length,1);assert.equal(commits[0].body.job_ids.length,accepted?2:1);
    f.omniCommitStreamReply(f.arg(),f.msg,text);await tick();assert.equal(f.calls.filter(c=>c.path.endsWith('/commit-output')).length,1);
  }
});

test('an entire response below 80 percent is handled without falling through to ordinary auto-generation',async()=>{
  for(const [size,total] of [[10,7],[30,23]]) {
    const f=fixture({stream_lines_enabled:true,stream_lines_count:size,auto_gen_on_reply:true});
    const text=Array.from({length:total},(_,i)=>`Final narrative line ${i+1}, describing a scene.`).join('\n');
    f.msg.data=text;f.scope.chat.isStreaming=false;
    assert.equal(f.omniCommitStreamReply(f.arg(),f.msg,text),true,'handled=true prevents the committed listener from creating a normal whole-reply job');
    await tick();assert.equal(f.calls.length,0);
    assert.equal(f.omniCommitStreamReply(f.arg(),f.msg,text),true);await tick();assert.equal(f.calls.length,0);
  }
});
test('line batches cancel paid work on replacement and never reuse its ranges',async()=>{
  const f=fixture({stream_lines_enabled:true,stream_lines_count:2});
  f.onScriptOutput(f.prose+'\n');await f.fire();assert.equal(f.calls.length,1);
  const replaced='Entirely new first narrative paragraph.\nEntirely new second narrative paragraph.\n';
  f.onScriptOutput(replaced);await f.fire();
  assert.equal(f.calls[1].body.cancel,true);
  assert.equal(f.calls[2].body.stream_line_start,1);
  assert.notEqual(f.calls[0].body.stream_id,f.calls[2].body.stream_id);
  f.omniCancelKeywordRun();await tick();assert.equal(f.calls.at(-1).body.cancel,true);
});

test('turning line mode off before the completion event cancels its pending ranges',async()=>{
  const f=fixture({stream_lines_enabled:true,stream_lines_count:2,stream_keywords_enabled:false});
  f.onScriptOutput(f.prose+'\n');await f.fire();assert.equal(f.calls.length,1);
  f.t.backendSettings.card.stream_lines_enabled=false;
  assert.equal(f.omniCommitStreamReply(f.arg(),f.msg,f.prose),false);await tick();
  assert.equal(f.calls.length,2);assert.equal(f.calls[1].body.cancel,true);
  assert.equal(f.galleries.length,0);
});

test('a host target unavailable during streaming can be bound once at committed output',async()=>{
  const f=fixture({stream_lines_enabled:true,stream_lines_count:2});
  f.scope.chat.isStreaming=false;
  f.onScriptOutput(f.prose+'\n');await f.fire();assert.equal(f.calls.length,0);
  assert.equal(f.omniCommitStreamReply(f.arg(),f.msg,f.prose),true);await tick();
  assert.deepEqual(f.calls.map(c=>c.path),['/v1/jobs/create','/v1/jobs/commit-output']);
  assert.equal(f.calls[0].body.stream_line_start,1);assert.equal(f.calls[0].body.stream_line_end,2);
});

test('cached viewer rows cannot cancel a newly captured streaming message',async()=>{
  const f=fixture();f.onScriptOutput(f.prose+'[[imgstart]]');await f.fire();
  assert.equal(f.calls.length,1);
  f.omniKeywordScope({...f.scope,chat:{message:[]}});await tick();
  assert.equal(f.calls.length,1);
  f.msg.data=f.prose+'[[imgstart]]';
  f.omniCommitStreamReply(f.arg(),f.msg,f.msg.data);await tick();
  assert.equal(f.calls[1].path,'/v1/jobs/commit-output');
  assert.equal(f.calls[1].body.cancel,undefined);
});
