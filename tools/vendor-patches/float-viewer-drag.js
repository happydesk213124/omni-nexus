// Host writes are ordered, but bridge acknowledgements must not pace dragging.
let nxFloatDragListeners = [], nxFloatDragStarting = false, nxFloatPointer = null;
let nxFloatMovePainting = null, nxFloatMoveDirty = false, nxFloatSuppressClick = 0;
const nxFloatMoveWrites = new Set();
let nxFloatMoveDone = null;
function nxFloatEvPos(ev) {
  const x = ev?.clientX ?? ev?.pageX, y = ev?.clientY ?? ev?.pageY;
  return Number.isFinite(x) && Number.isFinite(y) ? {x, y} : null;
}
function nxFloatMoveDrag(ev) {
  const p = nxFloatEvPos(ev), d = nxFloatDrag;
  if (p && nxFloatPointer) nxFloatPointer.pos = p;
  if (!p || !d || d.ending) return;
  if (Math.hypot(p.x-d.sx,p.y-d.sy)>4) d.moved=true;
  if (!d.moved) return;
  d.pos=p; nxFloatMoveDirty=true;
  void nxFloatPaintMove();
}
function nxFloatPaintMove() {
  if(nxFloatMoveDirty && nxFloatDrag && nxFloatMoveWrites.size<16) {
    // A hidden iframe cannot use rAF, and mobile browsers throttle its timers.
    // Send on the input callback; retain only the latest position if the host stalls.
    if(!nxFloatMovePainting)nxFloatMovePainting=new Promise(resolve=>{nxFloatMoveDone=resolve;});
    nxFloatMoveDirty=false;
    const d=nxFloatDrag,p=d.pos,dx=p.x-d.sx,dy=p.y-d.sy,vp=nxFloatViewport();
    let work;
    if(d.kind==='resize') {
      nxFloatGeo={...d.geo,w:Math.min(vp.w-d.left,Math.max(240,d.w+dx)),h:Math.min(vp.h-d.top,Math.max(320,d.h+dy))};
      work=Promise.all([nxFloatRoot.setStyle('width',nxFloatGeo.w+'px'),nxFloatRoot.setStyle('height',nxFloatGeo.h+'px')]);
    } else {
      const left=Math.max(0,Math.min(vp.w-d.visibleW,d.left+dx));
      const top=Math.max(0,Math.min(vp.h-d.visibleH,d.top+dy));
      if(d.kind==='bubble-move')nxFloatIconGeo={left,top};
      else nxFloatGeo={...d.geo,left,top};
      work=nxFloatRoot.setStyle('transform',`translate3d(${left-d.left}px,${top-d.top}px,0)`);
    }
    const write=Promise.resolve(work).catch(e=>nxFloatLog('drag',String(e))).finally(()=>{
      nxFloatMoveWrites.delete(write);
      if(nxFloatMoveDirty && nxFloatDrag)nxFloatPaintMove();
      if(!nxFloatMoveWrites.size) {
        const done=nxFloatMoveDone;
        nxFloatMovePainting=null;nxFloatMoveDone=null;done?.();
      }
    });
    nxFloatMoveWrites.add(write);
  }
  return nxFloatMovePainting || Promise.resolve();
}
async function nxFloatMaybeDrag(ev, kind, pointer=nxFloatPointer) {
  if (!nxFloatRoot || nxFloatBlocked() || nxFloatHidden || nxFloatDrag || nxFloatDragStarting || (ev?.button != null && ev.button !== 0)) return;
  const pos=nxFloatEvPos(ev); if(!pos)return;
  nxFloatDragStarting=true;
  try {
    const refs=omniDomScope();
    try {
      const buttons=await refs.all(await nxFloatRoot.querySelectorAll('[x-nx-float-btn]'));
      if((await Promise.all(buttons.map(button=>hitEl(button,pos.x,pos.y)))).some(Boolean))return;
    } finally {await refs.close();}
    await nxFloatPainting;
    const rect=nxFloatBounds || await nxFloatRoot.getBoundingClientRect();
    if(!pointer?.held || pointer!==nxFloatPointer || nxFloatBlocked())return;
    const geo=nxFloatGeo || {left:60,top:60,w:360,h:560};
    nxFloatDrag={kind,sx:pos.x,sy:pos.y,left:rect.left,top:rect.top,w:geo.w,h:geo.h,geo,visibleW:rect.width,visibleH:rect.height,moved:false,pos};
    clearTimeout(nxFloatIdleTimer);
    nxFloatMoveDrag({clientX:pointer.pos.x,clientY:pointer.pos.y});
  } finally {nxFloatDragStarting=false;}
}
async function nxFloatEndDrag(cancel=false) {
  const d=nxFloatDrag; if(!d)return;
  if(d.ending)return d.ending;
  return d.ending=(async()=>{
    await nxFloatPaintMove();
    nxFloatDrag=null;nxFloatMoveDirty=false;
    if(d.moved)nxFloatSuppressClick=Date.now()+400;
    nxFloatStyleCache.delete(nxFloatRoot); // Commit left/top after all transforms have reached the host.
    await nxFloatApply();
    if(nxFloatDirty)nxFloatScheduleScan();
    if(!cancel) {
      if(d.kind==='bubble-move') {
        if(!d.moved)await nxFloatSetCollapsed(false);
        else nxFloatIconGeo=await saveViewerIconGeo(nxFloatIconGeo);
      } else if(d.moved)await qt(nxFloatGeo);
    }
    nxFloatArmIdle();
  })();
}
