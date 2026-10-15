import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {findStreamSignal,analysisBody} from '../.test-build/message-body.mjs';
import {retirePercentPlacement} from '../tools/vendor-patches/runtime-rebuild.mjs';
import {parseStreamKeywords} from '../.test-build/stream-keywords.mjs';
import {createStreamSignalScanner} from '../.test-build/stream-signal.mjs';
import {createStreamLineBatcher} from '../.test-build/stream-lines.mjs';
import {inlineShotBlocks,inlineShotLine,inlineShotTagged} from '../.test-build/inline-shots.mjs';
import {aggregateStreamLineProgress,progressToastView} from '../.test-build/viewer-core.mjs';
const source=readFileSync('tools/vendor-patches/stream-keyword-runtime.js','utf8')+'\n'+readFileSync('tools/vendor-patches/stream-lines-runtime.js','utf8')+'\n'+readFileSync('tools/vendor-patches/stream-inline-runtime.js','utf8');
const replySource=readFileSync('tools/vendor-patches/reply-runtime.js','utf8');
const tick=()=>new Promise(r=>setImmediate(r));
function fixture(card={},syncProgressToast,readScope) {
  const prose='First narrative paragraph that is long enough.\nSecond spoken dialogue.';
  const msg={role:'char',chatId:'m',data:prose},chat={id:'room',isStreaming:true,message:[{role:'user',data:'previous'},msg]};
  const scope={characterId:'c',chatId:'room',charIndex:0,chatIndex:0,sessionId:'s',chat};
  const t={backendSettings:{card:{power:true,stream_keywords_enabled:true,stream_keywords:'RP-Guide',...card}}};
  const calls=[],polls=[],galleries=[],autoGenerations=[],sounds=[],jobStates=new Map(),timers=new Map();let scans=0,seq=0,reads=0,now=Date.now(),timerWrites=0;
  const context={t,console,Promise,Date:class extends Date {static now(){return now;}},Math,setTimeout:(fn,ms)=>{timerWrites++;timers.set(++seq,{fn,ms});return seq;},clearTimeout:id=>timers.delete(id),
    clearInterval:id=>timers.delete(id),ce:async id=>galleries.push(id),onSelectionChanged:async()=>{},Se:async()=>{},syncProgressToast,
    __INLAY_VIEWER_CORE__:{aggregateStreamLineProgress},
    __INLAY_STREAM_KW__:{parseStreamKeywords,analysisBody,findStreamSignal,createStreamLineBatcher,inlineShotBlocks,inlineShotLine,inlineShotTagged,
      createStreamSignalScanner:()=>{const scanner=createStreamSignalScanner();return {scan:(...args)=>{scans++;return scanner.scan(...args);}};}},
    Z:async()=>{reads++;return readScope?readScope(scope,reads):scope;},k:{getCurrentCharacterIndex:async()=>0,getCurrentChatIndex:async()=>0,getChatFromIndex:async()=>chat},
    omniStreamOutput:()=>{},scheduleHashRelinkAfterReply:()=>{},D:async(_name,read)=>read(),w:value=>String(value),
    Be:async(scope,text,force)=>autoGenerations.push({scope,text,force}),
    nxPlayImageDoneSoundOnce:id=>{if(t.backendSettings.card.image_done_sound && !sounds.includes(id))sounds.push(id);},
    isSelectedCharRole:role=>role==='char',messageBodyChars:s=>s.length,ve:async()=>({enabled:true}),la:async()=>[],
    re:(v,_a,_b,f)=>v??f,Xe:chat=>chat.message,ye:s=>'hash:'+s,y:()=>{},ua:(...args)=>polls.push(args),
    K:async(path,options)=>{
      calls.push({path,body:options.body});
      if(path.endsWith('/create'))return {accepted:true,job_id:'j'+calls.filter(c=>c.path.endsWith('/create')).length};
      if(options.method==='GET') {
        const state=jobStates.get(path.split('/').at(-1)) || 'done';
        return typeof state==='object'?{ok:true,...state}:{ok:true,state,progress:{shot_count:1,shot_done:state==='done'?1:0}};
      }
      return {ok:true};
    }};
  runInNewContext(source+'\n'+replySource+';this.api={onScriptOutput,onChatOutput,omniCommitStreamReply,omniKeywordScope,omniCancelKeywordRun};',context);
  const fire=async(ms=1000,elapsed=ms)=>{now+=elapsed;for(const [id,row]of [...timers])if(row.ms===ms){timers.delete(id);row.fn();}await tick();};
  return {...context.api,t,scope,msg,prose,calls,polls,galleries,autoGenerations,sounds,jobStates,timers,fire,advance:ms=>now+=ms,scans:()=>scans,reads:()=>reads,timerWrites:()=>timerWrites,arg:()=>({char:{chaId:'c'},chat,messageIndex:1,characterIndex:0,chatIndex:0})};
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
const shot=(n,extra='')=>`[[inx${n}]]{"place":"room, indoor","aspect":"portrait","characters":[{"name":"Harin","action":"waving"}]${extra}}[[/inx${n}]]`;
test('streaming tags: each closed block starts one tagger-free job at its line, once; line batches and keywords stay off',async()=>{
  const f=fixture({stream_inline_tags:true,stream_lines_enabled:true,stream_lines_count:2,stream_keywords_enabled:true});
  const reply=['First narrative line, long enough to depict.',shot(1),'Second line of the scene.','Third line here. RP-Guide','[[inx2]]{"place":"ro'];
  for(let n=1;n<=reply.length;n++){f.onScriptOutput(reply.slice(0,n).join('\n'));await f.fire();}
  const creates=()=>f.calls.filter(c=>c.path.endsWith('/create'));
  assert.equal(creates().length,1,'a block still being written starts nothing; no line batch or keyword job');
  const body=creates()[0].body;
  assert.deepEqual([body.stream_line_start,body.stream_line_end,body.inline_block],[1,1,1]);
  assert.equal(body.assistant_text,'First narrative line, long enough to depict.','the job sees exactly the prose before its block');
  assert.deepEqual(body.inline_tagged.scenes[0].shots[0].characters,[{name:'Harin',action:'waving'}]);
  assert.equal(body.lorebook.length,0,'no tagger, so no lorebook read');
  const full=[...reply.slice(0,4),shot(2,',"new_characters":[{"name":"Minsu"}]'),'Last line.'];
  f.onScriptOutput(full.join('\n'));await f.fire();f.onScriptOutput(full.join('\n')+' ');await f.fire();
  assert.deepEqual(creates().map(c=>[c.body.inline_block,c.body.stream_line_start]),[[1,1],[2,3]],'block 2 follows line 3; nothing repeats');
  assert.equal(creates()[1].body.inline_tagged.new_characters[0].name,'Minsu');
  f.msg.data=full.join('\n');f.scope.chat.isStreaming=false;
  assert.equal(f.omniCommitStreamReply(f.arg(),f.msg,f.msg.data),true);await tick();
  assert.equal(creates().length,2,'completion adds no tagger job for a reply that carries blocks');
  assert.deepEqual(Array.from(f.calls.at(-1).body.job_ids),['j1','j2']);
});
test('streaming tags: a broken block keeps its slot and asks the tagger; a reply with no block yields to auto-generation',async()=>{
  const f=fixture({stream_inline_tags:true,auto_gen_on_reply:true});
  const text='Opening line of prose here.\n[[inx1]]{"place":"room"[[/inx1]]\nMore prose.';
  f.msg.data=text;f.scope.chat.isStreaming=false;
  assert.equal(f.omniCommitStreamReply(f.arg(),f.msg,text),true);await tick();
  const create=f.calls.find(c=>c.path.endsWith('/create')).body;
  assert.equal(create.inline_block,1);assert.equal(create.inline_tagged,undefined,'no shot: the job runs the tagger for this one slot');
  const g=fixture({stream_inline_tags:true,auto_gen_on_reply:true});
  g.msg.data='Plain reply without any block, long enough.';g.scope.chat.isStreaming=false;
  assert.equal(g.omniCommitStreamReply(g.arg(),g.msg,g.msg.data),false,'the ordinary reply listener owns a reply with no block');
  await tick();assert.equal(g.calls.length,0);
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

test('an entire response below 80 percent yields to ordinary reply auto-generation',async()=>{
  for(const [size,total] of [[10,7],[30,23],[50,20]]) {
    const f=fixture({stream_lines_enabled:true,stream_lines_count:size,auto_gen_on_reply:true});
    const text=Array.from({length:total},(_,i)=>`Final narrative line ${i+1}, describing a scene.`).join('\n');
    f.msg.data=text;f.scope.chat.isStreaming=false;
    assert.equal(f.omniCommitStreamReply(f.arg(),f.msg,text),false,'no line request leaves the ordinary committed listener in control');
    await tick();assert.equal(f.calls.length,0);
    assert.equal(f.omniCommitStreamReply(f.arg(),f.msg,text),false);await tick();assert.equal(f.calls.length,0);
  }
});

test('50-line mode with a 20-line reply follows the actual auto-generation toggle and character limit once',async()=>{
  for(const [enabled,limited,expected] of [[true,false,1],[false,false,0],[true,true,0]]) {
    const f=fixture({stream_lines_enabled:true,stream_lines_count:50,auto_gen_on_reply:enabled,auto_gen_char_limit_enabled:limited,auto_gen_char_limit:2000,image_min:4,image_max:4});
    const text=Array.from({length:20},(_,i)=>`Final narrative line ${i+1}, describing a scene.`).join('\n');
    f.onScriptOutput(text+'\n');await f.fire();
    assert.equal(f.calls.length,0,'no line request while streaming');
    f.msg.data=text;f.scope.chat.isStreaming=false;
    await f.onChatOutput(f.arg());await tick();
    await f.onChatOutput(f.arg());await tick();
    assert.equal(f.autoGenerations.length,expected,'real committed listener preserves ON/OFF, character threshold and dedupe');
    assert.equal(f.calls.filter(c=>c.path.endsWith('/create') || c.path.endsWith('/commit-output')).length,0);
    if(expected){assert.equal(f.autoGenerations[0].text,text);assert.equal(f.autoGenerations[0].force,false);}
    assert.equal(f.t.backendSettings.card.image_max,4,'ordinary generation keeps its general image budget');
  }
});

test('a full or qualifying final line batch blocks ordinary auto-generation even with a zero image budget',async()=>{
  for(const [total,stream,max] of [[40,false,2],[70,true,2],[50,true,0]]) {
    const f=fixture({stream_lines_enabled:true,stream_lines_count:50,stream_lines_image_min:0,stream_lines_image_max:max,auto_gen_on_reply:true});
    const text=Array.from({length:total},(_,i)=>`Final narrative line ${i+1}, describing a scene.`).join('\n');
    if(stream){f.onScriptOutput(text+'\n');await f.fire();}
    f.msg.data=text;f.scope.chat.isStreaming=false;
    await f.onChatOutput(f.arg());await tick();
    await f.onChatOutput(f.arg());await tick();
    assert.equal(f.calls.filter(c=>c.path.endsWith('/create')).length,1);
    assert.equal(f.calls.filter(c=>c.path.endsWith('/commit-output') && !c.body.cancel).length,1);
    assert.equal(f.autoGenerations.length,0,'a line tagging request already owns the reply regardless of its image count');
  }
});
test('line batches keep paid work and L ranges when the same reply body changes',async()=>{
  const f=fixture({stream_lines_enabled:true,stream_lines_count:2});
  f.onScriptOutput(f.prose+'\n');await f.fire();assert.equal(f.calls.length,1);
  const replaced='Entirely new first narrative paragraph.\nEntirely new second narrative paragraph.\n';
  f.onScriptOutput(replaced);await f.fire();
  assert.equal(f.calls.length,1,'body changes cannot restart a paid range');
  f.msg.data=replaced+'A third paragraph long enough.\nA fourth paragraph long enough.';
  f.scope.chat.isStreaming=false;
  await f.onChatOutput(f.arg());await tick();
  assert.deepEqual(f.calls.filter(c=>c.path.endsWith('/create')).map(c=>[c.body.stream_line_start,c.body.stream_line_end]),[[1,2],[3,4]]);
  assert.equal(f.calls.filter(c=>c.body.cancel).length,0);
  assert.equal(f.calls[0].body.stream_id,f.calls[1].body.stream_id);
});

test('96 prose lines at size 20 tag five ranges once and sound only after the whole reply finishes',async()=>{
 for(const enabled of [false,true]) {
  const f=fixture({stream_lines_enabled:true,stream_lines_count:20,image_done_sound:enabled});
  const lines=n=>Array.from({length:n},(_,i)=>`Narrative paragraph ${i+1}, long enough for an image.`).join('\n');
  for(const n of [20,40,60,80,96]){f.onScriptOutput('<think>hidden\nhidden again</think>\n'+lines(n)+'\n');await f.fire();}
  assert.equal(f.calls.filter(c=>c.path.endsWith('/create')).length,4);
  for(let n=1;n<=5;n++)f.jobStates.set('j'+n,'generating');
  f.msg.data=lines(96).replace('paragraph 1,','paragraph one,');f.scope.chat.isStreaming=false;
  await f.onChatOutput(f.arg());await tick();
  assert.deepEqual(f.calls.filter(c=>c.path.endsWith('/create')).map(c=>[c.body.stream_line_start,c.body.stream_line_end]),[[1,20],[21,40],[41,60],[61,80],[81,96]]);
  assert.equal(f.calls.filter(c=>c.body.cancel).length,0);
  await f.fire(1);assert.equal(f.sounds.length,0);
  for(let n=1;n<=4;n++)f.jobStates.set('j'+n,'done');
  await f.fire();assert.equal(f.sounds.length,0,'one pending image group must suppress completion sound');
  f.jobStates.set('j5','done');await f.fire();
  assert.equal(f.sounds.length,enabled?1:0);
  await f.onChatOutput(f.arg());await tick();await f.fire();
  assert.equal(f.sounds.length,enabled?1:0,'duplicate output cannot replay the sound');
 }
});

test('line groups with no generated images or a failed batch do not play a completion sound',async()=>{
 for(const state of [{state:'done',progress:{shot_count:0,shot_done:0}},{state:'error',progress:{shot_count:1,shot_done:0}}]) {
  const f=fixture({stream_lines_enabled:true,stream_lines_count:2,image_done_sound:true});
  f.onScriptOutput(f.prose+'\n');await f.fire();
  f.jobStates.set('j1',state);f.scope.chat.isStreaming=false;
  await f.onChatOutput(f.arg());await tick();await f.fire(1);
  assert.equal(f.sounds.length,0);
 }
});

test('a toast write failure cannot stop line progress, final refresh or completion sound',async()=>{
 for(const failAt of ['streaming','done']) {
  let failPaint=false,lastView;
  const f=fixture({stream_lines_enabled:true,stream_lines_count:10,image_done_sound:true},async()=>{
    if(failPaint)throw new Error('Instance not found or released');
    lastView=progressToastView(f.t.jobProgress,40000);
  });
  const text=Array.from({length:30},(_,i)=>`Narrative line ${i+1}, long enough to depict.`).join('\n');
  f.onScriptOutput(text+'\n');await f.fire();
  for(const [i,total] of [2,2,1].entries())f.jobStates.set('j'+(i+1),{state:'done',progress:{shot_count:total,shot_done:total}});
  await f.fire(1);
  assert.equal(lastView.detail,'태깅 3/3구간 · 이미지 5/5장 · 응답 출력 중');
  if(failAt==='done') {
    f.msg.data=text;f.scope.chat.isStreaming=false;
    await f.onChatOutput(f.arg());await tick();
  }
  failPaint=true;
  const timer=f.t.pollTimer, poll=f.timers.get(timer);
  assert.ok(poll,'the live group has a scheduled progress check');
  f.timers.delete(timer);
  await assert.doesNotReject(poll.fn);
  failPaint=false;
  if(failAt==='streaming') {
    assert.ok(f.timers.has(f.t.pollTimer),'a failed toast write must leave the next check scheduled');
    f.msg.data=text;f.scope.chat.isStreaming=false;
    await f.onChatOutput(f.arg());await tick();await f.fire();
    assert.equal(lastView.title,'선행 생성 완료');
    assert.doesNotMatch(lastView.detail,/응답 출력 중/);
  }
  assert.equal(f.t.jobProgress.state,'done');assert.equal(f.t.pollTimer,null);
  assert.equal(f.galleries.length,1,'completion must still refresh the saved images');
  assert.equal(f.sounds.length,1,'a toast error must not suppress the enabled completion sound');
  await f.onChatOutput(f.arg());await tick();await f.fire();
  assert.equal(f.calls.filter(call=>call.path.endsWith('/create')).length,3,'the fix cannot create more image jobs');
  assert.equal(f.calls.filter(call=>call.path.endsWith('/commit-output')).length,1);
  assert.equal(f.sounds.length,1);
 }
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

test('a temporarily unavailable line target recovers during output without losing or repeating ranges',async()=>{
 for(const rewrite of [false,true]) {
  const views=[];
  const f=fixture({stream_lines_enabled:true,stream_lines_count:20},async()=>views.push(progressToastView(f.t.jobProgress)));
  const lines=n=>Array.from({length:n},(_,i)=>`Narrative paragraph ${i+1}, long enough for an image.`).join('\n');
  f.scope.chat.isStreaming=false;
  f.onScriptOutput(lines(20)+'\n');await f.fire();
  assert.equal(f.calls.length,0);
  f.scope.chat.isStreaming=true;
  const updated=n=>rewrite?lines(n).replace('paragraph 1,','paragraph one,'):lines(n);
  f.onScriptOutput(updated(40)+'\n');await f.fire();
  assert.deepEqual(f.calls.filter(c=>c.path.endsWith('/create')).map(c=>[c.body.stream_line_start,c.body.stream_line_end]),[[1,20],[21,40]]);
  await f.fire(1);
  assert.match(views.at(-1).detail,/응답 출력 중/,'the progress toast must appear before output completes');
  for(const n of [60,80]){f.onScriptOutput(updated(n)+'\n');await f.fire();}
  assert.equal(f.calls.filter(c=>c.path.endsWith('/create')).length,4);
  f.msg.data=updated(96);f.scope.chat.isStreaming=false;
  await f.onChatOutput(f.arg());await tick();
  const requests=f.calls.filter(c=>c.path.endsWith('/create'));
  assert.deepEqual(requests.map(c=>[c.body.stream_line_start,c.body.stream_line_end]),[[1,20],[21,40],[41,60],[61,80],[81,96]]);
  assert.equal(new Set(requests.map(c=>c.body.stream_id)).size,1);
  assert.equal(f.calls.filter(c=>c.body?.cancel).length,0);
 }
});

test('unchanged snapshots retry an unbound line target without generating again at completion',async()=>{
 const f=fixture({stream_lines_enabled:true,stream_lines_count:2});
 f.scope.chat.isStreaming=false;
 f.onScriptOutput(f.prose+'\n');await f.fire();
 f.scope.chat.isStreaming=true;
 f.onScriptOutput(f.prose+'\n');await f.fire();
 assert.equal(f.calls.filter(c=>c.path.endsWith('/create')).length,1);
 f.scope.chat.isStreaming=false;
 await f.onChatOutput(f.arg());await tick();
 assert.equal(f.calls.filter(c=>c.path.endsWith('/create')).length,1);
 assert.equal(f.calls.filter(c=>c.path.endsWith('/commit-output')&&!c.body.cancel).length,1);
});

test('a delayed streaming capture cannot replace the committed message or duplicate line requests',async()=>{
 let release;
 const pending=new Promise(resolve=>{release=resolve;});
 const f=fixture({stream_lines_enabled:true,stream_lines_count:2},undefined,(scope,reads)=>reads===1?pending:scope);
 f.onScriptOutput(f.prose+'\n');await f.fire();
 assert.equal(f.calls.length,0);
 f.scope.chat.isStreaming=false;
 await f.onChatOutput(f.arg());await tick();
 assert.deepEqual(f.calls.map(c=>c.path),['/v1/jobs/create','/v1/jobs/commit-output']);
 release({...f.scope,chat:{isStreaming:true,message:[{role:'char',chatId:'old-message'}]}});
 await tick();await f.fire(1);
 assert.equal(f.calls.filter(c=>c.path.endsWith('/create')).length,1);
 assert.equal(f.calls[0].body.host_message_id,'m');
 assert.equal(f.calls.filter(c=>c.body?.cancel).length,0);
 assert.equal(f.t.jobProgress.state,'done');
 assert.equal(f.galleries.length,1);
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
