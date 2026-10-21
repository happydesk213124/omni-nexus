// ‹ › and the dots: one message's illustrations, then the next message's. The dots
// come from what the position scan already read (no extra host work). Which
// message holds the next illustration comes from the chat text, read once per
// press: the baked token [[@inray::cardId::…]] is the record, the DOM only holds
// what Risu has rendered so far.
let nxFloatNavCache = null, nxFloatNavIds = [], nxFloatShotIndex = -1;
let nxFloatNavHold = null, nxFloatNavBusy = false, nxFloatLastTap = null;
let nxFloatNav = null;
const NX_FLOAT_NAV_FRESH_MS = 4000, NX_FLOAT_NAV_HOLD_MS = 1500, NX_FLOAT_DOTS_MAX = 8;
function nxFloatNavParse(chat) {
  const rows = chat?.message || chat?.messages;
  if (!Array.isArray(rows)) return null;
  const list = [];
  for (let index = 0; index < rows.length; index++) {
    const text = String(rows[index]?.data ?? rows[index]?.saying ?? '');
    if (!text.includes('[[@inray::')) continue;
    const ids = [...new Set([...text.matchAll(/\[\[@inray::([^:\]]+)::/g)].map(match => match[1]))];
    if (ids.length) list.push({index, ids});
  }
  return list;
}
// What is already known, without asking the host: the last press's read, or the
// chat the session scope copied when this chat opened. Good for dimming only.
function nxFloatNavKnown() {
  if (nxFloatNavCache?.session === nxFloatSession) return nxFloatNavCache.list;
  const scope = omniScope.scope;
  if (scope?.sessionId !== nxFloatSession || !scope.chat) return null;
  const list = nxFloatNavParse(scope.chat);
  if (list) nxFloatNavCache = {session: nxFloatSession, at: 0, list};
  return list;
}
async function nxFloatNavList() {
  const scope = await omniReadScope().catch(() => null);
  if (!scope?.sessionId || scope.sessionId !== nxFloatSession) return null;
  if (nxFloatNavCache?.session === scope.sessionId && Date.now() - nxFloatNavCache.at < NX_FLOAT_NAV_FRESH_MS) return nxFloatNavCache.list;
  if (!Number.isInteger(scope.charIndex) || !Number.isInteger(scope.chatIndex)) return null;
  const list = nxFloatNavParse(await k.getChatFromIndex?.(scope.charIndex, scope.chatIndex));
  if (!list || scope.sessionId !== nxFloatSession) return null;
  nxFloatNavCache = {session: scope.sessionId, at: Date.now(), list};
  return list;
}
function nxFloatNavWhere(list, id = nxFloatCardId) {
  const at = list.findIndex(row => row.ids.includes(id));
  return at >= 0 ? {at, pos: list[at].ids.indexOf(id)} : null;
}
function nxFloatNavStep(list, dir) {
  const here = nxFloatNavWhere(list);
  if (here) {
    const row = list[here.at], pos = here.pos + dir;
    if (pos >= 0 && pos < row.ids.length) return {index: row.index, id: row.ids[pos], ids: row.ids};
    const next = list[here.at + dir];
    return next ? {index: next.index, id: next.ids[dir > 0 ? 0 : next.ids.length - 1], ids: next.ids} : null;
  }
  // No illustration on screen yet: step from the message being read.
  const base = nxFloatShotIndex >= 0 ? nxFloatShotIndex : nxFloatReadingIndex;
  const next = dir > 0 ? list.find(row => row.index > base) : [...list].reverse().find(row => base < 0 || row.index < base);
  return next ? {index: next.index, id: next.ids[dir > 0 ? 0 : next.ids.length - 1], ids: next.ids} : null;
}
function nxFloatNavEdges() {
  const list = nxFloatNavKnown();
  if (!list || !nxFloatCardId || !nxFloatNavWhere(list)) return {prev: false, next: false};
  return {prev: !nxFloatNavStep(list, -1), next: !nxFloatNavStep(list, 1)};
}
// The dots name this message's illustrations: the chat text's order when it
// knows the picture, else what the scan saw.
function nxFloatNavShots(domIds) {
  const list = nxFloatNavKnown(), here = list && nxFloatNavWhere(list);
  nxFloatNavIds = here ? list[here.at].ids : (Array.isArray(domIds) && domIds.length ? domIds : nxFloatCardId ? [nxFloatCardId] : []);
}
async function nxFloatNavGo(dir) {
  if (nxFloatNavBusy || !nxFloatRoot) return;
  nxFloatNavBusy = true;
  try {
    const list = await nxFloatNavList();
    if (!list) return;
    const target = nxFloatNavStep(list, dir);
    if (!target) { await nxFloatApply(); return; }
    // The scan that follows the scroll must not snap back to a neighbour.
    nxFloatNavHold = {id: target.id, until: Date.now() + NX_FLOAT_NAV_HOLD_MS};
    if (!nxFloatFind(target.id)) {
      const scope = omniScope.scope;
      nxFloatSelectedCard = {id: target.id, session_id: nxFloatSession, character_id: scope?.characterId, chat_id: scope?.chatId, message_index: target.index};
    }
    await nxFloatSelect(target.id, '<div data-chat-index="' + target.index + '" data-chat-id="">');
    nxFloatNavIds = target.ids;
    await nxFloatApply();
    await nxFloatReveal(target.index, target.id);
  } catch (e) { nxFloatLog('nav', String(e?.message || e)); }
  finally { nxFloatNavBusy = false; }
}
// Scrolls the chat to that picture. A message Risu has not drawn yet is pulled
// in by showing the oldest one it has, a few times at most.
async function nxFloatReveal(index, id) {
  if (!Number.isInteger(index) || index < 0) return false;
  const safeId = /^[\w-]+$/.test(String(id || '')) ? String(id) : '';
  for (let attempt = 0; attempt < 12; attempt++) {
    const refs = omniDomScope();
    try {
      const h = await nxFloatChat(); if (!h) return false;
      refs.own(h.root); refs.own(h.body);
      const bubble = refs.own(await h.root.querySelector('.risu-chat[data-chat-index="' + index + '"]'));
      if (bubble) {
        const shot = safeId ? refs.own(await bubble.querySelector('[data-inlay-inline-shot="' + safeId + '"],[x-inlay-inline-shot="' + safeId + '"]')) : null;
        if (nxFloatNavHold?.id === id) nxFloatNavHold.until = Date.now() + NX_FLOAT_NAV_HOLD_MS;
        const before = await h.root.getBoundingClientRect();
        await (shot || bubble).scrollIntoView({block: 'center', inline: 'nearest'});
        // Near the chat's end the browser may push the whole page instead; undo it.
        const after = await h.root.getBoundingClientRect();
        if (Math.abs(after.top - before.top) > 1 || Math.abs(after.left - before.left) > 1) await h.doc.scrollIntoView?.({block: 'start', inline: 'start'});
        return true;
      }
      const rows = await h.root.querySelectorAll('.risu-chat'), count = await nxFloatArrayLength(rows);
      if (!count) return false;
      const ends = [0, count - 1].map(async slot => refs.own(Array.isArray(rows) ? rows[slot] : await rows.at(slot)));
      const [first, last] = await Promise.all(ends);
      if (!Array.isArray(rows)) await omniRelease(rows);
      const [a, b] = await Promise.all([first?.getBoundingClientRect(), last?.getBoundingClientRect()]);
      const oldest = !b || (a && a.top <= b.top) ? first : last;
      if (!oldest) return false;
      await oldest.scrollIntoView({block: 'start', inline: 'nearest'});
    } finally { await refs.close(); }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  return false;
}
async function nxFloatRevealCurrent() {
  if (!nxFloatCardId) return;
  const index = nxFloatShotIndex >= 0 ? nxFloatShotIndex : Number(nxFloatSelectedCard?.message_index ?? -1);
  nxFloatNavHold = {id: nxFloatCardId, until: Date.now() + NX_FLOAT_NAV_HOLD_MS};
  await nxFloatReveal(index, nxFloatCardId);
}
// Two taps on the picture within 400ms, in about the same place.
function nxFloatDoubleTap(pos) {
  const now = Date.now(), last = nxFloatLastTap;
  nxFloatLastTap = {at: now, x: pos.x, y: pos.y};
  if (!last || now - last.at > 400 || Math.hypot(pos.x - last.x, pos.y - last.y) > 32) return false;
  nxFloatLastTap = null;
  return true;
}
async function nxFloatPaintNav() {
  if (!nxFloatNav) return;
  const ids = nxFloatNavIds.length ? nxFloatNavIds : nxFloatCardId ? [nxFloatCardId] : [];
  const total = ids.length, pos = Math.max(0, ids.indexOf(nxFloatCardId));
  const count = total > 1 ? (pos + 1) + '/' + total : '';
  const dots = total > 1 && total <= NX_FLOAT_DOTS_MAX ? ids.map((_, i) => i === pos ? '●' : '○').join('') : '';
  const edges = nxFloatNavEdges();
  const writes = [
    nxFloatText(nxFloatNav.dots, dots), nxFloatText(nxFloatNav.count, count), nxFloatText(nxFloatNav.foldCount, count),
    nxFloatStyle(nxFloatNav.info, total > 1 ? 'display:flex;' : 'display:none;'),
    nxFloatStyle(nxFloatNav.dots, dots ? 'display:inline;' : 'display:none;'),
    nxFloatStyle(nxFloatNav.foldCount, count ? 'display:inline;' : 'display:none;'),
  ];
  const key = (edges.prev ? 'p' : '') + (edges.next ? 'n' : '');
  if (nxFloatNav.edges !== key) {
    nxFloatNav.edges = key;
    for (const node of [nxFloatNav.main, nxFloatNav.fold]) {
      writes.push(node.setAttribute('x-nx-float-prev-off', String(edges.prev)), node.setAttribute('x-nx-float-next-off', String(edges.next)));
    }
  }
  await Promise.all(writes);
}
async function nxFloatDropNav() {
  const nav = nxFloatNav; nxFloatNav = null;
  if (nav) for (const node of [nav.main, nav.info, nav.dots, nav.count, nav.fold, nav.foldCount]) await omniRelease(node);
  nxFloatNavIds = []; nxFloatShotIndex = -1; nxFloatNavHold = null; nxFloatLastTap = null;
}
