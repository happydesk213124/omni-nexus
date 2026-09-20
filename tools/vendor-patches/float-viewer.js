// New floating single-shot viewer. Replaces the vendor galleryUi window entirely.
// Runs inside the UI closure: SafeElement access only. All `nxFloat*` names are
// unique to this module. Functions are hoisted declarations so rebuilt it(),
// marker-click and Vt can call them regardless of injection position.
//
// Look: 1:1 port of testfloatingprotype.html (iPhone glass, hidden header bar,
// bottom emoji bar, hover-only 🎲, 2x5 fold grid, 52px bubble).
// Pixels: resolve the real rendered URL from the
// current reading-position shot div itself (child <img> currentSrc/src, data-src/x-src/poster,
// style background url) and render an independent <img src>. Virtualization-
// proof; the blob cache is only a fallback when the DOM yields nothing.
// Drag/resize: mousedown on a handle, then
// mousemove/mouseup on the host body with coordinate math. No pointer capture
// (unreliable inside the Risu sandbox).
//
// SafeElement constraints (all learned the hard way):
// - setAttribute: x-* only. Selection/styling hooks are x-nx-float* attrs.
// - No classList: every state writes full inline cssText. The <style> block
//   below owns colors/buttons/pseudo/:hover only — never display or geometry.
const nxFloatKey = -1;
let nxFloatRoot = null, nxFloatHead = null, nxFloatStage = null, nxFloatBar = null;
let nxFloatFoldBtn = null, nxFloatResize = null, nxFloatFoldGrip = null, nxFloatFoldGrid = null;
let nxFloatIcon = null, nxFloatImgReroll = null, nxFloatCss = null;
let nxFloatDoc = null, nxFloatChatRoot = null, nxFloatMoveListener = null;
let nxFloatCardId = null, nxFloatAsset = null, nxFloatGen = 0, nxFloatLastUrl = "";
let nxFloatLastDomSrc = "", nxFloatCollapsed = null, nxFloatHidden = false;
let nxFloatGeo = null, nxFloatIconGeo = null, nxFloatImage = null;
let nxFloatEnsuring = null, nxFloatPainting = Promise.resolve(), nxFloatSelecting = 0;
let nxFloatSession = '', nxFloatEpoch = 0, nxFloatHovered = false, nxFloatSelectedCard = null;
let nxFloatViewportSize = {w: 360, h: 640};
let nxFloatLastError = '';
let nxFloatIdle = false, nxFloatIdleTimer = 0, nxFloatDrag = null;
function nxFloatLog(...a) { try { y("info", "float", a.join(" ")); } catch {} }
// Prototype CSS with x-attr selectors. display/geometry/opacity are JS-owned
// (inline cssText per state); this block never sets them with !important.
async function nxFloatChat() {
  const doc = t.hostDoc || await ue();
  if (!doc) return null;
  t.hostDoc = doc;
  const root = await doc.querySelector(".default-chat-screen");
  if (!root) return null;
  const body = await doc.querySelector("body");
  if (!body) return null;
  return { doc, root, body };
}
function nxFloatFind(id) {
  return (t._galleryCache?.sessionId === nxFloatSession && (t.gallery || []).find((c) => c && c.id === id))
    || (nxFloatSelectedCard?.id === id ? nxFloatSelectedCard : null);
}
function nxFloatViewport() { return nxFloatViewportSize; }
function nxFloatBlocked() {
  return t.unloading || t.uiOpen || t._hostChromeBlocked || t._viewerHiddenForModal || t._viewerHiddenForRisuSettings || t.backendSettings?.card?.floating_viewer === false;
}
async function nxFloatSetTarget(card, bubbleHtml, valid = () => true) {
  const scope = await Z({ useOverride: false }).catch(() => null);
  if (!valid() || scope?.sessionId !== nxFloatSession) return;
  const html = String(bubbleHtml || "");
  const chatIndex = Number(/data-chat-index="(\d+)"/.exec(html)?.[1] ?? NaN);
  const hostId = String(/data-chat-id="([^"]+)"/.exec(html)?.[1] || "");
  omniFooterTargets.set(nxFloatKey, {
    sessionId: card?.session_id || card?.sessionId || scope?.sessionId,
    characterId: card?.character_id || card?.characterId || scope?.characterId,
    chatId: card?.chat_id || card?.chatId || scope?.chatId,
    charIndex: scope?.charIndex ?? -1,
    chatIndex: scope?.chatIndex ?? -1,
    index: Number.isInteger(chatIndex) ? chatIndex : (card?.message_index ?? -1),
    hostId,
    _floatPin: 1
  });
}
async function nxFloatPaintImg(url) {
  if (!nxFloatImage) return;
  nxFloatLastUrl = String(url || '');
  const safe = nxFloatLastUrl.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  await nxFloatImage.setInnerHTML(safe ? '<img src="' + safe + '" style="width:100%;height:100%;object-fit:contain;display:block;pointer-events:none;" />' : '');
}
async function nxFloatPixels(card) {
  // Blob-cache fallback only: the DOM probe paints first when it finds pixels.
  const gen = ++nxFloatGen, id = card?.id;
  if (!id || !nxFloatStage) return;
  let url = "";
  try {
    const N = globalThis.__INLAY_NATIVE__;
    url = String(N?.resolveImageUrl?.(card) || card?.image_url || "");
  } catch { url = ""; }
  if (url && nxFloatCardId === id && gen === nxFloatGen) {
    await nxFloatPaintImg(url);
  }
  if (!url) {
    // Cache miss: keep previous pixels, fill in the background.
    try {
      const N = globalThis.__INLAY_NATIVE__;
      const fresh = String(await N?.ensureImageUrl?.(id) || "");
      if (fresh && nxFloatCardId === id && gen === nxFloatGen && nxFloatStage) {
        await nxFloatPaintImg(fresh);
      }
    } catch {}
  }
}
async function nxFloatSelect(id, bubbleHtml = '', asset = null, domSrc = '') {
  const token = ++nxFloatSelecting, epoch = nxFloatEpoch;
  let card = nxFloatFind(id);
  if (!card && !domSrc) return false;
  const changed = nxFloatCardId !== id;
  if (changed) {
    ++nxFloatGen;
    nxFloatLastDomSrc = '';
    await nxFloatPaintImg('');
  }
  if (token !== nxFloatSelecting || epoch !== nxFloatEpoch) return false;
  nxFloatCardId = id;
  nxFloatAsset = asset || null;
  // Older baked images can be outside the gallery's 120-card window. Their
  // stable id and owning message still support inspect/reroll actions.
  if (!card) {
    const scope=await Z({useOverride:false});
    if(token!==nxFloatSelecting || epoch!==nxFloatEpoch)return false;
    const index=Number(/data-chat-index="(\d+)"/.exec(bubbleHtml)?.[1]);
    card={id,session_id:nxFloatSession,character_id:scope.characterId,chat_id:scope.chatId,message_index:Number.isInteger(index)?index:undefined};
  }
  nxFloatSelectedCard = card;
  const index = (t.gallery || []).findIndex(c => c.id === id);
  if (index >= 0) t.viewerIndex = index;
  // The reading message target is independent of the displayed image.
  if (token !== nxFloatSelecting || epoch !== nxFloatEpoch) return false;
  if (domSrc) {
    ++nxFloatGen;
    nxFloatLastDomSrc = String(domSrc);
    if (domSrc !== nxFloatLastUrl) await nxFloatPaintImg(domSrc);
  } else if (changed || !nxFloatLastUrl) {
    // Storage hydration must not hold the mount/visibility queue hostage.
    void nxFloatPixels(card).catch(e => nxFloatLog('pixels', String(e)));
  }
  return true;
}
async function nxFloatShowCardId(id, bubbleHtml, asset, domSrc) {
  if (!await nxFloatEnsure() || !id) return false;
  return nxFloatSelect(id, bubbleHtml, asset, domSrc);
}
async function nxFloatShowCard(id) { return nxFloatShowCardId(id); }
async function nxFloatShowLatest() {
  if (!await nxFloatEnsure()) return false;
  const g = t.gallery || [];
  const card = g[t.viewerIndex] || g[g.length - 1];
  return card ? nxFloatSelect(card.id) : false;
}
async function nxFloatClick(kind) {
  if (!nxFloatRoot || nxFloatBlocked() || nxFloatHidden) return;
  nxFloatNudgeIdle();
  try {
    if (kind === 'counts') { await nxFloatToggleCounts(); return; }
    if (/^(min|max)-(up|down)$/.test(kind)) { await nxFloatChangeCount(kind); return; }
    if (kind === "fold") { await nxFloatSetCollapsed(true); return; }
    if (kind === "unfold") { await nxFloatSetCollapsed(false); return; }
    if (kind === "stop") { await omniFooterAction("stop", nxFloatKey); return; }
    if (kind === "single") { await nxFloatRerollOne(); return; }
    if (kind === "full") {
      const card = nxFloatFind(nxFloatCardId);
      if (!card) return;
      const open = t._nxInspectOpener;
      if (typeof open == "function") await open(card, nxFloatAsset || undefined);
      return;
    }
    if (kind === "tag" || kind === "regen" || kind === "char" || kind === "preset" || kind === "note") {
      await nxFloatScan();
      if (!omniFooterTargets.get(nxFloatKey)) {
        $e("화면에 보이는 채팅 메시지가 없습니다.");
        return;
      }
      await omniFooterAction(kind, nxFloatKey);
    }
  } catch (e) { y("error", "float.click", String(e?.message || e)); }
}
async function nxFloatRerollOne() {
  const id = nxFloatCardId;
  if (!id) return;
  const before = nxFloatFind(id);
  const epoch = nxFloatEpoch, session = nxFloatSession;
  const target = before ? {characterId:before.character_id,chatId:before.chat_id,index:before.message_index} : null;
  try {
    const current = await Z({useOverride:false});
    if (current?.sessionId !== session) return;
    const B = await withImageRerollToast("이미지 리롤 중…", async () => await K(
      "/v1/cards/" + encodeURIComponent(id) + "/reroll",
      { method: "POST", body: { mode: "nai", character_id:target?.characterId, chat_id:target?.chatId, message_index:target?.index } }, 18e4));
    if (B?.busy || B?.error?.code === "busy") throw new Error("지금은 바쁩니다. 잠시 뒤 다시 시도해 주세요.");
    try {
      const s = await Z({ useOverride: false }).catch(() => null);
      if (s?.sessionId !== session) return;
      await ce(session, true);
    } catch {}
    if (epoch !== nxFloatEpoch || nxFloatCardId !== id) return;
    const nid = String(B?.card?.id || id);
    nxFloatSelectedCard = {...before,...B?.card,id:nid,message_index:target?.index};
    nxFloatLastDomSrc = '';
    await nxFloatPaintImg('');
    await nxFloatSelect(nid);
    y("info", "float.reroll", `${String(id).slice(0, 8)}→${nid.slice(0, 8)}`);
  } catch (e) { y("error", "float.reroll", String(e?.message || e)); $e(String(e?.message || e)); }
}
function nxFloatNudgeIdle() {
  clearTimeout(nxFloatIdleTimer);
  nxFloatIdle = false;
  void nxFloatApply();
  nxFloatArmIdle();
}
function nxFloatArmIdle() {
  clearTimeout(nxFloatIdleTimer);
  nxFloatIdleTimer = setTimeout(() => {
    nxFloatIdleTimer = 0;
    if (nxFloatHovered || nxFloatDrag) return;
    nxFloatIdle = true;
    void nxFloatApply();
  }, 2000);
}
async function nxFloatEnsure() {
  if (nxFloatEnsuring) return nxFloatEnsuring;
  nxFloatEnsuring = nxFloatMount().then(result => {
    if (result) nxFloatLastError = '';
    return result;
  }).catch(error => {
    const message = String(error?.message || error);
    if (message !== nxFloatLastError) y('error', 'float.mount', message);
    nxFloatLastError = message;
    throw error;
  }).finally(() => { nxFloatEnsuring = null; });
  return nxFloatEnsuring;
}
async function nxFloatMount() {
  const on = (t.backendSettings?.card?.floating_viewer) !== !1;
  if (!on) { await nxFloatDispose(); return false; }
  if (nxFloatBlocked()) { await nxFloatHide(); return false; }
  const h = await nxFloatChat();
  if (!h) { await nxFloatHide(); return false; }
  // SafeDocument already wraps documentElement; its querySelector only searches descendants.
  const html = h.doc;
  const rect = await html.getBoundingClientRect();
  const chatRect = await h.root.getBoundingClientRect();
  let vw = 0, vh = 0;
  try { vw = Number(await html.getProperty('clientWidth')); vh = Number(await html.getProperty('clientHeight')); } catch {}
  const viewport = {w: Math.max(240, vw || rect.width || chatRect.right), h: Math.max(240, vh || chatRect.bottom || rect.height)};
  if (viewport.w !== nxFloatViewportSize.w || viewport.h !== nxFloatViewportSize.h) nxFloatDirty = true;
  nxFloatViewportSize = viewport;
  const scope = await Z({useOverride:false}).catch(() => null);
  if (!scope?.sessionId) { await nxFloatHide(); return false; }
  if (nxFloatSession !== scope.sessionId) {
    ++nxFloatEpoch; ++nxFloatGen; ++nxFloatSelecting;
    nxFloatSession = scope.sessionId;
    nxFloatDirty = true;
    nxFloatCardId = null; nxFloatSelectedCard = null; nxFloatAsset = null; nxFloatLastDomSrc = ''; nxFloatLastUrl = '';
    omniFooterTargets.delete(nxFloatKey);
    await nxFloatPaintImg('');
  }
  if (t._galleryCache?.sessionId !== scope.sessionId) await ce(scope.sessionId);
  if (nxFloatBlocked()) { await nxFloatHide(); return false; }
  // SafeElement wrappers do not preserve JS identity; use a DOM marker for remount detection.
  if (nxFloatRoot && !await h.doc.querySelector('[x-nx-float]')) await nxFloatDispose(false);
  if (!nxFloatRoot) {
    const mountEpoch = nxFloatEpoch;
    try { nxFloatGeo = await Aa(); } catch { nxFloatGeo = null; }
    try { nxFloatIconGeo = await loadViewerIconGeo(); } catch { nxFloatIconGeo = null; }
    if (nxFloatCollapsed == null) {
      try { nxFloatCollapsed = !!(await loadViewerMinimized()); } catch { nxFloatCollapsed = false; }
    }
    if (!nxFloatCss) {
      try {
        const st = await H(h.doc, "style", { text: NX_FLOAT_CSS });
        await st.setAttribute("x-nx-float-css", "1");
        await h.body.appendChild(st);
        nxFloatCss = st;
      } catch {}
    }
    const root = await H(h.doc, "div", {style:"display:none;"});
    await root.setAttribute("x-nx-float", "1");
    const icon = await H(h.doc, "div", { text: "⚛️" });
    await icon.setAttribute("x-nx-float-icon", "1");
    const head = await H(h.doc, "div", {});
    await head.setAttribute("x-nx-float-head", "1");
    const spanL = await H(h.doc, "span", {});
    await spanL.setAttribute("x-nx-float-headbtns", "l");
    const spanR = await H(h.doc, "span", {});
    await spanR.setAttribute("x-nx-float-headbtns", "r");
    const stage = await H(h.doc, "div", {});
    await stage.setAttribute("x-nx-float-body", "1");
    const pixels = await H(h.doc, 'div', {style:'width:100%;height:100%;min-height:0;display:flex;align-items:center;justify-content:center;'});
    const reroll = await H(h.doc, "button", { text: "🎲" });
    await reroll.setAttribute("x-nx-float-reroll", "1");
    await reroll.setAttribute("x-nx-float-btn", "single");
    const bar = await H(h.doc, "div", {});
    await bar.setAttribute("x-nx-float-bar", "1");
    const resize = await H(h.doc, "div", {});
    await resize.setAttribute("x-nx-float-resize", "1");
    const foldGrip = await H(h.doc, "div", { text: "⋯⋯" });
    await foldGrip.setAttribute("x-nx-float-foldgrip", "1");
    const foldGrid = await H(h.doc, "div", {});
    await foldGrid.setAttribute("x-nx-float-foldgrid", "1");
    await root.appendChild(icon);
    await root.appendChild(head);
    await head.appendChild(spanL);
    await head.appendChild(spanR);
    await root.appendChild(stage);
    await stage.appendChild(pixels);
    await stage.appendChild(reroll);
    nxFloatImage = pixels;
    await root.appendChild(bar);
    await root.appendChild(resize);
    await root.appendChild(foldGrip);
    await root.appendChild(foldGrid);
    await h.body.appendChild(root);
    nxFloatRoot = root; nxFloatHead = head; nxFloatStage = stage; nxFloatBar = bar;
    nxFloatResize = resize; nxFloatFoldGrip = foldGrip; nxFloatFoldGrid = foldGrid;
    nxFloatIcon = icon; nxFloatImgReroll = reroll;
    // Event routing is attached once to the host after all controls exist.
    const wireBtns = async (pairs, host) => {
      for (const [kind, glyph] of pairs) {
        const b = await H(h.doc, "button", { text: glyph });
        await b.setAttribute("x-nx-float-btn", kind);
        await host.appendChild(b);
        if (kind === "fold") nxFloatFoldBtn = b;
      }
    };
    await wireBtns(NX_FLOAT_HEAD_L, spanL);
    await wireBtns(NX_FLOAT_HEAD_R, spanR);
    await wireBtns(NX_FLOAT_BAR_BTNS, bar);
    await wireBtns(NX_FLOAT_GRID_BTNS, foldGrid);
    await nxFloatBindInputs(h);
    if (t.unloading || mountEpoch !== nxFloatEpoch || t.backendSettings?.card?.floating_viewer === false) {
      await nxFloatDispose();
      return false;
    }
    nxFloatArmIdle();
  }
  nxFloatHidden = !!nxFloatBlocked();
  if (!nxFloatBlocked()) {
    await nxFloatWatchChat(h);
    if (nxFloatDirty) await nxFloatScan();
    if (!nxFloatCardId && t._galleryCache?.sessionId === scope.sessionId) {
      const card = (t.gallery || []).at(-1);
      if (card) await nxFloatSelect(card.id);
    }
  }
  await nxFloatApply();
  return true;
}
async function nxFloatSetCollapsed(next) {
  nxFloatCollapsed = !!next;
  try { await saveViewerMinimized(nxFloatCollapsed); } catch {}
  t.viewerMinimized = !!next;
  await nxFloatApply();
}
async function nxFloatHide() {
  nxFloatHidden = true;
  nxFloatHovered = false;
  await nxFloatEndDrag(true);
  await nxFloatApply();
}
async function nxFloatShow() {
  nxFloatHidden = !!nxFloatBlocked();
  await nxFloatEnsure();
}
async function nxFloatDispose(resetSession = true) {
  ++nxFloatGen; ++nxFloatSelecting; ++nxFloatEpoch;
  await nxFloatUnbindInputs();
  clearTimeout(nxFloatIdleTimer);
  nxFloatIdleTimer = 0; nxFloatIdle = false; nxFloatHovered = false;
  await nxFloatPainting.catch(() => {});
  try { await nxFloatRoot?.remove(); await nxFloatCss?.remove(); } catch {}
  nxFloatCss = null; nxFloatRoot = null; nxFloatImage = null;
  nxFloatCounts = null; nxFloatCountsOpen = false;
  nxFloatHead = null; nxFloatStage = null; nxFloatBar = null;
  nxFloatFoldBtn = null; nxFloatResize = null; nxFloatFoldGrip = null; nxFloatFoldGrid = null;
  nxFloatIcon = null; nxFloatImgReroll = null;
  nxFloatCardId = null; nxFloatSelectedCard = null; nxFloatAsset = null; nxFloatLastDomSrc = ''; nxFloatLastUrl = '';
  if (resetSession) nxFloatSession = '';
  omniFooterTargets.delete(nxFloatKey);
}
// Console diagnostics (Risu devtools): __nxFloatState() dumps why it may not
// show; __nxFloatShow() force-shows the latest card, bypassing the probe.
globalThis.__nxFloatState = () => {
  try {
    return {
      floating_viewer: t.backendSettings?.card?.floating_viewer,
      lastError: nxFloatLastError,
      uiOpen: !!t.uiOpen, unloading: !!t.unloading,
      hiddenModal: !!t._viewerHiddenForModal, hiddenRisu: !!t._viewerHiddenForRisuSettings,
      hidden: !!nxFloatHidden, mounted: !!nxFloatRoot,
      probeBound: !!nxFloatMoveListener, gallery: (t.gallery || []).length,
      mode: nxFloatMode(), collapsed: !!nxFloatCollapsed,
      cardId: String(nxFloatCardId || "").slice(0, 8)
    };
  } catch (e) { return { error: String(e) }; }
};
globalThis.__nxFloatShow = () => {
  try { nxFloatShowLatest().catch((e) => nxFloatLog("manual show fail", String(e))); }
  catch (e) { try { y("warn", "float", "manual show " + String(e)); } catch {} }
};
