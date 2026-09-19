const INLINE_BASE_WIDTH = 528;
const INLINE_BASE_HEIGHT = 720;

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function mergePatch(target, patch) {
  const result = { ...target };
  for (const [key, value] of Object.entries(patch || {})) {
    result[key] = value && typeof value === "object" && !Array.isArray(value)
      ? mergePatch(result[key] && typeof result[key] === "object" ? result[key] : {}, value)
      : value;
  }
  return result;
}

export function scaleInlineThumbnail(percent) {
  const normalized = Math.max(1, finiteNumber(percent, 100));
  return {
    width: Math.max(1, Math.round(INLINE_BASE_WIDTH * normalized / 100)),
    height: Math.max(1, Math.round(INLINE_BASE_HEIGHT * normalized / 100)),
    percent: normalized,
  };
}

/** Strip to letters/digits for soft text matching (streaming-safe). */
export function normalizeMatchText(value) {
  return String(value || "").replace(/[^a-zA-Z0-9\uac00-\ud7a3\u3040-\u30ff\u3400-\u9fff\uff00-\uffef]/g, "").toLowerCase();
}

/** @deprecated use HASH_REBIND_THRESHOLD — kept for older call sites */
export const PREFIX_MATCH_THRESHOLD = 0.6;
export const HASH_REBIND_THRESHOLD = 0.6;
export const PREFIX_MATCH_MIN_CHARS = 24;
/** Cap soft compare length (Dice is O(n); keep headroom for long chats). */
export const SIMILARITY_COMPARE_MAX = 800;

/** Normalize role families: char/assistant/bot → char, user/human → user. */
export function normalizeMessageRole(role) {
  const r = String(role || "").toLowerCase().trim();
  if (!r) return "";
  if (r === "char" || r === "assistant" || r === "bot") return "char";
  if (r === "user" || r === "human") return "user";
  return r;
}

/** Longest common prefix length of two already-normalized strings. */
export function longestCommonPrefixLength(a, b) {
  const x = String(a || "");
  const y = String(b || "");
  const n = Math.min(x.length, y.length);
  let i = 0;
  while (i < n && x.charCodeAt(i) === y.charCodeAt(i)) i += 1;
  return i;
}

/** Character-bigram multiset counts for Dice coefficient. */
export function bigramCounts(text) {
  const s = String(text || "");
  const counts = new Map();
  if (s.length < 2) return counts;
  for (let i = 0; i < s.length - 1; i += 1) {
    const g = s.charCodeAt(i) + "," + s.charCodeAt(i + 1);
    counts.set(g, (counts.get(g) || 0) + 1);
  }
  return counts;
}

/**
 * Dice coefficient on character bigrams in [0,1].
 * Famous fuzzy measure; O(n), tolerates a few edits anywhere (including the opening).
 */
export function diceBigramRatio(a, b, aCounts = null) {
  const x = String(a || "");
  const y = String(b || "");
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.length < 2 || y.length < 2) return 0;
  const left = aCounts || bigramCounts(x);
  const right = bigramCounts(y);
  let inter = 0;
  for (const [g, rc] of right) {
    const lc = left.get(g) || 0;
    if (lc) inter += Math.min(lc, rc);
  }
  const leftN = x.length - 1;
  const rightN = y.length - 1;
  return (2 * inter) / (leftN + rightN);
}

/**
 * Soft similarity in [0,1] for one-shot hash rebind (not gallery hot path).
 * LCP fast-path for streaming prefix; else Dice bigrams.
 */
export function prefixMatchRatio(a, b) {
  const x = normalizeMatchText(a);
  const y = normalizeMatchText(b);
  if (!x || !y) return 0;
  const maxLen = Math.max(x.length, y.length);
  if (maxLen < PREFIX_MATCH_MIN_CHARS) return 0;
  if (x === y) return 1;
  const lcp = longestCommonPrefixLength(x, y);
  const lcpRatio = lcp / maxLen;
  if (lcpRatio >= HASH_REBIND_THRESHOLD) return lcpRatio;
  const xs = x.length > SIMILARITY_COMPARE_MAX ? x.slice(0, SIMILARITY_COMPARE_MAX) : x;
  const ys = y.length > SIMILARITY_COMPARE_MAX ? y.slice(0, SIMILARITY_COMPARE_MAX) : y;
  return diceBigramRatio(xs, ys);
}

/**
 * Hot-path link: exact content_hash only.
 * Soft/streaming upgrades go through findHashRebindCandidates + API rebind.
 */
export function linkCardsForMessage(cards, selectedMessage) {
  if (!selectedMessage) return [];
  const list = Array.isArray(cards) ? cards : [];
  const hash = String(selectedMessage.hash || "");
  if (!hash) return [];
  return dedupeShotSlots(list.filter((card) => card?.content_hash && card.content_hash === hash));
}

/**
 * Candidates for one-shot hash rebind after streaming changes content_hash.
 * Requires same character + chat + message_index + role; hash differs; Dice≥60%.
 * Cards without message_role are skipped (no guessed role).
 */
