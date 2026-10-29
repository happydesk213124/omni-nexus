import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transform} from 'esbuild';

const source = readFileSync(new URL('../src/services/jobs.ts', import.meta.url), 'utf8').replace(/\r\n/g,'\n');
function between(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `missing job boundary: ${start}`);
  return source.slice(a, b);
}
async function compile(body, scope) {
  const {code} = await transform(body, {loader:'ts',format:'cjs',target:'es2022'});
  return new Function(...Object.keys(scope), code)(...Object.values(scope));
}
const finishBody = between('  const bakedSpinnerShots =', "  try {\n    if (await cancelJobIfStale(jobId, 'superseded before start'))");

for (const mode of ['success','error','stop','superseded','stopped-then-superseded']) {
  test(`job per-slot completion handles ${mode} without repainting a newer epoch`, async () => {
    const calls = [];
    const meta = {key:'message',epoch:1,publishedIds:['a','b'],cancelRequested:mode.includes('stop'),userStop:mode.includes('stop')};
    const scope = {
      deferred:undefined,durableSpinners:true, completedSpinnerCards:new Map([[1,'b'],[0,'a']]),jobId:'old',request:{},
      jobRunMeta:new Map([['old',meta]]),
      jobEpochByKey:new Map([['message',{jobId:mode.includes('superseded')?'new':'old',epoch:mode.includes('superseded')?2:1}]]),
      enqueueBakeWrite: async work => work(), jobChatTarget: () => ({}),
      // A message's own tag job wrote its slots pink: their images go in as one write of those slots.
      finishJobSpinners: async () => { throw new Error('a message job has no spinner to finish'); },
      writeWaitImages: async (_target, slots) => {calls.push({cards:slots});return slots.map(slot=>slot.waitId);},
      inlineWait:'', deferWait:false, writeWaitImage: async () => { throw new Error('a message job never writes one slot image'); },
    };
    const finish = await compile(`${finishBody}\nreturn finishCompletedSpinners;`, scope);
    const expected = !mode.includes('superseded');
    assert.equal(await finish(), expected);
    assert.equal(await finish(), false, 'already published slots must not be rewritten at completion');
    assert.equal(calls.length, expected ? 1 : 0);
    if (expected) {
      assert.deepEqual(calls[0].cards,[{waitId:'old_0',cardId:'a'},{waitId:'old_1',cardId:'b'}]);
      assert.deepEqual(meta.publishedIds,[]);
    } else assert.deepEqual(meta.publishedIds,['a','b']);
  });
}

test('a tapped slot is written once, at the end: its image replaces the slot, no spinner is finished', async () => {
  const images = [], spinners = [];
  const meta = {key:'wait',epoch:1,publishedIds:['a'],cancelRequested:false,userStop:false};
  const scope = {
    deferred:undefined,durableSpinners:true,completedSpinnerCards:new Map([[0,'a']]),jobId:'tap',request:{},inlineWait:'b2',deferWait:false,
    jobRunMeta:new Map([['tap',meta]]),jobEpochByKey:new Map([['wait',{jobId:'tap',epoch:1}]]),
    enqueueBakeWrite: async work => work(), jobChatTarget: () => ({target:1}),
    finishJobSpinners: async opts => {spinners.push(opts);return true;},
    writeWaitImage: async opts => {images.push(opts);return true;},
  };
  const finish = await compile(`${finishBody}
return finishCompletedSpinners;`, scope);
  assert.equal(await finish(), true);
  assert.deepEqual(images,[{target:1,waitId:'b2',cardId:'a'}]);assert.equal(spinners.length,0);
  assert.deepEqual(meta.publishedIds,[]);
  assert.equal(await finish(), false, 'written once');
});

test('error/stop finalizer bakes completed shots before spinner cleanup and scroll release', async () => {
  const body = between('    try {\n      // A later shot may fail', '\n  }\n}');
  for (const [fails,kept] of [[false,false],[true,false],[false,true]]) {
    const calls=[];
    const old = globalThis.__OMNI_END_SCROLL__;
    globalThis.__OMNI_END_SCROLL__ = async () => calls.push('end-scroll');
    try {
      await compile(`return (async () => {${body}})();`, {
        finishCompletedSpinners:async()=>{calls.push('bake');if(fails)throw Error('write failed');},
        closeStreamJob:()=>calls.push('close-stream'),setJobContext:()=>calls.push('restore-context'),prevCtx:'',deferred:undefined,
        releaseShotAssets:()=>calls.push('register-shots'),releaseChatNote:()=>calls.push('write-note'),noteSessionId:'note',
        dbg:()=>{},durableSpinners:true,enqueueBakeWrite:async work=>work(),
        keptSpinners:new Map(kept?[['job_0',0]]:[]),settleKeptSpinners:async()=>calls.push('park'),
        clearJobSpinners:async()=>calls.push('clear'),jobChatTarget:()=>({}),request:{},jobId:'job',spinnerOverlayUrls:[],inlineWait:'',deferWait:false,
      });
      // Shots waiting for registration and note changes no bake carried go out last, after every bake.
      // Spinners still without their image turn pink after the bake, before the scroll is let go.
      assert.deepEqual(calls,['bake',...(kept?['park']:[]),'end-scroll','close-stream','restore-context','register-shots','write-note']);
    } finally {globalThis.__OMNI_END_SCROLL__=old;}
  }
});

