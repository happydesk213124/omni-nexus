import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../dist/omninexus.js',import.meta.url),'utf8');
function section(start,end){
  const a=source.indexOf(start),b=source.indexOf(end,a);
  assert.ok(a>=0 && b>a);
  return source.slice(a,b);
}

test('footer hit queries only the active control and a miss never reads messages',async()=>{
  const runtime=readFileSync(new URL('../tools/vendor-patches/message-runtime.js',import.meta.url),'utf8');
  const a=runtime.indexOf('async function omniFooterHit'),b=runtime.indexOf('async function omniFooterAction',a);
  const queries=[];
  const hit=new Function('nxUnwrapSafeNodes','hitEl',runtime.slice(a,b)+';return omniFooterHit;')(async a=>a,()=>{throw Error('unexpected rect');});
  assert.equal(await hit({querySelectorAll:async q=>{queries.push(q);return [];}},1,1),null);
  assert.deepEqual(queries,['[data-omni-action]:is(:active,:focus-visible),[x-omni-action]:is(:active,:focus-visible)']);
});
test('stop dispatch precedes all DOM and scope reads',async()=>{
  const runtime=readFileSync(new URL('../tools/vendor-patches/message-runtime.js',import.meta.url),'utf8');
  const a=runtime.indexOf('async function omniFooterAction'),b=runtime.indexOf('async function omniToggleCounts',a);
  let calls=0;
  const state={};
  const run=new Function('optimisticStopJobs','t',runtime.slice(a,b)+';return omniFooterAction;')(async()=>{calls++;},state);
  await run('stop',99);assert.equal(calls,1);
  state._nxHostInspectOpen=true;
  await run('stop',99);assert.equal(calls,1,'fullscreen must block underlying chat controls');
});

test('character and preset settings open without DOM or message reads',async()=>{
  const runtime=readFileSync(new URL('../tools/vendor-patches/message-runtime.js',import.meta.url),'utf8');
  const a=runtime.indexOf('async function omniFooterAction'),b=runtime.indexOf('async function omniToggleCounts',a);
  const tabs=[];
  const run=new Function('t','openSettingsTab',runtime.slice(a,b)+';return omniFooterAction;')({},async tab=>tabs.push(tab));
  await run('char',-1);await run('preset',-1);
  assert.deepEqual(tabs,['characters','style_presets']);
});

test('reroll hit query is restricted and completed result merges without gallery reload',()=>{
  const code=section('const rawAct = typeof e.querySelectorAll','y("info", "bake.refresh", cardId)');
  assert.match(code,/:is\(\[x-inray-refresh\],\[data-inray-refresh\]\)/);
  assert.match(code,/gallery\.splice\(at,1,result.card\)/);
  assert.doesNotMatch(code,/await ce\(/);
});

test('force tag request no longer unlinks and reloads gallery before job creation',()=>{
  const code=section('  async function Be(', '    const u = {\n      session_id: e.sessionId,');
  assert.doesNotMatch(code,/await pa\(e.sessionId/);
  assert.doesNotMatch(code,/await ce\(e.sessionId, !0\)/);
  const actions=section('  async function runMsgChipAction(', '  async function hitMsgChipAt(');
  assert.match(actions,/return omniFooterAction/);
  assert.doesNotMatch(actions,/getCachedMsgEls|omniResolveActionMessage|nxAroundScrollHold/);
});

test('👨‍👩‍👧‍👦 opens the roster first, then fills its search with the people this message names', async () => {
  const runtime=readFileSync(new URL('../tools/vendor-patches/message-runtime.js',import.meta.url),'utf8');
  const a=runtime.indexOf('async function omniFooterAction'),b=runtime.indexOf('async function omniToggleCounts',a);
  const order=[],input={value:'',dispatchEvent:()=>order.push('search:'+input.value)};
  let tiles=false;
  const doc={getElementById:id=>id==='nx-char-search'?input:null,querySelector:()=>tiles?{}:null,activeElement:null};
  const targets=new Map([[3,{characterId:'c',chatId:'chat',index:1}]]);
  const scope={characterId:'c',chatId:'chat',sessionId:'s',chat:{message:[{data:'x'},{data:'지은이 웃었다. 연희도.'}]}};
  const t={uiOpen:true};
  const run=new Function('t','openSettingsTab','omniFooterTargets','Z','K','ye','document',runtime.slice(a,b)+';return omniFooterAction;')(
    t,async tab=>{order.push('open:'+tab);setTimeout(()=>{tiles=true;},150);},targets,async()=>scope,
    async(path,init)=>{order.push('ask:'+init.body.message);return {characters:[{name:'송지은'},{name:'김연희'},{name:'송지은'}]};},()=>'h',doc);
  await run('char',3);
  await new Promise(r=>setTimeout(r,500));
  assert.deepEqual(order,['open:characters','ask:지은이 웃었다. 연희도.','search:송지은, 김연희'],'open at once, ask after, one name once, after the tiles drew');
  order.length=0;input.value='내가 치는 중';doc.activeElement=input;
  await run('char',3);await new Promise(r=>setTimeout(r,300));
  assert.deepEqual(order,['open:characters','ask:지은이 웃었다. 연희도.'],'never over what the reader is typing');
});
