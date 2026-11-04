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
let nxFloatIcon = null, nxFloatImgReroll = null, nxFloatCss = null, nxFloatButtons = [];
let nxFloatDoc = null, nxFloatChatRoot = null, nxFloatMoveListener = null;
let nxFloatCardId = null, nxFloatAsset = null, nxFloatGen = 0, nxFloatLastUrl = "";
// nxFloatShownKey: the chat picture copied in (id|asset), '' while the pixels came from the card's file instead.
let nxFloatShownKey = "", nxFloatCollapsed = null, nxFloatHidden = false;
let nxFloatCompact = false, nxFloatCompactBtn = null;
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
  if (!body) {await omniRelease(root);return null;}
  return { doc, root, body };
}
function nxFloatFind(id) {
  return (t._galleryCache?.sessionId === nxFloatSession && (t.gallery || []).find((c) => c && c.id === id))
    || (nxFloatSelectedCard?.id === id ? nxFloatSelectedCard : null);
}
function nxFloatViewport() { return nxFloatViewportSize; }
function nxFloatBlocked() {
  return t.unloading || t.uiOpen || t._nxHostInspectOpen || t._hostChromeBlocked || t._viewerHiddenForModal || t._viewerHiddenForRisuSettings || t.backendSettings?.card?.floating_viewer === false;
}
// TTS shares screen visibility, but never the illustration power/viewer setting.
globalThis.__OMNI_TTS_HOST_BLOCKED__ = () => !!(t.unloading || t.uiOpen || t._nxHostInspectOpen || t._hostChromeBlocked || t._viewerHiddenForModal || t._viewerHiddenForRisuSettings);
// 옴니 뷰어's 전체화면 is this same 크게보기 for a baked shot: its card id and file name,
// as the chat's ⛶ chip has them. false when it cannot open (the card is not in the gallery).
globalThis.__OMNI_INSPECT_SHOT__ = async (cardId, asset) => {
  const open = t._nxInspectOpener, find = () => (t.gallery || []).find((c) => String(c?.id || "") === String(cardId || ""));
  if (typeof open != "function" || t.uiOpen) { y("warn", "viewer.inspect", typeof open != "function" ? "no opener" : "settings open"); return false; }
  let card = find();
  // Not in the gallery as loaded (not loaded yet, or stale): this session's, read again once.
  if (!card) { try { const scope = await Z({ useOverride: false }); if (scope?.sessionId) await ce(scope.sessionId, true); } catch {} card = find(); }
  if (!card) { y("warn", "viewer.inspect", "card not in gallery " + String(cardId).slice(0, 12)); return false; }
  // A failed open closes again: left "open" with nothing on screen it holds every chat button and the floating viewer.
  try { await open(card, String(asset || ""), null); }
  catch (error) { y("warn", "viewer.inspect", String(error?.message || error)); await globalThis.__OMNI_INSPECT_CLOSE__?.(); return false; }
  return true;
};
globalThis.__OMNI_INSPECT_OPEN__ = () => !!t._nxHostInspectOpen;
// 옴니 뷰어's 🎲 리롤 and 🔮 샷 태그 수정 on its picture: what 크게보기's 🎲 and 🔮 do. true once done (the tag
// editor: once it closes), else why not, for the viewer to say: this window's toasts are under it, never seen.
// Its cast chips (c1·하쿠키): `who` is the chip's place and name, opened as 크게보기's chip opens that person's tags.
globalThis.__OMNI_SHOT_ACTION__ = async (act, cardId, who) => {
  const id = String(cardId || ""), find = (rows) => (Array.isArray(rows) ? rows : []).find((c) => String(c?.id || "") === id);
  if (act === "char") {
    const name = w(String(who?.name || ""), 200);
    if (!name) return "이 캐릭터를 찾지 못했습니다.";
    await ensureViewerRosterLoaded().catch(() => null);
    await Ua({ name, prompt: "", roster: Dt(name), index: Math.max(0, Math.floor(Number(who?.index) || 0)) });
    return true;
  }
  if (act === "base") {
    let card = find(t.gallery);
    // The strip holds the session's newest 120: an older reply's picture is looked up in the whole session.
    if (!card) try {
      const scope = await Z({ useOverride: false });
      if (scope?.sessionId) card = find(await ce(scope.sessionId, true)) || find((await K("/v1/gallery?session_id=" + encodeURIComponent(scope.sessionId) + "&limit=2000", { method: "GET" }))?.items);
    } catch {}
    if (!card) { y("warn", "viewer.shot", "card not in gallery " + id.slice(0, 12)); return "이 삽화를 갤러리에서 찾지 못했습니다."; }
    await openCardTagEdit(card); return true;
  }
  if (act !== "reroll") return false;
  // The card's id is all a reroll takes (the route reads nothing else): the gallery as loaded is not asked.
  try {
    const B = await withImageRerollToast("이미지 리롤 중…", async () => await K("/v1/cards/" + encodeURIComponent(id) + "/reroll", { method: "POST", body: { mode: "nai" } }, 18e4));
    if (B?.busy || B?.ok === false) return String(B?.error?.message || "지금은 리롤할 수 없습니다. 잠시 뒤 다시 시도해 주세요.");
    try { const scope = await Z({ useOverride: false }); if (scope?.sessionId) await ce(scope.sessionId, true); } catch {}
    return true;
  } catch (e) { y("error", "viewer.shot.reroll", String(e?.message || e)); return String(e?.message || e || "리롤하지 못했습니다."); }
};
// The shot-tag editor 🔮 opened is still up: the viewer waits for it to close, then takes its picture again.
globalThis.__OMNI_SHOT_TAGS_OPEN__ = () => !!t.cardTagUi;
// Closed from 옴니 뷰어: left open under the viewer, it holds every chat button and the floating viewer.
globalThis.__OMNI_INSPECT_CLOSE__ = async () => { if (t._nxHostInspectOpen && typeof t._nxInspectCloser == "function") await t._nxInspectCloser(); };
// A tap on the floating viewer (folding it, its arrows, its picture) is the viewer's, not the chat's beneath: TTS
// lines, pink slots and message gestures each hit-tested the chat under it, and TTS scanned the chat for it. Told
// from the frame the viewer keeps (nxFloatBounds), with no call.
globalThis.__OMNI_CHAT_COVER__?.((x, y) => { try { return !!nxFloatRoot && !nxFloatHidden && nxFloatContains(nxFloatBounds, x, y); } catch { return false; } });
function nxNotifyTtsVisibility() {
  const refresh = globalThis.__OMNI_TTS_REFRESH_VISIBILITY__;
  if (typeof refresh === 'function') refresh();
}
async function nxFloatSetTarget(card, bubbleHtml, valid = () => true) {
  const scope = await omniReadScope().catch(() => null);
  if (!valid() || scope?.sessionId !== nxFloatSession) return;
  const html = String(bubbleHtml || "");
  const chatIndex = Number(/data-chat-index="(\d+)"/.exec(html)?.[1] ?? NaN);
  const previous=omniFooterTargets.get(nxFloatKey);
  if(previous?.sessionId===scope.sessionId && previous.index===chatIndex && previous.hostId===String(/data-chat-id="([^\"]+)"/.exec(html)?.[1] || ""))return;
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
const NX_FLOAT_IMG_CSS = 'width:100%;height:100%;object-fit:contain;display:block;pointer-events:none;';
async function nxFloatPaintImg(url) {
  if (!nxFloatImage) return;
  nxFloatLastUrl = String(url || ''); nxFloatShownKey = '';
  const safe = nxFloatLastUrl.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  await nxFloatImage.setInnerHTML(safe ? '<img src="' + safe + '" style="' + NX_FLOAT_IMG_CSS + '" />' : '');
}
// The chat's own <img>, copied in: its src (a file, or image history's data URL) is never read nor written back, and
// nothing is parsed or sanitized (크게보기 shows a chat picture the same way, inspect-surface.js).
async function nxFloatPaintShot(shot) {
  if (!nxFloatImage) return false;
  const gen = nxFloatGen, img = await shot.node.querySelector('img');
  if (!img) { shot.dead = true; return false; }
  let copy = null;
  try { copy = await img.cloneNode(false); } finally { await omniRelease(img); }
  try {
    if (gen !== nxFloatGen || !nxFloatImage) return false;
    // Sent together and done by Risu in the order sent: the copy restyled, the old picture cleared, the copy put in.
    // (A paint overtaken meanwhile is cleared by the next one, sent after it.)
    await Promise.all([copy.setClassName(''), copy.setStyleAttribute(NX_FLOAT_IMG_CSS), nxFloatImage.setInnerHTML(''), nxFloatImage.appendChild(copy)]);
    nxFloatLastUrl = 'shot:' + shot.key; nxFloatShownKey = shot.key;
    return true;
  } finally { await omniRelease(copy); }
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
// shot: the chat's picture to copy (a row of nxFloatMeasureShots); without one the card's file is shown.
async function nxFloatSelect(id, bubbleHtml = '', asset = null, shot = null) {
  const token = ++nxFloatSelecting, epoch = nxFloatEpoch;
  let card = nxFloatFind(id);
  if (!card && !shot) return false;
  const changed = nxFloatCardId !== id;
  if (changed) {
    ++nxFloatGen;
    // A copy replaces the old picture itself; a card's file may take a while, and the old one must not stand for it.
    if (!shot) await nxFloatPaintImg('');
  }
  if (token !== nxFloatSelecting || epoch !== nxFloatEpoch) return false;
  nxFloatCardId = id;
  nxFloatAsset = asset || null;
  // Older baked images can be outside the gallery's 120-card window. Their
  // stable id and owning message still support inspect/reroll actions.
  if (!card) {
    const scope=await omniReadScope();
    if(token!==nxFloatSelecting || epoch!==nxFloatEpoch)return false;
    const index=Number(/data-chat-index="(\d+)"/.exec(bubbleHtml)?.[1]);
    card={id,session_id:nxFloatSession,character_id:scope.characterId,chat_id:scope.chatId,message_index:Number.isInteger(index)?index:undefined};
  }
  nxFloatSelectedCard = card;
  const shotIndex = Number(/data-chat-index="(\d+)"/.exec(bubbleHtml)?.[1] ?? card.message_index ?? -1);
  nxFloatShotIndex = Number.isInteger(shotIndex) ? shotIndex : -1;
  if (changed) nxFloatNavShots(null);
  const index = (t.gallery || []).findIndex(c => c.id === id);
  if (index >= 0) t.viewerIndex = index;
  // The reading message target is independent of the displayed image.
  if (token !== nxFloatSelecting || epoch !== nxFloatEpoch) return false;
  if (shot) {
    ++nxFloatGen;
    if (shot.key === nxFloatShownKey || await nxFloatPaintShot(shot)) return true;
    if (token !== nxFloatSelecting || epoch !== nxFloatEpoch) return false;
    // No <img> in it to copy: the card's file.
    void nxFloatPixels(card).catch(e => nxFloatLog('pixels', String(e)));
  } else if (changed || !nxFloatLastUrl) {
    // Storage hydration must not hold the mount/visibility queue hostage.
    void nxFloatPixels(card).catch(e => nxFloatLog('pixels', String(e)));
  }
  return true;
}
async function nxFloatShowCardId(id) {
  if (!await nxFloatEnsure() || !id) return false;
  return nxFloatSelect(id);
}
async function nxFloatShowCard(id) { return nxFloatShowCardId(id); }
async function nxFloatShowLatest() {
  if (!await nxFloatEnsure()) return false;
  const g = t.gallery || [];
  const card = g[t.viewerIndex] || g[g.length - 1];
  return card ? nxFloatSelect(card.id) : false;
}
async function nxFloatClick(kind) {
  if (!nxFloatRoot || t._nxHostInspectOpen || nxFloatBlocked() || nxFloatHidden) return;
  nxFloatNudgeIdle();
  try {
    if (kind === 'compact') { nxFloatCompact = !nxFloatCompact; await nxFloatApply(); return; }
    if (kind === 'counts') { await nxFloatToggleCounts(); return; }
    if (/^(min|max)-(up|down)$/.test(kind)) { await nxFloatChangeCount(kind); return; }
    if (kind === "prev" || kind === "next") { await nxFloatNavGo(kind === "next" ? 1 : -1); return; }
    if (kind === "fold") { await nxFloatSetCollapsed(true); return; }
    if (kind === "unfold") { await nxFloatSetCollapsed(false); return; }
    if (kind === "stop") { await omniFooterAction("stop", nxFloatKey); return; }
    if (kind === "single") { await nxFloatRerollOne(); return; }
    // 인물 looks for the names of the message being read: which one that is, is asked now (no scroll asks it).
    if(kind === "char") await nxFloatReadTarget().catch(() => null);
    if(kind === "char" || kind === "preset") {await omniFooterAction(kind,nxFloatKey);return;}
    if (kind === "full") {
      const card = nxFloatFind(nxFloatCardId);
      if (!card) return;
      const open = t._nxInspectOpener;
      if (typeof open == "function") await open(card, nxFloatAsset || undefined, nxFloatImage);
      return;
    }
    if (kind === "tag" || kind === "regen" || kind === "note") {
      // The message being read, asked now: the scroll scans look for pictures only.
      await nxFloatReadTarget();
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
    await nxFloatPaintImg('');
    await nxFloatSelect(nid);
    y("info", "float.reroll", `${String(id).slice(0, 8)}→${nid.slice(0, 8)}`);
  } catch (e) { y("error", "float.reroll", String(e?.message || e)); $e(String(e?.message || e)); }
}
function nxFloatNudgeIdle() {
  clearTimeout(nxFloatIdleTimer);
  if(nxFloatIdle){nxFloatIdle = false;void nxFloatApply();}
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
  const perfAt = Date.now(), perf = [];
  const mark = (step) => perf.push(`${step}=${Date.now() - perfAt}`);
  try { return await nxFloatMountTimed(mark); }
  finally {
    const total = Date.now() - perfAt;
    omniPerf.lastMount = `${perf.join(' ')} total=${total}`;
    if (total >= 250) nxFloatLog('mount.timing', omniPerf.lastMount);
  }
}
async function nxFloatMountTimed(mark) {
  const on = (t.backendSettings?.card?.floating_viewer) !== !1;
  if (!on) { await nxFloatDispose(); return false; }
  if (nxFloatBlocked()) { await nxFloatHide(); return false; }
  const h = await nxFloatChat();
  mark('chat');
  if (!h) { await nxFloatHide(); return false; }
  try {
  // SafeDocument already wraps documentElement; its querySelector only searches descendants.
  const html = h.doc;
  const rect = await html.getBoundingClientRect();
  const chatRect = await h.root.getBoundingClientRect();
  let vw = 0, vh = 0;
  try { [vw,vh] = await Promise.all([html.clientWidth(),html.clientHeight()]); } catch {}
  const viewport = {w: Math.max(240, vw || rect.width || chatRect.right), h: Math.max(240, vh || chatRect.bottom || rect.height)};
  if (viewport.w !== nxFloatViewportSize.w || viewport.h !== nxFloatViewportSize.h) nxFloatDirty = true;
  nxFloatViewportSize = viewport;
  mark('rect');
  const scope = await omniReadScope().catch(() => null);
  mark('scope');
  if (!scope?.sessionId) { await nxFloatHide(); return false; }
  if (nxFloatSession !== scope.sessionId) {
    ++nxFloatEpoch; ++nxFloatGen; ++nxFloatSelecting;
    nxFloatSession = scope.sessionId;
    nxFloatDirty = true;
    nxFloatStructureDirty = true; nxFloatReadingIndex = -1;
    nxFloatCardId = null; nxFloatSelectedCard = null; nxFloatAsset = null; nxFloatShownKey = ''; nxFloatLastUrl = '';
    nxFloatNavIds = []; nxFloatShotIndex = -1; nxFloatNavHold = null;
    omniFooterTargets.delete(nxFloatKey);
    await nxFloatPaintImg('');
  }
  if (nxFloatBlocked()) { await nxFloatHide(); return false; }
  // SafeElement wrappers do not preserve JS identity; use a DOM marker for remount detection.
  if(nxFloatRoot){const mounted=await h.doc.querySelector('[x-nx-float]');try{if(!mounted)await nxFloatDispose(false);}finally{await omniRelease(mounted);}}
  mark(nxFloatRoot ? 'kept' : 'gone');
  if (!nxFloatRoot) {
    const mountEpoch = nxFloatEpoch;
    const [geo,iconGeo,minimized]=await Promise.all([
      Aa().catch(()=>null),loadViewerIconGeo().catch(()=>null),
      nxFloatCollapsed==null?loadViewerMinimized().catch(()=>false):Promise.resolve(nxFloatCollapsed),
    ]);
    nxFloatGeo=geo;nxFloatIconGeo=iconGeo;nxFloatCollapsed=!!minimized;
    // Every node crosses the bridge at once and each parent keeps its own child
    // order. A slow host (RisuNest: ~1.4s) pays a few round trips here, not ~40.
    const cssReady = nxFloatCss ? Promise.resolve() : (async () => {
      try {
        const st = await H(h.doc, "style", { text: NX_FLOAT_CSS });
        await st.setAttribute("x-nx-float-css", "1");
        await h.body.appendChild(st);
        nxFloatCss = st;
      } catch {}
    })();
    const make = async (tag, props, attrs = []) => {
      const node = await H(h.doc, tag, props);
      await Promise.all(attrs.map(([name, value]) => node.setAttribute(name, value)));
      return node;
    };
    const [root, icon, head, spanL, spanR, stage, pixels, reroll, bar, resize, foldGrip, gripLabel, foldGrid] = await Promise.all([
      make("div", {style:"display:none;"}, [["x-nx-float", "1"]]),
      make("div", { text: "⚛️" }, [["x-nx-float-icon", "1"]]),
      make("div", {}, [["x-nx-float-head", "1"]]),
      make("span", {}, [["x-nx-float-headbtns", "l"]]),
      make("span", {}, [["x-nx-float-headbtns", "r"]]),
      make("div", {}, [["x-nx-float-body", "1"]]),
      make('div', {style:'width:100%;height:100%;min-height:0;display:flex;align-items:center;justify-content:center;'}),
      make("button", { text: "🎲" }, [["x-nx-float-reroll", "1"], ["x-nx-float-btn", "single"]]),
      make("div", {}, [["x-nx-float-bar", "1"]]),
      make("div", {}, [["x-nx-float-resize", "1"]]),
      make("div", {}, [["x-nx-float-foldgrip", "1"]]),
      make("span", { text: "⋯⋯", style: 'line-height:20px;' }),
      make("div", {}, [["x-nx-float-foldgrid", "1"]]),
    ]);
    // ‹ › with this message's dots: bottom right when open, beside the grip when folded.
    const [navMain, navInfo, navDots, navCount, navBtns, navFold, navFoldCount] = await Promise.all([
      make("div", {style:"display:none;"}, [["x-nx-float-nav", "main"]]),
      make("div", {style:"display:none;"}, [["x-nx-float-navinfo", "1"]]),
      make("span", {}, [["x-nx-float-dots", "1"]]),
      make("span", {}, [["x-nx-float-count", "1"]]),
      make("div", {}, [["x-nx-float-navbtns", "1"]]),
      make("div", {style:"display:none;"}, [["x-nx-float-nav", "fold"]]),
      make("span", {style:"display:none;"}, [["x-nx-float-count", "1"]]),
    ]);
    const chain = async (parent, kids) => { for (const kid of kids) await parent.appendChild(kid); };
    await Promise.all([
      chain(root, [icon, head, stage, bar, navMain, resize, foldGrip, foldGrid]),
      chain(head, [spanL, spanR]), chain(stage, [pixels]), chain(spanL, [reroll]), chain(foldGrip, [gripLabel, navFold]),
      chain(navMain, [navInfo, navBtns]), chain(navInfo, [navDots, navCount]), chain(navFold, [navFoldCount]),
    ]);
    await omniRelease(gripLabel);
    nxFloatImage = pixels;
    // The style sheet precedes the viewer, as before, so it never paints unstyled.
    await cssReady;
    await h.body.appendChild(root);
    nxFloatRoot = root; nxFloatHead = head; nxFloatStage = stage; nxFloatBar = bar;
    nxFloatResize = resize; nxFloatFoldGrip = foldGrip; nxFloatFoldGrid = foldGrid;
    nxFloatIcon = icon; nxFloatImgReroll = reroll;
    // Every button's handle is kept: where each one is gets read once the layout changes (nxFloatMeasureHits), and a
    // press or a tap is told from that with no call.
    nxFloatButtons = [{kind: 'single', node: reroll}];
    nxFloatNav = {main: navMain, info: navInfo, dots: navDots, count: navCount, fold: navFold, foldCount: navFoldCount, edges: null};
    // Event routing is attached once to the host after all controls exist.
    const wireBtns = async (pairs, host) => {
      // Independent button creation crosses the bridge together; insertion
      // remains ordered within each row.
      const nodes=await Promise.all(pairs.map(async([kind,glyph])=>{
        const button=await H(h.doc,'button',{text:glyph});
        await button.setAttribute('x-nx-float-btn',kind);return button;
      }));
      for (let index=0;index<nodes.length;index++) {
        const b=nodes[index],kind=pairs[index][0];
        await host.appendChild(b);
        if (kind === "fold") nxFloatFoldBtn = b;
        if (kind === "compact" && host === foldGrip) nxFloatCompactBtn = b;
        nxFloatButtons.push({kind, node: b});
      }
    };
    await Promise.all([
      wireBtns(NX_FLOAT_HEAD_L,spanL),wireBtns(NX_FLOAT_HEAD_R,spanR),
      wireBtns(NX_FLOAT_BAR_BTNS,bar),wireBtns(NX_FLOAT_GRID_BTNS,foldGrid),
      wireBtns([["compact","−"]],foldGrip),
      wireBtns(NX_FLOAT_NAV_BTNS,navBtns),wireBtns(NX_FLOAT_NAV_BTNS,navFold),
    ]);
    await omniRelease(spanL);await omniRelease(spanR);await omniRelease(navBtns);
    await nxFloatBindInputs(h);
    if (t.unloading || mountEpoch !== nxFloatEpoch || t.backendSettings?.card?.floating_viewer === false) {
      await nxFloatDispose();
      return false;
    }
    nxFloatArmIdle();
  }
  mark('built');
  nxFloatHidden = !!nxFloatBlocked();
  // The frame must be visible before position reads; pixels need no gallery.
  await nxFloatApply();
  mark('shown');
  if (!nxFloatBlocked()) {
    await nxFloatWatchChat(h);
    mark('watch');
    if (nxFloatDirty) { await nxFloatScan(); mark('scan'); }
  }
  return true;
  } finally {if(h.root!==nxFloatWatchRoot)await omniRelease(h.root);if(h.body!==nxFloatChatRoot)await omniRelease(h.body);}
}
let nxFloatFoldWrites=Promise.resolve();
async function nxFloatSetCollapsed(next) {
  nxFloatCollapsed = !!next;
  t.viewerMinimized = !!next;
  await nxFloatApply();
  const value=!!next;
  nxFloatFoldWrites=nxFloatFoldWrites.catch(()=>{}).then(()=>saveViewerMinimized(value)).catch(error=>nxFloatLog('fold.save',String(error)));
}
async function nxFloatHide() {
  nxNotifyTtsVisibility();
  nxFloatHidden = true;
  nxFloatHovered = false;
  await nxFloatEndDrag(true);
  await nxFloatApply();
}
async function nxFloatShow() {
  nxNotifyTtsVisibility();
  nxFloatHidden = !!nxFloatBlocked();
  await nxFloatEnsure();
}
async function nxFloatDispose(resetSession = true) {
  ++nxFloatGen; ++nxFloatSelecting; ++nxFloatEpoch;
  await nxFloatUnbindInputs();
  await nxFloatDropNav();
  clearTimeout(nxFloatIdleTimer);
  nxFloatIdleTimer = 0; nxFloatIdle = false; nxFloatHovered = false;
  await nxFloatPainting.catch(() => {});
  try { await nxFloatRoot?.remove(); await nxFloatCss?.remove(); } catch {}
  for(const ref of new Set([nxFloatCss,nxFloatRoot,nxFloatImage,nxFloatCounts,nxFloatHead,nxFloatStage,nxFloatBar,nxFloatFoldBtn,nxFloatResize,nxFloatFoldGrip,nxFloatFoldGrid,nxFloatIcon,nxFloatImgReroll,nxFloatCompactBtn,...nxFloatButtons.map(b=>b.node)]))await omniRelease(ref);
  clearTimeout(nxFloatHitTimer); nxFloatButtons = []; nxFloatHitCache = null; nxFloatHitKey = '';
  nxFloatReadingIndex=-1;nxFloatStructureDirty=true;
  nxFloatBounds = null;
  nxFloatCss = null; nxFloatRoot = null; nxFloatImage = null;
  nxFloatCounts = null; nxFloatCountsOpen = false;
  nxFloatCountBounds=null;nxFloatCountsPaintKey='';
  nxFloatHead = null; nxFloatStage = null; nxFloatBar = null;
  nxFloatFoldBtn = null; nxFloatResize = null; nxFloatFoldGrip = null; nxFloatFoldGrid = null;
  nxFloatIcon = null; nxFloatImgReroll = null;
  nxFloatCompactBtn = null;
  nxFloatCardId = null; nxFloatSelectedCard = null; nxFloatAsset = null; nxFloatShownKey = ''; nxFloatLastUrl = '';
  if (resetSession) { nxFloatSession = ''; nxFloatCompact = false; }
  omniFooterTargets.delete(nxFloatKey);
}
// Console diagnostics (Risu devtools): __nxFloatState() dumps why it may not
// show; __nxFloatShow() force-shows the latest card, bypassing the probe.
globalThis.__nxFloatState = () => {
  try {
    return {
      performance: {...omniPerf,scopePending:!!omniScope.pending},
      floating_viewer: t.backendSettings?.card?.floating_viewer,
      lastError: nxFloatLastError,
      uiOpen: !!t.uiOpen, unloading: !!t.unloading,
      hiddenModal: !!t._viewerHiddenForModal, hiddenRisu: !!t._viewerHiddenForRisuSettings,
      hidden: !!nxFloatHidden, mounted: !!nxFloatRoot,
      probeBound: !!nxFloatMoveListener, gallery: (t.gallery || []).length,
      mode: nxFloatMode(), collapsed: !!nxFloatCollapsed, compact: nxFloatCompact,
      cardId: String(nxFloatCardId || "").slice(0, 8)
    };
  } catch (e) { return { error: String(e) }; }
};
globalThis.__nxFloatShow = () => {
  try { nxFloatShowLatest().catch((e) => nxFloatLog("manual show fail", String(e))); }
  catch (e) { try { y("warn", "float", "manual show " + String(e)); } catch {} }
};