export function findHashRebindCandidates(cards, identity = {}) {
  const list = Array.isArray(cards) ? cards : [];
  const newHash = String(identity.newHash || identity.hash || "");
  const text = String(identity.text || "");
  const characterId = String(identity.characterId || "");
  const chatId = String(identity.chatId || "");
  const sessionId = String(identity.sessionId || "");
  const messageIndex = Number(identity.messageIndex);
  const role = normalizeMessageRole(identity.role || identity.messageRole || "");
  if (!newHash || !text || !characterId || !role || !Number.isFinite(messageIndex) || messageIndex < 0) return [];
  if (list.some((card) => card?.content_hash && card.content_hash === newHash)) return [];

  const textNorm = normalizeMatchText(text);
  if (textNorm.length < PREFIX_MATCH_MIN_CHARS) return [];
  const out = [];
  for (const card of list) {
    const cardHash = String(card?.content_hash || "");
    if (!cardHash || cardHash === newHash) continue;
    if (String(card?.character_id || "") !== characterId) continue;
    const cardChat = String(card?.chat_id || "");
    const cardSession = String(card?.session_id || "");
    if (chatId) {
      if (cardChat !== chatId) continue;
    } else if (sessionId) {
      if (cardSession && cardSession !== sessionId) continue;
    } else {
      continue;
    }
    if (Number(card?.message_index) !== messageIndex) continue;
    const cardRole = normalizeMessageRole(card?.message_role || card?.role || "");
    if (!cardRole || cardRole !== role) continue;
    const preview = String(card?.assistant_preview || "");
    if (!preview) continue;
    const score = prefixMatchRatio(text, preview);
    if (score < HASH_REBIND_THRESHOLD) continue;
    out.push({ card, score });
  }
  out.sort((a, b) => b.score - a.score || finiteNumber(b.card?.created_at) - finiteNumber(a.card?.created_at));
  return dedupeShotSlots(out.map((row) => row.card));
}

export function matchesSelectedMessage(card, selectedMessage) {
  if (!selectedMessage || !card) return false;
  return !!(selectedMessage.hash && card.content_hash === selectedMessage.hash);
}

/** Prefer saved y%/anchor%; missing → +Infinity so they sort after placed shots. */
function cardYPercent(card) {
  const raw = card?.y_percent ?? card?.anchor_percent ?? card?.read_percent;
  const n = Number(raw);
  return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
}

function selectedOrder(left, right) {
  return cardYPercent(left) - cardYPercent(right)
    || finiteNumber(left?.paragraph) - finiteNumber(right?.paragraph)
    || finiteNumber(left?.shot_index) - finiteNumber(right?.shot_index)
    || finiteNumber(right?.created_at) - finiteNumber(left?.created_at);
}

function newestOrder(left, right) {
  return finiteNumber(right?.created_at) - finiteNumber(left?.created_at)
    || finiteNumber(right?.message_index) - finiteNumber(left?.message_index)
    || finiteNumber(right?.paragraph) - finiteNumber(left?.paragraph)
    || finiteNumber(right?.shot_index) - finiteNumber(left?.shot_index);
}

/** Keep newest card per paragraph|shot slot. */
function dedupeShotSlots(cards) {
  const unique = new Map();
  for (const card of cards || []) {
    const key = `${card?.paragraph ?? "?"}|${card?.shot_index ?? card?.id}`;
    const prev = unique.get(key);
    if (!prev || finiteNumber(card?.created_at) >= finiteNumber(prev?.created_at)) unique.set(key, card);
  }
  return [...unique.values()];
}

/**
 * Viewer strip:
 * 1) LEFT — all current-message images, y% ascending (small → large)
 * 2) RIGHT — up to `maxCount` other session images, newest first
 * Selected shots are never squeezed out by the right-side cap.
 */
export function galleryForMessage(cards, selectedMessage, maxCount = 8) {
  const unique = new Map();
  for (const card of cards || []) {
    const id = String(card?.id || "");
    if (!id || unique.has(id)) continue;
    unique.set(id, card);
  }
  const values = [...unique.values()];
  const restCap = Math.max(0, Math.min(64, finiteNumber(maxCount, 8) || 8));
  if (!selectedMessage) {
    return values.sort(newestOrder).slice(0, Math.max(1, restCap || 8));
  }
  const selected = linkCardsForMessage(values, selectedMessage).sort(selectedOrder);
  const selectedIds = new Set(selected.map((card) => String(card.id)));
  const sessionId = String(selectedMessage.sessionId || "");
  const remaining = values
    .filter((card) => !selectedIds.has(String(card.id)))
    .filter((card) => !sessionId || !card?.session_id || card.session_id === sessionId)
    .sort(newestOrder)
    .slice(0, restCap);
  return [...selected, ...remaining];
}

export function gallerySelectedCount(cards, selectedMessage) {
  if (!selectedMessage) return 0;
  return linkCardsForMessage(cards, selectedMessage).length;
}

/**
 * Message used for the left "current message images" strip.
 * When the live selection has no images yet, keep the last imaged message so the strip does not collapse/rebuild.
 */
export function galleryFocusMessage(selectedMessage, lastImagedMessage, cards) {
  if (selectedMessage && gallerySelectedCount(cards, selectedMessage) > 0) return selectedMessage;
  if (lastImagedMessage && gallerySelectedCount(cards, lastImagedMessage) > 0) return lastImagedMessage;
  return selectedMessage || lastImagedMessage || null;
}

/**
 * Archive-style role from chat.message fields only (never from DOM/text).
 * Returns: "user" | "char" | "system" | "".
 */
export function rawMessageRole(message) {
  const role = String(
    message?.role || message?.type || message?.speaker || message?.sender || message?.from || message?.name || "",
  ).trim().toLowerCase();
  if (
    message?.isUser === true
    || message?.fromUser === true
    || /^(user|human|player|you|me)$/.test(role)
    || role.includes("user")
  ) return "user";
  if (
    message?.isAssistant === true
    || message?.isBot === true
    || message?.isChar === true
    || /^(assistant|bot|char|character|model|ai)$/.test(role)
    || role.includes("assistant")
    || role.includes("bot")
    || role.includes("char")
  ) return "char";
  if (role === "system" || role === "developer") return "system";
  return "";
}

