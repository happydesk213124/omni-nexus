// Keep the host's array lazy: unwrapping it would create a proxy per message.
let nxFloatBubbleList = null, nxFloatBubbleCount = 0, nxFloatReadingSlot = -1;
let nxFloatListParent = null, nxFloatScrollAt = null;
const nxFloatBubbleCache = new Map(), nxFloatBubbleWatches = new Map();
async function nxFloatArrayLength(rows) {
  return Array.isArray(rows) ? rows.length : Number(await rows?.length?.()) || 0;
}
async function nxFloatDropPosition() {
  for (const { observer, node } of nxFloatBubbleWatches.values()) {
    await observer.disconnect(); await omniRelease(observer); await omniRelease(node);
  }
  nxFloatBubbleWatches.clear(); nxFloatBubbleCache.clear();
  await omniRelease(nxFloatBubbleList); nxFloatBubbleList = null;
  await omniRelease(nxFloatListParent); nxFloatListParent = null;
  nxFloatBubbleCount = 0; nxFloatReadingSlot = -1; nxFloatScrollAt = null;
}
async function nxFloatBubbleAt(slot, refs) {
  if (slot < 0 || slot >= nxFloatBubbleCount) return null;
  return refs.own(Array.isArray(nxFloatBubbleList) ? nxFloatBubbleList[slot] : await nxFloatBubbleList.at(slot));
}
async function nxFloatRefreshPosition(h, refs) {
  await nxFloatDropPosition();
  nxFloatBubbleList = await h.root.querySelectorAll('.risu-chat');
  nxFloatBubbleCount = await nxFloatArrayLength(nxFloatBubbleList);
  const first = await nxFloatBubbleAt(0, refs);
  nxFloatListParent = await first?.getParent?.();
  // List membership changes are separate from mutations inside a message.
  await nxFloatObserver?.disconnect();
  await nxFloatObserver?.observe(h.root, {childList:true});
  if (nxFloatListParent) await nxFloatObserver?.observe(nxFloatListParent, {childList:true});
  nxFloatStructureDirty = false;
}
async function nxFloatWatchBubbles(rows, refs) {
  const slots = new Set(rows.map(row => row.slot));
  for (const [slot, watch] of nxFloatBubbleWatches) if (!slots.has(slot)) {
    nxFloatBubbleWatches.delete(slot); nxFloatBubbleCache.delete(slot);
    await watch.observer.disconnect(); await omniRelease(watch.observer); await omniRelease(watch.node);
  }
  for (const row of rows) {
    if (nxFloatBubbleWatches.has(row.slot)) continue;
    const epoch = nxFloatEpoch;
    const observer = await k.createMutationObserver(records => {
      void omniRelease(records);
      if (epoch !== nxFloatEpoch || nxFloatBubbleWatches.get(row.slot)?.observer !== observer) return;
      nxFloatBubbleCache.delete(row.slot);
      nxFloatScheduleScan();
    });
    try {
      await observer.observe(row.node, {childList:true,subtree:true,characterData:true,attributes:true,
        attributeFilter:['src','style','class','data-inlay-inline-shot','x-inlay-inline-shot']});
      nxFloatBubbleWatches.set(row.slot, {observer, node:refs.keep(row.node)});
    } catch (error) { await observer.disconnect(); await omniRelease(observer); throw error; }
  }
}
function nxFloatReadingGap(rect, y) { return Math.max(rect.top - y, y - rect.bottom, 0); }
async function nxFloatLocateReading(y, read) {
  const first = await read(0), last = await read(nxFloatBubbleCount - 1);
  if (!first || !last) return null;
  const forward = first.rect.top <= last.rect.top;
  let lo = 0, hi = nxFloatBubbleCount - 1, best = first, gap = nxFloatReadingGap(first.rect, y);
  for (let steps = 0; lo <= hi && steps < 24; steps++) {
    const mid = Math.floor((lo + hi) / 2), row = await read(mid);
    if (!row) break;
    const distance = nxFloatReadingGap(row.rect, y);
    if (distance < gap) { best = row; gap = distance; }
    if (row.rect.height > 0 && distance === 0) return row;
    if (forward ? row.rect.bottom < y : row.rect.top > y) lo = mid + 1;
    else hi = mid - 1;
  }
  return best;
}
async function nxFloatReadBubble(row, refs) {
  const cached = nxFloatBubbleCache.get(row.slot);
  if (cached && !cached.pending && cached.width === row.rect.width && cached.height === row.rect.height) return cached;
  const html = await row.node.getOuterHTML();
  const opening = html.slice(0, html.indexOf('>') + 1);
  const index = Number(nxFloatHtmlAttr(opening, 'data-chat-index') || -1);
  const hostId = nxFloatHtmlAttr(opening, 'data-chat-id');
  // Only identity survives in the cache, never the whole message's HTML/text.
  const bubbleHtml = '<div data-chat-index="' + index + '" data-chat-id="' + hostId.replace(/"/g, '&quot;') + '">';
  const shots = [];
  const nodes = await refs.all(await row.node.querySelectorAll('[x-inlay-inline-shot],[data-inlay-inline-shot]'));
  for (const node of nodes) {
    const rect = await node.getBoundingClientRect();
    if (!rect.height) continue;
    const shotHtml = await node.getOuterHTML(), head = shotHtml.slice(0, shotHtml.indexOf('>') + 1);
    const id = nxFloatHtmlAttr(head, 'x-inlay-inline-shot') || nxFloatHtmlAttr(head, 'data-inlay-inline-shot');
    if (!id || id.startsWith('pending_')) continue;
    const image = refs.own(await node.querySelector('img'));
    let src = '';
    if (image) {
      for (const key of ['currentSrc','src']) {
        try { src = String(await image.getProperty?.(key) || ''); } catch {}
        if (src) break;
      }
      if (!src) src = nxFloatHtmlAttr(await image.getOuterHTML(), 'src');
    }
    src ||= nxFloatHtmlAttr(head, 'data-src') || nxFloatHtmlAttr(head, 'x-src')
      || /url\(["']?([^"')]+)["']?\)/.exec(nxFloatHtmlAttr(head, 'style'))?.[1] || '';
    shots.push({id,src,asset:nxFloatHtmlAttr(head,'x-inray-asset') || nxFloatHtmlAttr(head,'data-inray-asset'),
      top:rect.top-row.rect.top,bottom:rect.bottom-row.rect.top});
  }
  const snapshot = {index,bubbleHtml,shots,width:row.rect.width,height:row.rect.height,pending:nodes.length>0 && !shots.length};
  nxFloatBubbleCache.set(row.slot, snapshot);
  return snapshot;
}
async function nxFloatReadPosition() {
  if (!nxFloatRoot || nxFloatBlocked() || nxFloatHidden || nxFloatDrag) return;
  nxFloatDirty = false;
  const scope = await omniReadScope();
  if (!scope || scope.sessionId !== nxFloatSession) return;
  omniPerf.viewerPasses++;
  const epoch = nxFloatEpoch, refs = omniDomScope();
  try {
    const h = await nxFloatChat(); if (!h) return;
    refs.own(h.root); refs.own(h.body);
    const sr = await h.root.getBoundingClientRect(), vp = nxFloatViewport();
    const top = Math.max(0,sr.top), bottom = Math.min(vp.h,sr.bottom), y = (top+bottom)/2;
    if (nxFloatStructureDirty || !nxFloatBubbleList) await nxFloatRefreshPosition(h,refs);
    const sampled = new Map();
    const read = async slot => {
      if (sampled.has(slot)) return sampled.get(slot);
      const node = await nxFloatBubbleAt(slot,refs); if (!node) return null;
      const row = {slot,node,rect:await node.getBoundingClientRect()}; sampled.set(slot,row); return row;
    };
    let scroll = null;
    try { const value = await h.root.getProperty?.('scrollTop'); if (value != null) scroll = Number(value); } catch {}
    const jump = scroll != null && nxFloatScrollAt != null && Math.abs(scroll-nxFloatScrollAt) >= Math.max(240,(bottom-top)*.7);
    nxFloatScrollAt = scroll;
    let anchor = null;
    if (!jump && nxFloatReadingSlot >= 0) {
      for (const slot of [nxFloatReadingSlot-1,nxFloatReadingSlot,nxFloatReadingSlot+1]) {
        const row = await read(slot);
        if (row && (!anchor || nxFloatReadingGap(row.rect,y)<nxFloatReadingGap(anchor.rect,y))) anchor = row;
      }
      // Short messages can cross several slots within a small pixel scroll.
      if (anchor && nxFloatReadingGap(anchor.rect,y) > 0) anchor = null;
    }
    if (!anchor && nxFloatBubbleCount) anchor = await nxFloatLocateReading(y,read);
    const rows = [];
    if (anchor) {
      nxFloatReadingSlot = anchor.slot;
      for (const slot of [anchor.slot-1,anchor.slot,anchor.slot+1]) { const row = await read(slot); if (row) rows.push(row); }
    }
    await nxFloatWatchBubbles(rows,refs);
    let best = null, distance = Infinity, reading = null, readingGap = Infinity;
    for (const row of rows) {
      if (epoch !== nxFloatEpoch) return;
      if (row.rect.height <= 0 || row.rect.bottom <= top || row.rect.top >= bottom) continue;
      const snapshot = await nxFloatReadBubble(row,refs), gap = nxFloatReadingGap(row.rect,y);
      if (gap < readingGap) { reading = snapshot; readingGap = gap; }
      for (const shot of snapshot.shots) {
        const shotTop = row.rect.top+shot.top, shotBottom = row.rect.top+shot.bottom;
        if (shotBottom <= top || shotTop >= bottom || !shot.src) continue;
        const d = Math.abs((shotTop+shotBottom)/2-y);
        if (d < distance) { best = {...shot,bubbleHtml:snapshot.bubbleHtml}; distance = d; }
      }
    }
    if (epoch !== nxFloatEpoch || nxFloatBlocked()) return;
    if (reading) {
      nxFloatReadingIndex = reading.index;
      await nxFloatSetTarget(null,reading.bubbleHtml,()=>epoch===nxFloatEpoch);
    } else omniFooterTargets.delete(nxFloatKey);
    // A local miss keeps the existing pixels without painting or a wider search.
    if (!best) return;
    if (best.id === nxFloatCardId && best.src === nxFloatLastDomSrc) return;
    await nxFloatSelect(best.id,best.bubbleHtml,best.asset,best.src);
  } finally { await refs.close(); }
}
