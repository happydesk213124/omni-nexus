import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../tools/vendor-patches/scroll-runtime.js',import.meta.url),'utf8');
const load=(t,hold,scope,k)=>new Function('t','nxScrollHoldOn','nxScrollContext','nxUnwrapSafeNodes','k','y',source+';return {hold:omniWithScrollWrite,track:omniStreamScrollTrack,end:omniStreamScrollEnd};')(t,hold,scope,async a=>a,k,()=>{});
// Risu's SafeElement accepts only these and throws for anything else (apiV3/v3.svelte.ts).
const RISU_EVENTS=new Set(['click','dblclick','contextmenu','mousedown','mouseup','mousemove','mouseover','mouseleave','pointercancel','pointerdown',
 'pointerenter','pointerleave','pointermove','pointerout','pointerover','pointerup','scroll','scrollend','keydown','keyup','keypress']);
const refused=[];
// As PocketRisu does it (apiV3/v3.svelte.ts): every listener goes on the document.
// A scroll does not bubble, so a listener that does not capture never hears the
// chat scroll; and one is removed only with the same capture flag, else it stays.
const capturing=options=>typeof options==='boolean'?options:!!options?.capture;
const listening=handlers=>({addEventListener:async(kind,fn,options)=>{if(!RISU_EVENTS.has(kind)&&refused.push(kind))throw Error(`Event listener of type '${kind}' is not allowed for security reasons.`);
  const id=String(handlers.size+Math.random()),deaf=kind==='scroll'&&!capturing(options);
  handlers.set(id,{kind,fn:deaf?()=>{}:fn,capture:capturing(options)});return id;},
 removeEventListener:async(kind,id,options)=>{const h=handlers.get(id);assert.equal(h?.kind,kind);if(h.capture===capturing(options))handlers.delete(id);}});
for(const mode of ['replace','manual','host-scroll','wheel','chat-switch','failure'])test('write-scoped scroll: '+mode,async()=>{
 let top=20,scope='a',corrections=0,disconnected=0;
 const handlers=new Map();let mutated;
 const rect=()=>({top,bottom:top+40,height:40});
 const paragraph={textContent:async()=> 'same paragraph',getBoundingClientRect:async()=>rect(),getStyleAttribute:async()=> 'color:red',setStyle:async(k,v)=>{assert.equal(k,'scrollMarginTop');paragraph.margin=Number.parseFloat(v);},setStyleAttribute:async value=>assert.equal(value,'color:red'),scrollIntoView:async()=>{top=paragraph.margin;corrections++;}};
 const body={querySelectorAll:async sel=>sel==='p'?[paragraph]:[]};
 const bubble={getBoundingClientRect:async()=>rect(),getOuterHTML:async()=>'<div data-chat-index="3"></div>',querySelector:async()=>body};
 const screen={getBoundingClientRect:async()=>({top:0,bottom:800,height:800}),querySelectorAll:async()=>[bubble],querySelector:async()=>bubble,...listening(handlers)};
 const doc={querySelector:async()=>screen};
 const {hold:run}=load({hostDoc:doc},()=>true,async()=>scope,{createMutationObserver:async cb=>{mutated=cb;return{observe:async()=>{},disconnect:async()=>{disconnected++;}};}});
 const work=async()=>{
   top=400;mutated();
   if(mode==='manual')for(const {kind,fn} of handlers.values())if(kind==='keydown')fn({key:'PageDown'});
   // The chat changing scrolls the view with it, right after the change: not the reader.
   if(mode==='host-scroll'){mutated();for(const {kind,fn} of [...handlers.values()])if(kind==='scroll')fn({});}
   // A wheel (Risu forwards none) is a scroll with nothing changed just before it.
   if(mode==='wheel'){await new Promise(r=>setTimeout(r,100));for(const {kind,fn} of [...handlers.values()])if(kind==='scroll')fn({});}
   if(mode==='chat-switch')scope='b';
   if(mode==='failure')throw Error('failed write');
   return 'saved';
 };
 if(mode==='failure')await assert.rejects(()=>run(work),/failed write/);else assert.equal(await run(work),'saved');
 if(mode==='replace' || mode==='host-scroll'){assert.equal(top,20);assert.equal(corrections,1);}else assert.equal(corrections,0);
 assert.equal(handlers.size,0);assert.equal(disconnected,1);
});

