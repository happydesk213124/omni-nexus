// Runs inside the UI closure: SafeElement access only. The old fan owns no nodes.
const omniFooterTargets = new Map();
let omniFooterSerial = 0, omniFooterPainting = null, omniFooterObserver = null, omniFooterChanges=0;
let omniFooterTimer=0;
let omniFooterDoc = null, omniFooterRoot = null, omniFooterQueued = false, omniFooterKeyListener=null;
// Initialization only; message HTML is owned by the display module.
function omniScheduleFooter() {
  if (t.unloading || omniFooterQueued) return;
  omniFooterQueued=true;
  omniFooterTimer=setTimeout(()=>{omniFooterQueued=false;omniFooterTimer=0;void omniMountFooters().catch(e=>y('warn','footer.init',String(e)));},250);
}
async function omniMountFooters() {
  if(omniFooterPainting)return omniFooterPainting;
  omniFooterPainting=omniInitModuleControls();
  try {await omniFooterPainting;} finally {omniFooterPainting=null;}
}
async function omniInitModuleControls() {
  if(t.unloading)return;
  const doc=t.hostDoc || await ue();if(!doc)return;
  if(omniFooterDoc===doc && omniFooterRoot)return;
  if(omniFooterKeyListener)await omniFooterRoot?.removeEventListener('keydown',omniFooterKeyListener);
  await omniFooterObserver?.disconnect();await omniRelease(omniFooterObserver);
  await omniRelease(omniFooterRoot);
  omniFooterDoc=doc;t.hostDoc=doc;omniFooterRoot=await doc.querySelector('body');
  if(!omniFooterRoot)return;
  omniFooterKeyListener=await omniFooterRoot.addEventListener('keydown',async event=>{
    if(event.repeat || (event.key!=='Enter' && event.key!==' '))return;
    const button=await doc.querySelector('[data-omni-action]:focus,[x-omni-action]:focus');if(!button)return;
    try {const hit=await omniBindModuleButton(button);if(hit)await omniFooterAction(hit.kind,hit.index);} finally {await omniRelease(button);}
  });
  // This observer is for pending image previews only, never for button repair.
  omniFooterObserver=await k.createMutationObserver(records=>{
    void omniRelease(records);if(nxSpinnerPreviews.size)void nxPaintSpinnerPreviews();
  });
  if(nxSpinnerPreviews.size)await omniFooterObserver.observe(omniFooterRoot,{childList:true,subtree:true});
}
function omniMessageToken(index,text) {
  const bytes=new TextEncoder().encode(text);let sum=0;
  for(const byte of bytes)sum=(sum*31+byte)%65521;
  return index+':'+bytes.length+':'+sum;
}
async function omniBindModuleButton(node) {
  const html=await node.getOuterHTML();
  const kind=/data-omni-action="([a-z-]+)"/.exec(html)?.[1] || await node.getAttribute('x-omni-action');
  if(!kind)return null;
  if(!nxMsgFan() || t.unloading)return null;
  let footer=await node.getParent();
  const owned=[];
  try {
    for(let depth=0;footer && depth<5;depth++) {
      owned.push(footer);
      const outer=await footer.getOuterHTML();
      const token=/^<[^>]*data-omni-footer="([0-9:]+)"/.exec(outer)?.[1];
      if(token) {
        const scope=await Z({useOverride:false}),index=Number(token.split(':')[0]);
        const row=(scope.chat?.message || scope.chat?.messages || [])[index];
        if(!row || (row.role==='user'&&!t.backendSettings?.card?.userchat) || omniMessageToken(index,String(row.data ?? row.saying ?? ''))!==token)return null;
        const old=Number(await footer.getAttribute('x-omni-footer'));
        const key=old>0?old:++omniFooterSerial;
        if(!old)await footer.setAttribute('x-omni-footer',String(key));
        // A target is allocated on interaction, not for every displayed message.
        for(const [id,target] of omniFooterTargets)if(!target._floatPin && id!==key)omniFooterTargets.delete(id);
        omniFooterTargets.set(key,{sessionId:scope.sessionId,characterId:scope.characterId,chatId:scope.chatId,charIndex:scope.charIndex,chatIndex:scope.chatIndex,index,hostId:row.id,token});
        return {kind,index:key,node};
      }
      footer=await footer.getParent();
    }
    return null;
  } finally {for(const item of owned)await omniRelease(item);}
}
async function omniFooterHit(doc,x,y) {
  const nodes=await nxUnwrapSafeNodes(await doc.querySelectorAll('[data-omni-action]:is(:active,:focus-visible),[x-omni-action]:is(:active,:focus-visible)'));
  for(const node of nodes) {
    if(!await hitEl(node,x,y))continue;
    const hit=await omniBindModuleButton(node);if(hit)return hit;
  }
  return null;
}
async function omniFooterAction(kind,key) {
  if(kind==='stop') {await optimisticStopJobs();return;}
  const target=omniFooterTargets.get(Number(key));if(!target)return;
  const doc=t.hostDoc || omniFooterDoc;
  const pinned=!!target._floatPin;
  const footer=pinned?null:await doc.querySelector('[x-omni-footer="'+key+'"]');if(!footer&&!pinned)return;
  const button=await footer?.querySelector('[data-omni-action="'+kind+'"],[x-omni-action="'+kind+'"]');
  await button?.setAttribute('x-omni-busy','true');
  const start=performance.now();
  try {
    const current=await Z({useOverride:false});
    if(current.characterId!==target.characterId || current.chatId!==target.chatId)return;
    const currentRow=(current.chat?.message || current.chat?.messages || [])[target.index];
    if(!pinned && (!currentRow || (target.token && omniMessageToken(target.index,String(currentRow.data ?? currentRow.saying ?? ''))!==target.token)))return;
    if(kind==='counts') {if(pinned){await openSettingsTab('gen_options');return;}await omniToggleCounts(footer,key);return;}
    if(/^(min|max)-(up|down)$/.test(kind)) {await omniChangeCount(kind);return;}
    const scope=current;
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
  if(existing){const hidden=await existing.getAttribute('x-omni-hidden')==='1';await existing.setAttribute('x-omni-hidden',hidden?'0':'1');await existing.setStyleAttribute(hidden?'display:flex;gap:6px;align-items:center':'display:none');if(hidden)await omniRefreshCountLabels();return;}
  const doc=t.hostDoc || omniFooterDoc,card=t.backendSettings?.card || {};
  const panel=await H(doc,'div',{className:'x-omni-counts'});await panel.setAttribute('x-omni-counts','1');await panel.setStyleAttribute('display:flex;gap:6px;align-items:center');
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
let omniCountWrites=Promise.resolve();
function omniChangeCount(kind) {
  const pending=omniCountWrites.catch(()=>{}).then(()=>omniWriteCount(kind));omniCountWrites=pending;return pending;
}
async function omniWriteCount(kind) {
  const card=t.backendSettings?.card || {}, [name,direction]=kind.split('-');
  const min=Number(card.image_min || 1),max=Number(card.image_max || min);
  const next=Number(card['image_'+name] || 1)+(direction==='up'?1:-1);
  if(next<1 || !Number.isInteger(next) || (name==='min'?next>max:next<min))return;
  await pe({card:{['image_'+name]:next}});
  await omniRefreshCountLabels();
}

async function omniRefreshCountLabels() {
  const card=t.backendSettings?.card || {},doc=t.hostDoc || omniFooterDoc;
  if(!doc)return;
  for(const node of await nxUnwrapSafeNodes(await doc.querySelectorAll('[x-omni-count-value="range"]'))) {
    try {await node.setTextContent(Number(card.image_min || 1)+'~'+Number(card.image_max || card.image_min || 1));} finally {await omniRelease(node);}
  }
}
async function omniDisposeMessageRuntime() {
  t.unloading=true;
  omniStreamDispose();
  await omniObserverWork.catch(()=>{});
  await omniFooterPainting?.catch(()=>{});
  if(t._omniFooterStreamRetry){clearTimeout(t._omniFooterStreamRetry);t._omniFooterStreamRetry=null;}
  try { await nxFloatDispose(); } catch {}
  await omniFooterObserver?.disconnect();
  if(omniFooterKeyListener)await omniFooterRoot?.removeEventListener('keydown',omniFooterKeyListener);
  await omniRelease(omniFooterObserver);omniFooterObserver=null;
  await omniRelease(omniFooterRoot);omniFooterRoot=null;
  const doc=t.hostDoc || omniFooterDoc;
  const refs=omniDomScope();
  try {if(doc)for(const node of await refs.all(await doc.querySelectorAll('[x-omni-counts],[x-omni-footer-root]')))await node.remove();}
  finally {await refs.close();}
  omniFooterTargets.clear();nxSpinnerPreviews.clear();++omniScrollEpoch;
}
