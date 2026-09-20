function nxFloatRootCss(state) {
  // Single builder for the root frame: geometry + glass + idle transparency.
  // (No classList on SafeElement, so idle/bubble/collapsed all go inline.
  // Transparency needs !important to beat the glass colors in NX_FLOAT_CSS.)
  const vp = nxFloatViewport();
  if (state.iconfold) {
    const g = nxFloatIconGeo || { left: 120, top: 120 };
    const left = Math.min(Math.max(Math.round(g.left), 0), Math.max(0, vp.w - 52));
    const top = Math.min(Math.max(Math.round(g.top), 0), Math.max(0, vp.h - 52));
    return `position:fixed;left:${left}px;top:${top}px;width:52px;height:52px;z-index:99990;border-radius:50% !important;overflow:hidden;cursor:grab;pointer-events:auto;padding:0;gap:0;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.25);box-shadow:0 4px 16px rgba(0,0,0,.3);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);box-sizing:border-box;`;
  }
  const geo = nxFloatGeo || { left: 60, top: 60, w: 360, h: 560 };
  const idle = state.idle
    ? "background:transparent !important;border-color:transparent !important;box-shadow:none !important;-webkit-backdrop-filter:none !important;backdrop-filter:none !important;"
    : "background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.25);box-shadow:0 20px 60px rgba(0,0,0,.55);-webkit-backdrop-filter:blur(22px) saturate(1.6);backdrop-filter:blur(22px) saturate(1.6);";
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
function nxFloatApply() {
  nxFloatPainting = nxFloatPainting.catch(() => {}).then(nxFloatRender);
  return nxFloatPainting;
}
async function nxFloatRender() {
  if (!nxFloatRoot || nxFloatDrag) return;
  const mode = nxFloatMode(), collapsed = !!nxFloatCollapsed;
  const hidden = nxFloatHidden || nxFloatBlocked();
  if (hidden) {
    await nxFloatRoot.setStyleAttribute("position:fixed;left:0;top:0;width:0;height:0;opacity:0;pointer-events:none;visibility:hidden;overflow:hidden;");
    return;
  }
  await nxFloatRoot.setStyleAttribute(nxFloatRootCss({ collapsed, iconfold: mode === "bubble" && collapsed, idle: nxFloatIdle }));
  await nxFloatPaintChrome();
  await nxFloatPaintCounts();
}

let nxFloatCounts = null, nxFloatCountsOpen = false, nxFloatCountWrites = Promise.resolve();
async function nxFloatToggleCounts() {
  nxFloatCountsOpen = !nxFloatCountsOpen;
  if (!nxFloatCounts && nxFloatCountsOpen) {
    nxFloatCounts = await H(nxFloatDoc,'div',{style:'display:none;'});
    await nxFloatCounts.setAttribute('x-nx-float-counts','1');
    for (const kind of ['min-down','min-up','range','max-down','max-up']) {
      const node=await H(nxFloatDoc,kind==='range'?'span':'button',{text:kind==='range'?'':kind.endsWith('up')?'+':'−'});
      await node.setAttribute(kind==='range'?'x-omni-count-value':'x-nx-float-btn',kind);
      await nxFloatCounts.appendChild(node);
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
  if (!nxFloatRoot) return;
  for (const button of await nxUnwrapSafeNodes(await nxFloatRoot.querySelectorAll('[x-nx-float-btn="counts"]'))) {
    await button.setAttribute('x-nx-float-active',nxFloatCountsOpen?'true':'false');
  }
  if (!nxFloatCounts) return;
  if (!nxFloatCountsOpen || (nxFloatCollapsed && nxFloatMode()==='bubble')) {
    await nxFloatCounts.setStyleAttribute('display:none;');return;
  }
  const card=t.backendSettings?.card || {};
  const range=await nxFloatCounts.querySelector('[x-omni-count-value]');
  await range.setTextContent(Number(card.image_min || 1)+'~'+Number(card.image_max || card.image_min || 1));
  const rect=await nxFloatRoot.getBoundingClientRect(),vp=nxFloatViewport();
  const width=Math.min(286,vp.w-16);
  const left=Math.max(8,Math.min(rect.left+(rect.width-width)/2,vp.w-width-8))-rect.left;
  const top=rect.bottom+70<=vp.h?rect.height+8:-66;
  await nxFloatCounts.setStyleAttribute(`position:absolute;left:${left}px;top:${top}px;width:${width}px;display:flex;align-items:center;justify-content:center;gap:6px;padding:6px;box-sizing:border-box;z-index:5;opacity:${nxFloatIdle?(nxFloatCollapsed?'.1':'0'):'1'};pointer-events:${nxFloatIdle?'none':'auto'};`);
}
async function nxFloatHitSurface(x,y) {
  if (!nxFloatRoot || nxFloatHidden || nxFloatBlocked()) return false;
  return await hitEl(nxFloatRoot,x,y) || !!(nxFloatCountsOpen && nxFloatCounts && await hitEl(nxFloatCounts,x,y));
}
async function nxFloatPaintChrome() {
  // Child visibility + idle fade. display/opacity are JS-owned (inline);
  // NX_FLOAT_CSS owns the rest.
  if (!nxFloatRoot) return;
  const mode = nxFloatMode(), collapsed = !!nxFloatCollapsed;
  const iconfold = mode === "bubble" && collapsed;
  // Prototype idle: chrome fades out, image only. Collapsed idle: 10% remains.
  const idleOp = nxFloatIdle ? (collapsed ? "0.1" : "0") : "1";
  const show = (el, css) => { try { return el.setStyleAttribute(css); } catch { return Promise.resolve(); } };
  if (iconfold) {
    // Prototype iconfold: bubble stays fully visible in idle (recovery handle).
    await show(nxFloatIcon, "display:block;");
    await show(nxFloatHead, "display:none;");
    await show(nxFloatStage, "display:none;");
    await show(nxFloatBar, "display:none;");
    await show(nxFloatResize, "display:none;");
    await show(nxFloatFoldGrip, "display:none;");
    await show(nxFloatFoldGrid, "display:none;");
    return;
  }
  await show(nxFloatIcon, "display:none;");
  if (collapsed) {
    await show(nxFloatHead, "display:none;");
    await show(nxFloatStage, "display:none;");
    await show(nxFloatBar, "display:none;");
    await show(nxFloatResize, "display:none;");
    await show(nxFloatFoldGrip, `display:flex;opacity:${idleOp};pointer-events:${nxFloatIdle ? "none" : "auto"};`);
    await show(nxFloatFoldGrid, `display:grid;opacity:${idleOp};`);
    try { if (nxFloatFoldBtn && nxFloatFoldBtn.setTextContent) await nxFloatFoldBtn.setTextContent("▾"); } catch {}
  } else {
    await show(nxFloatHead, `display:flex;opacity:${idleOp};`);
    await show(nxFloatStage, "display:flex;flex:1;min-height:0;align-items:center;justify-content:center;");
    await show(nxFloatBar, `display:flex;opacity:${idleOp};`);
    await show(nxFloatResize, `display:block;opacity:${idleOp};`);
    await show(nxFloatFoldGrip, "display:none;");
    await show(nxFloatFoldGrid, "display:none;");
    try { if (nxFloatFoldBtn && nxFloatFoldBtn.setTextContent) await nxFloatFoldBtn.setTextContent("▴"); } catch {}
  }
}
