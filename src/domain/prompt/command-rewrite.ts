/**
 * Pure helpers for shot-tag "명령 수정" — merge LLM rewrite output into the
 * form fields the UI shows (textareas only; no image generation here).
 */

import { cleanText, joinTags, splitTagTokens } from '../../core/util/text.ts';
import { recoverSceneFromMain } from './reroll-setup.ts';

export type TagDelta = {
  add?: unknown;
  remove?: unknown;
};

function deltaTokenList(value: unknown): string[] {
  if (value == null) return [];
  if (Array.isArray(value)) return splitTagTokens(value.map((v) => cleanText(v, 800)).join(', '));
  return splitTagTokens(value);
}

function isDeltaObject(value: unknown): value is TagDelta {
  return !!value && typeof value === 'object' && !Array.isArray(value) && ('add' in value || 'remove' in value);
}

/** Token-wise remove (case-insensitive), then joinTags-add. Protected tokens stay. */
export function applyTagDelta(
  current: unknown,
  delta: TagDelta | null | undefined,
  opts: { protect?: readonly string[] } = {},
): string {
  const protect = new Set(
    (opts.protect || []).flatMap((p) => splitTagTokens(p).map((t) => t.toLowerCase())),
  );
  const remove = new Set(deltaTokenList(delta?.remove).map((t) => t.toLowerCase()));
  const kept = splitTagTokens(current).filter((t) => {
    const key = t.toLowerCase();
    if (protect.has(key)) return true;
    return !remove.has(key);
  });
  return joinTags(...kept, ...deltaTokenList(delta?.add));
}

export function commandRewriteHasDeltas(parsed: unknown): boolean {
  if (!parsed || typeof parsed !== 'object') return false;
  const rec = parsed as Record<string, unknown>;
  if (isDeltaObject(rec.main) || isDeltaObject(rec.negative)) return true;
  const chars = rec.characters;
  if (!Array.isArray(chars)) return false;
  return chars.some((ch) => {
    if (!ch || typeof ch !== 'object') return false;
    const row = ch as Record<string, unknown>;
    return isDeltaObject(row.prompt) || isDeltaObject(row.uc);
  });
}

export function mergeCommandRewriteDeltas(args: {
  currentMain: string;
  currentNeg: string;
  currentChars: CommandRewriteCharIn[];
  lookLocked: boolean[];
  parsed: Record<string, unknown>;
  protectMain?: readonly string[];
}): { main_prompt: string; negative_prompt: string; characters: CommandRewriteCharOut[] } {
  const parsed = args.parsed || {};
  const main_prompt = isDeltaObject(parsed.main)
    ? applyTagDelta(args.currentMain, parsed.main, { protect: args.protectMain })
    : cleanText(args.currentMain, 8000);
  const negative_prompt = isDeltaObject(parsed.negative)
    ? applyTagDelta(args.currentNeg, parsed.negative)
    : cleanText(args.currentNeg, 8000);
  const llmList = Array.isArray(parsed.characters) ? parsed.characters : [];
  const byIndex = new Map<number, Record<string, unknown>>();
  for (const raw of llmList) {
    if (!raw || typeof raw !== 'object') continue;
    const idx = Math.floor(Number((raw as { index?: unknown }).index));
    if (!Number.isFinite(idx) || idx < 0) continue;
    byIndex.set(idx, raw as Record<string, unknown>);
  }
  const characters = args.currentChars.map((ch, i) => {
    const llm = byIndex.get(i);
    const locked = args.lookLocked[i] === true;
    const prevPrompt = cleanText(ch.prompt, 4000);
    let prompt = prevPrompt;
    if (isDeltaObject(llm?.prompt)) {
      prompt = applyTagDelta(prevPrompt, locked ? { add: llm.prompt.add } : llm.prompt);
    }
    let uc = cleanText(ch.uc, 2000);
    if (isDeltaObject(llm?.uc)) uc = applyTagDelta(uc, llm.uc);
    const nameRaw = llm && typeof llm.name === 'string' ? llm.name : ch.name;
    return {
      name: cleanText(nameRaw, 200),
      prompt: prompt || 'girl',
      action: cleanText(ch.action, 800),
      uc,
      center_x: Number(ch.center_x ?? 0.5),
      center_y: Number(ch.center_y ?? 0.5),
    };
  });
  return { main_prompt, negative_prompt, characters };
}

