// Runs inside the UI closure: SafeElement access only. The old fan owns no nodes.
const omniFooterTargets = new Map();
let omniFooterSerial = 0, omniFooterPainting = null, omniFooterObserver = null, omniFooterChanges=0;
let omniFooterDoc = null, omniFooterRoot = null, omniFooterQueued = false, omniFooterKeyListener=null;
const omniFooterCSS = `.x-omni-footer{position:relative;display:flex;align-items:center;justify-content:flex-start;flex-wrap:wrap;gap:4px;width:max-content;max-width:100%;min-height:40px;margin:.75rem auto .1rem 0;padding:4px;box-sizing:border-box;border:1px solid #344052;border-radius:12px;background:#161e2c;color:#eee;overflow-anchor:none}
.x-omni-footer[x-omni-edge="top"]{margin:.1rem auto .75rem 0}
.x-omni-footer button{display:inline-grid;place-items:center;width:38px;height:38px;flex:0 0 38px;padding:0;border:1px solid transparent;border-radius:12px;background:transparent;color:inherit;box-shadow:none;cursor:pointer;font:18px/1 system-ui}
.x-omni-footer button:hover,.x-omni-footer button:focus-visible{background:#7132f533;border-color:#7132f5;outline:none}.x-omni-footer button:active{background:#7132f566}.x-omni-footer button[x-omni-busy=true]{opacity:.5}
.x-omni-counts{display:flex;gap:6px;align-items:center;max-width:100%}.x-omni-counts input{width:52px;min-width:0;background:#101620;color:#eee;border:1px solid #344052;border-radius:8px;padding:6px}`;
function omniScheduleFooter() {
  if (omniFooterQueued || t.unloading) return;
  omniFooterQueued = true;
  queueMicrotask(() => { omniFooterQueued = false; void omniMountFooters().catch(e=>y('warn','footer.mount',String(e))); });
}
async function omniMountFooters() {
  if (omniFooterPainting) return omniFooterPainting;
  const version=omniFooterChanges;
  omniFooterPainting = (async()=>{
    const doc = t.hostDoc || await ue();
    if (!doc) return;
    t.hostDoc = doc;
    const root = await doc.querySelector('.default-chat-screen');
    if (!root) return;
    if (omniFooterDoc !== doc || !await root.querySelector('[x-omni-footer-root]')) {
      await omniFooterObserver?.disconnect();
      if(omniFooterKeyListener)await omniFooterRoot?.removeEventListener('keydown',omniFooterKeyListener);
      omniFooterDoc=doc;omniFooterRoot=root;
      for(const node of await nxUnwrapSafeNodes(await root.querySelectorAll('[x-inlay-msg-fan],[x-inlay-msg-actions],[x-inlay-msg-gen]')))await node.remove();
      const marker=await H(doc,'style',{text:omniFooterCSS});
      await marker.setAttribute('x-omni-footer-root','1');await root.appendChild(marker);
      omniFooterObserver=await k.createMutationObserver(()=>{
        omniFooterChanges++;omniScheduleFooter();
        if(nxSpinnerPreviews.size)void nxPaintSpinnerPreviews();
      });
      await omniFooterObserver.observe(root,{childList:true,subtree:true});
      t._fanMo=omniFooterObserver;t._fanMoDoc=doc;
      omniFooterKeyListener=await root.addEventListener('keydown',async event=>{
        if(event.key!=='Enter'&&event.key!==' ')return;
        const button=await root.querySelector('[x-omni-action]:focus');if(!button)return;
        await omniFooterAction(await button.getAttribute('x-omni-action'),Number(await button.getAttribute('x-omni-target')));
      });
    }
    if (!nxMsgFan()) {
      for(const node of await nxUnwrapSafeNodes(await root.querySelectorAll('[x-omni-footer]'))) await node.remove();
      for (const [key, target] of omniFooterTargets) if (!target._floatPin) omniFooterTargets.delete(key);
      return;
    }
    // No prose/rect reads for already mounted messages.
    const missing=await nxUnwrapSafeNodes(await root.querySelectorAll('.risu-chat:has(.chattext):not(:has([x-omni-edge="top"]):has([x-omni-edge="bottom"])):not(:has(textarea)):not(:has([contenteditable="true"]))'));
    if (!missing.length) return;
    const scope=await Z({useOverride:false});
    const messages=scope.chat?.message || scope.chat?.messages || [];
    // Streaming: the newest bubble is remounted per chunk — mounting its footer
    // each time flickers and re-arms actions. Defer it until the stream ends;
    // the observer re-runs on the final mutation, plus a one-shot retry below.
    // Chat-wide flag, so only the newest (last message) is skipped. Old Risu
    // without the flag mounts as before (safe default).
    let omniStreamActive=false;
    try {
      if (typeof Za === 'function') {
        const rs=await Za();
        const ch=rs?.chat;
        omniStreamActive=!!(ch && (ch.isStreaming===true || ch.is_streaming===true));
      }
    } catch {}
    const omniNewestIndex=messages.length-1;
    for(const bubble of missing) {
      if(t.unloading)break;
      const text=await bubble.querySelector('.chattext');if(!text)continue;
      const html=await bubble.getOuterHTML();
      const index=Number(/data-chat-index="(\d+)"/.exec(html)?.[1] ?? -1);
      const hostId=String(/data-chat-id="([^"]+)"/.exec(html)?.[1] || '');
      const row=messages[index];
      if(!Number.isInteger(index)||index<0||!row)continue;
      if(omniStreamActive && index===omniNewestIndex) {
        if(!t._omniFooterStreamRetry) {
          y('info','footer.streamSkip','newest deferred until stream end');
          t._omniFooterStreamRetry=setTimeout(()=>{ t._omniFooterStreamRetry=null; omniScheduleFooter(); },5e2);
        }
        continue;
      }
      if(row.role==='user' && !t.backendSettings?.card?.userchat)continue;
      for(const edge of ['top','bottom']) {
      if(await text.querySelector('[x-omni-edge="'+edge+'"]'))continue;
      // A new DOM generation receives a new key, so stale clicks cannot target it.
      const key=++omniFooterSerial;
      const kinds=[['tag','⚛️','태그 생성'],['regen','🔃','전체 이미지 리롤'],['char','👨‍👩‍👧‍👦','캐릭터'],['stop','🟥','중지'],['preset','📚','프리셋'],['note','✒️','작가 노트'],['counts','🔢','생성 장수']];
      const footer=await H(doc,'div',{className:'x-omni-footer',html:kinds.map(([,icon,label])=>'<button type="button" title="'+label+'" aria-label="'+label+'">'+icon+'</button>').join('')});
      await footer.setAttribute('x-omni-footer',String(key));
      await footer.setAttribute('x-omni-edge',edge);
      const buttons=await nxUnwrapSafeNodes(await footer.querySelectorAll('button'));
      if(buttons.length!==kinds.length)throw new Error('Footer sanitizer removed controls');
      await Promise.all(buttons.map(async(button,i)=>{
        await Promise.all([button.setAttribute('x-omni-action',kinds[i][0]),button.setAttribute('x-omni-target',String(key))]);
      }));
      omniFooterTargets.set(key,{sessionId:scope.sessionId,characterId:scope.characterId,chatId:scope.chatId,charIndex:scope.charIndex,chatIndex:scope.chatIndex,index,hostId});
      if(edge==='top')await text.prepend(footer);else await text.appendChild(footer);
      }
    }
    const live=new Set();
    for(const footer of await nxUnwrapSafeNodes(await root.querySelectorAll('[x-omni-footer]')))live.add(Number(await footer.getAttribute('x-omni-footer')));
    for(const key of omniFooterTargets.keys()) {
      // Pinned float-viewer targets (key nxFloatKey, _floatPin:1) survive prune.
      if(omniFooterTargets.get(key)?._floatPin)continue;
      if(!live.has(key))omniFooterTargets.delete(key);
    }
  })();
  try {await omniFooterPainting;} finally {omniFooterPainting=null;if(version!==omniFooterChanges)omniScheduleFooter();}
}
async function omniFooterHit(doc,x,y) {
  const nodes=await nxUnwrapSafeNodes(await doc.querySelectorAll('[x-omni-action]:is(:active,:focus-visible)'));
  for(const node of nodes) {
    if(!await hitEl(node,x,y))continue;
    return {kind:await node.getAttribute('x-omni-action'),index:Number(await node.getAttribute('x-omni-target')),node};
  }
  return null;
}
async function omniFooterAction(kind,key) {
  if(kind==='stop') {await optimisticStopJobs();return;}
  const target=omniFooterTargets.get(Number(key));if(!target)return;
  const doc=t.hostDoc || omniFooterDoc;
  const pinned=!!target._floatPin;
  const footer=pinned?null:await doc.querySelector('[x-omni-footer="'+key+'"]');if(!footer&&!pinned)return;
  const button=await footer?.querySelector('[x-omni-action="'+kind+'"]');
  await button?.setAttribute('x-omni-busy','true');
  const start=performance.now();
  try {
    if(kind==='counts') {if(pinned){await openSettingsTab('gen_options');return;}await omniToggleCounts(footer,key);return;}
    if(/^(min|max)-(up|down)$/.test(kind)) {await omniChangeCount(kind);return;}
    const scope=await Z({useOverride:false});
    if(scope.characterId!==target.characterId || scope.chatId!==target.chatId) return;
    if(kind==='char'||kind==='preset') {await openSettingsTab(kind==='char'?'characters':'style_presets');return;}
    if(kind==='note') {await openOmniNote(target);return;}
    const row=(scope.chat?.message || scope.chat?.messages || [])[target.index];
    if(!row || (target.hostId && row.id && String(row.id)!==target.hostId))throw new Error('메시지가 바뀌었습니다. 다시 눌러 주세요.');
    const text=String(row.data ?? row.saying ?? '');
    if(kind==='tag') {
      y('info','footer.dispatch','tag ms='+Math.round(performance.now()-start));
      await Be({...scope,actionMessageIndex:target.index,actionMessageRole:row.role,actionMessageId:row.id},text,true);return;
    }
    if(kind==='regen') {
      const ids=[...new Set([...text.matchAll(/\[\[@inray::([^:\]]+)::[^\]]+\]\]/g)].map(m=>m[1]))];
      if(!ids.length){$e('이 메시지에 리롤할 이미지가 없습니다.');return;}
      t._rerollStopRequested=false;
      await withImageRerollToast('전체 이미지 리롤 중…',async()=>{
        for(const id of ids) {
          if(t._rerollStopRequested)break;
          await K('/v1/cards/'+encodeURIComponent(id)+'/reroll',{method:'POST',body:{character_id:target.characterId,chat_id:target.chatId,message_index:target.index}});
        }
      });
    }
  } catch(error){y('error','footer.action',String(error));$e(String(error?.message || error));}
  finally {await button?.setAttribute('x-omni-busy','false');}
}
async function omniToggleCounts(footer,key) {
  const existing=await footer.querySelector('[x-omni-counts]');
  if(existing){await existing.remove();return;}
  const doc=t.hostDoc || omniFooterDoc,card=t.backendSettings?.card || {};
  const panel=await H(doc,'div',{className:'x-omni-counts'});await panel.setAttribute('x-omni-counts','1');
  const range=await H(doc,'span',{text:Number(card.image_min || 1)+'~'+Number(card.image_max || card.image_min || 1)});
  await range.setAttribute('x-omni-count-value','range');
  for(const name of ['min','max']) {
    if(name==='max')await panel.appendChild(range);
    for(const [suffix,label] of [['down','−'],['up','+']]) {
      const button=await H(doc,'button',{text:label});
      await button.setAttribute('x-omni-action',name+'-'+suffix);await button.setAttribute('x-omni-target',String(key));await panel.appendChild(button);
    }
    if(name==='min')await panel.appendChild(range);
  }
  await footer.appendChild(panel);
}
async function omniChangeCount(kind) {
  const card=t.backendSettings?.card || {}, [name,direction]=kind.split('-');
  const min=Number(card.image_min || 1),max=Number(card.image_max || min);
  const next=Number(card['image_'+name] || 1)+(direction==='up'?1:-1);
  if(next<1 || !Number.isInteger(next) || (name==='min'?next>max:next<min))return;
  await pe({card:{['image_'+name]:next}});
  const doc=t.hostDoc || omniFooterDoc;
  const lo=name==='min'?next:(name==='max'?min:next),hi=name==='min'?max:next;
  for(const node of await nxUnwrapSafeNodes(await doc.querySelectorAll('[x-omni-count-value="range"]')))await node.setTextContent(lo+'~'+hi);
}

async function omniDisposeMessageRuntime() {
  t.unloading=true;
  if(t._omniFooterStreamRetry){clearTimeout(t._omniFooterStreamRetry);t._omniFooterStreamRetry=null;}
  try { await nxFloatDispose(); } catch {}
  await omniFooterObserver?.disconnect();
  if(omniFooterKeyListener)await omniFooterRoot?.removeEventListener('keydown',omniFooterKeyListener);
  const doc=t.hostDoc || omniFooterDoc;
  if(doc)for(const node of await nxUnwrapSafeNodes(await doc.querySelectorAll('[x-omni-footer],[x-omni-footer-root]')))await node.remove();
  omniFooterTargets.clear();nxSpinnerPreviews.clear();++omniScrollEpoch;
}