/** Risu AI turns usually carry generationInfo / generation_info. */
export function hasGenerationInfo(message) {
  const info = message?.generationInfo ?? message?.generation_info ?? message?.messageGenerationInfo;
  if (info == null) return false;
  if (typeof info === "string") return info.trim().length > 0;
  if (typeof info === "object") return Object.keys(info).length > 0;
  return true;
}

/**
 * Optional hint only: Risu AI turns often carry generationInfo.
 * Do NOT use this as the selection role — prefer message.role via rawMessageRole.
 */
export function roleFromGenerationInfo(message) {
  return hasGenerationInfo(message) ? "char" : "user";
}

/** True when the message is a character/assistant turn eligible for image gen. */
export function isCharMessageRole(roleOrMessage) {
  if (roleOrMessage && typeof roleOrMessage === "object") {
    return rawMessageRole(roleOrMessage) === "char";
  }
  const role = String(roleOrMessage || "").trim().toLowerCase();
  return role === "char" || role === "assistant" || role === "bot";
}

/** Compact text key for DOM ↔ API message matching (RisuTTS-style). */
function messageTextKey(text, maxChars = 48) {
  return String(text || "").replace(/\s+/g, "").slice(0, Math.max(8, finiteNumber(maxChars, 48)));
}

/** Whitespace-stripped key; allows short user words (<8). */
export function messageCompactKey(text, maxChars = 48) {
  const cap = Math.max(1, finiteNumber(maxChars, 48));
  return String(text || "").replace(/\s+/g, "").slice(0, cap);
}

/** API-side context fingerprint: prev|self|next|role (oldest-first neighbors). */
export function messageContextTriplet(messages, index, maxChars = 48) {
  const list = Array.isArray(messages) ? messages : [];
  const i = Math.floor(finiteNumber(index, -1));
  const self = i >= 0 && i < list.length ? list[i] : null;
  const prev = i > 0 ? list[i - 1] : null;
  const next = i >= 0 && i < list.length - 1 ? list[i + 1] : null;
  return [
    messageCompactKey(prev?.text, maxChars),
    messageCompactKey(self?.text, maxChars),
    messageCompactKey(next?.text, maxChars),
    rawMessageRole(self) || String(self?.role || "").trim().toLowerCase(),
  ].join("|");
}

/**
 * Shared-character score between DOM bubble and API body (whitespace-stripped).
 * Longer shared runs win — stops short option lines from beating full char turns
 * just because the option text also appears inside the rendered bubble.
 */
