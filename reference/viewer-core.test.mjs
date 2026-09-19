import test from "node:test";
import assert from "node:assert/strict";

import {
  activeSegmentIndex,
  clampPinPercent,
  clampReadingPercent,
  createDebouncedSaveQueue,
  createScrollSettleTracker,
  createSessionChangeGuard,
  evenAnchorPercent,
  findHashRebindCandidates,
  galleryFocusMessage,
  galleryForMessage,
  gallerySelectedCount,
  linkCardsForMessage,
  prefixMatchRatio,
  isMessageSelectionGesture,
  pickMessageIndexNearPoint,
  pinPercentToPx,
  pinPercentToPxFromBottom,
  pinPxToPercent,
  mergeViewerPaintJob,
  readingPercentInMessage,
  resolveCardAnchorPercent,
  resolveClickSelectionAction,
  resolveStoredPinPercent,
  scaleInlineThumbnail,
  shouldRefreshGallery,
  shouldRewriteStickyThumb,
  shouldKeepStickyThumbHidden,
  composeStickyThumbHtml,
  stickyCornerImageBox,
  stickyCornerEdgeBox,
  stickyPinEdgeBox,
  stickyPinOverImage,
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
  shouldSelectMessageByTextDrag,
  visibleGalleryImageIds,
  galleryStripSplitAt,
  galleryIndexFromChildIndex,
  thumbIndexAtStripX,
  galleryStripContentWidth,
  clampThumbScrollOffset,
  parseAutotagLookJson,
} from "../src/viewer-core.js";

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
  assert.equal(galleryFocusMessage({ hash: "new", chatIndex: 9 }, { hash: "old", chatIndex: 1 }, cards).hash, "old");
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

test("selection gesture respects configured click count and movement without blocking text selection", () => {
  assert.equal(isMessageSelectionGesture({ gesture: "single", detail: 1, movement: 0 }), true);
  assert.equal(isMessageSelectionGesture({ gesture: "single", detail: 1, movement: 20 }), false);
  assert.equal(isMessageSelectionGesture({ gesture: "double", detail: 2, movement: 0 }), true);
});

test("click selection action supports provisional then confirm in double mode", () => {
  assert.equal(resolveClickSelectionAction({ gesture: "double", detail: 1, targetDomIndex: 2 }).action, "provisional");
  assert.equal(resolveClickSelectionAction({ gesture: "double", detail: 2, targetDomIndex: 2, pendingDomIndex: 2 }).action, "confirm");
  assert.equal(resolveClickSelectionAction({ gesture: "single", detail: 1 }).action, "confirm");
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

test("composeStickyThumbHtml stacks old under new when src changes", () => {
  const html = composeStickyThumbHtml("new", "old");
  assert.match(html, /old/);
  assert.match(html, /new/);
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
  const hit = resolveChatMessageMatch("오프닝문구입니다아", [{ index: 0, role: "char", text: "오프닝문구입니다아" }], 0, 1);
  assert.equal(hit.role, "char");
  assert.equal(hit.matchMethod, "reverse");
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

test("visibleGalleryImageIds pins current-message prefix when focus is on the right strip", () => {
  const items = Array.from({ length: 11 }, (_, i) => ({ id: `i${i}` }));
  // 3 current + 8 others; focus on last other — left 3 must still warm.
  const ids = visibleGalleryImageIds(items, 10, 1, 11, 3);
  assert.ok(ids.includes("i0"));
  assert.ok(ids.includes("i1"));
  assert.ok(ids.includes("i2"));
  assert.equal(ids.length, 11);
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
});

test("gallery match ignores stale message_index without content_hash", () => {
  const cards = [
    { id: "a", content_hash: "old-hash", message_index: 3, paragraph: 0, created_at: 1 },
  ];
  // After delete, chatIndex 3 is a different turn — must not attach via index alone.
  assert.equal(gallerySelectedCount(cards, { hash: "new-hash", chatIndex: 3 }), 0);
  assert.equal(galleryForMessage(cards, { hash: "new-hash", chatIndex: 3 }, 8)[0]?.id, "a");
  assert.notEqual(galleryForMessage(cards, { hash: "new-hash", chatIndex: 3 }, 8)[0]?.content_hash, "new-hash");
  assert.equal(gallerySelectedCount(cards, { hash: "old-hash", chatIndex: 99 }), 1);
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
  const out = parseAutotagLookJson('```json\n{"appearance":"1girl, blue eyes","attire":"school uniform","accessories":"airpods in one ear"}\n```');
  assert.equal(out.appearance, "1girl, blue eyes");
  assert.equal(out.attire, "school uniform");
  assert.equal(out.accessories, "airpods in one ear");
  assert.match(out.text, /airpods/);
});

test("parseAutotagLookJson falls back flat tags to appearance", () => {
  const out = parseAutotagLookJson("1girl, long hair, hoodie");
  assert.equal(out.appearance, "1girl, long hair, hoodie");
  assert.equal(out.attire, "");
  assert.equal(out.accessories, "");
});
