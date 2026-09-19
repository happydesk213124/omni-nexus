// One body listener pair per gesture; hide/dispose always releases both.
let nxFloatDragListeners = [], nxFloatDragStarting = false;
function nxFloatEvPos(ev) {
  const x = ev?.clientX ?? ev?.pageX, y = ev?.clientY ?? ev?.pageY;
  return Number.isFinite(x) && Number.isFinite(y) ? {x, y} : null;
}
async function nxFloatMaybeDrag(ev, kind) {
  if (!nxFloatRoot || nxFloatBlocked() || nxFloatHidden || nxFloatDrag || nxFloatDragStarting || (ev?.button != null && ev.button !== 0)) return;
  const pos = nxFloatEvPos(ev);
  if (!pos) return;
  nxFloatDragStarting = true;
  try {
    const buttons = await nxUnwrapSafeNodes(await nxFloatRoot.querySelectorAll('[x-nx-float-btn]'));
    for (const button of buttons) if (await hitEl(button, pos.x, pos.y)) return;
    const h = await nxFloatChat();
    if (!h || nxFloatBlocked()) return;
    const rect = await nxFloatRoot.getBoundingClientRect();
    const geo = nxFloatGeo || {left:60,top:60,w:360,h:560};
    nxFloatDrag = {kind,sx:pos.x,sy:pos.y,left:rect.left,top:rect.top,w:nxFloatCollapsed ? geo.w : rect.width,h:nxFloatCollapsed ? geo.h : rect.height,moved:false};
    const move = await h.body.addEventListener('mousemove', e => {
      const p = nxFloatEvPos(e), d = nxFloatDrag;
      if (!p || !d) return;
      const dx = p.x - d.sx, dy = p.y - d.sy;
      if (Math.hypot(dx,dy) > 4) d.moved = true;
      if (!d.moved) return;
      if (kind === 'resize') nxFloatGeo = {left:d.left,top:d.top,w:Math.max(240,d.w+dx),h:Math.max(320,d.h+dy)};
      else if (kind === 'bubble-move') nxFloatIconGeo = {left:d.left+dx,top:d.top+dy};
      else nxFloatGeo = {...geo,left:d.left+dx,top:d.top+dy};
      void nxFloatApply();
    }, {capture:true});
    nxFloatDragListeners.push({node:h.body,kind:'mousemove',id:move});
    const up = await h.body.addEventListener('mouseup', () => { void nxFloatEndDrag(); }, {capture:true});
    nxFloatDragListeners.push({node:h.body,kind:'mouseup',id:up});
    nxFloatNudgeIdle();
  } finally { nxFloatDragStarting = false; }
}
async function nxFloatEndDrag(cancel = false) {
  const d = nxFloatDrag; nxFloatDrag = null;
  for (const {node,kind,id} of nxFloatDragListeners.splice(0)) {
    try { await node.removeEventListener(kind,id,{capture:true}); } catch {}
  }
  if (!d || cancel) return;
  await nxFloatPainting;
  const rect = await nxFloatRoot?.getBoundingClientRect();
  if (d.kind === 'bubble-move') {
    if (!d.moved) await nxFloatSetCollapsed(false);
    else if (rect) nxFloatIconGeo = await saveViewerIconGeo({left:rect.left,top:rect.top});
  } else if (d.moved && rect) {
    nxFloatGeo = {...nxFloatGeo,left:rect.left,top:rect.top};
    await qt(nxFloatGeo);
  }
  nxFloatArmIdle();
}
