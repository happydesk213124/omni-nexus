import { chatImageSizeStyle } from '../domain/inray-display';
/**
 * Chat-overlay geometry and matching logic.
 *
 * Pure by contract: every DOM-shaped argument is a plain object, so nothing here
 * touches `document`, storage or the network. The frozen UI bundle reads these
 * symbols off the global, so no export may be renamed.
 */

export { matchCharactersInText } from '../domain/character/roster';
import {
  bakeTokenForCard,
  htmlHasBakeWrapForCard,
  messageHasBakeTokenForCard,
  stripBakeTokens,
} from '../domain/chat-bake';
export {
  bakeTokenForCard,
  htmlHasBakeWrapForCard,
  htmlHasInrayBake,
  messageHasBakeToken,
  messageHasBakeTokenForCard,
  proseForHash,
  replaceBakeTokenCard,
  stripBakeTokenForCard,
  stripBakeTokens,
} from '../domain/chat-bake';
import { normalizeShotKind } from '../domain/comic/kind';
import { resolveShotAspect } from '../domain/nai-meta/aspect';
import { normalizeInlineChatTextSide } from '../domain/inline-chat';
import {
  inlineMsgActionsLegacy,
  inlineMsgActionsOn,
  inlineMsgFanOn,
  normalizeInlineMsgActions,
} from '../domain/inline-msg-actions';
import {
  IMAGE_DOUBLE_TAP_SLOP_PX,
  IMAGE_DOUBLE_TAP_WINDOW_MS,
  IMAGE_PRESS_WINDOW_MS,
  imagePressAllowsDoubleTap,
  imagePressAllowsHold,
  imagePressAllowsSecondPointer,
  imagePressAllowsTripleTap,
  imagePressDoubleTapHits,
  imagePressDownCount,
  imagePressIgnorePointerCancel,
  imagePressMoveCancels,
  imagePressOtherPointerUp,
  imagePressTapHits,
  imagePressTapNeed,
  noteImagePressDown,
  noteImagePressUp,
  normalizeImagePressInspect,
  normalizeToastAnchor,
  pruneImagePressDowns,
} from '../domain/toast-press';
export {
  inlineMsgActionsLegacy,
  inlineMsgActionsOn,
  inlineMsgFanOn,
  normalizeInlineMsgActions,
};
export { normalizeInlineChatTextSide };
export type { InlineChatTextSide } from '../domain/inline-chat';
export {
  IMAGE_DOUBLE_TAP_SLOP_PX,
  IMAGE_DOUBLE_TAP_WINDOW_MS,
  IMAGE_PRESS_WINDOW_MS,
  imagePressAllowsDoubleTap,
  imagePressAllowsHold,
  imagePressAllowsSecondPointer,
  imagePressAllowsTripleTap,
  imagePressDoubleTapHits,
  imagePressDownCount,
  imagePressIgnorePointerCancel,
  imagePressMoveCancels,
  imagePressOtherPointerUp,
  imagePressTapHits,
  imagePressTapNeed,
  noteImagePressDown,
  noteImagePressUp,
  normalizeImagePressInspect,
  normalizeToastAnchor,
  pruneImagePressDowns,
};
export type { ImagePressInspect, ToastAnchor } from '../domain/toast-press';

// ── shared shapes ─────────────────────────────────────────────────────────

/** A gallery card as the viewer reads it — every field is optional on purpose. */
export interface GalleryCard {
  id?: string;
  content_hash?: string;
  character_id?: string;
  chat_id?: string;
  session_id?: string;
  message_index?: number;
  message_role?: string;
  role?: string;
  assistant_preview?: string;
  paragraph?: number;
  shot_index?: number;
  created_at?: number;
  y_percent?: number;
  anchor_percent?: number;
  read_percent?: number;
  image_url?: string;
  [key: string]: unknown;
}

/** The message the viewer is currently pinned to. */
export interface SelectedMessage {
  hash?: string;
  sessionId?: string;
  chatIndex?: number;
  messageIndex?: number;
  text?: string;
  hostMessageId?: string;
  host_message_id?: string;
  [key: string]: unknown;
}

/**
 * Risu's per-message id when the host exposes one. Never chatId — that is the
 * chat, not the turn, and would glue every bubble to the same shots.
 */
export function hostMessageId(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number') {
    const s = String(value).trim();
    return s && s.length <= 160 ? s : '';
  }
  if (typeof value !== 'object') return '';
  const rec = value as Record<string, unknown>;
  // Cards store the shot id in `id`. That must never win over a missing host id.
  const looksLikeCard = rec.content_hash != null || rec.shot_index != null || rec.main_prompt != null;
  const keys = looksLikeCard
    ? ['hostMessageId', 'host_message_id', 'messageId', 'message_id', 'msgId', 'm_id', 'generationId']
    : ['hostMessageId', 'host_message_id', 'messageId', 'message_id', 'msgId', 'm_id', 'id', 'uid', 'uuid', 'generationId'];
  for (const key of keys) {
    const s = String(rec[key] ?? '').trim();
    if (s && s.length <= 160) return s;
  }
  const gi = rec.generationInfo ?? rec.generation_info ?? rec.messageGenerationInfo;
  if (gi && typeof gi === 'object') {
    const g = gi as Record<string, unknown>;
    const s = String(g.generationId ?? g.generation_id ?? '').trim();
    if (s && s.length <= 160) return s;
  }
  return '';
}

/** Hash-independent owner for serialising writes into one physical message bubble. */
export function inlineInjectOwnerKey(
  message: SelectedMessage | Record<string, unknown> | null | undefined,
  domIndex: unknown = -1,
  fallbackSessionId: unknown = '',
): string {
  const sessionId = String(message?.sessionId || message?.session_id || fallbackSessionId || '');
  const rawMessageIndex = message?.messageIndex ?? message?.message_index ?? message?.chatIndex;
  const messageIndex = Number(rawMessageIndex);
  const dom = Number(domIndex);
  const position = rawMessageIndex != null && Number.isInteger(messageIndex) && messageIndex >= 0
    ? `m${messageIndex}`
    : Number.isInteger(dom) && dom >= 0
      ? `d${dom}`
      : 'd?';
  return `${sessionId || 'unknown'}|${position}`;
}

/** One row of `chat.message[]` as delivered by the host API. */
export interface ChatMessage {
  index?: number;
  role?: string;
  type?: string;
  speaker?: string;
  sender?: string;
  from?: string;
  name?: string;
  text?: string;
  data?: string;
  content?: string;
  isUser?: boolean;
  fromUser?: boolean;
  isAssistant?: boolean;
  isBot?: boolean;
  isChar?: boolean;
  generationInfo?: unknown;
  generation_info?: unknown;
  messageGenerationInfo?: unknown;
  [key: string]: unknown;
}

/** A `getBoundingClientRect()` result reduced to the fields used here. */
export interface MessageRect {
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
  width?: number;
  height?: number;
}

export type StickyCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export interface SizeBox {
  w?: number;
  h?: number;
}

const INLINE_BASE_WIDTH = 528;
const INLINE_BASE_HEIGHT = 720;

function finiteNumber(value: unknown, fallback = 0): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function mergePatch(
  target: Record<string, unknown>,
  patch: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...target };
  for (const [key, value] of Object.entries<unknown>(patch || {})) {
    const current = result[key];
    result[key] = value && typeof value === 'object' && !Array.isArray(value)
      ? mergePatch(
        current && typeof current === 'object' ? current as Record<string, unknown> : {},
        value as Record<string, unknown>,
      )
      : value;
  }
  return result;
}

// ── inline thumbnail scaling ──────────────────────────────────────────────

/** Inline preview box for a user-facing scale percentage (100% = the legacy 600%). */
export function scaleInlineThumbnail(percent: unknown): { width: number; height: number; percent: number } {
  const normalized = Math.max(1, finiteNumber(percent, 100));
  return {
    width: Math.max(1, Math.round(INLINE_BASE_WIDTH * normalized / 100)),
    height: Math.max(1, Math.round(INLINE_BASE_HEIGHT * normalized / 100)),
    percent: normalized,
  };
}

// ── text similarity ───────────────────────────────────────────────────────

/**
 * Drop Lightboard dumps so length/similarity see only the surrounding prose.
 * Tags themselves are included in the removed span.
 */
export function stripLbdataBlocks(value: unknown): string {
  let s = String(value ?? '');
  s = s.replace(/\[LBDATA\s+START\][\s\S]*?\[LBDATA\s+END\]/gi, '');
  s = s.replace(/\[LBDATA\s+END\][\s\S]*?\[LBDATA\s+START\]/gi, '');
  s = s.replace(/\[LBDATA\s+(?:START|END)\]/gi, '');
  return s;
}

/** Non-whitespace length after stripping LBDATA (generation gate). */
export function messageBodyCharCount(value: unknown): number {
  return stripLbdataBlocks(value).replace(/\s+/g, '').length;
}

const MATCH_TEXT_CACHE_MAX = 256;
const matchTextCache = new Map<string, string>();

/** Strip to letters/digits for soft text matching (streaming-safe). */
export function normalizeMatchText(value: unknown): string {
  const raw = String(value ?? '');
  const hit = matchTextCache.get(raw);
  if (hit !== undefined) return hit;
  const out = stripLbdataBlocks(raw).replace(/[^a-zA-Z0-9\uac00-\ud7a3\u3040-\u30ff\u3400-\u9fff\uff00-\uffef]/g, '').toLowerCase();
  if (matchTextCache.size >= MATCH_TEXT_CACHE_MAX) {
    const first = matchTextCache.keys().next().value;
    if (first !== undefined) matchTextCache.delete(first);
  }
  matchTextCache.set(raw, out);
  return out;
}

/** @deprecated use HASH_REBIND_THRESHOLD — kept for older call sites */
export const PREFIX_MATCH_THRESHOLD = 0.6;
/** Minimum soft-similarity score that may re-bind a card to a new content hash. */
export const HASH_REBIND_THRESHOLD = 0.6;
/** Below this many normalized characters, soft matching is refused as too risky. */
export const PREFIX_MATCH_MIN_CHARS = 24;
/** Cap soft compare length (Dice is O(n); keep headroom for long chats). */
export const SIMILARITY_COMPARE_MAX = 800;

/** Normalize role families: char/assistant/bot/model → char, user/human → user. */
export function normalizeMessageRole(role: unknown): string {
  const r = String(role || '').toLowerCase().trim();
  if (!r) return '';
  if (r === 'char' || r === 'assistant' || r === 'bot' || r === 'model' || r === 'character' || r === 'ai') return 'char';
  if (r === 'user' || r === 'human') return 'user';
  return r;
}

/** Longest common prefix length of two already-normalized strings. */
export function longestCommonPrefixLength(a: string, b: string): number {
  const x = String(a || '');
  const y = String(b || '');
  const n = Math.min(x.length, y.length);
  let i = 0;
  while (i < n && x.charCodeAt(i) === y.charCodeAt(i)) i += 1;
  return i;
}

/** Character-bigram multiset counts for Dice coefficient. */
export function bigramCounts(text: string): Map<string, number> {
  const s = String(text || '');
  const counts = new Map<string, number>();
  if (s.length < 2) return counts;
  for (let i = 0; i < s.length - 1; i += 1) {
    const g = s.charCodeAt(i) + ',' + s.charCodeAt(i + 1);
    counts.set(g, (counts.get(g) || 0) + 1);
  }
  return counts;
}

/**
 * Dice coefficient on character bigrams in [0,1].
 * Famous fuzzy measure; O(n), tolerates a few edits anywhere (including the opening).
 */