export type CommandRewriteCharIn = {
  name?: unknown;
  prompt?: unknown;
  action?: unknown;
  uc?: unknown;
  center_x?: unknown;
  center_y?: unknown;
};

export type CommandRewriteLlmChar = {
  index?: unknown;
  name?: unknown;
  prompt?: unknown;
  action?: unknown;
  uc?: unknown;
};

export type CommandRewriteCharOut = {
  name: string;
  prompt: string;
  action: string;
  uc: string;
  center_x: number;
  center_y: number;
};

/**
 * Look-locked: keep prior caption tags; append LLM action (expression/pose).
 * Unlocked: prefer LLM full prompt, else prior + action.
 */
export function mergeLookLockedCaption(
  previousPrompt: unknown,
  llmPrompt: unknown,
  llmAction: unknown,
  lookLocked: boolean,
): string {
  const prev = cleanText(previousPrompt, 4000);
  const action = cleanText(llmAction, 800);
  if (lookLocked) return joinTags(prev, action) || prev;
  const next = cleanText(llmPrompt, 4000);
  if (next) return joinTags(next, action) || next;
  return joinTags(prev, action) || prev;
}

export function mergeCommandRewriteCharacters(
  current: CommandRewriteCharIn[],
  llmChars: CommandRewriteLlmChar[] | unknown,
  lookLocked: boolean[],
): CommandRewriteCharOut[] {
  const llmList = Array.isArray(llmChars) ? llmChars : [];
  const byIndex = new Map<number, CommandRewriteLlmChar>();
  for (const raw of llmList) {
    if (!raw || typeof raw !== 'object') continue;
    const idx = Math.floor(Number((raw as CommandRewriteLlmChar).index));
    if (!Number.isFinite(idx) || idx < 0) continue;
    byIndex.set(idx, raw as CommandRewriteLlmChar);
  }

  return current.map((ch, i) => {
    const llm = byIndex.get(i);
    const locked = lookLocked[i] === true;
    const prevPrompt = cleanText(ch.prompt, 4000);
    const prompt = mergeLookLockedCaption(prevPrompt, llm?.prompt, llm?.action, locked);
    return {
      name: cleanText(llm?.name ?? ch.name, 200),
      prompt: prompt || 'girl',
      action: cleanText(llm?.action ?? ch.action, 800),
      uc: cleanText(llm?.uc ?? ch.uc, 2000),
      center_x: Number(ch.center_x ?? 0.5),
      center_y: Number(ch.center_y ?? 0.5),
    };
  });
}

/**
 * Prefer an explicit LLM `main_prompt`. Else splice `setup` into the form main:
 * with a selected style positive, rebuild as style+setup (UI re-applies person);
 * otherwise replace the recovered scene chunk inside the current main.
 */
export function mergeCommandRewriteMain(args: {
  currentMain: string;
  setup?: unknown;
  mainPrompt?: unknown;
  stylePositive?: unknown;
  person?: unknown;
  stylePositives?: readonly string[];
  qualitySuffixes?: readonly string[];
}): string {
  const explicit = cleanText(args.mainPrompt, 8000);
  if (explicit) return explicit;
  const setup = cleanText(args.setup, 8000);
  if (!setup) return cleanText(args.currentMain, 8000);
  const style = cleanText(args.stylePositive, 8000);
  if (style) return joinTags(style, setup);
  const scene = recoverSceneFromMain(
    args.currentMain,
    cleanText(args.person || ''),
    args.stylePositives || [],
    args.qualitySuffixes || [],
  );
  const cur = cleanText(args.currentMain, 8000);
  if (scene && cur.includes(scene)) return cleanText(cur.replace(scene, setup), 8000);
  return setup;
}

/** Fixed seed for generation when > 0; otherwise 0 (caller randomises). */
export function resolveGenerationSeed(planSeed: unknown, naiSeed: unknown = 0): number {
  const plan = Number(planSeed);
  if (Number.isFinite(plan) && plan > 0) return Math.floor(plan);
  const nai = Number(naiSeed ?? 0);
  if (Number.isFinite(nai) && nai > 0) return Math.floor(nai);
  return 0;
}
