import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { repairOmniUi } from '../tools/vendor-patches/omni-repairs.mjs';

const source = readFileSync(new URL('../dist/omninexus.js',import.meta.url),'utf8');

const patches = readFileSync(new URL('../vite.config.ts',import.meta.url),'utf8');
function patchSection(start,end) {
 const a=patches.indexOf(start),b=patches.indexOf(end,a);
 assert.ok(a>=0 && b>a);
 return new Function('return `'+patches.slice(a,b)+'`;')();
}

test('compatibility repair refuses a drifted upstream handler',()=> {
  assert.throws(()=>repairOmniUi('function noMatchingHandlers() {}'), /expected 1, got 0:.*R && \(R.innerHTML = u\)/);
});

test('bubble counts repair opens gen options at Image Min',()=> {
  const repairSrc = readFileSync(new URL('../tools/vendor-patches/omni-repairs.mjs', import.meta.url), 'utf8');
  assert.match(repairSrc, /openSettingsTab\("gen_options"\)/);
});

test('baked refresh reaches reroll rather than resetting image src',()=> {
  const start=source.indexOf('const rawAct = typeof e.querySelectorAll');
  const end=source.indexOf('y("info", "bake.refresh", cardId)',start);
  assert.ok(start>=0 && end>start);
  const handler=source.slice(start,end);
  assert.match(handler,/encodeURIComponent\(cardId\).*\/reroll/);
  assert.match(handler,/nxAroundScrollHold/);
  assert.doesNotMatch(handler,/setAttribute\("src", ""\)/);
});


test('legacy network wrappers do not start a second scroll manager',async()=>{
  const start=source.indexOf('  async function nxAroundScrollHold(work)'),end=source.indexOf('  globalThis.__INLAY_SCROLL_HOLD__',start);
  assert.ok(start>=0&&end>start);
  const hold=new Function(source.slice(start,end)+';return nxAroundScrollHold;')();
  assert.equal(await hold(async()=>7),7);
  await assert.rejects(()=>hold(async()=>{throw Error('failed');}),/failed/);
  assert.match(source,/__INLAY_SCROLL_HOLD__ = omniWithScrollWrite/);
});

test('legacy model alarm stays disabled because preview owns the readiness dot',()=> {
 assert.match(source,/const alarm = "";/);
 assert.match(source,/const naiMiss0 = false;/);
 assert.doesNotMatch(source,/const alarm = d === "models" && !naiOk/);
});


test('message toolbar mounts at both ends without selection and survives restricted host events',async()=> {
 const a=source.indexOf('  async function injectChatMsgActions('),b=source.indexOf('  async function paintAllMsgFans()',a);
 assert.ok(a>=0&&b>a);
 // The preview-image bridge between these functions is not part of the toolbar.
 const body=patchSection('  async function injectChatMsgActions(', '  async function paintAllMsgFans()').split('  globalThis.__OMNI_SHOW_SPINNER_IMAGE__')[0];
 const make=new Function('t','nxMsgAct','nxMsgFan','k','H','FAN_BTN_REST','FAN_BTN_PRESS',body+';return injectChatMsgActions;');
 let enabled=true;let editing=false;const children=[];
 const node=()=>({attrs:{},async setAttribute(k,v){assert.ok(k.startsWith('x-'));this.attrs[k]=v;},async getAttribute(k){assert.ok(k.startsWith('x-'),'host rejects ordinary attributes');return this.attrs[k]||'';},async getStyleAttribute(){return '';},async setStyleAttribute(){},async addEventListener(){throw Error('unsupported event');},async remove(){const i=children.indexOf(this);if(i>=0)children.splice(i,1);}});
 const mount={async appendChild(n){children.push(n);},async prepend(n){children.unshift(n);},async querySelectorAll(){return children;}};
 const message={...mount,async getStyleAttribute(){return "";},async setStyleAttribute(){},async querySelector(selector){return selector==='.chattext'?(editing?null:mount):(editing?{}:null);},async querySelectorAll(selector){return selector.includes('[x-inlay-msg-fan]')?[...children]:[];}};
 const H=async()=>{const wrap=node(),tray=node();tray.buttons=Array.from({length:7},node);tray.getChildren=async()=>tray.buttons;wrap.getChildren=async()=>[tray];return {getChildren:async()=>[wrap]};};
 const previous=globalThis.__INLAY_VIEWER_CORE__;globalThis.__INLAY_VIEWER_CORE__={shouldMountMsgActions:()=>true};
 try {
   const run=make({overlayUi:{doc:{}}},()=> 'off',()=>enabled,{unwarpSafeArray(){throw Error('native arrays must not be unwrapped');}},H,'flat','hover');
   await run(message,[],3,{extrasOnly:true,role:'char',text:'hello'});
   assert.deepEqual(children.map(n=>n.attrs['x-inlay-msg-fan']),['top','bottom']);
   for(const bar of children)assert.deepEqual((await (await bar.getChildren())[0].getChildren()).map(n=>n.attrs['x-inlay-msg-chip']),['tag','regen','char','stop','preset','note','counts']);
   await run(message,[],4,{extrasOnly:true});assert.deepEqual(children.map(n=>n.attrs['x-inlay-msg-index']),['4','4']);
   children.length=0;await run(message,[],4,{extrasOnly:true});assert.equal(children.length,2);
   editing=true;await run(message,[],4,{extrasOnly:true});assert.equal(children.length,0,'editing must never mount toolbar into the outer flex row');
   editing=false;await run(message,[],4,{extrasOnly:true});assert.equal(children.length,2,'saving/cancelling edit restores both toolbars');
   enabled=false;await run(message,[],4,{extrasOnly:true});assert.equal(children.length,0);
 } finally {globalThis.__INLAY_VIEWER_CORE__=previous;}
});