export function diceBigramRatio(a: string, b: string, aCounts: Map<string, number> | null = null): number {
  const x = String(a || '');
  const y = String(b || '');
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
export function prefixMatchRatio(a: unknown, b: unknown): number {
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

// ── gallery ordering and message linking ──────────────────────────────────

/** Identity of the message a streaming rebind is looking for. */
export interface RebindIdentity {
  newHash?: string;
  hash?: string;
  text?: string;
  characterId?: string;
  chatId?: string;
  sessionId?: string;
  messageIndex?: number;
  role?: string;
  messageRole?: string;
  hostMessageId?: string;
  host_message_id?: string;
}

/**
 * Hot-path link: exact content_hash, then authoritative stored message index.
 * Soft/streaming upgrades go through findHashRebindCandidates + API rebind.
 * UI must still scan after a partial link (some shots already on newHash) —
 * maybeRebindAndLink attaches those siblings, then returns linkedCards for paint.
 */
export function linkCardsForMessage<T extends GalleryCard = GalleryCard>(
  cards: T[] | null | undefined,
  selectedMessage: SelectedMessage | null | undefined,
): T[] {
  if (!selectedMessage) return [];
  const list = Array.isArray(cards) ? cards : [];
  const selHost = hostMessageId(selectedMessage);
  const hash = String(selectedMessage.hash || '');
  const rawSelectedIndex = selectedMessage.messageIndex ?? selectedMessage.chatIndex;
  const selectedIndex = Number(rawSelectedIndex);
  const hasSelectedIndex = rawSelectedIndex != null
    && Number.isInteger(selectedIndex)
    && selectedIndex >= 0;
  const indexOk = (card: T): boolean => {
    if (!hasSelectedIndex) return true;
    const rawCardIndex = card.message_index;
    const cardIndex = Number(rawCardIndex);
    return rawCardIndex == null
      || !Number.isInteger(cardIndex)
      || cardIndex < 0
      || cardIndex === selectedIndex;
  };
  const byHost = selHost
    ? list.filter((card) => {
      const cardHost = hostMessageId(card);
      return !!cardHost && cardHost === selHost;
    })
    : [];
  if (byHost.length) return dedupeShotSlots(byHost);
  if (!hash) return [];
  return dedupeShotSlots(list.filter((card) => {
    if (selHost && hostMessageId(card) && hostMessageId(card) !== selHost) return false;
    if (!card?.content_hash || card.content_hash !== hash) return false;
    return indexOk(card);
  }));
}

/**
 * Same turn as the selected message — char/chat/msg/role only (hash ignored).
 * Used to skip duplicate auto-gen when images exist but are still unlinked.
 * Cards without message_role are skipped (no guessed role).
 */
export function findCardsForMessageIdentity<T extends GalleryCard = GalleryCard>(
  cards: T[] | null | undefined,
  identity: {
    characterId?: string;
    chatId?: string;
    sessionId?: string;
    messageIndex?: number;
    role?: string;
    messageRole?: string;
    hostMessageId?: string;
    host_message_id?: string;
  } = {},
): T[] {
  const list = Array.isArray(cards) ? cards : [];
  const characterId = String(identity.characterId || '');
  const chatId = String(identity.chatId || '');
  const sessionId = String(identity.sessionId || '');
  const messageIndex = Number(identity.messageIndex);
  const role = normalizeMessageRole(identity.role || identity.messageRole || '');
  if (!characterId || !role || !Number.isFinite(messageIndex) || messageIndex < 0) return [];
  const out: T[] = [];
  for (const card of list) {
    if (!String(card?.content_hash || '')) continue;
    if (String(card?.character_id || '') !== characterId) continue;
    const cardChat = String(card?.chat_id || '');
    const cardSession = String(card?.session_id || '');
    if (chatId) {
      if (cardChat !== chatId) continue;
    } else if (sessionId) {
      if (cardSession && cardSession !== sessionId) continue;
    } else {
      continue;
    }
    const selHost = hostMessageId(identity);
    const cardHost = hostMessageId(card);
    if (selHost && cardHost) {
      if (cardHost !== selHost) continue;
    } else if (Number(card?.message_index) !== messageIndex) {
      continue;
    }
    const cardRole = normalizeMessageRole(card?.message_role || card?.role || '');
    if (!cardRole || cardRole !== role) continue;
    out.push(card);
  }
  return dedupeShotSlots(out);
}

/**
 * Candidates for one-shot hash rebind after streaming changes content_hash.
 * Requires same character + chat + message_index + role; hash differs; Dice≥60%.
 * Cards without message_role are skipped (no guessed role).
 * Cards already on `newHash` are skipped per-row — siblings still on the old
 * streaming hash must remain eligible (mid-job: 3 rebound, 2 still generating).
 */
export function findHashRebindCandidates<T extends GalleryCard = GalleryCard>(
  cards: T[] | null | undefined,
  identity: RebindIdentity = {},
): T[] {
  const list = Array.isArray(cards) ? cards : [];
  const newHash = String(identity.newHash || identity.hash || '');
  const text = String(identity.text || '');
  const characterId = String(identity.characterId || '');
  const chatId = String(identity.chatId || '');
  const sessionId = String(identity.sessionId || '');
  const messageIndex = Number(identity.messageIndex);
  const role = normalizeMessageRole(identity.role || identity.messageRole || '');
  if (!newHash || !text || !characterId || !role || !Number.isFinite(messageIndex) || messageIndex < 0) return [];

  const textNorm = normalizeMatchText(text);
  if (textNorm.length < PREFIX_MATCH_MIN_CHARS) return [];
  const out: Array<{ card: T; score: number }> = [];
  for (const card of findCardsForMessageIdentity(list, {
    characterId,
    chatId,
    sessionId,
    messageIndex,
    role,
    hostMessageId: identity.hostMessageId,
    host_message_id: identity.host_message_id,
  })) {
    const cardHash = String(card?.content_hash || '');
    if (!cardHash || cardHash === newHash) continue;
    const selHost = hostMessageId(identity);
    const cardHost = hostMessageId(card);
    if (selHost && cardHost) {
      if (cardHost !== selHost) continue;
      out.push({ card, score: 1 });
      continue;
    }
    const preview = String(card?.assistant_preview || '');
    if (!preview) continue;
    const score = prefixMatchRatio(text, preview);
    if (score < HASH_REBIND_THRESHOLD) continue;
    out.push({ card, score });
  }
  out.sort((a, b) => b.score - a.score || finiteNumber(b.card?.created_at) - finiteNumber(a.card?.created_at));
  return dedupeShotSlots(out.map((row) => row.card));
}

/** Running-job save-hash retarget: same identity + Dice/prefix ≥ threshold. */
export interface JobSaveHashIdentity {
  toHash?: string;
  text?: string;
  sessionId?: string;
  characterId?: string;
  chatId?: string;
  messageIndex?: number;
  role?: string;
}

export interface JobSaveHashMeta {
  cancelRequested?: boolean;
  saveContentHash?: string;
  sourcePreview?: string;
  sessionId?: string;
  characterId?: string;
  chatId?: string;
  messageIndex?: number;
  messageRole?: string;
}

/**
 * True when meta targets the same char/chat/msg/role turn (hash ignored).
 * Used to skip duplicate Ka while a job for that turn is still running.
 */
export function jobMatchesMessageIdentity(
  meta: JobSaveHashMeta | null | undefined,
  identity: {
    sessionId?: string;
    characterId?: string;
    chatId?: string;
    messageIndex?: number;
    role?: string;
  } = {},
): boolean {
  if (!meta || meta.cancelRequested) return false;
  const characterId = String(identity.characterId || '');
  const chatId = String(identity.chatId || '');
  const sessionId = String(identity.sessionId || '');
  const messageIndex = Number(identity.messageIndex);
  const role = normalizeMessageRole(identity.role || '');
  if (!characterId || !role || !Number.isFinite(messageIndex) || messageIndex < 0) return false;
  if (String(meta.characterId || '') !== characterId) return false;
  if (Number(meta.messageIndex) !== messageIndex) return false;
  if (normalizeMessageRole(meta.messageRole) !== role) return false;
  if (chatId) {
    if (String(meta.chatId || '') !== chatId) return false;
  } else if (sessionId) {
    if (meta.sessionId && String(meta.sessionId) !== sessionId) return false;
  } else {
    return false;
  }
  return true;
}

/**
 * True when an in-flight job may rewrite later card saves to `toHash`.
 * Lock/busy key stays on the original hash — only the save stamp moves.
 */
export function canRetargetJobSaveHash(
  meta: JobSaveHashMeta | null | undefined,
  identity: JobSaveHashIdentity = {},
): boolean {
  if (!jobMatchesMessageIdentity(meta, identity)) return false;
  const toHash = String(identity.toHash || '').trim();
  const text = String(identity.text || '');
  if (!toHash || !text) return false;
  if (toHash === String(meta?.saveContentHash || '').trim()) return false;
  return prefixMatchRatio(meta?.sourcePreview || '', text) >= HASH_REBIND_THRESHOLD;
}

/** Prefer saved y%/anchor%; missing → +Infinity so they sort after placed shots. */
function cardYPercent(card: GalleryCard | null | undefined): number {
  const raw = card?.y_percent ?? card?.anchor_percent ?? card?.read_percent;
  const n = Number(raw);
  return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
}

function selectedOrder(left: GalleryCard | null | undefined, right: GalleryCard | null | undefined): number {
  return cardYPercent(left) - cardYPercent(right)
    || finiteNumber(left?.paragraph) - finiteNumber(right?.paragraph)
    || finiteNumber(left?.shot_index) - finiteNumber(right?.shot_index)
    || finiteNumber(right?.created_at) - finiteNumber(left?.created_at);
}

function newestOrder(left: GalleryCard | null | undefined, right: GalleryCard | null | undefined): number {
  return finiteNumber(right?.created_at) - finiteNumber(left?.created_at)
    || finiteNumber(right?.message_index) - finiteNumber(left?.message_index)
    || finiteNumber(right?.paragraph) - finiteNumber(left?.paragraph)
    || finiteNumber(right?.shot_index) - finiteNumber(left?.shot_index);
}

/** Keep newest card per paragraph|shot slot. */
function dedupeShotSlots<T extends GalleryCard>(cards: T[] | null | undefined): T[] {
  const unique = new Map<string, T>();
  for (const card of cards || []) {
    const key = `${card?.paragraph ?? '?'}|${card?.shot_index ?? card?.id}`;
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
export function galleryForMessage<T extends GalleryCard = GalleryCard>(
  cards: T[] | null | undefined,
  selectedMessage: SelectedMessage | null | undefined,
  maxCount = 8,
): T[] {
  const unique = new Map<string, T>();
  for (const card of cards || []) {
    const id = String(card?.id || '');
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
  const sessionId = String(selectedMessage.sessionId || '');
  const remaining = values
    .filter((card) => !selectedIds.has(String(card.id)))
    .filter((card) => !sessionId || !card?.session_id || card.session_id === sessionId)
    .sort(newestOrder)
    .slice(0, restCap);
  return [...selected, ...remaining];
}

/** How many gallery cards belong to the selected message. */
export function gallerySelectedCount(
  cards: GalleryCard[] | null | undefined,
  selectedMessage: SelectedMessage | null | undefined,
): number {
  if (!selectedMessage) return 0;
  return linkCardsForMessage(cards, selectedMessage).length;
}

/**
 * Message used for the left "current message images" strip.
 * When the live selection has no images yet, keep the last imaged message so the strip does not collapse/rebuild.
 * Never fall back across sessions — a chat switch must not keep the previous chat's strip.
 */
export function galleryFocusMessage(
  selectedMessage: SelectedMessage | null | undefined,
  lastImagedMessage: SelectedMessage | null | undefined,
  cards: GalleryCard[] | null | undefined,
): SelectedMessage | null {
  if (selectedMessage && gallerySelectedCount(cards, selectedMessage) > 0) return selectedMessage;
  const selSession = String(selectedMessage?.sessionId || selectedMessage?.session_id || '');
  const lastSession = String(lastImagedMessage?.sessionId || lastImagedMessage?.session_id || '');
  const lastOk = !!lastImagedMessage
    && gallerySelectedCount(cards, lastImagedMessage) > 0
    && (!selSession || !lastSession || selSession === lastSession);
  if (lastOk) return lastImagedMessage!;
  return selectedMessage || null;
}

// ── message role detection ────────────────────────────────────────────────

/**
 * Archive-style role from chat.message fields only (never from DOM/text).
 * Returns: "user" | "char" | "system" | "".
 */
export function rawMessageRole(message: ChatMessage | null | undefined): string {
  const role = String(
    message?.role || message?.type || message?.speaker || message?.sender || message?.from || message?.name || '',
  ).trim().toLowerCase();
  if (
    message?.isUser === true
    || message?.fromUser === true
    || /^(user|human|player|you|me)$/.test(role)
    || role.includes('user')
  ) return 'user';
  if (
    message?.isAssistant === true
    || message?.isBot === true
    || message?.isChar === true
    || /^(assistant|bot|char|character|model|ai)$/.test(role)
    || role.includes('assistant')
    || role.includes('bot')
    || role.includes('char')
  ) return 'char';
  if (role === 'system' || role === 'developer') return 'system';
  return '';
}

/** Risu AI turns usually carry generationInfo / generation_info. */
export function hasGenerationInfo(message: ChatMessage | null | undefined): boolean {
  const info = message?.generationInfo ?? message?.generation_info ?? message?.messageGenerationInfo;
  if (info == null) return false;
  if (typeof info === 'string') return info.trim().length > 0;
  if (typeof info === 'object') return Object.keys(info).length > 0;
  return true;
}

/**
 * Optional hint only: Risu AI turns often carry generationInfo.
 * Do NOT use this as the selection role — prefer message.role via rawMessageRole.
 */
export function roleFromGenerationInfo(message: ChatMessage | null | undefined): string {
  return hasGenerationInfo(message) ? 'char' : 'user';
}

/** True when the message is a character/assistant turn eligible for image gen. */
export function isCharMessageRole(roleOrMessage: string | ChatMessage | null | undefined): boolean {
  if (roleOrMessage && typeof roleOrMessage === 'object') {
    return rawMessageRole(roleOrMessage) === 'char';
  }
  const role = String(roleOrMessage || '').trim().toLowerCase();
  return role === 'char' || role === 'assistant' || role === 'bot' || role === 'model' || role === 'character' || role === 'ai';
}

/**
 * User bubbles never get inline shots unless `generate_all_roles` is on.
 * A reverse-index mis-tag or a newest-first shift must not plant a char shot here.
 */
export function allowInlineImagesOnRole(role: unknown, allRoles = false): boolean {
  if (allRoles) return true;
  return isCharMessageRole(String(role || ''));
}

export type InlineRoleDisposition = 'allow' | 'deny' | 'hold';

/**
 * Missing role evidence is not evidence of a user turn. Keep mounted shots
 * untouched until the DOM/API match is conclusive; only a verified user role
 * may remove them.
 */
export function inlineRoleDisposition(role: unknown, allRoles = false): InlineRoleDisposition {
  if (allRoles) return 'allow';
  const normalized = normalizeMessageRole(role);
  if (!normalized) return 'hold';
  if (isCharMessageRole(normalized)) return 'allow';
  return normalized === 'user' ? 'deny' : 'hold';
}

/** Selection still names the old char hash after a new user message stole DOM#0. */
export function selectionSlotDrifted(selHash: unknown, liveHash: unknown): boolean {
  const sel = String(selHash || '');
  const live = String(liveHash || '');
  if (!sel || !live) return false;
  return sel !== live;
}

/** Prefer the resolved DOM hash. `sel.hash` is only a fallback when this slot still is the selection. */
export function liveBubbleHash(opts: {
  liveHash?: unknown;
  selHash?: unknown;
  idx?: unknown;
  selIdx?: unknown;
} = {}): string {
  const live = String(opts.liveHash || '');
  if (live) return live;
  const idx = Number(opts.idx);
  const selIdx = Number(opts.selIdx);
  if (Number.isFinite(idx) && Number.isFinite(selIdx) && idx === selIdx) {
    return String(opts.selHash || '');
  }
  return '';
}

/**
 * Role used for keep/inject. Prefer the selection when this slot still is that
 * message. If the live hash drifted, or reverse-index role does not overlap the
 * DOM body, do not treat the bubble as char.
 */
export function roleForInlineBubble(opts: {
  idx?: unknown;
  selIdx?: unknown;
  selRole?: unknown;
  selHash?: unknown;
  liveHash?: unknown;
  matchedRole?: unknown;
  domText?: unknown;
  matchedText?: unknown;
} = {}): string {
  const idx = Number(opts.idx);
  const selIdx = Number(opts.selIdx);
  const selRole = normalizeMessageRole(opts.selRole);
  const matched = normalizeMessageRole(opts.matchedRole);
  const onSel = Number.isFinite(idx) && Number.isFinite(selIdx) && idx === selIdx;
  const drifted = selectionSlotDrifted(opts.selHash, opts.liveHash);
  if (onSel && selRole && !drifted) return selRole;
  const apiText = String(opts.matchedText || '');
  const domText = String(opts.domText || '');
  if (matched && apiText && domText && messagesTextOverlapScore(domText, apiText) < 8) {
    return '';
  }
  if (matched) return matched;
  // Drifted identity must not inherit the previous turn's role.
  if (onSel && drifted) return '';
  if (onSel && selRole) return selRole;
  return '';
}

/** Drop char cards when this slot is a user turn or the selection identity drifted. */
export function cardsForInlineBubble<T>(opts: {
  cards?: readonly T[] | null;
  role?: unknown;
  allRoles?: boolean;
  selHash?: unknown;
  liveHash?: unknown;
  isSelectionSlot?: boolean;
} = {}): T[] {
  const list = Array.isArray(opts.cards) ? [...opts.cards] : [];
  if (opts.isSelectionSlot && selectionSlotDrifted(opts.selHash, opts.liveHash)) return [];
  const role = normalizeMessageRole(opts.role);
  // Unresolved is not a user turn. Dropping cards here left first-boot / tag-gen
  // with chips but no spinner, then a spinner that never received its photo.
  if (!role) return list;
  if (!allowInlineImagesOnRole(role, !!opts.allRoles)) return [];
  return list;
}

/** Retain unresolved bubbles only when the same hash already owns mounted frames. */
export function retainHeldInlineKeepIndices(opts: {
  keepIndices?: unknown;
  previousHashes?: unknown;
  rows?: unknown;
} = {}): number[] {
  const keep = new Set<number>();
  if (Array.isArray(opts.keepIndices)) {
    for (const raw of opts.keepIndices) {
      const idx = Number(raw);
      if (Number.isInteger(idx) && idx >= 0) keep.add(idx);
    }
  }
  const previous = new Set(
    Array.isArray(opts.previousHashes)
      ? opts.previousHashes.map((value) => String(value || '')).filter(Boolean)
      : [],
  );
  if (previous.size && Array.isArray(opts.rows)) {
    for (const raw of opts.rows) {
      const row = raw as { idx?: unknown; hash?: unknown; disposition?: unknown } | null;
      const idx = Number(row?.idx);
      const hash = String(row?.hash || '');
      if (
        Number.isInteger(idx)
        && idx >= 0
        && row?.disposition === 'hold'
        && hash
        && previous.has(hash)
      ) {
        keep.add(idx);
      }
    }
  }
  return [...keep].sort((a, b) => a - b);
}

/** Max char bubbles kept above/below selection when inline skips user roles. */
export const INLINE_KEEP_MAX_PER_SIDE = 4;

/** Dashboard inline radius: spinner stamp window. Photos use 1. */
export function clampInlineDomRadius(value: unknown): number {
  const n = Math.round(finiteNumber(value, 4));
  if (!Number.isFinite(n) || n <= 0) return 4;
  return Math.max(3, Math.min(20, n));
}

/** Inclusive DOM indices around selection. Never walks the whole chat. */
export function inlineDomWindow(selIdx: unknown, length: unknown, radius: unknown): number[] {
  const sel = Math.floor(Number(selIdx));
  const len = Math.floor(Number(length));
  const r = Math.max(0, Math.floor(Number(radius)));
  if (!Number.isInteger(sel) || !Number.isInteger(len) || sel < 0 || len <= 0 || sel >= len) return [];
  const out: number[] = [];
  const lo = Math.max(0, sel - r);
  const hi = Math.min(len - 1, sel + r);
  for (let i = lo; i <= hi; i += 1) out.push(i);
  return out;
}

/** Same window, but selected first then ±1, ±2, … so stamp/encode radiate out. */
export function inlineDomWindowFromSel(selIdx: unknown, length: unknown, radius: unknown): number[] {
  const range = inlineDomWindow(selIdx, length, radius);
  if (!range.length) return [];
  const sel = Math.floor(Number(selIdx));
  const r = Math.max(0, Math.floor(Number(radius)));
  const out: number[] = [];
  if (range.includes(sel)) out.push(sel);
  for (let d = 1; d <= r; d += 1) {
    const left = sel - d;
    const right = sel + d;
    if (range.includes(left)) out.push(left);
    if (range.includes(right)) out.push(right);
  }
  return out;
}

/**
 * Photos sit on the selection and its nearest neighbour each side, unless that
 * bubble is a verified user turn.
 *
 * `window` is the character-counted photo list from `inlineWindowFromRoles`.
 * Without it this falls back to DOM ±1, which is what a caller that has no role
 * information can still answer correctly.
 */
export function shouldOverlayInlinePhoto(opts: {
  idx?: unknown;
  selIdx?: unknown;
  length?: unknown;
  role?: unknown;
  window?: readonly number[] | null;
} = {}): boolean {
  const idx = Math.floor(Number(opts.idx));
  if (!Number.isInteger(idx) || idx < 0) return false;
  const scope = Array.isArray(opts.window)
    ? opts.window.map((value) => Math.floor(Number(value)))
    : inlineDomWindow(opts.selIdx, opts.length, 1);
  if (!scope.includes(idx)) return false;
  return normalizeMessageRole(opts.role) !== 'user';
}

/** Selected bubble plus this many DOM slots each side — 5 asks when the chat is long enough. */
export const INLINE_ROLE_PREFETCH_RADIUS = 4;

/**
 * DOM indices whose role/text we ask in parallel before the ± walk.
 *
 * The walk still decides keep. This list is only the first wave: sel ± radius,
 * clamped to the chat. Two messages stay two; we never invent slots.
 */
export function prefetchInlineRoleDomIndices(opts: {
  selIdx?: unknown;
  length?: unknown;
  radius?: unknown;
} = {}): number[] {
  const sel = Number(opts.selIdx);
  const length = Number(opts.length);
  if (!Number.isInteger(sel) || !Number.isInteger(length) || sel < 0 || length <= 0 || sel >= length) {
    return [];
  }
  const raw = Number(opts.radius);
  const radius = Number.isInteger(raw) && raw >= 0 ? raw : INLINE_ROLE_PREFETCH_RADIUS;
  const lo = Math.max(0, sel - radius);
  const hi = Math.min(length - 1, sel + radius);
  const out: number[] = [];
  for (let i = lo; i <= hi; i += 1) out.push(i);
  return out;
}

/**
 * One-line fingerprint of everything a bubble's paint depends on.
 *
 * Two runs with the same key produce byte-identical markers and chips, so the
 * bubble can be left alone. Card order is not meaningful — sort so a reordered
 * link list does not force a repaint.
 */
export function inlinePaintKey(opts: {
  cardIds?: unknown;
  scalePct?: unknown;
  msgActions?: unknown;
  pending?: unknown;
} = {}): string {
  const ids = Array.isArray(opts.cardIds)
    ? [...new Set(opts.cardIds.map((v) => String(v ?? '')).filter(Boolean))].sort()
    : [];
  const scale = Math.max(25, Math.min(200, Math.round(finiteNumber(opts.scalePct, 100)) || 100));
  const acts = String(opts.msgActions ?? '');
  const pending = opts.pending ? '1' : '0';
  // Deliberately no DOM index. The chat DOM is newest-first, so one new message
  // shifts every slot, and a slot in the key made the whole keep window repaint
  // — visibly, because re-inserting through SafeDOM flashes empty first. The
  // only thing that really depends on the slot is the chip bar's
  // `x-inlay-msg-index`, and that is a one-round-trip attribute update.
  return `s${scale}|a=${acts}|p=${pending}|c=${ids.join(',')}`;
}

/**
 * Split the keep window into bubbles that must be repainted and ones already
 * correct. A row without a hash always repaints — DOM index alone is not an
 * identity, it shifts the moment the chat grows.
 */
export function pickInlineRepaintIndices(opts: {
  rows?: unknown;
  painted?: unknown;
} = {}): { repaint: number[]; skip: number[] } {
  const rows = Array.isArray(opts.rows) ? opts.rows : [];
  const painted = opts.painted;
  const lookup = (hash: string): string => {
    if (!hash) return '';
    if (painted instanceof Map) return String(painted.get(hash) ?? '');
    if (painted && typeof painted === 'object') {
      return String((painted as Record<string, unknown>)[hash] ?? '');
    }
    return '';
  };
  const repaint: number[] = [];
  const skip: number[] = [];
  const seen = new Set<number>();
  for (const raw of rows) {
    const row = raw as { idx?: unknown; hash?: unknown; key?: unknown } | null;
    const idx = Number(row?.idx);
    if (!Number.isInteger(idx) || idx < 0 || seen.has(idx)) continue;
    seen.add(idx);
    const hash = String(row?.hash ?? '');
    const key = String(row?.key ?? '');
    if (hash && key && lookup(hash) === key) skip.push(idx);
    else repaint.push(idx);
  }
  return { repaint, skip };
}

/** True when the fingerprint named at least one card. Empty `c=` is a miss, not a paint. */
export function inlinePaintKeyHasCards(key: unknown): boolean {
  const s = String(key || '');
  const i = s.lastIndexOf('|c=');
  if (i < 0) return false;
  return s.slice(i + 3).length > 0;
}

/**
 * Empty desired is often "gallery not loaded yet", not "this bubble has no shots".
 * Live markers stay until a later pass actually finds cards — or the keep window
 * strips the bubble when it leaves. Force retag unlinks first and sets
 * confirmedEmpty so this pass may strip.
 */
export function shouldStripEmptyInlineDesired(opts: {
  liveShotCount?: unknown;
  confirmedEmpty?: unknown;
  forceStrip?: unknown;
} = {}): boolean {
  if (opts.forceStrip) return true;
  const live = Math.max(0, Math.floor(finiteNumber(opts.liveShotCount, 0)));
  if (live <= 0) return true;
  return !!opts.confirmedEmpty;
}

/** Same gate as auto-gen: LBDATA-stripped body too short → not an inline neighbor. */
export function isInlineSkipBody(value: unknown): boolean {
  return messageBodyCharCount(value) <= 30;
}

/** Tag/regen/stop/char/preset chips — real body only; LBDATA does not count. */
export const MSG_ACTION_MIN_BODY_CHARS = 20;
/** Top bar only when the real body is longer than this. Bottom stays at MSG_ACTION_MIN_BODY_CHARS. */
export const MSG_ACTION_TOP_MIN_BODY_CHARS = 500;

/**
 * Message-action chips sit on character turns with a real body.
 * Assistant/bot normalize to char. Unresolved or user roles stay chip-less.
 */
export function shouldMountMsgActions(opts: {
  role?: unknown;
  text?: unknown;
} = {}): boolean {
  if (messageBodyCharCount(opts.text) < MSG_ACTION_MIN_BODY_CHARS) return false;
  return normalizeMessageRole(opts.role) === 'char';
}

/**
 * Which chip rows to paint. Bottom follows host count (first+last paragraph).
 * Top is withheld until the real body is long enough that a header row
 * does not sit on a short bubble.
 */
export function msgActionWantedEnds(opts: {
  hostCount?: unknown;
  text?: unknown;
} = {}): Array<'top' | 'bot'> {
  const hosts = Math.max(0, Math.floor(finiteNumber(opts.hostCount, 0)));
  const chars = messageBodyCharCount(opts.text);
  if (hosts < 1 || chars < MSG_ACTION_MIN_BODY_CHARS) return [];
  const ends: Array<'top' | 'bot'> = [];
  if (chars > MSG_ACTION_TOP_MIN_BODY_CHARS) ends.push('top');
  if (hosts > 1) ends.push('bot');
  return ends;
}

/**
 * Fan emoji row. Always bottom when the body is long enough; top only above 500.
 * Unlike chips, a single-paragraph bubble still gets the bottom row.
 */
export function msgFanWantedEnds(opts: {
  text?: unknown;
} = {}): Array<'top' | 'bottom'> {
  const chars = messageBodyCharCount(opts.text);
  if (chars < MSG_ACTION_MIN_BODY_CHARS) return [];
  if (chars > MSG_ACTION_TOP_MIN_BODY_CHARS) return ['top', 'bottom'];
  return ['bottom'];
}

/**
 * DOM indices that keep inline shots. Chat DOM is newest-first:
 * higher index = older (above), lower = newer (below).
 *
 * - allRoles: walk past skip-body bubbles, keep up to maxPerSide each side (role-blind).
 * - else: keep selected only if char+body; walk past users and skip-body, keep up to
 *   `maxPerSide` chars above and below (default 1+1; +selected char → max 3).
 */
export function pickInlineKeepDomIndices(opts: {
  selIdx: number;
  length: number;
  allRoles: boolean;
  isCharAt: (idx: number) => boolean;
  maxPerSide?: number;
  isSkipBodyAt?: (idx: number) => boolean;
  /** DOM slots examined per side. Omitted = walk until the chat runs out. */
  scanCap?: number;
}): number[] {
  const selIdx = opts.selIdx;
  const length = opts.length;
  const maxPerSide = opts.maxPerSide ?? INLINE_KEEP_MAX_PER_SIDE;
  if (!Number.isFinite(selIdx) || selIdx < 0 || selIdx >= length || length <= 0) return [];
  // Roles come from a bounded prefetch, so the walk must stop where the answers
  // do. Past the cap every slot reads "unknown", which counts as char and would
  // hand back slots nobody looked at.
  const rawCap = Number(opts.scanCap);
  const cap = Number.isFinite(rawCap) && rawCap >= 0 ? Math.floor(rawCap) : Infinity;

  const skipBody = opts.isSkipBodyAt || (() => false);
  const canKeep = (i: number) => {
    if (skipBody(i)) return false;
    if (opts.allRoles) return true;
    return opts.isCharAt(i);
  };

  const out: number[] = [];
  const add = (i: number) => {
    if (i >= 0 && i < length && !out.includes(i)) out.push(i);
  };

  if (canKeep(selIdx)) add(selIdx);

  let found = 0;
  for (let i = selIdx + 1; i < length && found < maxPerSide && i - selIdx <= cap; i += 1) {
    if (canKeep(i)) {
      add(i);
      found += 1;
    }
  }
  found = 0;
  for (let i = selIdx - 1; i >= 0 && found < maxPerSide && selIdx - i <= cap; i -= 1) {
    if (canKeep(i)) {
      add(i);
      found += 1;
    }
  }
  return out;
}

/**
 * The two inline windows, counted in character bubbles rather than DOM slots.
 *
 * A chat alternates user and character turns, so a DOM-slot window of 4 only
 * ever reached two character bubbles — the setting promised four. Both windows
 * therefore walk past user and empty-body bubbles instead of spending a slot on
 * them.
 *
 * `spinner` radiates from the selection outwards so the bubble being read is
 * stamped first. `photos` is the selection plus the nearest character bubble on
 * each side, which is the ±1 rule restated in character terms.
 */
/** Select-path spinner window: selected bubble only (no neighbour stamp). */
export const INLINE_SELECT_SPINNER_RADIUS = 0;
/** Select-path photo window: selected bubble only (no ±1 neighbour). */
export const INLINE_SELECT_PHOTO_RADIUS = 0;

export function inlineWindowFromRoles(opts: {
  selIdx: number;
  length: number;
  radius: number;
  scanCap?: number;
  isCharAt: (idx: number) => boolean;
  isSkipBodyAt?: (idx: number) => boolean;
  allRoles?: boolean;
  /** Default true. False = user/short selection is not a spinner/photo slot. */
  keepSelection?: boolean;
}): { spinner: number[]; photos: number[] } {
  const selIdx = Math.floor(Number(opts.selIdx));
  const length = Math.floor(Number(opts.length));
  const radius = Math.max(0, Math.floor(Number(opts.radius) || 0));
  const inRange = Number.isFinite(selIdx) && selIdx >= 0 && selIdx < length;
  const walk = (maxPerSide: number): number[] => {
    const kept = pickInlineKeepDomIndices({
      selIdx,
      length,
      allRoles: opts.allRoles === true,
      isCharAt: opts.isCharAt,
      isSkipBodyAt: opts.isSkipBodyAt,
      maxPerSide,
      scanCap: opts.scanCap,
    });
    // The walk drops a user or short selection; the windows must not. The
    // selected bubble is the one being read, and its own pass is what keeps its
    // chips and inline frames in step. Whether it earns a photo is still the
    // role guard's call downstream.
    if (opts.keepSelection !== false && inRange && !kept.includes(selIdx)) kept.unshift(selIdx);
    return kept;
  };
  const spinner = radiateFromSel(selIdx, walk(radius));
  // Derived from the same walk, so a photo slot is always a spinner slot too.
  const photos = radius <= 1 ? [...spinner] : radiateFromSel(selIdx, walk(1));
  return { spinner, photos };
}

export type InlineIdentityRow = {
  el?: unknown;
  idx?: unknown;
  chatId?: unknown;
  chatIndex?: unknown;
  key?: unknown;
};

/**
 * Stable bubble id for select-window diffs.
 * SafeDOM wrappers are new objects every cache miss; chat id / index are not.
 */
export function inlineIdentityKey(row?: InlineIdentityRow | null): string {
  if (!row) return '';
  const chatId = String(row.chatId || '').trim();
  if (chatId) return `id:${chatId}`;
  const raw = Number(row.chatIndex);
  if (Number.isFinite(raw) && raw >= 0) return `i:${Math.floor(raw)}`;
  const stamp = String(row.key || '').trim();
  return stamp ? `k:${stamp}` : '';
}

function sameInlineIdentity(a?: InlineIdentityRow | null, b?: InlineIdentityRow | null): boolean {
  const ka = inlineIdentityKey(a);
  const kb = inlineIdentityKey(b);
  if (ka && kb) return ka === kb;
  return !!(a && b && a.el != null && a.el === b.el);
}

/**
 * Split two window snapshots by bubble identity.
 * Prefer chat id / index; fall back to the live node when those are missing.
 */
export function diffInlineIdentityRows(opts: {
  prev?: readonly InlineIdentityRow[] | null;
  next?: readonly InlineIdentityRow[] | null;
} = {}): { enter: InlineIdentityRow[]; leave: InlineIdentityRow[]; keep: InlineIdentityRow[] } {
  const prev = Array.isArray(opts.prev) ? opts.prev.filter((row) => row && row.el != null) : [];
  const next = Array.isArray(opts.next) ? opts.next.filter((row) => row && row.el != null) : [];
  const enter: InlineIdentityRow[] = [];
  const keep: InlineIdentityRow[] = [];
  const leave: InlineIdentityRow[] = [];
  for (const n of next) {
    if (prev.some((p) => sameInlineIdentity(p, n))) keep.push(n);
    else enter.push(n);
  }
  for (const p of prev) {
    if (!next.some((n) => sameInlineIdentity(p, n))) leave.push(p);
  }
  return { enter, leave, keep };
}

/** Selection first, then the nearest slot on each side, then the next pair. */
function radiateFromSel(selIdx: number, idxs: readonly number[]): number[] {
  const rest = idxs.filter((idx) => idx !== selIdx);
  const above = rest.filter((idx) => idx > selIdx).sort((a, b) => a - b);
  const below = rest.filter((idx) => idx < selIdx).sort((a, b) => b - a);
  const out = idxs.includes(selIdx) ? [selIdx] : [];
  for (let i = 0; i < Math.max(above.length, below.length); i += 1) {
    if (i < above.length) out.push(above[i]!);
    if (i < below.length) out.push(below[i]!);
  }
  return out;
}

export interface SessionGalleryMerge<T> {
  cards: T[];
  /** Rows carried over from the previous cache because the window missed them. */
  kept: number;
  /** Rows the response proves are gone. */
  dropped: number;
  /** True when the response listed the whole session and simply replaced the cache. */
  replaced: boolean;
}

/**
 * Folds a windowed session listing into the cached one.
 *
 * A window is only safe if older cards survive in the cache — otherwise a shot
 * on an old message stops attaching, which is exactly why the request used to
 * ask for the session ceiling. But the cache must not keep deleted cards
 * either, and a window cannot see a deletion below its own edge.
 *
 * `windowOldestAt` is the oldest timestamp the window reached, so a cached row
 * at or above it that the response omits was deleted. Below that edge the
 * response says nothing, except about hashes it was explicitly asked for: an
 * asked hash that came back with no rows has no cards left.
 */
function carryGalleryImageUrls<T extends GalleryCard>(prev: readonly T[], next: T[]): T[] {
  if (!prev.length || !next.length) return next;
  const urls = new Map<string, string>();
  for (const card of prev) {
    const id = String(card?.id || '');
    const url = card?.image_url;
    if (id && typeof url === 'string' && url) urls.set(id, url);
  }
  if (!urls.size) return next;
  return next.map((card) => {
    const id = String(card?.id || '');
    if (!id || card.image_url) return card;
    const image_url = urls.get(id);
    return image_url ? { ...card, image_url } : card;
  });
}

export function mergeSessionGallery<T extends GalleryCard = GalleryCard>(opts: {
  prev: readonly T[] | null | undefined;
  next: readonly T[] | null | undefined;
  total?: unknown;
  windowOldestAt?: unknown;
  askedHashes?: readonly unknown[] | null;
  cap?: number;
}): SessionGalleryMerge<T> {
  const prev = Array.isArray(opts.prev) ? opts.prev : [];
  // GET /v1/gallery never returns pixels. Keep in-memory data URLs on the same
  // card ids so Ht() does not rebuild the active sticky thumb after a refetch.
  const next = carryGalleryImageUrls(prev, Array.isArray(opts.next) ? [...opts.next] : []);
  const total = Math.max(0, finiteNumber(opts.total, 0));
  const cap = Math.max(1, finiteNumber(opts.cap, 2000));
  if (!prev.length || next.length >= total) {
    return { cards: next.slice(0, cap), kept: 0, dropped: 0, replaced: true };
  }

  const haveIds = new Set(next.map((card) => String(card?.id || '')).filter(Boolean));
  const haveHashes = new Set(next.map((card) => String(card?.content_hash || '')).filter(Boolean));
  const asked = new Set(
    (Array.isArray(opts.askedHashes) ? opts.askedHashes : [])
      .map((h) => String(h || ''))
      .filter(Boolean),
  );
  const edge = opts.windowOldestAt == null ? null : finiteNumber(opts.windowOldestAt, 0);

  const carried: T[] = [];
  let dropped = 0;
  for (const card of prev) {
    const id = String(card?.id || '');
    if (!id || haveIds.has(id)) continue;
    const at = finiteNumber(card?.created_at, 0);
    if (edge != null && at >= edge) {
      dropped += 1;
      continue;
    }
    const hash = String(card?.content_hash || '');
    if (hash && asked.has(hash) && !haveHashes.has(hash)) {
      dropped += 1;
      continue;
    }
    carried.push(card);
  }

  const cards = [...next, ...carried]
    .sort((a, b) => finiteNumber(b?.created_at, 0) - finiteNumber(a?.created_at, 0))
    .slice(0, cap);
  return { cards, kept: carried.length, dropped, replaced: false };
}

export type InlinePaintSource = 'selection' | 'remap' | 'unresolved';

export interface InlinePaintTarget<T> {
  cards: T[];
  /** True when the caller must leave the bubble alone instead of painting []. */
  skipInline: boolean;
  source: InlinePaintSource;
}

/**
 * Cards to paint on the bubble inline actually writes to.
 *
 * `paintIdx` is remapped away from the selection when the selected bubble is not
 * a keep candidate (a user turn, with `generate_all_roles` off). The cards must
 * follow that remap: painting the *selection's* cards on someone else's bubble
 * means an empty list on a user turn, and an empty list makes
 * `injectChatInlineImages` strip the char bubble's existing shots.
 *
 * `paintCards === null` means the remapped bubble's message could not be
 * resolved, so we cannot tell "no cards" from "unknown" — skip rather than strip.
 */
export function resolveInlinePaintCards<T>(opts: {
  selIdx: unknown;
  paintIdx: unknown;
  selCards: readonly T[] | null | undefined;
  paintCards: readonly T[] | null | undefined;
}): InlinePaintTarget<T> {
  const selIdx = Number(opts.selIdx);
  const paintIdx = Number(opts.paintIdx);
  const sel = Array.isArray(opts.selCards) ? [...opts.selCards] : [];
  if (!Number.isFinite(selIdx) || !Number.isFinite(paintIdx) || selIdx === paintIdx) {
    return { cards: sel, skipInline: false, source: 'selection' };
  }
  if (!Array.isArray(opts.paintCards)) {
    return { cards: [], skipInline: true, source: 'unresolved' };
  }
  return { cards: [...opts.paintCards], skipInline: false, source: 'remap' };
}

// ── DOM ↔ API message matching ────────────────────────────────────────────

export type ChatMatchMethod = 'reverse' | 'fallback' | 'attr';

export interface ChatMessageMatch {
  chatIndex: number;
  text: string;
  role: string;
  matchMethod: ChatMatchMethod;
  score: number;
  hostMessageId?: string;
}

export interface DomApiCompare {
  domChars: number;
  apiChars: number;
  domCompactChars: number;
  apiCompactChars: number;
  shareScore: number;
  overlap: boolean;
  shortExact: boolean;
  apiInDom: boolean;
  domInApi: boolean;
  apiKey: string;
  domKey: string;
}

/** Whitespace-stripped key; allows short user words (<8). */
export function messageCompactKey(text: unknown, maxChars = 48): string {
  const cap = Math.max(1, finiteNumber(maxChars, 48));
  return String(text || '').replace(/\s+/g, '').slice(0, cap);
}

/** API-side context fingerprint: prev|self|next|role (oldest-first neighbors). */
export function messageContextTriplet(
  messages: ChatMessage[] | null | undefined,
  index: number,
  maxChars = 48,
): string {
  const list = Array.isArray(messages) ? messages : [];
  const i = Math.floor(finiteNumber(index, -1));
  const self = i >= 0 && i < list.length ? list[i] : null;
  const prev = i > 0 ? list[i - 1] : null;
  const next = i >= 0 && i < list.length - 1 ? list[i + 1] : null;
  return [
    messageCompactKey(prev?.text, maxChars),
    messageCompactKey(self?.text, maxChars),
    messageCompactKey(next?.text, maxChars),
    rawMessageRole(self) || String(self?.role || '').trim().toLowerCase(),
  ].join('|');
}

/**
 * Shared-character score between DOM bubble and API body (whitespace-stripped).
 * Longer shared runs win — stops short option lines from beating full char turns
 * just because the option text also appears inside the rendered bubble.
 */
export function messagesTextOverlapScore(domText: unknown, apiText: unknown): number {
  const dom = String(domText || '').replace(/\s+/g, '');
  const api = String(apiText || '').replace(/\s+/g, '');
  if (!dom || !api) return 0;
  if (dom.includes(api)) return api.length;
  if (api.includes(dom)) return dom.length;

  let best = 0;
  const longestPrefixIn = (needle: string, haystack: string, minLen = 8, maxLen = 512): number => {
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

/** Debug helper: why DOM text and API text do/don't match. */
export function describeDomApiCompare(domText: unknown, apiText: unknown): DomApiCompare {
  const dom = String(domText || '');
  const api = String(apiText || '');
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
export function rebindGalleryMessageIndexes<T extends GalleryCard = GalleryCard>(
  cards: T[] | null | undefined,
  messages: ChatMessage[] | null | undefined,
  hashOf: ((text: string) => string) | null | undefined,
): { cards: T[]; changed: number } {
  const list = Array.isArray(messages) ? messages : [];
  const hashFn = typeof hashOf === 'function' ? hashOf : null;
  const byHash = new Map<string, number[]>();
  if (hashFn) {
    for (let i = 0; i < list.length; i += 1) {
      const text = String(list[i]?.text ?? list[i]?.data ?? list[i]?.content ?? '');
      const hash = String(hashFn(text) || '');
      if (!hash) continue;
      const idx = Number.isFinite(Number(list[i]?.index)) ? Number(list[i].index) : i;
      const bucket = byHash.get(hash);
      if (bucket) bucket.push(idx);
      else byHash.set(hash, [idx]);
    }
  }
  let changed = 0;
  const out = (Array.isArray(cards) ? cards : []).map((card) => {
    const hash = String(card?.content_hash || '');
    const idxs = hash ? byHash.get(hash) : undefined;
    if (!hash || !idxs) return card;
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
 * Role from that API row (rawMessageRole). Text/share matching intentionally unused,
 * which is why `domText` only survives as a fallback and the trailing arguments are ignored.
 */
export function resolveChatMessageMatch(
  domText: string | null | undefined,
  messages: ChatMessage[] | null | undefined,
  domIndex: number,
  _domCount?: number,
  _opts?: Record<string, unknown>,
): ChatMessageMatch {
  const list = Array.isArray(messages) ? messages : [];
  const idx = Math.floor(finiteNumber(domIndex, -1));
  const pick = (
    row: ChatMessage | null | undefined,
    method: ChatMatchMethod,
    score: number,
    rowIndex = -1,
  ): ChatMessageMatch => ({
    chatIndex: Number.isFinite(Number(row?.index)) ? Number(row?.index) : (rowIndex >= 0 ? rowIndex : idx),
    text: String(row?.text || domText || ''),
    role: rawMessageRole(row) || String(row?.role || '').trim().toLowerCase(),
    matchMethod: method,
    score,
    hostMessageId: hostMessageId(row),
  });

  const attrIdx = Math.floor(finiteNumber((_opts as { chatIndex?: unknown } | undefined)?.chatIndex, Number.NaN));
  if (Number.isFinite(attrIdx) && attrIdx >= 0) {
    const byIndex = list.find((row) => Number(row?.index) === attrIdx);
    if (byIndex) return pick(byIndex, 'attr', 100, attrIdx);
    if (attrIdx < list.length) return pick(list[attrIdx], 'attr', 100, attrIdx);
  }

  if (!list.length) {
    return {
      chatIndex: Math.max(0, idx),
      text: String(domText || ''),
      role: '',
      matchMethod: 'fallback',
      score: 0,
      hostMessageId: '',
    };
  }

  const reverseIdx = list.length - 1 - idx;
  if (reverseIdx >= 0 && reverseIdx < list.length) {
    return pick(list[reverseIdx], 'reverse', 100, reverseIdx);
  }

  // DOM index out of range (e.g. stale) → clamp to nearest API end.
  const clamped = Math.max(0, Math.min(list.length - 1, reverseIdx));
  return pick(list[clamped], 'reverse', 50, clamped);
}

// ── sticky pin percent ↔ px ───────────────────────────────────────────────

/** Saved defaults for the sticky pin, expressed as bottom-left percentages. */
export interface PinPercentDefaults {
  x?: number;
  y?: number;
}

/** Card settings the pin resolver reads; values are stored loosely by 1.x clients. */
export interface PinCardSettings {
  overlay_pin_origin?: string;
  overlay_x_pct?: unknown;
  overlay_y_pct?: unknown;
  overlay_x_offset?: unknown;
  overlay_y_offset?: unknown;
  [key: string]: unknown;
}

/** Clamp sticky-pin screen percent to 0–100 (integer, decimals truncated). */
export function clampPinPercent(value: unknown, fallback: unknown = 0): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return Math.max(0, Math.min(100, Math.floor(finiteNumber(fallback, 0))));
  return Math.max(0, Math.min(100, Math.floor(n)));
}

/** Percent from the left/top edge → clamped pixel (pin top-left). */
export function pinPercentToPx(percent: unknown, viewportSize: number, pinSize = 22, pad = 4): number {
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
export function pinPercentToPxFromBottom(percent: unknown, viewportSize: number, pinSize = 22, pad = 8): number {
  const view = Math.max(1, finiteNumber(viewportSize, 1));
  const size = Math.max(1, finiteNumber(pinSize, 1));
  const edge = Math.max(0, finiteNumber(pad, 0));
  const fromBottom = Math.floor(view * clampPinPercent(percent, 0) / 100);
  const top = view - fromBottom - size;
  return Math.max(edge, Math.min(view - size - edge, top));
}

/** Pixel from left/top → percent of viewport (integer, decimals truncated). */
export function pinPxToPercent(px: number, viewportSize: number): number {
  const view = Math.max(1, finiteNumber(viewportSize, 1));
  return clampPinPercent(finiteNumber(px, 0) / view * 100, 0);
}

/**
 * Read pin % from settings (origin = bottom-left).
 * Prefer overlay_*_pct whenever present — DEFAULT_CONFIG always deepMerges
 * legacy overlay_*_offset (px), which must not shadow saved percentages on boot.
 * defaults: { x: 38, y: 80 }
 */
export function resolveStoredPinPercent(
  card: PinCardSettings | null | undefined,
  axis: string,
  viewportSize: number,
  defaults: PinPercentDefaults | null = null,
): number {
  const def = defaults && typeof defaults === 'object' ? defaults : { x: 38, y: 80 };
  const isY = axis === 'y' || axis === 'Y';
  const fallback = isY ? finiteNumber(def.y, 80) : finiteNumber(def.x, 38);
  const pctKey = isY ? 'overlay_y_pct' : 'overlay_x_pct';
  const pxKey = isY ? 'overlay_y_offset' : 'overlay_x_offset';
  const origin = String(card?.overlay_pin_origin || '');
  const topOrigin = origin === 'top' || origin === 'tl' || origin === 'top-left';
  const rawPct = card?.[pctKey];
  const hasPct = rawPct != null && Number.isFinite(Number(rawPct));
  const px = Number(card?.[pxKey]);
  const hasPx = Number.isFinite(px);
  const asBottomY = (topish: unknown): number => clampPinPercent(100 - Number(topish), fallback);

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

// ── message selection gestures ────────────────────────────────────────────

export type SelectionGesture = 'single' | 'double' | 'context' | 'longpress';

/** Same-bubble re-click window for double mode (SafeDOM often never reports detail=2). */
export const DOUBLE_SELECT_WINDOW_MS = 450;

export function normalizeSelectionGesture(value: unknown): SelectionGesture {
  const v = String(value ?? '').toLowerCase().trim();
  if (v === 'double' || v === 'dbl' || v === '2' || v === 'dblclick') return 'double';
  if (v === 'context' || v === 'right' || v === 'contextmenu' || v === 'rightclick') return 'context';
  if (v === 'longpress' || v === 'long' || v === 'press' || v === 'hold') return 'longpress';
  return 'single';
}

/** Left-click path is used only for single/double; context/longpress ignore click. */
export function clickSelectTracksEnabled(gesture: unknown): boolean {
  const g = normalizeSelectionGesture(gesture);
  return g === 'single' || g === 'double';
}

export interface MessageSelectionGestureOptions {
  gesture?: SelectionGesture | string;
  detail?: number;
  movement?: number;
  textSelecting?: boolean;
  excludedTarget?: boolean;
}

export interface ClickSelectionOptions {
  gesture?: SelectionGesture | string;
  /** Legacy; SafeDOM often always reports 1. Double mode uses pendingAt/now instead. */
  detail?: number;
  pendingDomIndex?: number | null;
  pendingAt?: number | null;
  targetDomIndex?: number | null;
  now?: number;
  windowMs?: number;
}

export interface ClickSelectionAction {
  action: 'provisional' | 'confirm' | 'ignore';
  pendingDomIndex?: number | null;
  clearPending?: boolean;
  matchedPending?: boolean;
}

export interface TextDragSelectionOptions {
  enabled?: boolean;
  movement?: number;
  hasSelection?: boolean;
  excludedTarget?: boolean;
}

/**
 * Pick message index nearest to a pointer: prefer rect containing the point, else closest center.
 * `rects` entries: { top, bottom, left?, right? }. Missing left/right → Y-only containment.
 */
export function pickMessageIndexNearPoint(
  rects: Array<MessageRect | null | undefined> | null | undefined,
  pointY: number,
  pointX: number | null = null,
  viewportH = 800,
): number {
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

/** True when a pointer event is a real message-selection click, not a drag or text pick. */
export function isMessageSelectionGesture({
  gesture = 'single',
  detail: _detail = 1,
  movement = 0,
  textSelecting = false,
  excludedTarget = false,
}: MessageSelectionGestureOptions = {}): boolean {
  void _detail;
  if (!clickSelectTracksEnabled(gesture)) return false;
  return !excludedTarget
    && !textSelecting
    && finiteNumber(movement, Infinity) <= 8;
}

/**
 * Click-only selection state machine (left button).
 * - single: confirm
 * - double: same target within windowMs → confirm; else provisional (does not use click.detail)
 * - context / longpress: ignore (wired on other events)
 */
export function resolveClickSelectionAction({
  gesture = 'single',
  detail = 1,
  pendingDomIndex = null,
  pendingAt = null,
  targetDomIndex = null,
  now = Date.now(),
  windowMs = DOUBLE_SELECT_WINDOW_MS,
}: ClickSelectionOptions = {}): ClickSelectionAction {
  const g = normalizeSelectionGesture(gesture);
  if (g === 'context' || g === 'longpress') return { action: 'ignore' };
  if (g === 'double') {
    const target = Number(targetDomIndex);
    if (!Number.isFinite(target) || target < 0) return { action: 'ignore' };
    const pending = pendingDomIndex == null ? NaN : Number(pendingDomIndex);
    const at = Number(pendingAt);
    const win = Math.max(50, finiteNumber(windowMs, DOUBLE_SELECT_WINDOW_MS));
    const within = Number.isFinite(pending)
      && Number.isFinite(at)
      && now - at <= win
      && pending === target;
    if (within) {
      return { action: 'confirm', clearPending: true, matchedPending: true, pendingDomIndex: null };
    }
    return {
      action: 'provisional',
      pendingDomIndex: target,
      clearPending: false,
      matchedPending: false,
    };
  }
  const d = finiteNumber(detail, 1);
  if (d === 1) return { action: 'confirm', clearPending: true };
  return { action: 'ignore' };
}

/**
 * Click select must not move the chat. Spinner boxes hold height, so there
 * is nothing left to compensate for.
 */
export function messageClickScrollDelta(
  _rect?: { top?: unknown; bottom?: unknown } | null,
  _viewportH?: unknown,
): number {
  return 0;
}

/** True when a text-drag gesture should select the message under the pointer. */
export function shouldSelectMessageByTextDrag({
  enabled = true,
  movement = 0,
  hasSelection = false,
  excludedTarget = false,
}: TextDragSelectionOptions = {}): boolean {
  return !!enabled
    && !excludedTarget
    && !!hasSelection
    && finiteNumber(movement, 0) > 8;
}

// ── scroll / session / save debounce helpers ──────────────────────────────

export interface ScrollSettleTracker {
  bump(): void;
  settleNow(): void;
  cancel(): void;
  readonly pending: boolean;
}

export interface SessionChangeGuard {
  observe(session: string | null | undefined): boolean;
  current(): string;
  reset(session?: string): void;
}

export type SavePatch = Record<string, unknown>;

export interface DebouncedSaveQueue {
  enqueue(patch: SavePatch): void;
  flush(): Promise<void>;
  hasPending(): boolean;
}

/**
 * Split scroll work into active (cheap) vs settle (SafeDOM).
 * Active may run every event; settle only after idle/scrollend.
 */
export function createScrollPhaseBus({
  settleDelayMs = 160,
  onActive,
  onSettle,
}: {
  settleDelayMs?: number;
  onActive?: () => void;
  onSettle?: () => void;
} = {}): {
  onScrollSample: () => void;
  onScrollEnd: () => void;
  cancel: () => void;
  get pendingSettle(): boolean;
} {
  const settle = createScrollSettleTracker({
    delayMs: settleDelayMs,
    onSettle: () => {
      if (typeof onSettle === 'function') onSettle();
    },
  });
  return {
    onScrollSample() {
      if (typeof onActive === 'function') onActive();
      settle.bump();
    },
    onScrollEnd() {
      if (typeof onActive === 'function') onActive();
      settle.settleNow();
    },
    cancel() {
      settle.cancel();
    },
    get pendingSettle() {
      return settle.pending;
    },
  };
}

export interface ScrollHoldRect {
  top: number;
  bottom: number;
  height?: number;
}

/** Bubble that crosses the scroller top, else the closest visible one. */
export function pickScrollHoldAnchor(
  scrollerRect: ScrollHoldRect | null | undefined,
  bubbleRects: Array<ScrollHoldRect | null | undefined> | null | undefined,
): number {
  if (!scrollerRect || !Array.isArray(bubbleRects) || !bubbleRects.length) return -1;
  const viewportTop = Number(scrollerRect.top) + 1;
  const viewportBottom = Number(scrollerRect.bottom) - 1;
  if (!Number.isFinite(viewportTop) || !Number.isFinite(viewportBottom)) return -1;
  let bestIndex = -1;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let i = 0; i < bubbleRects.length; i += 1) {
    const rect = bubbleRects[i];
    if (!rect || rect.bottom <= viewportTop || rect.top >= viewportBottom) continue;
    const crossesTop = rect.top <= viewportTop && rect.bottom > viewportTop;
    const score = crossesTop
      ? Math.abs(rect.top - viewportTop) * 0.001
      : Math.abs(rect.top - viewportTop) + 10;
    if (score < bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }
  return bestIndex;
}

/** Newest bubble sits in the bottom band — leave Risu autoscroll alone. */
export function isScrollHoldLatest(args: {
  scrollerRect?: ScrollHoldRect | null;
  newestRect?: ScrollHoldRect | null;
} = {}): boolean {
  const scroller = args.scrollerRect;
  const newest = args.newestRect;
  if (!scroller || !newest) return false;
  const heightRaw = Number(scroller.height);
  const height = Number.isFinite(heightRaw) && heightRaw > 0
    ? heightRaw
    : Math.max(0, Number(scroller.bottom) - Number(scroller.top));
  const bottomBand = Number(scroller.bottom) - Math.min(140, height * 0.28);
  return newest.bottom >= bottomBand && newest.top < Number(scroller.bottom) + 24;
}

/** Persist on: keep ready inline until that card is already baked into the body. */
export function keepReadyInlineWithPersist(
  persist: unknown,
  body: unknown,
  placement: { pending?: unknown; cardId?: unknown } | null | undefined,
): boolean {
  if (persist !== true) return true;
  if (placement?.pending === true) return true;
  if (messageHasBakeTokenForCard(body, placement?.cardId)) return false;
  return !htmlHasBakeWrapForCard(body, placement?.cardId);
}

/** Viewport offset of a bubble edge. Tag teardown holds the bottom so leftover text stays put. */
export function scrollHoldOffset(
  scrollerRect: ScrollHoldRect | null | undefined,
  bubbleRect: ScrollHoldRect | null | undefined,
  edge: unknown = 'top',
): number {
  if (!scrollerRect || !bubbleRect) return NaN;
  const origin = Number(scrollerRect.top);
  const point = edge === 'bottom' ? Number(bubbleRect.bottom) : Number(bubbleRect.top);
  if (!Number.isFinite(origin) || !Number.isFinite(point)) return NaN;
  return point - origin;
}

/** Ignore jitter. Viewport-sized jumps are dropped unless `viewportHeight` is 0 (explicit teardown). */
export function scrollHoldDelta(prevOffset: unknown, nextOffset: unknown, viewportHeight: unknown = 0): number {
  const prev = Number(prevOffset);
  const next = Number(nextOffset);
  if (!Number.isFinite(prev) || !Number.isFinite(next)) return 0;
  const delta = next - prev;
  if (Math.abs(delta) < 2) return 0;
  const vh = Number(viewportHeight);
  if (Number.isFinite(vh) && vh > 0 && Math.abs(delta) > vh) return 0;
  return delta;
}

export function shouldHoldScroll(opts: { atLatest?: unknown; userControl?: unknown; force?: unknown } = {}): boolean {
  // The caller already checks the setting; user input still overrides a job hold.
  return opts.userControl !== true && (opts.force === true || opts.atLatest === false);
}

/** True when sticky shot index changed enough to warrant a paint (not every pointer pixel). */
export function stickySegChanged(prev: unknown, next: unknown): boolean {
  const b = Number(next);
  if (!Number.isFinite(b)) return false;
  if (prev == null || prev === '') return true;
  const a = Number(prev);
  if (!Number.isFinite(a)) return true;
  return Math.trunc(a) !== Math.trunc(b);
}

/**
 * Idle debounce helper for scroll-settle selection.
 * bump() on scroll/wheel; settleNow() on scrollend; onSettle fires once per idle.
 */
export function createScrollSettleTracker({
  delayMs = 160,
  onSettle,
}: { delayMs?: number; onSettle?: () => void } = {}): ScrollSettleTracker {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const delay = Math.max(0, finiteNumber(delayMs, 160));
  const fire = (): void => {
    timer = null;
    if (typeof onSettle === 'function') onSettle();
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

/** Debounce chat switches: a new session id only counts after two consistent observations. */
export function createSessionChangeGuard(initialSession = ''): SessionChangeGuard {
  let currentSession = String(initialSession || '');
  let candidate = '';
  let observations = 0;
  return {
    observe(session) {
      const next = String(session || '');
      if (!next || next === currentSession) {
        candidate = '';
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
      candidate = '';
      observations = 0;
      return true;
    },
    current() {
      return currentSession;
    },
    reset(session = '') {
      currentSession = String(session || '');
      candidate = '';
      observations = 0;
    },
  };
}

/** Coalesce setting patches into one debounced write that never runs twice concurrently. */
export function createDebouncedSaveQueue(
  write: (patch: SavePatch) => unknown,
  delayMs = 300,
): DebouncedSaveQueue {
  let pending: SavePatch = {};
  let timer: ReturnType<typeof setTimeout> | null = null;
  let draining: Promise<void> | null = null;

  const drain = async (): Promise<void> => {
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

// ── sticky thumb + corner layout ──────────────────────────────────────────

export interface StickyCornerBox {
  left: number;
  top: number;
  w: number;
  h: number;
}

export interface StickyEdgeBox {
  w: number;
  h: number;
  top: number | null;
  bottom: number | null;
  left: number | null;
  right: number | null;
}

export interface StickyPinEdgeBox {
  size: number;
  top: number | null;
  bottom: number | null;
  left: number | null;
  right: number | null;
}

/** True when gallery card id list/order changed enough to warrant a viewer refresh. */
export function shouldRefreshGallery(
  prevIds: Array<string | number> | null | undefined,
  nextIds: Array<string | number> | null | undefined,
): boolean {
  const prev = Array.isArray(prevIds) ? prevIds.map(String) : [];
  const next = Array.isArray(nextIds) ? nextIds.map(String) : [];
  if (prev.length !== next.length) return true;
  for (let i = 0; i < prev.length; i += 1) {
    if (prev[i] !== next[i]) return true;
  }
  return false;
}

/**
 * Claim an already-mounted sticky marker from the active list by card id.
 *
 * overlay.place used to create a fresh pin DOM whenever takePooledMarker
 * missed — and the pool only held *parked* markers, not the ones still in
 * `markers`. On a partial card-set swap (A,B → A,C) that left the old A pin
 * orphaned in the layer while a second A pin was appended. Splice the hit
 * out so the leftover park pass can retire only unused nodes.
 */
export function claimStickyMarkerByCardId<T extends { card?: { id?: unknown } | null; thumb?: unknown }>(
  active: T[] | null | undefined,
  cardId: unknown,
): T | null {
  const id = String(cardId || '');
  if (!id || !Array.isArray(active) || !active.length) return null;
  const idx = active.findIndex((m) => String(m?.card?.id || '') === id);
  if (idx < 0) return null;
  const m = active[idx];
  if (!m?.thumb) return null;
  active.splice(idx, 1);
  return m;
}

/** Sticky pin thumb HTML rewrite only when the active card id changes. */
export function shouldRewriteStickyThumb(
  prevCardId: string | null | undefined,
  nextCardId: string | null | undefined,
): boolean {
  return String(prevCardId || '') !== String(nextCardId || '');
}

/** Keep sticky always-image hidden only while the user-hidden card is still active. */
export function shouldKeepStickyThumbHidden(
  userHidden: boolean,
  hiddenCardId: string | null | undefined,
  activeCardId: string | null | undefined,
): boolean {
  if (!userHidden) return false;
  const hidden = String(hiddenCardId || '');
  const active = String(activeCardId || '');
  return !!hidden && !!active && hidden === active;
}

/**
 * Effective sticky always-image size %.
 *
 * Hide is size 0 (same as tap-접기): 상시 off, click-collapse, or settings/shot/char editor.
 * editorOpen does not flip the user's 접기 flag — close uses that flag to restore size.
 */
export function resolveStickyThumbPct(opts: {
  settingsPct: unknown;
  alwaysOn: boolean;
  userCollapsed: boolean;
  editorOpen?: boolean;
}): number {
  if (!opts.alwaysOn || opts.userCollapsed || opts.editorOpen) return 0;
  const pct = finiteNumber(opts.settingsPct, 0);
  return pct > 0 ? pct : 0;
}

/** Pixel box from an effective sticky thumb %. Allows 0×0 for hide-by-pct. */
export function stickyThumbBoxFromPct(
  pct: unknown,
  baseW: number,
  baseH: number,
): { pct: number; w: number; h: number } {
  const p = Math.max(0, finiteNumber(pct, 0));
  const bw = Math.max(0, finiteNumber(baseW, 0));
  const bh = Math.max(0, finiteNumber(baseH, 0));
  return {
    pct: p,
    w: Math.max(0, Math.round(bw * p / 100)),
    h: Math.max(0, Math.round(bh * p / 100)),
  };
}

/**
 * Fit `imgW×imgH` inside a max envelope, preserving aspect ratio.
 * Missing/invalid image size → return the envelope (caller letterboxes with contain).
 */
export function fitBoxInside(
  maxW: unknown,
  maxH: unknown,
  imgW: unknown = 0,
  imgH: unknown = 0,
): { w: number; h: number } {
  const mw = Math.max(0, finiteNumber(maxW, 0));
  const mh = Math.max(0, finiteNumber(maxH, 0));
  if (mw <= 0 || mh <= 0) return { w: 0, h: 0 };
  const iw = Math.max(0, finiteNumber(imgW, 0));
  const ih = Math.max(0, finiteNumber(imgH, 0));
  if (iw <= 0 || ih <= 0) return { w: mw, h: mh };
  const scale = Math.min(mw / iw, mh / ih);
  return {
    w: Math.max(1, Math.round(iw * scale)),
    h: Math.max(1, Math.round(ih * scale)),
  };
}

/**
 * Sticky thumb HTML. Prefer a single <img> — dual-stack under/over doubles the
 * data-URL payload through SafeDOM setInnerHTML and is what made scroll flashes lag.
 * `contain` + a frame sized to the image aspect (see probeDataUrlPixelSize +
 * fitBoxInside) shows the whole bitmap without crop or letterbox bars.
 * Transparent bg: residual letterbox must not paint opaque bars over the chat.
 */
export function composeStickyThumbHtml(
  src: string | null | undefined,
  underSrc: string | null | undefined = '',
): string {
  void underSrc; // kept for call-site compat; stacking is intentionally unused
  const embed = htmlSafeImageSrc(src);
  if (!embed) return '<div style="width:100%;height:100%;background:transparent"></div>';
  const fit = 'width:100%;height:100%;object-fit:contain;display:block;background:transparent';
  return `<img src="${embed}" style="${fit}" />`;
}

/**
 * True when the sticky thumb node already holds this card's image — scroll flash
 * can show/hide without another setInnerHTML of a multi-MB data URL.
 */
export function stickyThumbNeedsHtmlPaint(
  paintedSrc: unknown,
  thumbSrc: unknown,
  paintedId: unknown,
  activeId: unknown,
): boolean {
  const src = htmlSafeImageSrc(thumbSrc);
  if (!src) return false;
  return String(paintedSrc || '') !== src || String(paintedId || '') !== String(activeId || '');
}

function readU32BE(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) << 24 | (bytes[offset + 1] ?? 0) << 16
    | (bytes[offset + 2] ?? 0) << 8 | (bytes[offset + 3] ?? 0)) >>> 0;
}

function readU16BE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) << 8 | (bytes[offset + 1] ?? 0);
}

/** Decode only the leading bytes of a data-URL (enough for image headers). */
function dataUrlHeaderBytes(src: string, maxBytes = 96): Uint8Array | null {
  // Never regex-capture the whole base64 payload — multi-MB data URLs made sticky
  // sizing O(n) on every scroll flash. Header needs only the first ~maxBytes.
  const comma = src.indexOf(',');
  if (comma < 0) return null;
  const meta = src.slice(0, comma);
  if (!/^data:/i.test(meta) || !/;base64$/i.test(meta.replace(/\s+$/, ''))) return null;
  const payload = src;
  try {
    const needChars = Math.ceil(maxBytes / 3) * 4 + 4;
    const slice = payload.slice(comma + 1, comma + 1 + needChars).replace(/\s/g, '');
    if (!slice) return null;
    const bin = atob(slice);
    const n = Math.min(bin.length, maxBytes);
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function probePngSize(bytes: Uint8Array): { w: number; h: number } | null {
  if (bytes.length < 24) return null;
  if (bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) return null;
  const w = readU32BE(bytes, 16);
  const h = readU32BE(bytes, 20);
  if (!(w > 0 && h > 0 && w < 20000 && h < 20000)) return null;
  return { w, h };
}

function probeJpegSize(bytes: Uint8Array): { w: number; h: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = bytes[i + 1] ?? 0;
    if (marker === 0xd8 || marker === 0xd9) {
      i += 2;
      continue;
    }
    const len = readU16BE(bytes, i + 2);
    if (len < 2) return null;
    // SOF0..SOF3 / SOF5..SOF7 / SOF9..SOF11 / SOF13..SOF15 (not DHT/DAC)
    const isSof = (marker >= 0xc0 && marker <= 0xc3)
      || (marker >= 0xc5 && marker <= 0xc7)
      || (marker >= 0xc9 && marker <= 0xcb)
      || (marker >= 0xcd && marker <= 0xcf);
    if (isSof && i + 8 < bytes.length) {
      const h = readU16BE(bytes, i + 5);
      const w = readU16BE(bytes, i + 7);
      if (w > 0 && h > 0) return { w, h };
      return null;
    }
    i += 2 + len;
  }
  return null;
}

function probeWebpSize(bytes: Uint8Array): { w: number; h: number } | null {
  if (bytes.length < 30) return null;
  if (bytes[0] !== 0x52 || bytes[1] !== 0x49 || bytes[2] !== 0x46 || bytes[3] !== 0x46) return null;
  if (bytes[8] !== 0x57 || bytes[9] !== 0x45 || bytes[10] !== 0x42 || bytes[11] !== 0x50) return null;
  const tag = String.fromCharCode(bytes[12] ?? 0, bytes[13] ?? 0, bytes[14] ?? 0, bytes[15] ?? 0);
  if (tag === 'VP8X' && bytes.length >= 30) {
    const w = 1 + ((bytes[24] ?? 0) | (bytes[25] ?? 0) << 8 | (bytes[26] ?? 0) << 16);
    const h = 1 + ((bytes[27] ?? 0) | (bytes[28] ?? 0) << 8 | (bytes[29] ?? 0) << 16);
    if (w > 0 && h > 0) return { w, h };
  }
  if (tag === 'VP8 ' && bytes.length >= 30) {
    const w = ((bytes[26] ?? 0) | (bytes[27] ?? 0) << 8) & 0x3fff;
    const h = ((bytes[28] ?? 0) | (bytes[29] ?? 0) << 8) & 0x3fff;
    if (w > 0 && h > 0) return { w, h };
  }
  if (tag === 'VP8L' && bytes.length >= 25) {
    const b0 = bytes[21] ?? 0;
    const b1 = bytes[22] ?? 0;
    const b2 = bytes[23] ?? 0;
    const b3 = bytes[24] ?? 0;
    const w = 1 + (b0 | (b1 & 0x3f) << 8);
    const h = 1 + ((b1 & 0xc0) >> 6 | b2 << 2 | (b3 & 0x0f) << 10);
    if (w > 0 && h > 0) return { w, h };
  }
  return null;
}

/**
 * Sync pixel size from a data: URL header (PNG/JPEG/WebP). Used to size the
 * sticky frame to the real image instead of global NAI settings.
 */
export function probeDataUrlPixelSize(src: unknown): { w: number; h: number } | null {
  const url = String(src || '');
  if (!url.startsWith('data:image/')) return null;
  const bytes = dataUrlHeaderBytes(url, 512);
  if (!bytes || !bytes.length) return null;
  return probePngSize(bytes) || probeJpegSize(bytes) || probeWebpSize(bytes);
}

/**
 * Resolve sticky frame size for a real image (or NAI fallback).
 *
 * Settings pct builds a portrait envelope (528×720 base). Fitting a landscape
 * image into that box makes width the bottleneck and the thumb looks tiny.
 * Use the longer envelope edge as a square budget so landscape/portrait share
 * similar on-screen presence, then clamp to the viewport when provided.
 */
export function stickyThumbSizeForImage(
  envelopeW: unknown,
  envelopeH: unknown,
  imgW: unknown = 0,
  imgH: unknown = 0,
  fallbackW: unknown = 0,
  fallbackH: unknown = 0,
  viewport: { width?: number; height?: number; pad?: number } | null | undefined = null,
): { w: number; h: number } {
  const iw = finiteNumber(imgW, 0) > 0 ? finiteNumber(imgW, 0) : finiteNumber(fallbackW, 0);
  const ih = finiteNumber(imgH, 0) > 0 ? finiteNumber(imgH, 0) : finiteNumber(fallbackH, 0);
  const ew = Math.max(0, finiteNumber(envelopeW, 0));
  const eh = Math.max(0, finiteNumber(envelopeH, 0));
  const side = Math.max(ew, eh);
  let maxW = side;
  let maxH = side;
  if (viewport) {
    const pad = Math.max(0, finiteNumber(viewport.pad, 16));
    const vpW = Math.max(0, finiteNumber(viewport.width, 0));
    const vpH = Math.max(0, finiteNumber(viewport.height, 0));
    if (vpW > 0) maxW = Math.min(maxW, Math.max(1, vpW - pad * 2));
    if (vpH > 0) maxH = Math.min(maxH, Math.max(1, vpH - pad * 2));
  }
  return fitBoxInside(maxW, maxH, iw, ih);
}

/** Rewrite width/height in a sticky thumb style string (edge anchors stay put). */
export function stickyThumbStyleWithSize(style: unknown, w: unknown, h: unknown): string {
  const s = String(style || '');
  const ww = Math.max(0, Math.round(finiteNumber(w, 0)));
  const hh = Math.max(0, Math.round(finiteNumber(h, 0)));
  return s
    .replace(/width:\s*\d+px/gi, `width:${ww}px`)
    .replace(/height:\s*\d+px/gi, `height:${hh}px`);
}

// ── sticky layout v2: pin attaches to image (not image to pin frame) ───────

export type StickyV2AnchorSide = 'left' | 'right';

/**
 * Pin X past viewport midline → image left-center (pin on image's left edge).
 * Pin X before midline → image right-center (pin on image's right edge).
 * (Flipped from a naive center-anchor so the image grows away from chat mid.)
 */
export function stickyV2AnchorSide(pinX: unknown, viewportW: unknown): StickyV2AnchorSide {
  const x = finiteNumber(pinX, 0);
  const vw = Math.max(1, finiteNumber(viewportW, 1));
  return x >= vw * 0.5 ? 'left' : 'right';
}

export interface StickyV2Box {
  left: number;
  top: number;
  w: number;
  h: number;
}

export interface StickyV2PinBox {
  left: number;
  top: number;
  size: number;
  /** Hit target width. Defaults to `size` when omitted (square pin). */
  w?: number;
  /** Hit target height. Defaults to `size` when omitted. */
  h?: number;
}

/** Gap between the two count chips. Keep tiny — a pin-sized hole looked broken. */
export const STICKY_V2_COUNT_GAP = 4;

/**
 * ▲N ▼N side by side. The pin is a tight transparent hit over both chips:
 * one click expands, two opens inspect.
 */
export function stickyV2CountCluster(cx: unknown, cy: unknown, pinSize: unknown): {
  pin: StickyV2PinBox;
  aboveBadge: StickyV2PinBox;
  belowBadge: StickyV2PinBox;
} {
  const s = Math.max(12, Math.round(finiteNumber(pinSize, 28)));
  const x = finiteNumber(cx, 0);
  const y = finiteNumber(cy, 0);
  const gap = STICKY_V2_COUNT_GAP;
  const hit = 6;
  const top = Math.round(y - s / 2);
  const aboveLeft = Math.round(x - s - gap / 2);
  const belowLeft = Math.round(x + gap / 2);
  return {
    pin: {
      left: aboveLeft - hit,
      top: top - hit,
      size: s * 2 + gap + hit * 2,
      w: s * 2 + gap + hit * 2,
      h: s + hit * 2,
    },
    aboveBadge: { left: aboveLeft, top, size: s },
    belowBadge: { left: belowLeft, top, size: s },
  };
}

export interface StickyV2Layout {
  side: StickyV2AnchorSide | 'corner';
  image: StickyV2Box;
  pin: StickyV2PinBox;
  /** Free mode: count badge above the pin (▲N). Null in corner mode. */
  aboveBadge: StickyV2PinBox | null;
  /** Free mode: count badge below the pin (▼N). Null in corner mode. */
  belowBadge: StickyV2PinBox | null;
  /** Corner mode: above-count badge to the left of the pin. Null in free mode. */
  leftBadge: StickyV2PinBox | null;
  /** Corner mode: below-count badge to the right of the pin. Null in free mode. */
  rightBadge: StickyV2PinBox | null;
  /** True when pin sits under the image (top corners). */
  pinBelowImage: boolean;
}

/**
 * Free (non-corner) layout: attachment point = pin % position.
 * Image left-center or right-center glued to that point so landscape
 * does not swing into the chat column the way a center-anchor would.
 * ▲N / ▼N sit side by side at the attachment point; the pin is a tight
 * transparent hit over both chips.
 */
export function stickyV2FreeLayout(opts: {
  pinX: unknown;
  pinY: unknown;
  imgW: unknown;
  imgH: unknown;
  pinSize?: unknown;
  viewportW: unknown;
  viewportH: unknown;
  badgeGap?: unknown;
}): StickyV2Layout {
  const pinSize = Math.max(12, Math.round(finiteNumber(opts.pinSize, 28)));
  const w = Math.max(1, Math.round(finiteNumber(opts.imgW, 1)));
  const h = Math.max(1, Math.round(finiteNumber(opts.imgH, 1)));
  const vw = Math.max(1, Math.round(finiteNumber(opts.viewportW, w)));
  const vh = Math.max(1, Math.round(finiteNumber(opts.viewportH, h)));
  const cx = finiteNumber(opts.pinX, 0);
  const cy = finiteNumber(opts.pinY, 0);
  const side = stickyV2AnchorSide(cx, vw);
  // side 'left' → pin on left edge of image; 'right' → pin on right edge
  const left = Math.round(side === 'left' ? cx : cx - w);
  const top = Math.round(cy - h / 2);
  void opts.badgeGap;
  void vh;
  const cluster = stickyV2CountCluster(cx, cy, pinSize);
  return {
    side,
    image: { left, top, w, h },
    pin: cluster.pin,
    aboveBadge: cluster.aboveBadge,
    belowBadge: cluster.belowBadge,
    leftBadge: null,
    rightBadge: null,
    pinBelowImage: false,
  };
}

/**
 * Corner layout: image parked at corner with pad.
 * ▲N / ▼N in two columns at viewport top-center, for any corner.
 */
export function stickyV2CornerLayout(opts: {
  corner: StickyCorner | null | undefined;
  imgW: unknown;
  imgH: unknown;
  viewportW: unknown;
  viewportH: unknown;
  pad?: unknown;
  pinSize?: unknown;
  gap?: unknown;
  badgeGap?: unknown;
}): StickyV2Layout {
  const pad = Math.max(0, Math.round(finiteNumber(opts.pad, 12)));
  const pinSize = Math.max(12, Math.round(finiteNumber(opts.pinSize, 28)));
  void opts.gap;
  void opts.badgeGap;
  const vw = Math.max(1, Math.round(finiteNumber(opts.viewportW, 1)));
  const vh = Math.max(1, Math.round(finiteNumber(opts.viewportH, 1)));
  const box = stickyCornerImageBox(
    opts.corner,
    { w: finiteNumber(opts.imgW, 1), h: finiteNumber(opts.imgH, 1) },
    { width: vw, height: vh },
    pad,
  );
  const cluster = stickyV2CountCluster(vw / 2, pad + pinSize / 2, pinSize);
  return {
    side: 'corner',
    image: { left: box.left, top: box.top, w: box.w, h: box.h },
    pin: cluster.pin,
    aboveBadge: cluster.aboveBadge,
    belowBadge: cluster.belowBadge,
    leftBadge: null,
    rightBadge: null,
    pinBelowImage: false,
  };
}

/**
 * Display URLs the UI can point an <img> at. `blob:` is valid on setAttribute
 * but SafeDOM/DOMPurify strips it from setInnerHTML — never embed those in HTML.
 */
export function isPlaceholderImageSrc(src: unknown): boolean {
  return /^data:image\/svg\+xml/i.test(String(src || ''));
}

export function isReadyImageSrc(src: unknown): boolean {
  const s = String(src || '');
  if (!s || isPlaceholderImageSrc(s)) return false;
  return /^data:image\//i.test(s) || /^blob:/i.test(s);
}

/** Only `data:image` survives setInnerHTML. Empty string → setAttribute later. */
export function htmlSafeImageSrc(src: unknown): string {
  const s = String(src || '');
  return /^data:image\//i.test(s) ? s : '';
}

/** Pure-image sticky HTML — box already matches aspect; no letterbox frame. */
export function composeStickyV2ThumbHtml(src: string | null | undefined): string {
  const embed = htmlSafeImageSrc(src);
  if (!embed) return '<div style="width:100%;height:100%;background:transparent"></div>';
  return `<img src="${embed}" style="width:100%;height:100%;object-fit:fill;display:block;background:transparent;border:none;outline:none" />`;
}

/** Counts of shots above / below the active sticky index. */
export function stickyV2ShotCounts(activeIndex: unknown, markerCount: unknown): { above: number; below: number } {
  const n = Math.max(0, Math.trunc(finiteNumber(markerCount, 0)));
  const i = Math.trunc(finiteNumber(activeIndex, -1));
  if (i < 0 || i >= n) return { above: 0, below: 0 };
  return { above: i, below: Math.max(0, n - i - 1) };
}

/** Corner box for sticky always-image in mobile layout mode. */
export function stickyCornerImageBox(
  corner: StickyCorner | null | undefined,
  size: SizeBox | null | undefined,
  viewport: { width?: number; height?: number } | null | undefined,
  pad = 16,
): StickyCornerBox {
  const w = Math.max(1, Math.round(finiteNumber(size?.w, 1)));
  const h = Math.max(1, Math.round(finiteNumber(size?.h, 1)));
  const vw = Math.max(w, Math.round(finiteNumber(viewport?.width, w)));
  const vh = Math.max(h, Math.round(finiteNumber(viewport?.height, h)));
  const p = Math.max(0, Math.round(finiteNumber(pad, 16)));
  const c = String(corner || 'bottom-right');
  const left = c.includes('left') ? p : Math.max(p, vw - w - p);
  const top = c.includes('top') ? p : Math.max(p, vh - h - p);
  return { left, top, w, h };
}

/**
 * Edge-anchored corner box (left/right/top/bottom).
 * Prefer this over absolute left/top so right/bottom corners stay glued on window resize.
 */
export function stickyCornerEdgeBox(
  corner: StickyCorner | null | undefined,
  size: SizeBox | null | undefined,
  pad = 16,
): StickyEdgeBox {
  const w = Math.max(1, Math.round(finiteNumber(size?.w, 1)));
  const h = Math.max(1, Math.round(finiteNumber(size?.h, 1)));
  const p = Math.max(0, Math.round(finiteNumber(pad, 16)));
  const c = String(corner || 'bottom-right');
  return {
    w,
    h,
    top: c.includes('top') ? p : null,
    bottom: c.includes('bottom') ? p : null,
    left: c.includes('left') ? p : null,
    right: c.includes('right') ? p : null,
  };
}

/** Sticky pin sitting on the top-center edge of an image box. */
export function stickyPinOverImage(
  box: { left?: number; top?: number; w?: number; h?: number } | null | undefined,
  pinSize = 28,
  gap = 6,
): { left: number; top: number } {
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
export function stickyPinEdgeBox(
  corner: StickyCorner | null | undefined,
  size: SizeBox | null | undefined,
  pinSize = 28,
  gap = 6,
  pad = 16,
): StickyPinEdgeBox {
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

// ── gallery thumb strip geometry ──────────────────────────────────────────

/** Viewer strip thumb geometry (must match UI flex styles). */
export const VIEWER_THUMB_LAYOUT = Object.freeze({
  width: 64,
  height: 88,
  gap: 8,
  splitWidth: 16,
  splitExtraMargin: 4,
});

export interface StripGeometryOptions {
  count?: number;
  selectedCount?: number;
  thumbWidth?: number;
  gap?: number;
  splitWidth?: number;
  splitExtraMargin?: number;
}

type StripChild =
  | { type: 'split' }
  | { type: 'thumb'; galIdx: number; marginLeft: number };

/** Index of the `|` separator among gallery items, or 0 when no separator is shown. */
export function galleryStripSplitAt(selectedCount: number, length: number): number {
  const n = Math.max(0, Math.floor(finiteNumber(length, 0)));
  const s = Math.max(0, Math.min(Math.floor(finiteNumber(selectedCount, 0)), n));
  return s > 0 && s < n ? s : 0;
}

/**
 * Map a flex child index (including the `|` node) back to a gallery index.
 * Returns -1 for the separator itself or out-of-range children.
 */
export function galleryIndexFromChildIndex(childIndex: number, selectedCount: number, length: number): number {
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
export function thumbIndexAtStripX(localX: number, {
  count = 0,
  selectedCount = 0,
  thumbWidth = VIEWER_THUMB_LAYOUT.width,
  gap = VIEWER_THUMB_LAYOUT.gap,
  splitWidth = VIEWER_THUMB_LAYOUT.splitWidth,
  splitExtraMargin = VIEWER_THUMB_LAYOUT.splitExtraMargin,
}: StripGeometryOptions = {}): number {
  const n = Math.max(0, Math.floor(finiteNumber(count, 0)));
  if (n <= 0) return -1;
  const x = finiteNumber(localX, NaN);
  if (!Number.isFinite(x) || x < 0) return -1;
  const tw = Math.max(1, finiteNumber(thumbWidth, VIEWER_THUMB_LAYOUT.width));
  const g = Math.max(0, finiteNumber(gap, VIEWER_THUMB_LAYOUT.gap));
  const sw = Math.max(0, finiteNumber(splitWidth, VIEWER_THUMB_LAYOUT.splitWidth));
  const sm = Math.max(0, finiteNumber(splitExtraMargin, VIEWER_THUMB_LAYOUT.splitExtraMargin));
  const splitAt = galleryStripSplitAt(selectedCount, n);
  const kids: StripChild[] = [];
  for (let i = 0; i < n; i += 1) {
    if (splitAt > 0 && i === splitAt) kids.push({ type: 'split' });
    kids.push({
      type: 'thumb',
      galIdx: i,
      marginLeft: splitAt > 0 && i === splitAt ? sm : 0,
    });
  }
  let cursor = 0;
  for (let k = 0; k < kids.length; k += 1) {
    if (k > 0) cursor += g;
    const kid = kids[k];
    if (kid.type === 'split') {
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
}: StripGeometryOptions = {}): number {
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
export function clampThumbScrollOffset(offset: number, contentWidth: number, viewportWidth: number): number {
  const max = Math.max(0, finiteNumber(contentWidth, 0) - Math.max(0, finiteNumber(viewportWidth, 0)));
  const raw = finiteNumber(offset, 0);
  return Math.max(0, Math.min(max, raw));
}

/**
 * Hard ceiling on one eager warm window, whatever `maxCount` the caller asks for.
 *
 * The frozen viewer passes `max(8, strip.length)` on every arrow press, which
 * on a reroll-heavy message meant the whole strip re-queued per step — dozens
 * of multi-MB encodes racing the main image. Twelve covers the visible strip
 * plus one page of lookahead either side.
 */
export const VIEWER_WARM_WINDOW_MAX = 12;

/** Nearby gallery card ids for eager data-URL encoding (visible window, capped). */
export function visibleGalleryImageIds(
  items: Array<{ id?: string } | null | undefined> | null | undefined,
  index = 0,
  radius = 1,
  maxCount = 8,
  pinPrefixCount = 0,
): string[] {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return [];
  const idx = Math.max(0, Math.min(finiteNumber(index, 0), list.length - 1));
  const cap = Math.max(1, Math.min(list.length, finiteNumber(maxCount, 8) || 8, VIEWER_WARM_WINDOW_MAX));
  // Prefer a centered window of up to maxCount; radius is a minimum span hint.
  const minSpan = Math.min(cap, 1 + 2 * Math.max(0, finiteNumber(radius, 1)));
  const span = Math.max(minSpan, cap);
  let start = Math.max(0, idx - Math.floor((span - 1) / 2));
  const end = Math.min(list.length - 1, start + span - 1);
  start = Math.max(0, end - span + 1);
  const ids: string[] = [];
  const seen = new Set<string>();
  const add = (i: number) => {
    const id = String(list[i]?.id || '');
    if (!id || seen.has(id)) return;
    seen.add(id);
    ids.push(id);
  };
  // Optional: keep the leading "current message" strip warm even when focus is far right.
  const pin = Math.max(0, Math.min(list.length, finiteNumber(pinPrefixCount, 0)));
  for (let i = 0; i < pin; i += 1) add(i);
  for (let i = start; i <= end; i += 1) {
    add(i);
    if (ids.length >= cap) break;
  }
  return ids;
}

/**
 * Card ids for the focused chat message and ±radius neighbors (by message_index).
 * Sticky scroll stays snappy when these data URLs are already in the sync cache.
 */
export function nearbyMessageImageIds(
  cards: GalleryCard[] | null | undefined,
  focus:
    | {
        messageIndex?: unknown;
        message_index?: unknown;
        sessionId?: unknown;
        session_id?: unknown;
        chatId?: unknown;
        chat_id?: unknown;
        hash?: unknown;
      }
    | null
    | undefined,
  radius = 2,
  extraIds: Array<string | null | undefined> | null | undefined = [],
): string[] {
  const list = Array.isArray(cards) ? cards : [];
  const r = Math.max(0, Math.min(8, finiteNumber(radius, 2)));
  const focusIdx = finiteNumber(focus?.messageIndex ?? focus?.message_index, Number.NaN);
  const sessionId = String(focus?.sessionId || focus?.session_id || '');
  const chatId = String(focus?.chatId || focus?.chat_id || '');
  const focusHash = String(focus?.hash || '');
  const seen = new Set<string>();
  const ids: string[] = [];
  const add = (id: unknown) => {
    if (ids.length >= NEARBY_IMAGE_MAX) return;
    const key = String(id || '');
    if (!key || seen.has(key)) return;
    seen.add(key);
    ids.push(key);
  };
  for (const id of extraIds || []) add(id);
  // Nearest message first, so the cap trims ±2 before it ever touches the
  // focus message. Gallery order is kept within one distance band.
  const candidates: Array<{ id: string; dist: number }> = [];
  for (const card of list) {
    if (!card?.id) continue;
    if (sessionId && card.session_id && String(card.session_id) !== sessionId) continue;
    if (chatId && card.chat_id && String(card.chat_id) !== chatId) continue;
    const mi = finiteNumber(card.message_index, Number.NaN);
    if (Number.isFinite(focusIdx) && Number.isFinite(mi)) {
      const dist = Math.abs(mi - focusIdx);
      if (dist <= r) candidates.push({ id: String(card.id), dist });
      continue;
    }
    if (focusHash && String(card.content_hash || '') === focusHash) candidates.push({ id: String(card.id), dist: 0 });
  }
  candidates.sort((a, b) => a.dist - b.dist);
  for (const c of candidates) add(c.id);
  return ids;
}

/**
 * Ceiling on the sticky pin/warm set. It is what `pinImageUrls` protects from
 * eviction, so it is also the one number that decides whether the 64MB budget
 * means anything — see `BLOB_URL_PIN_CAP`, which this must not exceed.
 */
export const NEARBY_IMAGE_MAX = 24;

/** True when two DOM message indices are within ±radius (optimistic nearby reuse). */
export function isNearbyDomIndex(prev: unknown, next: unknown, radius = 2): boolean {
  const a = finiteNumber(prev, Number.NaN);
  const b = finiteNumber(next, Number.NaN);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  const r = Math.max(0, finiteNumber(radius, 2));
  return Math.abs(a - b) <= r;
}

/** Inclusive [lo, hi] window of DOM indices centered on focus with ±radius. */
export function nearbyDomIndexWindow(center: unknown, count: unknown, radius = 2): { lo: number; hi: number; center: number } {
  const n = Math.max(0, Math.floor(finiteNumber(count, 0)));
  const c = Math.max(0, Math.min(Math.max(0, n - 1), Math.floor(finiteNumber(center, 0))));
  const r = Math.max(0, Math.floor(finiteNumber(radius, 2)));
  if (n <= 0) return { lo: 0, hi: -1, center: 0 };
  return { lo: Math.max(0, c - r), hi: Math.min(n - 1, c + r), center: c };
}

const PAINT_RANK: Record<string, number> = { chrome: 1, content: 2, full: 3 };

/** Coalesce pending viewer paint jobs — fuller modes win. */
export function mergeViewerPaintJob(pending: string | null | undefined, next: string | null | undefined): string {
  const a = PAINT_RANK[String(pending ?? '')] || 0;
  const b = PAINT_RANK[String(next ?? '')] || 0;
  if (!a && !b) return 'full';
  if (b >= a) return next || pending || 'full';
  return pending || next || 'full';
}

// ── autotag JSON parsing ──────────────────────────────────────────────────

export interface AutotagLook {
  bottoms?: string;
  appearance: string;
  attire: string;
  accessories: string;
  text: string;
  /** `girl` | `boy` | `other` | `""` from vision JSON when present. */
  gender?: string;
  name?: string;
  surname?: string;
  given_name?: string;
  aliases?: string[];
  original?: string;
  hair_color?: string;
  hair_style?: string;
  eye_color?: string;
  height?: string;
  age?: number | string;
  penis_size?: string;
}

/**
 * Parse LLM vision autotag JSON into appearance / attire / accessories.
 * Accepts fenced ```json blocks or a bare object; falls back to splitting a flat tag string.
 */
export function parseAutotagLookJson(raw: unknown): AutotagLook {
  const text = String(raw || '').trim();
  if (!text) {
    return { appearance: '', attire: '', accessories: '', text: '', gender: '' };
  }
  let obj: Record<string, unknown> | null = null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : text).trim();
  const brace = candidate.match(/\{[\s\S]*\}/);
  if (brace) {
    try {
      const parsed: unknown = JSON.parse(brace[0]);
      // Arrays deliberately pass this check, exactly as the untyped original did:
      // they yield empty look fields rather than falling through to the flat path.
      obj = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
    } catch {
      obj = null;
    }
  }
  if (obj && typeof obj === 'object') {
    const appearance = String(obj.appearance ?? obj.look ?? obj.identity ?? '').trim();
    const attire = String(obj.attire ?? obj.clothing ?? obj.outfit ?? '').trim();
    const accessories = String(obj.accessories ?? obj.accessory ?? obj.props ?? '').trim();
    const genderRaw = String(obj.gender ?? obj.sex ?? '').trim().toLowerCase();
    const gender = ['girl', 'female', 'f', 'woman'].includes(genderRaw)
      ? 'girl'
      : ['boy', 'male', 'm', 'man'].includes(genderRaw)
        ? 'boy'
        : genderRaw === 'other'
          ? 'other'
          : '';
    const joined = [appearance, attire, accessories].filter(Boolean).join(', ');
    const aliasesRaw = obj.aliases;
    const aliases = Array.isArray(aliasesRaw)
      ? aliasesRaw.map((a) => String(a || '').trim()).filter(Boolean)
      : [];
    return {
      appearance,
      attire,
      ...(obj.bottoms != null ? { bottoms: String(obj.bottoms).trim() } : {}),
      accessories,
      text: joined,
      gender,
      name: String(obj.name ?? '').trim(),
      surname: String(obj.surname ?? '').trim(),
      given_name: String(obj.given_name ?? obj.givenName ?? '').trim(),
      aliases,
      original: String(obj.original ?? '').trim(),
      hair_color: String(obj.hair_color ?? obj.hairColor ?? '').trim(),
      hair_style: String(obj.hair_style ?? obj.hairStyle ?? '').trim(),
      eye_color: String(obj.eye_color ?? obj.eyeColor ?? '').trim(),
      height: String(obj.height ?? '').trim(),
      age: obj.age as number | string | undefined,
      penis_size: String(obj.penis_size ?? obj.penisSize ?? '').trim(),
    };
  }
  // Legacy flat tag dump → put everything in appearance.
  const flat = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  return { appearance: flat, attire: '', accessories: '', text: flat, gender: '' };
}

/**
 * Resolve the mint "indexing" bar: image warm progress wins; else tagging phase.
 */
export function resolveIndexProgress(args: {
  warmPct?: unknown;
  warmBusy?: unknown;
  jobState?: unknown;
  jobPct?: unknown;
} = {}): { pct: number; busy: boolean; label: string } {
  const warmBusy = Boolean(args.warmBusy);
  const warmPct = Math.max(0, Math.min(100, Math.round(finiteNumber(args.warmPct, 0))));
  const state = String(args.jobState || '');
  const jobPct = Math.max(0, Math.min(100, Math.round(finiteNumber(args.jobPct, 0))));
  if (warmBusy) return { pct: Math.max(warmBusy ? 6 : 0, warmPct), busy: true, label: '인덱싱' };
  if (state === 'tagging') return { pct: Math.max(6, jobPct), busy: true, label: '인덱싱' };
  return { pct: 0, busy: false, label: '인덱싱' };
}

/** Two stacked rails: purple job (top) + mint indexing (bottom). Floating viewer status still uses this. */
export function composeDualProgressBarsHtml(args: {
  jobPct?: unknown;
  indexPct?: unknown;
  jobBusy?: unknown;
  indexBusy?: unknown;
  error?: unknown;
} = {}): string {
  const jobBusy = Boolean(args.jobBusy);
  const indexBusy = Boolean(args.indexBusy);
  const jobPct = Math.max(jobBusy ? 6 : 0, Math.min(100, Math.round(finiteNumber(args.jobPct, 0))));
  const indexPct = Math.max(indexBusy ? 6 : 0, Math.min(100, Math.round(finiteNumber(args.indexPct, 0))));
  const jobColor = args.error ? '#f87171' : '#7c6cff';
  const indexColor = '#2dd4bf';
  const rail = (pct: number, color: string) =>
    `<span style="display:block;height:4px;border-radius:2px;background:#1e2633;overflow:hidden"><span style="display:block;height:100%;width:${pct}%;background:${color}"></span></span>`;
  return `<span style="flex:0 0 120px;display:flex;flex-direction:column;gap:3px;justify-content:center">${rail(jobPct, jobColor)}${rail(indexPct, indexColor)}</span>`;
}

/** Single progress rail for the unified progress toast. */
export function composeSingleProgressBarHtml(args: {
  pct?: unknown;
  busy?: unknown;
  error?: unknown;
  /** `index` = mint (indexing); default purple job/regen */
  tone?: unknown;
} = {}): string {
  const busy = Boolean(args.busy);
  const pct = Math.max(busy ? 6 : 0, Math.min(100, Math.round(finiteNumber(args.pct, 0))));
  const tone = String(args.tone || '');
  const color = args.error ? '#f87171' : tone === 'index' ? '#2dd4bf' : '#7c6cff';
  // Thin full-width rail — no spinner; SafeDOM-friendly inline only.
  return `<span style="display:block;width:100%;height:3px;border-radius:2px;background:#1e2633;overflow:hidden"><span style="display:block;height:100%;width:${pct}%;background:${color};border-radius:2px"></span></span>`;
}

/** Elapsed label for progress toast (`18s`, `1m 05s`). */
export function formatProgressElapsedSec(ms: unknown): string {
  const n = Math.max(0, Math.floor(finiteNumber(ms, 0) / 1000));
  if (n < 60) return `${n}s`;
  const m = Math.floor(n / 60);
  const s = n % 60;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

/**
 * Top-center progress toast chip HTML (inline styles only — no CSS runtime).
 * Compact: stage + optional meta; progress rail under text when showBar.
 */
export function composeProgressToastHtml(args: {
  stage?: unknown;
  meta?: unknown;
  pct?: unknown;
  /** @deprecated dual-bar fields — collapsed into pct when `pct` omitted */
  jobPct?: unknown;
  indexPct?: unknown;
  jobBusy?: unknown;
  indexBusy?: unknown;
  busy?: unknown;
  error?: unknown;
  /** Idle selection chip — omit the progress rail */
  showBar?: unknown;
  /** `index` = mint bar (indexing); otherwise purple */
  tone?: unknown;
  escapeHtml?: ((s: string) => string) | null;
} = {}): string {
  const jobBusy = Boolean(args.jobBusy);
  const indexBusy = Boolean(args.indexBusy);
  const busy = Boolean(args.busy) || jobBusy || indexBusy;
  if (!busy && !args.error) return '';
  const esc = typeof args.escapeHtml === 'function'
    ? args.escapeHtml
    : (s: string) => String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  const tone = String(args.tone || (!jobBusy && indexBusy ? 'index' : 'job'));
  const stage = esc(String(args.stage || (tone === 'index' ? '인덱싱' : '작업 중')).slice(0, 80));
  const meta = esc(String(args.meta || '').slice(0, 160));
  let pct = args.pct;
  if (pct == null) {
    if (jobBusy) pct = args.jobPct;
    else if (indexBusy) pct = args.indexPct;
    else pct = Math.max(finiteNumber(args.jobPct, 0), finiteNumber(args.indexPct, 0));
  }
  const showBar = args.showBar !== false && args.showBar !== 0 && args.showBar !== 'false';
  const bar = showBar
    ? composeSingleProgressBarHtml({
      pct,
      busy: busy || Boolean(args.error),
      error: args.error,
      tone,
    })
    : '';
  const accent = args.error ? '#f87171' : tone === 'index' ? '#5eead4' : '#c4b5fd';
  const metaRow = meta
    ? `<div style="min-width:0;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#8b97ab;font-size:10px;line-height:1.25">${meta}</div>`
    : '';
  return `<div data-inlay-progress-toast="1" style="display:flex;flex-direction:column;gap:4px;box-sizing:border-box;width:min(280px,92vw);padding:6px 10px;border-radius:8px;background:rgba(18,24,32,.42);border:1px solid rgba(42,51,68,.5);cursor:pointer;user-select:none"><div style="min-width:0;font-weight:700;color:${accent};font-size:11px;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${stage}</div>${metaRow}${bar ? `<div style="width:100%">${bar}</div>` : ''}</div>`;
}

/**
 * Fixed-position chip for progress / selection / host / attach toasts.
 * `shiftPx` pushes a stacked toast inward from the same corner so two chips
 * do not cover each other.
 */
export function toastAnchorStyle(anchor: unknown, opts: {
  insetPx?: unknown;
  shiftPx?: unknown;
  visible?: unknown;
  pointerEvents?: unknown;
  zIndex?: unknown;
} = {}): string {
  const a = normalizeToastAnchor(anchor);
  const inset = Math.max(0, finiteNumber(opts.insetPx, 16));
  const shift = Math.max(0, finiteNumber(opts.shiftPx, 0));
  const vis = opts.visible === false || opts.visible === 0 ? 'none' : 'block';
  const pe = opts.pointerEvents === false || opts.pointerEvents === 0 ? 'none' : 'auto';
  const z = Math.max(1, Math.round(finiteNumber(opts.zIndex, 99999)));
  const box = `z-index:${z};pointer-events:${pe};width:min(280px,92vw);box-sizing:border-box;display:${vis}`;
  const along = inset + shift;
  // Bottom corners sit above Risu's input chrome and off the side edge.
  const bottom = along + 36;
  const bottomSide = inset + 12;
  if (a === 'tl') return `position:fixed;top:${along}px;left:${inset}px;${box};`;
  if (a === 'tr') return `position:fixed;top:${along}px;right:${inset}px;${box};`;
  if (a === 'bl') return `position:fixed;bottom:${bottom}px;left:${bottomSide}px;${box};`;
  if (a === 'br') return `position:fixed;bottom:${bottom}px;right:${bottomSide}px;${box};`;
  return `position:fixed;top:${along}px;left:50%;transform:translateX(-50%);${box};`;
}

export function shouldStartImagePressInspect(opts: {
  mode?: unknown;
  pointerCount?: unknown;
} = {}): boolean {
  const mode = normalizeImagePressInspect(opts.mode);
  const n = Math.max(0, Math.floor(finiteNumber(opts.pointerCount, 0)));
  if (!imagePressAllowsHold(mode) || n < 1) return false;
  return true;
}

/** First attach wait — boot / first enter of a session. Not every click. */
export const ATTACH_TOAST_MAX_MS = 10000;

/**
 * One toast per session. Stay visible (`alreadyWanted`) until hide-done or a
 * new session id. `doneSessionId == null` means this boot has never finished.
 */
export function shouldShowSessionAttachToast(opts: {
  sessionId?: unknown;
  doneSessionId?: unknown;
  alreadyWanted?: unknown;
} = {}): boolean {
  if (opts.alreadyWanted) return true;
  if (opts.doneSessionId == null) return true;
  return String(opts.sessionId ?? '') !== String(opts.doneSessionId);
}

/** Spinner chip shown while the first chips/shots of a session are landing. */
export function composeAttachToastHtml(escapeHtml?: ((s: string) => string) | null): string {
  const esc = typeof escapeHtml === 'function'
    ? escapeHtml
    : (s: string) => String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  const stage = esc('인레이 넥서스 조각 불러오는중..');
  return `<div data-inlay-attach-toast="1" style="display:flex;align-items:center;gap:8px;box-sizing:border-box;width:min(280px,92vw);padding:6px 10px;border-radius:8px;background:rgba(18,24,32,.42);border:1px solid rgba(42,51,68,.5);color:#e8eef8;font-size:11px;user-select:none"><svg width="12" height="12" viewBox="0 0 12 12" style="flex:0 0 12px" aria-hidden="true"><circle cx="6" cy="6" r="4.5" fill="none" stroke="rgba(196,181,253,.35)" stroke-width="2"/><circle cx="6" cy="6" r="4.5" fill="none" stroke="#c4b5fd" stroke-width="2" stroke-dasharray="8 20" stroke-linecap="round"><animateTransform attributeName="transform" type="rotate" from="0 6 6" to="360 6 6" dur="0.7s" repeatCount="indefinite"/></circle></svg><div style="min-width:0;font-weight:700;color:#c4b5fd;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${stage}</div></div>`;
}

// ── anchor / reading / segment index ──────────────────────────────────────

function clampPercent(value: unknown): number {
  return Math.max(0, Math.min(100, finiteNumber(value, 0)));
}

/**
 * Equal band start for index in [0, count): 4 shots → 0 / 25 / 50 / 75.
 * Sticky segments then own [start, next) slices of the message (0–25, 25–50, …).
 */
export function evenAnchorPercent(index: number, count: number): number {
  const n = Math.max(1, finiteNumber(count, 1));
  const i = Math.max(0, Math.min(finiteNumber(index, 0), n - 1));
  return (i / n) * 100;
}

/**
 * Prefer card y_percent / anchor_percent; else even band starts.
 * Pass `{ forceEven: true }` when LLM placement is OFF so saved y% is ignored.
 */
export function resolveCardAnchorPercent(
  card: GalleryCard | null | undefined,
  index = 0,
  count = 1,
  opts: { forceEven?: boolean } | null = null,
): number {
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
export function readingPercentInMessage(
  rect: MessageRect | null | undefined,
  viewportH: number,
  lineRatio = 0.5,
): number | null {
  if (!rect) return null;
  const height = Math.max(1, finiteNumber(rect.height, 0));
  const lineY = Math.max(0, finiteNumber(viewportH, 0)) * (Number.isFinite(lineRatio) ? lineRatio : 0.5);
  if (lineY < finiteNumber(rect.top, 0) || lineY > finiteNumber(rect.bottom, 0)) return null;
  return clampPercent((lineY - finiteNumber(rect.top, 0)) / height * 100);
}

/** Clamp reading % when the line is outside but we still want a band. */
export function clampReadingPercent(
  rect: MessageRect | null | undefined,
  viewportH: number,
  lineRatio = 0.5,
): number {
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
export function activeSegmentIndex(markerPercents: number[] | null | undefined, readingPct: number): number {
  const list = Array.isArray(markerPercents) ? markerPercents : [];
  if (!list.length) return -1;
  const reading = clampPercent(readingPct);
  const raw = list.map((v) => clampPercent(v));
  const low = raw.reduce<number[]>((acc, v, i) => (v <= 20 ? acc.concat(i) : acc), []);
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

/**
 * Client-space point for a marker y% inside a message rect (mid-X, y% down the box).
 * Used when 말풍선 삽화 is on and sticky picks the shot nearest the pointer.
 */
export function markerAnchorClientPoint(
  rect: MessageRect | null | undefined,
  yPercent: unknown,
): { x: number; y: number } | null {
  if (!rect) return null;
  const top = finiteNumber(rect.top, 0);
  const height = Math.max(
    1,
    finiteNumber(rect.height, finiteNumber(rect.bottom, top) - top),
  );
  const left = finiteNumber(rect.left, 0);
  const width = Math.max(
    0,
    finiteNumber(rect.width, finiteNumber(rect.right, left) - left),
  );
  return {
    x: left + width * 0.5,
    y: top + height * (clampPercent(yPercent) / 100),
  };
}

/**
 * Index of the point nearest (clientX, clientY). Missing / non-finite points skipped.
 * Tie → lower index. Empty → -1.
 */
export function nearestSegmentByClientPoint(
  points: Array<{ x?: number; y?: number } | null | undefined> | null | undefined,
  clientX: number,
  clientY: number,
): number {
  const list = Array.isArray(points) ? points : [];
  if (!list.length) return -1;
  const px = Number(clientX);
  const py = Number(clientY);
  if (!Number.isFinite(px) || !Number.isFinite(py)) return -1;
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < list.length; i += 1) {
    const p = list[i];
    if (!p) continue;
    const y = Number(p.y);
    if (!Number.isFinite(y)) continue;
    const x = Number(p.x);
    const dx = Number.isFinite(x) ? x - px : 0;
    const dy = y - py;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** True when (clientX, clientY) lies inside a DOM-like client rect. */
export function clientPointInRect(
  rect: { left?: number; right?: number; top?: number; bottom?: number } | null | undefined,
  clientX: number,
  clientY: number,
): boolean {
  if (!rect) return false;
  const px = Number(clientX);
  const py = Number(clientY);
  if (!Number.isFinite(px) || !Number.isFinite(py)) return false;
  const left = Number(rect.left);
  const right = Number(rect.right);
  const top = Number(rect.top);
  const bottom = Number(rect.bottom);
  if (![left, right, top, bottom].every(Number.isFinite)) return false;
  return px >= left && px <= right && py >= top && py <= bottom;
}

/**
 * Index of the rect containing (clientX, clientY). Overlaps → smallest area.
 * Empty / miss → -1.
 */
export function hitSegmentByClientPoint(
  rects: Array<{ left?: number; right?: number; top?: number; bottom?: number } | null | undefined> | null | undefined,
  clientX: number,
  clientY: number,
): number {
  const list = Array.isArray(rects) ? rects : [];
  if (!list.length) return -1;
  let best = -1;
  let bestArea = Infinity;
  for (let i = 0; i < list.length; i += 1) {
    const r = list[i];
    if (!clientPointInRect(r, clientX, clientY) || !r) continue;
    const w = Math.max(0, Number(r.right) - Number(r.left));
    const h = Math.max(0, Number(r.bottom) - Number(r.top));
    const area = w * h;
    if (area < bestArea) {
      bestArea = area;
      best = i;
    }
  }
  return best;
}

/**
 * Sticky segment while 말풍선 삽화 (beta) is on: prefer shot under the pointer
 * (hit-test), else nearest center / y% anchor. Falls back to reading-band `fallback`.
 */
export function stickySegmentForInlineChat(opts: {
  inlineChatOn?: boolean;
  pointerX?: unknown;
  pointerY?: unknown;
  messageRect?: MessageRect | null;
  markerPercents?: number[] | null;
  /** Optional live centers (e.g. inline DOM); null entries fall back to y% anchors. */
  markerCenters?: Array<{ x?: number; y?: number } | null | undefined> | null;
  /** Optional live client rects — when pointer is inside one, that shot wins. */
  markerRects?: Array<{ left?: number; right?: number; top?: number; bottom?: number } | null | undefined> | null;
  fallbackSegment?: number;
}): number {
  const fallback = Number.isFinite(Number(opts.fallbackSegment)) ? Math.trunc(Number(opts.fallbackSegment)) : -1;
  if (!opts.inlineChatOn) return fallback;
  const px = Number(opts.pointerX);
  const py = Number(opts.pointerY);
  if (!Number.isFinite(px) || !Number.isFinite(py)) return fallback;
  const hit = hitSegmentByClientPoint(opts.markerRects, px, py);
  if (hit >= 0) return hit;
  const pcts = Array.isArray(opts.markerPercents) ? opts.markerPercents : [];
  const centers = Array.isArray(opts.markerCenters) ? opts.markerCenters : [];
  const n = Math.max(pcts.length, centers.length);
  if (n <= 0) return fallback;
  const points: Array<{ x: number; y: number } | null> = [];
  for (let i = 0; i < n; i += 1) {
    const live = centers[i];
    if (live && Number.isFinite(Number(live.y))) {
      points.push({
        x: Number.isFinite(Number(live.x)) ? Number(live.x) : px,
        y: Number(live.y),
      });
      continue;
    }
    points.push(markerAnchorClientPoint(opts.messageRect, pcts[i] ?? 0));
  }
  const near = nearestSegmentByClientPoint(points, px, py);
  return near >= 0 ? near : fallback;
}

// ── beta: chat-bubble inline images at newline lines ──────────────────────

const INLAY_INLINE_ATTR = 'data-inlay-inline-shot';
export const INLINE_FRAME_LAYOUT_VERSION = '13';
/**
 * Content hash of the bubble this marker was placed into.
 *
 * Lets a repaint prove in one bridge round-trip that the bubble was not rebuilt
 * and its text did not change, which is the licence to reuse the cached
 * paragraph scan instead of walking the tree again.
 */
export const INLAY_INLINE_KEY_ATTR = 'data-inlay-inline-key';

const BLOCK_CLOSE_RE = /^<\/(?:p|div|li|blockquote|h[1-6]|tr)>$/i;
const BR_RE = /^<br\s*\/?>$/i;

/** Strip our beta illustration blocks so hashing / line splits see original prose. */
export function stripInlayInlineHtml(html: unknown): string {
  const raw = String(html || '');
  if (!raw) return '';
  return raw
    .replace(/<div[^>]*\bdata-inlay-inline-shot\b[^>]*>[\s\S]*?<\/div>/gi, '')
    .replace(/<(?:span|p)[^>]*\bdata-inlay-inline-shot\b[^>]*>[\s\S]*?<\/(?:span|p)>/gi, '')
    .replace(/<(div|span)[^>]*\b(?:data-inlay-msg-actions|x-inlay-msg-actions)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
}

/**
 * One top bar and, when the bubble has two hosts, one bottom bar.
 * Document-order indexes to keep; extras are duplicates from overlapping paints.
 */
export function keepMsgActionBarIndexes(ends: readonly unknown[], wantBottom: boolean, wantTop = true): number[] {
  const list = Array.isArray(ends) ? ends.map((e) => String(e ?? '')) : [];
  const want = new Set<string>();
  if (wantTop) want.add('top');
  if (wantBottom) want.add('bot');
  const kept: number[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < list.length; i += 1) {
    const raw = list[i]!;
    const end = raw === 'bot' ? 'bot' : raw === 'top' ? 'top' : '';
    if (!end || !want.has(end) || seen.has(end)) continue;
    seen.add(end);
    kept.push(i);
  }
  if (kept.length < want.size) {
    for (let i = 0; i < list.length && kept.length < want.size; i += 1) {
      if (!kept.includes(i)) kept.push(i);
    }
  }
  return kept.sort((a, b) => a - b);
}

/** Chip rows and shot/spinner wraps must not become leaf hosts. */
export function isInlayPaintHost(attrs: {
  isActionBar?: unknown;
  isInlineShot?: unknown;
} | null | undefined): boolean {
  return Boolean(attrs?.isActionBar) || Boolean(attrs?.isInlineShot);
}

/** PocketRisu Standard keeps avatar + name in DIV chrome on the same card. */
export function isMessageBodyHostTag(tag: unknown): boolean {
  const name = String(tag || '').toUpperCase();
  return name === 'P' || name === 'LI' || name === 'BLOCKQUOTE' || /^H[1-6]$/.test(name);
}

/** Both bars sit on the prose-box parent. Off stays on the host. */
export function msgActionMountKind(end: unknown, mode: unknown = 'compat'): 'parent' | 'host' {
  const which = String(end || '');
  if (inlineMsgActionsOn(mode) && (which === 'top' || which === 'bot')) return 'parent';
  return 'host';
}

/** Top = first child of the box. Bottom = last child of the box. */
export function msgActionBarPlace(end: unknown): 'before' | 'after' {
  return String(end || '') === 'bot' ? 'after' : 'before';
}

/** Parent prepend when parent is an inner box under the bubble (top bar). */
export function canMountMsgActionOnParent(
  parent: unknown,
  bubbleRoot: unknown,
  mode: unknown = 'compat',
  insideBubble: unknown = false,
): boolean {
  if (!inlineMsgActionsOn(mode)) return false;
  if (parent == null || parent === bubbleRoot) return false;
  return insideBubble === true;
}

/** First and last `<p>` indices. Same index when the bubble has only one. */
export function firstLastParagraphIndices(tagNames: unknown[] | null | undefined): number[] {
  const tags = (Array.isArray(tagNames) ? tagNames : []).map((t) => String(t || '').toUpperCase());
  const hits: number[] = [];
  for (let i = 0; i < tags.length; i += 1) {
    if (tags[i] === 'P') hits.push(i);
  }
  if (!hits.length) return [];
  if (hits.length === 1) return [hits[0]!];
  return [hits[0]!, hits[hits.length - 1]!];
}

/** Same newline split as vendor Xt — non-empty trimmed lines. */
export function splitMessageLines(text: unknown): string[] {
  return String(text ?? '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 1-based line clamped into [1, lineCount]; null if missing/invalid or no lines. */
export function clampShotLine(line: unknown, lineCount: number): number | null {
  const n = Math.floor(Number(line));
  const max = Math.max(0, Math.floor(Number(lineCount) || 0));
  if (!max || !Number.isFinite(n) || n < 1) return null;
  return Math.max(1, Math.min(max, n));
}

export interface InlineImagePlacement {
  line: number;
  src: string;
  shotIndex?: number;
  cardId?: string;
  aspect?: unknown;
  width?: unknown;
  height?: unknown;
  /** No image yet — show spinner + br spacing at the line. */
  pending?: boolean;
  /** Comic shots use the green spinner; omitted/other stay purple. */
  kind?: unknown;
}

export type InlineCardInput = {
  id?: unknown;
  line?: unknown;
  shot_index?: unknown;
  aspect?: unknown;
  width?: unknown;
  height?: unknown;
  kind?: unknown;
};

export type InlinePendingInput = {
  line?: unknown;
  shot_index?: unknown;
  aspect?: unknown;
  width?: unknown;
  height?: unknown;
  kind?: unknown;
};

export type InlineLiveMarker = {
  cardId: string;
  pending?: boolean;
  layoutVersion?: unknown;
};

export type InlineReconcileAction =
  | { op: 'keep' }
  | { op: 'strip' }
  | { op: 'prepend'; placement: InlineImagePlacement }
  | { op: 'fill'; placement: InlineImagePlacement }
  | { op: 'swap'; placement: InlineImagePlacement };

/**
 * Ready cards first (they claim line/shot). Pending only fills leftover lines.
 * A linked card with no bytes is a spinner on its own id and still blocks
 * job-pending on that line; encodeLater bakes the bytes after the spinner is in.
 */
export function desiredInlinePlacements(
  cards: InlineCardInput[] | null | undefined,
  pendingRows: InlinePendingInput[] | null | undefined,
  resolveSrc: ((card: InlineCardInput) => string) | null | undefined = () => '',
): { placements: InlineImagePlacement[]; encodeLater: InlineCardInput[] } {
  const list = Array.isArray(cards) ? cards : [];
  const pending = Array.isArray(pendingRows) ? pendingRows : [];
  const getSrc = typeof resolveSrc === 'function' ? resolveSrc : () => '';
  const placements: InlineImagePlacement[] = [];
  const encodeLater: InlineCardInput[] = [];
  const seenCard = new Set<string>();
  const seenLine = new Set<number>();
  const seenShot = new Set<number>();

  for (const card of list) {
    const line = Number(card?.line);
    const shotIndex = Number(card?.shot_index);
    const cardId = String(card?.id || '');
    const hasShot = Number.isFinite(shotIndex) && shotIndex >= 0;
    const hasLine = Number.isFinite(line) && line >= 1;
    if (cardId && seenCard.has(cardId)) continue;
    if (!hasLine || (hasShot ? seenShot.has(shotIndex) : seenLine.has(line))) continue;
    if (hasShot) seenShot.add(shotIndex);
    seenLine.add(line);
    const src = String(getSrc(card) || '');
    if (!isReadyImageSrc(src)) {
      if (cardId) {
        encodeLater.push(card);
        seenCard.add(cardId);
        placements.push({
          line,
          src: '',
          shotIndex: Number.isFinite(shotIndex) ? shotIndex : undefined,
          cardId,
          aspect: card.aspect,
          width: card.width,
          height: card.height,
          pending: true,
          kind: card.kind,
        });
      }
      continue;
    }
    if (cardId) seenCard.add(cardId);
    placements.push({
      line,
      src,
      shotIndex: Number.isFinite(shotIndex) ? shotIndex : undefined,
      cardId,
      aspect: card.aspect,
      width: card.width,
      height: card.height,
      pending: false,
      kind: card.kind,
    });
  }

  for (const row of pending) {
    const line = Number(row?.line);
    const shotIndex = Number(row?.shot_index);
    const hasShot = Number.isFinite(shotIndex) && shotIndex >= 0;
    if (!Number.isFinite(line) || line < 1 || (hasShot ? seenShot.has(shotIndex) : seenLine.has(line))) continue;
    const cardId = `pending-${Number.isFinite(shotIndex) ? shotIndex : line}`;
    if (seenCard.has(cardId)) continue;
    seenLine.add(line);
    if (Number.isFinite(shotIndex)) seenShot.add(shotIndex);
    seenCard.add(cardId);
    placements.push({
      line,
      src: '',
      shotIndex: Number.isFinite(shotIndex) ? shotIndex : undefined,
      cardId,
      aspect: row.aspect,
      width: row.width,
      height: row.height,
      pending: true,
      kind: row.kind,
    });
  }

  return { placements, encodeLater };
}

/** Pick one mounted wrapper per stable slot and identify proven duplicates. */
export function partitionInlineFrameDuplicates(
  rows: Array<{
    id?: unknown;
    slot?: unknown;
    ready?: unknown;
    duplicate?: unknown;
  }> | null | undefined,
  desired: InlineImagePlacement[] | null | undefined,
): { keep: number[]; duplicates: number[] } {
  const list = Array.isArray(rows) ? rows : [];
  const wanted = (Array.isArray(desired) ? desired : []).map((placement) => ({
    slot: inlinePlacementSlotKey(placement),
    id: String(placement.cardId || ''),
  }));
  const chosen = new Set<number>();
  for (const target of wanted) {
    let chosenIndex = -1;
    let chosenScore = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < list.length; index += 1) {
      if (chosen.has(index)) continue;
      const row = list[index]!;
      const id = String(row?.id || '');
      const slot = String(row?.slot || '');
      const idMatch = !!target.id && id === target.id;
      const slotMatch = !!target.slot && slot === target.slot;
      if (!idMatch && !slotMatch) continue;
      const score = (idMatch && slotMatch ? 10_000 : slotMatch ? 1_000 : 100)
        + (row?.ready === true ? 10 : 0)
        + (row?.duplicate === true || String(row?.duplicate || '') === '1' ? 0 : 1);
      if (score > chosenScore) {
        chosenIndex = index;
        chosenScore = score;
      }
    }
    if (chosenIndex >= 0) chosen.add(chosenIndex);
  }
  const duplicates: number[] = [];
  for (let index = 0; index < list.length; index += 1) {
    if (chosen.has(index)) continue;
    const row = list[index]!;
    const id = String(row?.id || '');
    const slot = String(row?.slot || '');
    if (wanted.some((target) => {
      return !!slot && slot === target.slot || !!id && id === target.id;
    })) {
      duplicates.push(index);
    }
  }
  const duplicateSet = new Set(duplicates);
  const keep = list.map((_row, index) => index).filter((index) => !duplicateSet.has(index));
  return {
    keep,
    duplicates: duplicates.sort((a, b) => a - b),
  };
}

/**
 * Run `worker` over `items` with at most `limit` in flight.
 * Completion order is whatever the workers finish — callers that paint should
 * do it inside `worker`, not wait for this to return an ordered list.
 */
export async function runBoundedPool<T>(
  items: T[] | null | undefined,
  limit: unknown,
  worker: (item: T, index: number) => Promise<unknown> | unknown,
): Promise<void> {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return;
  const cap = Math.max(1, Math.floor(Number(limit)) || 1);
  let next = 0;
  const run = async () => {
    while (next < list.length) {
      const i = next;
      next += 1;
      await worker(list[i] as T, i);
    }
  };
  const n = Math.min(cap, list.length);
  await Promise.all(Array.from({ length: n }, () => run()));
}

/**
 * Cheap "bubble is already correct" gate for the inject pass.
 *
 * A shot with no bytes yet is not a failure: its marker is in place and a live
 * `subscribeImageUrl` watcher will fill that one cell when the encode lands.
 * `awaitingCount` is how many of the wanted ids are in exactly that state, so
 * ready + awaiting covering the want set means there is nothing left to do.
 *
 * Leftover wrappers are the case this must still catch: after Risu (or a chat
 * hop) strips the `<img src>`, ids and counts still match but nothing is
 * watching those cells, so the bubble has to be repainted.
 */
export function canSkipInlineInject(opts: {
  scaleMatches?: unknown;
  liveShotCount?: unknown;
  liveUniqueCount?: unknown;
  wantIdCount?: unknown;
  readyImgCount?: unknown;
  awaitingCount?: unknown;
} = {}): boolean {
  if (!opts.scaleMatches) return false;
  const live = Math.max(0, Math.floor(finiteNumber(opts.liveShotCount, 0)));
  const want = Math.max(0, Math.floor(finiteNumber(opts.wantIdCount, 0)));
  if (live !== want) return false;
  // Two wrappers with the same card id still count as live===want.
  if (opts.liveUniqueCount != null) {
    const unique = Math.max(0, Math.floor(finiteNumber(opts.liveUniqueCount, live)));
    if (unique !== live) return false;
  }
  if (want === 0) return true;
  if (opts.readyImgCount == null) return true;
  const ready = Math.max(0, Math.floor(finiteNumber(opts.readyImgCount, 0)));
  const awaiting = Math.max(0, Math.floor(finiteNumber(opts.awaitingCount, 0)));
  return ready + awaiting >= want;
}

/** Cheap skip key: line + pending/image + id. Bytes themselves stay out. */
export function desiredInlinePaintKey(
  placements: InlineImagePlacement[] | null | undefined,
  encodeLaterIds: string[] = [],
): string {
  const ready = (Array.isArray(placements) ? placements : [])
    .map((p) => `${Number(p.line) || 0}:${p.pending ? 'p' : 'i'}:${String(p.cardId || '')}`)
    .sort()
    .join('|');
  const later = encodeLaterIds.filter(Boolean).sort().join(',');
  return `${ready}#${later}`;
}

/** Job pending rows have shot_index/line, not cardId — empty cardId must not collapse to "". */
export function pendingInlineKey(rows: InlinePendingInput[] | null | undefined): string {
  if (!Array.isArray(rows) || !rows.length) return '';
  return rows
    .map((p) => `${Number(p?.shot_index)}:${Number(p?.line)}`)
    .sort()
    .join('|');
}

/**
 * One host / one line. Pending can replace an old card; a ready card replaces a
 * spinner; empty desired strips leftovers. No-src linked cards hold the host.
 */
export function reconcileInlineShot(
  desired: InlineImagePlacement | null | undefined,
  live: InlineLiveMarker | null | undefined,
): InlineReconcileAction {
  const hasLive = live != null;
  const hasDesired = !!(desired && Number(desired.line) >= 1);

  // A mounted frame owns layout, so ordinary reconciliation may only reuse it.
  // Risu remounting the bubble removes the frame for us; deleting one here is
  // what collapsed the message height and made click selection jump the chat.
  if (!hasDesired) return { op: 'keep' };
  if (!hasLive) return { op: 'prepend', placement: desired };

  const liveId = String(live.cardId || '');
  const wantId = String(desired.cardId || '');
  const livePending = live.pending === true;
  const wantPending = desired.pending === true;

  if (liveId === wantId && livePending === wantPending) {
    return { op: 'keep' };
  }
  // Pending→ready, retag, reroll, and old layout versions all retarget the same
  // node. Styles and mutable card metadata are updated in place by the caller.
  return { op: 'fill', placement: desired };
}

/**
 * Walk leftover bubble markers even when keepIds is empty.
 * Force retag unlinks first; skipping that scan left the previous generation
 * painted until a new card id existed.
 */
export function shouldScanInlineLeftovers(_keepCount: unknown = 0): boolean {
  return true;
}

/** Unreadable id stays. Stale ids and a second copy of a keep id are leftover. */
export function shouldStripLeftoverInlineId(
  leftId: unknown,
  keepIds: Iterable<string> | null | undefined,
  _stripUnread = false,
  seenIds?: Set<string>,
): boolean {
  const id = String(leftId || '');
  if (!id) return false;
  const keep = keepIds instanceof Set ? keepIds : new Set(Array.isArray(keepIds) ? keepIds : [...(keepIds || [])]);
  if (!keep.has(id)) return true;
  if (seenIds) {
    if (seenIds.has(id)) return true;
    seenIds.add(id);
  }
  return false;
}

export interface InlineInjectOptions {
  /** Bubble client width — clamps img so intrinsic size cannot expand the parent. */
  maxWidthPx?: number;
  /** Dashboard scale % for bubble illustrations (100 = default 78%/70vh caps). */
  scalePct?: number;
  /** Insert the frame before the line's first character, or after its last. */
  textSide?: unknown;
}

/** Clamp bubble-illustration scale; default 100, range 25–200. */
export function clampInlineChatScalePct(value: unknown): number {
  const n = Math.round(finiteNumber(value, 100));
  if (!Number.isFinite(n) || n <= 0) return 100;
  return Math.max(25, Math.min(200, n));
}

/** Shared caps keep the spinner, overlay and baked asset at the same size. */
export function inlineChatImgStyle(scalePct: unknown = 100): string {
  return `${chatImageSizeStyle(scalePct)};object-fit:contain;border-radius:10px;display:inline-block;vertical-align:top`;
}
export function inlineChatSpinnerImgStyle(scalePct: unknown = 100): string {
  return `${inlineChatImgStyle(scalePct)};max-width:100%;pointer-events:none`;
}

/** Stack that keeps the spinner in flow and parks the photo on top. */
export function inlineChatStackStyle(scalePct: unknown = 100): string {
  return `position:relative;display:inline-block;line-height:0;width:fit-content;${chatImageSizeStyle(scalePct).replace('width:auto;height:auto;', '')};box-sizing:border-box;vertical-align:top`;
}

/** Outer frame style; hidden is reserved for proven duplicate-wrapper repair. */
export function inlineChatFrameStyle(visible = true): string {
  return visible
    ? 'display:block;margin:10px 0;text-align:center;line-height:0;max-width:100%;box-sizing:border-box'
    : 'display:none';
}

/** Photo cell. Hidden with opacity; the unused sibling is removed after a swap. */
export function inlineChatOverlayImgStyle(visible = false, _scalePct: unknown = 100): string {
  return `position:absolute;left:50%;top:50%;width:100%;height:100%;max-width:100%;overflow:hidden;transform:translate(-50%,-50%);border-radius:10px;display:block;pointer-events:none;opacity:${visible ? 1 : 0};transition:opacity 80ms linear`;
}

/** Image inside a photo cell. SafeDOM changes it via cell.setInnerHTML(). */
export function inlineChatOverlayPhotoStyle(): string {
  return 'width:100%;height:100%;object-fit:contain;border-radius:10px;display:block;pointer-events:auto';
}

type InlinePlaceholderInput = {
  aspect?: unknown;
  width?: unknown;
  height?: unknown;
  kind?: unknown;
};

/** Purple illustration ring; green only when the shot is comic. */
function inlinePlaceholderColors(input: InlinePlaceholderInput | null | undefined): { fill: string; stroke: string } {
  if (normalizeShotKind(input?.kind) === 'comic') return { fill: '#22c55e', stroke: '#4ade80' };
  return { fill: '#7c6cff', stroke: '#c4b5fd' };
}

/** Intrinsic SVG size so the pending img already matches the coming shot. */
export function inlinePlaceholderSize(input: InlinePlaceholderInput | null | undefined): { width: number; height: number } {
  const width = Math.floor(finiteNumber(input?.width, 0));
  const height = Math.floor(finiteNumber(input?.height, 0));
  if (width > 0 && height > 0) return { width, height };
  const aspect = resolveShotAspect(input?.aspect);
  if (aspect === 'square') return { width: 1024, height: 1024 };
  if (aspect === 'landscape') return { width: 1216, height: 832 };
  return { width: 832, height: 1216 };
}

/** Cheap SVG data URL used as the pending img src until real bytes arrive. */
export function inlinePlaceholderSrc(input: InlinePlaceholderInput | null | undefined = null): string {
  const { width, height } = inlinePlaceholderSize(input);
  const { fill, stroke } = inlinePlaceholderColors(input);
  const cx = Math.round(width / 2);
  const cy = Math.round(height / 2);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="${fill}" fill-opacity=".08"/><g transform="translate(${cx} ${cy})"><circle r="22" fill="none" stroke="#fff" stroke-opacity=".18" stroke-width="6"/><circle r="22" fill="none" stroke="${stroke}" stroke-width="6" stroke-linecap="round" stroke-dasharray="36 104"/></g></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** Stable frame identity. Card ids change on reroll; shot slots do not. */
export function inlinePlacementSlotKey(input: {
  shotIndex?: unknown;
  shot_index?: unknown;
  line?: unknown;
} | null | undefined): string {
  const shotIndex = Number(input?.shotIndex ?? input?.shot_index);
  if (Number.isFinite(shotIndex) && shotIndex >= 0) return `s${Math.floor(shotIndex)}`;
  const line = Number(input?.line);
  if (Number.isFinite(line) && line >= 1) return `l${Math.floor(line)}`;
  return 'l0';
}

type MappedChar = { ch: string; htmlIndex: number };

function escapeHtmlAttr(s: string): string {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function decodeHtmlEntity(entity: string): string | null {
  const e = entity.toLowerCase();
  if (e === '&nbsp;') return ' ';
  if (e === '&amp;') return '&';
  if (e === '&lt;') return '<';
  if (e === '&gt;') return '>';
  if (e === '&quot;') return '"';
  if (e === '&#39;' || e === '&apos;') return "'";
  const dec = /^&#(\d+);$/.exec(entity);
  if (dec) {
    const code = Number(dec[1]);
    if (Number.isFinite(code) && code > 0 && code < 0x110000) return String.fromCodePoint(code);
  }
  const hex = /^&#x([0-9a-f]+);$/i.exec(entity);
  if (hex) {
    const code = Number.parseInt(hex[1]!, 16);
    if (Number.isFinite(code) && code > 0 && code < 0x110000) return String.fromCodePoint(code);
  }
  return null;
}

/**
 * Prefer inserting before wrapping open tags so we get
 * `…<div marker/>…<b>line</b>` instead of `…<b><div marker/>…line</b>`.
 * Stops at text, entities, br, or closing tags.
 */
function advanceHtmlIndexPastMappedChar(html: string, htmlIndex: number, ch: string): number {
  const i = Math.max(0, Math.min(html.length, Math.floor(htmlIndex)));
  if (i >= html.length) return html.length;
  if (html[i] === '&') {
    const semi = html.indexOf(';', i);
    return semi > i && semi - i < 16 ? semi + 1 : i + 1;
  }
  const width = ch.length > 0 ? ch.length : 1;
  return Math.min(html.length, i + width);
}

/**
 * After the line text, skip inline closing tags so we get
 * `…<b>line</b><div marker/>` instead of `…<b>line<div marker/></b>`.
 * Stops at text, br, block close (`</p>`), or any non-close tag.
 */
function nudgeInsertAfterCloseTags(html: string, htmlIndex: number): number {
  let i = Math.max(0, Math.min(html.length, Math.floor(htmlIndex)));
  while (i < html.length) {
    let j = i;
    while (j < html.length && /[ \t\r\n]/.test(html[j]!)) j += 1;
    if (j >= html.length || html[j] !== '<') break;
    const close = html.indexOf('>', j);
    if (close < 0) break;
    const tag = html.slice(j, close + 1);
    if (BR_RE.test(tag) || BLOCK_CLOSE_RE.test(tag) || !/^<\/[a-zA-Z][^>]*>$/.test(tag)) break;
    i = close + 1;
  }
  return i;
}

/** Exclusive plain-text end of 1-based line N (trailing spaces dropped). */
export function findPlainLineEndOffset(plain: unknown, line: unknown): number | null {
  const start = findPlainLineStartOffset(plain, line);
  if (start == null) return null;
  const text = String(plain ?? '').replace(/\r\n/g, '\n');
  let i = start;
  while (i < text.length && text[i] !== '\n') i += 1;
  while (i > start && text[i - 1] === ' ') i -= 1;
  return i;
}

function htmlIndexForLineInsert(
  html: string,
  mapped: MappedChar[],
  plain: string,
  line: number,
  side: 'before' | 'after',
): number | null {
  if (side === 'before') {
    const offset = findPlainLineStartOffset(plain, line);
    if (offset == null || offset < 0 || offset >= mapped.length) return null;
    return nudgeInsertBeforeOpenTags(html, mapped[offset]!.htmlIndex);
  }
  const end = findPlainLineEndOffset(plain, line);
  if (end == null) return null;
  let htmlIndex: number;
  if (end < mapped.length) htmlIndex = mapped[end]!.htmlIndex;
  else if (mapped.length) {
    const last = mapped[mapped.length - 1]!;
    htmlIndex = advanceHtmlIndexPastMappedChar(html, last.htmlIndex, last.ch);
  } else {
    htmlIndex = html.length;
  }
  return nudgeInsertAfterCloseTags(html, htmlIndex);
}

function nudgeInsertBeforeOpenTags(html: string, htmlIndex: number): number {
  let i = Math.max(0, Math.min(html.length, Math.floor(htmlIndex)));
  while (i > 0) {
    let j = i;
    while (j > 0 && /[ \t\r\n]/.test(html[j - 1]!)) j -= 1;
    if (j <= 0 || html[j - 1] !== '>') break;
    const open = html.lastIndexOf('<', j - 1);
    if (open < 0 || open >= j - 1) break;
    const tag = html.slice(open, j);
    if (BR_RE.test(tag) || BLOCK_CLOSE_RE.test(tag) || /^<\//.test(tag)) break;
    if (!/^<[a-zA-Z][^>]*>$/.test(tag)) break;
    i = open;
  }
  return i;
}

/**
 * Match vendor `ln`: HTML → plain, while remembering each plain char's splice
 * index in the original HTML (insert *before* that index).
 */
function mapHtmlToPlain(html: string): MappedChar[] {
  const raw: MappedChar[] = [];
  let i = 0;
  const s = String(html || '');
  while (i < s.length) {
    if (s[i] === '<') {
      const close = s.indexOf('>', i);
      if (close < 0) break;
      const tag = s.slice(i, close + 1);
      if (BR_RE.test(tag) || BLOCK_CLOSE_RE.test(tag)) {
        raw.push({ ch: '\n', htmlIndex: i });
      }
      // open block + other tags dropped (same as vendor ln)
      i = close + 1;
      continue;
    }
    if (s[i] === '&') {
      const semi = s.indexOf(';', i);
      if (semi > i && semi - i < 16) {
        const ent = s.slice(i, semi + 1);
        const decoded = decodeHtmlEntity(ent);
        if (decoded != null) {
          for (let k = 0; k < decoded.length; k += 1) {
            raw.push({ ch: decoded[k]!, htmlIndex: i });
          }
          i = semi + 1;
          continue;
        }
      }
    }
    raw.push({ ch: s[i]!, htmlIndex: i });
    i += 1;
  }

  // [^\S\n]+ → single space
  const spaced: MappedChar[] = [];
  for (let j = 0; j < raw.length; j += 1) {
    const c = raw[j]!;
    if (c.ch !== '\n' && /\s/.test(c.ch)) {
      spaced.push({ ch: ' ', htmlIndex: c.htmlIndex });
      while (j + 1 < raw.length && raw[j + 1]!.ch !== '\n' && /\s/.test(raw[j + 1]!.ch)) j += 1;
      continue;
    }
    spaced.push(c);
  }
  // *\n* → \n
  const trimmedNl = spaced.filter((c, j) => {
    if (c.ch !== ' ') return true;
    return spaced[j - 1]?.ch !== '\n' && spaced[j + 1]?.ch !== '\n';
  });
  // \n{2,} → \n
  const collapsed: MappedChar[] = [];
  for (const c of trimmedNl) {
    if (c.ch === '\n' && collapsed.length && collapsed[collapsed.length - 1]!.ch === '\n') continue;
    collapsed.push(c);
  }
  while (collapsed.length && (collapsed[0]!.ch === '\n' || collapsed[0]!.ch === ' ')) collapsed.shift();
  while (
    collapsed.length
    && (collapsed[collapsed.length - 1]!.ch === '\n' || collapsed[collapsed.length - 1]!.ch === ' ')
  ) {
    collapsed.pop();
  }
  return collapsed;
}

/** Vendor `ln` equivalent — plain text used for hashing / line numbers. */
export function htmlToPlainLn(html: unknown): string {
  return mapHtmlToPlain(String(html || '')).map((c) => c.ch).join('');
}

/**
 * Char offset in ln-plain of the first non-whitespace char of 1-based line N
 * (Xt numbering: empty lines skipped). Null if out of range.
 */
export function findPlainLineStartOffset(plain: unknown, line: unknown): number | null {
  const text = String(plain ?? '').replace(/\r\n/g, '\n');
  const want = Math.floor(Number(line));
  if (!Number.isFinite(want) || want < 1) return null;
  let lineNo = 0;
  let i = 0;
  while (i <= text.length) {
    const next = text.indexOf('\n', i);
    const end = next < 0 ? text.length : next;
    const segment = text.slice(i, end);
    if (segment.trim()) {
      lineNo += 1;
      if (lineNo === want) {
        const lead = /^\s*/.exec(segment)?.[0].length || 0;
        return i + lead;
      }
    }
    if (next < 0) break;
    i = next + 1;
  }
  return null;
}

/** Collapse whitespace for line↔element text matching. */
export function normalizeInlineMatchText(text: unknown): string {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Plain line at 1-based `line` plus how many times that same text has appeared
 * in lines[1..line] (1-based occurrence). Duplicates resolve by document order.
 */
export function lineTextOccurrence(
  lines: string[] | null | undefined,
  line1Based: unknown,
): { text: string; occurrence: number } | null {
  const list = Array.isArray(lines) ? lines : [];
  const idx = Math.floor(Number(line1Based)) - 1;
  if (!Number.isFinite(idx) || idx < 0 || idx >= list.length) return null;
  const text = normalizeInlineMatchText(list[idx]);
  if (!text) return null;
  let occurrence = 0;
  for (let i = 0; i <= idx; i += 1) {
    if (normalizeInlineMatchText(list[i]) === text) occurrence += 1;
  }
  return { text, occurrence };
}

/**
 * Split each host element's plain text into line entries (multi-line `<p>` →
 * several rows pointing at the same element index).
 */
export function expandElementLineEntries(
  elementTexts: unknown[] | null | undefined,
): { text: string; elementIndex: number }[] {
  const out: { text: string; elementIndex: number }[] = [];
  const list = Array.isArray(elementTexts) ? elementTexts : [];
  for (let i = 0; i < list.length; i += 1) {
    for (const line of splitMessageLines(list[i])) {
      const text = normalizeInlineMatchText(line);
      if (text) out.push({ text, elementIndex: i });
    }
  }
  return out;
}

/**
 * Map a 1-based message `line` onto a text-bearing element index by matching
 * normalized line text + occurrence order (not unique-string search).
 */
export function findElementIndexForLine(
  elementTexts: unknown[] | null | undefined,
  messageLines: string[] | null | undefined,
  line1Based: unknown,
): number {
  const key = lineTextOccurrence(messageLines, line1Based);
  if (!key) return -1;
  const entries = expandElementLineEntries(elementTexts);
  let seen = 0;
  for (const entry of entries) {
    if (entry.text !== key.text) continue;
    seen += 1;
    if (seen === key.occurrence) return entry.elementIndex;
  }
  return -1;
}

/**
 * If the matched host is a `DIV`, place into the nearest preferred tag (default
 * `P`) by host-list distance. Returns -1 when no preferred neighbour exists
 * (caller should skip — do not inject into the div).
 */
export function preferNearbyHostIndex(
  tagNames: unknown[] | null | undefined,
  matchedIndex: unknown,
  preferTags: string[] | null | undefined = ['P'],
): number {
  const tags = (Array.isArray(tagNames) ? tagNames : []).map((t) => String(t || '').toUpperCase());
  const idx = Math.floor(Number(matchedIndex));
  if (!Number.isFinite(idx) || idx < 0 || idx >= tags.length) return -1;
  const prefer = new Set(
    (Array.isArray(preferTags) && preferTags.length ? preferTags : ['P']).map((t) => String(t || '').toUpperCase()),
  );
  const cur = tags[idx] || '';
  if (cur !== 'DIV') return idx;
  for (let dist = 1; dist < tags.length; dist += 1) {
    const left = idx - dist;
    const right = idx + dist;
    if (left >= 0 && prefer.has(tags[left]!)) return left;
    if (right < tags.length && prefer.has(tags[right]!)) return right;
  }
  return -1;
}

/**
 * Resolve a placeable host index for `line`, then try line+1, line+2, …
 * when text match / nearby-`P` redirect fails (common for awkward line-4 cases).
 */
export function findElementIndexForLineWithFallback(
  elementTexts: unknown[] | null | undefined,
  tagNames: unknown[] | null | undefined,
  messageLines: string[] | null | undefined,
  line1Based: unknown,
  preferTags: string[] | null | undefined = ['P'],
): { elementIndex: number; usedLine: number } | null {
  const lines = Array.isArray(messageLines) ? messageLines : [];
  const start = Math.floor(Number(line1Based));
  if (!Number.isFinite(start) || start < 1 || !lines.length) return null;
  const max = lines.length;
  for (let line = Math.max(1, start); line <= max; line += 1) {
    const matched = findElementIndexForLine(elementTexts, lines, line);
    const idx = preferNearbyHostIndex(tagNames, matched, preferTags);
    if (idx >= 0) return { elementIndex: idx, usedLine: line };
  }
  return null;
}

export function markerBlockHtml(
  p: InlineImagePlacement,
  scalePct: unknown = 100,
  bubbleKey: unknown = '',
  ownerKey: unknown = '',
): string {
  const shot = Number.isFinite(Number(p.shotIndex)) ? String(Math.floor(Number(p.shotIndex))) : '';
  const id = escapeHtmlAttr(String(p.cardId || (p.pending ? `pending-${shot || p.line}` : '') || shot || p.line || '0'));
  const key = escapeHtmlAttr(String(bubbleKey || ''));
  const keyAttr = key ? ` ${INLAY_INLINE_KEY_ATTR}="${key}" x-inlay-inline-key="${key}"` : '';
  const owner = escapeHtmlAttr(String(ownerKey || ''));
  const ownerAttr = owner ? ` x-inlay-inline-owner="${owner}"` : '';
  // Centered block; <br> keeps Risu bubble spacing. Width cap is a bit looser than
  // height so landscape shots don't look tiny next to portrait/1:1 (those still
  // hit max-height first). Mobile narrow bubbles still shrink instead of clipping.
  // scalePct (dashboard) multiplies the 78%/70vh defaults.
  const wrapStyle = inlineChatFrameStyle();
  const imgStyle = inlineChatSpinnerImgStyle(scalePct);
  const size = inlinePlaceholderSize(p);
  const sizeAttr = ` width="${size.width}" height="${size.height}"`;
  const placeholder = inlinePlaceholderSrc(p);
  const slot = escapeHtmlAttr(inlinePlacementSlotKey(p));
  const showPhoto = !p.pending && isReadyImageSrc(p.src);
  const embed = showPhoto ? htmlSafeImageSrc(p.src) : '';
  const pendingAttr = showPhoto ? '' : ' data-inlay-inline-pending="1"';
  const photo = embed
    ? `<img data-inlay-inline-photo="1" src="${escapeHtmlAttr(embed)}" alt="" style="${inlineChatOverlayPhotoStyle()}" loading="eager" decoding="async">`
    : '';
  return (
    `<div ${INLAY_INLINE_ATTR}="${id}" data-inlay-inline-slot="${slot}"${keyAttr}${ownerAttr} data-inlay-inline-layout="${INLINE_FRAME_LAYOUT_VERSION}"${pendingAttr} x-inlay-inline-shot="${id}" x-inlay-inline-slot="${slot}" x-inlay-inline-layout="${INLINE_FRAME_LAYOUT_VERSION}" x-inlay-inline-pending="${showPhoto ? '0' : '1'}" x-inlay-inline-active="${embed ? 'a' : ''}" contenteditable="false" style="${wrapStyle}">`
    + `<br><span data-inlay-inline-stack="1" style="${inlineChatStackStyle(scalePct)}">`
    + `<img data-inlay-inline-spin="1" src="${escapeHtmlAttr(placeholder)}" alt=""${sizeAttr} style="${imgStyle}" loading="eager" decoding="sync">`
    + `<span data-inlay-inline-img="1" x-inlay-inline-cell="1" x-inlay-inline-layer="a" x-inlay-inline-live="${embed ? '1' : '0'}" style="${inlineChatOverlayImgStyle(!!embed)}">${photo}</span>`
    + `<span data-inlay-inline-img="1" x-inlay-inline-cell="1" x-inlay-inline-layer="b" x-inlay-inline-live="0" style="${inlineChatOverlayImgStyle(false)}"></span>`
    + `</span><br>`
    + `</div>`
  );
}

function bodyLooksLikeHtml(body: string): boolean {
  return /<[a-zA-Z][\s\S]*>/.test(body);
}

/**
 * Same splice point as `injectInlineImagesIntoHtml`, but inserts an arbitrary
 * snippet (bake token). HTML keeps formatting; plain text uses ln offsets.
 */
/** Use exactly the same rendered-line model for clamping and insertion. */
export function chatBodyLineCount(body: unknown): number {
  const raw=String(body ?? '');
  const plain=bodyLooksLikeHtml(raw) ? mapHtmlToPlain(stripInlayInlineHtml(raw)).map(c=>c.ch).join('') : raw;
  return Math.max(1,splitMessageLines(plain).length);
}

export function insertSnippetAtShotLine(
  body: unknown,
  line: unknown,
  side: unknown,
  snippet: unknown,
): string {
  const raw = String(body ?? '');
  const token = String(snippet ?? '');
  if (!raw || !token) return raw;
  const textSide = normalizeInlineChatTextSide(side);
  if (bodyLooksLikeHtml(raw)) {
    const cleaned = stripInlayInlineHtml(raw);
    const mapped = mapHtmlToPlain(cleaned);
    const plain = mapped.map((c) => c.ch).join('');
    const clamped = clampShotLine(line, splitMessageLines(plain).length);
    if (!clamped || !mapped.length) return cleaned;
    const htmlIndex = htmlIndexForLineInsert(cleaned, mapped, plain, clamped, textSide);
    if (htmlIndex == null) return cleaned;
    return cleaned.slice(0, htmlIndex) + token + cleaned.slice(htmlIndex);
  }
  const clamped = clampShotLine(line, splitMessageLines(raw).length);
  if (!clamped) return raw;
  if (textSide === 'before') {
    const start = findPlainLineStartOffset(raw, clamped);
    if (start == null) return raw;
    return raw.slice(0, start) + token + '\n' + raw.slice(start);
  }
  const end = findPlainLineEndOffset(raw, clamped);
  if (end == null) return raw;
  return raw.slice(0, end) + '\n' + token + raw.slice(end);
}

/**
 * Raw (1-based) line index of the k-th *content* line. Token-only lines
 * (bake/spinner marks with no prose) are skipped, so a caller that counted
 * lines on stripped text lands on the same line in the raw body. Null when
 * k is out of range.
 */
export function rawLineIndexForStrippedLine(body: unknown, strippedLine: unknown): number | null {
  const k = Math.floor(Number(strippedLine));
  if (!Number.isFinite(k) || k < 1) return null;
  const lines = String(body ?? '').replace(/\r\n/g, '\n').split('\n');
  let seen = 0;
  for (let i = 0; i < lines.length; i += 1) {
    // Same per-line model as splitMessageLines(stripBakeTokens(body)):
    // mid-line tokens are cut but the prose line survives.
    if (stripBakeTokens(lines[i]).trim() === '') continue;
    seen += 1;
    if (seen === k) return i + 1;
  }
  return null;
}

/**
 * Plain-text sibling of insertSnippetAtShotLine addressed by *stripped* line
 * number. Counting on stripped text but inserting into the raw body drifts
 * whenever token-only lines exist, so the stripped number is mapped back to
 * its raw line first. HTML bodies keep the legacy addressing.
 */
export function insertSnippetAtStrippedLine(
  body: unknown,
  strippedLine: unknown,
  side: unknown,
  snippet: unknown,
): string {
  const raw = String(body ?? '');
  const token = String(snippet ?? '');
  if (!raw || !token) return raw;
  if (bodyLooksLikeHtml(raw)) return insertSnippetAtShotLine(body, strippedLine, side, snippet);
  const total = splitMessageLines(stripBakeTokens(raw)).length;
  if (!total) return raw;
  const clamped = Math.max(1, Math.min(total, Math.floor(Number(strippedLine)) || total));
  const rawIndex = rawLineIndexForStrippedLine(raw, clamped);
  if (rawIndex == null) return raw;
  // rawIndex includes blank/token-only rows. Do not feed it back into the
  // content-line helpers, which would skip those rows a second time.
  let start = 0;
  for (let row = 1; row < rawIndex; row++) start = raw.indexOf('\n', start) + 1;
  const newline = raw.indexOf('\n', start);
  let end = newline < 0 ? raw.length : newline;
  if (raw[end - 1] === '\r') end--;
  const textSide = normalizeInlineChatTextSide(side);
  if (textSide === 'before') {
    return raw.slice(0, start) + token + '\n' + raw.slice(start);
  }
  return raw.slice(0, end) + '\n' + token + raw.slice(end);
}

/** Strip existing bake tokens, then place one token per card from last line first. */
export function applyBakeTokensToBody(
  body: unknown,
  placements: Array<{ line?: unknown; cardId?: unknown; assetName?: unknown }> | null | undefined,
  side: unknown,
): string {
  let text = stripBakeTokens(body);
  const list = Array.isArray(placements) ? placements.slice() : [];
  list.sort((a, b) => Math.floor(Number(b?.line)) - Math.floor(Number(a?.line)));
  for (const row of list) {
    const token = bakeTokenForCard(row?.cardId, row?.assetName);
    const line = Math.floor(Number(row?.line));
    if (!token || !Number.isFinite(line) || line < 1) continue;
    text = insertSnippetAtShotLine(text, line, side, token);
  }
  return text;
}

/**
 * Insert illustration markers into existing bubble HTML without rebuilding
 * prose from plain text — tags/formatting stay; plain/`line` is position only.
 */
export function injectInlineImagesIntoHtml(
  html: unknown,
  placements: InlineImagePlacement[] | null | undefined,
  opts?: InlineInjectOptions | null,
): string {
  const cleaned = stripInlayInlineHtml(html);
  const list = Array.isArray(placements) ? placements : [];
  if (!cleaned || !list.length) return cleaned;

  const mapped = mapHtmlToPlain(cleaned);
  const plain = mapped.map((c) => c.ch).join('');
  const lineCount = splitMessageLines(plain).length;
  if (!lineCount || !mapped.length) return cleaned;

  const byLine = new Map<number, InlineImagePlacement>();
  const seenCard = new Set<string>();
  for (const p of list) {
    const line = clampShotLine(p?.line, lineCount);
    const src = String(p?.src || '');
    const cardId = String(p?.cardId || '');
    const pending = p?.pending === true || (!!line && !isReadyImageSrc(src));
    if (!line) continue;
    if (!pending && !isReadyImageSrc(src)) continue;
    if (cardId && seenCard.has(cardId)) continue;
    if (byLine.has(line)) continue;
    if (cardId) seenCard.add(cardId);
    byLine.set(line, { ...p, line, src, pending });
  }
  if (!byLine.size) return cleaned;

  const maxWidthPx = opts?.maxWidthPx;
  void maxWidthPx;
  const scalePct = opts?.scalePct ?? 100;
  const textSide = normalizeInlineChatTextSide(opts?.textSide);
  /** htmlIndex → marker HTML (one shot per line). */
  const atIndex = new Map<number, string>();
  for (const [line, shot] of byLine) {
    const htmlIndex = htmlIndexForLineInsert(cleaned, mapped, plain, line, textSide);
    if (htmlIndex == null) continue;
    if (atIndex.has(htmlIndex)) continue;
    atIndex.set(htmlIndex, markerBlockHtml(shot, scalePct));
  }
  if (!atIndex.size) return cleaned;

  const inserts = [...atIndex.entries()]
    .map(([htmlIndex, html]) => ({ htmlIndex, html }))
    .sort((a, b) => b.htmlIndex - a.htmlIndex);

  let out = cleaned;
  for (const ins of inserts) {
    out = out.slice(0, ins.htmlIndex) + ins.html + out.slice(ins.htmlIndex);
  }
  return out;
}

/**
 * @deprecated Prefer injectInlineImagesIntoHtml — rebuilds from plain and drops formatting.
 * Kept only so older call sites/tests do not break mid-migrate.
 */
export function buildInlineChatHtml(
  plainText: unknown,
  placements: InlineImagePlacement[] | null | undefined,
  opts?: InlineInjectOptions | null,
): string {
  const lines = splitMessageLines(plainText);
  if (!lines.length) return '';
  const escaped = lines.map((line) =>
    String(line)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;'),
  );
  const body = escaped.join('<br>');
  return injectInlineImagesIntoHtml(body, placements, opts);
}

export { syncGenderIntoAppearance } from '../domain/character/tags';