export function messagesTextOverlapScore(domText, apiText) {
  const dom = String(domText || "").replace(/\s+/g, "");
  const api = String(apiText || "").replace(/\s+/g, "");
  if (!dom || !api) return 0;
  if (dom.includes(api)) return api.length;
  if (api.includes(dom)) return dom.length;

  let best = 0;
  const longestPrefixIn = (needle, haystack, minLen = 8, maxLen = 512) => {
    let lo = minLen;
    let hi = Math.min(needle.length, maxLen);
    let found = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (haystack.includes(needle.slice(0, mid))) {
        found = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return found;
  };
  best = Math.max(best, longestPrefixIn(api, dom), longestPrefixIn(dom, api));

  // Sample mid-body chunks (API headers/markup often differ from DOM chrome).
  const limit = Math.min(api.length, 2400);
  for (let i = 0; i + 8 <= limit; i += 32) {
    const chunkMax = Math.min(64, limit - i);
    for (let len = chunkMax; len >= 8; len -= 8) {
      if (dom.includes(api.slice(i, i + len))) {
        best = Math.max(best, len);
        break;
      }
    }
  }
  return best;
}

/** True when DOM bubble text and API message body refer to the same turn. */
function messagesTextOverlap(domText, apiText) {
  return messagesTextOverlapScore(domText, apiText) >= 8;
}

/** Debug helper: why DOM text and API text do/don't match. */
export function describeDomApiCompare(domText, apiText) {
  const dom = String(domText || "");
  const api = String(apiText || "");
  const domCompact = messageCompactKey(dom);
  const apiCompact = messageCompactKey(api);
  const shareScore = messagesTextOverlapScore(dom, api);
  const overlap = shareScore >= 8;
  const shortExact = domCompact.length > 0 && domCompact.length < 8 && domCompact === apiCompact;
  const apiKey = apiCompact.slice(0, 48);
  const domKey = domCompact.slice(0, 48);
  return {
    domChars: dom.length,
    apiChars: api.length,
    domCompactChars: domCompact.length,
    apiCompactChars: apiCompact.length,
    shareScore,
    overlap,
    shortExact,
    apiInDom: !!(apiKey && apiKey.length >= 8 && domCompact.includes(apiKey)),
    domInApi: !!(domKey && domKey.length >= 8 && apiCompact.includes(domKey)),
    apiKey,
    domKey,
  };
}

/**
 * Remap card.message_index from current API messages via content_hash.
 * Unique hash hit → update index; ambiguous → -1; missing hash → leave unchanged.
 */
export function rebindGalleryMessageIndexes(cards, messages, hashOf) {
  const list = Array.isArray(messages) ? messages : [];
  const hashFn = typeof hashOf === "function" ? hashOf : null;
  const byHash = new Map();
  if (hashFn) {
    for (let i = 0; i < list.length; i += 1) {
      const text = String(list[i]?.text ?? list[i]?.data ?? list[i]?.content ?? "");
      const hash = String(hashFn(text) || "");
      if (!hash) continue;
      const idx = Number.isFinite(Number(list[i]?.index)) ? Number(list[i].index) : i;
      if (!byHash.has(hash)) byHash.set(hash, []);
      byHash.get(hash).push(idx);
    }
  }
  let changed = 0;
  const out = (Array.isArray(cards) ? cards : []).map((card) => {
    const hash = String(card?.content_hash || "");
    if (!hash || !byHash.has(hash)) return card;
    const idxs = byHash.get(hash);
    if (idxs.length !== 1) {
      if (Number(card?.message_index) !== -1) {
        changed += 1;
        return { ...card, message_index: -1 };
      }
      return card;
    }
    if (Number(card?.message_index) !== idxs[0]) {
      changed += 1;
      return { ...card, message_index: idxs[0] };
    }
    return card;
  });
  return { cards: out, changed };
}

/**
 * Map a clicked chat DOM bubble to chat.message[].
 * Ultra-simple: DOM is newest-first, API is oldest-first →
 *   API index = (messageCount - 1) - DOM index
 * Role from that API row (rawMessageRole). Text/share matching intentionally unused.
 */
export function resolveChatMessageMatch(domText, messages, domIndex, domCount, opts = {}) {
  const list = Array.isArray(messages) ? messages : [];
  const idx = Math.floor(finiteNumber(domIndex, -1));
  const pick = (row, method, score, rowIndex = -1) => ({
    chatIndex: Number.isFinite(Number(row?.index)) ? Number(row.index) : (rowIndex >= 0 ? rowIndex : idx),
    text: String(row?.text || domText || ""),
    role: rawMessageRole(row) || String(row?.role || "").trim().toLowerCase(),
    matchMethod: method,
    score,
  });

  if (!list.length) {
    return {
      chatIndex: Math.max(0, idx),
      text: String(domText || ""),
      role: "",
      matchMethod: "fallback",
      score: 0,
    };
  }

  const reverseIdx = list.length - 1 - idx;
  if (reverseIdx >= 0 && reverseIdx < list.length) {
    return pick(list[reverseIdx], "reverse", 100, reverseIdx);
  }

  // DOM index out of range (e.g. stale) → clamp to nearest API end.
  const clamped = Math.max(0, Math.min(list.length - 1, reverseIdx));
  return pick(list[clamped], "reverse", 50, clamped);
}

/**
 * Pick message index nearest to a pointer: prefer rect containing the point, else closest center.
 * `rects` entries: { top, bottom, left?, right? }. Missing left/right → Y-only containment.
 */
/** Clamp sticky-pin screen percent to 0–100 (integer, decimals truncated). */
export function clampPinPercent(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return Math.max(0, Math.min(100, Math.floor(finiteNumber(fallback, 0))));
  return Math.max(0, Math.min(100, Math.floor(n)));
}

/** Percent from the left/top edge → clamped pixel (pin top-left). */
export function pinPercentToPx(percent, viewportSize, pinSize = 22, pad = 4) {
  const view = Math.max(1, finiteNumber(viewportSize, 1));
  const size = Math.max(1, finiteNumber(pinSize, 1));
  const edge = Math.max(0, finiteNumber(pad, 0));
  const raw = Math.floor(view * clampPinPercent(percent, 0) / 100);
  return Math.max(edge, Math.min(view - size - edge, raw));
}

/**
 * Percent from the bottom edge → CSS `top` for the pin.
 * y=0 → bottom; y=50 → mid; y=100 → top (clamped). Scales with viewport resize.
 */
export function pinPercentToPxFromBottom(percent, viewportSize, pinSize = 22, pad = 8) {
  const view = Math.max(1, finiteNumber(viewportSize, 1));
  const size = Math.max(1, finiteNumber(pinSize, 1));
  const edge = Math.max(0, finiteNumber(pad, 0));
  const fromBottom = Math.floor(view * clampPinPercent(percent, 0) / 100);
  const top = view - fromBottom - size;
  return Math.max(edge, Math.min(view - size - edge, top));
}

/** Pixel from left/top → percent of viewport (integer, decimals truncated). */
export function pinPxToPercent(px, viewportSize) {
  const view = Math.max(1, finiteNumber(viewportSize, 1));
  return clampPinPercent(finiteNumber(px, 0) / view * 100, 0);
}

/**
 * Read pin % from settings (origin = bottom-left).
 * Prefer overlay_*_pct whenever present — DEFAULT_CONFIG always deepMerges
 * legacy overlay_*_offset (px), which must not shadow saved percentages on boot.
 * defaults: { x: 38, y: 80 }
 */
export function resolveStoredPinPercent(card, axis, viewportSize, defaults = null) {
  const def = defaults && typeof defaults === "object" ? defaults : { x: 38, y: 80 };
  const isY = axis === "y" || axis === "Y";
  const fallback = isY ? finiteNumber(def.y, 80) : finiteNumber(def.x, 38);
  const pctKey = isY ? "overlay_y_pct" : "overlay_x_pct";
  const pxKey = isY ? "overlay_y_offset" : "overlay_x_offset";
  const origin = String(card?.overlay_pin_origin || "");
  const topOrigin = origin === "top" || origin === "tl" || origin === "top-left";
  const rawPct = card?.[pctKey];
  const hasPct = rawPct != null && Number.isFinite(Number(rawPct));
  const px = Number(card?.[pxKey]);
  const hasPx = Number.isFinite(px);
  const asBottomY = (topish) => clampPinPercent(100 - Number(topish), fallback);

  // Saved % wins over default/legacy px (fixes first-load pin ignoring settings %).
  if (hasPct) {
    if (!isY) return clampPinPercent(rawPct, fallback);
    if (topOrigin) return asBottomY(rawPct);
    return clampPinPercent(rawPct, fallback);
  }
  if (hasPx) {
    if (!isY) return pinPxToPercent(px, viewportSize);
    // Legacy top-edge px → bottom-origin %
    return clampPinPercent((finiteNumber(viewportSize, 1) - px) / Math.max(1, finiteNumber(viewportSize, 1)) * 100, fallback);
  }
  return clampPinPercent(fallback, fallback);
}

export function pickMessageIndexNearPoint(rects, pointY, pointX = null, viewportH = 800) {
  const list = Array.isArray(rects) ? rects : [];
  if (!list.length) return -1;
  const vh = Math.max(1, finiteNumber(viewportH, 800));
  const py = Number.isFinite(Number(pointY)) ? Number(pointY) : vh * 0.5;
  const px = Number.isFinite(Number(pointX)) ? Number(pointX) : null;
  let contain = -1;
  let containH = Infinity;
  let best = -1;
  let bestDist = Infinity;
  for (let i = 0; i < list.length; i += 1) {
    const r = list[i];
    if (!r) continue;
    const top = finiteNumber(r.top, 0);
    const bottom = finiteNumber(r.bottom, top);
    if (bottom <= 0 || top >= vh) continue;
    const midY = (top + bottom) * 0.5;
    const midX = Number.isFinite(Number(r.left)) && Number.isFinite(Number(r.right))
      ? (Number(r.left) + Number(r.right)) * 0.5
      : null;
    const dist = midX != null && px != null
      ? Math.hypot(midX - px, midY - py)
      : Math.abs(midY - py);
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
    const inY = py >= top && py <= bottom;
    const inX = px == null || !Number.isFinite(Number(r.left)) || !Number.isFinite(Number(r.right))
      || (px >= Number(r.left) && px <= Number(r.right));
    if (inY && inX) {
      const h = Math.max(1, bottom - top);
      if (h < containH) {
        containH = h;
        contain = i;
      }
    }
  }
  return contain >= 0 ? contain : best;
}

export function isMessageSelectionGesture({
  gesture = "single",
  detail = 1,
  movement = 0,
  textSelecting = false,
  excludedTarget = false,
} = {}) {
  const expectedDetail = gesture === "double" ? 2 : 1;
  return !excludedTarget
    && !textSelecting
    && finiteNumber(movement, Infinity) <= 8
    && finiteNumber(detail) === expectedDetail;
}

/**
 * Click-only selection state machine.
 * double: detail 1 → provisional, detail 2 → confirm.
 * single: detail 1 → confirm; other details ignored.
 */
export function resolveClickSelectionAction({
  gesture = "single",
  detail = 1,
  pendingDomIndex = null,
  targetDomIndex = null,
} = {}) {
  const d = finiteNumber(detail, 1);
  if (gesture === "double") {
    if (d === 1) {
      return {
        action: "provisional",
        pendingDomIndex: targetDomIndex,
      };
    }
    if (d === 2) {
      return {
        action: "confirm",
        clearPending: true,
        matchedPending: pendingDomIndex != null
          && Number(pendingDomIndex) === Number(targetDomIndex),
      };
    }
    return { action: "ignore" };
  }
  if (d === 1) return { action: "confirm", clearPending: true };
  return { action: "ignore" };
}

/** True when a text-drag gesture should select the message under the pointer. */
export function shouldSelectMessageByTextDrag({
  enabled = true,
  movement = 0,
  hasSelection = false,
  excludedTarget = false,
} = {}) {
  return !!enabled
    && !excludedTarget
    && !!hasSelection
    && finiteNumber(movement, 0) > 8;
}

/**
 * Idle debounce helper for scroll-settle selection.
 * bump() on scroll/wheel; settleNow() on scrollend; onSettle fires once per idle.
 */
export function createScrollSettleTracker({ delayMs = 160, onSettle } = {}) {
  let timer = null;
  const delay = Math.max(0, finiteNumber(delayMs, 160));
  const fire = () => {
    timer = null;
    if (typeof onSettle === "function") onSettle();
  };
  return {
    bump() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(fire, delay);
    },
    settleNow() {
      if (timer) clearTimeout(timer);
      timer = null;
      fire();
    },
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
    },
    get pending() {
      return timer != null;
    },
  };
}

