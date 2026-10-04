import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { repairCharacterIdentitySave } from '../tools/vendor-patches/character-identity-save.mjs';

function runtime() {
  const vite = readFileSync('vite.config.ts','utf8');
  const start = vite.indexOf('  function nxBindLiveSettings() {');
  const end = vite.indexOf('  async function nxScrollHoldScroller()',start);
  assert.ok(start>=0 && end>start);
  let source = repairCharacterIdentitySave(new Function('return `'+vite.slice(start,end)+'`;')());
  if(process.env.BREAK_IDENTITY_DRAFT_GUARD) source=source.replace('if (!event.detail?.omniIdentityCommit &&', 'if (false &&');
  const handlers = new Map(), timers = new Map(), posts=[];
  const shell={dataset:{},addEventListener(type,fn){const list=handlers.get(type)||[];list.push(fn);handlers.set(type,list);}};
  const rows=[{id:'lee',name:'이한',given_name:'한'},{id:'kim',name:'김한영',given_name:''}];
  const t={lastScope:{sessionId:'a'},charactersSession:structuredClone(rows),charactersGlobal:[],_omniRosterCache:new Map()};
  const document={activeElement:null,getElementById:id=>id==='nx-shell'?shell:null};
  let tick=0;
  const emit=(type,field,extra={})=>{for(const handler of handlers.get(type)||[])handler({type,target:field,...extra});};
  const context={t,document,Map,Promise,
    CustomEvent:class{constructor(type,opts){this.type=type;Object.assign(this,opts);}},
    setTimeout:fn=>{const id=++tick;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id),
    oe:kind=>kind==='session'?structuredClone(rows):[],withRootSessions:body=>body,$e:()=>{},z:String,
    K:async(_url,opts)=>posts.push(opts.body)};
  runInNewContext(source+'\nnxBindLiveSettings();',context);
  const field={id:'',key:'data-char-given',closest:()=>({}),matches(selector){return selector.includes('['+this.key+']');},dispatchEvent(event){emit(event.type,this,event);}};
  document.activeElement=field;
  return {rows,timers,posts,field,emit,t,async flush(){await context.__OMNI_FLUSH_CHARACTERS__();}};
}

test('typing 한 then 한영 cannot submit an intermediate matching name, even on flush',async()=>{
  const h=runtime();
  h.rows[1].given_name='한';h.emit('input',h.field);
  assert.equal(h.timers.size,0,'no debounced merge is scheduled for a partial name');
  await h.flush();assert.equal(h.posts.length,0,'scope changes/flush cannot merge the partial name');
  h.rows[1].given_name='한영';h.emit('input',h.field);
  await h.flush();assert.equal(h.posts.length,0);
  h.emit('change',h.field);await h.flush();
  assert.equal(h.posts.length,1);
  assert.equal(h.posts[0].characters[1].given_name,'한영');
});

test('name typing cancels an older whole-roster save; IME composition never submits',async()=>{
  const h=runtime();
  const appearance={...h.field,key:'data-char-appearance'};
  h.field.key='data-char-appearance';h.emit('input',appearance);
  assert.equal(h.timers.size,1);
  h.field.key='data-char-given';h.rows[1].given_name='한';h.emit('input',h.field);
  assert.equal(h.timers.size,0);await h.flush();assert.equal(h.posts.length,0);
  h.emit('input',h.field,{isComposing:true});await h.flush();assert.equal(h.posts.length,0);
  h.rows[1].given_name='한영';h.emit('change',h.field);await h.flush();
  assert.equal(h.posts.length,1);
});

test('identity save patch refuses a drifted live-save handler',()=>{
  assert.throws(()=>repairCharacterIdentitySave('function different() {}'),/needle drift/);
});
