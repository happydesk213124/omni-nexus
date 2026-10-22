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
 const handlers=new Map(),docHandlers=new Map();let mutated;
 const rect=()=>({top,bottom:top+40,height:40});
 const paragraph={textContent:async()=> 'same paragraph',getBoundingClientRect:async()=>rect(),getStyleAttribute:async()=> 'color:red',setStyle:async(k,v)=>{assert.equal(k,'scrollMarginTop');paragraph.margin=Number.parseFloat(v);},setStyleAttribute:async value=>assert.equal(value,'color:red'),scrollIntoView:async()=>{top=paragraph.margin;corrections++;}};
 const body={querySelectorAll:async sel=>sel==='p'?[paragraph]:[]};
 const bubble={getBoundingClientRect:async()=>rect(),getOuterHTML:async()=>'<div data-chat-index="3"></div>',querySelector:async()=>body};
 const screen={getBoundingClientRect:async()=>({top:0,bottom:800,height:800}),querySelectorAll:async()=>[bubble],querySelector:async()=>bubble,...listening(handlers)};
 // Upstream Risu (#1610): the focused input box sends keys to the document, never to the chat.
 const doc={querySelector:async()=>screen,...listening(docHandlers)};
 const {hold:run}=load({hostDoc:doc},()=>true,async()=>scope,{createMutationObserver:async cb=>{mutated=cb;return{observe:async()=>{},disconnect:async()=>{disconnected++;}};}});
 const work=async()=>{
   top=400;mutated();
   if(mode==='manual')for(const {kind,fn} of docHandlers.values())if(kind==='keydown')fn({key:'PageDown'});
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
 assert.equal(handlers.size,0);assert.equal(docHandlers.size,0,'the document listener is removed too');assert.equal(disconnected,1);
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

// The streaming bubble grows below. Chunks come while it streams, the last one just
// before the end; then Risu takes the bubble out and draws a new one, the view lands
// on the start of the message, and only after that does the end notice come.
function streamFixture() {
 const handlers=new Map();let mutated,view=0,ends=0,reads=0,markReads=0;
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
 const screen={getBoundingClientRect:async()=>({top:0,bottom:800,height:800}),querySelectorAll:async()=>{markReads++;return [reply,older];},
  querySelector:async sel=>sel==='.risu-chat[data-chat-index="7"]'?reply:sel==='.risu-chat[data-chat-index="6"]'?older:null,...listening(handlers)};
 const t={hostDoc:{querySelector:async()=>screen},backendSettings:{card:{stream_scroll_hold:true}}};
 const observers=new Set();mutated=()=>{for(const cb of [...observers])cb([]);};
 const k={createMutationObserver:async cb=>{const o={observe:async()=>{observers.add(cb);},disconnect:async()=>{observers.delete(cb);}};return o;}};
 const api=load(t,()=>false,async()=>'chat',k);
 return {t,api,handlers,screen,
  // The reader's scroll: a finger down, the view moving, the finger up.
  scrollTo:v=>{fire('pointerdown');view=v;fire('scroll');fire('pointerup');},
  // A scroll with no hand on it that is still the reader's place: Risu moving to a new reply, a wheel.
  moveTo:v=>{view=v;fire('scroll');},
  // A chunk of the reply: the stream goes on.
  chunk:()=>{api.track();},
  // Risu takes the bubble out and draws a new one; the view lands elsewhere.
  redraw:v=>{view=v;mutated?.();fire('scroll');},
  get view(){return view;},get ends(){return ends;},get reads(){return reads;},get markReads(){return markReads;}};
}
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const SETTLE=650;   // past one half-second mark
const start=async f=>{f.chunk();await f.api.track();};

test('streaming scroll hold: following the bottom, the end of the reply goes back to the bottom',async()=>{
 const f=streamFixture();await start(f);
 f.scrollTo(800);await wait(SETTLE);        // the reader follows the newest line
 f.chunk();                                  // the last chunk, then Risu draws the reply anew
 const done=f.api.end();await wait(60);f.redraw(0);
 await done;
 assert.equal(f.view,800,'the bottom of the reply is on screen again');
 assert.ok(f.ends>=1);
 assert.equal(f.handlers.size,0,'no listener outlives the reply');
});

test('streaming scroll hold: reading higher up, the paragraph across the middle returns where it was',async()=>{
 const f=streamFixture();await start(f);
 f.scrollTo(400);await wait(SETTLE);
 f.chunk();
 const done=f.api.end();await wait(60);f.redraw(0);
 await done;
 assert.equal(f.view,400);
 assert.equal(f.ends,0,'not pushed to the bottom');
});

test('streaming scroll hold: a place reached with no hand on the screen is still the reader\'s',async()=>{
 const f=streamFixture();await start(f);
 f.moveTo(400);await wait(SETTLE);
 f.chunk();f.redraw(0);
 await f.api.end();
 assert.equal(f.view,400);
});

test('streaming scroll hold: reading an earlier message, that message comes back',async()=>{
 const f=streamFixture();await start(f);
 f.scrollTo(-500);await wait(SETTLE);
 f.chunk();f.redraw(0);
 await f.api.end();
 assert.equal(f.view,-500,'the earlier message is where it was');
 assert.equal(f.ends,0);
});

test('streaming scroll hold: chunks do not read the screen, only a moving view does',async()=>{
 const f=streamFixture();await start(f);
 const before=f.reads;
 for(let i=0;i<50;i++)f.chunk();
 await wait(20);
 assert.equal(f.reads,before,'fifty chunks, no reads');
 await f.api.end();
});

test('streaming scroll hold: a moving view is read at most every half second',async()=>{
 const f=streamFixture();await start(f);
 const before=f.markReads;
 for(let i=0;i<30;i++){f.moveTo(300+i);await wait(10);}
 await wait(SETTLE);
 assert.ok(f.markReads-before<=2,`marks while scrolling: ${f.markReads-before}`);
 f.chunk();f.redraw(0);
 await f.api.end();
 assert.equal(f.view,329,'the mark after the view stopped');
});

test('streaming scroll hold: a reply output once (not streamed), or the setting off, does nothing',async()=>{
 const once=streamFixture();
 once.chunk();await once.api.end();
 assert.equal(once.reads,0);
 const off=streamFixture();off.t.backendSettings.card.stream_scroll_hold=false;
 await start(off);off.redraw(0);await off.api.end();
 assert.equal(off.reads,0);assert.equal(off.handlers.size,0);
});

// Risu takes the finished reply out and draws a new bubble, which throws the view,
// and tells plugins the reply ended only after that: on a phone, a good while after.
for (const late of [false, true])
test(`streaming scroll hold: the view after Risu draws the reply anew is never the mark (${late ? 'end a while after it' : 'end right after it'})`,async()=>{
 const f=streamFixture();await start(f);
 f.scrollTo(400);await wait(SETTLE);        // the reader stops in the middle of the reply
 f.chunk();                                  // the last chunk
 f.redraw(0);                                // Risu: new bubble, view at the message start
 if(late)await wait(SETTLE);                 // marked again: the jump, after the last chunk
 await f.api.end();
 assert.equal(f.view,400,'back where the reader was, not where the redraw threw the view');
});

// The phone bug: a picture going in mid-stream draws the bubble anew too. That once
// switched the marks to "every chunk resets", and the end's jump became the mark.
test('streaming scroll hold: a bubble drawn anew mid-stream does not let the end\'s jump become the mark',async()=>{
 const f=streamFixture();await start(f);
 f.redraw(-50);f.chunk();                    // a picture went in; the stream goes on
 f.scrollTo(400);await wait(SETTLE);        // the reader settles in the middle
 f.chunk();f.chunk();                        // more chunks, the last one
 f.redraw(800);                              // the end's redraw throws the view to the bottom
 await wait(SETTLE);                         // the end notice comes late, after a mark of the jump
 await f.api.end();
 assert.equal(f.view,400,'the reader\'s place, not the bottom the redraw left');
});

test('streaming scroll hold: in Risu\'s 끄기 mode, a new bubble every chunk, the marks go on',async()=>{
 const f=streamFixture();await start(f);
 for(let i=0;i<3;i++){f.redraw(400);f.chunk();await wait(100);}
 f.moveTo(300);await wait(SETTLE);
 f.chunk();f.redraw(0);
 await f.api.end();
 assert.equal(f.view,300,'the last place the reader stopped while it streamed');
});

test('streaming scroll hold: a finger still on the screen at the end is left alone',async()=>{
 const f=streamFixture();await start(f);
 f.scrollTo(400);await wait(SETTLE);
 f.chunk();
 for(const h of [...f.handlers.values()])if(h.kind==='pointerdown')h.fn({});
 f.redraw(0);
 await f.api.end();
 assert.equal(f.view,0);
});

// Seen on a phone over a remote link: the redraw's own scroll crosses Risu's bridge late
// and reaches the end's hold the moment it starts listening, before any change it could
// blame it on. With no hand on the screen it is not the reader, and the place comes back.
test('streaming scroll hold: the redraw late scroll, heard as the end starts listening, is not the reader',async()=>{
 const f=streamFixture();await start(f);
 f.scrollTo(400);await wait(SETTLE);
 f.chunk();
 f.redraw(0);
 const add=f.screen.addEventListener;let late=true;
 f.screen.addEventListener=async(kind,fn,options)=>{const id=await add(kind,fn,options);if(kind==='scroll'&&late){late=false;queueMicrotask(()=>fn({}));}return id;};
 await f.api.end();
 assert.equal(late,false,'the late scroll was heard');
 assert.equal(f.view,400,'back where the reader was');
});

// Risu swaps the reply's wrapper in the message list when it redraws it, and on a phone
// announces the end seconds later. Heard on the list, the place comes back at once.
function watchedList(f) {
 const q=f.screen.querySelector,list={},wrapper={getParent:async()=>list},bubble={getParent:async()=>wrapper};
 f.screen.querySelector=async sel=>sel==='[x-hashed] > .risu-chat'?bubble:q(sel);
}
test('streaming scroll hold: a reply redrawn in a new wrapper comes back at once, before the end is announced',async()=>{
 const f=streamFixture();watchedList(f);await start(f);
 f.scrollTo(400);await wait(SETTLE);
 f.chunk();
 f.redraw(0);                                // the swap: the view falls to the bottom
 await wait(300);
 assert.equal(f.view,400,'back before any end notice');
 await f.api.end();
 assert.equal(f.view,400);
 assert.equal(f.handlers.size,0,'no listener outlives the reply');
});
test('streaming scroll hold: following the newest line, a swap leaves the view where Risu put it',async()=>{
 const f=streamFixture();watchedList(f);await start(f);
 f.scrollTo(800);await wait(SETTLE);
 f.chunk();
 f.redraw(800);await wait(300);
 assert.equal(f.ends,0,'nothing pulled while following');
 await f.api.end();
});
test('streaming scroll hold: a finger on the screen as the reply is swapped is left alone',async()=>{
 const f=streamFixture();watchedList(f);await start(f);
 f.scrollTo(400);await wait(SETTLE);
 f.chunk();
 for(const h of [...f.handlers.values()])if(h.kind==='pointerdown')h.fn({});
 f.redraw(0);await wait(300);
 assert.equal(f.view,0,'the reader is placing the view');
});

// From a phone's trace (디버그 > 스크롤): reading the screen took seconds there, marks
// piled up eight at once, and one measured after the end's redraw carried an earlier
// chunk's number, so the end sent the reader to that redraw's view.
function slowScreen(f, ms) {
 const q=f.screen.querySelectorAll;let inflight=0;const state={max:0,get inflight(){return inflight;}};
 f.screen.querySelectorAll=async sel=>{inflight++;state.max=Math.max(state.max,inflight);try{await wait(ms);return await q(sel);}finally{inflight--;}};
 return state;
}
test('streaming scroll hold: a slow screen is read one mark at a time, never piled up',async()=>{
 const f=streamFixture();await start(f);
 const slow=slowScreen(f,900);
 for(let i=0;i<20;i++){f.moveTo(400+i);await wait(100);}
 await wait(2000);
 assert.equal(slow.max,1,'marks overlapped: '+slow.max);
 f.chunk();await f.api.end();
});
test('streaming scroll hold: a mark still being read when the reply is redrawn is not taken as the place before it',async()=>{
 const f=streamFixture();await start(f);
 f.scrollTo(400);await wait(SETTLE);          // a good mark of the reader's place
 const slow=slowScreen(f,400);
 f.moveTo(401);                              // a mark starts, reading slowly
 for(let i=0;i<40 && !slow.inflight;i++)await wait(20);
 f.chunk();f.redraw(0);                      // the last chunk and the redraw, mid-read
 await wait(900);
 await f.api.end();
 assert.equal(f.view,400,'the reader\'s place, not the redraw\'s view the slow mark measured');
});
test('streaming scroll hold: a finger down as the reply is swapped delays the restore until it lifts',async()=>{
 const f=streamFixture();watchedList(f);await start(f);
 f.scrollTo(400);await wait(SETTLE);
 f.chunk();
 for(const h of [...f.handlers.values()])if(h.kind==='pointerdown')h.fn({});
 f.redraw(0);await wait(150);
 assert.equal(f.view,0,'not while the finger is down');
 for(const h of [...f.handlers.values()])if(h.kind==='pointercancel')h.fn({});
 await wait(900);
 assert.equal(f.view,400,'back once it lifted without moving the view');
 await f.api.end();
});

test('streaming scroll hold: a finger that took the view elsewhere after the swap is followed, not undone',async()=>{
 const f=streamFixture();watchedList(f);await start(f);
 f.screen.getProperty=async key=>key==='scrollTop'?-f.view:undefined;
 f.scrollTo(400);await wait(SETTLE);
 f.chunk();
 for(const h of [...f.handlers.values()])if(h.kind==='pointerdown')h.fn({});
 f.redraw(0);await wait(50);
 for(const h of [...f.handlers.values()])if(h.kind==='pointercancel')h.fn({});
 f.moveTo(250);await wait(900);              // the drag goes on with no pointer events
 assert.equal(f.view,250,'where the hand put it');
 assert.match(globalThis.__OMNI_SCROLL_TRACE__.lines().join(' | '),/손가락으로 250px 옮김/);
 await f.api.end();
 assert.equal(f.view,250,'the end does not pull the reader back either');
});
test('streaming scroll hold: a place already restored at the swap is not pulled again when the end comes late',async()=>{
 const f=streamFixture();watchedList(f);await start(f);
 f.scrollTo(400);await wait(SETTLE);
 f.chunk();f.redraw(0);await wait(300);
 assert.equal(f.view,400);
 f.scrollTo(300);await wait(SETTLE);        // the reader reads on, by hand
 await f.api.end();
 assert.equal(f.view,300,'the end leaves the reader where they went');
 assert.match(globalThis.__OMNI_SCROLL_TRACE__.lines().join(' | '),/갈아끼울 때 이미 복원함/);
});

// 디버그 > 스크롤 reads a phone's runs from this trace: what was marked, what was decided.
test('streaming scroll hold: the trace says what it marked, restored, and why it skipped',async()=>{
 globalThis.__OMNI_SCROLL_TRACE__?.clear();
 let f=streamFixture();watchedList(f);await start(f);
 f.scrollTo(400);await wait(SETTLE);
 f.chunk();f.redraw(0);await wait(300);
 await f.api.end();
 let lines=globalThis.__OMNI_SCROLL_TRACE__.lines().join(' | ');
 for(const want of ['추적 시작','표시 (조각','목록 감시 켜짐','갈아끼움 → 복원 시도: 메시지7','갈아끼움 복원 결과: 자리 맞춤','끝 알림','손가락 닿음','손가락 뗌'])
  assert.ok(lines.includes(want),want+' missing in: '+lines);
 globalThis.__OMNI_SCROLL_TRACE__.clear();
 f=streamFixture();watchedList(f);await start(f);
 f.scrollTo(400);await wait(SETTLE);f.chunk();
 for(const h of [...f.handlers.values()])if(h.kind==='pointerdown')h.fn({});
 f.redraw(0);await wait(300);await f.api.end();
 lines=globalThis.__OMNI_SCROLL_TRACE__.lines().join(' | ');
 assert.match(lines,/건너뜀: 손가락 닿아 있음/);
});

// Last: nothing above asked Risu for an event it refuses. A refused type once threw
// before the write it guarded, and no picture was baked.
test('every listener the scroll code adds is one Risu forwards',()=>{
 assert.deepEqual(refused,[]);
});
