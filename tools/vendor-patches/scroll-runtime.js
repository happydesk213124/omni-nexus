// A hold exists only around a message write, never throughout a server request.
let omniScrollTail=Promise.resolve(), omniScrollEpoch=0, omniScrollBusy=0;
// The TTS scan reads every message on screen; while a hold is correcting the view
// it waits, so the two never queue bridge calls against each other.
globalThis.__OMNI_SCROLL_BUSY__=()=>omniScrollBusy>0;
async function omniScrollContext() {
  if(typeof k.getCurrentCharacterIndex==='function' && typeof k.getCurrentChatIndex==='function') {
    return JSON.stringify(await Promise.all([k.getCurrentCharacterIndex(),k.getCurrentChatIndex()]));
  }
  return nxScrollContext();
}
// SafeElement reads x-* attributes only, so data-* comes from the HTML. A bubble's
// outerHTML carries every baked picture as base64 — megabytes for one number — while
// a shallow copy is just the opening tag.
let omniShallowTags=true;
async function omniOpeningTag(node) {
  if(omniShallowTags && typeof node.cloneNode==='function') {
    try {
      const copy=await node.cloneNode(false);
      try {return String(await copy.getOuterHTML() || '');}
      finally {if(typeof copy.release==='function')await copy.release();}
    } catch {omniShallowTags=false;}
  }
  const html=String(await node.getOuterHTML() || '');
  return html.slice(0,html.indexOf('>')+1);
}
const OMNI_SLOT_ID=/^[a-zA-Z0-9_-]{1,256}$/;
const omniOnScreen=(r,sr)=>r.height>0&&r.bottom>sr.top&&r.top<sr.bottom;
async function omniReadAnchor() {
  const doc=t.hostDoc || await ue();if(!doc)return null;
  const screen=await doc.querySelector('.default-chat-screen');if(!screen)return null;
  const sr=await screen.getBoundingClientRect();
  const bubbles=await nxUnwrapSafeNodes(await screen.querySelectorAll('.risu-chat'));
  // Positions first; text and attributes only for the candidate that wins.
  const candidates=[];
  for(const bubble of bubbles) {
    if(!omniOnScreen(await bubble.getBoundingClientRect(),sr))continue;
    const body=await bubble.querySelector('.chattext');if(!body)continue;
    const paragraphs=await nxUnwrapSafeNodes(await body.querySelectorAll('p'));
    const shots=await nxUnwrapSafeNodes(await body.querySelectorAll('.inray-shot[data-inlay-inline-shot]'));
    const add=(node,r,extra)=>{if(omniOnScreen(r,sr))candidates.push({bubble,node,offset:r.top-sr.top,score:Math.abs(r.top-sr.top),...extra});};
    for(let i=0;i<paragraphs.length;i++)add(paragraphs[i],await paragraphs[i].getBoundingClientRect(),{paragraph:i});
    // A picture across the top of the screen is what the reader is looking at.
    for(const shot of shots)add(shot,await shot.getBoundingClientRect(),{shot:true});
    if(!paragraphs.length)add(body,await body.getBoundingClientRect(),{paragraph:-1});
  }
  candidates.sort((a,b)=>a.score-b.score);
  const indexes=new Map();
  for(const c of candidates) {
    if(!indexes.has(c.bubble))indexes.set(c.bubble,Number(/data-chat-index="(\d+)"/.exec(await omniOpeningTag(c.bubble))?.[1] ?? -1));
    const index=indexes.get(c.bubble);if(index<0)continue;
    if(c.shot) {
      const id=/data-inlay-inline-shot="([^"]*)"/.exec(await omniOpeningTag(c.node))?.[1] || '';
      if(OMNI_SLOT_ID.test(id))return {scope:await omniScrollContext(),index,shot:id,offset:c.offset};
      continue;
    }
    const text=String(await c.node.textContent() || '').trim();
    if(text)return {scope:await omniScrollContext(),index,paragraph:c.paragraph,text,offset:c.offset};
  }
  return null;
}
// A double-tapped pink slot is the anchor while its image replaces it: the reader is
// looking at that slot, and a paragraph below it would hold still while the image
// above it changed height, so the picture itself seemed to jump.
async function omniReadSlotAnchor(slot) {
  if(!slot || !Number.isInteger(slot.index) || !OMNI_SLOT_ID.test(slot.waitId || '') || !OMNI_SLOT_ID.test(slot.cardId || ''))return null;
  const doc=t.hostDoc || await ue();if(!doc)return null;
  const screen=await doc.querySelector('.default-chat-screen');if(!screen)return null;
  const bubble=await screen.querySelector('.risu-chat[data-chat-index="'+slot.index+'"]');
  const node=bubble && await bubble.querySelector('[data-inray-wait="'+slot.waitId+'"]');if(!node)return null;
  const [rect,sr]=await Promise.all([node.getBoundingClientRect(),screen.getBoundingClientRect()]);
  // Off screen: nothing the reader sees moves with it; the usual anchor applies.
  if(!rect.height || rect.bottom<=sr.top || rect.top>=sr.bottom)return null;
  return {scope:await omniScrollContext(),index:slot.index,slot,offset:rect.top-sr.top};
}
async function omniLocateSlot(anchor,screen) {
  const bubble=await screen.querySelector('.risu-chat[data-chat-index="'+anchor.index+'"]');if(!bubble)return null;
  // The image once the message is drawn again; the slot until then.
  const image=await bubble.querySelector('[data-inlay-inline-shot="'+anchor.slot.cardId+'"]');
  const node=image || await bubble.querySelector('[data-inray-wait="'+anchor.slot.waitId+'"]');
  if(!node)return null;
  // Only the image is final: the slot must be looked up again until it is replaced.
  return {node,final:!!image};
}
// The newest message is the lowest one; Risu's list is reversed, so it is at either end.
async function omniLowestBubble(screen) {
  const bubbles=await nxUnwrapSafeNodes(await screen.querySelectorAll('.risu-chat'));
  let best=null;
  for(const node of new Set([bubbles[0],bubbles[bubbles.length-1]]))if(node) {
    const rect=await node.getBoundingClientRect();
    if(rect.height>0 && (!best || rect.bottom>best.rect.bottom))best={node,rect};
  }
  return best;
}
async function omniLocateNode(anchor,screen) {
  if(anchor.bottom){const lowest=await omniLowestBubble(screen);return lowest && {node:lowest.node,final:true};}
  if(anchor.slot)return omniLocateSlot(anchor,screen);
  const bubble=await screen.querySelector('.risu-chat[data-chat-index="'+anchor.index+'"]');if(!bubble)return null;
  if(anchor.shot){const node=await bubble.querySelector('.inray-shot[data-inlay-inline-shot="'+anchor.shot+'"]');return node && {node,final:true};}
  const body=await bubble.querySelector('.chattext');if(!body)return null;
  if(anchor.paragraph<0)return {node:body,final:true};
  const paragraphs=await nxUnwrapSafeNodes(await body.querySelectorAll('p'));
  const same=async p=>p && String(await p.textContent() || '').trim()===anchor.text;
  if(await same(paragraphs[anchor.paragraph]))return {node:paragraphs[anchor.paragraph],final:true};
  // The paragraph moved: the same text nearest its old place. A line still being
  // streamed has only grown, so its start is enough.
  let node=null,distance=Infinity;
  for(let i=0;i<paragraphs.length;i++) {
    const text=String(await paragraphs[i].textContent() || '').trim();
    if((text===anchor.text || anchor.text.length>=12 && text.startsWith(anchor.text)) && Math.abs(i-anchor.paragraph)<distance){node=paragraphs[i];distance=Math.abs(i-anchor.paragraph);}
  }
  return node && {node,final:true};
}
async function omniLocateAnchor(anchor) {
  if(anchor.scope!==await omniScrollContext())return null;
  const doc=t.hostDoc || await ue(),screen=doc && await doc.querySelector('.default-chat-screen');if(!screen)return null;
  const found=await omniLocateNode(anchor,screen);
  return found && omniMeasure(anchor,found.node,screen,found.final);
}
async function omniMeasure(anchor,node,screen,final) {
  const [rect,sr]=await Promise.all([node.getBoundingClientRect(),screen.getBoundingClientRect()]);
  if(!rect.height)return null;
  // Following the bottom: only a newest message pushed below the screen is wrong.
  const error=anchor.bottom?rect.bottom-sr.bottom:rect.top-sr.top-anchor.offset;
  return {node,rect,sr,final,error,off:anchor.bottom?error>1.25:Math.abs(error)>1.25};
}
function omniScrollQueue(run) {
  const wrapped=async()=>{omniScrollBusy++;try{return await run();}finally{omniScrollBusy--;}};
  const pending=omniScrollTail.then(wrapped,wrapped);omniScrollTail=pending.catch(()=>{});return pending;
}
// Risu scrolls the chat as well: once a streamed reply ends it takes the bubble out
// and draws a new one, and the view jumps with that. A scroll is the reader's when a
// finger or the mouse is held down, a scroll key was just pressed, it glides on from
// one of those, or nothing in the chat changed just before it — which is how a mouse
// wheel or the scroll bar looks, since Risu forwards no wheel events to plugins.
// Only these event types may be listened to: Risu throws for any other.
const OMNI_SCROLL_KEYS=['ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' '];
function omniReaderScrolls() {
  let pressedAt=0,inputAt=-Infinity,glideAt=-Infinity,changedAt=-Infinity;
  // A host that never forwards the release must not make every later scroll the reader's.
  const pressed=()=>pressedAt>0 && performance.now()-pressedAt<8000;
  return {
    pressed,
    // From a mutation observer on the chat: a scroll right after it is the chat's own.
    changed:()=>{changedAt=performance.now();},
    // A lifted finger is not input: only the glide that runs on from it, frame by frame.
    // keydown reaches plugins up to 99 ms late, so its window allows for that.
    listeners:[['pointerdown',()=>{pressedAt=performance.now();}],['pointerup',()=>{if(pressed())glideAt=performance.now();pressedAt=0;}],
      ['pointercancel',()=>{if(pressed())glideAt=performance.now();pressedAt=0;}],['keydown',e=>{if(OMNI_SCROLL_KEYS.includes(e?.key))inputAt=performance.now();}]],
    // From a scroll listener: whether the reader made this scroll.
    scroll:()=>{
      const now=performance.now(),mine=pressed() || now-inputAt<400 || now-glideAt<150 || now-changedAt>80;
      if(mine)glideAt=now;
      return mine;
    },
  };
}
// A listener Risu refuses must never stop the work it was meant to watch.
async function omniListen(target,name,fn,into) {
  try {into.push([name,await target.addEventListener(name,fn)]);}
  catch(error) {y('warn','scroll.listen',name+': '+String(error));}
}
// Run the work, then keep the anchor where it was for up to two seconds, until the
// layout settles or the reader moves.
async function omniHoldAnchor(anchor,work,options={}) {
  const epoch=++omniScrollEpoch;
  const doc=t.hostDoc || await ue(),screen=doc && await doc.querySelector('.default-chat-screen');
  if(!screen)return work();
  let userMoved=false,own=false,ownAt=-Infinity,dirty=0,observer=null;
  const registered=[],reader=omniReaderScrolls();
  const input=()=>{userMoved=true;};
  // The scroll our own correction causes arrives a frame after it returns.
  const scroll=()=>{if(!own && performance.now()-ownAt>120 && reader.scroll())input();};
  const listeners=[...reader.listeners,['pointermove',()=>{if(reader.pressed())input();}],
    ['keydown',e=>{if(OMNI_SCROLL_KEYS.includes(e?.key))input();}],['scroll',scroll]];
  try {
    for(const [name,fn] of listeners)await omniListen(screen,name,fn,registered);
    try {
      observer=await k.createMutationObserver(()=>{dirty++;reader.changed();});
      await observer.observe(screen,{childList:true,subtree:true});
    } catch(error) {observer=null;y('warn','scroll.observe',String(error));}
    const result=await work();
    let stable=0,settled=false,lastDirty=-1,lastHeight=-1,held=null;
    const end=performance.now()+2000;
    while(epoch===omniScrollEpoch&&!userMoved&&!t.unloading&&performance.now()<end) {
      // The node found last time is measured directly. Once Risu draws the message
      // again it is detached and measures zero, and only then is it looked up anew.
      let found=held && await omniMeasure(anchor,held,screen,true);
      if(!found) {
        if(anchor.scope!==await omniScrollContext())break;
        found=await omniLocateAnchor(anchor);
        held=found?.final?found.node:null;
      }
      if(found) {
        if(found.off) {
          own=true;
          try {
            if(anchor.bottom) {
              if(!userMoved)await found.node.scrollIntoView({behavior:'instant',block:'end',inline:'nearest'});
            } else {
              const original=await found.node.getStyleAttribute();
              try {
                await found.node.setStyle('scrollMarginTop',anchor.offset+'px');
                if(!userMoved)await found.node.scrollIntoView({behavior:'instant',block:'start',inline:'nearest'});
              } finally {await found.node.setStyleAttribute(original || '');}
            }
          } finally {own=false;ownAt=performance.now();}
          stable=0;
        } else if(lastDirty===dirty && Math.abs(lastHeight-found.rect.height)<1)stable++;else stable=0;
        lastDirty=dirty;lastHeight=found.rect.height;
        if(stable>=3 && (!options.requireMutation || dirty>0)){settled=true;break;}
      }
      await new Promise(resolve=>setTimeout(resolve,32));
    }
    if(!settled&&!userMoved&&anchor.scope===await omniScrollContext())y('warn','scroll.write','anchor did not stabilize');
    return result;
  } finally {
    await observer?.disconnect();
    for(const [name,id] of registered)await screen.removeEventListener(name,id);
  }
}
async function omniWithScrollWrite(work,options={}) {
  if(!nxScrollHoldOn() || t.uiOpen)return work();
  return omniScrollQueue(async()=>{
    const anchor=await omniReadSlotAnchor(options.slot) || await omniReadAnchor();
    return anchor?omniHoldAnchor(anchor,work,options):work();
  });
}
// Risu draws a streaming reply in a light form and, once the reply ends, takes that
// bubble out and draws a new one, which throws the view to the start of the message.
// It tells plugins the reply ended only after that. So while a reply streams, the
// place the reader is at is marked — the bottom when they follow the newest line,
// else the paragraph at the top — when the stream starts and whenever the reader's
// own scrolling stops, never per chunk and never for a scroll Risu made. When the
// reply ends, the view goes back there.
let omniStreamScroll=null;
const OMNI_STREAM_SCROLL_IDLE_MS=300, OMNI_STREAM_SCROLL_STALE_MS=15000;
function omniStreamScrollOn() {return t.backendSettings?.card?.stream_scroll_hold===!0;}
async function omniStreamMark(run) {
  const mark=(async()=>{
    const scope=await omniScrollContext(),lowest=await omniLowestBubble(run.screen);
    if(!lowest)return null;
    const sr=await run.screen.getBoundingClientRect();
    if(lowest.rect.bottom<=sr.bottom+8)return {scope,bottom:true};
    return omniReadAnchor();
  })();
  run.marking=mark;
  const anchor=await mark.catch(()=>null);
  if(run.marking===mark){run.mark=anchor;run.marking=null;}
}
async function omniStreamScrollStop(run) {
  run.closed=true;clearTimeout(run.timer);run.timer=0;
  if(omniStreamScroll===run)omniStreamScroll=null;
  for(const [name,id] of run.listeners.splice(0))try{await run.screen.removeEventListener(name,id);}catch{}
  const observer=run.observer;run.observer=null;
  if(observer)try{await observer.disconnect();}catch{}
}
function omniStreamScrollTrack() {
  let run=omniStreamScroll;
  if(run && Date.now()-run.chunkAt>OMNI_STREAM_SCROLL_STALE_MS){void omniStreamScrollStop(run);run=null;}
  if(!omniStreamScrollOn() || t.uiOpen)return run?.ready;
  if(!run){omniStreamScroll={chunkAt:Date.now(),mark:null,marking:null,timer:0,listeners:[],observer:null,screen:null,closed:false,ready:null};return;}
  run.chunkAt=Date.now();
  // A reply that is not streamed reaches the output script once; only a second
  // chunk means Risu is drawing it light and will draw it again.
  if(run.ready)return run.ready;
  return run.ready=(async()=>{
    const doc=t.hostDoc || await ue(),screen=doc && await doc.querySelector('.default-chat-screen');
    if(!screen || run.closed)return;
    run.screen=screen;
    const reader=omniReaderScrolls();
    const moved=()=>{
      if(!reader.scroll())return;
      clearTimeout(run.timer);run.timer=setTimeout(()=>{run.timer=0;if(!run.closed)void omniStreamMark(run);},OMNI_STREAM_SCROLL_IDLE_MS);
    };
    for(const [name,fn] of [...reader.listeners,['scroll',moved]]) {
      await omniListen(screen,name,fn,run.listeners);
      if(run.closed){await omniStreamScrollStop(run);return;}
    }
    try {
      run.observer=await k.createMutationObserver(()=>reader.changed());
      await run.observer.observe(screen,{childList:true,subtree:true});
    } catch(error) {y('warn','scroll.observe',String(error));}
    if(run.closed){await omniStreamScrollStop(run);return;}
    await omniStreamMark(run);
  })().catch(error=>y('warn','scroll.stream',String(error)));
}
function omniStreamScrollEnd() {
  const run=omniStreamScroll;if(!run)return Promise.resolve();
  if(!run.ready)return omniStreamScrollStop(run);
  // Still scrolling as it ended: the reader is placing the view themselves.
  const moving=!!run.timer;
  return omniScrollQueue(async()=>{
    await run.ready;await run.marking;
    await omniStreamScrollStop(run);
    if(moving || !run.mark || !omniStreamScrollOn() || t.uiOpen)return;
    await omniHoldAnchor(run.mark,async()=>{},{requireMutation:true});
  }).catch(error=>y('warn','scroll.stream',String(error)));
}