test('a tapped slot anchors its own image while it is baked, not a paragraph below it',async()=>{
 let written=false,imageTop=0,corrected='',mutated;
 const handlers=new Map();
 // The slot sits at 100px; once baked the message is drawn again and its image lands at 300px.
 const slotEl={getBoundingClientRect:async()=>({top:100,bottom:400,height:300})};
 const image={getBoundingClientRect:async()=>({top:imageTop,bottom:imageTop+300,height:300}),getStyleAttribute:async()=>'',
  setStyle:async(k,v)=>{assert.equal(k,'scrollMarginTop');image.margin=Number.parseFloat(v);},setStyleAttribute:async()=>{},
  scrollIntoView:async()=>{imageTop=image.margin;corrected+='image ';}};
 const paragraph={textContent:async()=>'a line below the slot',getBoundingClientRect:async()=>({top:420,bottom:460,height:40}),getStyleAttribute:async()=>'',
  setStyle:async()=>{},setStyleAttribute:async()=>{},scrollIntoView:async()=>{corrected+='paragraph ';}};
 const body={querySelectorAll:async sel=>sel==='p'?[paragraph]:[]};
 const bubble={getBoundingClientRect:async()=>({top:50,bottom:700,height:650}),getOuterHTML:async()=>'<div data-chat-index="3"></div>',
  querySelector:async sel=>sel==='[data-inray-wait="b2"]'?(written?null:slotEl):sel==='[data-inlay-inline-shot="card-1"]'?(written?image:null):sel==='.chattext'?body:null};
 const screen={getBoundingClientRect:async()=>({top:0,bottom:800,height:800}),querySelectorAll:async()=>[bubble],
  querySelector:async sel=>sel==='.risu-chat[data-chat-index="3"]'?bubble:null,...listening(handlers)};
 const doc={querySelector:async()=>screen};
 const {hold:run}=load({hostDoc:doc},()=>true,async()=>'a',{createMutationObserver:async cb=>{mutated=cb;return{observe:async()=>{},disconnect:async()=>{}};}});
 await run(async()=>{written=true;imageTop=300;mutated();},{requireMutation:true,slot:{index:3,waitId:'b2',cardId:'card-1'}});
 assert.equal(imageTop,100,'the image is where the slot was');
 assert.equal(corrected.trim(),'image','the paragraph below was never the anchor');
});

// A chat screen with one bubble of many paragraphs and a baked picture, counting
// what each hold costs on the bridge.
function screenFixture({paragraphCount=12,shotTop=null}={}) {
 const reads={text:0,outer:0,shallow:0,lookups:0},handlers=new Map();let mutated,shift=0;
 const paragraphs=Array.from({length:paragraphCount},(_,i)=>{
  const p={top:()=>60+i*50+shift,textContent:async()=>{reads.text++;return 'paragraph '+i;},
   getBoundingClientRect:async()=>({top:p.top(),bottom:p.top()+40,height:40}),getStyleAttribute:async()=>'',setStyle:async(_k,v)=>{p.margin=Number.parseFloat(v);},
   setStyleAttribute:async()=>{},scrollIntoView:async()=>{shift-=p.top()-p.margin;}};
  return p;
 });
 const shot=shotTop==null?null:{getBoundingClientRect:async()=>({top:shotTop+shift,bottom:shotTop+shift+500,height:500}),getOuterHTML:async()=>{reads.outer++;return '<div class="inray-shot" data-inlay-inline-shot="card-9"><img src="data:image/png;base64,AAAA"></div>';},
  getStyleAttribute:async()=>'',setStyle:async(_k,v)=>{shot.margin=Number.parseFloat(v);},setStyleAttribute:async()=>{},scrollIntoView:async()=>{shift-=shotTop+shift-shot.margin;}};
 const body={querySelectorAll:async sel=>sel==='p'?paragraphs:sel.startsWith('.inray-shot')&&shot?[shot]:[]};
 const bubble={getBoundingClientRect:async()=>({top:0,bottom:4000,height:4000}),
  // The full bubble carries megabytes of pictures; the shallow copy is the opening tag.
  getOuterHTML:async()=>{throw Error('read the whole bubble');},
  cloneNode:async deep=>{assert.equal(deep,false);reads.shallow++;return {getOuterHTML:async()=>'<div class="risu-chat" data-chat-index="5"></div>'};},
  querySelector:async sel=>{reads.lookups++;return sel==='.chattext'?body:sel==='.inray-shot[data-inlay-inline-shot="card-9"]'?shot:null;}};
 const screen={getBoundingClientRect:async()=>({top:0,bottom:800,height:800}),querySelectorAll:async()=>[bubble],
  querySelector:async sel=>sel==='.risu-chat[data-chat-index="5"]'?bubble:null,...listening(handlers)};
 const k={createMutationObserver:async cb=>{mutated=cb;return{observe:async()=>{},disconnect:async()=>{}};}};
 return {reads,handlers,paragraphs,shot,screen,k,doc:{querySelector:async()=>screen},move:px=>{shift+=px;mutated?.();},get shift(){return shift;}};
}