export function createSessionChangeGuard(initialSession = "") {
  let currentSession = String(initialSession || "");
  let candidate = "";
  let observations = 0;
  return {
    observe(session) {
      const next = String(session || "");
      if (!next || next === currentSession) {
        candidate = "";
        observations = 0;
        return false;
      }
      if (next !== candidate) {
        candidate = next;
        observations = 1;
        return false;
      }
      observations += 1;
      if (observations < 2) return false;
      currentSession = candidate;
      candidate = "";
      observations = 0;
      return true;
    },
    current() {
      return currentSession;
    },
    reset(session = "") {
      currentSession = String(session || "");
      candidate = "";
      observations = 0;
    },
  };
}

export function createDebouncedSaveQueue(write, delayMs = 300) {
  let pending = {};
  let timer = null;
  let draining = null;

  const drain = async () => {
    if (draining) return draining;
    draining = (async () => {
      while (Object.keys(pending).length) {
        const patch = pending;
        pending = {};
        await write(patch);
      }
    })().finally(() => {
      draining = null;
    });
    return draining;
  };

  return {
    enqueue(patch) {
      pending = mergePatch(pending, patch);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        drain().catch(() => {});
      }, Math.max(0, finiteNumber(delayMs, 300)));
    },
    async flush() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      do {
        await drain();
      } while (Object.keys(pending).length || draining);
    },
    hasPending() {
      return !!timer || !!draining || Object.keys(pending).length > 0;
    },
  };
}

