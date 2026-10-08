function nxFloatRootCss(state) {
  // Single builder for the root frame: geometry + alpha surface + idle transparency.
  // (No classList on SafeElement, so idle/bubble/collapsed all go inline.
  // Transparency needs !important to beat the surface colors in NX_FLOAT_CSS.)
  const vp = nxFloatViewport();
  if (state.iconfold) {
    const g = nxFloatIconGeo || { left: 120, top: 120 };
    const left = Math.min(Math.max(Math.round(g.left), 0), Math.max(0, vp.w - 52));
    const top = Math.min(Math.max(Math.round(g.top), 0), Math.max(0, vp.h - 52));
    return `position:fixed;left:${left}px;top:${top}px;width:52px;height:52px;z-index:99990;border-radius:50% !important;overflow:hidden;cursor:grab;pointer-events:auto;padding:0;gap:0;display:flex;align-items:center;justify-content:center;background:rgba(24,28,40,.78);border:1px solid rgba(255,255,255,.25);box-shadow:none;-webkit-backdrop-filter:none;backdrop-filter:none;box-sizing:border-box;`;
  }
  const geo = nxFloatGeo || { left: 60, top: 60, w: 360, h: 560 };
  const idle = state.idle
    ? "background:transparent !important;border-color:transparent !important;box-shadow:none !important;-webkit-backdrop-filter:none !important;backdrop-filter:none !important;"
    : "background:rgba(24,28,40,.78);border:1px solid rgba(255,255,255,.25);box-shadow:none;-webkit-backdrop-filter:none;backdrop-filter:none;";
  if (state.compact) {
    // Keep the saved viewer geometry intact so + restores the previous layout.
    const left = Math.min(Math.max(Math.round(geo.left), 0), Math.max(0, vp.w - 64));
    const top = Math.min(Math.max(Math.round(geo.top), 0), Math.max(0, vp.h - 82));
    return `position:fixed;left:${left}px;top:${top}px;width:64px;height:82px;z-index:99990;pointer-events:auto;display:flex;flex-direction:column;gap:0;padding:6px;box-sizing:border-box;${idle}`;
  }
  if (state.collapsed) {
    // Prototype collapsed: image gone, tight padding, height auto.
    const width = Math.min(280, vp.w - 16);
    const left = Math.min(Math.max(Math.round(geo.left), 0), Math.max(0, vp.w - width));
    const top = Math.min(Math.max(Math.round(geo.top), 0), Math.max(0, vp.h - 144));
    return `position:fixed;left:${left}px;top:${top}px;width:${width}px;z-index:99990;pointer-events:auto;display:flex;flex-direction:column;gap:4px;padding:6px;border-radius:20px;box-sizing:border-box;${idle}`;
  }
  const w = Math.min(vp.w - 16, Math.max(240, Math.round(geo.w || 360))), hh = Math.min(vp.h - 16, Math.max(320, Math.round(geo.h || 560)));
  const left = Math.min(Math.max(Math.round(geo.left), 0), Math.max(0, vp.w - w));
  const top = Math.min(Math.max(Math.round(geo.top), 0), Math.max(0, vp.h - hh));
  return `position:fixed;left:${left}px;top:${top}px;width:${w}px;height:${hh}px;max-height:calc(100vh - 20px);z-index:99990;pointer-events:auto;display:flex;flex-direction:column;gap:10px;padding:10px;border-radius:20px;box-sizing:border-box;${idle}`;
}
// SafeElement calls cross Risu's bridge; unchanged chrome must cost no writes.
const nxFloatStyleCache = new WeakMap(), nxFloatTextCache = new WeakMap();
let nxFloatRenderDirty = false, nxFloatRenderPending = null, nxFloatBounds = null;
async function nxFloatStyle(el, css) {
  if (!el || nxFloatStyleCache.get(el) === css) return;
  nxFloatStyleCache.set(el, css);
  try { await el.setStyleAttribute(css); }
  catch(error) { nxFloatStyleCache.delete(el); throw error; }
}
async function nxFloatText(el, value) {
  if (!el || nxFloatTextCache.get(el) === value) return;
  nxFloatTextCache.set(el, value);
  try { await el.setTextContent(value); }
  catch(error) { nxFloatTextCache.delete(el); throw error; }
}
function nxFloatContains(rect, x, y) {
  return !!rect && rect.width > 0 && rect.height > 0 && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}
