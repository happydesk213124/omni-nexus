// Risu callbacks carry coordinates, not native event targets. All host reads
// go through SafeElement methods; only the selected image's URL is inspected.
let nxFloatInputs = [], nxFloatScanTimer = 0, nxFloatScanning = null;
let nxFloatScanAgain = false;
let nxFloatObserver = null, nxFloatWatchRoot=null, nxFloatDirty = true;
let nxFloatReadingIndex=-1, nxFloatStructureDirty=true;
let nxFloatHoverPos = null, nxFloatHoverBusy = false;
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
    const refs=omniDomScope();
    try {
    const buttons = await refs.all(await nxFloatRoot.querySelectorAll('[x-nx-float-btn]'));
    for (const button of buttons) {
      if (await hitEl(button,pos.x,pos.y)) {
        await nxFloatClick(await button.getAttribute('x-nx-float-btn'));
        return;
      }
    }
    } finally {await refs.close();}
  });
  await nxFloatListen(h.body, 'pointerdown', async e => {
    const pos = nxFloatEvPos(e);
    const pointer=nxFloatPointer={held:true,pos};
    if (!pos || t._nxHostInspectOpen || nxFloatBlocked() || nxFloatHidden || !await hitEl(nxFloatRoot,pos.x,pos.y)) return;
    for (const [handle,kind] of [[nxFloatResize,'resize'],[nxFloatIcon,'bubble-move'],[nxFloatHead,'move'],[nxFloatFoldGrip,'move'],[nxFloatStage,'move']]) {
      if (await hitEl(handle,pos.x,pos.y)) { await nxFloatMaybeDrag(e,kind,pointer); return; }
    }
  });
  await nxFloatListen(h.body, 'pointermove', e => {
    nxFloatMoveDrag(e);
    const pos = nxFloatEvPos(e);
    if (!pos || t._nxHostInspectOpen || nxFloatBlocked() || nxFloatHidden) return;
    nxFloatHoverPos = pos;
    if (nxFloatHoverBusy) return;
    nxFloatHoverBusy = true;
    void (async () => {
      const rect = await nxFloatRoot.getBoundingClientRect();
      const latest = nxFloatHoverPos;
      if (!latest || nxFloatBlocked() || nxFloatHidden) return;
      const inside = (rect.width > 0 && rect.height > 0 && latest.x >= rect.left && latest.x <= rect.right && latest.y >= rect.top && latest.y <= rect.bottom)
        || !!(nxFloatCountsOpen && nxFloatCounts && await hitEl(nxFloatCounts,latest.x,latest.y));
      if (inside !== nxFloatHovered) {
        nxFloatHovered = inside;
        if (inside) nxFloatNudgeIdle(); else nxFloatArmIdle();
      }
    })().catch(() => {}).finally(() => { nxFloatHoverBusy = false; });
  }, {capture:true});
  for (const kind of ['pointerup','pointercancel']) await nxFloatListen(h.body,kind,e=>{
    if(nxFloatPointer)nxFloatPointer.held=false;
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
  nxFloatHoverPos = null;
  clearTimeout(nxFloatScanTimer); nxFloatScanTimer = 0;
  if(nxFloatPointer)nxFloatPointer.held=false;
  await nxFloatEndDrag(true);
  nxFloatPointer=null;
  await nxFloatObserver?.disconnect();await omniRelease(nxFloatObserver);nxFloatObserver = null;
  await nxFloatDropPosition();
  await omniRelease(nxFloatWatchRoot);nxFloatWatchRoot=null;
  if (nxFloatDoc) {
    const refs=omniDomScope();
    try {for (const node of await refs.all(await nxFloatDoc.querySelectorAll('[x-nx-float-watch]'))) await node.remove();}finally{await refs.close();}
  }
  for (const {node, kind, id, options} of nxFloatInputs.splice(0)) {
    try { await node.removeEventListener(kind, id, options); } catch {}
  }
  await omniRelease(nxFloatChatRoot);
  nxFloatMoveListener = null; nxFloatChatRoot = null; nxFloatDoc = null;
}
async function nxFloatScan() {
  if(t.unloading)return;
  if (nxFloatScanning) { nxFloatScanAgain = true; return nxFloatScanning; }
  nxFloatScanning = nxFloatReadPosition().finally(() => {
    nxFloatScanning = null;
    if (nxFloatScanAgain) { nxFloatScanAgain = false; nxFloatScheduleScan(); }
  });
  return nxFloatScanning;
}
function nxFloatHtmlAttr(html, name) {
  const match = new RegExp('(?:^|\\s)' + name + '=["\']([^"\']*)["\']', 'i').exec(html);
  return (match?.[1] || '').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}
