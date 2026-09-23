import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const runtime=readFileSync(new URL('../tools/vendor-patches/message-runtime.js',import.meta.url),'utf8');
function fixture(identity={},code=runtime) {
  const row={role:'char',data:'Same message text',...identity};
  const scope={characterId:'bot',chatId:'room',sessionId:'session',chat:{message:[row]}};
  const calls=[],errors=[],attrs=new Map();
  let api;
  const footer={
    getOuterHTML:async()=>`<div data-omni-footer="${api.token(0,row.data)}">`,
    getAttribute:async key=>attrs.get(key),setAttribute:async(key,value)=>attrs.set(key,value),
    querySelector:async()=>button,
  };
  const button={getOuterHTML:async()=>'<button data-omni-action="tag">',getParent:async()=>footer,setAttribute:async()=>{}};
  const deps={
    t:{hostDoc:{querySelector:async()=>footer},selectedMessage:{hostMessageId:'previous-selection'}},
    Z:async()=>scope,nxMsgFan:()=>true,omniRelease:async()=>{},y:()=>{},$e:message=>errors.push(message),
    Be:async(target,text,force)=>calls.push({target,text,force,host_message_id:api.requestId(target)}),
  };
  api=new Function(...Object.keys(deps),code+';return {bind:omniBindModuleButton,run:omniFooterAction,token:omniMessageToken,targets:omniFooterTargets,requestId:omniJobMessageId};')(...Object.values(deps));
  return {api,row,calls,errors,bind:()=>api.bind(button)};
}

for(const identity of [{chatId:'message',id:'different-legacy-id'},{chatId:'message'},{id:'legacy'},{}]) {
  test(`manual target keeps its own message identity: ${JSON.stringify(identity)}`,async()=>{
    const f=fixture(identity),hit=await f.bind();
    const expected=identity.chatId || identity.id || '';
    assert.equal(f.api.targets.get(hit.index).hostId,expected);
    await f.api.run('tag',hit.index);
    assert.deepEqual(f.errors,[]);
    assert.equal(f.calls.length,1);
    assert.equal(f.calls[0].target.actionMessageId,expected);
    assert.equal(f.calls[0].host_message_id,expected);
    assert.equal(f.calls[0].target.actionMessageIndex,0);
    assert.equal(f.calls[0].force,true);
  });
}

for(const nextId of ['replacement','']) test(`manual action rejects a changed or missing message ID: ${nextId}`,async()=>{
  const f=fixture({chatId:'original'}),hit=await f.bind();
  f.row.chatId=nextId;
  await f.api.run('tag',hit.index);
  assert.equal(f.calls.length,0);
  assert.match(f.errors[0],/메시지가 바뀌었습니다/);
});

test('floating action accepts the DOM message ID even when a different legacy id exists',async()=>{
  const f=fixture({chatId:'message',id:'legacy'});
  f.api.targets.set(-1,{sessionId:'session',characterId:'bot',chatId:'room',index:0,hostId:'message',_floatPin:1});
  await f.api.run('tag',-1);
  assert.deepEqual(f.errors,[]);
  assert.equal(f.calls[0].host_message_id,'message');
});

test('only implicit selection may fall back to the previous selected message',()=>{
  const f=fixture();
  assert.equal(f.api.requestId({actionMessageIndex:0}),'');
  assert.equal(f.api.requestId({actionMessageIndex:0,actionMessageId:'explicit'}),'explicit');
  assert.equal(f.api.requestId({}),'previous-selection');
});

test('identity guards reject deliberately restored legacy-ID and selection fallbacks',async()=>{
  const wrongId=fixture({chatId:'message',id:'legacy'},runtime.replace('hostId:omniMessageId(row)','hostId:row.id'));
  const hit=await wrongId.bind();
  assert.throws(()=>assert.equal(wrongId.api.targets.get(hit.index).hostId,'message'),assert.AssertionError);
  const wrongFallback=fixture({},runtime.replace("if(Number.isInteger(scope.actionMessageIndex))return String(scope.actionMessageId || '');",''));
  assert.throws(()=>assert.equal(wrongFallback.api.requestId({actionMessageIndex:0}),''),assert.AssertionError);
});