test('the anchor reads positions first: text of one paragraph, and the bubble opening tag only',async()=>{
 const f=screenFixture();
 const {hold}=load({hostDoc:f.doc},()=>true,async()=>'a',f.k);
 await hold(async()=>f.move(300),{requireMutation:true});
 assert.equal(f.shift,0,'the paragraph at the top is put back');
 assert.equal(f.reads.shallow,1,'the bubble index comes from a shallow copy, once');
 assert.ok(f.reads.text<=3,`text of the winning paragraph only, not all twelve (read ${f.reads.text})`);
});

test('the hold measures the node it found instead of looking it up every frame',async()=>{
 const f=screenFixture();
 const {hold}=load({hostDoc:f.doc},()=>true,async()=>'a',f.k);
 await hold(async()=>f.move(300),{requireMutation:true});
 // Read the anchor (1) + first locate (1); the settled frames after it measure only.
 assert.ok(f.reads.lookups<=3,`bubble lookups during the hold: ${f.reads.lookups}`);
});

test('a picture across the top of the screen is the anchor, read by its opening tag',async()=>{
 const f=screenFixture({shotTop:-30});
 const {hold}=load({hostDoc:f.doc},()=>true,async()=>'a',f.k);
 await hold(async()=>f.move(250),{requireMutation:true});
 assert.equal(f.shift,0,'the picture is put back where it was');
 assert.equal(f.shot.margin,-30,'the picture, not the paragraph under it, was scrolled to');
});

test('a hold marks the scroll busy for the TTS scan until it ends',async()=>{
 const f=screenFixture();
 const {hold}=load({hostDoc:f.doc},()=>true,async()=>'a',f.k);
 let during;
 await hold(async()=>{during=globalThis.__OMNI_SCROLL_BUSY__();f.move(300);},{requireMutation:true});
 assert.equal(during,true);assert.equal(globalThis.__OMNI_SCROLL_BUSY__(),false);
});

