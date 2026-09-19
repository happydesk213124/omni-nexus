import test from "node:test";
import assert from "node:assert/strict";

import {
  activeSegmentIndex,
  clampPinPercent,
  clampReadingPercent,
  createDebouncedSaveQueue,
  createScrollPhaseBus,
  createScrollSettleTracker,
  isScrollHoldLatest,
  pickScrollHoldAnchor,
  scrollHoldDelta,
  scrollHoldOffset,
  shouldHoldScroll,
  createSessionChangeGuard,
  evenAnchorPercent,
  findHashRebindCandidates,
  findCardsForMessageIdentity,
  jobMatchesMessageIdentity,
  canRetargetJobSaveHash,
  stickySegChanged,
  galleryFocusMessage,
  galleryForMessage,
  gallerySelectedCount,
  linkCardsForMessage,
  hostMessageId,
  stripInlayInlineHtml,
  keepMsgActionBarIndexes,
  isInlayPaintHost,
  msgActionMountKind,
  msgActionBarPlace,
  canMountMsgActionOnParent,
  isMessageBodyHostTag,
  normalizeInlineMsgActions,
  inlineMsgActionsOn,
  inlineMsgActionsLegacy,
  splitMessageLines,
  clampShotLine,
  htmlToPlainLn,
  findPlainLineStartOffset,
  findPlainLineEndOffset,
  injectInlineImagesIntoHtml,
  normalizeInlineChatTextSide,
  markerBlockHtml,
  lineTextOccurrence,
  findElementIndexForLine,
  preferNearbyHostIndex,
  findElementIndexForLineWithFallback,
  prefixMatchRatio,
  clickSelectTracksEnabled,
  DOUBLE_SELECT_WINDOW_MS,
  isMessageSelectionGesture,
  normalizeSelectionGesture,
  pickMessageIndexNearPoint,
  pinPercentToPx,
  pinPercentToPxFromBottom,
  pinPxToPercent,
  mergeViewerPaintJob,
  readingPercentInMessage,
  resolveCardAnchorPercent,
  resolveClickSelectionAction,
  messageClickScrollDelta,
  resolveStoredPinPercent,
  scaleInlineThumbnail,
  shouldRefreshGallery,
  shouldRewriteStickyThumb,
  claimStickyMarkerByCardId,
  shouldKeepStickyThumbHidden,
  resolveStickyThumbPct,
  stickyThumbBoxFromPct,
  stickySegmentForInlineChat,
  markerAnchorClientPoint,
  nearestSegmentByClientPoint,
  fitBoxInside,
  composeStickyThumbHtml,
  stickyThumbNeedsHtmlPaint,
  stickyThumbSizeForImage,
  stickyThumbStyleWithSize,
  probeDataUrlPixelSize,
  stickyCornerImageBox,
  stickyCornerEdgeBox,
  stickyPinEdgeBox,
  stickyPinOverImage,
  stickyV2AnchorSide,
  stickyV2CountCluster,
  stickyV2FreeLayout,
  stickyV2CornerLayout,
  stickyV2ShotCounts,
  composeStickyV2ThumbHtml,
  isReadyImageSrc,
  htmlSafeImageSrc,
  resolveChatMessageMatch,
  messageCompactKey,
  messageContextTriplet,
  rebindGalleryMessageIndexes,
  messagesTextOverlapScore,
  describeDomApiCompare,
  rawMessageRole,
  hasGenerationInfo,
  roleFromGenerationInfo,
  isCharMessageRole,
  allowInlineImagesOnRole,
  inlineRoleDisposition,
  selectionSlotDrifted,
  liveBubbleHash,
  roleForInlineBubble,
  cardsForInlineBubble,
  retainHeldInlineKeepIndices,
  pickInlineKeepDomIndices,
  prefetchInlineRoleDomIndices,
  INLINE_ROLE_PREFETCH_RADIUS,
  inlinePaintKey,
  inlinePaintKeyHasCards,
  pickInlineRepaintIndices,
  shouldStripEmptyInlineDesired,
  resolveInlinePaintCards,
  mergeSessionGallery,
  INLINE_KEEP_MAX_PER_SIDE,
  clampInlineDomRadius,
  inlineDomWindow,
  inlineDomWindowFromSel,
  inlineWindowFromRoles,
  INLINE_SELECT_SPINNER_RADIUS,
  INLINE_SELECT_PHOTO_RADIUS,
  diffInlineIdentityRows,
  shouldOverlayInlinePhoto,
  shouldMountMsgActions,
  MSG_ACTION_MIN_BODY_CHARS,
  MSG_ACTION_TOP_MIN_BODY_CHARS,
  msgActionWantedEnds,
  msgFanWantedEnds,
  normalizeMessageRole,
  desiredInlinePlacements,
  keepReadyInlineWithPersist,
  runBoundedPool,
  canSkipInlineInject,
  desiredInlinePaintKey,
  pendingInlineKey,
  INLINE_FRAME_LAYOUT_VERSION,
  inlinePlaceholderSrc,
  inlinePlaceholderSize,
  inlinePlacementSlotKey,
  reconcileInlineShot,
  shouldStripLeftoverInlineId,
  shouldScanInlineLeftovers,
  shouldSelectMessageByTextDrag,
  visibleGalleryImageIds,
  VIEWER_WARM_WINDOW_MAX,
  nearbyMessageImageIds,
  NEARBY_IMAGE_MAX,
  isNearbyDomIndex,
  nearbyDomIndexWindow,
  resolveIndexProgress,
  composeDualProgressBarsHtml,
  composeProgressToastHtml,
  ATTACH_TOAST_MAX_MS,
  shouldShowSessionAttachToast,
  composeAttachToastHtml,
  normalizeToastAnchor,
  normalizeImagePressInspect,
  toastAnchorStyle,
  shouldStartImagePressInspect,
  imagePressAllowsDoubleTap,
  imagePressAllowsHold,
  imagePressAllowsSecondPointer,
  imagePressDoubleTapHits,
  imagePressAllowsTripleTap,
  imagePressTapNeed,
  imagePressTapHits,
  imagePressMoveCancels,
  imagePressIgnorePointerCancel,
  imagePressOtherPointerUp,
  imagePressDownCount,
  noteImagePressDown,
  noteImagePressUp,
  formatProgressElapsedSec,
  galleryStripSplitAt,
  galleryIndexFromChildIndex,
  thumbIndexAtStripX,
  galleryStripContentWidth,
  clampThumbScrollOffset,
  parseAutotagLookJson,
  stripLbdataBlocks,
  messageBodyCharCount,
  normalizeMatchText,
} from "../.test-build/viewer-core.mjs";

test("LBDATA dump is excluded from body char count and match text", () => {
  const dump = `----\n---\n[LBDATA START]\n<lightboard-kakaochat>lots of wiki</lightboard-kakaochat>\n[LBDATA END]\n`;
  assert.equal(stripLbdataBlocks(dump).replace(/\s+/g, ""), "-------");
  assert.equal(messageBodyCharCount(dump), 7);
  assert.ok(messageBodyCharCount(dump) <= 30);
  const withProse = `정찰 결과를 상부로 보고한다. 하층부에서 이상 개체를 확인했고 추가 대비가 필요하다.\n[LBDATA START]\nx\n[LBDATA END]`;
  assert.ok(messageBodyCharCount(withProse) > 30);
  assert.equal(normalizeMatchText(`[LBDATA START]wikiwiki[LBDATA END]안녕`), "안녕");
});

test("new 100 percent thumbnail equals the legacy 600 percent dimensions", () => {
  assert.deepEqual(scaleInlineThumbnail(100), { width: 528, height: 720, percent: 100 });
  assert.deepEqual(scaleInlineThumbnail(50), { width: 264, height: 360, percent: 50 });
});

test("gallery puts selected-message cards first by y% then newest remaining", () => {
  const cards = [
    { id: "a", content_hash: "h1", message_index: 1, paragraph: 0, shot_index: 0, created_at: 1, y_percent: 80 },
    { id: "b", content_hash: "h2", message_index: 2, paragraph: 0, shot_index: 0, created_at: 3, y_percent: 10 },
    { id: "c", content_hash: "h1", message_index: 1, paragraph: 1, shot_index: 0, created_at: 2, y_percent: 20 },
  ];
  const out = galleryForMessage(cards, { hash: "h1", chatIndex: 1 }, 8);
  assert.deepEqual(out.map((c) => c.id), ["c", "a", "b"]);
});

test("gallery keeps all selected shots even when rest cap is 8", () => {
  const selected = Array.from({ length: 5 }, (_, i) => ({
    id: `s${i}`,
    content_hash: "sel",
    message_index: 5,
    paragraph: i,
    shot_index: 0,
    created_at: i,
    y_percent: 10 + i * 15,
  }));
  const others = Array.from({ length: 12 }, (_, i) => ({
    id: `o${i}`,
    content_hash: `o${i}`,
    message_index: i,
    paragraph: 0,
    shot_index: 0,
    created_at: 100 + i,
  }));
  const out = galleryForMessage([...selected, ...others], { hash: "sel", chatIndex: 5 }, 8);
  assert.equal(out.length, 5 + 8);
  assert.ok(out.slice(0, 5).every((c) => c.content_hash === "sel"));
  assert.deepEqual(out.slice(0, 5).map((c) => c.id), ["s0", "s1", "s2", "s3", "s4"]);
  assert.equal(out[5].id, "o11");
});

test("galleryFocusMessage keeps last imaged when selection has no cards", () => {
  const cards = [{ id: "x", content_hash: "old", message_index: 1, paragraph: 0, created_at: 1 }];
  assert.equal(galleryFocusMessage({ hash: "new", chatIndex: 9, sessionId: "s1" }, { hash: "old", chatIndex: 1, sessionId: "s1" }, cards).hash, "old");
});

test("galleryFocusMessage does not keep last imaged across sessions", () => {
  const cards = [{ id: "x", content_hash: "old", message_index: 1, paragraph: 0, created_at: 1, session_id: "oldS" }];
  const focus = galleryFocusMessage(
    { hash: "new", chatIndex: 0, sessionId: "newS" },
    { hash: "old", chatIndex: 1, sessionId: "oldS" },
    cards,
  );
  assert.equal(focus.hash, "new");
});

test("stripInlayInlineHtml removes marker blocks", () => {
  const html = `hello<div data-inlay-inline-shot="0"><br><img src="data:image/png;base64,xx"><br></div>world`;
  assert.equal(stripInlayInlineHtml(html).replace(/\s/g, ""), "helloworld");
  assert.equal(
    stripInlayInlineHtml('<p><span data-inlay-msg-actions="1"><button>재생성</button></span>본문</p>'),
    "<p>본문</p>",
  );
  assert.equal(
    stripInlayInlineHtml('<div data-inlay-msg-actions="1"><span>생성</span></div><p>본문</p>'),
    "<p>본문</p>",
  );
  assert.equal(
    stripInlayInlineHtml('<p><div x-inlay-msg-actions="1"><span>태그</span></div>본문</p>'),
    "<p>본문</p>",
  );
  assert.deepEqual(splitMessageLines("a\n\nb\nc"), ["a", "b", "c"]);
  assert.equal(clampShotLine(9, 3), 3);
  assert.equal(clampShotLine(0, 3), null);
});

test("keepMsgActionBarIndexes keeps one top and one bottom", () => {
  assert.deepEqual(keepMsgActionBarIndexes(["top", "top", "bot", "bot"], true), [0, 2]);
  assert.deepEqual(keepMsgActionBarIndexes(["top", "bot", "top", "bot"], true), [0, 1]);
  assert.deepEqual(keepMsgActionBarIndexes(["", "", "", ""], true), [0, 1]);
  assert.deepEqual(keepMsgActionBarIndexes(["top", "top", "top"], false), [0]);
  assert.deepEqual(keepMsgActionBarIndexes(["bot", "top"], true), [0, 1]);
  assert.deepEqual(keepMsgActionBarIndexes([], true), []);
  assert.deepEqual(keepMsgActionBarIndexes(["top", "bot"], true, false), [1]);
  assert.deepEqual(keepMsgActionBarIndexes(["top", "bot"], false, true), [0]);
  assert.deepEqual(keepMsgActionBarIndexes(["top", "bot"], false, false), []);
});

test("isInlayPaintHost skips our chip rows and shot wraps", () => {
  assert.equal(isInlayPaintHost({ isActionBar: true }), true);
  assert.equal(isInlayPaintHost({ isInlineShot: true }), true);
  assert.equal(isInlayPaintHost({ isActionBar: "", isInlineShot: "" }), false);
  assert.equal(isInlayPaintHost({}), false);
  assert.equal(isInlayPaintHost(null), false);
});

test("isMessageBodyHostTag ignores card chrome DIVs", () => {
  assert.equal(isMessageBodyHostTag("P"), true);
  assert.equal(isMessageBodyHostTag("li"), true);
  assert.equal(isMessageBodyHostTag("H2"), true);
  assert.equal(isMessageBodyHostTag("blockquote"), true);
  assert.equal(isMessageBodyHostTag("DIV"), false);
  assert.equal(isMessageBodyHostTag("SPAN"), false);
  assert.equal(isMessageBodyHostTag(""), false);
});

test("normalizeInlineMsgActions maps checkbox and aliases", () => {
  assert.equal(normalizeInlineMsgActions(undefined), "off");
  assert.equal(normalizeInlineMsgActions(false), "off");
  assert.equal(normalizeInlineMsgActions(true), "compat");
  assert.equal(normalizeInlineMsgActions("true"), "compat");
  assert.equal(normalizeInlineMsgActions("legacy"), "legacy");
  assert.equal(normalizeInlineMsgActions("2.4.7"), "legacy");
  assert.equal(normalizeInlineMsgActions("compat"), "compat");
  assert.equal(normalizeInlineMsgActions("2.4.9"), "compat");
  assert.equal(inlineMsgActionsOn("legacy"), true);
  assert.equal(inlineMsgActionsOn("compat"), true);
  assert.equal(inlineMsgActionsOn("off"), false);
  assert.equal(inlineMsgActionsLegacy("legacy"), true);
  assert.equal(inlineMsgActionsLegacy("compat"), false);
});

test("msgActionMountKind puts both bars on the content parent when chips are on", () => {
  assert.equal(msgActionMountKind("top"), "parent");
  assert.equal(msgActionMountKind("bot"), "parent");
  assert.equal(msgActionMountKind(""), "host");
  assert.equal(msgActionMountKind("top", "compat"), "parent");
  assert.equal(msgActionMountKind("top", "legacy"), "parent");
  assert.equal(msgActionMountKind("bot", "compat"), "parent");
  assert.equal(msgActionMountKind("bot", "legacy"), "parent");
  assert.equal(msgActionMountKind("top", "off"), "host");
  assert.equal(msgActionMountKind("bot", "off"), "host");
});

test("msgActionBarPlace puts the bottom bar after the last sibling", () => {
  assert.equal(msgActionBarPlace("top"), "before");
  assert.equal(msgActionBarPlace("bot"), "after");
  assert.equal(msgActionBarPlace(""), "before");
});

test("canMountMsgActionOnParent stays inside the bubble for legacy and compat", () => {
  const bubble = { id: "msg" };
  const content = { id: "box" };
  const chatRow = { id: "row" };
  assert.equal(canMountMsgActionOnParent(content, bubble), false);
  assert.equal(canMountMsgActionOnParent(bubble, bubble), false);
  assert.equal(canMountMsgActionOnParent(null, bubble), false);
  assert.equal(canMountMsgActionOnParent(content, bubble, "compat"), false);
  assert.equal(canMountMsgActionOnParent(content, bubble, "compat", true), true);
  assert.equal(canMountMsgActionOnParent(content, bubble, "legacy"), false);
  assert.equal(canMountMsgActionOnParent(content, bubble, "legacy", false), false);
  assert.equal(canMountMsgActionOnParent(chatRow, bubble, "legacy", false), false);
  assert.equal(canMountMsgActionOnParent(content, bubble, "legacy", true), true);
  assert.equal(canMountMsgActionOnParent(bubble, bubble, "legacy", true), false);
  assert.equal(canMountMsgActionOnParent(null, bubble, "legacy", true), false);
  assert.equal(canMountMsgActionOnParent(content, bubble, "off", true), false);
});

test("findElementIndexForLine matches text + occurrence order", () => {
  const lines = ["차를 탔다", "커피를 마셨다", "커피를 마셨다", "끝"];
  assert.deepEqual(lineTextOccurrence(lines, 2), { text: "커피를 마셨다", occurrence: 1 });
  assert.deepEqual(lineTextOccurrence(lines, 3), { text: "커피를 마셨다", occurrence: 2 });
  const els = ["차를 탔다", "커피를 마셨다", "커피를 마셨다", "끝"];
  assert.equal(findElementIndexForLine(els, lines, 2), 1);
  assert.equal(findElementIndexForLine(els, lines, 3), 2);
  // multi-line host: both coffee lines live in one element
  assert.equal(findElementIndexForLine(["차를 탔다", "커피를 마셨다\n커피를 마셨다", "끝"], lines, 3), 1);
  assert.equal(preferNearbyHostIndex(["P", "DIV", "P"], 1), 0);
  assert.equal(preferNearbyHostIndex(["H2", "DIV", "P"], 1), 2);
  assert.equal(preferNearbyHostIndex(["DIV", "H2"], 0), -1);
  assert.equal(preferNearbyHostIndex(["P", "P"], 0), 0);
  // line 2 text missing from hosts → fall forward to line 3
  assert.deepEqual(
    findElementIndexForLineWithFallback(["a", "c"], ["P", "P"], ["a", "b", "c"], 2),
    { elementIndex: 1, usedLine: 3 },
  );
});