/** True when gallery card id list/order changed enough to warrant a viewer refresh. */
export function shouldRefreshGallery(prevIds, nextIds) {
  const prev = Array.isArray(prevIds) ? prevIds.map(String) : [];
  const next = Array.isArray(nextIds) ? nextIds.map(String) : [];
  if (prev.length !== next.length) return true;
  for (let i = 0; i < prev.length; i += 1) {
    if (prev[i] !== next[i]) return true;
  }
  return false;
}

/** Sticky pin thumb HTML rewrite only when the active card id changes. */
export function shouldRewriteStickyThumb(prevCardId, nextCardId) {
  return String(prevCardId || "") !== String(nextCardId || "");
}

/** Keep sticky always-image hidden only while the user-hidden card is still active. */
export function shouldKeepStickyThumbHidden(userHidden, hiddenCardId, activeCardId) {
  if (!userHidden) return false;
  const hidden = String(hiddenCardId || "");
  const active = String(activeCardId || "");
  return !!hidden && !!active && hidden === active;
}

/**
 * Sticky thumb HTML. When underSrc differs, stack old under new so the previous
 * image never blanks before the replacement paints on top.
 */
export function composeStickyThumbHtml(src, underSrc = "") {
  const next = typeof src === "string" ? src : "";
  const under = typeof underSrc === "string" ? underSrc : "";
  if (!next) return '<div style="width:100%;height:100%;background:#0b0f18"></div>';
  const cover = "width:100%;height:100%;object-fit:cover;display:block";
  if (under && under !== next) {
    return `<div style="position:relative;width:100%;height:100%"><img src="${under}" style="${cover}" /><img src="${next}" style="position:absolute;inset:0;${cover};z-index:1" /></div>`;
  }
  return `<img src="${next}" style="${cover}" />`;
}

/** Corner box for sticky always-image in mobile layout mode. */
export function stickyCornerImageBox(corner, size, viewport, pad = 16) {
  const w = Math.max(1, Math.round(finiteNumber(size?.w, 1)));
  const h = Math.max(1, Math.round(finiteNumber(size?.h, 1)));
  const vw = Math.max(w, Math.round(finiteNumber(viewport?.width, w)));
  const vh = Math.max(h, Math.round(finiteNumber(viewport?.height, h)));
  const p = Math.max(0, Math.round(finiteNumber(pad, 16)));
  const c = String(corner || "bottom-right");
  const left = c.includes("left") ? p : Math.max(p, vw - w - p);
  const top = c.includes("top") ? p : Math.max(p, vh - h - p);
  return { left, top, w, h };
}

/**
 * Edge-anchored corner box (left/right/top/bottom).
 * Prefer this over absolute left/top so right/bottom corners stay glued on window resize.
 */
export function stickyCornerEdgeBox(corner, size, pad = 16) {
  const w = Math.max(1, Math.round(finiteNumber(size?.w, 1)));
  const h = Math.max(1, Math.round(finiteNumber(size?.h, 1)));
  const p = Math.max(0, Math.round(finiteNumber(pad, 16)));
  const c = String(corner || "bottom-right");
  return {
    w,
    h,
    top: c.includes("top") ? p : null,
    bottom: c.includes("bottom") ? p : null,
    left: c.includes("left") ? p : null,
    right: c.includes("right") ? p : null,
  };
}

/** Sticky pin sitting on the top-center edge of an image box. */
export function stickyPinOverImage(box, pinSize = 28, gap = 6) {
  const left = Math.round(finiteNumber(box?.left, 0));
  const top = Math.round(finiteNumber(box?.top, 0));
  const w = Math.max(1, Math.round(finiteNumber(box?.w, 1)));
  const pin = Math.max(1, Math.round(finiteNumber(pinSize, 28)));
  const g = Math.max(0, Math.round(finiteNumber(gap, 6)));
  return {
    left: Math.round(left + (w - pin) / 2),
    top: top - g,
  };
}

/** Edge-anchored pin on the top-center of a corner sticky image. */
export function stickyPinEdgeBox(corner, size, pinSize = 28, gap = 6, pad = 16) {
  const box = stickyCornerEdgeBox(corner, size, pad);
  const pin = Math.max(1, Math.round(finiteNumber(pinSize, 28)));
  const g = Math.max(0, Math.round(finiteNumber(gap, 6)));
  const sidePad = box.left != null ? box.left : box.right;
  const side = Math.round(finiteNumber(sidePad, 0) + (box.w - pin) / 2);
  return {
    size: pin,
    top: box.top != null ? Math.round(box.top - g) : null,
    bottom: box.bottom != null ? Math.round(box.bottom + box.h + g) : null,
    left: box.left != null ? side : null,
    right: box.right != null ? side : null,
  };
}