// The streaming bubble grows below; when the reply ends Risu takes it out and draws
// a new one (a new x-hashed), and the view lands on the start of the message.
function streamFixture() {
 const handlers=new Map();let mutated,view=0,ends=0,reads=0,hash=1,hashReads=0;
 const fire=kind=>{for(const h of [...handlers.values()])if(h.kind===kind)h.fn({});};
 const reply={top:()=>200-view,height:1400,getBoundingClientRect:async()=>{reads++;return {top:reply.top(),bottom:reply.top()+reply.height,height:reply.height};},
  scrollIntoView:async opts=>{assert.equal(opts.block,'end');ends++;view+=reply.top()+reply.height-800;}};
 const paragraph={textContent:async()=>'an earlier paragraph of the reply',getBoundingClientRect:async()=>({top:paragraph.getTop(),bottom:paragraph.getTop()+40,height:40}),getStyleAttribute:async()=>'',
  setStyle:async(_k,v)=>{paragraph.margin=Number.parseFloat(v);},setStyleAttribute:async()=>{},scrollIntoView:async()=>{view+=paragraph.getTop()-paragraph.margin;}};
 paragraph.getTop=()=>reply.top()+300;
 const body={querySelectorAll:async sel=>sel==='p'?[paragraph]:[]};
 Object.assign(reply,{cloneNode:async()=>({getOuterHTML:async()=>'<div data-chat-index="7">'}),querySelector:async sel=>sel==='.chattext'?body:null});
 // The message before it, which the reader may be reading instead.
 const older={getBoundingClientRect:async()=>({top:-600-view,bottom:150-view,height:750}),cloneNode:async()=>({getOuterHTML:async()=>'<div data-chat-index="6">'})};
 const olderParagraph={textContent:async()=>'a line of the message before',getBoundingClientRect:async()=>({top:olderParagraph.getTop(),bottom:olderParagraph.getTop()+40,height:40}),getStyleAttribute:async()=>'',
  setStyle:async(_k,v)=>{olderParagraph.margin=Number.parseFloat(v);},setStyleAttribute:async()=>{},scrollIntoView:async()=>{view+=olderParagraph.getTop()-olderParagraph.margin;}};
 olderParagraph.getTop=()=>-200-view;
 const olderBody={querySelectorAll:async sel=>sel==='p'?[olderParagraph]:[]};
 older.querySelector=async sel=>sel==='.chattext'?olderBody:null;
 const container={getAttribute:async name=>{hashReads++;return name==='x-hashed'?String(hash):null;}};
 const screen={getBoundingClientRect:async()=>({top:0,bottom:800,height:800}),querySelectorAll:async()=>[reply,older],
  querySelector:async sel=>sel==='[x-hashed]'?container:sel==='.risu-chat[data-chat-index="7"]'?reply:sel==='.risu-chat[data-chat-index="6"]'?older:null,...listening(handlers)};
 const t={hostDoc:{querySelector:async()=>screen},backendSettings:{card:{stream_scroll_hold:true}}};
 const observers=new Set();mutated=()=>{for(const cb of [...observers])cb([]);};
 const k={createMutationObserver:async cb=>{const o={observe:async()=>{observers.add(cb);},disconnect:async()=>{observers.delete(cb);}};return o;}};
 const api=load(t,()=>false,async()=>'chat',k);
 return {t,api,handlers,
  // The reader's scroll: a finger down, the view moving, the finger up.
  scrollTo:v=>{fire('pointerdown');view=v;fire('scroll');fire('pointerup');},
  // A scroll with no hand on it that is still the reader's place: Risu moving to a new reply.
  moveTo:v=>{view=v;fire('scroll');},
  // Risu takes the bubble out and draws a new one; the view lands elsewhere.
  redraw:v=>{hash++;view=v;mutated?.();fire('scroll');},
  // Risu's 끄기 mode: every chunk is a new bubble, and the stream goes on.
  chunkRedraw:()=>{hash++;mutated?.();},
  get view(){return view;},get ends(){return ends;},get reads(){return reads;},get hashReads(){return hashReads;}};
}
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const SETTLE=650;   // past one half-second mark

test('streaming scroll hold: following the bottom, the end of the reply goes back to the bottom',async()=>{
 const f=streamFixture();
 f.api.track();await f.api.track();
 f.scrollTo(800);await wait(SETTLE);        // the reader follows the newest line
 const done=f.api.end();await wait(60);f.redraw(0);
 await done;
 assert.equal(f.view,800,'the bottom of the reply is on screen again');
 assert.ok(f.ends>=1);
 assert.equal(f.handlers.size,0,'no listener outlives the reply');
});

test('streaming scroll hold: reading higher up, the paragraph across the middle returns where it was',async()=>{
 const f=streamFixture();
 f.api.track();await f.api.track();
 f.scrollTo(400);await wait(SETTLE);
 const done=f.api.end();await wait(60);f.redraw(0);
 await done;
 assert.equal(f.view,400);
 assert.equal(f.ends,0,'not pushed to the bottom');
});

