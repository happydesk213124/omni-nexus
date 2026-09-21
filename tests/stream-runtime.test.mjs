import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../tools/vendor-patches/stream-runtime.js',import.meta.url),'utf8');
function fixture(code=source) {
  let now=10000, reads=0, serial=0, ci=0, paused=true;
  const timers=new Map(), events=[];
  const scope=()=>({charIndex:ci,chatIndex:0,sessionId:'s'+ci,chatId:'chat'+ci,chat:{id:'chat'+ci,isStreaming:paused}});
  const t={lastScope:scope()};
  const deps={t,k:{getCurrentCharacterIndex:async()=>ci,getCurrentChatIndex:async()=>0,getChatFromIndex:async()=>{reads++;return scope().chat;}},
    Z:async()=>scope(),Date:{now:()=>now},setTimeout:(fn,ms)=>{timers.set(++serial,{fn,ms});return serial;},clearTimeout:id=>timers.delete(id),
    nxUnwrapSafeNodes:async raw=>raw.rows,
    omniScheduleFooter:()=>events.push('footer'),nxFloatScheduleScan:()=>events.push('viewer'),
  };
  const api=new Function(...Object.keys(deps),`
    let omniFooterTimer=0,omniFooterQueued=false,nxFloatScanTimer=0,nxFloatScanAgain=false;
    let omniFooterObserver=null,omniFooterRoot=null,nxFloatObserver=null,nxFloatWatchRoot=null;
    let nxFloatReadingIndex=-1,nxFloatStructureDirty=true;
    const omniFooterTargets=new Map(),nxFloatKey=-1,nxSpinnerPreviews=new Map();
    ${code}
    return {read:omniReadScope,hint:omniStreamHint,output:omniStreamOutput,dispose:omniStreamDispose,
      state:omniStream,dom:omniDomScope,observers:omniStreamObservers,
      preview:()=>nxSpinnerPreviews.set('p',{}),
      installObservers:o=>{omniFooterObserver=o;omniFooterRoot={};nxFloatObserver=o;nxFloatWatchRoot={};}};
  `)(...Object.values(deps));
  return {api,t,events,timers,reads:()=>reads,setPaused:v=>paused=v,setChar:v=>ci=v,
    tick:async()=>{now+=1000;const tasks=[...timers.values()];timers.clear();for(const task of tasks)task.fn();await new Promise(r=>setImmediate(r));}};
}
test('stream chunks share one snapshot and one recovery timer; cancel resumes without output event',async()=>{
  const f=fixture();
  await Promise.all(Array.from({length:100},()=>f.api.read()));
  assert.equal(f.reads(),1);
  for(let i=0;i<1000;i++)f.api.hint();
  assert.equal(f.reads(),1);assert.equal(f.timers.size,1);assert.equal(f.api.state.paused,true);
  f.setPaused(false);await f.tick();
  assert.equal(f.reads(),2);assert.equal(f.api.state.paused,false);assert.equal(f.timers.size,0);
  assert.deepEqual(f.events,['footer','viewer']);
});
test('completion in a different chat cannot resume an actively streaming visible chat',async()=>{
  const f=fixture();await f.api.read();f.api.output();await new Promise(r=>setImmediate(r));
  assert.equal(f.api.state.paused,true);assert.deepEqual(f.events,[]);
  f.setChar(1);f.setPaused(false);await f.tick();
  assert.equal(f.api.state.scope.sessionId,'s1');assert.equal(f.api.state.paused,false);
});
test('unload rejects a late scope result and clears recovery timers',async()=>{
  const f=fixture();const pending=f.api.read();f.t.unloading=true;f.api.dispose();await pending;
  assert.equal(f.api.state.scope,null);assert.equal(f.timers.size,0);assert.deepEqual(f.events,[]);
});
test('DOM ownership releases arrays and temporaries, preserving an explicitly retained root',async()=>{
  const f=fixture(),released=[];
  const ref=id=>({release:async()=>released.push(id)});
  for(let i=0;i<100;i++){
    const refs=f.api.dom(),root=refs.own(ref('root'));
    refs.keep(root);refs.own(ref('temporary'));
    await refs.all({...ref('array'),rows:[ref('child')]});await refs.close();await refs.close();
  }
  assert.equal(released.length,300);assert.equal(released.includes('root'),false);
});
test('stream disconnects scanning but preserves the existing preview repaint observer',async()=>{
  const f=fixture(),calls=[];
  f.api.installObservers({observe:async()=>calls.push('observe'),disconnect:async()=>calls.push('disconnect')});
  await f.api.read();await new Promise(r=>setImmediate(r));
  assert.deepEqual(calls,['disconnect','disconnect']);
  calls.length=0;f.api.preview();await f.api.observers();
  assert.deepEqual(calls,['observe','disconnect']);
});
test('ownership regression guard detects a deliberately removed release',async()=>{
  const f=fixture(source.replace('await omniRelease(ref);','void ref;'));
  let released=0;const refs=f.api.dom();refs.own({release:async()=>released++});await refs.close();
  assert.throws(()=>assert.equal(released,1),assert.AssertionError);
});
test('single-flight regression guard detects deliberately overlapping reads',async()=>{
  const f=fixture(source.replace('if(omniStream.pending)return omniStream.pending;',''));
  await Promise.all(Array.from({length:10},()=>f.api.read()));
  assert.throws(()=>assert.equal(f.reads(),1),assert.AssertionError);
});
