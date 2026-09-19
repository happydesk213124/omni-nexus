// A hold exists only around a message write, never throughout a server request.
let omniScrollTail=Promise.resolve(), omniScrollEpoch=0;
async function omniScrollContext() {
  if(typeof k.getCurrentCharacterIndex==='function' && typeof k.getCurrentChatIndex==='function') {
    return JSON.stringify(await Promise.all([k.getCurrentCharacterIndex(),k.getCurrentChatIndex()]));
  }
  return nxScrollContext();
}
async function omniReadAnchor() {
  const doc=t.hostDoc || await ue();if(!doc)return null;
  const screen=await doc.querySelector('.default-chat-screen');if(!screen)return null;
  const sr=await screen.getBoundingClientRect(), scope=await omniScrollContext();
  const bubbles=await nxUnwrapSafeNodes(await screen.querySelectorAll('.risu-chat'));
  const visible=[];
  for(const bubble of bubbles) {
    const rect=await bubble.getBoundingClientRect();
    if(rect.height<=0||rect.bottom<=sr.top||rect.top>=sr.bottom)continue;
    const html=await bubble.getOuterHTML();
    const index=Number(/data-chat-index="(\d+)"/.exec(html)?.[1] ?? -1);
    if(index<0)continue;
    const body=await bubble.querySelector('.chattext');if(!body)continue;
    const paragraphs=await nxUnwrapSafeNodes(await body.querySelectorAll('p'));
    const texts=await Promise.all(paragraphs.map(async p=>String(await p.textContent() || '').trim()));
    for(let i=0;i<paragraphs.length;i++) {
      const node=paragraphs[i],r=await node.getBoundingClientRect();
      if(r.height<=0||r.bottom<=sr.top||r.top>=sr.bottom)continue;
      const text=texts[i];if(!text)continue;
      visible.push({scope,index,paragraph:i,text,occurrence:texts.slice(0,i).filter(v=>v===text).length,offset:r.top-sr.top,score:Math.abs(r.top-sr.top)});
    }
    if(!paragraphs.length) {
      const text=String(await body.textContent() || '').trim();
      const br=await body.getBoundingClientRect();
      if(text)visible.push({scope,index,paragraph:-1,text,offset:br.top-sr.top,score:Math.abs(br.top-sr.top)});
    }
  }
  return visible.sort((a,b)=>a.score-b.score)[0] || null;
}
async function omniLocateAnchor(anchor) {
  if(anchor.scope!==await omniScrollContext())return null;
  const doc=t.hostDoc || await ue(),screen=await doc.querySelector('.default-chat-screen');if(!screen)return null;
  const bubble=await screen.querySelector('.risu-chat[data-chat-index="'+anchor.index+'"]');
  const body=bubble && await bubble.querySelector('.chattext');if(!body)return null;
  const paragraphs=await nxUnwrapSafeNodes(await body.querySelectorAll('p'));
  let node=anchor.paragraph<0?body:paragraphs[anchor.paragraph];
  if(!node || String(await node.textContent() || '').trim()!==anchor.text) {
    node=null;
    let occurrence=0;
    for(const p of paragraphs)if(String(await p.textContent() || '').trim()===anchor.text){if(occurrence++===(anchor.occurrence || 0)){node=p;break;}}
  }
  if(!node)return null;
  const [rect,sr]=await Promise.all([node.getBoundingClientRect(),screen.getBoundingClientRect()]);
  if(!rect.height)return null;
  return {node,rect,sr,error:rect.top-sr.top-anchor.offset};
}
async function omniWithScrollWrite(work,options={}) {
  if(!nxScrollHoldOn() || t.uiOpen)return work();
  const run=async()=>{
    const epoch=++omniScrollEpoch,anchor=await omniReadAnchor();
    if(!anchor)return work();
    const doc=t.hostDoc || await ue(),screen=await doc.querySelector('.default-chat-screen');
    let userMoved=false,pointer=false,own=false,dirty=0,observer=null,lastMutation=performance.now();
    const registered=[];
    const input=()=>{userMoved=true;};
    const down=()=>{pointer=true;},up=()=>{pointer=false;};
    const scroll=()=>{if(!own && (pointer || performance.now()-lastMutation>80))userMoved=true;};
    const key=e=>{if(['ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' '].includes(e.key))input();};
    const listeners=[['pointerdown',down],['pointerup',up],['pointermove',()=>{if(pointer)input();}],['keydown',key],['scroll',scroll]];
    try {
      for(const [name,fn] of listeners)registered.push([name,await screen.addEventListener(name,fn)]);
      observer=await k.createMutationObserver(()=>{dirty++;lastMutation=performance.now();});
      await observer.observe(screen,{childList:true,subtree:true});
      const result=await work();
      let stable=0,settled=false,lastDirty=-1,lastHeight=-1;
      const end=performance.now()+2000;
      while(epoch===omniScrollEpoch&&!userMoved&&!t.unloading&&performance.now()<end) {
        if(anchor.scope!==await omniScrollContext())break;
        const found=await omniLocateAnchor(anchor);
        if(found) {
          if(Math.abs(found.error)>1.25) {
            const original=await found.node.getStyleAttribute();own=true;
            try {
              await found.node.setStyle('scrollMarginTop',anchor.offset+'px');
              if(!userMoved)await found.node.scrollIntoView({behavior:'instant',block:'start',inline:'nearest'});
            } finally {await found.node.setStyleAttribute(original || '');own=false;}
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
  };
  const pending=omniScrollTail.then(run,run);omniScrollTail=pending.catch(()=>{});return pending;
}