function nxFloatApply() {
  nxFloatRenderDirty = true;
  if (!nxFloatRenderPending) {
    nxFloatRenderPending = nxFloatPainting.catch(()=>{}).then(async()=>{
      while (nxFloatRenderDirty) { nxFloatRenderDirty = false; await nxFloatRender(); }
    }).finally(()=>{nxFloatRenderPending=null;});
    nxFloatPainting = nxFloatRenderPending;
  }
  return nxFloatRenderPending;
}
async function nxFloatRender() {
  if (!nxFloatRoot || nxFloatDrag) return;
  const mode = nxFloatMode(), collapsed = !!nxFloatCollapsed;
  const hidden = nxFloatHidden || nxFloatBlocked();
  if (hidden) {
    nxFloatBounds = null;
    await nxFloatStyle(nxFloatRoot,"position:fixed;left:0;top:0;width:0;height:0;opacity:0;pointer-events:none;visibility:hidden;overflow:hidden;");
    return;
  }
  const css = nxFloatRootCss({ collapsed, compact: nxFloatCompact, iconfold: !nxFloatCompact && mode === "bubble" && collapsed, idle: nxFloatIdle })+`;--nx-float-touch-opacity:${nxFloatIdle?'0':'1'};--nx-float-touch-events:${nxFloatIdle?'none':'auto'};`;
  const changed = nxFloatStyleCache.get(nxFloatRoot) !== css;
  await nxFloatStyle(nxFloatRoot,css);
  await nxFloatPaintChrome();
  if(changed || !nxFloatBounds)nxFloatBounds = await nxFloatRoot.getBoundingClientRect();
  await nxFloatPaintCounts();
}