test('streaming scroll hold: a place reached with no hand on the screen is still the reader\'s',async()=>{
 const f=streamFixture();
 f.api.track();await f.api.track();
 f.moveTo(400);await wait(SETTLE);          // e.g. Risu moving to the new reply, or a wheel
 f.redraw(0);
 await f.api.end();
 assert.equal(f.view,400);
});

test('streaming scroll hold: reading an earlier message, that message comes back',async()=>{
 const f=streamFixture();
 f.api.track();await f.api.track();
 f.scrollTo(-500);await wait(SETTLE);
 f.redraw(0);
 await f.api.end();
 assert.equal(f.view,-500,'the earlier message is where it was');
 assert.equal(f.ends,0);
});

test('streaming scroll hold: chunks do not read the screen, only a moving view does',async()=>{
 const f=streamFixture();
 f.api.track();await f.api.track();
 const before=f.reads;
 for(let i=0;i<50;i++)f.api.track();
 await wait(20);
 assert.equal(f.reads,before,'fifty chunks, no reads');
 await f.api.end();
});

test('streaming scroll hold: a moving view is read at most every half second',async()=>{
 const f=streamFixture();
 f.api.track();await f.api.track();
 const before=f.hashReads;
 for(let i=0;i<30;i++){f.moveTo(300+i);await wait(10);}
 await wait(SETTLE);
 // Each mark checks the bubble twice; thirty scroll events in ~0.3 s make one or two marks.
 assert.ok(f.hashReads-before<=4,`marks while scrolling: ${(f.hashReads-before)/2}`);
 f.redraw(0);
 await f.api.end();
 assert.equal(f.view,329,'the mark after the view stopped');
});

test('streaming scroll hold: a reply output once (not streamed), or the setting off, does nothing',async()=>{
 const once=streamFixture();
 once.api.track();await once.api.end();
 assert.equal(once.reads,0);
 const off=streamFixture();off.t.backendSettings.card.stream_scroll_hold=false;
 off.api.track();await off.api.track();off.redraw(0);await off.api.end();
 assert.equal(off.reads,0);assert.equal(off.handlers.size,0);
});

// The bug: Risu takes the finished reply out and draws a new bubble, which throws the
// view to its start, and tells plugins the reply ended only after that.
for (const late of [false, true])
test(`streaming scroll hold: the view after Risu draws the reply anew is never marked (${late ? 'end a while after it' : 'end right after it'})`,async()=>{
 const f=streamFixture();
 f.api.track();await f.api.track();
 f.scrollTo(400);await wait(SETTLE);        // the reader stops in the middle of the reply
 f.redraw(0);                                // Risu: new bubble, view at the message start
 if(late)await wait(SETTLE);                 // its triggers ran; the end notice comes later
 await f.api.end();
 assert.equal(f.view,400,'back where the reader was, not at the start of the reply');
});

test('streaming scroll hold: in Risu\'s 끄기 mode a new bubble per chunk does not stop the marks',async()=>{
 const f=streamFixture();
 f.api.track();await f.api.track();
 f.scrollTo(400);await wait(SETTLE);
 f.chunkRedraw();f.moveTo(350);await wait(SETTLE);   // a new bubble: that mark is dropped
 f.api.track();                              // the next chunk: the stream goes on
 f.moveTo(300);await wait(SETTLE);
 f.redraw(0);
 await f.api.end();
 assert.equal(f.view,300,'marked after the chunk, against the bubble as it is now');
});

test('streaming scroll hold: a finger still on the screen at the end is left alone',async()=>{
 const f=streamFixture();
 f.api.track();await f.api.track();
 f.scrollTo(400);await wait(SETTLE);
 for(const h of [...f.handlers.values()])if(h.kind==='pointerdown')h.fn({});
 f.redraw(0);
 await f.api.end();
 assert.equal(f.view,0);
});

// Last: nothing above asked Risu for an event it refuses. A refused type once threw
// before the write it guarded, and no picture was baked.
test('every listener the scroll code adds is one Risu forwards',()=>{
 assert.deepEqual(refused,[]);
});
