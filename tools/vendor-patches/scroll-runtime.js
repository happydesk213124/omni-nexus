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
  let pressedAt=0,inputAt=-Infinity,glideAt=-Infinity,changedAt=-Infinity,handAt=-Infinity;
  // A host that never forwards the release must not make every later scroll the reader's.
  const pressed=()=>pressedAt>0 && performance.now()-pressedAt<8000;
  return {
    pressed,
    // For the scroll trace: how long ago the finger went down, if it still counts as down.
    pressedFor:()=>pressed()?((performance.now()-pressedAt)/1000).toFixed(1)+'s':'',
    // A finger went down, up or into a drag this recently: still placing the view.
    handWithin:ms=>performance.now()-handAt<ms,
    // From a mutation observer on the chat: a scroll right after it is the chat's own.
    changed:()=>{changedAt=performance.now();},
    // A lifted finger is not input: only the glide that runs on from it, frame by frame.
    // keydown reaches plugins up to 99 ms late, so its window allows for that.
    listeners:[['pointerdown',()=>{pressedAt=handAt=performance.now();note('손가락 닿음');}],['pointerup',()=>{if(pressed())glideAt=performance.now();handAt=performance.now();pressedAt=0;note('손가락 뗌');}],
      ['pointercancel',()=>{if(pressed())glideAt=performance.now();handAt=performance.now();pressedAt=0;note('손가락 취소(스크롤로 넘어감)');}],['keydown',e=>{if(OMNI_SCROLL_KEYS.includes(e?.key))inputAt=performance.now();}]],
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
// bubble out and draws a new one, which throws the view. It tells plugins the reply
// ended only seconds later. A phone's trace showed reading the screen paragraph by
// paragraph cost seconds per mark there, so the reader's place is one number: where
// the reply's top edge stands on the screen (or "the bottom" while they follow the
// newest line). One host call per mark, at most every 0.2 s, one at a time; never per
// chunk unless the view moved. Each mark notes how many chunks had come when it was
// read: the redraw comes after the last chunk, so the place is the newest mark from
// before it. The list of messages is watched: when Risu swaps the reply's wrapper the
// place comes back at once, and the end only follows up.
let omniStreamScroll=null;
const OMNI_STREAM_MARK_MS=200, OMNI_STREAM_SCROLL_STALE_MS=15000, OMNI_STREAM_MARKS=24;
// A finger moved within this long is still placing the view (a drag after the cancel
// sends no pointer events, then a fling runs on).
const OMNI_STREAM_HAND_MS=800;
function omniStreamScrollOn() {return t.backendSettings?.card?.stream_scroll_hold===!0;}
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
const omniPlaceText=place=>!place?'없음':place.bottom?'맨 아래(따라보기)':'답변 윗변 '+Math.round(place.top)+'px';
const omniStreamRelease=value=>typeof omniRelease==='function'?omniRelease(value):undefined;
const omniStreamWait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function omniStreamHandBusy(run) {return !!(run.reader?.pressed() || run.reader?.handWithin(OMNI_STREAM_HAND_MS));}
// People read while slowly scrolling: the hand rarely stops, so waiting for it meant
// never restoring. Risu's redraw throws the view far (to the newest line); a reading
// hand moves it a little at a time. So with a hand on the move only a jump of half the
// screen or more is Risu's and is undone; a smaller difference is the reader's own.
function omniStreamJumped(run,off) {return !omniStreamHandBusy(run) || Math.abs(off)>=(run.screenRect?.height || 0)*0.5;}
// The reply: the newest message, the first .risu-chat in the list (Risu prepends).
// The handle is measured; once Risu swaps the bubble it measures zero and is found anew.
async function omniStreamReply(run,fresh=false) {
  if(!fresh && run.reply) {
    const rect=await run.reply.getBoundingClientRect();
    if(rect?.height>0)return {node:run.reply,rect};
  }
  await omniStreamRelease(run.reply);run.reply=null;
  const node=await run.screen.querySelector('.risu-chat');
  if(!node)return null;
  run.reply=node;
  const rect=await node.getBoundingClientRect();
  return rect?.height>0 ? {node,rect} : null;
}
async function omniStreamPlace(run) {
  run.screenRect ||= await run.screen.getBoundingClientRect();
  const sr=run.screenRect,reply=await omniStreamReply(run);
  if(!reply)return null;
  if(reply.rect.bottom<=sr.bottom+8)return {bottom:true};
  return {top:reply.rect.top-sr.top,height:reply.rect.height};
}
async function omniStreamMark(run) {
  const mark=(async()=>{
    // The chunk count is taken when the reading ends: one taken at its start once
    // labelled a view measured after the end's redraw as from before it.
    const swaps=run.swaps,place=await omniStreamPlace(run),chunk=run.chunks;
    if(!place)return;
    if(run.swaps!==swaps){omniScrollTrace(run,'표시 버림: 재는 동안 메시지 갈아끼움');return;}
    // After the end the place is the one put back; only the reader's hand moves it on.
    if(run.after) {
      if(omniStreamHandBusy(run) && (!run.placed || omniPlaceText(run.placed)!==omniPlaceText(place))){run.placed=place;omniScrollTrace(run,'끝난 뒤 손가락으로 옮김: '+omniPlaceText(place));}
      return;
    }
    const last=run.marks.at(-1)?.place;
    run.marks.push({chunk,place});
    if(run.marks.length>OMNI_STREAM_MARKS)run.marks.shift();
    // The trace keeps changes only: the same place at every chunk would fill it.
    if(!last || !!last.bottom!==!!place.bottom || Math.abs((last.top || 0)-(place.top || 0))>40)
      omniScrollTrace(run,'표시 (조각'+chunk+'): '+omniPlaceText(place));
  })();
  run.marking=mark;
  await mark.catch(error=>y('warn','scroll.stream.mark',String(error)));
  if(run.marking===mark)run.marking=null;
}
// One mark at a time, at most every 0.2 s while the view moves, and one after it stops.
// The timer stays set until the mark is read: on a slow phone new ones piled up.
function omniStreamMoved(run) {
  if(run.closed)return;
  run.dirty=true;
  if(run.timer)return;
  run.timer=setTimeout(async()=>{
    if(run.closed || !run.dirty){run.timer=0;return;}
    run.dirty=false;run.markedAt=performance.now();
    await omniStreamMark(run);
    run.timer=0;
    if(run.dirty)omniStreamMoved(run);
  },Math.max(40,OMNI_STREAM_MARK_MS-(performance.now()-run.markedAt)));
}
// The mark the reader's place is taken from: the newest from before the last chunk
// (whatever came after may be a redraw's jump); with none, the one the stream began with.
function omniStreamPick(run) {return run.marks.filter(row=>row.chunk<run.chunks).at(-1) || run.marks[0];}
// Puts the reply's top edge back where the mark has it, then keeps an eye on it for
// watchMs (one measure each 0.15 s): Risu may redraw the reply just after. Three moves
// at most (a phone once spent two seconds moving 31 times).
async function omniStreamPut(run,place,watchMs=0) {
  run.screenRect ||= await run.screen.getBoundingClientRect();
  const sr=run.screenRect,until=performance.now()+watchMs,swaps=run.swaps;
  let off=0,moves=0,fresh=true,filledBy=performance.now()+3000;
  for(;;) {
    let reply=await omniStreamReply(run,fresh);fresh=false;
    // Redrawn, the reply is empty a moment before its text comes back: placing it
    // then is placing nothing. Wait until it is mostly filled again (3 s at most).
    while((!reply || (place.height && reply.rect.height<place.height*0.6)) && performance.now()<filledBy) {
      await omniStreamWait(120);
      reply=await omniStreamReply(run,!reply);
    }
    if(!reply)return '포기: 답변 메시지를 못 찾음';
    off=place.bottom?Math.max(0,reply.rect.bottom-sr.bottom-8):reply.rect.top-sr.top-place.top;
    if(Math.abs(off)<=4) {
      if(performance.now()>=until)return place.bottom?(moves?'맨 아래로 맞춤':'맨 아래 그대로'):(moves?'맞춤 ('+moves+'번 옮김)':'이미 제자리');
      await omniStreamWait(150);continue;
    }
    if(!omniStreamJumped(run,off))return '그대로: 손가락이 옮기는 중 ('+Math.round(off)+'px'+(moves?', '+moves+'번 옮긴 뒤':'')+')';
    if(moves>=3)return '3번 옮겨도 '+Math.round(off)+'px 어긋남';
    omniScrollTrace(run,'  '+(moves+1)+'번째 옮김: '+Math.round(off)+'px 어긋남 · 답변 높이 '+Math.round(reply.rect.height)+'px'+(run.swaps!==swaps?' · 그새 갈아끼움':''));
    const node=reply.node;
    if(place.bottom)await node.scrollIntoView({behavior:'instant',block:'end',inline:'nearest'});
    else {
      const original=await node.getStyleAttribute();
      try {
        await node.setStyle('scrollMarginTop',place.top+'px');
        await node.scrollIntoView({behavior:'instant',block:'start',inline:'nearest'});
      } finally {await node.setStyleAttribute(original || '');}
    }
    moves++;
    // Pictures in the redrawn reply may still be settling: look again a little later.
    await omniStreamWait(moves===1?150:350);
  }
}
// Risu swaps the reply's wrapper in the message list when it redraws it: at the end,
// and when a picture goes in. Only the list's own children are watched: one call per
// swap, none per chunk.
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
  run.swaps++;run.swapRestored=false;
  // One restore for a swap's out-and-in.
  clearTimeout(run.redrawTimer);
  run.redrawTimer=setTimeout(()=>{void omniScrollQueue(()=>omniStreamAfterSwap(run)).catch(error=>y('warn','scroll.stream',String(error)));},40);
}
async function omniStreamAfterSwap(run) {
  if(run.closed)return;
  if(!omniStreamScrollOn() || t.uiOpen){omniScrollTrace(run,'갈아끼움 → 건너뜀: 설정 꺼짐 또는 설정창 열림');return;}
  await run.marking;
  const hand=omniStreamHandBusy(run)?' · 손가락 움직이는 중':'';
  if(run.after) {
    omniScrollTrace(run,'끝난 뒤 갈아끼움 → 복원 시도: '+omniPlaceText(run.placed)+hand);
    omniScrollTrace(run,'끝난 뒤 복원 결과: '+await omniStreamPut(run,run.placed,600));
    return;
  }
  const mark=omniStreamPick(run);
  if(!mark){omniScrollTrace(run,'갈아끼움 → 건너뜀: 표시 없음');return;}
  omniScrollTrace(run,'갈아끼움 → 복원 시도: '+omniPlaceText(mark.place)+' (조각'+mark.chunk+'/'+run.chunks+')'+hand);
  const result=await omniStreamPut(run,mark.place,600);
  omniScrollTrace(run,'갈아끼움 복원 결과: '+result);
  if(!result.startsWith('포기')){run.swapRestored=true;run.placed=mark.place;}
}
// After the end Risu may draw the reply again (a picture or a spinner written into it):
// the list stays watched this long, and each swap puts the place back again.
const OMNI_STREAM_AFTER_MS=6000;
let omniStreamAfterRun=null;
function omniStreamAfter(run) {
  if(!run.placed){void omniStreamScrollStop(run);return;}
  run.after=true;
  if(omniStreamScroll===run)omniStreamScroll=null;
  omniStreamAfterRun=run;
  run.afterTimer=setTimeout(()=>{omniScrollTrace(run,'끝난 뒤 지켜보기 끝');void omniStreamScrollStop(run);},OMNI_STREAM_AFTER_MS);
}
async function omniStreamScrollStop(run) {
  if(run.closed)return;
  run.closed=true;clearTimeout(run.timer);run.timer=0;clearTimeout(run.redrawTimer);clearTimeout(run.afterTimer);
  if(omniStreamScroll===run)omniStreamScroll=null;
  if(omniStreamAfterRun===run)omniStreamAfterRun=null;
  void omniStreamUnwatch(run);
  for(const [name,id,options,on] of run.listeners.splice(0))try{await (on||run.screen).removeEventListener(name,id,options);}catch{}
  await omniStreamRelease(run.reply);run.reply=null;
}
function omniStreamScrollTrack() {
  let run=omniStreamScroll;
  if(run && Date.now()-run.chunkAt>OMNI_STREAM_SCROLL_STALE_MS){omniScrollTrace(run,'15초 동안 조각 없음 → 이 추적 끝');void omniStreamScrollStop(run);run=null;}
  if(!omniStreamScrollOn() || t.uiOpen)return run?.ready;
  if(!run) {
    // A new reply: the last one's watch after its end would restore into this one.
    if(omniStreamAfterRun)void omniStreamScrollStop(omniStreamAfterRun);
    omniStreamScroll={chunkAt:Date.now(),chunks:1,marks:[],marking:null,timer:0,dirty:false,markedAt:-Infinity,listeners:[],
      screen:null,screenRect:null,reply:null,scope:'',reader:null,closed:false,ready:null,watch:null,redrawTimer:0,swaps:0,
      swapRestored:false,placed:null,after:false,afterTimer:0,no:++omniScrollTraceRuns,startedAt:performance.now()};
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
    run.reader=omniReaderScrolls(text=>omniScrollTrace(run,text));
    for(const [name,fn] of [...run.reader.listeners,['scroll',()=>omniStreamMoved(run)]]) {
      await omniListen(screen,name,fn,run.listeners);
      if(run.closed){await omniStreamScrollStop(run);return;}
    }
    omniScrollTrace(run,'추적 시작 (조각'+run.chunks+') · 끝난 뒤 '+OMNI_STREAM_AFTER_MS/1000+'초 더 지켜봄');
    run.markedAt=performance.now();
    await omniStreamMark(run);
    await omniStreamWatchList(run);
  })().catch(error=>y('warn','scroll.stream',String(error)));
}
function omniStreamScrollEnd() {
  const run=omniStreamScroll;if(!run)return Promise.resolve();
  if(!run.ready){omniScrollTrace(run,'끝 알림: 조각이 하나뿐(스트리밍 아님) → 아무것도 안 함');return omniStreamScrollStop(run);}
  return omniScrollQueue(async()=>{
    await run.ready;await run.marking;
    if(run.closed)return;
    const mark=omniStreamPick(run);
    // The put still hears the hand; the listeners stay on for the watch after the end.
    try {
      const head='끝 알림 (조각'+run.chunks+', 표시 '+run.marks.length+'개)';
      if(run.swapRestored){omniScrollTrace(run,head+' → 건너뜀: 갈아끼울 때 이미 복원함');return;}
      if(!mark){omniScrollTrace(run,head+' → 건너뜀: 표시 없음');return;}
      if(!omniStreamScrollOn() || t.uiOpen){omniScrollTrace(run,head+' → 건너뜀: 설정 꺼짐 또는 설정창 열림');run.placed=null;return;}
      omniScrollTrace(run,head+' → 복원 시도: '+omniPlaceText(mark.place)+' (조각'+mark.chunk+')'+(omniStreamHandBusy(run)?' · 손가락 움직이는 중':''));
      const result=await omniStreamPut(run,mark.place,1500);
      omniScrollTrace(run,'끝 복원 결과: '+result);
      run.placed=result.startsWith('포기')?null:mark.place;
    } finally {omniStreamAfter(run);}
  }).catch(error=>y('warn','scroll.stream',String(error)));
}
