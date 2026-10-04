import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {repairInspectMessageActions} from '../tools/vendor-patches/inspect.mjs';

const runtime=readFileSync('tools/vendor-patches/message-runtime.js','utf8');
const bundle=readFileSync('dist/omninexus.js','utf8');
const config=readFileSync('vite.config.ts','utf8').replaceAll('\r\n','\n');
const vendor=readFileSync('vendor/inlay-nexus-ui.js','utf8').replaceAll('\r\n','\n');
function fixture() {
  const rows=[
    {chatId:'first',role:'char',data:'이전 본문 [[@inray::old::old.webp::832::1216]]'},
    {chatId:'owner',role:'char',data:'원본 전체 본문 [[@inray::image::shot.webp::832::1216]] [[@inray::second::shot2.webp::832::1216]]'},
    {chatId:'last',role:'char',data:'마지막 선택 본문 [[@inray::wrong::wrong.webp::832::1216]]'},
  ];
  const scope={characterId:'bot',chatId:'room',sessionId:'session',chat:{message:rows}};
  const calls=[],errors=[],events=[];
  const card={id:'image',character_id:'bot',chat_id:'room',message_index:1,host_message_id:'owner'};
  const deps={t:{selectedMessage:{text:rows[2].data,chatIndex:2,domIndex:0,hostMessageId:'last'},_nxHostInspectOpen:true},
    Z:async()=>scope,y:()=>{},$e:error=>errors.push(error),
    Be:async(target,text,force)=>calls.push({kind:'tag',target,text,force}),
    K:async(path,options)=>{calls.push({kind:'regen',path,body:options.body});return {ok:true};},
    withImageRerollToast:async(_text,work)=>work(),
    nxWithScenePreparation:async(work,kind)=>{events.push(kind);return work();},
    hideInspect:async()=>{events.push('hide');deps.t._nxHostInspectOpen=false;},
  };
  const start=bundle.indexOf('runInspectAction = async (act, card, charI = -1) => {');
  const end=bundle.indexOf('    }, cancelMobilePress = () => {',start);
  assert.ok(start>=0 && end>start);
  const api=new Function(...Object.keys(deps),runtime+'\nconst '+bundle.slice(start,end)+'};return {inspect:runInspectAction,action:omniMessageAction,target:omniCardMessageTarget};')(...Object.values(deps));
  return {api,card,rows,scope,calls,errors,events,deps};
}

test('built inspect tag shares the footer action and sends its image owner, not selection or DOM position',async()=>{
  const f=fixture();
  await f.api.inspect('retag',f.card);
  const popup=f.calls[0];
  assert.equal(popup.target.actionMessageIndex,1);
  assert.equal(popup.target.actionMessageId,'owner');
  assert.equal(popup.text,f.rows[1].data);
  assert.equal(popup.force,true);
  await f.api.action('tag',{characterId:'bot',chatId:'room',index:1,hostId:'owner'},f.scope);
  assert.deepEqual(f.calls[1],popup);
  assert.deepEqual(f.events,['hide','scene']);
  assert.deepEqual(f.errors,[]);
});

test('built inspect regeneration and footer regeneration reroll the same full message batch',async()=>{
  const f=fixture();
  await f.api.inspect('regen',f.card);
  const popup=f.calls.slice();
  assert.deepEqual(popup.map(call=>call.path),['/v1/cards/image/reroll','/v1/cards/second/reroll']);
  assert.deepEqual(popup[0].body,{character_id:'bot',chat_id:'room',message_index:1});
  await f.api.action('regen',{characterId:'bot',chatId:'room',index:1,hostId:'owner'},f.scope);
  assert.deepEqual(f.calls.slice(2),popup);
  assert.deepEqual(f.errors,[]);
});

test('saved image token resolves shifted message indices with no host id or gallery/DOM reads',async()=>{
  const f=fixture();
  f.rows.unshift({role:'user',data:'삽입된 메시지'});
  delete f.card.host_message_id;
  await f.api.inspect('retag',f.card);
  assert.equal(f.calls[0].target.actionMessageIndex,2);
  assert.equal(f.calls[0].target.actionMessageId,'owner');
  assert.deepEqual(f.errors,[]);
});

test('minimal image cards inherit ownership from metadata location without reading pixels',async()=>{
  const f=fixture(),previous=globalThis.__OMNI_IMAGE_META__;
  globalThis.__OMNI_IMAGE_META__=async id=>{
    assert.equal(id,'image');
    return {location:{character_id:'other',chat_id:'room',message_index:1}};
  };
  try {
    await f.api.inspect('retag',{id:'image'});
    assert.equal(f.calls.length,0);
    assert.match(f.errors[0],/대화가 바뀌었습니다/);
    globalThis.__OMNI_IMAGE_META__=async()=>({location:{character_id:'bot',chat_id:'room',host_message_id:'owner'}});
    f.rows[1].data='박제하지 않은 전체 원본 본문';
    await f.api.inspect('retag',{id:'image'});
    assert.equal(f.calls[0].target.actionMessageIndex,1);
    assert.equal(f.calls[0].text,f.rows[1].data);
  } finally {
    if(previous===undefined)delete globalThis.__OMNI_IMAGE_META__;
    else globalThis.__OMNI_IMAGE_META__=previous;
  }
});

for(const reason of ['missing','different chat','different bot','ambiguous'])test(`inspect refuses ${reason} ownership instead of using the last selection`,async()=>{
  const f=fixture();
  if(reason==='missing'){f.card.id='absent';delete f.card.host_message_id;}
  if(reason==='different chat')f.card.chat_id='other';
  if(reason==='different bot')f.card.character_id='other';
  if(reason==='ambiguous'){f.rows[0].data=f.rows[1].data;delete f.card.host_message_id;delete f.card.message_index;}
  await f.api.inspect('retag',f.card);
  assert.equal(f.calls.length,0);
  assert.equal(f.errors.length,1);
});

test('inspect rejects a changed room or replaced ID-less message between resolution and dispatch',async()=>{
  for(const change of ['room','text']){
    const f=fixture(),target=await f.api.target(f.card);
    if(change==='room')f.scope.chatId='other';
    else {delete f.rows[1].chatId;target.hostId='';f.rows[1].data='교체된 다른 본문';}
    await assert.rejects(f.api.action('tag',target),/바뀌었습니다/);
    assert.equal(f.calls.length,0);
  }
});

test('asserted inspect action replacement rejects a deliberately changed legacy target',()=>{
  const name='VENDOR_INSPECT_REGEN_INLINE_PATCH';
  const at=config.indexOf('const '+name+' ='),start=config.indexOf('`',at),end=config.indexOf('`;\n',start)+1;
  assert.ok(at>=0 && end>start);
  const regen=runInNewContext(config.slice(start,end));
  const a=vendor.indexOf('      if (act === "retag") {');
  const b=vendor.indexOf('    }, cancelMobilePress = () => {',a);
  let old=vendor.slice(a,b);
  const r=old.indexOf('            await withImageRerollToast(`메시지 이미지 전체 재생성 중');
  assert.ok(r>0);
  old=old.slice(0,r)+regen+'\n';
  const source=old+'    }, cancelMobilePress = () => {';
  assert.match(repairInspectMessageActions(source),/omniCardMessageAction/);
  assert.throws(()=>repairInspectMessageActions(source.replace('t.selectedMessage','t.BAD_SELECTION')),/message action drift/);
});
