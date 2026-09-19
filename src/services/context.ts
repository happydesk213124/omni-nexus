/**
 * Shared application state.
 *
 * 1.x kept all of this on a single 92-method `InlayNexus` instance, so every
 * feature could reach every other feature's internals and nothing could be
 * tested in isolation. The state itself is genuinely process-wide though — one
 * settings object, one job registry — so it lives here as an explicit module
 * with narrow accessors, and services import only the pieces they need.
 *
 * Nothing in this module may import a service, which keeps the dependency graph
 * pointing one way: services -> context -> storage -> core.
 */

import { DEFAULT_CONFIG } from '../config/defaults';
import { normalizeCharRefScope } from '../core/constants';
import type { Settings } from '../core/types';
import { Mutex } from '../core/util/async';
import { deepcopy } from '../core/util/object';

// ── settings ───────────────────────────────────────────────────────────────

let config: Settings = deepcopy(DEFAULT_CONFIG);

/**
 * Live settings. Callers read freely but must never mutate the result; use
 * `updateConfig` so persistence and derived caches stay consistent.
 */
export function getConfig(): Settings {
  return config;
}

export function setConfig(next: Settings): void {
  config = next;
}

/**
 * Serialises read-modify-write cycles on settings. Two concurrent updates
 * without this would each merge onto their own snapshot and the later write
 * would silently discard the earlier one.
 */
export const configLock = new Mutex();

// ── job bookkeeping ────────────────────────────────────────────────────────

export interface JobEpoch {
  epoch: number;
  jobId: string;
}

export interface JobRunMeta {
  key: string;
  epoch: number;
  cancelRequested: boolean;
  /**
   * User soft-stop: keep already-published cards; do not abort in-flight LLM/NAI.
   * Distinct from supersession (which discards publishedIds).
   */
  userStop?: boolean;
  publishedIds: string[];
  /**
   * Hash written onto new cards. May diverge from the lock `key` hash when the
   * user re-selects the finished streaming message (Dice≥60% gate).
   */
  saveContentHash: string;
  saveAssistantPreview: string;
  /** Assistant text captured at job start — soft-match gate for retarget. */
  sourcePreview: string;
  sessionId: string;
  characterId: string;
  chatId: string;
  messageIndex: number;
  messageRole: string;
}

/**
 * Per-target generation epoch. A "target" is a message slot; starting a new job
 * for a slot bumps its epoch, which is how a superseded run detects that its
 * results are no longer wanted and must not be published.
 */
export const jobEpochByKey = new Map<string, JobEpoch>();

export const jobRunMeta = new Map<string, JobRunMeta>();

/** Message-level reroll lock. Distinct from jobs: no epoch, no shots. */
export const messageBusyKeys = new Set<string>();

/**
 * Soft-stop for message reroll batches (`rerollMessageCards`) and UI live loops.
 * Set by `/v1/jobs/stop`; cleared when a new message reroll batch starts.
 */
let messageRerollStopRequested = false;

export function requestMessageRerollStop(): void {
  messageRerollStopRequested = true;
}

export function clearMessageRerollStop(): void {
  messageRerollStopRequested = false;
}

export function isMessageRerollStopRequested(): boolean {
  return messageRerollStopRequested;
}

// ── preview data URLs for the two singleton reference images ────────────────

let refPreviewUrl = '';
let vibePreviewUrl = '';
/** Per-style-preset vibe preview data URLs (device-local uploads). */
const presetVibePreviewUrls = new Map<string, string>();
/** Per-style-preset look-shot preview data URLs (module webp). */
const presetLookPreviewUrls = new Map<string, string>();
/** Per-character reference image preview data URLs. */
const charRefPreviewUrls = new Map<string, string>();

export function getRefPreviewUrl(): string {
  return refPreviewUrl;
}

export function setRefPreviewUrl(url: string): void {
  refPreviewUrl = url;
}

export function getVibePreviewUrl(): string {
  return vibePreviewUrl;
}

export function setVibePreviewUrl(url: string): void {
  vibePreviewUrl = url;
}

export function getPresetVibePreviewUrl(presetId: string): string {
  return presetVibePreviewUrls.get(String(presetId || '')) || '';
}

export function setPresetVibePreviewUrl(presetId: string, url: string): void {
  const id = String(presetId || '');
  if (!id) return;
  if (url) presetVibePreviewUrls.set(id, url);
  else presetVibePreviewUrls.delete(id);
}

export function clearAllPresetVibePreviewUrls(): void {
  presetVibePreviewUrls.clear();
}

export function getPresetLookPreviewUrl(presetId: string): string {
  return presetLookPreviewUrls.get(String(presetId || '')) || '';
}

export function setPresetLookPreviewUrl(presetId: string, url: string): void {
  const id = String(presetId || '');
  if (!id) return;
  if (url) presetLookPreviewUrls.set(id, url);
  else presetLookPreviewUrls.delete(id);
}

export function clearAllPresetLookPreviewUrls(): void {
  presetLookPreviewUrls.clear();
}

function charRefPreviewMapKey(scope: unknown, characterId: string): string {
  return `${normalizeCharRefScope(scope)}\0${String(characterId || '')}`;
}

export function getCharRefPreviewUrl(scope: unknown, characterId: string): string {
  const id = String(characterId || '');
  if (!id) return '';
  return charRefPreviewUrls.get(charRefPreviewMapKey(scope, id)) || '';
}

export function setCharRefPreviewUrl(scope: unknown, characterId: string, url: string): void {
  const id = String(characterId || '');
  if (!id) return;
  const key = charRefPreviewMapKey(scope, id);
  if (url) charRefPreviewUrls.set(key, url);
  else charRefPreviewUrls.delete(key);
}

export function clearAllCharRefPreviewUrls(): void {
  charRefPreviewUrls.clear();
}

const examplePreviewUrls = new Map<string, string>();

export function getExamplePreviewUrl(scope: unknown, characterId: string): string {
  const id = String(characterId || '');
  if (!id) return '';
  return examplePreviewUrls.get(charRefPreviewMapKey(scope, id)) || '';
}

export function setExamplePreviewUrl(scope: unknown, characterId: string, url: string): void {
  const id = String(characterId || '');
  if (!id) return;
  const key = charRefPreviewMapKey(scope, id);
  if (url) examplePreviewUrls.set(key, url);
  else examplePreviewUrls.delete(key);
}

/** Test seam: returns the module to its post-import state. */
export function resetContext(): void {
  config = deepcopy(DEFAULT_CONFIG);
  jobEpochByKey.clear();
  jobRunMeta.clear();
  messageBusyKeys.clear();
  messageRerollStopRequested = false;
  refPreviewUrl = '';
  vibePreviewUrl = '';
  presetVibePreviewUrls.clear();
  presetLookPreviewUrls.clear();
  charRefPreviewUrls.clear();
  examplePreviewUrls.clear();
}