test('tagging precedes scroll capture and atomic spinner replacement', async () => {
  const start = source.indexOf('    let attachment:');
  const end = source.indexOf('    async function enqueueJobSpinners()', start);
  assert.ok(start >= 0 && end > start);
  const calls=[];
  const old = globalThis.__OMNI_BEGIN_SCROLL__;
  globalThis.__OMNI_BEGIN_SCROLL__=async()=>calls.push('begin-scroll');
  try {
    await compile(`return (async () => {let durableSpinners=false;${source.slice(start,end)}})();`, {
      jobId:'job',request:{force:true},deferred:undefined,isJobCurrent:()=>true,finishCompletedSpinners:async()=>{},persistChatImagesOn:()=>true,
      enqueueJobSpinners:async()=>{calls.push('replace');return true;},jobChatTarget:()=>({}),dbg:()=>{},
    });
    assert.deepEqual(calls,['replace']);
    assert.ok(source.indexOf("await setJob(jobId, 'tagging'")<start);
    assert.doesNotMatch(source,/\bstripBakedImagesFromChatMessage\s*\(/);
  } finally {globalThis.__OMNI_BEGIN_SCROLL__=old;}
});


test('stop accepts live chat identity and unified scope without stopping a sibling chat', async () => {
  const body = between('export async function requestJobStop(', '// ── progress and state').replace('export async', 'async');
  for (const filter of ['live-one','unified','unrelated']) {
    const metas = new Map(['one','two'].map(chatId=>[chatId,{sessionId:'unified',characterId:'char',chatId}]));
    const controllers = new Map(['one','two'].map(id=>[id,new AbortController()]));
    const stop = await compile(`${body}\nreturn requestJobStop;`, {
      cancelStreamJob:()=>{},requestMessageRerollStop:()=>{},cleanText:v=>v,jobRunMeta:metas,jobLlmControllers:controllers,
      chatNoteSessionId:(_sid,extra)=>`live-${extra.chatId}`,
      idbGet:async()=>({state:'generating'}),ACTIVE_JOB_STATES:['generating'],toInt:(_v,fallback)=>fallback,
      setJob:async()=>{},dbg:()=>{},
    });
    const result=await stop({session_id:filter});
    assert.deepEqual(result.job_ids, filter==='unified'?['one','two']:filter==='live-one'?['one']:[]);
    for (const [id, controller] of controllers) assert.equal(controller.signal.aborted, result.job_ids.includes(id));
  }
});


test('an aborted job exits through cancellation rather than changing stopped state to error', async () => {
  const body = between('    if (llmController.signal.aborted && await cancelJobIfStale', '\n  } finally {');
  const llmController = new AbortController();llmController.abort();
  const states=[];
  await compile(`return (async()=>{${body}})();`, {
    llmController,jobId:'stopped',cancelJobIfStale:async()=>{states.push('cancelled');return true;},
    jobSpan:{fail:()=>{throw Error('stop is not a job error');}},exc:Error('Aborted'),
    setJob:async(_id,state)=>states.push(state),getLastStage:()=>'',eventsForJob:()=>[],
  });
  assert.deepEqual(states,['cancelled']);
});

test('a slot of a long-press run is shown, not written: the run writes all of them at its end', async () => {
  const images = [], closed = [];
  const meta = {key:'wait',epoch:1,publishedIds:['a'],cancelRequested:false,userStop:false};
  const old = globalThis.__OMNI_CLEAR_SPINNER_PREVIEW__;
  globalThis.__OMNI_CLEAR_SPINNER_PREVIEW__ = async job => closed.push(job);
  try {
    const finish = await compile(`${finishBody}
return finishCompletedSpinners;`, {
      deferred:undefined,durableSpinners:true,completedSpinnerCards:new Map([[0,'a']]),jobId:'tap',request:{},inlineWait:'b2',deferWait:true,
      jobRunMeta:new Map([['tap',meta]]),jobEpochByKey:new Map([['wait',{jobId:'tap',epoch:1}]]),
      enqueueBakeWrite: async work => work(), jobChatTarget: () => ({target:1}),
      finishJobSpinners: async () => { throw new Error('no spinner'); },
      writeWaitImage: async opts => {images.push(opts);return true;},
    });
    assert.equal(await finish(), true);
    assert.deepEqual(images, [], 'not written by the job');
    assert.deepEqual(closed, [], 'its preview stays until the run writes it');
    assert.deepEqual(meta.publishedIds, [], 'the card is the user\'s');
  } finally { globalThis.__OMNI_CLEAR_SPINNER_PREVIEW__ = old; }
});
