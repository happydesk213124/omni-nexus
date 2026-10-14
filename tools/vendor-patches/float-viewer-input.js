// Risu callbacks carry coordinates, not native event targets. All host reads
// go through SafeElement methods; only the selected image's URL is inspected.
let nxFloatInputs = [], nxFloatScanTimer = 0, nxFloatScanning = null;
let nxFloatScanAgain = false;
let nxFloatObserver = null, nxFloatWatchRoot=null, nxFloatDirty = true;
let nxFloatReadingIndex=-1, nxFloatStructureDirty=true;
let nxFloatTouchReveal=false;
const nxFloatTouchMedia=globalThis.matchMedia?.('(hover: none)');
function nxFloatTouchOnly(){return !!nxFloatTouchMedia?.matches;}
async function nxFloatWatchChat(h) {
  const existing=await h.root.querySelector('[x-nx-float-watch]');
  if(existing){await omniRelease(existing);return;}
  await nxFloatObserver?.disconnect();
  await omniRelease(nxFloatObserver);await omniRelease(nxFloatWatchRoot);
  const marker = await H(h.doc, 'span', {style:'display:none;'});
  await marker.setAttribute('x-nx-float-watch', '1');
  await h.root.appendChild(marker);
  await omniRelease(marker);
  nxFloatWatchRoot=h.root;
  nxFloatObserver = await k.createMutationObserver(records => {void omniRelease(records);nxFloatStructureDirty=true;nxFloatScheduleScan();});
  await nxFloatObserver.observe(h.root, {childList:true});
  nxFloatDirty = true;
}
async function nxFloatListen(node, kind, fn, options = {}) {
  const id = await node.addEventListener(kind, fn, options);
  nxFloatInputs.push({node, kind, id, options});
}
async function nxFloatBindInputs(h) {
  nxFloatDoc = h.doc;
  nxFloatChatRoot = h.body;
  // SafeElement listeners are document-wide. Register once per event and
  // resolve the hit by coordinates, never by the element used to register it.
  await nxFloatListen(h.body, 'click', async e => {
    const pos = nxFloatEvPos(e);
    if (!pos || Date.now()<nxFloatSuppressClick || !await nxFloatHitSurface(pos.x,pos.y)) return;
    if(nxFloatTouchReveal){nxFloatTouchReveal=false;return;}
    const refs=omniDomScope();
    try {
    const buttons = await refs.all(await nxFloatRoot.querySelectorAll('[x-nx-float-btn]'));
    const hits=await Promise.all(buttons.map(button=>hitEl(button,pos.x,pos.y)));
    const button=buttons[hits.indexOf(true)];
    if(button)await nxFloatClick(await button.getAttribute('x-nx-float-btn'));
    } finally {await refs.close();}
  });
  await nxFloatListen(h.body, 'pointerdown', async e => {
    const pos = nxFloatEvPos(e);
    const pointer=nxFloatPointer={held:true,pos};
    const slack=12,near=nxFloatBounds&&{left:nxFloatBounds.left-slack,right:nxFloatBounds.right+slack,top:nxFloatBounds.top-slack,bottom:nxFloatBounds.bottom+slack,width:nxFloatBounds.width,height:nxFloatBounds.height};
    if (!pos || t._nxHostInspectOpen || nxFloatBlocked() || nxFloatHidden || !nxFloatContains(near,pos.x,pos.y)) return;
    if(nxFloatTouchOnly()) {
      nxFloatTouchReveal=nxFloatIdle;nxFloatHovered=false;nxFloatNudgeIdle();
    }
    const handles=[[nxFloatResize,'resize'],[nxFloatIcon,'bubble-move'],[nxFloatHead,'move'],[nxFloatFoldGrip,'move'],[nxFloatStage,'move']];
    const hits=await Promise.all(handles.map(([handle])=>hitEl(handle,pos.x,pos.y)));
    // Just outside the frame (a fast grab that misses by a few px) still moves it.
    const outside=!nxFloatContains(nxFloatBounds,pos.x,pos.y);
    const found=handles[hits.indexOf(true)] || (outside ? [null, nxFloatIcon && await hitEl(nxFloatIcon,Math.min(Math.max(pos.x,nxFloatBounds.left),nxFloatBounds.right),Math.min(Math.max(pos.y,nxFloatBounds.top),nxFloatBounds.bottom)) ? 'bubble-move' : 'move'] : undefined);
    if(found)await nxFloatMaybeDrag(e,found[1],pointer);
  });
  await nxFloatListen(h.body, 'pointermove', e => {
    nxFloatMoveDrag(e);
    if (nxFloatDrag || nxFloatTouchOnly()) return;
    const pos = nxFloatEvPos(e);
    if (!pos || t._nxHostInspectOpen || nxFloatBlocked() || nxFloatHidden) return;
    const inside=nxFloatContains(nxFloatBounds,pos.x,pos.y) || (nxFloatCountsOpen && nxFloatContains(nxFloatCountBounds,pos.x,pos.y));
    // A fixed frame changes bounds on render/drag, not on mousemove.
    if(inside!==nxFloatHovered){nxFloatHovered=inside;if(inside)nxFloatNudgeIdle();else nxFloatArmIdle();}
  }, {capture:true});
  for (const kind of ['pointerup','pointercancel']) await nxFloatListen(h.body,kind,e=>{
    if(nxFloatPointer)nxFloatPointer.held=false;
    if(nxFloatTouchOnly()) {
      nxFloatHovered=false;
      if(nxFloatPointer?.pos && nxFloatContains(nxFloatBounds,nxFloatPointer.pos.x,nxFloatPointer.pos.y))nxFloatArmIdle();
      if(kind==='pointercancel')nxFloatTouchReveal=false;
    }
    nxFloatMoveDrag(e);void nxFloatEndDrag(kind==='pointercancel');
  },{capture:true});
  for (const kind of ['scroll', 'scrollend']) {
    await nxFloatListen(h.body, kind, () => nxFloatScheduleScan(), {capture:true});
  }
  nxFloatMoveListener = true;
}
function nxFloatScheduleScan() {
  nxFloatDirty = true;
  if (nxFloatScanTimer || nxFloatBlocked()) return;
  nxFloatScanTimer = setTimeout(() => {
    nxFloatScanTimer = 0;
    void nxFloatScan().catch(e => nxFloatLog('scan', String(e)));
  }, 150);
}
async function nxFloatUnbindInputs() {
  clearTimeout(nxFloatScanTimer); nxFloatScanTimer = 0;
  if(nxFloatPointer)nxFloatPointer.held=false;
  await nxFloatEndDrag(true);
  await nxFloatDropShield();
  nxFloatPointer=null;
  await nxFloatObserver?.disconnect();await omniRelease(nxFloatObserver);nxFloatObserver = null;
  await nxFloatDropPosition();
  await omniRelease(nxFloatWatchRoot);nxFloatWatchRoot=null;
  if (nxFloatDoc) {
    const refs=omniDomScope();
    try {for (const node of await refs.all(await nxFloatDoc.querySelectorAll('[x-nx-float-watch],[x-nx-float-shield]'))) await node.remove();}finally{await refs.close();}
  }
  for (const {node, kind, id, options} of nxFloatInputs.splice(0)) {
    try { await node.removeEventListener(kind, id, options); } catch {}
  }
  await omniRelease(nxFloatChatRoot);
  nxFloatMoveListener = null; nxFloatChatRoot = null; nxFloatDoc = null;
}
async function nxFloatScan() {
  if(t.unloading)return;
  // A direct read (e.g. pressing a viewer action) consumes the queued scroll
  // read too. Keeping its timer caused a second pass after the button reacted.
  clearTimeout(nxFloatScanTimer);nxFloatScanTimer=0;
  if (nxFloatScanning) { if(nxFloatDirty)nxFloatScanAgain = true; return nxFloatScanning; }
  nxFloatScanning = nxFloatReadPosition().finally(() => {
    nxFloatScanning = null;
    if (nxFloatScanAgain) { nxFloatScanAgain = false;if(nxFloatDirty)nxFloatScheduleScan(); }
  });
  return nxFloatScanning;
}
function nxFloatHtmlAttr(html, name) {
  const match = new RegExp('(?:^|\\s)' + name + '=["\']([^"\']*)["\']', 'i').exec(html);
  return (match?.[1] || '').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}
