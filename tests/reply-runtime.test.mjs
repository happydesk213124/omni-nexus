import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assertCommittedReplyRuntime} from '../tools/vendor-patches/runtime-rebuild.mjs';
const source=readFileSync('tools/vendor-patches/reply-runtime.js','utf8');
const tick=()=>new Promise(r=>setImmediate(r));
function fixture(options={}) {
 const text='A completed reply that is long enough for image generation.';
 const msg={role:'char',data:text,chatId:'message-1'};
 const arg={characterIndex:0,chatIndex:0,messageIndex:1,char:{chaId:'c'},chat:{id:'chat',message:[{role:'user',data:'hello'},msg]}};
 const scope={characterId:'c',chatId:'chat',sessionId:'s',chat:structuredClone(arg.chat),charIndex:0,chatIndex:0};
 const t={backendSettings:{card:{power:true,auto_gen_on_reply:true,execute:'manual',...options.card}},jobsInFlight:new Map()};
 const calls=[],errors=[],hostCalls=[];let scopeReads=0;
 const deps={t,omniStreamOutput:()=>{},stopStreamKeywordTick:()=>{},isSelectedCharRole:r=>r==='char',scheduleHashRelinkAfterReply:()=>{},
  messageBodyChars:s=>s.length,ye:s=>s,w:(s,n)=>String(s).slice(0,n),ve:async()=>({enabled:options.enabled!==false}),Z:async()=>{scopeReads++;throw Error('unexpected full scope read');},
  D:async(name,fn)=>{hostCalls.push(name);return fn();},k:{getCurrentCharacterIndex:async()=>scope.charIndex,getCurrentChatIndex:async()=>scope.chatIndex,getChatFromIndex:async()=>scope.chat},
  K:async()=>({busy:!!options.busy}),Be:async(...args)=>{calls.push(args);if(options.pending)await options.pending;},y:(...a)=>errors.push(a)};
 const run=new Function(...Object.keys(deps),source+';return onChatOutput;')(...Object.values(deps));
 return {run,arg,t,scope,calls,errors,hostCalls,scopeReads:()=>scopeReads};
}
test('committed streaming and non-streaming replies dispatch exact event message, independent of selected DOM/manual mode',async()=>{
 for(const streaming of [true,false]) {
  const f=fixture();f.arg.chat.isStreaming=streaming;
  await f.run(f.arg);await tick();
  assert.equal(f.calls.length,1);assert.equal(f.calls[0][0].actionMessageIndex,1);
  assert.equal(f.calls[0][0].actionMessageId,'message-1');assert.equal(f.calls[0][2],false);
  assert.equal(f.scopeReads(),0);assert.deepEqual(f.errors,[]);
  assert.deepEqual(f.hostCalls,['getCurrentCharacterIndex','getCurrentChatIndex','getChatFromIndex']);
  assert.equal(f.calls[0][0].character,f.arg.char);
  assert.equal(f.calls[0][0].sessionId,'risu_c|chat');
  assert.equal(f.calls[0][0].unifiedSessionId,'risu_c|__unified__');
 }
 assert.doesNotMatch(source,/setTimeout|setInterval|chatIsStreaming|getCachedMsgEls|querySelector/);
});
test('duplicate notifications and concurrent events dispatch once without blocking host completion',async()=>{
 let release;const pending=new Promise(r=>release=r),f=fixture({pending});
 await f.run(f.arg);await f.run(f.arg);await tick();
 assert.equal(f.calls.length,1);assert.equal(f.t._afterGenRunning,true);
 release();await tick();await f.run(f.arg);await tick();assert.equal(f.calls.length,1);
});
test('disabled, short, user, removed, busy and changed-chat outputs do not generate',async()=>{
 for(const configure of [f=>f.t.backendSettings.card.auto_gen_on_reply=false,f=>f.t.backendSettings.card.power=false,
  f=>f.arg.chat.message[1].data='short',f=>f.arg.chat.message[1].role='user',f=>f.arg.messageIndex=-1,
  f=>f.t.jobsInFlight.set('other',true),f=>f.scope.chat.id='different',f=>f.scope.charIndex=1,f=>f.scope.chatIndex=1,f=>f.t.unloading=true]) {
  const f=fixture();configure(f);await f.run(f.arg);await tick();assert.equal(f.calls.length,0);
 }
 const busy=fixture({busy:true});await busy.run(busy.arg);await tick();assert.equal(busy.calls.length,0);
 const disabled=fixture({enabled:false});await disabled.run(disabled.arg);await tick();assert.equal(disabled.calls.length,0);
});
test('removed or edited message at the event index is rejected',async()=>{
 for(const change of [f=>f.scope.chat.message.pop(),f=>f.scope.chat.message[1].data+=' edited',f=>f.scope.chat.message[1].chatId='replacement']) {
  const f=fixture();change(f);
  await f.run(f.arg);await tick();assert.equal(f.calls.length,0);assert.deepEqual(f.errors,[]);
 }
});
test('completion-only build guard fails when legacy polling or registration is reintroduced',()=>{
 const good='omniGenerateCommittedReply addRisuChatListener("output", onChatOutput)';
 assertCommittedReplyRuntime(good);
 for(const bad of ['addRisuReplacer("afterRequest", _t)','scheduleAutoGenOnReply("chatOutput"','while (await chatIsStreaming())']) {
  assert.throws(()=>assertCommittedReplyRuntime(good+bad),/must not poll/);
 }
 assert.throws(()=>assertCommittedReplyRuntime(''),/missing/);
});