let nxFloatCounts = null, nxFloatCountsOpen = false, nxFloatCountWrites = Promise.resolve();
let nxFloatCountBounds = null, nxFloatCountsPaintKey = '';
async function nxFloatToggleCounts() {
  nxFloatCountsOpen = !nxFloatCountsOpen;
  if (!nxFloatCounts && nxFloatCountsOpen) {
    nxFloatCounts = await H(nxFloatDoc,'div',{style:'display:none;'});
    await nxFloatCounts.setAttribute('x-nx-float-counts','1');
    for (const kind of ['min-down','min-up','range','max-down','max-up']) {
      const node=await H(nxFloatDoc,kind==='range'?'span':'button',{text:kind==='range'?'':kind.endsWith('up')?'+':'−'});
      await node.setAttribute(kind==='range'?'x-omni-count-value':'x-nx-float-btn',kind);
      await nxFloatCounts.appendChild(node);
      await omniRelease(node);
    }
    await nxFloatRoot.appendChild(nxFloatCounts);
  }
  await nxFloatApply();
}
async function nxFloatChangeCount(kind) {
  // Each click reads the settings returned by the previous save, so fast
  // repeated clicks accumulate rather than writing the same value twice.
  nxFloatCountWrites = nxFloatCountWrites.catch(()=>{}).then(()=>omniChangeCount(kind));
  await nxFloatCountWrites;
  await nxFloatApply();
}
async function nxFloatPaintCounts() {
  if (!nxFloatRoot || (!nxFloatCounts && !nxFloatCountsOpen)) return;
  const card=t.backendSettings?.card || {},bounds=nxFloatBounds,vp=nxFloatViewport();
  const key=JSON.stringify([nxFloatCountsOpen,nxFloatCompact,nxFloatCollapsed,nxFloatMode(),nxFloatIdle,card.image_min,card.image_max,bounds?.left,bounds?.top,bounds?.width,bounds?.height,vp.w,vp.h]);
  if(key===nxFloatCountsPaintKey)return;
  const refs=omniDomScope();
  try {
  for (const button of await refs.all(await nxFloatRoot.querySelectorAll('[x-nx-float-btn="counts"]'))) {
    await button.setAttribute('x-nx-float-active',nxFloatCountsOpen?'true':'false');
  }
  if (!nxFloatCounts) return;
  if (!nxFloatCountsOpen || nxFloatCompact || (nxFloatCollapsed && nxFloatMode()==='bubble')) {
    nxFloatCountBounds=null;
    await nxFloatStyle(nxFloatCounts,'display:none;');nxFloatCountsPaintKey=key;return;
  }
  const range=refs.own(await nxFloatCounts.querySelector('[x-omni-count-value]'));
  await range.setTextContent(Number(card.image_min || 1)+'~'+Number(card.image_max || card.image_min || 1));
  const rect=nxFloatBounds || await nxFloatRoot.getBoundingClientRect();
  const width=Math.min(286,vp.w-16);
  const left=Math.max(8,Math.min(rect.left+(rect.width-width)/2,vp.w-width-8))-rect.left;
  const top=rect.bottom+70<=vp.h?rect.height+8:-66;
  await nxFloatStyle(nxFloatCounts,`position:absolute;left:${left}px;top:${top}px;width:${width}px;display:flex;align-items:center;justify-content:center;gap:6px;padding:6px;box-sizing:border-box;z-index:5;opacity:${nxFloatIdle?(nxFloatCollapsed?'.1':'0'):'1'};pointer-events:${nxFloatIdle?'none':'auto'};`);
  nxFloatCountBounds=await nxFloatCounts.getBoundingClientRect();
  nxFloatCountsPaintKey=key;
  } finally {await refs.close();}
}
async function nxFloatHitSurface(x,y) {
  if (!nxFloatRoot || t._nxHostInspectOpen || nxFloatHidden || nxFloatBlocked()) return false;
  return nxFloatContains(nxFloatBounds,x,y) || !!(nxFloatCountsOpen && nxFloatContains(nxFloatCountBounds,x,y));
}
async function nxFloatPaintChrome() {
  // Child visibility + idle fade. display/opacity are JS-owned (inline);
  // NX_FLOAT_CSS owns the rest.
  if (!nxFloatRoot) return;
  const mode = nxFloatMode(), collapsed = !!nxFloatCollapsed;
  const iconfold = mode === "bubble" && collapsed;
  // Prototype idle: chrome fades out, image only. Collapsed idle: 10% remains.
  const idleOp = nxFloatIdle ? (collapsed ? "0.1" : "0") : "1";
  const writes=[];
  const show=(el,css)=>writes.push(nxFloatStyle(el,css));
  writes.push(nxFloatText(nxFloatCompactBtn,nxFloatCompact ? '+' : '−'));
  show(nxFloatCompactBtn, nxFloatCompact ? 'position:static;width:44px;min-height:44px;flex:none;' : 'position:absolute;right:0;top:0;width:40px;min-height:44px;');
  if (nxFloatCompact) {
    show(nxFloatIcon, "display:none;");
    show(nxFloatHead, "display:none;");
    show(nxFloatStage, "display:none;");
    show(nxFloatBar, "display:none;");
    show(nxFloatResize, "display:none;");
    show(nxFloatFoldGrid, "display:none;");
    show(nxFloatFoldGrip, `display:flex;flex-direction:column;gap:4px;min-height:0;opacity:${nxFloatIdle ? '0.1' : '1'};`);
    await Promise.all(writes); return;
  }
  if (iconfold) {
    // Prototype iconfold: bubble stays fully visible in idle (recovery handle).
    show(nxFloatIcon, "display:block;");
    show(nxFloatHead, "display:none;");
    show(nxFloatStage, "display:none;");
    show(nxFloatBar, "display:none;");
    show(nxFloatResize, "display:none;");
    show(nxFloatFoldGrip, "display:none;");
    show(nxFloatFoldGrid, "display:none;");
    await Promise.all(writes); return;
  }
  show(nxFloatIcon, "display:none;");
  if (collapsed) {
    show(nxFloatHead, "display:none;");
    show(nxFloatStage, "display:none;");
    show(nxFloatBar, "display:none;");
    show(nxFloatResize, "display:none;");
    show(nxFloatFoldGrip, `display:flex;opacity:${idleOp};pointer-events:${nxFloatIdle ? "none" : "auto"};`);
    show(nxFloatFoldGrid, `display:grid;opacity:${idleOp};`);
    try { if (nxFloatFoldBtn && nxFloatFoldBtn.setTextContent) writes.push(nxFloatText(nxFloatFoldBtn,"▾")); } catch {}
  } else {
    show(nxFloatHead, `display:flex;opacity:${idleOp};`);
    show(nxFloatStage, "display:flex;flex:1;min-height:0;align-items:center;justify-content:center;");
    show(nxFloatBar, `display:flex;opacity:${idleOp};`);
    show(nxFloatResize, `display:block;opacity:${idleOp};`);
    show(nxFloatFoldGrip, "display:none;");
    show(nxFloatFoldGrid, "display:none;");
    try { if (nxFloatFoldBtn && nxFloatFoldBtn.setTextContent) writes.push(nxFloatText(nxFloatFoldBtn,"▴")); } catch {}
  }
  await Promise.all(writes);
}