test("injectInlineImagesIntoHtml keeps formatting and uses line numbers", () => {
  const src = "data:image/png;base64,abc";
  assert.equal(htmlToPlainLn("a<br><b>b</b><br>c"), "a\nb\nc");
  assert.equal(findPlainLineStartOffset("a\nb\nc", 2), 2);
  const rich = `차를 탔다<br><b>커피를 마셨다</b><br>커피를 마셨다<br>끝`;
  const out = injectInlineImagesIntoHtml(rich, [
    { line: 2, src, shotIndex: 0, cardId: "c1" },
    { line: 3, src, shotIndex: 1, cardId: "c2" },
  ]);
  assert.match(out, /data-inlay-inline-shot="c1"/);
  assert.match(out, /data-inlay-inline-shot="c2"/);
  assert.match(out, /<b>커피를 마셨다<\/b>/);
  assert.doesNotMatch(out, /data-inlay-inline-frame=/);
  assert.match(out, /max-width:min\(78%,100%\)/);
  // first coffee line is bold — marker for line 2 sits before <b>
  assert.match(out, /data-inlay-inline-shot="c1"[^>]*>[\s\S]*?<b>커피를 마셨다<\/b>/);
  // duplicate plain "커피를 마셨다" still gets line-3 marker (not string search of first)
  const stripped = stripInlayInlineHtml(out);
  assert.equal(htmlToPlainLn(stripped), htmlToPlainLn(rich));
});

test("normalizeInlineChatTextSide defaults to before", () => {
  assert.equal(normalizeInlineChatTextSide(undefined), "before");
  assert.equal(normalizeInlineChatTextSide("after"), "after");
  assert.equal(normalizeInlineChatTextSide("end"), "after");
  assert.equal(normalizeInlineChatTextSide("nope"), "before");
});

test("injectInlineImagesIntoHtml can sit after the line text", () => {
  const src = "data:image/png;base64,abc";
  assert.equal(findPlainLineEndOffset("a\nb\nc", 2), 3);
  const wrapped = `<p><b>안녕</b>하세요</p>`;
  const afterOne = injectInlineImagesIntoHtml(wrapped, [{ line: 1, src, shotIndex: 0, cardId: "c1" }], { textSide: "after" });
  assert.match(afterOne, /하세요<div[\s\S]*data-inlay-inline-shot="c1"/);
  assert.match(afterOne, /<b>안녕<\/b>하세요/);
  assert.doesNotMatch(afterOne, /<p><div/);
  const two = "첫째<br>둘째";
  const afterTwo = injectInlineImagesIntoHtml(two, [{ line: 2, src, shotIndex: 1, cardId: "c2" }], { textSide: "after" });
  assert.match(afterTwo, /둘째<div[\s\S]*data-inlay-inline-shot="c2"/);
  assert.equal(htmlToPlainLn(stripInlayInlineHtml(afterTwo)), htmlToPlainLn(two));
});

