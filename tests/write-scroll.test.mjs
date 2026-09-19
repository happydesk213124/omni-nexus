import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../tools/vendor-patches/scroll-runtime.js',import.meta.url),'utf8');
for(const mode of ['replace','manual','chat-switch','failure'])test('write-scoped scroll: '+mode,async()=>{
 let top=20,scope='a',corrections=0,disconnected=0,serial=0;
 const handlers=new Map();let mutated;
 const rect=()=>({top,bottom:top+40,height:40});
 const paragraph={textContent:async()=> 'same paragraph',getBoundingClientRect:async()=>rect(),getStyleAttribute:async()=> 'color:red',setStyle:async(k,v)=>{assert.equal(k,'scrollMarginTop');paragraph.margin=Number.parseFloat(v);},setStyleAttribute:async value=>assert.equal(value,'color:red'),scrollIntoView:async()=>{top=paragraph.margin;corrections++;}};
 const body={querySelectorAll:async()=>[paragraph]};
 const bubble={getBoundingClientRect:async()=>rect(),getOuterHTML:async()=>'<div data-chat-index="3"></div>',querySelector:async()=>body};
 const screen={getBoundingClientRect:async()=>({top:0,bottom:800,height:800}),querySelectorAll:async()=>[bubble],querySelector:async()=>bubble,addEventListener:async(kind,fn)=>{const id=String(++serial);handlers.set(id,{kind,fn});return id;},removeEventListener:async(kind,id)=>{assert.equal(handlers.get(id)?.kind,kind);handlers.delete(id);}};
 const doc={querySelector:async()=>screen};
 const run=new Function('t','nxScrollHoldOn','nxScrollContext','nxUnwrapSafeNodes','k','y',source+';return omniWithScrollWrite;')({hostDoc:doc},()=>true,async()=>scope,async a=>a,{createMutationObserver:async cb=>{mutated=cb;return{observe:async()=>{},disconnect:async()=>{disconnected++;}};}},()=>{});
 const work=async()=>{
   top=400;mutated();
   if(mode==='manual')for(const {kind,fn} of handlers.values())if(kind==='keydown')fn({key:'PageDown'});
   if(mode==='chat-switch')scope='b';
   if(mode==='failure')throw Error('failed write');
   return 'saved';
 };
 if(mode==='failure')await assert.rejects(()=>run(work),/failed write/);else assert.equal(await run(work),'saved');
 if(mode==='replace'){assert.equal(top,20);assert.equal(corrections,1);}else assert.equal(corrections,0);
 assert.equal(handlers.size,0);assert.equal(disconnected,1);
});
