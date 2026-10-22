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
function omniReaderScrolls(note=()=>{}) {
  let pressedAt=0,inputAt=-Infinity,glideAt=-Infinity,changedAt=-Infinity;
  // A host that never forwards the release must not make every later scroll the reader's.
  const pressed=()=>pressedAt>0 && performance.now()-pressedAt<8000;
  return {
    pressed,
    // For the scroll trace: how long ago the finger went down, if it still counts as down.
    pressedFor:()=>pressed()?((performance.now()-pressedAt)/1000).toFixed(1)+'s':'',
    // From a mutation observer on the chat: a scroll right after it is the chat's own.
    changed:()=>{changedAt=performance.now();},
    // A lifted finger is not input: only the glide that runs on from it, frame by frame.
    // keydown reaches plugins up to 99 ms late, so its window allows for that.
    listeners:[['pointerdown',()=>{pressedAt=performance.now();note('손가락 닿음');}],['pointerup',()=>{if(pressed())glideAt=performance.now();pressedAt=0;note('손가락 뗌');}],
      ['pointercancel',()=>{if(pressed())glideAt=performance.now();pressedAt=0;note('손가락 취소(스크롤로 넘어감)');}],['keydown',e=>{if(OMNI_SCROLL_KEYS.includes(e?.key))inputAt=performance.now();}]],
    // From a scroll listener: whether the reader made this scroll.
    scroll:()=>{
      const now=performance.now(),mine=pressed() || now-inputAt<400 || now-glideAt<150 || now-changedAt>80;
      if(mine)glideAt=now;
      return mine;
    },
    // Only a hand or a key makes it the reader's: no guessing a wheel from a quiet chat.
    byHand:()=>{
      const now=performance.now(),mine=pressed() || now-inputAt<400 || now-glideAt<150;
      if(mine)glideAt=now;
      return mine;
    },
  };
}
// A listener Risu refuses must never stop the work it was meant to watch.
// PocketRisu adds every plugin listener to the document, not to the element, and a
// scroll does not bubble: only a capturing listener hears the chat scroll there
// (as the TTS scan does). It removes one only with the same capture flag, so the
// options are kept beside the id.
const OMNI_SCROLL_LISTEN={capture:true,passive:true};
// Keys go to the focused element (the input box, say), not to the chat: upstream Risu
// (#1610) binds a listener to the element it was added to, so keydown is heard on the
// document. The listener is removed through the same wrapper that added it.
async function omniListen(target,name,fn,into) {
  const options=name==='scroll'?OMNI_SCROLL_LISTEN:undefined;
  const doc=name==='keydown'?(t.hostDoc || await ue()):null;
  const on=typeof doc?.addEventListener==='function'?doc:target;
  try {into.push([name,await on.addEventListener(name,fn,options),options,on]);}
  catch(error) {y('warn','scroll.listen',name+': '+String(error));}
}
// Run the work, then keep the anchor where it was for up to two seconds, until the
// layout settles or the reader moves.
async function omniHoldAnchor(anchor,work,options={}) {
  const epoch=++omniScrollEpoch;
  const doc=t.hostDoc || await ue(),screen=doc && await doc.querySelector('.default-chat-screen');
  if(!screen)return work();
  let userMoved=false,own=false,ownAt=-Infinity,dirty=0,observer=null;
  const registered=[],reader=options.reader || omniReaderScrolls();
  let movedBy='',fixes=0,everFound=false;
  const input=(why='')=>{if(!userMoved)movedBy=why;userMoved=true;};
  // The scroll our own correction causes arrives a frame after it returns.
  // At a reply's end Risu has already redrawn it: that jump's scroll can cross the
  // bridge late, after this starts listening and before any change is heard to blame
  // it on. There, only a hand on the screen (or a key) means the reader moved.
  const scroll=()=>{if(!own && performance.now()-ownAt>120 && (options.byHand ? reader.byHand() : reader.scroll()))input('스크롤');};
  const listeners=[...(options.reader?[]:reader.listeners),['pointermove',()=>{if(reader.pressed())input('손가락 끌기');}],
    ['keydown',e=>{if(OMNI_SCROLL_KEYS.includes(e?.key))input('키');}],['scroll',scroll]];
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
        everFound=true;
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
          stable=0;fixes++;
        } else if(lastDirty===dirty && Math.abs(lastHeight-found.rect.height)<1)stable++;else stable=0;
        lastDirty=dirty;lastHeight=found.rect.height;
        if(stable>=3 && (!options.requireMutation || dirty>0)){settled=true;break;}
      }
      await new Promise(resolve=>setTimeout(resolve,32));
    }
    if(!settled&&!userMoved&&anchor.scope===await omniScrollContext())y('warn','scroll.write','anchor did not stabilize');
    options.report?.(userMoved?'포기: 읽는 사람이 움직임('+movedBy+') · 맞춤 '+fixes+'번'
      : !everFound?'포기: 그 문단을 못 찾음'
      : (settled?'자리 맞춤 ':'2초 안에 안 멈춤 · ')+fixes+'번 옮김');
    return result;
  } finally {
    await observer?.disconnect();
    for(const [name,id,options,on] of registered)await (on||screen).removeEventListener(name,id,options);
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
// else the paragraph across the middle of the screen and where it stood — when the
// stream starts and after the view moves, at most every half second. Whoever moved
// it: a finger, a wheel, Risu's own jump to a new reply. Never per chunk.
// Each mark notes how many chunks had come. Risu draws the reply anew only after
// its last chunk, so when the reply ends the view goes back to the newest mark
// taken before that chunk: whatever came after may be the jump. (Telling the jump
// by the bubble's x-hashed failed: it also changes mid-stream, a picture going in.)
let omniStreamScroll=null;
// What the streaming scroll hold saw and decided, newest first, for 디버그 > 스크롤.
// A phone cannot be watched from here: this is how its runs are read. Plain text in
// memory, at most 150 lines; it is painted only while that pane is in the page.
const omniScrollTraceLines=[];let omniScrollTraceRuns=0;
function omniScrollTrace(run,text) {
  const at=run?.startedAt!=null?' '+((performance.now()-run.startedAt)/1000).toFixed(1)+'s':'';
  omniScrollTraceLines.push(new Date().toTimeString().slice(0,8)+' #'+(run?.no ?? '-')+at+' '+text);
  if(omniScrollTraceLines.length>150)omniScrollTraceLines.splice(0,omniScrollTraceLines.length-150);
  omniPaintScrollTrace();
}
function omniPaintScrollTrace() {
  try {
    const el=typeof document!=='undefined' && document.getElementById?.('nx-debug-scroll');
    if(el)el.textContent=omniScrollTraceLines.slice().reverse().join('\n') || '(아직 기록 없음 · 스트리밍 중에 위로 올려 읽어 보세요)';
  } catch {}
}
globalThis.__OMNI_SCROLL_TRACE__={lines:()=>omniScrollTraceLines.slice(),paint:omniPaintScrollTrace,clear:()=>{omniScrollTraceLines.length=0;omniPaintScrollTrace();}};
const omniPlaceText=place=>!place?'없음':place.bottom?'맨 아래(따라보기)':'메시지'+place.index+' 문단'+place.paragraph+' 위에서 '+Math.round(place.offset)+'px';
const OMNI_STREAM_MARK_MS=500, OMNI_STREAM_SCROLL_STALE_MS=15000, OMNI_STREAM_MARKS=12;
function omniStreamScrollOn() {return t.backendSettings?.card?.stream_scroll_hold===!0;}
// The node across height y, by halving: nodes are stacked, either way up. Looked up
// by position only; the nearest one when y falls in a gap.
async function omniNodeAt(nodes,y) {
  if(!nodes.length)return null;
  let best=null;
  const at=async i=>{
    const rect=await nodes[i].getBoundingClientRect();
    const d=y<rect.top?rect.top-y:y>=rect.bottom?y-rect.bottom:0;
    if(rect.height>0 && (!best || d<best.d))best={i,node:nodes[i],rect,d};
    return rect;
  };
  let lo=0,hi=nodes.length-1;
  const first=await at(lo),last=hi?await at(hi):first;
  const downward=first.top<=last.top;
  while(lo<=hi && best?.d!==0) {
    const mid=(lo+hi)>>1,rect=await at(mid);
    if(rect.top<=y && y<rect.bottom)break;
    if((rect.bottom<=y)===downward)lo=mid+1;else hi=mid-1;
  }
  return best;
}
async function omniStreamPlace(run) {
  const screen=run.screen,sr=await screen.getBoundingClientRect();
  const bubbles=await nxUnwrapSafeNodes(await screen.querySelectorAll('.risu-chat'));
  if(!bubbles.length)return null;
  // Following the newest line: the newest bubble ends on screen. It is at one end.
  let lowest=null;
  for(const node of new Set([bubbles[0],bubbles[bubbles.length-1]])) {
    const rect=await node.getBoundingClientRect();
    if(rect.height>0 && (!lowest || rect.bottom>lowest.bottom))lowest=rect;
  }
  if(lowest && lowest.bottom<=sr.bottom+8)return {scope:run.scope,bottom:true};
  const y=(sr.top+sr.bottom)/2;
  // Half a second later the reader is mostly in the same bubble: try it first.
  let bubble=null;
  if(run.lastBubble) {
    const rect=await run.lastBubble.getBoundingClientRect();
    if(rect.height>0 && rect.top<=y && y<rect.bottom)bubble={node:run.lastBubble,rect};
  }
  bubble=bubble || await omniNodeAt(bubbles,y);
  if(!bubble)return null;
  run.lastBubble=bubble.node;
  const index=Number(/data-chat-index="(\d+)"/.exec(await omniOpeningTag(bubble.node))?.[1] ?? -1);
  const body=index>=0 && await bubble.node.querySelector('.chattext');
  if(!body)return null;
  const paragraphs=await nxUnwrapSafeNodes(await body.querySelectorAll('p'));
  const hit=await omniNodeAt(paragraphs,y);
  // The nearest paragraph can lie far off screen (a message of pictures with one line
  // at its top): restoring it put the reader 17,000px away. Off screen, the message's
  // own start is the place instead.
  if(hit && hit.rect.bottom>sr.top && hit.rect.top<sr.bottom) {
    const text=String(await hit.node.textContent() || '').trim();
    if(text)return {scope:run.scope,index,paragraph:hit.i,text,offset:hit.rect.top-sr.top};
  }
  const rect=await body.getBoundingClientRect();
  return rect.height>0 ? {scope:run.scope,index,paragraph:-1,text:'',offset:rect.top-sr.top} : null;
}
async function omniStreamMark(run) {
  const mark=(async()=>{
    // Reading the screen takes seconds on a phone. The chunk count is taken when it
    // ends: one taken at the start labelled a view measured after the end's redraw as
    // from before it, and the end sent the reader there.
    const swaps=run.swaps,place=await omniStreamPlace(run),chunk=run.chunks;
    if(!place)return;
    if(run.swaps!==swaps){omniScrollTrace(run,'표시 버림: 재는 동안 메시지 갈아끼움');return;}
    run.marks.push({chunk,place});
    omniScrollTrace(run,'표시 (조각'+chunk+'): '+omniPlaceText(place));
    if(run.marks.length>OMNI_STREAM_MARKS)run.marks.shift();
  })();
  run.marking=mark;
  await mark.catch(error=>y('warn','scroll.stream.mark',String(error)));
  if(run.marking===mark)run.marking=null;
}
// At most one mark per half second while the view moves, and one after it stops.
function omniStreamMoved(run) {
  if(run.closed)return;
  run.dirty=true;
  if(run.timer)return;
  // The timer stays set until the mark is read: on a slow phone a new one started every
  // half second piled up (eight at once) and jammed the bridge for everything else.
  run.timer=setTimeout(async()=>{
    if(run.closed || !run.dirty){run.timer=0;return;}
    run.dirty=false;run.markedAt=performance.now();
    await omniStreamMark(run);
    run.timer=0;
    if(run.dirty)omniStreamMoved(run);
  },Math.max(60,OMNI_STREAM_MARK_MS-(performance.now()-run.markedAt)));
}
// The mark the reader's place is taken from: the newest from before the last chunk
// (whatever came after may be a redraw's jump); with none, the one the stream began with.
function omniStreamPick(run) {return run.marks.filter(row=>row.chunk<run.chunks).at(-1) || run.marks[0];}
const omniStreamRelease=value=>typeof omniRelease==='function'?omniRelease(value):undefined;
// Risu redraws the reply by swapping its wrapper in the message list: at the end, and
// when a picture goes in. Heard here, the place comes back at once, not when the end
// is announced (on a phone that is seconds later, the view sitting at the bottom).
// Only the list's own children are watched: one call per swap, none per chunk.
async function omniStreamWatchList(run) {
  if(typeof k?.createMutationObserver!=='function')return;
  try {
    const bubble=await run.screen.querySelector('[x-hashed] > .risu-chat');
    if(!bubble){omniScrollTrace(run,'목록 감시 못 함: 메시지 포장지 없음');return;}
    const wrapper=await bubble.getParent?.(),list=wrapper && await wrapper.getParent?.();
    await omniStreamRelease(bubble);await omniStreamRelease(wrapper);
    if(!list || run.closed){await omniStreamRelease(list);return;}
    const observer=await k.createMutationObserver(records=>{void omniStreamRelease(records);omniStreamRedrawn(run);});
    run.watch={observer,list};
    await observer.observe(list,{childList:true});
    omniScrollTrace(run,'목록 감시 켜짐');
    if(run.closed)await omniStreamUnwatch(run);
  } catch(error) {y('warn','scroll.stream.watch',String(error));}
}
async function omniStreamUnwatch(run) {
  const watch=run.watch;run.watch=null;
  if(!watch)return;
  try {await watch.observer.disconnect();} catch {}
  await omniStreamRelease(watch.observer);await omniStreamRelease(watch.list);
}
function omniStreamRedrawn(run) {
  if(run.closed)return;
  run.swaps=(run.swaps || 0)+1;run.swapRestored=false;run.userPlaced=false;
  if(run.reader?.pressed()){omniStreamAwaitHand(run,'갈아끼움 감지');return;}
  // One restore for a swap's out-and-in.
  clearTimeout(run.redrawTimer);
  run.redrawTimer=setTimeout(()=>{void omniScrollQueue(async()=>{
    if(run.closed)return;
    if(run.reader?.pressed()){omniStreamAwaitHand(run,'갈아끼움');return;}
    if(!omniStreamScrollOn() || t.uiOpen){omniScrollTrace(run,'갈아끼움 → 건너뜀: 설정 꺼짐 또는 설정창 열림');return;}
    await run.marking;
    const mark=omniStreamPick(run);
    // Following the newest line: Risu leaves the view at the bottom itself.
    if(!mark){omniScrollTrace(run,'갈아끼움 → 건너뜀: 표시 없음');return;}
    if(mark.place.bottom){omniScrollTrace(run,'갈아끼움 → 그대로: 맨 아래를 따라보던 중');return;}
    omniScrollTrace(run,'갈아끼움 → 복원 시도: '+omniPlaceText(mark.place)+' (조각'+mark.chunk+'/'+run.chunks+')');
    await omniHoldAnchor(mark.place,async()=>{},{byHand:true,reader:run.reader,report:text=>{
      omniScrollTrace(run,'갈아끼움 복원 결과: '+text);
      if(text.startsWith('포기: 읽는 사람'))run.userPlaced=true;else if(!text.startsWith('포기'))run.swapRestored=true;
    }});
  }).catch(error=>y('warn','scroll.stream',String(error)));},40);
}
// A swap that came with a finger down: once the hand is off and the view has been
// still for half a second, the place comes back only if the view is still where the
// swap threw it. If the hand took it elsewhere, that is where the reader wants it.
function omniStreamAwaitHand(run,what) {
  omniScrollTrace(run,what+' → 손가락 닿아 있음('+run.reader.pressedFor()+' 전부터): 뗄 때까지 기다림');
  run.handWait={top:null};
  const wait=run.handWait;
  void Promise.resolve(run.screen?.getProperty?.('scrollTop')).then(top=>{if(run.handWait===wait)wait.top=Number(top);}).catch(()=>{});
}
function omniStreamHandSettled(run) {
  const wait=run.handWait;
  if(!wait || run.closed || run.reader?.pressed())return;
  clearTimeout(run.handTimer);
  run.handTimer=setTimeout(async()=>{
    if(run.handWait!==wait || run.closed || run.reader?.pressed())return;
    run.handWait=null;
    let top=NaN;
    try {top=Number(await run.screen?.getProperty?.('scrollTop'));} catch {}
    if(Number.isFinite(top) && Number.isFinite(wait.top) && Math.abs(top-wait.top)>60) {
      omniScrollTrace(run,'손가락 뗌 → 그대로: 손가락으로 '+Math.round(Math.abs(top-wait.top))+'px 옮김');
      run.userPlaced=true;wait.done?.();return;
    }
    // At the end the end's own restore follows; mid-stream the swap's restore runs now.
    if(run.ending){omniScrollTrace(run,'손가락 뗌 → 튄 자리 그대로: 끝 복원으로 넘김');wait.done?.();return;}
    omniScrollTrace(run,'손가락 뗌 → 튄 자리 그대로라 복원');
    wait.done?.();
    omniStreamRedrawn(run);
  },500);
}
async function omniStreamScrollStop(run) {
  run.closed=true;clearTimeout(run.timer);run.timer=0;clearTimeout(run.redrawTimer);clearTimeout(run.handTimer);run.handWait=null;
  void omniStreamUnwatch(run);
  if(omniStreamScroll===run)omniStreamScroll=null;
  for(const [name,id,options,on] of run.listeners.splice(0))try{await (on||run.screen).removeEventListener(name,id,options);}catch{}
}
function omniStreamScrollTrack() {
  let run=omniStreamScroll;
  if(run && Date.now()-run.chunkAt>OMNI_STREAM_SCROLL_STALE_MS){omniScrollTrace(run,'15초 동안 조각 없음 → 이 추적 끝');void omniStreamScrollStop(run);run=null;}
  if(!omniStreamScrollOn() || t.uiOpen)return run?.ready;
  if(!run) {
    omniStreamScroll={chunkAt:Date.now(),chunks:1,marks:[],marking:null,timer:0,dirty:false,markedAt:-Infinity,listeners:[],
      screen:null,scope:'',lastBubble:null,reader:null,closed:false,ready:null,watch:null,redrawTimer:0,swaps:0,handWait:null,handTimer:0,ending:false,swapRestored:false,userPlaced:false,no:++omniScrollTraceRuns,startedAt:performance.now()};
    omniScrollTrace(omniStreamScroll,'답변 조각 도착 (추적 준비)');
    return;
  }
  run.chunkAt=Date.now();run.chunks++;
  // A reply that is not streamed reaches the output script once; only a second
  // chunk means Risu is drawing it light and will draw it again.
  if(run.ready)return run.ready;
  return run.ready=(async()=>{
    const doc=t.hostDoc || await ue(),screen=doc && await doc.querySelector('.default-chat-screen');
    if(!screen || run.closed)return;
    run.screen=screen;run.scope=await omniScrollContext();
    // Pointer events only tell whether a finger is still on the screen at the end.
    run.reader=omniReaderScrolls(text=>{omniScrollTrace(run,text);if(!run.reader.pressed())omniStreamHandSettled(run);});
    for(const [name,fn] of [...run.reader.listeners,['scroll',()=>{omniStreamMoved(run);if(run.handWait)omniStreamHandSettled(run);}]]) {
      await omniListen(screen,name,fn,run.listeners);
      if(run.closed){await omniStreamScrollStop(run);return;}
    }
    omniScrollTrace(run,'추적 시작 (조각'+run.chunks+')');
    run.markedAt=performance.now();
    await omniStreamMark(run);
    await omniStreamWatchList(run);
  })().catch(error=>y('warn','scroll.stream',String(error)));
}
function omniStreamScrollEnd() {
  const run=omniStreamScroll;if(!run)return Promise.resolve();
  if(!run.ready){omniScrollTrace(run,'끝 알림: 조각이 하나뿐(스트리밍 아님) → 아무것도 안 함');return omniStreamScrollStop(run);}
  // A finger still on the screen as it ended: the reader is placing the view.
  const touching=!!run.reader?.pressed(),pressedFor=run.reader?.pressedFor?.() || '';
  run.ending=true;
  return omniScrollQueue(async()=>{
    await run.ready;await run.marking;
    // A swap came with a finger down and the hand has not settled: its verdict first,
    // while the listeners still hear the hand. Five seconds at most.
    if(run.handWait) {
      omniScrollTrace(run,'끝 알림: 손가락 판단 기다림');
      const wait=run.handWait;
      await new Promise(resolve=>{wait.done=resolve;setTimeout(resolve,5000);});
    }
    await omniStreamScrollStop(run);
    if(run.userPlaced){omniScrollTrace(run,'끝 알림 → 건너뜀: 갈아끼운 뒤 손가락으로 옮김');return;}
    if(run.swapRestored){omniScrollTrace(run,'끝 알림 → 건너뜀: 갈아끼울 때 이미 복원함');return;}
    // The newest mark from before the last chunk; with none, the first, taken as the stream began.
    const mark=omniStreamPick(run);
    const head='끝 알림 (조각'+run.chunks+', 표시 '+run.marks.length+'개)';
    if(touching){omniScrollTrace(run,head+' → 건너뜀: 손가락 닿아 있음('+pressedFor+' 전부터)');return;}
    if(!mark){omniScrollTrace(run,head+' → 건너뜀: 표시 없음');return;}
    if(!omniStreamScrollOn() || t.uiOpen){omniScrollTrace(run,head+' → 건너뜀: 설정 꺼짐 또는 설정창 열림');return;}
    omniScrollTrace(run,head+' → 복원 시도: '+omniPlaceText(mark.place)+' (조각'+mark.chunk+')');
    await omniHoldAnchor(mark.place,async()=>{},{requireMutation:true,byHand:true,report:text=>omniScrollTrace(run,'끝 복원 결과: '+text)});
  }).catch(error=>y('warn','scroll.stream',String(error)));
}
