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

test('a tapped slot anchors its own image while it is baked, not a paragraph below it',async()=>{
 let written=false,imageTop=0,corrected='',serial=0,mutated;
 const handlers=new Map();
 // The slot sits at 100px; once baked the message is drawn again and its image lands at 300px.
 const slotEl={getBoundingClientRect:async()=>({top:100,bottom:400,height:300})};
 const image={getBoundingClientRect:async()=>({top:imageTop,bottom:imageTop+300,height:300}),getStyleAttribute:async()=>'',
  setStyle:async(k,v)=>{assert.equal(k,'scrollMarginTop');image.margin=Number.parseFloat(v);},setStyleAttribute:async()=>{},
  scrollIntoView:async()=>{imageTop=image.margin;corrected+='image ';}};
 const paragraph={textContent:async()=>'a line below the slot',getBoundingClientRect:async()=>({top:420,bottom:460,height:40}),getStyleAttribute:async()=>'',
  setStyle:async()=>{},setStyleAttribute:async()=>{},scrollIntoView:async()=>{corrected+='paragraph ';}};
 const body={querySelectorAll:async()=>[paragraph]};
 const bubble={getBoundingClientRect:async()=>({top:50,bottom:700,height:650}),getOuterHTML:async()=>'<div data-chat-index="3"></div>',
  querySelector:async sel=>sel==='[data-inray-wait="b2"]'?(written?null:slotEl):sel==='[data-inlay-inline-shot="card-1"]'?(written?image:null):sel==='.chattext'?body:null};
 const screen={getBoundingClientRect:async()=>({top:0,bottom:800,height:800}),querySelectorAll:async()=>[bubble],
  querySelector:async sel=>sel==='.risu-chat[data-chat-index="3"]'?bubble:null,
  addEventListener:async(kind,fn)=>{const id=String(++serial);handlers.set(id,{kind,fn});return id;},removeEventListener:async(_kind,id)=>{handlers.delete(id);}};
 const doc={querySelector:async()=>screen};
 const run=new Function('t','nxScrollHoldOn','nxScrollContext','nxUnwrapSafeNodes','k','y',source+';return omniWithScrollWrite;')({hostDoc:doc},()=>true,async()=>'a',async a=>a,
  {createMutationObserver:async cb=>{mutated=cb;return{observe:async()=>{},disconnect:async()=>{}};}},()=>{});
 await run(async()=>{written=true;imageTop=300;mutated();},{requireMutation:true,slot:{index:3,waitId:'b2',cardId:'card-1'}});
 assert.equal(imageTop,100,'the image is where the slot was');
 assert.equal(corrected.trim(),'image','the paragraph below was never the anchor');
});