test('message anchor restores on mutation without waiting for paragraphs',async()=> {
 const code=patchSection('  async function nxScrollHoldScroller()', '  async function nxAroundScrollHold');
 assert.doesNotMatch(code,/getProperty|setProperty|scrollTop|"wheel"|"touchmove"/);
 let top=-15000,content=-14960,parsing=false,context='chat-a',missing=false,mutation;
 let writes=0;const handlers=new Map(),frames=[];
 const forbidden=()=>{throw Error('unsupported host API');};
 const node=(text)=>({
  async textContent(){throw Error('must not read paragraphs');},getProperty:undefined,setProperty:undefined,
  getAttribute:forbidden,
  async getStyle(){return '7px';},async setStyle(_p,v){this.margin=v;},
  async getBoundingClientRect(){return {top:content-top,bottom:content-top+30,height:30};},
  async scrollIntoView(){top=content-parseFloat(this.margin);writes++;}
 });
 const bubble=()=>({...node(''),async querySelector(){return null;},async querySelectorAll(){return parsing?[]:[node('reading paragraph')];}});
 const screen={async getBoundingClientRect(){return {top:0,bottom:600,height:600};}};
 const doc={async querySelector(selector){return selector==='body'?{}:selector==='.default-chat-screen'?screen:missing?null:bubble();},
  async addEventListener(n,fn){assert.ok(['pointerdown','pointermove','pointerup','pointercancel','scroll','scrollend','keydown'].includes(n));handlers.set(n,fn);return n;},
  async removeEventListener(n){handlers.delete(n);}};
 const t={hostDoc:doc};
 const api={async createMutationObserver(fn){mutation=fn;return {async observe(){},async disconnect(){}};}};
 const VC=globalThis.__INLAY_VIEWER_CORE__;
 const make=new Function('t','k','Z','nxScrollHoldOn','nxUnwrapSafeNodes','getCachedMsgEls','nxChatAttrIndex','y','setTimeout','clearTimeout',code+';return {capture:nxCaptureScrollHold,apply:nxApplyScrollHold,pin:nxPinChatScrollers};');
 const run=make(t,api,async()=>({characterId:'bot',chatId:context}),()=>true,async a=>a,async()=>[bubble()],async()=>7,()=>{},fn=>{frames.push(fn);return frames.length;},()=>{});
 assert.equal(await run.capture({force:true}),true);
 for(const shift of [-240,200,100,350]){content+=shift;await run.apply({force:true});assert.equal(content-top,40);}
 parsing=true;const before=writes;content+=500;await run.apply({force:true});assert.equal(writes,before+1,'message geometry restores before paragraphs exist');
 parsing=false;await run.apply({force:true});assert.equal(content-top,40);
 missing=true;content+=200;await run.apply({force:true});assert.equal(writes,before+1);
 missing=false;await run.apply({force:true});assert.equal(content-top,40);
 const release=await run.pin();
 handlers.get('pointerdown')({type:'pointerdown'});handlers.get('pointermove')({type:'pointermove'});
 top-=80;assert.equal(content-top,120);
 t._scrollHoldUserUntil=0;await frames.shift()();assert.equal(t._scrollHold.offset,120);
 content+=200;mutation();
 await frames.shift()();assert.equal(content-top,120);
 assert.ok(frames.length>=6,'mutation arms delayed stabilization, not a permanent polling loop');
 context='chat-b';content+=100;const last=writes;await run.apply({force:true});assert.equal(writes,last);
 await release();assert.equal(handlers.size,0);
 globalThis.__INLAY_VIEWER_CORE__=VC;
});

test('character add paints optimistically and persists in background',()=>{
  const repairSrc = readFileSync(new URL('../tools/vendor-patches/omni-repairs.mjs', import.meta.url), 'utf8');
  const start = repairSrc.indexOf('], t._charsDirty = !0;');
  assert.ok(start>=0, 'add-character patch needle must exist');
  const body = repairSrc.slice(start, start+2600);
  const paint = body.indexOf('await P();');
  const bg = body.indexOf('void (async () =>');
  const post = body.indexOf('"/v1/characters", { method:"POST"');
  assert.ok(paint>=0 && bg>paint && post>bg, 'paint must precede the background save');
  assert.match(body, /추가 중…/);
  assert.match(body, /finally/);
});