/** Viewer strip thumb geometry (must match UI flex styles). */
export const VIEWER_THUMB_LAYOUT = Object.freeze({
  width: 64,
  height: 88,
  gap: 8,
  splitWidth: 16,
  splitExtraMargin: 4,
});

/** Index of the `|` separator among gallery items, or 0 when no separator is shown. */
export function galleryStripSplitAt(selectedCount, length) {
  const n = Math.max(0, Math.floor(finiteNumber(length, 0)));
  const s = Math.max(0, Math.min(Math.floor(finiteNumber(selectedCount, 0)), n));
  return s > 0 && s < n ? s : 0;
}

/**
 * Map a flex child index (including the `|` node) back to a gallery index.
 * Returns -1 for the separator itself or out-of-range children.
 */
export function galleryIndexFromChildIndex(childIndex, selectedCount, length) {
  const n = Math.max(0, Math.floor(finiteNumber(length, 0)));
  const child = Math.floor(finiteNumber(childIndex, -1));
  if (child < 0 || n <= 0) return -1;
  const splitAt = galleryStripSplitAt(selectedCount, n);
  if (splitAt <= 0) return child < n ? child : -1;
  if (child === splitAt) return -1;
  const gal = child > splitAt ? child - 1 : child;
  return gal >= 0 && gal < n ? gal : -1;
}

/**
 * Map content-X inside the thumb strip to a gallery index.
 * `localX` = clientX - strip.left + scrollOffset (transform or scrollLeft).
 * Accounts for the `|` separator flex child and post-split margin-left.
 */
export function thumbIndexAtStripX(localX, {
  count = 0,
  selectedCount = 0,
  thumbWidth = VIEWER_THUMB_LAYOUT.width,
  gap = VIEWER_THUMB_LAYOUT.gap,
  splitWidth = VIEWER_THUMB_LAYOUT.splitWidth,
  splitExtraMargin = VIEWER_THUMB_LAYOUT.splitExtraMargin,
} = {}) {
  const n = Math.max(0, Math.floor(finiteNumber(count, 0)));
  if (n <= 0) return -1;
  const x = finiteNumber(localX, NaN);
  if (!Number.isFinite(x) || x < 0) return -1;
  const tw = Math.max(1, finiteNumber(thumbWidth, VIEWER_THUMB_LAYOUT.width));
  const g = Math.max(0, finiteNumber(gap, VIEWER_THUMB_LAYOUT.gap));
  const sw = Math.max(0, finiteNumber(splitWidth, VIEWER_THUMB_LAYOUT.splitWidth));
  const sm = Math.max(0, finiteNumber(splitExtraMargin, VIEWER_THUMB_LAYOUT.splitExtraMargin));
  const splitAt = galleryStripSplitAt(selectedCount, n);
  const kids = [];
  for (let i = 0; i < n; i += 1) {
    if (splitAt > 0 && i === splitAt) kids.push({ type: "split" });
    kids.push({
      type: "thumb",
      galIdx: i,
      marginLeft: splitAt > 0 && i === splitAt ? sm : 0,
    });
  }
  let cursor = 0;
  for (let k = 0; k < kids.length; k += 1) {
    if (k > 0) cursor += g;
    const kid = kids[k];
    if (kid.type === "split") {
      if (x >= cursor && x < cursor + sw) return -1;
      cursor += sw;
      continue;
    }
    cursor += kid.marginLeft;
    if (x >= cursor && x < cursor + tw) return kid.galIdx;
    cursor += tw;
  }
  return -1;
}

/** Full content width of the thumb strip (for transform-scroll clamping). */
export function galleryStripContentWidth({
  count = 0,
  selectedCount = 0,
  thumbWidth = VIEWER_THUMB_LAYOUT.width,
  gap = VIEWER_THUMB_LAYOUT.gap,
  splitWidth = VIEWER_THUMB_LAYOUT.splitWidth,
  splitExtraMargin = VIEWER_THUMB_LAYOUT.splitExtraMargin,
} = {}) {
  const n = Math.max(0, Math.floor(finiteNumber(count, 0)));
  if (n <= 0) return 0;
  const tw = Math.max(1, finiteNumber(thumbWidth, VIEWER_THUMB_LAYOUT.width));
  const g = Math.max(0, finiteNumber(gap, VIEWER_THUMB_LAYOUT.gap));
  const sw = Math.max(0, finiteNumber(splitWidth, VIEWER_THUMB_LAYOUT.splitWidth));
  const sm = Math.max(0, finiteNumber(splitExtraMargin, VIEWER_THUMB_LAYOUT.splitExtraMargin));
  const splitAt = galleryStripSplitAt(selectedCount, n);
  const childCount = n + (splitAt > 0 ? 1 : 0);
  let width = n * tw + Math.max(0, childCount - 1) * g;
  if (splitAt > 0) width += sw + sm;
  return width;
}

/** Clamp transform-scroll offset into [0, max(0, content - viewport)]. */
export function clampThumbScrollOffset(offset, contentWidth, viewportWidth) {
  const max = Math.max(0, finiteNumber(contentWidth, 0) - Math.max(0, finiteNumber(viewportWidth, 0)));
  const raw = finiteNumber(offset, 0);
  return Math.max(0, Math.min(max, raw));
}

/**
 * Parse LLM vision autotag JSON into appearance / attire / accessories.
 * Accepts fenced ```json blocks or a bare object; falls back to splitting a flat tag string.
 */
