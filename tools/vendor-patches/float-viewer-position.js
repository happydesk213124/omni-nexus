// Where the chat's pictures are, read once and kept: a scroll asks Risu only where the list is now.
// Risu (DefaultChatScreen.svelte) scrolls .default-chat-screen; its message list (Chats.svelte, a div.flex-col-reverse)
// moves inside it, each message in its own div[x-hashed] that Risu swaps for a new one when the message changes
// (stream end, a bake, an edit). Read below the list's top, a picture's place holds while the chat scrolls and while
// a reply grows at the list's foot, so a scan is one pass (where the screen, the list and the picture on show are)
// and the rest is arithmetic. Every scan read the three messages around the middle before, a handle and a size each,
// five waits in a row. The pictures are read again, all in one pass, when the list changed and holds another number
// of them, when image history swaps one, or when the picture on show is not where it was read (older messages came
// in above it, a message grew).
let nxFloatListParent = null, nxFloatAnchor = null, nxFloatShots = null;
let nxFloatShotsDirty = false, nxFloatShotsStale = true, nxFloatListWatch = null, nxFloatShotWatch = null;
// Risu's sanitizer leaves a bake only its data- attributes; image history writes the picture it shows as x- ones.
const NX_FLOAT_SHOT = '[data-inlay-inline-shot]:not([data-inlay-inline-shot^="pending_"]),[x-inlay-inline-shot]:not([x-inlay-inline-shot^="pending_"])';
const NX_FLOAT_BUBBLE = '.risu-chat:has(' + NX_FLOAT_SHOT + ')';
async function nxFloatArrayLength(rows) {
  return Array.isArray(rows) ? rows.length : Number(await rows?.length?.()) || 0;
}
function nxFloatDropShots() {
  const shots = nxFloatShots; nxFloatShots = null;
  if (shots) for (const row of shots.rows) void omniRelease(row.node);
}
async function nxFloatDropPosition() {
  for (const watch of [nxFloatListWatch, nxFloatShotWatch]) if (watch) { await watch.disconnect(); await omniRelease(watch); }
  nxFloatListWatch = nxFloatShotWatch = null;
  nxFloatDropShots();
  await omniRelease(nxFloatAnchor); nxFloatAnchor = null;
  await omniRelease(nxFloatListParent); nxFloatListParent = null;
  nxFloatShotsStale = true; nxFloatShotsDirty = false;
}
// A scroll gesture's end counts the pictures again (two calls), so a list change the watch below missed is caught
// by the time the reader stops on it.
function nxFloatScrollEnded() { nxFloatShotsDirty = true; nxFloatScheduleScan(); }
// The list Risu draws messages into, heard for messages coming and going, and below it for image history's swaps.
async function nxFloatRefreshPosition(root) {
  await nxFloatDropPosition();
  // Asked together, so knowing the shape costs no extra round trip.
  const [first, wrapped] = await Promise.all([root.querySelector('.risu-chat'),
    Promise.resolve(root.querySelector('[x-hashed] > .risu-chat')).catch(() => null)]);
  await omniRelease(wrapped);
  let list = first ? await first.getParent?.() : null;
  // Risu (Chats.svelte) wraps each message in its own div[x-hashed] and swaps that
  // wrapper when the message changes (stream end, a bake). Watching the first
  // message's wrapper heard none of that; the list is the wrappers' parent.
  if (wrapped && list) {
    const wrapper = list;
    list = await wrapper.getParent?.();
    await omniRelease(wrapper);
  }
  nxFloatListParent = list || null;
  // Messages straight in the scrolled screen (no list of their own): the screen stays put, so places are read
  // against the first message, which scrolls with the rest.
  let flat = false;
  try { flat = !!list && !!await list.matches('.default-chat-screen'); } catch {}
  if (flat) nxFloatAnchor = first; else await omniRelease(first);
  nxFloatStructureDirty = false;
  if (!list) return;
  const epoch = nxFloatEpoch;
  nxFloatListWatch = await k.createMutationObserver(records => {
    void omniRelease(records);
    if (epoch === nxFloatEpoch) { nxFloatShotsDirty = true; nxFloatScheduleScan(); }
  });
  nxFloatShotWatch = await k.createMutationObserver(records => {
    void omniRelease(records);
    if (epoch === nxFloatEpoch) { nxFloatShotsStale = true; nxFloatScheduleScan(); }
  });
  // A message added, swapped or removed is the list's own children; a reply's text growing inside one is not heard.
  // Image history shows another picture by writing its x- attributes (image-history-runtime.js).
  await Promise.all([nxFloatListWatch.observe(list, {childList: true}),
    nxFloatShotWatch.observe(list, {subtree: true, attributes: true, attributeFilter: ['x-inlay-inline-shot', 'x-inray-asset']})]);
}
function nxFloatReadingGap(rect, y) { return Math.max(rect.top - y, y - rect.bottom, 0); }
// The message nearest the line y among `count` laid out in either order: a binary search reading only the rows it
// looks at, so a chat of hundreds costs a handful of calls.
async function nxFloatLocateReading(y, read, count) {
  const [first, last] = await Promise.all([read(0), read(count - 1)]);
  if (!first || !last) return null;
  const forward = first.rect.top <= last.rect.top;
  let lo = 0, hi = count - 1, best = first, gap = nxFloatReadingGap(first.rect, y);
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
// Only a message's identity is kept, never its HTML or text.
function nxFloatBubbleTag(index, hostId) {
  return '<div data-chat-index="' + index + '" data-chat-id="' + String(hostId || '').replace(/"/g, '&quot;') + '">';
}
const nxFloatRectOf = node => node ? Promise.resolve(node.getBoundingClientRect()).catch(() => null) : Promise.resolve(null);
const nxFloatGone = r => !r || (!r.width && !r.height);
// Every picture Risu has drawn, in one pass: where it is below the anchor, which picture it is, and the message it
// is in (its number and id, which the viewer's actions and dots go by). Each one's tag is read off a shallow copy,
// never its HTML: image history's picture is a data URL (image-history-runtime.js).
async function nxFloatMeasureShots(root, anchor) {
  const refs = omniDomScope();
  try {
    const [rawShots, rawBubbles] = await Promise.all([root.querySelectorAll(NX_FLOAT_SHOT), root.querySelectorAll(NX_FLOAT_BUBBLE)]);
    const [nodes, bubbles] = await Promise.all([refs.all(rawShots), refs.all(rawBubbles)]);
    const [at, rects, tags, bubbleRects, bubbleTags] = await Promise.all([nxFloatRectOf(anchor), Promise.all(nodes.map(nxFloatRectOf)),
      Promise.all(nodes.map(omniOpeningTag)), Promise.all(bubbles.map(nxFloatRectOf)), Promise.all(bubbles.map(omniOpeningTag))]);
    if (nxFloatGone(at)) return null;
    const messages = bubbles.map((_, i) => ({index: Number(nxFloatHtmlAttr(bubbleTags[i], 'data-chat-index') || -1),
      hostId: nxFloatHtmlAttr(bubbleTags[i], 'data-chat-id'), rect: bubbleRects[i], ids: []}));
    const rows = [];
    for (const [i, node] of nodes.entries()) {
      const r = rects[i], head = tags[i] || '';
      const id = nxFloatHtmlAttr(head, 'x-inlay-inline-shot') || nxFloatHtmlAttr(head, 'data-inlay-inline-shot');
      // Laid out with no height (folded away, hidden), it has no place to be shown at.
      if (!r?.height || !id || id.startsWith('pending_')) continue;
      const middle = (r.top + r.bottom) / 2;
      const message = messages.find(m => m.rect && middle >= m.rect.top && middle <= m.rect.bottom) || null;
      message?.ids.push(id);
      const asset = nxFloatHtmlAttr(head, 'x-inray-asset') || nxFloatHtmlAttr(head, 'data-inray-asset');
      rows.push({node: refs.keep(node), id, asset, key: id + '|' + asset, message, top: r.top - at.top, bottom: r.bottom - at.top});
    }
    return {rows, count: nodes.length, at};
  } finally { await refs.close(); }
}
// The same pictures moved (a message above them grew, a line's control was shown or hidden): only where each one is
// now is read, one call each in one pass. false when one is gone or hidden: they are all read again then.
async function nxFloatReplaceShots(shots, anchor) {
  const [at, rects] = await Promise.all([nxFloatRectOf(anchor), Promise.all(shots.rows.map(row => nxFloatRectOf(row.node)))]);
  if (nxFloatGone(at) || rects.some(r => !r?.height)) return false;
  shots.rows.forEach((row, i) => { row.top = rects[i].top - at.top; row.bottom = rects[i].bottom - at.top; });
  shots.at = at;
  return true;
}
function nxFloatNearest(rows, at, top, bottom, y) {
  let best = null, distance = Infinity;
  for (const row of rows) {
    if (row.dead) continue;
    const shotTop = at.top + row.top, shotBottom = at.top + row.bottom;
    if (shotBottom <= top || shotTop >= bottom) continue;
    const d = Math.abs((shotTop + shotBottom) / 2 - y);
    if (d < distance) { best = row; distance = d; }
  }
  return best;
}
async function nxFloatReadPosition() {
  if (!nxFloatRoot || nxFloatBlocked() || nxFloatHidden || nxFloatDrag) return;
  nxFloatDirty = false;
  const scope = await omniReadScope();
  if (!scope || scope.sessionId !== nxFloatSession) return;
  omniPerf.viewerPasses++;
  const epoch = nxFloatEpoch, refs = omniDomScope();
  try {
    // The chat screen the viewer watches (nxFloatWatchChat); asked for only while it has none.
    let root = nxFloatWatchRoot;
    if (!root) { const h = await nxFloatChat(); if (!h) return; root = refs.own(h.root); refs.own(h.body); }
    if (nxFloatStructureDirty || !nxFloatListParent) await nxFloatRefreshPosition(root);
    const anchor = nxFloatAnchor || nxFloatListParent;
    if (!anchor || epoch !== nxFloatEpoch) return;
    let shots = nxFloatShotsStale ? null : nxFloatShots;
    const shown = shots?.rows.find(row => row.key === nxFloatShownKey) || null, recount = !!shots && nxFloatShotsDirty;
    nxFloatShotsDirty = false;
    // One pass: the screen, the anchor, the picture on show (still where it was read?) and, once the list changed,
    // how many pictures it holds now.
    const [sr, at, shownAt, rawShots] = await Promise.all([nxFloatRectOf(root), nxFloatRectOf(anchor), nxFloatRectOf(shown?.node),
      recount ? Promise.resolve(root.querySelectorAll(NX_FLOAT_SHOT)).catch(() => null) : null]);
    const count = rawShots ? await nxFloatArrayLength(rawShots) : -1;
    await omniRelease(rawShots);
    if (epoch !== nxFloatEpoch) return;
    // The screen was drawn anew (another chat): the viewer is mounted on it again; the list was swapped: read again.
    if (nxFloatGone(sr)) { nxFloatStructureDirty = nxFloatDirty = true; void nxFloatEnsure().catch(() => {}); return; }
    if (nxFloatGone(at)) { nxFloatStructureDirty = true; nxFloatScheduleScan(); return; }
    const reread = async () => {
      nxFloatDropShots();
      const next = nxFloatShots = await nxFloatMeasureShots(root, anchor);
      if (next) nxFloatShotsStale = false;
      return next;
    };
    // All read again when the list holds another number of pictures (or none was read yet); only where they are when
    // the one on show moved, unless one of them is gone.
    let fresh = false, now = at;
    const moved = !!shown && (!shownAt?.height || Math.abs(shownAt.top - at.top - shown.top) > 2);
    if (!shots || (count >= 0 && count !== shots.count)) { shots = await reread(); fresh = true; }
    else if (moved) { if (!await nxFloatReplaceShots(shots, anchor)) shots = await reread(); fresh = true; }
    if (epoch !== nxFloatEpoch) return;
    if (!shots) { nxFloatStructureDirty = true; return; }
    if (fresh) now = shots.at;
    const vp = nxFloatViewport(), top = Math.max(0, sr.top), bottom = Math.min(vp.h, sr.bottom), y = (top + bottom) / 2;
    let best = nxFloatNearest(shots.rows, now, top, bottom, y);
    // A local miss keeps the existing pixels without painting or a wider search.
    if (!best || nxFloatBlocked()) return;
    // ‹ › or a double tap just chose a picture: the scroll it caused must not
    // swap it for a neighbour that ended up nearer the middle.
    if (nxFloatNavHold && Date.now() < nxFloatNavHold.until && best.id !== nxFloatNavHold.id) return;
    const ids = nxFloatNavIds.join('|');
    if (best.id === nxFloatCardId && best.key === nxFloatShownKey) {
      nxFloatNavShots(best.message?.ids);
      if (nxFloatNavIds.join('|') !== ids) await nxFloatApply();
      return;
    }
    // Another picture to show: is it where the reading has it (one call; where they all are is read if not)?
    if (!fresh) {
      const [a, r] = await Promise.all([nxFloatRectOf(anchor), nxFloatRectOf(best.node)]);
      if (epoch !== nxFloatEpoch) return;
      if (nxFloatGone(a) || !r?.height || Math.abs(r.top - a.top - best.top) > 2) {
        if (!await nxFloatReplaceShots(shots, anchor)) shots = await reread();
        if (epoch !== nxFloatEpoch) return;
        if (!shots) { nxFloatStructureDirty = true; return; }
        best = nxFloatNearest(shots.rows, shots.at, top, bottom, y);
        if (!best || (nxFloatNavHold && Date.now() < nxFloatNavHold.until && best.id !== nxFloatNavHold.id)) return;
        if (best.id === nxFloatCardId && best.key === nxFloatShownKey) { nxFloatNavShots(best.message?.ids); return; }
      }
    }
    const message = best.message;
    if (!await nxFloatSelect(best.id, message ? nxFloatBubbleTag(message.index, message.hostId) : '', best.asset, best)) return;
    nxFloatNavShots(message?.ids);
    await nxFloatApply();
  } finally { await refs.close(); }
}
// The message at the chat's reading line, for an action that goes by it (태그·재생성·노트·인물, ‹ › from a message
// with no picture): asked of Risu then, never on a scroll. Every scan found it before, the three messages around
// the middle read each time.
async function nxFloatReadTarget() {
  const scope = await omniReadScope().catch(() => null);
  if (!scope || scope.sessionId !== nxFloatSession) return null;
  const epoch = nxFloatEpoch, refs = omniDomScope();
  try {
    const h = await nxFloatChat(); if (!h) return null;
    refs.own(h.root); refs.own(h.body);
    const [sr, list] = await Promise.all([h.root.getBoundingClientRect(), h.root.querySelectorAll('.risu-chat')]);
    refs.own(list);
    const count = await nxFloatArrayLength(list), vp = nxFloatViewport();
    const y = (Math.max(0, sr.top) + Math.min(vp.h, sr.bottom)) / 2;
    // Keep the host's array lazy: unwrapping it would create a proxy per message.
    const read = async slot => {
      if (slot < 0 || slot >= count) return null;
      const node = refs.own(Array.isArray(list) ? list[slot] : await list.at(slot));
      return node ? {slot, node, rect: await node.getBoundingClientRect()} : null;
    };
    const row = count ? await nxFloatLocateReading(y, read, count) : null;
    if (epoch !== nxFloatEpoch) return null;
    if (!row) { omniFooterTargets.delete(nxFloatKey); return null; }
    const tag = await omniOpeningTag(row.node);
    const index = Number(nxFloatHtmlAttr(tag, 'data-chat-index') || -1);
    nxFloatReadingIndex = index;
    await nxFloatSetTarget(null, nxFloatBubbleTag(index, nxFloatHtmlAttr(tag, 'data-chat-id')), () => epoch === nxFloatEpoch);
    return omniFooterTargets.get(nxFloatKey) || null;
  } finally { await refs.close(); }
}