test("inlinePlaceholderSrc is a still ring, not a spinning SVG", () => {
  const src = inlinePlaceholderSrc({ aspect: "portrait" });
  assert.doesNotMatch(decodeURIComponent(src), /animateTransform/);
  assert.match(decodeURIComponent(src), /circle/);
  assert.match(decodeURIComponent(src), /#c4b5fd/);
  assert.doesNotMatch(decodeURIComponent(src), /#4ade80/);
});

test("inlinePlaceholderSrc uses a green ring for comic shots", () => {
  const src = inlinePlaceholderSrc({ aspect: "portrait", kind: "comic" });
  const svg = decodeURIComponent(src);
  assert.match(svg, /#4ade80/);
  assert.match(svg, /#22c55e/);
  assert.doesNotMatch(svg, /#c4b5fd/);
  assert.doesNotMatch(svg, /#7c6cff/);
  assert.notEqual(src, inlinePlaceholderSrc({ aspect: "portrait" }));
});

test("inlineDomWindow stays around the selection and never walks the chat", () => {
  assert.equal(clampInlineDomRadius(4), 4);
  assert.equal(clampInlineDomRadius(99), 20);
  assert.deepEqual(inlineDomWindow(10, 30, 4), [6, 7, 8, 9, 10, 11, 12, 13, 14]);
  assert.deepEqual(inlineDomWindow(0, 3, 4), [0, 1, 2]);
  assert.deepEqual(inlineDomWindow(5, 6, 1), [4, 5]);
  assert.deepEqual(inlineDomWindowFromSel(10, 30, 4), [10, 9, 11, 8, 12, 7, 13, 6, 14]);
  assert.deepEqual(inlineDomWindowFromSel(0, 3, 4), [0, 1, 2]);
  assert.deepEqual(inlineDomWindowFromSel(5, 6, 1), [5, 4]);
});

test("shouldOverlayInlinePhoto is selected ±1 unless that bubble is a user turn", () => {
  assert.equal(shouldOverlayInlinePhoto({ idx: 5, selIdx: 5, length: 20, role: "char" }), true);
  assert.equal(shouldOverlayInlinePhoto({ idx: 4, selIdx: 5, length: 20, role: "assistant" }), true);
  assert.equal(shouldOverlayInlinePhoto({ idx: 6, selIdx: 5, length: 20, role: "char" }), true);
  assert.equal(shouldOverlayInlinePhoto({ idx: 5, selIdx: 5, length: 20, role: "" }), true);
  assert.equal(shouldOverlayInlinePhoto({ idx: 6, selIdx: 5, length: 20, role: "user" }), false);
  assert.equal(shouldOverlayInlinePhoto({ idx: 7, selIdx: 5, length: 20, role: "char" }), false);
});

test("shouldOverlayInlinePhoto takes a character-counted window over DOM ±1", () => {
  // Chars at 1 and 5 with users between: DOM ±1 would refuse both.
  const window = [3, 5, 1];
  assert.equal(shouldOverlayInlinePhoto({ idx: 1, selIdx: 3, length: 7, role: "char", window }), true);
  assert.equal(shouldOverlayInlinePhoto({ idx: 5, selIdx: 3, length: 7, role: "char", window }), true);
  assert.equal(shouldOverlayInlinePhoto({ idx: 2, selIdx: 3, length: 7, role: "char", window }), false);
  // The role guard still wins: a slot proven to be a user turn takes no photo
  // even when the window listed it.
  assert.equal(shouldOverlayInlinePhoto({ idx: 5, selIdx: 3, length: 7, role: "user", window }), false);
  // An empty window is a window, not "fall back to ±1".
  assert.equal(shouldOverlayInlinePhoto({ idx: 3, selIdx: 3, length: 7, role: "char", window: [] }), false);
});

test("inlineWindowFromRoles counts character bubbles, not DOM slots", () => {
  // 123456 with 2 and 3 as users, 4 selected. DOM ±1 reaches 4 and 5 only;
  // counting chars reaches 1 as well. Indices are 0-based: msg N is idx N-1.
  const roles = ["char", "user", "user", "char", "char", "char"];
  const isCharAt = (i) => isCharMessageRole(roles[i]);
  const { spinner, photos } = inlineWindowFromRoles({ selIdx: 3, length: 6, radius: 4, isCharAt });
  assert.deepEqual(spinner, [3, 4, 0, 5]);
  assert.deepEqual(photos, [3, 4, 0]);
});

test("inlineWindowFromRoles radiates from the selection and keeps radius per side", () => {
  const roles = Array.from({ length: 21 }, (_, i) => (i % 2 ? "user" : "char"));
  const isCharAt = (i) => isCharMessageRole(roles[i]);
  const { spinner, photos } = inlineWindowFromRoles({ selIdx: 10, length: 21, radius: 4, isCharAt });
  // Selected first, then one step out on each side in turn.
  assert.deepEqual(spinner, [10, 12, 8, 14, 6, 16, 4, 18, 2]);
  assert.deepEqual(photos, [10, 12, 8]);
});

test("inlineWindowFromRoles treats an unresolved role as a character bubble", () => {
  // Unknown is not evidence of a user turn: dropping those slots is what left
  // first boot with chips and no spinner.
  const roles = ["char", "", "user", "char"];
  const isCharAt = (i) => roles[i] === "" || isCharMessageRole(roles[i]);
  const { spinner } = inlineWindowFromRoles({ selIdx: 0, length: 4, radius: 2, isCharAt });
  assert.deepEqual(spinner, [0, 1, 3]);
});

test("inlineWindowFromRoles stops at the scan cap instead of trusting unseen slots", () => {
  const roles = ["char", "user", "user", "user", "user", "char", "char"];
  const isCharAt = (i) => isCharMessageRole(roles[i]);
  const capped = inlineWindowFromRoles({ selIdx: 0, length: 7, radius: 4, scanCap: 3, isCharAt });
  assert.deepEqual(capped.spinner, [0]);
  const full = inlineWindowFromRoles({ selIdx: 0, length: 7, radius: 4, scanCap: 6, isCharAt });
  assert.deepEqual(full.spinner, [0, 5, 6]);
});

test("inlineWindowFromRoles skips empty bodies like user turns", () => {
  const roles = ["char", "char", "char", "char"];
  const isCharAt = (i) => isCharMessageRole(roles[i]);
  const { spinner, photos } = inlineWindowFromRoles({
    selIdx: 0,
    length: 4,
    radius: 2,
    isCharAt,
    isSkipBodyAt: (i) => i === 1,
  });
  assert.deepEqual(spinner, [0, 2, 3]);
  assert.deepEqual(photos, [0, 2]);
});

test("inlineWindowFromRoles allRoles keeps user bubbles in both windows", () => {
  const roles = ["char", "user", "user", "char"];
  const isCharAt = (i) => isCharMessageRole(roles[i]);
  const { spinner, photos } = inlineWindowFromRoles({
    selIdx: 1,
    length: 4,
    radius: 2,
    isCharAt,
    allRoles: true,
  });
  assert.deepEqual(spinner, [1, 2, 0, 3]);
  assert.deepEqual(photos, [1, 2, 0]);
});

test("inlineWindowFromRoles always keeps the selection, even a user bubble", () => {
  const roles = ["char", "user", "char"];
  const isCharAt = (i) => isCharMessageRole(roles[i]);
  const { spinner, photos } = inlineWindowFromRoles({ selIdx: 1, length: 3, radius: 2, isCharAt });
  // The selected bubble still gets its own pass; shouldOverlayInlinePhoto is
  // what refuses it a photo.
  assert.equal(spinner[0], 1);
  assert.deepEqual(spinner, [1, 2, 0]);
  assert.deepEqual(photos, [1, 2, 0]);
  assert.equal(shouldOverlayInlinePhoto({ idx: 1, selIdx: 1, length: 3, role: "user", window: photos }), false);
});

test("inlineWindowFromRoles keepSelection false drops a user selection from both windows", () => {
  const roles = ["char", "user", "char"];
  const isCharAt = (i) => isCharMessageRole(roles[i]);
  const { spinner, photos } = inlineWindowFromRoles({
    selIdx: 1,
    length: 3,
    radius: 2,
    isCharAt,
    keepSelection: false,
  });
  assert.ok(!spinner.includes(1));
  assert.ok(!photos.includes(1));
  assert.deepEqual([...photos].sort((a, b) => a - b), [0, 2]);
});

test("select windows: DOM 1-7 char 1,4,5,6,7 — 4 then 5 photos", () => {
  // 1-based DOM 1..7 → indices 0..6. chars at 0,3,4,5,6.
  const roles = ["char", "user", "user", "char", "char", "char", "char"];
  const isCharAt = (i) => isCharMessageRole(roles[i]);
  const at = (selIdx) => inlineWindowFromRoles({
    selIdx,
    length: 7,
    radius: INLINE_SELECT_SPINNER_RADIUS,
    isCharAt,
    keepSelection: false,
  });
  assert.equal(INLINE_SELECT_SPINNER_RADIUS, 0);
  assert.equal(INLINE_SELECT_PHOTO_RADIUS, 0);
  const four = at(3);
  assert.deepEqual(four.photos, [3]);
  assert.deepEqual(four.spinner, [3]);
  const five = at(4);
  assert.deepEqual(five.photos, [4]);
  assert.deepEqual(five.spinner, [4]);
  const a = { el: "e0", idx: 0 };
  const b = { el: "e3", idx: 3 };
  const c = { el: "e4", idx: 4 };
  const d = { el: "e5", idx: 5 };
  const hop = diffInlineIdentityRows({
    prev: [a, b, c],
    next: [b, c, d],
  });
  assert.deepEqual(hop.enter.map((r) => r.el), ["e5"]);
  assert.deepEqual(hop.leave.map((r) => r.el), ["e0"]);
  assert.deepEqual(hop.keep.map((r) => r.el).sort(), ["e3", "e4"]);
});

test("diffInlineIdentityRows keys off element identity, not DOM index", () => {
  const el = { id: "same" };
  const hop = diffInlineIdentityRows({
    prev: [{ el, idx: 4 }],
    next: [{ el, idx: 5 }],
  });
  assert.deepEqual(hop.enter, []);
  assert.deepEqual(hop.leave, []);
  assert.equal(hop.keep.length, 1);
  assert.equal(hop.keep[0].idx, 5);
});

test("diffInlineIdentityRows keeps a bubble when SafeDOM wraps the same chat id", () => {
  const prevEl = { proxy: 1 };
  const nextEl = { proxy: 2 };
  const hop = diffInlineIdentityRows({
    prev: [{ el: prevEl, idx: 0, chatId: "1b088140-0071-4610-a882-795efa5bb2fe", chatIndex: 134 }],
    next: [{ el: nextEl, idx: 0, chatId: "1b088140-0071-4610-a882-795efa5bb2fe", chatIndex: 134 }],
  });
  assert.deepEqual(hop.enter, []);
  assert.deepEqual(hop.leave, []);
  assert.equal(hop.keep.length, 1);
  assert.equal(hop.keep[0].el, nextEl);
});

test("diffInlineIdentityRows keep uses chat-index when chat id is missing", () => {
  const hop = diffInlineIdentityRows({
    prev: [{ el: { a: 1 }, idx: 3, chatIndex: 132 }],
    next: [{ el: { b: 2 }, idx: 4, chatIndex: 132 }],
  });
  assert.equal(hop.keep.length, 1);
  assert.equal(hop.enter.length, 0);
  assert.equal(hop.leave.length, 0);
});

test("diffInlineIdentityRows still hops when chat ids differ", () => {
  const hop = diffInlineIdentityRows({
    prev: [{ el: { a: 1 }, idx: 0, chatId: "old", chatIndex: 134 }],
    next: [{ el: { b: 2 }, idx: 2, chatId: "new", chatIndex: 132 }],
  });
  assert.deepEqual(hop.keep, []);
  assert.equal(hop.leave[0].chatId, "old");
  assert.equal(hop.enter[0].chatId, "new");
});

test("pickInlineKeepDomIndices scanCap bounds the walk per side", () => {
  const roles = ["char", "user", "user", "char", "char", "user", "user", "char"];
  const isCharAt = (i) => isCharMessageRole(roles[i]);
  const opts = { selIdx: 4, length: 8, allRoles: false, isCharAt, maxPerSide: 2 };
  assert.deepEqual(pickInlineKeepDomIndices({ ...opts }).sort((a, b) => a - b), [0, 3, 4, 7]);
  assert.deepEqual(pickInlineKeepDomIndices({ ...opts, scanCap: 1 }).sort((a, b) => a - b), [3, 4]);
  // No cap is the old behaviour, so existing callers are untouched.
  assert.deepEqual(
    pickInlineKeepDomIndices({ ...opts, scanCap: Number.NaN }).sort((a, b) => a - b),
    [0, 3, 4, 7],
  );
});

test("inlinePlaceholderSize follows the first-tagger aspect aliases", () => {
  assert.deepEqual(inlinePlaceholderSize({ aspect: "horizontal" }), { width: 1216, height: 832 });
  assert.deepEqual(inlinePlaceholderSize({ aspect: "1:1" }), { width: 1024, height: 1024 });
  assert.deepEqual(inlinePlaceholderSize({}), { width: 832, height: 1216 });
  assert.deepEqual(
    inlinePlaceholderSize({ aspect: "landscape", width: 832, height: 1216 }),
    { width: 832, height: 1216 },
  );
});

test("markerBlockHtml parks a sized SVG and overlays the real image on top", () => {
  const pending = markerBlockHtml({
    line: 2,
    src: "",
    shotIndex: 0,
    pending: true,
    cardId: "pending-0",
    aspect: "landscape",
  });
  const placeholder = inlinePlaceholderSrc({ aspect: "landscape" });
  assert.match(pending, /data-inlay-inline-pending="1"/);
  assert.match(pending, /data-inlay-inline-spin="1"/);
  assert.equal((pending.match(/data-inlay-inline-img="1"/g) || []).length, 2);
  assert.match(pending, /x-inlay-inline-layer="a"/);
  assert.match(pending, /x-inlay-inline-layer="b"/);
  assert.match(pending, /x-inlay-inline-active=""/);
  assert.match(pending, /x-inlay-inline-pending="1"/);
  assert.match(pending, /x-inlay-inline-slot="s0"/);
  assert.match(pending, /x-inlay-inline-layout="13"/);
  assert.match(pending, /data-inlay-inline-slot="s0"/);
  assert.match(pending, /<img[^>]*width="1216"[^>]*height="832"/);
  assert.ok(pending.includes(`src="${placeholder}"`));
  assert.match(decodeURIComponent(placeholder), /width="1216"/);
  assert.match(decodeURIComponent(placeholder), /height="832"/);
  assert.match(pending, /width:auto;height:auto;max-width:min\(78%,100%\)/);
  assert.match(pending, /data-inlay-inline-spin="1"[^>]*pointer-events:none/);
  assert.match(pending, /position:absolute/);
  assert.match(pending, /opacity:0/);
  assert.match(pending, new RegExp(`data-inlay-inline-layout="${INLINE_FRAME_LAYOUT_VERSION}"`));
  assert.doesNotMatch(pending, /data-inlay-inline-frame=/);
  // Only overlay cells clip pixels; the in-flow spinner continues to reserve height.
  assert.match(pending, /x-inlay-inline-cell="1"[^>]*overflow:hidden/);
  assert.doesNotMatch(pending.match(/<div[^>]+>/)[0], /overflow:hidden/);
  const ready = markerBlockHtml({
    line: 2,
    src: "data:image/png;base64,abc",
    shotIndex: 0,
    cardId: "c1",
    aspect: "landscape",
  });
  assert.match(ready, /data-inlay-inline-spin="1"/);
  assert.equal((ready.match(/data-inlay-inline-img="1"/g) || []).length, 2);
  assert.equal((ready.match(/x-inlay-inline-cell="1"/g) || []).length, 2);
  assert.match(ready, /x-inlay-inline-slot="s0"/);
  assert.match(ready, /x-inlay-inline-layout="13"/);
  assert.match(ready, /x-inlay-inline-pending="0"/);
  assert.match(ready, /x-inlay-inline-active="a"/);
  assert.ok(ready.includes(placeholder), "spinner stays under the photo so the box cannot collapse");
  assert.match(ready, /data:image\/png;base64,abc/);
  assert.match(ready, /data-inlay-inline-photo="1"[^>]*pointer-events:auto/);
  assert.match(ready, /opacity:1/);
  assert.match(ready, /transition:opacity 80ms linear/);
  assert.match(ready, /left:50%;top:50%;width:100%;height:100%;max-width:100%;overflow:hidden;transform:translate\(-50%,-50%\)/);
  assert.match(ready, /width:auto;height:auto;max-width:min\(78%,100%\)/);
  assert.match(ready, /max-height:min\(70vh,900px\)/);
  assert.doesNotMatch(ready, /data-inlay-inline-frame=/);
  assert.doesNotMatch(ready, /object-position:center top/);
  assert.doesNotMatch(ready, /data-inlay-inline-act=/);
  assert.doesNotMatch(ready, /data-inlay-chrome-act=/);
  const scaled = markerBlockHtml({
    line: 2,
    src: "data:image/png;base64,abc",
    shotIndex: 0,
    cardId: "c1",
  }, 50);
  assert.match(scaled, /max-width:min\(39%,100%\)/);
  assert.match(scaled, /max-height:min\(35vh,450px\)/);
  const blobReady = markerBlockHtml({
    line: 2,
    src: "blob:https://host/abc",
    shotIndex: 0,
    cardId: "c1",
  });
  assert.match(blobReady, /data-inlay-inline-img="1"/);
  assert.doesNotMatch(blobReady, /blob:/);
  assert.doesNotMatch(blobReady, /data-inlay-inline-pending/);
});

test("inlinePlacementSlotKey stays stable when reroll changes the card id", () => {
  assert.equal(inlinePlacementSlotKey({ shotIndex: 2, line: 9, cardId: "old" }), "s2");
  assert.equal(inlinePlacementSlotKey({ shotIndex: 2, line: 4, cardId: "new" }), "s2");
  assert.equal(inlinePlacementSlotKey({ line: 4, cardId: "new" }), "l4");
});

test("markerBlockHtml stamps the bubble hash so a repaint can skip the scan", () => {
  const shot = { line: 2, src: "data:image/png;base64,abc", shotIndex: 0, cardId: "c1" };
  const pendingShot = { line: 2, src: "", shotIndex: 0, pending: true, cardId: "pending-0" };
  // Absent by default: injectInlineImagesIntoHtml rebuilds the whole bubble and
  // has no cached scan to validate.
  assert.doesNotMatch(markerBlockHtml(shot), /data-inlay-inline-key/);
  assert.match(markerBlockHtml(shot, 100, "h4a9"), /data-inlay-inline-key="h4a9"/);
  assert.match(markerBlockHtml(shot, 100, "h4a9"), /x-inlay-inline-key="h4a9"/);
  assert.match(markerBlockHtml(shot, 100, "h4a9", "owner7"), /x-inlay-inline-owner="owner7"/);
  assert.match(markerBlockHtml(pendingShot, 100, "h4a9"), /data-inlay-inline-key="h4a9"/);
  // The stamp must not shield the marker from the strip that runs before hashing,
  // or the bubble's own text would be read back with our blocks still in it.
  assert.equal(
    stripInlayInlineHtml(`<p>hello${markerBlockHtml(shot, 100, "h4a9")}world</p>`).replace(/\s/g, ""),
    "<p>helloworld</p>",
  );
});

test("injectInlineImagesIntoHtml hard-dedupes pending circles by line and cardId", () => {
  const html = "<p>첫 줄</p><p>둘째</p>";
  const out = injectInlineImagesIntoHtml(html, [
    { line: 1, pending: true, cardId: "pending-0", shotIndex: 0 },
    { line: 1, pending: true, cardId: "pending-0", shotIndex: 0 },
    { line: 1, pending: true, cardId: "pending-1", shotIndex: 1 },
  ]);
  assert.equal((out.match(/data-inlay-inline-pending/g) || []).length, 1);
  assert.equal((out.match(/data-inlay-inline-shot="pending-0"/g) || []).length, 1);
});

test("pin percent ↔ px truncates decimals and migrates legacy offsets", () => {
  assert.equal(clampPinPercent(12.9), 12);
  assert.equal(pinPercentToPx(0, 1000, 22, 4), 4);
  assert.equal(pinPxToPercent(500, 1000), 50);
  assert.equal(resolveStoredPinPercent({ overlay_x_pct: 10.8 }, "x", 1000), 10);
});

test("pickMessageIndexNearPoint prefers containing rect then closest center", () => {
  const rects = [{ top: 0, bottom: 100 }, { top: 120, bottom: 220 }, { top: 240, bottom: 340 }];
  assert.equal(pickMessageIndexNearPoint(rects, 50), 0);
  assert.equal(pickMessageIndexNearPoint(rects, 150), 1);
});

test("gallery without selection is newest-first capped at 8", () => {
  const cards = Array.from({ length: 10 }, (_, i) => ({ id: `n${i}`, created_at: i, message_index: i }));
  assert.equal(galleryForMessage(cards, null, 8).length, 8);
});

test("selection gesture respects movement; context/longpress ignore left-click track", () => {
  assert.equal(normalizeSelectionGesture("double"), "double");
  assert.equal(normalizeSelectionGesture("context"), "context");
  assert.equal(normalizeSelectionGesture("longpress"), "longpress");
  assert.equal(clickSelectTracksEnabled("single"), true);
  assert.equal(clickSelectTracksEnabled("context"), false);
  assert.equal(isMessageSelectionGesture({ gesture: "single", detail: 1, movement: 0 }), true);
  assert.equal(isMessageSelectionGesture({ gesture: "single", detail: 1, movement: 20 }), false);
  assert.equal(isMessageSelectionGesture({ gesture: "double", detail: 1, movement: 0 }), true);
  assert.equal(isMessageSelectionGesture({ gesture: "context", detail: 1, movement: 0 }), false);
  assert.equal(isMessageSelectionGesture({ gesture: "longpress", detail: 1, movement: 0 }), false);
});

test("click selection action supports provisional then confirm in double mode", () => {
  assert.equal(resolveClickSelectionAction({ gesture: "double", detail: 1, targetDomIndex: 2 }).action, "provisional");
  const t0 = 1_000_000;
  assert.equal(
    resolveClickSelectionAction({
      gesture: "double",
      detail: 1,
      targetDomIndex: 2,
      pendingDomIndex: 2,
      pendingAt: t0,
      now: t0 + 100,
      windowMs: DOUBLE_SELECT_WINDOW_MS,
    }).action,
    "confirm",
  );
  assert.equal(
    resolveClickSelectionAction({
      gesture: "double",
      detail: 1,
      targetDomIndex: 2,
      pendingDomIndex: 2,
      pendingAt: t0,
      now: t0 + DOUBLE_SELECT_WINDOW_MS + 50,
    }).action,
    "provisional",
  );
  assert.equal(
    resolveClickSelectionAction({
      gesture: "double",
      detail: 1,
      targetDomIndex: 3,
      pendingDomIndex: 2,
      pendingAt: t0,
      now: t0 + 100,
    }).action,
    "provisional",
  );
  assert.equal(resolveClickSelectionAction({ gesture: "single", detail: 1 }).action, "confirm");
  assert.equal(resolveClickSelectionAction({ gesture: "context", detail: 1, targetDomIndex: 1 }).action, "ignore");
  assert.equal(resolveClickSelectionAction({ gesture: "longpress", detail: 1, targetDomIndex: 1 }).action, "ignore");
});

test("messageClickScrollDelta never moves the chat", () => {
  assert.equal(messageClickScrollDelta({ top: 100, bottom: 780 }, 800), 0);
  assert.equal(messageClickScrollDelta({ top: 900, bottom: 1100 }, 800), 0);
  assert.equal(messageClickScrollDelta({ top: -200, bottom: -20 }, 800), 0);
});

test("text drag selects message only after real drag with selection", () => {
  assert.equal(shouldSelectMessageByTextDrag({ enabled: true, movement: 20, hasSelection: true }), true);
  assert.equal(shouldSelectMessageByTextDrag({ enabled: true, movement: 0, hasSelection: true }), false);
});

test("scroll settle tracker fires after idle and on settleNow", async () => {
  let n = 0;
  const t = createScrollSettleTracker({ delayMs: 20, onSettle: () => { n += 1; } });
  t.bump();
  t.bump();
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(n, 1);
  t.settleNow();
  assert.equal(n, 2);
  t.cancel();
});

test("scroll phase bus: active every sample, settle once after idle", async () => {
  let active = 0;
  let settle = 0;
  const bus = createScrollPhaseBus({
    settleDelayMs: 20,
    onActive: () => { active += 1; },
    onSettle: () => { settle += 1; },
  });
  bus.onScrollSample();
  bus.onScrollSample();
  assert.equal(active, 2);
  assert.equal(settle, 0);
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(settle, 1);
  bus.onScrollEnd();
  assert.equal(active, 3);
  assert.equal(settle, 2);
  bus.cancel();
});

test("stickySegChanged only when index changes", () => {
  assert.equal(stickySegChanged(0, 0), false);
  assert.equal(stickySegChanged(0, 1), true);
  assert.equal(stickySegChanged(null, 0), true);
  assert.equal(stickySegChanged(1, Number.NaN), false);
});

test("session guard confirms a real change only after two consistent observations", () => {
  const g = createSessionChangeGuard("a");
  assert.equal(g.observe("a"), false);
  assert.equal(g.observe("b"), false);
  assert.equal(g.observe("b"), true);
});

test("debounced save queue coalesces updates and never overlaps writes", async () => {
  const writes = [];
  let active = 0;
  let maxActive = 0;
  const q = createDebouncedSaveQueue(async (patch) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    writes.push(patch);
    await new Promise((r) => setTimeout(r, 5));
    active -= 1;
  }, 15);
  q.enqueue({ a: 1 });
  q.enqueue({ b: 2 });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0], { a: 1, b: 2 });
  assert.equal(maxActive, 1);
});

test("shouldRefreshGallery detects id list or order changes", () => {
  assert.equal(shouldRefreshGallery(["a", "b"], ["a", "b"]), false);
  assert.equal(shouldRefreshGallery(["a", "b"], ["b", "a"]), true);
});

test("shouldRewriteStickyThumb only when active card id changes", () => {
  assert.equal(shouldRewriteStickyThumb("a", "a"), false);
  assert.equal(shouldRewriteStickyThumb("a", "b"), true);
});

test("shouldKeepStickyThumbHidden only for the same card the user hid", () => {
  assert.equal(shouldKeepStickyThumbHidden(true, "a", "a"), true);
  assert.equal(shouldKeepStickyThumbHidden(true, "a", "b"), false);
});

test("claimStickyMarkerByCardId splices the active pin so partial swaps cannot orphan a duplicate", () => {
  const a = { card: { id: "a" }, thumb: {} };
  const b = { card: { id: "b" }, thumb: {} };
  const active = [a, b];
  assert.equal(claimStickyMarkerByCardId(active, "a"), a);
  assert.deepEqual(active, [b]);
  assert.equal(claimStickyMarkerByCardId(active, "a"), null);
  assert.equal(claimStickyMarkerByCardId(active, "b"), b);
  assert.deepEqual(active, []);
  assert.equal(claimStickyMarkerByCardId([{ card: { id: "x" } }], "x"), null);
});

test("resolveStickyThumbPct is 0 when collapsed, overlay off, or editor open", () => {
  assert.equal(resolveStickyThumbPct({ settingsPct: 120, alwaysOn: true, userCollapsed: false, editorOpen: false }), 120);
  assert.equal(resolveStickyThumbPct({ settingsPct: 120, alwaysOn: false, userCollapsed: false, editorOpen: false }), 0);
  assert.equal(resolveStickyThumbPct({ settingsPct: 120, alwaysOn: true, userCollapsed: true, editorOpen: false }), 0);
  assert.equal(resolveStickyThumbPct({ settingsPct: 120, alwaysOn: true, userCollapsed: false, editorOpen: true }), 0);
  assert.equal(resolveStickyThumbPct({ settingsPct: 0, alwaysOn: true, userCollapsed: false, editorOpen: false }), 0);
});

test("stickyThumbBoxFromPct allows 0 size for hide-by-pct", () => {
  assert.deepEqual(stickyThumbBoxFromPct(0, 200, 160), { pct: 0, w: 0, h: 0 });
  assert.deepEqual(stickyThumbBoxFromPct(100, 200, 160), { pct: 100, w: 200, h: 160 });
  assert.deepEqual(stickyThumbBoxFromPct(50, 200, 160), { pct: 50, w: 100, h: 80 });
});

test("fitBoxInside preserves landscape/square/portrait inside envelope", () => {
  // landscape 1216x832 in 528x720 envelope
  assert.deepEqual(fitBoxInside(528, 720, 1216, 832), { w: 528, h: 361 });
  // square
  assert.deepEqual(fitBoxInside(528, 720, 1024, 1024), { w: 528, h: 528 });
  // portrait (fits height-limited)
  assert.deepEqual(fitBoxInside(528, 720, 832, 1216), { w: 493, h: 720 });
  // unknown dims → envelope
  assert.deepEqual(fitBoxInside(528, 720, 0, 0), { w: 528, h: 720 });
});

test("composeStickyThumbHtml uses contain (full image, no crop)", () => {
  const html = composeStickyThumbHtml("data:image/png;base64,xx", "old");
  assert.match(html, /data:image\/png;base64,xx/);
  assert.match(html, /object-fit:contain/);
  assert.match(html, /background:transparent/);
  assert.doesNotMatch(html, /background:#0b0f18/);
  assert.equal((html.match(/<img/g) || []).length, 1);
  const blobHtml = composeStickyThumbHtml("blob:https://host/abc", "");
  assert.doesNotMatch(blobHtml, /<img /);
  assert.doesNotMatch(blobHtml, /blob:/);
});

test("composeStickyThumbHtml empty placeholder is transparent", () => {
  const html = composeStickyThumbHtml("", "");
  assert.match(html, /background:transparent/);
  assert.doesNotMatch(html, /background:#0b0f18/);
});

test("sticky v2 free layout: past midline uses left-center, before uses right-center", () => {
  assert.equal(stickyV2AnchorSide(100, 400), "right");
  assert.equal(stickyV2AnchorSide(200, 400), "left");
  const leftHalf = stickyV2FreeLayout({
    pinX: 80, pinY: 200, imgW: 120, imgH: 180, pinSize: 28, viewportW: 400, viewportH: 800,
  });
  assert.equal(leftHalf.side, "right");
  assert.equal(leftHalf.image.left, 80 - 120);
  assert.equal(leftHalf.image.top, 200 - 90);
  // ▲N ▼N side by side; pin hit covers both chips.
  assert.equal(leftHalf.aboveBadge.top, leftHalf.belowBadge.top);
  assert.ok(leftHalf.belowBadge.left > leftHalf.aboveBadge.left);
  assert.ok(leftHalf.pin.left <= leftHalf.aboveBadge.left);
  assert.ok(leftHalf.pin.left + (leftHalf.pin.w || leftHalf.pin.size) >= leftHalf.belowBadge.left + leftHalf.belowBadge.size);
  const rightHalf = stickyV2FreeLayout({
    pinX: 300, pinY: 200, imgW: 120, imgH: 180, pinSize: 28, viewportW: 400, viewportH: 800,
  });
  assert.equal(rightHalf.side, "left");
  assert.equal(rightHalf.image.left, 300);
});

test("sticky v2 count cluster is two columns with a tight gap", () => {
  const c = stickyV2CountCluster(200, 100, 28);
  assert.equal(c.aboveBadge.top, c.belowBadge.top);
  assert.equal(c.belowBadge.left - (c.aboveBadge.left + c.aboveBadge.size), 4);
  assert.ok(c.belowBadge.left - (c.aboveBadge.left + c.aboveBadge.size) < 8);
  assert.ok(c.pin.left <= c.aboveBadge.left);
  assert.ok(c.pin.left + (c.pin.w || c.pin.size) >= c.belowBadge.left + c.belowBadge.size);
  assert.ok(c.pin.h >= c.aboveBadge.size);
});

test("sticky v2 corner layout puts ▲▼ in two columns at viewport top-center", () => {
  const top = stickyV2CornerLayout({
    corner: "top-right", imgW: 100, imgH: 150, viewportW: 400, viewportH: 800, pad: 12, pinSize: 28, gap: 6,
  });
  assert.equal(top.aboveBadge.top, 12);
  assert.equal(top.belowBadge.top, 12);
  assert.ok(top.belowBadge.left > top.aboveBadge.left);
  assert.equal(top.leftBadge, null);
  assert.equal(top.rightBadge, null);
  assert.ok(top.image.left > 200);
  const bot = stickyV2CornerLayout({
    corner: "bottom-left", imgW: 100, imgH: 150, viewportW: 400, viewportH: 800, pad: 12, pinSize: 28, gap: 6,
  });
  assert.equal(bot.aboveBadge.left, top.aboveBadge.left);
  assert.equal(bot.aboveBadge.top, top.aboveBadge.top);
  assert.equal(bot.belowBadge.top, top.belowBadge.top);
  assert.equal(bot.image.left, 12);
  assert.ok(bot.image.top > 400);
});

test("sticky v2 shot counts and pure-image html", () => {
  assert.deepEqual(stickyV2ShotCounts(2, 5), { above: 2, below: 2 });
  assert.deepEqual(stickyV2ShotCounts(0, 3), { above: 0, below: 2 });
  const html = composeStickyV2ThumbHtml("data:image/png;base64,xx");
  assert.match(html, /object-fit:fill/);
  assert.doesNotMatch(html, /object-fit:contain/);
  assert.match(html, /src="data:image\/png;base64,xx"/);
  const blobHtml = composeStickyV2ThumbHtml("blob:https://host/abc");
  assert.doesNotMatch(blobHtml, /<img /);
  assert.doesNotMatch(blobHtml, /blob:/);
  assert.match(blobHtml, /background:transparent/);
});

test("isReadyImageSrc accepts data and blob; htmlSafeImageSrc drops blob", () => {
  assert.equal(isReadyImageSrc("data:image/png;base64,xx"), true);
  assert.equal(isReadyImageSrc("blob:https://host/abc"), true);
  assert.equal(isReadyImageSrc(inlinePlaceholderSrc({ aspect: "portrait" })), false);
  assert.equal(isReadyImageSrc(""), false);
  assert.equal(isReadyImageSrc("https://x/a.png"), false);
  assert.equal(htmlSafeImageSrc("data:image/webp;base64,yy"), "data:image/webp;base64,yy");
  assert.equal(htmlSafeImageSrc("blob:https://host/abc"), "");
});

test("stickyThumbNeedsHtmlPaint skips when already painted", () => {
  const a = "data:image/png;base64,aa";
  const b = "data:image/png;base64,bb";
  assert.equal(stickyThumbNeedsHtmlPaint(a, a, "a", "a"), false);
  assert.equal(stickyThumbNeedsHtmlPaint(a, b, "a", "a"), true);
  assert.equal(stickyThumbNeedsHtmlPaint(a, a, "a", "b"), true);
  assert.equal(stickyThumbNeedsHtmlPaint("", "blob:https://host/abc", "a", "a"), false);
});

test("stickyThumbSizeForImage uses max-edge budget so landscape is not crushed", () => {
  // Portrait envelope 300×440 → square budget 440
  // landscape 1216×832 → 440×301 (not 300×205)
  assert.deepEqual(stickyThumbSizeForImage(300, 440, 1216, 832), { w: 440, h: 301 });
  // portrait 832×1216 → 301×440
  assert.deepEqual(stickyThumbSizeForImage(300, 440, 832, 1216), { w: 301, h: 440 });
  // missing image → fallback dims
  assert.deepEqual(stickyThumbSizeForImage(300, 440, 0, 0, 1024, 1024), { w: 440, h: 440 });
  // viewport clamp (narrow phone)
  assert.deepEqual(
    stickyThumbSizeForImage(300, 440, 1216, 832, 0, 0, { width: 360, height: 800, pad: 16 }),
    { w: 328, h: 224 },
  );
});

test("stickyThumbStyleWithSize rewrites width/height only", () => {
  const s = stickyThumbStyleWithSize("position:fixed;right:16px;bottom:16px;width:200px;height:300px", 180, 120);
  assert.match(s, /width:180px/);
  assert.match(s, /height:120px/);
  assert.match(s, /right:16px/);
});

test("probeDataUrlPixelSize reads PNG IHDR", () => {
  // Minimal PNG header bytes: sig + IHDR len/type + 10x20 + rest padded
  const ihdr = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x0a, 0x00, 0x00, 0x00, 0x14,
  ]);
  let b64 = Buffer.from(ihdr).toString("base64");
  const url = `data:image/png;base64,${b64}`;
  assert.deepEqual(probeDataUrlPixelSize(url), { w: 10, h: 20 });
});

test("probeDataUrlPixelSize ignores huge payload tail (header-only parse)", () => {
  const ihdr = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x0a, 0x00, 0x00, 0x00, 0x14,
  ]);
  const b64 = Buffer.from(ihdr).toString("base64") + "A".repeat(2_000_000);
  const url = `data:image/png;base64,${b64}`;
  const t0 = Date.now();
  assert.deepEqual(probeDataUrlPixelSize(url), { w: 10, h: 20 });
  assert.ok(Date.now() - t0 < 200, "header probe must not scan multi-MB payload");
});

test("stickyCornerImageBox places image in viewport corners with pad", () => {
  const box = stickyCornerImageBox("bottom-right", { w: 200, h: 160 }, { width: 1000, height: 800 }, 8);
  assert.ok(box.left > 0);
});

test("stickyCornerEdgeBox anchors with right/bottom so resize does not need left recompute", () => {
  const box = stickyCornerEdgeBox("bottom-right", { w: 200, h: 160 }, 8);
  assert.equal(box.right, 8);
  assert.equal(box.bottom, 8);
});

test("stickyPinEdgeBox keeps pin on corner image via matching edge insets", () => {
  const pin = stickyPinEdgeBox("bottom-right", { w: 200, h: 160 }, 28, 6, 8);
  assert.ok(pin.size === 28);
});

test("stickyPinOverImage centers pin on image top edge", () => {
  assert.deepEqual(stickyPinOverImage({ left: 100, top: 50, w: 200, h: 160 }, 28, 6), { left: 186, top: 44 });
});

test("resolveChatMessageMatch: data-chat-index maps API row even if DOM count differs", () => {
  const messages = [
    { index: 0, role: "user", text: "유저첫말입니다아아아아" },
    { index: 1, role: "char", text: "캐릭터중간응답본문입니다" },
    { index: 2, role: "char", text: "사원증의 이름을 확인하는 순간, 손끝에 와닿는 감촉이" },
  ];
  const hit = resolveChatMessageMatch("아무글자", messages, 0, 1, { chatIndex: 2 });
  assert.equal(hit.chatIndex, 2);
  assert.equal(hit.role, "char");
  assert.equal(hit.matchMethod, "attr");
});

test("resolveChatMessageMatch: DOM#0 newest maps to last API message (reverse only)", () => {
  const messages = [
    { index: 0, role: "user", text: "유저첫말입니다아아아아" },
    { index: 1, role: "char", text: "캐릭터중간응답본문입니다" },
    { index: 2, role: "char", text: "사원증의 이름을 확인하는 순간, 손끝에 와닿는 감촉이" },
  ];
  const hit = resolveChatMessageMatch("아무글자", messages, 0, 3);
  assert.equal(hit.chatIndex, 2);
  assert.equal(hit.role, "char");
  assert.equal(hit.matchMethod, "reverse");
});

test("resolveChatMessageMatch reverse ignores text content", () => {
  const messages = [
    { index: 0, role: "char", text: "첫 인사입니다. 세이칸에 오신 것을 환영합니다." },
    { index: 1, role: "user", text: "태양\n어서오세요 라고합니다" },
    { index: 2, role: "char", text: "볼륨 1: 세이칸의 첫 손님\n챕터 2: 낯선 문턱\n유리문이 닫히며… 태양: 어서 오세요." },
  ];
  // Even if DOM text looks like msg#2, DOM#1 must map to API#1 by reverse only.
  const hit = resolveChatMessageMatch(messages[2].text, messages, 1, 3);
  assert.equal(hit.chatIndex, 1);
  assert.equal(hit.role, "user");
  assert.equal(hit.matchMethod, "reverse");
});

test("resolveChatMessageMatch reverse maps DOM order newest-first", () => {
  const messages = [
    { index: 0, role: "char", text: "안녕하세요여긴첫번째" },
    { index: 1, role: "user", text: "하이라고합니다유저" },
    { index: 2, role: "char", text: "반가워요여긴최신캐릭터" },
  ];
  assert.equal(resolveChatMessageMatch("관련없는짧은", messages, 0, 3).chatIndex, 2);
  assert.equal(resolveChatMessageMatch("관련없는짧은", messages, 1, 3).chatIndex, 1);
  assert.equal(resolveChatMessageMatch("관련없는짧은", messages, 2, 3).chatIndex, 0);
  assert.equal(resolveChatMessageMatch(messages[1].text, messages, 1, 3).role, "user");
  assert.equal(resolveChatMessageMatch(messages[1].text, messages, 1, 3).matchMethod, "reverse");
});

test("resolveChatMessageMatch out-of-range DOM clamps by reverse", () => {
  const messages = [
    { index: 0, role: "user", text: "짧은유저말입니다요" },
    { index: 1, role: "char", text: "긴캐릭터응답본문입니다요" },
  ];
  // reverseIdx = 2-1-9 = -8 → clamp to 0
  const hit = resolveChatMessageMatch("긴캐릭터응답본문입니다요", messages, 9, 2);
  assert.equal(hit.matchMethod, "reverse");
  assert.equal(hit.chatIndex, 0);
  assert.equal(hit.role, "user");
});

test("AOS case: DOM#1 (char bubble under newest user) maps to API char by reverse", () => {
  const option = "😀1. 가게 안을 한 번 더 정리하고, 오후 손님을 기다리며 휴식";
  const charBody = "마사지실을 나서며 유카코는 한 번 몸을 크게 젖혔다. 네, 오늘은 상체 코스라 4천엔입니다.";
  const messages = [
    { index: 5, role: "user", text: "이전유저입력입니다요" },
    { index: 6, role: "char", text: charBody },
    { index: 7, role: "user", text: option },
  ];
  // Newest DOM#0 = user option → API#7; DOM#1 = char bubble → API#6
  assert.equal(resolveChatMessageMatch(option, messages, 0, 3).chatIndex, 7);
  assert.equal(resolveChatMessageMatch(option, messages, 0, 3).role, "user");
  const charHit = resolveChatMessageMatch(`헤더\n${charBody}\n${option}`, messages, 1, 3);
  assert.equal(charHit.chatIndex, 6);
  assert.equal(charHit.role, "char");
  assert.equal(charHit.matchMethod, "reverse");
});

test("selection role uses message.role, not generationInfo presence", () => {
  assert.equal(hasGenerationInfo({ generationInfo: { model: "gpt" } }), true);
  assert.equal(roleFromGenerationInfo({ role: "char" }), "user"); // geninfo hint only
  assert.equal(isCharMessageRole({ role: "char" }), true);
  assert.equal(isCharMessageRole({ role: "char", generationInfo: null }), true);
  assert.equal(isCharMessageRole({ role: "user", generationInfo: { model: "x" } }), false);
  assert.equal(isCharMessageRole("assistant"), true);
  assert.equal(isCharMessageRole("bot"), true);
  assert.equal(isCharMessageRole("model"), true);
  assert.equal(normalizeMessageRole("model"), "char");
  assert.equal(normalizeMessageRole("assistant"), "char");
  const hit = resolveChatMessageMatch("오프닝문구입니다아", [{ index: 0, role: "char", text: "오프닝문구입니다아" }], 0, 1);
  assert.equal(hit.role, "char");
  assert.equal(hit.matchMethod, "reverse");
});

test("pickInlineKeepDomIndices allRoles keeps selected ±4", () => {
  const roles = Array.from({ length: 11 }, (_, i) => i % 2 ? "char" : "user");
  const isCharAt = (i) => isCharMessageRole(roles[i]);
  assert.deepEqual(
    pickInlineKeepDomIndices({ selIdx: 5, length: 11, allRoles: true, isCharAt }).sort((a, b) => a - b),
    [1, 2, 3, 4, 5, 6, 7, 8, 9],
  );
  assert.equal(INLINE_KEEP_MAX_PER_SIDE, 4);
});

test("pickInlineKeepDomIndices skips users and keeps 4 eligible chars each side", () => {
  // DOM newest-first. User turns are crossed but never retained.
  const roles = ["char", "user", "char", "user", "char", "user", "char", "user", "user", "user", "char", "user", "char", "user", "char", "user", "char"];
  const isCharAt = (i) => isCharMessageRole(roles[i]);
  assert.deepEqual(
    pickInlineKeepDomIndices({ selIdx: 8, length: 17, allRoles: false, isCharAt }).sort((a, b) => a - b),
    [0, 2, 4, 6, 10, 12, 14, 16],
  );
});

test("pickInlineKeepDomIndices skips lightboard-only bodies like users", () => {
  const roles = ["char", "char", "char", "user", "char", "user", "char", "char", "char"];
  const skip = new Set([2, 6]);
  const isCharAt = (i) => isCharMessageRole(roles[i]);
  const isSkipBodyAt = (i) => skip.has(i);
  assert.deepEqual(
    pickInlineKeepDomIndices({ selIdx: 4, length: 9, allRoles: false, isCharAt, isSkipBodyAt }).sort((a, b) => a - b),
    [0, 1, 4, 7, 8],
  );
});

test("prefetchInlineRoleDomIndices asks sel ±4 and clamps to the chat", () => {
  assert.equal(INLINE_ROLE_PREFETCH_RADIUS, 4);
  assert.deepEqual(prefetchInlineRoleDomIndices({ selIdx: 4, length: 9 }), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(prefetchInlineRoleDomIndices({ selIdx: 0, length: 2 }), [0, 1]);
  assert.deepEqual(prefetchInlineRoleDomIndices({ selIdx: 1, length: 2 }), [0, 1]);
  assert.deepEqual(prefetchInlineRoleDomIndices({ selIdx: 0, length: 1 }), [0]);
  assert.deepEqual(prefetchInlineRoleDomIndices({ selIdx: 0, length: 0 }), []);
  assert.deepEqual(prefetchInlineRoleDomIndices({ selIdx: -1, length: 5 }), []);
});

test("inlinePaintKey ignores card order and DOM slot, but not scale, chips or pending", () => {
  const base = { cardIds: ["b", "a"], scalePct: 100, msgActions: "on", pending: false, domIndex: 3 };
  assert.equal(inlinePaintKey(base), inlinePaintKey({ ...base, cardIds: ["a", "b"] }));
  assert.equal(inlinePaintKey(base), inlinePaintKey({ ...base, cardIds: ["a", "b", "a"] }));
  // A new message renumbers every slot in a newest-first chat. Keying on the
  // slot repainted the whole keep window, and every repaint flashes. The chip
  // bar's x-inlay-msg-index is updated with one setAttribute instead.
  assert.equal(inlinePaintKey(base), inlinePaintKey({ ...base, domIndex: 4 }));
  assert.notEqual(inlinePaintKey(base), inlinePaintKey({ ...base, scalePct: 120 }));
  assert.notEqual(inlinePaintKey(base), inlinePaintKey({ ...base, msgActions: "off" }));
  assert.notEqual(inlinePaintKey(base), inlinePaintKey({ ...base, pending: true }));
  assert.notEqual(inlinePaintKey(base), inlinePaintKey({ ...base, cardIds: ["a"] }));
  // Out-of-range scale clamps the same way the injector does, so 0/NaN cannot
  // silently produce a key that never matches.
  assert.equal(inlinePaintKey({ scalePct: 5 }), inlinePaintKey({ scalePct: 25 }));
  assert.equal(inlinePaintKey({ scalePct: "nope" }), inlinePaintKey({ scalePct: 100 }));
});

test("pickInlineRepaintIndices skips bubbles whose fingerprint is unchanged", () => {
  const keyA = inlinePaintKey({ cardIds: ["a"], scalePct: 100, msgActions: "on" });
  const keyB = inlinePaintKey({ cardIds: ["b"], scalePct: 100, msgActions: "on" });
  const painted = new Map([["h2", keyA], ["h3", keyB]]);
  const rows = [
    { idx: 1, hash: "h1", key: keyA },
    { idx: 2, hash: "h2", key: keyA },
    { idx: 3, hash: "h3", key: keyB },
  ];
  assert.deepEqual(pickInlineRepaintIndices({ rows, painted }), { repaint: [1], skip: [2, 3] });

  // A changed card list on an already-painted bubble must repaint.
  assert.deepEqual(
    pickInlineRepaintIndices({ rows: [{ idx: 2, hash: "h2", key: keyB }], painted }).repaint,
    [2],
  );
  // Scale change invalidates every bubble at once.
  const scaled = rows.map((r) => ({ ...r, key: `${r.key}!` }));
  assert.deepEqual(pickInlineRepaintIndices({ rows: scaled, painted }).skip, []);
  // No hash means no identity — never skip on DOM index alone.
  assert.deepEqual(
    pickInlineRepaintIndices({ rows: [{ idx: 2, hash: "", key: keyA }], painted }).repaint,
    [2],
  );
  // Plain objects work as the painted map, and duplicate rows collapse.
  assert.deepEqual(
    pickInlineRepaintIndices({
      rows: [{ idx: 2, hash: "h2", key: keyA }, { idx: 2, hash: "h2", key: keyB }],
      painted: { h2: keyA },
    }),
    { repaint: [], skip: [2] },
  );
  assert.deepEqual(pickInlineRepaintIndices(), { repaint: [], skip: [] });
});

test("inlinePaintKeyHasCards rejects an empty card list", () => {
  assert.equal(inlinePaintKeyHasCards(inlinePaintKey({ cardIds: ["a"] })), true);
  assert.equal(inlinePaintKeyHasCards(inlinePaintKey({ cardIds: [] })), false);
  assert.equal(inlinePaintKeyHasCards(inlinePaintKey({})), false);
  assert.equal(inlinePaintKeyHasCards(""), false);
});

test("shouldStripEmptyInlineDesired holds live shots unless the miss is confirmed", () => {
  assert.equal(shouldStripEmptyInlineDesired({ liveShotCount: 0 }), true);
  assert.equal(shouldStripEmptyInlineDesired({ liveShotCount: 2 }), false);
  assert.equal(shouldStripEmptyInlineDesired({ liveShotCount: 2, confirmedEmpty: true }), true);
  assert.equal(shouldStripEmptyInlineDesired({ liveShotCount: 2, forceStrip: true }), true);
  assert.equal(shouldStripEmptyInlineDesired({}), true);
});

test("allowInlineImagesOnRole blocks user unless allRoles", () => {
  assert.equal(allowInlineImagesOnRole("user", false), false);
  assert.equal(allowInlineImagesOnRole("char", false), true);
  assert.equal(allowInlineImagesOnRole("user", true), true);
});

test("shouldMountMsgActions is char-only and needs 20 real body chars", () => {
  const body20 = "가나다라마바사아자차카타파하아야어여로와";
  assert.equal(body20.replace(/\s+/g, "").length, MSG_ACTION_MIN_BODY_CHARS);
  assert.equal(shouldMountMsgActions({ role: "char", text: body20 }), true);
  assert.equal(shouldMountMsgActions({ role: "assistant", text: body20 }), true);
  assert.equal(shouldMountMsgActions({ role: "bot", text: body20 }), true);
  assert.equal(shouldMountMsgActions({ role: "model", text: body20 }), true);
  assert.equal(shouldMountMsgActions({ role: "user", text: body20 }), false);
  assert.equal(shouldMountMsgActions({ role: "char", text: "짧음" }), false);
  assert.equal(shouldMountMsgActions({ role: "char", text: "" }), false);
  assert.equal(shouldMountMsgActions({ role: "", text: body20 }), false);
  assert.equal(shouldMountMsgActions({
    role: "char",
    text: `[LBDATA START]\n${"위키".repeat(40)}\n[LBDATA END]\n짧음`,
  }), false);
});

test("msgActionWantedEnds puts the top bar only above 500 real body chars", () => {
  const body20 = "가나다라마바사아자차카타파하아야어여로와";
  const bodyAtLimit = "가".repeat(MSG_ACTION_TOP_MIN_BODY_CHARS);
  const bodyOver = "가".repeat(MSG_ACTION_TOP_MIN_BODY_CHARS + 1);
  assert.equal(MSG_ACTION_TOP_MIN_BODY_CHARS, 500);
  assert.equal(body20.replace(/\s+/g, "").length, MSG_ACTION_MIN_BODY_CHARS);
  assert.deepEqual(msgActionWantedEnds({ hostCount: 2, text: body20 }), ["bot"]);
  assert.deepEqual(msgActionWantedEnds({ hostCount: 2, text: bodyAtLimit }), ["bot"]);
  assert.deepEqual(msgActionWantedEnds({ hostCount: 2, text: bodyOver }), ["top", "bot"]);
  assert.deepEqual(msgActionWantedEnds({ hostCount: 1, text: body20 }), []);
  assert.deepEqual(msgActionWantedEnds({ hostCount: 1, text: bodyOver }), ["top"]);
  assert.deepEqual(msgActionWantedEnds({ hostCount: 2, text: "짧음" }), []);
  assert.deepEqual(msgActionWantedEnds({
    hostCount: 2,
    text: `[LBDATA START]\n${"위키".repeat(200)}\n[LBDATA END]\n${body20}`,
  }), ["bot"]);
});

test("msgFanWantedEnds keeps only the bottom row at 500 chars or less", () => {
  const body20 = "가나다라마바사아자차카타파하아야어여로와";
  const bodyAtLimit = "가".repeat(MSG_ACTION_TOP_MIN_BODY_CHARS);
  const bodyOver = "가".repeat(MSG_ACTION_TOP_MIN_BODY_CHARS + 1);
  assert.deepEqual(msgFanWantedEnds({ text: body20 }), ["bottom"]);
  assert.deepEqual(msgFanWantedEnds({ text: bodyAtLimit }), ["bottom"]);
  assert.deepEqual(msgFanWantedEnds({ text: bodyOver }), ["top", "bottom"]);
  assert.deepEqual(msgFanWantedEnds({ text: "짧음" }), []);
});

test("inlineRoleDisposition holds an unresolved role instead of treating it as user", () => {
  assert.equal(inlineRoleDisposition("", false), "hold");
  assert.equal(inlineRoleDisposition(null, false), "hold");
  assert.equal(inlineRoleDisposition("char", false), "allow");
  assert.equal(inlineRoleDisposition("assistant", false), "allow");
  assert.equal(inlineRoleDisposition("user", false), "deny");
  assert.equal(inlineRoleDisposition("user", true), "allow");
});

test("selectionSlotDrifted detects newest-first steal", () => {
  assert.equal(selectionSlotDrifted("char-hash", "user-hash"), true);
  assert.equal(selectionSlotDrifted("same", "same"), false);
  assert.equal(selectionSlotDrifted("char-hash", ""), false);
});

test("liveBubbleHash prefers resolved DOM hash over sel.hash", () => {
  assert.equal(liveBubbleHash({ liveHash: "live", selHash: "sel", idx: 0, selIdx: 0 }), "live");
  assert.equal(liveBubbleHash({ liveHash: "", selHash: "sel", idx: 0, selIdx: 0 }), "sel");
  assert.equal(liveBubbleHash({ liveHash: "", selHash: "sel", idx: 1, selIdx: 0 }), "");
});

test("roleForInlineBubble trusts sel.role only when the slot hash still matches", () => {
  assert.equal(roleForInlineBubble({
    idx: 0,
    selIdx: 0,
    selRole: "char",
    selHash: "h-char",
    liveHash: "h-char",
    matchedRole: "char",
  }), "char");
  assert.equal(roleForInlineBubble({
    idx: 0,
    selIdx: 0,
    selRole: "char",
    selHash: "h-char",
    liveHash: "h-user",
    matchedRole: "user",
    matchedText: "안녕하세요유저입니다요",
    domText: "안녕하세요유저입니다요",
  }), "user");
  assert.equal(roleForInlineBubble({
    idx: 0,
    selIdx: 0,
    selRole: "char",
    selHash: "h-char",
    liveHash: "h-user",
    matchedRole: "",
  }), "");
});

test("roleForInlineBubble rejects reverse-index char on a user body", () => {
  assert.equal(roleForInlineBubble({
    idx: 1,
    selIdx: 0,
    selRole: "char",
    matchedRole: "char",
    matchedText: "긴캐릭터응답본문입니다요정말로길어요",
    domText: "유저가한짧은말",
  }), "");
});

test("cardsForInlineBubble drops char shots on user and on drift", () => {
  const cards = [{ id: "c1" }];
  assert.deepEqual(cardsForInlineBubble({ cards, role: "user", allRoles: false }), []);
  assert.deepEqual(cardsForInlineBubble({ cards, role: "char", allRoles: false }), cards);
  assert.deepEqual(cardsForInlineBubble({ cards, role: "", allRoles: false }), cards);
  assert.deepEqual(cardsForInlineBubble({
    cards,
    role: "char",
    allRoles: false,
    isSelectionSlot: true,
    selHash: "old",
    liveHash: "new",
  }), []);
});

test("same-bubble unresolved role retains only an already-mounted inline frame", () => {
  assert.deepEqual(retainHeldInlineKeepIndices({
    keepIndices: [4],
    previousHashes: ["char-a", "char-b"],
    rows: [
      { idx: 2, hash: "char-a", disposition: "hold" },
      { idx: 4, hash: "char-b", disposition: "allow" },
      { idx: 6, hash: "new-unknown", disposition: "hold" },
      { idx: 8, hash: "old-user", disposition: "deny" },
    ],
  }), [2, 4]);
});

test("pickInlineKeepDomIndices can still request a smaller explicit window", () => {
  // C U C U [C] U C U C — selected char at 4 → sel + 1 above + 1 below
  const roles = ["char", "user", "char", "user", "char", "user", "char", "user", "char"];
  const isCharAt = (i) => isCharMessageRole(roles[i]);
  assert.deepEqual(
    pickInlineKeepDomIndices({
      selIdx: 4,
      length: 9,
      allRoles: false,
      isCharAt,
      maxPerSide: 1,
    }).sort((a, b) => a - b),
    [2, 4, 6],
  );
});

test("a complete listing replaces the gallery cache outright", () => {
  const next = [{ id: "b", created_at: 20 }, { id: "a", created_at: 10 }];
  const got = mergeSessionGallery({ prev: [{ id: "gone", created_at: 5 }], next, total: 2 });
  assert.equal(got.replaced, true);
  assert.deepEqual(got.cards.map((c) => c.id), ["b", "a"]);
});

test("a refetch keeps in-memory image_url on the same card ids", () => {
  const prev = [
    { id: "b", created_at: 20, image_url: "data:image/webp;base64,QQ" },
    { id: "a", created_at: 10, image_url: "data:image/webp;base64,AA" },
  ];
  const next = [{ id: "b", created_at: 20 }, { id: "a", created_at: 10 }];
  const got = mergeSessionGallery({ prev, next, total: 2 });
  assert.equal(got.replaced, true);
  assert.equal(got.cards.find((c) => c.id === "b")?.image_url, "data:image/webp;base64,QQ");
  assert.equal(got.cards.find((c) => c.id === "a")?.image_url, "data:image/webp;base64,AA");
});

test("a windowed listing keeps cards older than the window edge", () => {
  // Session has 5 cards, window returned the newest 2 (edge at 40).
  const prev = [
    { id: "e", created_at: 50 },
    { id: "d", created_at: 40 },
    { id: "c", created_at: 30, content_hash: "h3" },
    { id: "b", created_at: 20, content_hash: "h2" },
  ];
  const next = [{ id: "e", created_at: 50 }, { id: "d", created_at: 40 }];
  const got = mergeSessionGallery({ prev, next, total: 5, windowOldestAt: 40 });
  assert.equal(got.replaced, false);
  assert.equal(got.kept, 2);
  assert.equal(got.dropped, 0);
  assert.deepEqual(got.cards.map((c) => c.id), ["e", "d", "c", "b"]);
});

test("a windowed listing drops cards the window proves are deleted", () => {
  // "d" is inside the window (created_at >= edge) but absent from the response.
  const prev = [{ id: "e", created_at: 50 }, { id: "d", created_at: 40 }, { id: "c", created_at: 30 }];
  const next = [{ id: "e", created_at: 50 }, { id: "z", created_at: 45 }];
  const got = mergeSessionGallery({ prev, next, total: 9, windowOldestAt: 40 });
  assert.equal(got.dropped, 1);
  assert.deepEqual(got.cards.map((c) => c.id), ["e", "z", "c"]);
});

test("an asked hash that comes back empty drops that message's cached cards", () => {
  const prev = [{ id: "old", created_at: 10, content_hash: "hx" }];
  const next = [{ id: "new", created_at: 90, content_hash: "hy" }];
  const got = mergeSessionGallery({
    prev,
    next,
    total: 40,
    windowOldestAt: 80,
    askedHashes: ["hx"],
  });
  assert.equal(got.dropped, 1);
  assert.deepEqual(got.cards.map((c) => c.id), ["new"]);
  // Not asked about → below the edge, so it must survive.
  const untouched = mergeSessionGallery({ prev, next, total: 40, windowOldestAt: 80, askedHashes: [] });
  assert.equal(untouched.dropped, 0);
  assert.deepEqual(untouched.cards.map((c) => c.id), ["new", "old"]);
});

test("a hash fetch below the window edge merges without dropping the window", () => {
  const prev = [{ id: "w1", created_at: 90 }, { id: "w2", created_at: 80 }];
  const next = [{ id: "old", created_at: 5, content_hash: "hz" }];
  const got = mergeSessionGallery({
    prev,
    next,
    total: 300,
    windowOldestAt: null,
    askedHashes: ["hz"],
  });
  assert.equal(got.dropped, 0);
  assert.deepEqual(got.cards.map((c) => c.id), ["w1", "w2", "old"]);
});

test("remapped paint index uses that bubble's cards, never the selection's", () => {
  const shot = { id: "c9", line: 2, shot_index: 0 };
  // DOM0 user clicked, paint remapped to DOM1 char which owns the shot.
  const remap = resolveInlinePaintCards({ selIdx: 0, paintIdx: 1, selCards: [], paintCards: [shot] });
  assert.deepEqual(remap.cards, [shot]);
  assert.equal(remap.skipInline, false);
  assert.equal(remap.source, "remap");
});

test("unresolved remap target holds its shots instead of stripping", () => {
  const held = resolveInlinePaintCards({ selIdx: 0, paintIdx: 1, selCards: [], paintCards: null });
  assert.deepEqual(held.cards, []);
  assert.equal(held.skipInline, true);
  assert.equal(held.source, "unresolved");
});

test("char selection paints its own cards and may strip an empty list", () => {
  const shot = { id: "c1" };
  const own = resolveInlinePaintCards({ selIdx: 3, paintIdx: 3, selCards: [shot], paintCards: null });
  assert.deepEqual(own.cards, [shot]);
  assert.equal(own.skipInline, false);
  assert.equal(own.source, "selection");
  // Cards genuinely deleted on the selected bubble: [] must still strip.
  const cleared = resolveInlinePaintCards({ selIdx: 3, paintIdx: 3, selCards: [], paintCards: null });
  assert.deepEqual(cleared.cards, []);
  assert.equal(cleared.skipInline, false);
});

test("remapped paint target with no cards of its own still strips", () => {
  const empty = resolveInlinePaintCards({ selIdx: 0, paintIdx: 1, selCards: [], paintCards: [] });
  assert.deepEqual(empty.cards, []);
  assert.equal(empty.skipInline, false);
  assert.equal(empty.source, "remap");
});

test("keepReadyInlineWithPersist skips a ready shot only after its bake token", () => {
  const body = "안녕\n[[@inray::card-1::inxshot_card-1.webp]]\n커피";
  assert.equal(keepReadyInlineWithPersist(false, body, { cardId: "card-1", pending: false }), true);
  assert.equal(keepReadyInlineWithPersist(true, body, { cardId: "card-1", pending: true }), true);
  assert.equal(keepReadyInlineWithPersist(true, "안녕", { cardId: "card-1", pending: false }), true);
  assert.equal(keepReadyInlineWithPersist(true, body, { cardId: "card-1", pending: false }), false);
  assert.equal(keepReadyInlineWithPersist(true, '<div data-inlay-inline-shot="card-1">', { cardId: "card-1", pending: false }), true);
  assert.equal(keepReadyInlineWithPersist(true, '<div data-inray-bake="1" data-inlay-inline-shot="card-1">', { cardId: "card-1", pending: false }), false);
});

test("desiredInlinePlacements treats blob URLs as ready", () => {
  const got = desiredInlinePlacements(
    [{ id: "c1", line: 2, shot_index: 0 }],
    [{ line: 2, shot_index: 0 }],
    () => "blob:https://host/abc",
  );
  assert.equal(got.placements.length, 1);
  assert.equal(got.placements[0].pending, false);
  assert.equal(got.encodeLater.length, 0);
});

test("desiredInlinePlacements claims ready cards before pending on the same line", () => {
  const src = (card) => String(card.id === "c1" ? "data:image/png;base64,xx" : "");
  const got = desiredInlinePlacements(
    [{ id: "c1", line: 2, shot_index: 0 }],
    [{ line: 2, shot_index: 0 }, { line: 5, shot_index: 1 }],
    src,
  );
  assert.deepEqual(
    got.placements.map((p) => ({ line: p.line, cardId: p.cardId, pending: !!p.pending })),
    [
      { line: 2, cardId: "c1", pending: false },
      { line: 5, cardId: "pending-1", pending: true },
    ],
  );
  assert.equal(got.encodeLater.length, 0);
});

test("desiredInlinePlacements holds a linked card without bytes so pending cannot cover it", () => {
  const got = desiredInlinePlacements(
    [{ id: "c2", line: 3, shot_index: 1, aspect: "square" }],
    [{ line: 3, shot_index: 1, aspect: "portrait" }, { line: 4, shot_index: 2, aspect: "landscape" }],
    () => "",
  );
  assert.deepEqual(got.encodeLater.map((c) => c.id), ["c2"]);
  assert.deepEqual(
    got.placements.map((p) => ({ line: p.line, cardId: p.cardId, pending: !!p.pending })),
    [
      { line: 3, cardId: "c2", pending: true },
      { line: 4, cardId: "pending-2", pending: true },
    ],
  );
  assert.deepEqual(got.placements.map((p) => p.aspect), ["square", "landscape"]);
});

test("desiredInlinePlacements copies comic kind onto pending placements", () => {
  const got = desiredInlinePlacements(
    [],
    [{ line: 2, shot_index: 0, kind: "comic" }],
    () => "",
  );
  assert.equal(got.placements[0].kind, "comic");
  const html = markerBlockHtml(got.placements[0]);
  assert.ok(html.includes(inlinePlaceholderSrc({ aspect: got.placements[0].aspect, kind: "comic" })));
});

test("desiredInlinePlacements keeps distinct pending shot slots on one line", () => {
  const got = desiredInlinePlacements(
    [],
    [
      { line: 2, shot_index: 0 },
      { line: 2, shot_index: 1 },
    ],
    () => "",
  );
  assert.deepEqual(
    got.placements.map((p) => ({ id: p.cardId, line: p.line, shot: p.shotIndex })),
    [
      { id: "pending-0", line: 2, shot: 0 },
      { id: "pending-1", line: 2, shot: 1 },
    ],
  );
});

test("desiredInlinePlacements emits one frame per stable shot slot", () => {
  const got = desiredInlinePlacements(
    [
      { id: "first", line: 2, shot_index: 0 },
      { id: "duplicate-slot", line: 5, shot_index: 0 },
      { id: "duplicate-line", line: 2, shot_index: 3 },
    ],
    [],
    () => "data:image/png;base64,same",
  );
  assert.deepEqual(
    got.placements.map((p) => ({ id: p.cardId, line: p.line, shot: p.shotIndex })),
    [
      { id: "first", line: 2, shot: 0 },
      { id: "duplicate-line", line: 2, shot: 3 },
    ],
  );
});

test("duplicate mounted frames keep the desired card for each stable slot", async () => {
  const viewerCore = await import("../.test-build/viewer-core.mjs");
  assert.equal(typeof viewerCore.partitionInlineFrameDuplicates, "function");
  const rows = [
    { id: "old", slot: "s0", ready: true, duplicate: false },
    { id: "current", slot: "s0", ready: true, duplicate: false },
    { id: "slot-1", slot: "s1", ready: true, duplicate: false },
    { id: "slot-1-copy", slot: "s1", ready: false, duplicate: true },
    { id: "current", slot: "l2", ready: true, duplicate: false },
  ];
  assert.deepEqual(
    viewerCore.partitionInlineFrameDuplicates(rows, [
      { cardId: "current", shotIndex: 0, line: 2, src: "data:image/png;base64,a" },
      { cardId: "slot-1", shotIndex: 1, line: 4, src: "data:image/png;base64,b" },
    ]),
    { keep: [1, 2], duplicates: [0, 3, 4] },
  );
  assert.deepEqual(
    viewerCore.partitionInlineFrameDuplicates(
      [{ id: "only", slot: "s0", ready: true, duplicate: true }],
      [],
    ),
    { keep: [0], duplicates: [] },
  );
  assert.deepEqual(
    viewerCore.partitionInlineFrameDuplicates(
      [
        { id: "slot-a", slot: "s0", ready: true },
        { id: "slot-b", slot: "s0", ready: true },
        { id: "slot-b", slot: "s1", ready: true },
      ],
      [
        { cardId: "slot-a", shotIndex: 0, line: 2, src: "data:image/png;base64,a" },
        { cardId: "slot-b", shotIndex: 1, line: 4, src: "data:image/png;base64,b" },
      ],
    ),
    { keep: [0, 2], duplicates: [1] },
  );
  assert.deepEqual(
    viewerCore.partitionInlineFrameDuplicates(
      [
        { id: "slot-b", slot: "s0", ready: true },
        { id: "slot-a", slot: "s9", ready: true },
        { id: "other", slot: "s1", ready: true },
      ],
      [
        { cardId: "slot-a", shotIndex: 0, line: 2, src: "data:image/png;base64,a" },
        { cardId: "slot-b", shotIndex: 1, line: 4, src: "data:image/png;base64,b" },
      ],
    ),
    { keep: [0, 2], duplicates: [1] },
  );
});

test("runBoundedPool caps concurrency at the limit", async () => {
  const releases = [];
  const gates = [0,1,2].map(i => new Promise(resolve => { releases[i] = resolve; }));
  const started = [], finished = [];
  let inflight = 0, maxInflight = 0;
  const done = runBoundedPool(gates, 2, async (gate, i) => {
    started.push(i); maxInflight = Math.max(maxInflight, ++inflight);
    await gate; inflight--; finished.push(i);
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(started, [0,1]);
  releases[1](); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(started, [0,1,2]);
  releases[2](); await new Promise(resolve => setImmediate(resolve));
  releases[0](); await done;
  assert.equal(maxInflight, 2);
  assert.deepEqual(finished, [1,2,0]);
});

test("a cell a live subscription owns counts as finished work", () => {
  // The marker is placed and its <img> is empty, but the id has a watcher that
  // fills it when the encode lands. Repainting would only flash the bubble.
  assert.equal(
    canSkipInlineInject({
      scaleMatches: true,
      liveShotCount: 1,
      wantIdCount: 1,
      readyImgCount: 0,
      awaitingCount: 1,
    }),
    true,
  );
});

test("inject skip needs a live img src, not just leftover wrappers", () => {
  // Chat hop / Risu rewrite can keep data-inlay-inline-shot wrappers after the
  // <img src> is gone. Nothing is watching those cells, so they must repaint.
  assert.equal(
    canSkipInlineInject({
      scaleMatches: true,
      liveShotCount: 1,
      wantIdCount: 1,
      readyImgCount: 0,
      awaitingCount: 0,
    }),
    false,
  );
  assert.equal(
    canSkipInlineInject({
      scaleMatches: true,
      liveShotCount: 1,
      wantIdCount: 1,
      readyImgCount: 1,
      awaitingCount: 0,
    }),
    true,
  );
});

test("inject skip refuses a bubble that already has two copies of one shot", () => {
  assert.equal(
    canSkipInlineInject({
      scaleMatches: true,
      liveShotCount: 2,
      liveUniqueCount: 1,
      wantIdCount: 2,
      readyImgCount: 2,
    }),
    false,
  );
  assert.equal(
    canSkipInlineInject({
      scaleMatches: true,
      liveShotCount: 2,
      liveUniqueCount: 2,
      wantIdCount: 2,
      readyImgCount: 2,
    }),
    true,
  );
});

test("inject skip still needs matching scale and marker count", () => {
  assert.equal(
    canSkipInlineInject({ scaleMatches: false, liveShotCount: 1, wantIdCount: 1, readyImgCount: 1 }),
    false,
  );
  assert.equal(
    canSkipInlineInject({ scaleMatches: true, liveShotCount: 0, wantIdCount: 1, readyImgCount: 0 }),
    false,
  );
  assert.equal(
    canSkipInlineInject({ scaleMatches: true, liveShotCount: 0, wantIdCount: 0 }),
    true,
  );
});

test("runBoundedPool ignores a bad limit and empty list", async () => {
  const seen = [];
  await runBoundedPool(null, 0, async (item) => {
    seen.push(item);
  });
  assert.deepEqual(seen, []);
  await runBoundedPool(["a"], 0, async (item) => {
    seen.push(item);
  });
  assert.deepEqual(seen, ["a"]);
});

test("desiredInlinePaintKey changes when pending becomes a card", () => {
  const pending = desiredInlinePaintKey([{ line: 1, src: "", cardId: "pending-0", pending: true }]);
  const ready = desiredInlinePaintKey([{ line: 1, src: "data:image/png;base64,xx", cardId: "c9", pending: false }]);
  assert.notEqual(pending, ready);
});

test("pendingInlineKey uses shot and line so empty cardId still changes", () => {
  assert.equal(pendingInlineKey(null), "");
  assert.equal(pendingInlineKey([{ shot_index: 0, line: 2 }, { shot_index: 1, line: 5 }]), "0:2|1:5");
  assert.notEqual(pendingInlineKey([{ shot_index: 0, line: 2 }]), "");
});

test("reconcileInlineShot retargets an old frame without replacing it", () => {
  const pending = { line: 1, src: "", cardId: "pending-0", pending: true };
  assert.deepEqual(reconcileInlineShot(pending, { cardId: "old-card", pending: false }), {
    op: "fill",
    placement: pending,
  });
});

test("reconcileInlineShot ready card replaces a spinner", () => {
  const ready = { line: 1, src: "data:image/png;base64,xx", cardId: "c3", pending: false };
  assert.deepEqual(reconcileInlineShot(ready, {
    cardId: "pending-0",
    pending: true,
    layoutVersion: INLINE_FRAME_LAYOUT_VERSION,
  }), {
    op: "fill",
    placement: ready,
  });
});

test("reconcileInlineShot same ready id stays put", () => {
  const ready = { line: 1, src: "data:image/png;base64,xx", cardId: "c3", pending: false };
  assert.equal(reconcileInlineShot(ready, {
    cardId: "c3",
    pending: false,
    layoutVersion: INLINE_FRAME_LAYOUT_VERSION,
  }).op, "keep");
});

test("reconcileInlineShot keeps a same-card frame from an older layout", () => {
  const ready = { line: 1, src: "data:image/png;base64,xx", cardId: "c3", pending: false };
  assert.equal(reconcileInlineShot(ready, {
    cardId: "c3",
    pending: false,
    layoutVersion: "",
  }).op, "keep");
});

test("reconcileInlineShot never strips a live frame when nothing is desired", () => {
  assert.deepEqual(reconcileInlineShot(null, { cardId: "old-card" }), { op: "keep" });
});

test("reconcileInlineShot prepends when the host is empty", () => {
  const pending = { line: 2, src: "", cardId: "pending-1", pending: true };
  assert.deepEqual(reconcileInlineShot(pending, null), { op: "prepend", placement: pending });
});

test("reconcileInlineShot retargets an unread live frame instead of replacing it", () => {
  const pending = { line: 1, src: "", cardId: "pending-0", pending: true };
  assert.deepEqual(reconcileInlineShot(pending, { cardId: "", pending: false }), {
    op: "fill",
    placement: pending,
  });
});

test("reconcileInlineShot retargets an existing spinner when ids do not match", () => {
  const pending = { line: 1, src: "", cardId: "pending-0", pending: true };
  const layoutVersion = INLINE_FRAME_LAYOUT_VERSION;
  assert.equal(reconcileInlineShot(pending, { cardId: "", pending: true, layoutVersion }).op, "fill");
  assert.equal(reconcileInlineShot(pending, { cardId: "pending-1", pending: true, layoutVersion }).op, "fill");
});

test("reconcileInlineShot retargets a linked card that still has no bytes", () => {
  const hold = { line: 3, src: "", cardId: "c2", pending: false };
  assert.equal(reconcileInlineShot(hold, { cardId: "pending-1", pending: true }).op, "fill");
});

test("leftover strip ignores unread ids so a just-placed shot is not deleted", () => {
  assert.equal(shouldStripLeftoverInlineId("", ["c3"]), false);
  assert.equal(shouldStripLeftoverInlineId("c3", ["c3"]), false);
  assert.equal(shouldStripLeftoverInlineId("old-card", ["c3", "pending-0"]), true);
});

test("leftover strip still removes known stale ids when nothing new is ready", () => {
  assert.equal(shouldScanInlineLeftovers(0), true);
  assert.equal(shouldScanInlineLeftovers(4), true);
  assert.equal(shouldStripLeftoverInlineId("old-card", []), true);
  assert.equal(shouldStripLeftoverInlineId("old-card", new Set()), true);
  assert.equal(shouldStripLeftoverInlineId("", []), false);
});

test("leftover strip never deletes a just-placed marker with an unread id", () => {
  assert.equal(shouldStripLeftoverInlineId("", ["pending-0"], true), false);
  assert.equal(shouldStripLeftoverInlineId("pending-0", ["pending-0"], true), false);
  assert.equal(shouldStripLeftoverInlineId("old-card", ["pending-0"], true), true);
});

test("leftover strip drops a second wrapper that repeats a keep id", () => {
  const seen = new Set();
  assert.equal(shouldStripLeftoverInlineId("c3", ["c3"], false, seen), false);
  assert.equal(shouldStripLeftoverInlineId("c3", ["c3"], false, seen), true);
  assert.equal(shouldStripLeftoverInlineId("c4", ["c3", "c4"], false, seen), false);
});

test("rawMessageRole reads API fields like Archive (never invents from body)", () => {
  assert.equal(rawMessageRole({ role: "user" }), "user");
  assert.equal(rawMessageRole({ role: "char" }), "char");
  assert.equal(rawMessageRole({ role: "assistant" }), "char");
  assert.equal(rawMessageRole({ type: "bot" }), "char");
  assert.equal(rawMessageRole({ isUser: true, role: "char" }), "user");
  assert.equal(rawMessageRole({ isChar: true }), "char");
  assert.equal(rawMessageRole({ role: "system" }), "system");
  assert.equal(rawMessageRole({ text: "태양" }), "");
});

test("visibleGalleryImageIds returns nearby unique ids", () => {
  const items = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
  assert.deepEqual(visibleGalleryImageIds(items, 0, 1, 3), ["a", "b", "c"]);
  assert.deepEqual(visibleGalleryImageIds(items, 2, 1, 3), ["b", "c", "d"]);
  assert.deepEqual(visibleGalleryImageIds(items, 1, 0, 1), ["b"]);
});

test("visibleGalleryImageIds caps eager loads at maxCount 8", () => {
  const items = Array.from({ length: 12 }, (_, i) => ({ id: `i${i}` }));
  assert.equal(visibleGalleryImageIds(items, 5, 10, 8).length, 8);
});

test("visibleGalleryImageIds never warms more than VIEWER_WARM_WINDOW_MAX even when asked for the whole strip", () => {
  // The frozen viewer passes maxCount = max(8, strip length) on every arrow
  // press, so a reroll-heavy message used to warm its entire strip per step.
  const items = Array.from({ length: 40 }, (_, i) => ({ id: `i${i}` }));
  const ids = visibleGalleryImageIds(items, 20, 1, Math.max(8, items.length));
  assert.equal(ids.length, VIEWER_WARM_WINDOW_MAX);
  assert.ok(ids.includes("i20"));
  assert.ok(ids.includes("i15") && ids.includes("i25"), "window stays centered on the focus");
  assert.ok(!ids.includes("i0") && !ids.includes("i39"));
});

test("nearbyMessageImageIds drops the farthest neighbours first past NEARBY_IMAGE_MAX", () => {
  const cards = [];
  for (let mi = 0; mi < 5; mi += 1) {
    for (let k = 0; k < 10; k += 1) cards.push({ id: `m${mi}-${k}`, session_id: "s", message_index: mi });
  }
  const ids = nearbyMessageImageIds(cards, { messageIndex: 2, sessionId: "s" }, 2, ["m2-3"]);
  assert.equal(ids.length, NEARBY_IMAGE_MAX);
  for (let k = 0; k < 10; k += 1) assert.ok(ids.includes(`m2-${k}`), "every shot of the focus message stays");
  assert.ok(ids.every((id) => !id.startsWith("m0-") && !id.startsWith("m4-")), "±2 falls off before ±1");
  assert.equal(ids[0], "m2-3", "explicit ids (current sticky markers) keep the head of the list");
});

test("visibleGalleryImageIds pins current-message prefix when focus is on the right strip", () => {
  const items = Array.from({ length: 11 }, (_, i) => ({ id: `i${i}` }));
  // 3 current + 8 others; focus on last other — left 3 must still warm.
  const ids = visibleGalleryImageIds(items, 10, 1, 11, 3);
  assert.ok(ids.includes("i0"));
  assert.ok(ids.includes("i1"));
  assert.ok(ids.includes("i2"));
  assert.equal(ids.length, 11);
});

test("nearbyMessageImageIds warms focus message ±1 by message_index", () => {
  const cards = [
    { id: "a", session_id: "s", message_index: 0 },
    { id: "b", session_id: "s", message_index: 1 },
    { id: "c", session_id: "s", message_index: 2 },
    { id: "d", session_id: "s", message_index: 3 },
    { id: "x", session_id: "other", message_index: 1 },
  ];
  const ids = nearbyMessageImageIds(cards, { messageIndex: 1, sessionId: "s" }, 1, ["b"]);
  assert.deepEqual(ids.sort(), ["a", "b", "c"]);
});

test("nearbyMessageImageIds default radius is ±2", () => {
  const cards = [
    { id: "a", session_id: "s", message_index: 0 },
    { id: "b", session_id: "s", message_index: 1 },
    { id: "c", session_id: "s", message_index: 2 },
    { id: "d", session_id: "s", message_index: 3 },
    { id: "e", session_id: "s", message_index: 4 },
  ];
  const ids = nearbyMessageImageIds(cards, { messageIndex: 2, sessionId: "s" });
  assert.deepEqual(ids.sort(), ["a", "b", "c", "d", "e"]);
});

test("isNearbyDomIndex and nearbyDomIndexWindow cover ±2", () => {
  assert.equal(isNearbyDomIndex(5, 7, 2), true);
  assert.equal(isNearbyDomIndex(5, 8, 2), false);
  assert.deepEqual(nearbyDomIndexWindow(5, 10, 2), { lo: 3, hi: 7, center: 5 });
  assert.deepEqual(nearbyDomIndexWindow(0, 3, 2), { lo: 0, hi: 2, center: 0 });
});

test("resolveIndexProgress prefers warm indexing then tagging", () => {
  assert.equal(resolveIndexProgress({ warmBusy: true, warmPct: 40 }).label, "인덱싱");
  assert.equal(resolveIndexProgress({ warmBusy: true, warmPct: 40 }).pct, 40);
  assert.equal(resolveIndexProgress({ jobState: "tagging", jobPct: 55 }).pct, 55);
  assert.equal(resolveIndexProgress({ jobState: "generating", jobPct: 80 }).busy, false);
});

test("composeDualProgressBarsHtml stacks purple then mint rails", () => {
  const html = composeDualProgressBarsHtml({ jobPct: 50, indexPct: 25, jobBusy: true, indexBusy: true });
  assert.match(html, /#7c6cff/);
  assert.match(html, /#2dd4bf/);
  assert.match(html, /width:50%/);
  assert.match(html, /width:25%/);
  assert.match(html, /flex-direction:column/);
});

test("composeProgressToastHtml shows stage and a single rail when busy", () => {
  assert.equal(composeProgressToastHtml({}), "");
  const html = composeProgressToastHtml({
    stage: "장면 태깅",
    meta: "2/4 · 30% · 18s",
    pct: 30,
    busy: true,
  });
  assert.match(html, /data-inlay-progress-toast/);
  assert.match(html, /장면 태깅/);
  assert.match(html, /2\/4 · 30% · 18s/);
  assert.match(html, /#7c6cff/);
  assert.match(html, /width:30%/);
  assert.match(html, /flex-direction:column/);
  assert.match(html, /text-overflow:ellipsis/);
  assert.match(html, /height:3px/);
  assert.match(html, /padding:6px 10px/);
  assert.match(html, /width:min\(280px/);
  assert.match(html, /rgba\(18,24,32,\.42\)/);
  assert.doesNotMatch(html, /#2dd4bf/);
});

test("toastAnchorStyle pins the chip to the chosen corner", () => {
  assert.equal(normalizeToastAnchor("nope"), "tc");
  assert.equal(normalizeToastAnchor("bottom-right"), "br");
  const br = toastAnchorStyle("br", { visible: true });
  assert.match(br, /bottom:52px/);
  assert.match(br, /right:28px/);
  const bl = toastAnchorStyle("bl", { visible: true });
  assert.match(bl, /bottom:52px/);
  assert.match(bl, /left:28px/);
  assert.doesNotMatch(br, /translateX/);
  const stacked = toastAnchorStyle("tc", { shiftPx: 48, visible: true });
  assert.match(stacked, /top:64px/);
  assert.match(stacked, /translateX\(-50%\)/);
  assert.match(toastAnchorStyle("tl", { visible: false }), /display:none/);
});

test("shouldStartImagePressInspect is hold-only — two is double-tap", () => {
  assert.equal(normalizeImagePressInspect(""), "hold");
  assert.equal(normalizeImagePressInspect("double-tap"), "two");
  assert.equal(shouldStartImagePressInspect({ mode: "off", pointerCount: 2 }), false);
  assert.equal(shouldStartImagePressInspect({ mode: "hold", pointerCount: 1 }), true);
  assert.equal(shouldStartImagePressInspect({ mode: "two", pointerCount: 1 }), false);
  assert.equal(shouldStartImagePressInspect({ mode: "two", pointerCount: 2 }), false);
  assert.equal(shouldStartImagePressInspect({ mode: "both", pointerCount: 1 }), true);
  assert.equal(imagePressAllowsHold("two"), false);
  assert.equal(imagePressAllowsDoubleTap("two"), true);
  assert.equal(imagePressAllowsDoubleTap("hold"), false);
  assert.equal(imagePressAllowsDoubleTap("both"), true);
  assert.equal(normalizeImagePressInspect("triple-tap"), "three");
  assert.equal(imagePressAllowsTripleTap("three"), true);
  assert.equal(imagePressAllowsTripleTap("two"), false);
  assert.equal(imagePressAllowsHold("three"), false);
  assert.equal(imagePressAllowsDoubleTap("three"), false);
  assert.equal(imagePressTapNeed("two"), 2);
  assert.equal(imagePressTapNeed("both"), 2);
  assert.equal(imagePressTapNeed("three"), 3);
  assert.equal(imagePressTapNeed("hold"), 0);
});

test("imagePressTapHits counts a fast same-shot streak and fires at the need", () => {
  const a = { prevAt: null, prevCount: 0, now: 1000, x: 40, y: 40, cardId: "shot-a", need: 3 };
  assert.deepEqual(imagePressTapHits(a), { hit: false, count: 1 });
  const b = { prevAt: 1000, prevX: 40, prevY: 40, prevCardId: "shot-a", prevCount: 1, now: 1300, x: 44, y: 42, cardId: "shot-a", need: 3 };
  assert.deepEqual(imagePressTapHits(b), { hit: false, count: 2 });
  const c = { ...b, prevAt: 1300, prevCount: 2, now: 1600 };
  assert.deepEqual(imagePressTapHits(c), { hit: true, count: 3 });
  assert.deepEqual(imagePressTapHits({ ...c, need: 2 }), { hit: true, count: 3 });
  assert.deepEqual(imagePressTapHits({ ...c, now: 2200 }), { hit: false, count: 1 });
  assert.deepEqual(imagePressTapHits({ ...c, cardId: "shot-b" }), { hit: false, count: 1 });
});

test("imagePressDoubleTapHits needs the same shot twice, fast and close", () => {
  const base = { prevAt: 1000, prevX: 40, prevY: 40, prevCardId: "shot-a", now: 1300, x: 44, y: 42, cardId: "shot-a" };
  assert.equal(imagePressDoubleTapHits(base), true);
  assert.equal(imagePressDoubleTapHits({ ...base, cardId: "shot-b" }), false);
  assert.equal(imagePressDoubleTapHits({ ...base, now: 1600 }), false);
  assert.equal(imagePressDoubleTapHits({ ...base, x: 120, y: 120 }), false);
  assert.equal(imagePressDoubleTapHits({ ...base, prevAt: null }), false);
});

test("a leftover second pointer still does not cancel a hold by id", () => {
  assert.equal(imagePressAllowsSecondPointer("hold"), false);
  assert.equal(imagePressAllowsSecondPointer("two"), false);
  assert.equal(imagePressMoveCancels({
    pressPointerId: 1, eventPointerId: 2, fromX: 10, fromY: 10, toX: 80, toY: 80, slopPx: 8,
  }), false);
  assert.equal(imagePressMoveCancels({
    pressPointerId: 1, eventPointerId: 1, fromX: 10, fromY: 10, toX: 80, toY: 80, slopPx: 8,
  }), true);
  assert.equal(imagePressIgnorePointerCancel("two", "inline-shot"), false);
  assert.equal(imagePressIgnorePointerCancel("hold", "inline-shot"), true);
  assert.equal(imagePressOtherPointerUp({ pressPointerId: 1, eventPointerId: 2 }), true);
  assert.equal(imagePressOtherPointerUp({ pressPointerId: 1, eventPointerId: 1 }), false);
});

test("two identical-id touches still count as two downs", () => {
  let downs = noteImagePressDown(null, 1000);
  assert.equal(imagePressDownCount(downs, 1000), 1);
  downs = noteImagePressDown(downs, 1080);
  assert.equal(imagePressDownCount(downs, 1080), 2);
  downs = noteImagePressUp(downs);
  assert.equal(imagePressDownCount(downs, 1200), 1);
});

test("a lost pointerup expires instead of passing one finger off as two", () => {
  const downs = noteImagePressDown(noteImagePressDown(null, 1000), 1050);
  assert.equal(imagePressDownCount(downs, 1600), 2);
  // Each down ages out on its own clock, so a cancelled finger cannot keep the
  // pair alive until the next gesture.
  assert.equal(imagePressDownCount(downs, 5001), 1);
  assert.equal(imagePressDownCount(downs, 5051), 0);
  const late = noteImagePressDown(downs, 5051);
  assert.equal(imagePressDownCount(late, 5051), 1);
});

test("a two-finger hold no longer special-cases jitter — two is double-tap", () => {
  const held = {
    pressPointerId: 1,
    eventPointerId: 1,
    fromX: 10,
    fromY: 10,
    toX: 90,
    toY: 90,
    slopPx: 8,
  };
  assert.equal(imagePressMoveCancels({ ...held, mode: "two", pressCount: 2 }), true);
  assert.equal(imagePressMoveCancels({ ...held, mode: "hold", pressCount: 2 }), true);
});

test("shouldShowSessionAttachToast is once per session until done", () => {
  assert.equal(shouldShowSessionAttachToast({}), true);
  assert.equal(shouldShowSessionAttachToast({ sessionId: "a", doneSessionId: null }), true);
  assert.equal(shouldShowSessionAttachToast({ sessionId: "a", alreadyWanted: true, doneSessionId: "a" }), true);
  assert.equal(shouldShowSessionAttachToast({ sessionId: "a", doneSessionId: "a" }), false);
  assert.equal(shouldShowSessionAttachToast({ sessionId: "b", doneSessionId: "a" }), true);
  assert.equal(shouldShowSessionAttachToast({ sessionId: "", doneSessionId: "" }), false);
  assert.equal(ATTACH_TOAST_MAX_MS, 10000);
});

test("composeAttachToastHtml is a spinner chip, not a progress rail", () => {
  const html = composeAttachToastHtml();
  assert.match(html, /data-inlay-attach-toast/);
  assert.match(html, /인레이 넥서스 조각 불러오는중/);
  assert.match(html, /animateTransform/);
  assert.match(html, /rgba\(18,24,32,\.42\)/);
  assert.doesNotMatch(html, /height:3px/);
});

test("composeProgressToastHtml uses mint rail for indexing tone", () => {
  const html = composeProgressToastHtml({
    stage: "인덱싱",
    meta: "45%",
    pct: 45,
    busy: true,
    tone: "index",
  });
  assert.match(html, /#2dd4bf/);
  assert.match(html, /#5eead4/);
  assert.doesNotMatch(html, /#7c6cff/);
});

test("composeProgressToastHtml can omit the bar for idle selection peeks", () => {
  const html = composeProgressToastHtml({
    stage: "채팅A · 캐릭B",
    meta: "3장 · 오늘 카페에서",
    busy: true,
    showBar: false,
  });
  assert.match(html, /채팅A · 캐릭B/);
  assert.match(html, /3장 · 오늘 카페에서/);
  assert.match(html, /width:min\(280px/);
  assert.doesNotMatch(html, /height:3px/);
  assert.doesNotMatch(html, /#7c6cff/);
});

test("formatProgressElapsedSec formats seconds and minutes", () => {
  assert.equal(formatProgressElapsedSec(0), "0s");
  assert.equal(formatProgressElapsedSec(18_000), "18s");
  assert.equal(formatProgressElapsedSec(65_000), "1m 05s");
});

test("mergeViewerPaintJob keeps the fuller pending mode", () => {
  assert.equal(mergeViewerPaintJob("chrome", "content"), "content");
  assert.equal(mergeViewerPaintJob("content", "chrome"), "content");
});

test("evenAnchorPercent uses equal band starts (0..100 split by count)", () => {
  assert.equal(evenAnchorPercent(0, 3), 0);
  assert.ok(Math.abs(evenAnchorPercent(1, 3) - 100 / 3) < 1e-9);
  assert.ok(Math.abs(evenAnchorPercent(2, 3) - 200 / 3) < 1e-9);
});

test("resolveCardAnchorPercent prefers y_percent unless forceEven", () => {
  assert.equal(resolveCardAnchorPercent({ y_percent: 40 }, 0, 2, { forceEven: false }), 40);
  assert.equal(resolveCardAnchorPercent({ y_percent: 40 }, 1, 2, { forceEven: true }), 50);
});

test("equal band starts map sticky segments to 0-25 / 25-50 / …", () => {
  assert.equal(activeSegmentIndex([0, 25, 50, 75], 10), 0);
  assert.equal(activeSegmentIndex([0, 25, 50, 75], 30), 1);
});

test("stickySegmentForInlineChat prefers shot nearest the pointer", () => {
  const rect = { top: 0, bottom: 100, height: 100, left: 0, right: 200, width: 200 };
  // Mid-message pointer is closer to 75% than 0%/25%/50%.
  assert.equal(stickySegmentForInlineChat({
    inlineChatOn: true,
    pointerX: 100,
    pointerY: 70,
    messageRect: rect,
    markerPercents: [0, 25, 50, 75],
    fallbackSegment: 0,
  }), 3);
  // Off → keep reading-band fallback.
  assert.equal(stickySegmentForInlineChat({
    inlineChatOn: false,
    pointerX: 100,
    pointerY: 70,
    messageRect: rect,
    markerPercents: [0, 25, 50, 75],
    fallbackSegment: 1,
  }), 1);
  // Live DOM center wins over y% projection.
  assert.equal(stickySegmentForInlineChat({
    inlineChatOn: true,
    pointerX: 10,
    pointerY: 12,
    messageRect: rect,
    markerPercents: [0, 90],
    markerCenters: [{ x: 10, y: 10 }, null],
    fallbackSegment: -1,
  }), 0);
  // Pointer inside a live rect wins even when nearer another center.
  assert.equal(stickySegmentForInlineChat({
    inlineChatOn: true,
    pointerX: 55,
    pointerY: 55,
    messageRect: rect,
    markerPercents: [0, 90],
    markerCenters: [{ x: 10, y: 10 }, { x: 90, y: 90 }],
    markerRects: [
      { left: 0, right: 20, top: 0, bottom: 20 },
      { left: 50, right: 80, top: 50, bottom: 80 },
    ],
    fallbackSegment: -1,
  }), 1);
  assert.deepEqual(markerAnchorClientPoint(rect, 50), { x: 100, y: 50 });
  assert.equal(nearestSegmentByClientPoint([{ x: 0, y: 0 }, { x: 100, y: 100 }], 90, 90), 1);
});

test("reading percent and segment index follow 20/40/80 bands", () => {
  // Mid-viewport line on bottom edge still counts as inside → 60%.
  assert.equal(readingPercentInMessage({ top: -10, bottom: 50, height: 100 }, 100, 0.5), 60);
  assert.equal(clampReadingPercent({ top: 80, bottom: 120, height: 40 }, 100, 0.5), 0);
  // Sole marker ≤20% is remapped to 1% → reading 10 already activates segment 0.
  assert.equal(activeSegmentIndex([20, 40, 80], 10), 0);
  assert.equal(activeSegmentIndex([20, 40, 80], 25), 0);
  assert.equal(activeSegmentIndex([40, 80], 10), -1);
});

test("gallerySelectedCount counts unique selected cards", () => {
  const cards = [
    { id: "a", content_hash: "h", message_index: 1 },
    { id: "b", content_hash: "h", message_index: 1 },
  ];
  assert.equal(gallerySelectedCount(cards, { hash: "h", chatIndex: 1 }), 2);
});

test("normalizeMatchText is stable across repeated calls (cache)", () => {
  const s = "Hello, 월드!! [LBDATA START]x[LBDATA END] 123";
  assert.equal(normalizeMatchText(s), normalizeMatchText(s));
  assert.equal(normalizeMatchText(s), "hello월드123");
});

test("prefixMatchRatio links streaming 70% preview to 100% final text", () => {
  const base = "나는천재입니다진짜천재라고요이문장은충분히길어야합니다추가텍스트";
  const partial = base.slice(0, Math.floor(base.length * 0.7));
  const full = base + "그리고완성되었습니다";
  assert.ok(prefixMatchRatio(full, partial) >= 0.6);
  assert.ok(prefixMatchRatio(partial, full) >= 0.6);
  assert.ok(prefixMatchRatio("완전히다른내용입니다완전히다른내용입니다완전히", partial) < 0.6);
});

test("prefixMatchRatio tolerates a few opening-character edits", () => {
  const body = "나는천재입니다진짜천재라고요이문장은충분히길어야합니다추가텍스트그리고더길게";
  const a = `가${body}`;
  const b = `나${body}`;
  assert.ok(prefixMatchRatio(a, b) >= 0.6);
  assert.ok(prefixMatchRatio(a, `완전히다른이야기완전다른이야기완전다른이야기`) < 0.6);
});

test("hostMessageId prefers Risu message ids and ignores card id / chatId", () => {
  assert.equal(hostMessageId({ messageId: "risu-m1", id: "card-or-msg" }), "risu-m1");
  assert.equal(hostMessageId({ id: "raw-msg-9" }), "raw-msg-9");
  assert.equal(hostMessageId({ content_hash: "h", id: "card-uuid", host_message_id: "risu-m2" }), "risu-m2");
  assert.equal(hostMessageId({ content_hash: "h", id: "card-uuid" }), "");
  assert.equal(hostMessageId({ chatId: "chat-only", chat_id: "chat-only" }), "");
  assert.equal(hostMessageId({ generationInfo: { generationId: "gen-3" } }), "gen-3");
});

test("linkCardsForMessage prefers host message id over a drifted hash", () => {
  const cards = [
    { id: "shot", content_hash: "h-old", host_message_id: "risu-m1", paragraph: 0, shot_index: 0, created_at: 1 },
    { id: "other", content_hash: "h-new", host_message_id: "risu-m9", paragraph: 0, shot_index: 1, created_at: 2 },
  ];
  assert.deepEqual(
    linkCardsForMessage(cards, { hash: "h-new", hostMessageId: "risu-m1" }).map((c) => c.id),
    ["shot"],
  );
});

test("linkCardsForMessage is exact hash only", () => {
  const partial = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789가나다라마바사아자차카타파하";
  const full = partial + "EXTRA_TAIL_TEXT_HERE";
  const cards = [
    { id: "old", content_hash: "h-old", assistant_preview: partial, paragraph: 0, shot_index: 0, created_at: 1 },
    { id: "new", content_hash: "h-new", assistant_preview: full, paragraph: 0, shot_index: 0, created_at: 2 },
  ];
  assert.deepEqual(linkCardsForMessage(cards, { hash: "h-new", text: full }).map((c) => c.id), ["new"]);
  assert.deepEqual(linkCardsForMessage(cards, { hash: "h-missing", text: full }), []);
});

test("linkCardsForMessage isolates equal hashes by stored message index", () => {
  const cards = [
    { id: "turn-4", content_hash: "same", message_index: 4, paragraph: 0, shot_index: 0, created_at: 1 },
    { id: "turn-7", content_hash: "same", message_index: 7, paragraph: 1, shot_index: 1, created_at: 2 },
    { id: "legacy", content_hash: "same", message_index: -1, paragraph: 2, shot_index: 2, created_at: 3 },
  ];
  assert.deepEqual(
    linkCardsForMessage(cards, { hash: "same", messageIndex: 7 }).map((card) => card.id),
    ["turn-7", "legacy"],
  );
  assert.deepEqual(
    linkCardsForMessage(cards, { hash: "same", messageIndex: 4 }).map((card) => card.id),
    ["turn-4", "legacy"],
  );
});

test("inline inject ownership stays stable when the same message hash changes", async () => {
  const viewerCore = await import("../.test-build/viewer-core.mjs");
  assert.equal(typeof viewerCore.inlineInjectOwnerKey, "function");
  const before = {
    sessionId: "session-a",
    messageIndex: 7,
    hash: "streaming-hash",
  };
  const after = {
    sessionId: "session-a",
    messageIndex: 7,
    hash: "final-hash",
  };
  assert.equal(viewerCore.inlineInjectOwnerKey(before, 3), viewerCore.inlineInjectOwnerKey(after, 3));
  assert.notEqual(
    viewerCore.inlineInjectOwnerKey(before, 3),
    viewerCore.inlineInjectOwnerKey({ ...after, messageIndex: 8 }, 3),
  );
});

test("findCardsForMessageIdentity matches turn without hash/Dice", () => {
  const base = {
    id: "c1",
    content_hash: "h-stream",
    character_id: "charA",
    chat_id: "chatA",
    session_id: "sessA",
    message_index: 36,
    message_role: "char",
    paragraph: 0,
    shot_index: 0,
    created_at: 1,
  };
  const identity = {
    characterId: "charA",
    chatId: "chatA",
    sessionId: "sessA",
    messageIndex: 36,
    role: "assistant",
  };
  assert.deepEqual(findCardsForMessageIdentity([base], identity).map((c) => c.id), ["c1"]);
  assert.deepEqual(findCardsForMessageIdentity([{ ...base, content_hash: "h-final" }], identity).map((c) => c.id), ["c1"]);
  assert.deepEqual(findCardsForMessageIdentity([{ ...base, character_id: "other" }], identity), []);
  assert.deepEqual(findCardsForMessageIdentity([{ ...base, message_index: 35 }], identity), []);
  assert.deepEqual(findCardsForMessageIdentity([{ ...base, message_role: "" }], identity), []);
});

test("jobMatchesMessageIdentity ignores hash and Dice", () => {
  const meta = {
    saveContentHash: "h-stream",
    sourcePreview: "anything",
    sessionId: "sessA",
    characterId: "charA",
    chatId: "chatA",
    messageIndex: 36,
    messageRole: "char",
  };
  const identity = {
    sessionId: "sessA",
    characterId: "charA",
    chatId: "chatA",
    messageIndex: 36,
    role: "assistant",
  };
  assert.equal(jobMatchesMessageIdentity(meta, identity), true);
  assert.equal(jobMatchesMessageIdentity({ ...meta, messageIndex: 35 }, identity), false);
  assert.equal(jobMatchesMessageIdentity({ ...meta, cancelRequested: true }, identity), false);
});

test("findHashRebindCandidates requires same character/chat/msg/role and Dice>=60%", () => {
  const body = "나는천재입니다진짜천재라고요이문장은충분히길어야합니다추가텍스트그리고더길게완성본";
  const preview = body.slice(0, Math.floor(body.length * 0.75));
  const base = {
    id: "c1",
    content_hash: "h-stream",
    assistant_preview: preview,
    character_id: "charA",
    chat_id: "chatA",
    session_id: "sessA",
    message_index: 36,
    message_role: "char",
    paragraph: 0,
    shot_index: 0,
    created_at: 1,
  };
  const identity = {
    newHash: "h-final",
    text: body,
    characterId: "charA",
    chatId: "chatA",
    sessionId: "sessA",
    messageIndex: 36,
    role: "assistant",
  };
  assert.deepEqual(findHashRebindCandidates([base], identity).map((c) => c.id), ["c1"]);
  assert.deepEqual(findHashRebindCandidates([{ ...base, character_id: "other" }], identity), []);
  assert.deepEqual(findHashRebindCandidates([{ ...base, chat_id: "other" }], identity), []);
  assert.deepEqual(findHashRebindCandidates([{ ...base, message_index: 35 }], identity), []);
  assert.deepEqual(findHashRebindCandidates([{ ...base, message_role: "user" }], identity), []);
  assert.deepEqual(findHashRebindCandidates([{ ...base, message_role: "" }], identity), []);
  assert.deepEqual(findHashRebindCandidates([{ ...base, content_hash: "h-final" }], identity), []);
  // Mid-job: some shots already rebound to h-final — remaining old-hash siblings stay eligible.
  assert.deepEqual(
    findHashRebindCandidates(
      [
        { ...base, id: "done", content_hash: "h-final", shot_index: 0 },
        { ...base, id: "late", content_hash: "h-stream", shot_index: 1, created_at: 2 },
      ],
      identity,
    ).map((c) => c.id),
    ["late"],
  );
});

test("findHashRebindCandidates accepts same host message id without Dice", () => {
  const base = {
    id: "c1",
    content_hash: "h-stream",
    host_message_id: "risu-m1",
    assistant_preview: "짧음",
    character_id: "charA",
    chat_id: "chatA",
    session_id: "sessA",
    message_index: 10,
    message_role: "char",
    paragraph: 0,
    shot_index: 0,
    created_at: 1,
  };
  const identity = {
    newHash: "h-final",
    text: "완전히다른충분히긴본문입니다그리고더길게써야합니다추가문장입니다요",
    characterId: "charA",
    chatId: "chatA",
    sessionId: "sessA",
    messageIndex: 99,
    role: "char",
    hostMessageId: "risu-m1",
  };
  assert.deepEqual(findHashRebindCandidates([base], identity).map((c) => c.id), ["c1"]);
  assert.deepEqual(
    findHashRebindCandidates([{ ...base, host_message_id: "other" }], identity),
    [],
  );
});

test("canRetargetJobSaveHash requires identity + Dice>=60% and skips already-retargeted", () => {
  const body = "나는천재입니다진짜천재라고요이문장은충분히길어야합니다추가텍스트그리고더길게완성본";
  const preview = body.slice(0, Math.floor(body.length * 0.75));
  const meta = {
    saveContentHash: "h-stream",
    sourcePreview: preview,
    sessionId: "sessA",
    characterId: "charA",
    chatId: "chatA",
    messageIndex: 36,
    messageRole: "char",
  };
  const identity = {
    toHash: "h-final",
    text: body,
    sessionId: "sessA",
    characterId: "charA",
    chatId: "chatA",
    messageIndex: 36,
    role: "assistant",
  };
  assert.equal(canRetargetJobSaveHash(meta, identity), true);
  assert.equal(canRetargetJobSaveHash({ ...meta, saveContentHash: "h-final" }, identity), false);
  assert.equal(canRetargetJobSaveHash({ ...meta, characterId: "other" }, identity), false);
  assert.equal(canRetargetJobSaveHash({ ...meta, messageIndex: 35 }, identity), false);
  assert.equal(canRetargetJobSaveHash({ ...meta, messageRole: "user" }, identity), false);
  assert.equal(
    canRetargetJobSaveHash(meta, { ...identity, text: "완전히다른이야기완전다른이야기완전다른이야기완전다른" }),
    false,
  );
});

test("gallery match requires both hash and a compatible stored message index", () => {
  const cards = [
    { id: "a", content_hash: "old-hash", message_index: 3, paragraph: 0, created_at: 1 },
  ];
  // After delete, chatIndex 3 is a different turn — must not attach via index alone.
  assert.equal(gallerySelectedCount(cards, { hash: "new-hash", chatIndex: 3 }), 0);
  assert.equal(galleryForMessage(cards, { hash: "new-hash", chatIndex: 3 }, 8)[0]?.id, "a");
  assert.notEqual(galleryForMessage(cards, { hash: "new-hash", chatIndex: 3 }, 8)[0]?.content_hash, "new-hash");
  assert.equal(gallerySelectedCount(cards, { hash: "old-hash", chatIndex: 99 }), 0);
});

test("short user word still maps by reverse DOM index only", () => {
  const messages = [
    { index: 0, role: "user", text: "안녕" },
    { index: 1, role: "char", text: "문을 열고 들어왔다." },
    { index: 2, role: "user", text: "커피" },
    { index: 3, role: "char", text: "잔을 테이블에 놓았다." },
  ];
  // DOM#1 (newest-first) → API#2
  const hit = resolveChatMessageMatch("커피", messages, 1, 4);
  assert.equal(hit.chatIndex, 2);
  assert.equal(hit.role, "user");
  assert.equal(hit.matchMethod, "reverse");
});

test("messageContextTriplet helper still builds neighbor fingerprint", () => {
  const messages = [
    { index: 0, role: "char", text: "문을 열고 들어왔다." },
    { index: 1, role: "user", text: "네" },
    { index: 2, role: "char", text: "잔을 테이블에 놓았다." },
    { index: 3, role: "user", text: "네" },
    { index: 4, role: "char", text: "고개를 살짝 끄덕였다." },
  ];
  assert.equal(messageContextTriplet(messages, 3).includes("네"), true);
  assert.equal(messageCompactKey(" 커피 "), "커피");
  // Matching itself is reverse-only: DOM#1 → API#3
  const hit = resolveChatMessageMatch("네", messages, 1, 5);
  assert.equal(hit.chatIndex, 3);
  assert.equal(hit.matchMethod, "reverse");
});

test("describeDomApiCompare explains short API inside long DOM", () => {
  const api = "문을 열고 들어왔다.";
  const dom = `캐릭터이름 2026-01-01 ${api} 그리고 더 긴 문단이 이어집니다`;
  const cmp = describeDomApiCompare(dom, api);
  assert.equal(cmp.overlap, true);
  assert.equal(cmp.apiInDom, true);
  assert.ok(cmp.domChars > cmp.apiChars);
});

test("rebindGalleryMessageIndexes shifts after middle delete", () => {
  const hashOf = (text) => `h:${String(text).replace(/\s+/g, "")}`;
  const before = [
    { index: 0, role: "user", text: "안녕" },
    { index: 1, role: "char", text: "문을 열고 들어왔다." },
    { index: 2, role: "user", text: "커피" },
    { index: 3, role: "char", text: "잔을 테이블에 놓았다." },
    { index: 4, role: "user", text: "고마워" },
    { index: 5, role: "char", text: "고개를 살짝 끄덕였다." },
  ];
  const cards = [
    { id: "cup", content_hash: hashOf("잔을 테이블에 놓았다."), message_index: 3 },
    { id: "nod", content_hash: hashOf("고개를 살짝 끄덕였다."), message_index: 5 },
  ];
  const after = before.filter((_, i) => i !== 2); // delete 커피
  const remapped = after.map((m, i) => ({ ...m, index: i }));
  const { cards: out, changed } = rebindGalleryMessageIndexes(cards, remapped, hashOf);
  assert.ok(changed >= 2);
  assert.equal(out.find((c) => c.id === "cup").message_index, 2);
  assert.equal(out.find((c) => c.id === "nod").message_index, 4);
});

test("pinPercentToPxFromBottom stays in range", () => {
  assert.ok(pinPercentToPxFromBottom(0, 800, 22, 8) >= 0);
});

test("galleryStripSplitAt only when both sides have images", () => {
  assert.equal(galleryStripSplitAt(0, 5), 0);
  assert.equal(galleryStripSplitAt(5, 5), 0);
  assert.equal(galleryStripSplitAt(3, 8), 3);
});

test("galleryIndexFromChildIndex skips the `|` separator child", () => {
  // children: [img0, img1, img2, |, img3, img4] with selectedCount=3
  assert.equal(galleryIndexFromChildIndex(0, 3, 5), 0);
  assert.equal(galleryIndexFromChildIndex(2, 3, 5), 2);
  assert.equal(galleryIndexFromChildIndex(3, 3, 5), -1);
  assert.equal(galleryIndexFromChildIndex(4, 3, 5), 3);
  assert.equal(galleryIndexFromChildIndex(5, 3, 5), 4);
});

test("thumbIndexAtStripX accounts for `|` width so post-split hits are not shifted", () => {
  const opts = { count: 5, selectedCount: 2, thumbWidth: 64, gap: 8, splitWidth: 16, splitExtraMargin: 4 };
  // left side: 0 @0–64, 1 @72–136, then | @144–160, gap, then thumb2 with +4 margin
  assert.equal(thumbIndexAtStripX(30, opts), 0);
  assert.equal(thumbIndexAtStripX(100, opts), 1);
  assert.equal(thumbIndexAtStripX(150, opts), -1); // on `|`
  // first right-side thumb starts at 160+8+4 = 172
  assert.equal(thumbIndexAtStripX(172, opts), 2);
  assert.equal(thumbIndexAtStripX(200, opts), 2);
  assert.equal(thumbIndexAtStripX(244, opts), 3); // 172+64+8 = 244
});

test("galleryStripContentWidth includes separator and clamps scroll offset", () => {
  // 5 thumbs + `|` + post-split margin: 5*64 + 5*8 gap among 6 children + 16 + 4
  assert.equal(galleryStripContentWidth({ count: 5, selectedCount: 2 }), 5 * 64 + 5 * 8 + 16 + 4);
  assert.equal(clampThumbScrollOffset(999, 400, 200), 200);
  assert.equal(clampThumbScrollOffset(-10, 400, 200), 0);
  assert.equal(clampThumbScrollOffset(50, 100, 200), 0);
});

test("parseAutotagLookJson reads fenced JSON look fields", () => {
  const out = parseAutotagLookJson('```json\n{"gender":"girl","appearance":"1girl, blue eyes","attire":"school uniform","accessories":"airpods in one ear"}\n```');
  assert.equal(out.appearance, "1girl, blue eyes");
  assert.equal(out.attire, "school uniform");
  assert.equal(out.accessories, "airpods in one ear");
  assert.equal(out.gender, "girl");
  assert.match(out.text, /airpods/);
});

test("parseAutotagLookJson falls back flat tags to appearance", () => {
  const out = parseAutotagLookJson("1girl, long hair, hoodie");
  assert.equal(out.appearance, "1girl, long hair, hoodie");
  assert.equal(out.attire, "");
  assert.equal(out.accessories, "");
});

test("pickScrollHoldAnchor prefers the bubble crossing the scroller top", () => {
  const scroller = { top: 100, bottom: 500, height: 400 };
  assert.equal(
    pickScrollHoldAnchor(scroller, [
      { top: 80, bottom: 180 },
      { top: 200, bottom: 280 },
      { top: 520, bottom: 600 },
    ]),
    0,
  );
  assert.equal(
    pickScrollHoldAnchor(scroller, [
      { top: 40, bottom: 90 },
      { top: 160, bottom: 240 },
    ]),
    1,
  );
  assert.equal(pickScrollHoldAnchor(scroller, []), -1);
});

test("scrollHoldDelta ignores jitter and viewport-sized jumps", () => {
  assert.equal(scrollHoldDelta(40, 41), 0);
  assert.equal(scrollHoldDelta(40, 80), 40);
  assert.equal(scrollHoldDelta(40, 500, 200), 0);
  assert.equal(scrollHoldDelta(40, 500, 0), 460);
  assert.equal(scrollHoldDelta("x", 10), 0);
});

test("scrollHoldOffset uses the requested bubble edge", () => {
  const scroller = { top: 100, bottom: 700 };
  const bubble = { top: 220, bottom: 520 };
  assert.equal(scrollHoldOffset(scroller, bubble, "top"), 120);
  assert.equal(scrollHoldOffset(scroller, bubble, "bottom"), 420);
});

test("scroll hold permits an active reading anchor but yields to user control", () => {
  assert.equal(shouldHoldScroll({}), false);
  assert.equal(shouldHoldScroll({ force: true }), true);
  assert.equal(shouldHoldScroll({ atLatest: false }), true);
  assert.equal(shouldHoldScroll({ force: true, userControl: true }), false);
  assert.equal(shouldHoldScroll({ atLatest: true }), false);
  assert.equal(shouldHoldScroll({ userControl: true }), false);
  assert.equal(shouldHoldScroll({ atLatest: true, force: true }), true);
  assert.equal(
    isScrollHoldLatest({
      scrollerRect: { top: 0, bottom: 400, height: 400 },
      newestRect: { top: 300, bottom: 390 },
    }),
    true,
  );
  assert.equal(
    isScrollHoldLatest({
      scrollerRect: { top: 0, bottom: 400, height: 400 },
      newestRect: { top: 20, bottom: 80 },
    }),
    false,
  );
});