export function parseAutotagLookJson(raw) {
  const text = String(raw || "").trim();
  if (!text) {
    return { appearance: "", attire: "", accessories: "", text: "" };
  }
  let obj = null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : text).trim();
  const brace = candidate.match(/\{[\s\S]*\}/);
  if (brace) {
    try {
      obj = JSON.parse(brace[0]);
    } catch {
      obj = null;
    }
  }
  if (obj && typeof obj === "object") {
    const appearance = String(obj.appearance ?? obj.look ?? obj.identity ?? "").trim();
    const attire = String(obj.attire ?? obj.clothing ?? obj.outfit ?? "").trim();
    const accessories = String(obj.accessories ?? obj.accessory ?? obj.props ?? "").trim();
    const joined = [appearance, attire, accessories].filter(Boolean).join(", ");
    return { appearance, attire, accessories, text: joined };
  }
  // Legacy flat tag dump → put everything in appearance.
  const flat = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  return { appearance: flat, attire: "", accessories: "", text: flat };
}

/** Nearby gallery card ids for eager data-URL encoding (visible window, capped). */
export function visibleGalleryImageIds(items, index = 0, radius = 1, maxCount = 8) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return [];
  const idx = Math.max(0, Math.min(finiteNumber(index, 0), list.length - 1));
  const cap = Math.max(1, Math.min(list.length, finiteNumber(maxCount, 8) || 8));
  // Prefer a centered window of up to maxCount; radius is a minimum span hint.
  const minSpan = Math.min(cap, 1 + 2 * Math.max(0, finiteNumber(radius, 1)));
  const span = Math.max(minSpan, cap);
  let start = Math.max(0, idx - Math.floor((span - 1) / 2));
  let end = Math.min(list.length - 1, start + span - 1);
  start = Math.max(0, end - span + 1);
  const ids = [];
  const seen = new Set();
  for (let i = start; i <= end; i += 1) {
    const id = String(list[i]?.id || "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length >= cap) break;
  }
  return ids;
}

const PAINT_RANK = { chrome: 1, content: 2, full: 3 };

/** Coalesce pending viewer paint jobs — fuller modes win. */
export function mergeViewerPaintJob(pending, next) {
  const a = PAINT_RANK[pending] || 0;
  const b = PAINT_RANK[next] || 0;
  if (!a && !b) return "full";
  if (b >= a) return next || pending || "full";
  return pending || next || "full";
}

function clampPercent(value) {
  return Math.max(0, Math.min(100, finiteNumber(value, 0)));
}

/**
 * Equal band start for index in [0, count): 4 shots → 0 / 25 / 50 / 75.
 * Sticky segments then own [start, next) slices of the message (0–25, 25–50, …).
 */
export function evenAnchorPercent(index, count) {
  const n = Math.max(1, finiteNumber(count, 1));
  const i = Math.max(0, Math.min(finiteNumber(index, 0), n - 1));
  return (i / n) * 100;
}

/**
 * Prefer card y_percent / anchor_percent; else even band starts.
 * Pass `{ forceEven: true }` when LLM placement is OFF so saved y% is ignored.
 */
export function resolveCardAnchorPercent(card, index = 0, count = 1, opts = null) {
  if (opts && opts.forceEven) return evenAnchorPercent(index, count);
  const raw = card?.y_percent ?? card?.anchor_percent ?? card?.read_percent;
  const n = Number(raw);
  if (Number.isFinite(n)) return clampPercent(n);
  return evenAnchorPercent(index, count);
}

/**
 * Reading line as % through a message rect.
 * Returns null when the reading line is outside the message box.
 */
export function readingPercentInMessage(rect, viewportH, lineRatio = 0.5) {
  if (!rect) return null;
  const height = Math.max(1, finiteNumber(rect.height, 0));
  const lineY = Math.max(0, finiteNumber(viewportH, 0)) * (Number.isFinite(lineRatio) ? lineRatio : 0.5);
  if (lineY < finiteNumber(rect.top, 0) || lineY > finiteNumber(rect.bottom, 0)) return null;
  return clampPercent((lineY - finiteNumber(rect.top, 0)) / height * 100);
}

/** Clamp reading % when the line is outside but we still want a band. */
export function clampReadingPercent(rect, viewportH, lineRatio = 0.5) {
  const inside = readingPercentInMessage(rect, viewportH, lineRatio);
  if (inside != null) return inside;
  const lineY = Math.max(0, finiteNumber(viewportH, 0)) * (Number.isFinite(lineRatio) ? lineRatio : 0.5);
  return finiteNumber(rect?.bottom, 0) < lineY ? 100 : 0;
}

/**
 * Active sticky segment for sorted marker y% thresholds.
 * Single marker ≤20% is treated as 1% so it activates early.
 * Before the first threshold → -1 (no active band yet).
 */
export function activeSegmentIndex(markerPercents, readingPct) {
  const list = Array.isArray(markerPercents) ? markerPercents : [];
  if (!list.length) return -1;
  const reading = clampPercent(readingPct);
  const raw = list.map((v) => clampPercent(v));
  const low = raw.reduce((acc, v, i) => (v <= 20 ? acc.concat(i) : acc), []);
  // Sole early marker → 1% (legacy). Keep exact 0 so equal band starts [0, 25, …] activate from the top.
  const thresholds = low.length === 1 && raw[low[0]] > 0
    ? raw.map((v, i) => (i === low[0] ? 1 : v))
    : raw;
  if (thresholds[0] > 0 && reading < thresholds[0]) return -1;
  let active = 0;
  for (let i = 0; i < thresholds.length; i += 1) {
    if (reading >= thresholds[i]) active = i;
  }
  return active;
}
