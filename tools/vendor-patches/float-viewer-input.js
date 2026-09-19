// Risu callbacks carry coordinates, not native event targets. All host reads
// go through SafeElement methods; only the selected image's URL is inspected.
let nxFloatInputs = [], nxFloatScanTimer = 0, nxFloatScanning = null;
let nxFloatScanAgain = false;
let nxFloatObserver = null, nxFloatDirty = true;
let nxFloatHoverPos = null, nxFloatHoverBusy = false;
async function nxFloatWatchChat(h) {
  if (await h.root.querySelector('[x-nx-float-watch]')) return;
  await nxFloatObserver?.disconnect();
  const marker = await H(h.doc, 'span', {style:'display:none;'});
  await marker.setAttribute('x-nx-float-watch', '1');
  await h.root.appendChild(marker);
  nxFloatObserver = await k.createMutationObserver(() => nxFloatScheduleScan());
  await nxFloatObserver.observe(h.root, {childList:true,subtree:true,attributes:true,attributeFilter:['src','data-inlay-inline-shot','x-inlay-inline-shot']});
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
    if (!pos || !await nxFloatHitSurface(pos.x,pos.y)) return;
    const buttons = await nxUnwrapSafeNodes(await nxFloatRoot.querySelectorAll('[x-nx-float-btn]'));
    for (const button of buttons) {
      if (await hitEl(button,pos.x,pos.y)) {
        await nxFloatClick(await button.getAttribute('x-nx-float-btn'));
        return;
      }
    }
  });
  await nxFloatListen(h.body, 'mousedown', async e => {
    const pos = nxFloatEvPos(e);
    if (!pos || nxFloatBlocked() || nxFloatHidden || !await hitEl(nxFloatRoot,pos.x,pos.y)) return;
    for (const [handle,kind] of [[nxFloatResize,'resize'],[nxFloatIcon,'bubble-move'],[nxFloatHead,'move'],[nxFloatFoldGrip,'move'],[nxFloatStage,'move']]) {
      if (await hitEl(handle,pos.x,pos.y)) { await nxFloatMaybeDrag(e,kind); return; }
    }
  });
  await nxFloatListen(h.body, 'mousemove', e => {
    const pos = nxFloatEvPos(e);
    if (!pos || nxFloatBlocked() || nxFloatHidden) return;
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
  }, 120);
}
async function nxFloatUnbindInputs() {
  nxFloatHoverPos = null;
  clearTimeout(nxFloatScanTimer); nxFloatScanTimer = 0;
  await nxFloatEndDrag(true);
  await nxFloatObserver?.disconnect(); nxFloatObserver = null;
  if (nxFloatDoc) {
    for (const node of await nxUnwrapSafeNodes(await nxFloatDoc.querySelectorAll('[x-nx-float-watch]'))) await node.remove();
  }
  for (const {node, kind, id, options} of nxFloatInputs.splice(0)) {
    try { await node.removeEventListener(kind, id, options); } catch {}
  }
  nxFloatMoveListener = null; nxFloatChatRoot = null; nxFloatDoc = null;
}
async function nxFloatScan() {
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
async function nxFloatReadPosition() {
  if (!nxFloatRoot || nxFloatBlocked() || nxFloatHidden || nxFloatDrag) return;
  nxFloatDirty = false;
  const epoch = nxFloatEpoch;
  const h = await nxFloatChat();
  if (!h) return;
  const sr = await h.root.getBoundingClientRect(), vp = nxFloatViewport();
  const top = Math.max(0, sr.top), bottom = Math.min(vp.h, sr.bottom);
  const readingY = top + (bottom - top) * .5;
  let best = null, distance = Infinity;
  const bubbles = await nxUnwrapSafeNodes(await h.root.querySelectorAll('.risu-chat'));
  for (const bubble of bubbles) {
    const br = await bubble.getBoundingClientRect();
    if (br.bottom <= top || br.top >= bottom || br.height <= 0) continue;
    const nodes = await nxUnwrapSafeNodes(await bubble.querySelectorAll('[x-inlay-inline-shot],[data-inlay-inline-shot]'));
    for (const node of nodes) {
      const rect = await node.getBoundingClientRect();
      if (!rect.height || rect.bottom <= top || rect.top >= bottom) continue;
      const gap = Math.abs((rect.top + rect.bottom) / 2 - readingY);
      if (gap >= distance) continue;
      const html = await node.getOuterHTML();
      const opening = html.slice(0, html.indexOf('>') + 1);
      const id = nxFloatHtmlAttr(opening, 'x-inlay-inline-shot') || nxFloatHtmlAttr(opening, 'data-inlay-inline-shot');
      if (!id || id.startsWith('pending_')) continue;
      best = {id, node, bubble, opening}; distance = gap;
    }
  }
  if (!best || epoch !== nxFloatEpoch || nxFloatBlocked()) return;
  const img = await best.node.querySelector('img');
  let src = '';
  if (img) {
    for (const key of ['currentSrc', 'src']) {
      try { src = String(await img.getProperty?.(key) || ''); } catch {}
      if (src) break;
    }
    if (!src) src = nxFloatHtmlAttr(await img.getOuterHTML(), 'src');
  }
  if (!src) src = nxFloatHtmlAttr(best.opening, 'data-src') || nxFloatHtmlAttr(best.opening, 'x-src');
  if (!src) src = /url\(["']?([^"')]+)["']?\)/.exec(nxFloatHtmlAttr(best.opening, 'style'))?.[1] || '';
  if (epoch !== nxFloatEpoch || nxFloatBlocked()) return;
  if (best.id === nxFloatCardId && (!src || src === nxFloatLastDomSrc)) return;
  const asset = nxFloatHtmlAttr(best.opening, 'x-inray-asset') || nxFloatHtmlAttr(best.opening, 'data-inray-asset');
  await nxFloatSelect(best.id, await best.bubble.getOuterHTML(), asset, src);
}
