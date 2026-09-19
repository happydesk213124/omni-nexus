/**
 * Parse NovelAI /user/subscription (+ optional /user/data) into Anlas + extra
 * usage-like fields. I/O stays in the provider; this file is unit-testable.
 */

export interface NaiV5Usage {
  remaining: number;
  max: number;
  pct: number;
  label: string;
}

export interface NaiQuotaParsed {
  fixed: number;
  purchased: number;
  total: number;
  opus: boolean;
  unlimitedImageGeneration?: boolean;
  v5_usage?: NaiV5Usage;
  extra?: Record<string, string | number | boolean>;
}

const USAGE_KEY = /usage|limit|recharge|allowance|quota|generation|remaining|maxpriority|stepsleft/i;
const SKIP_LEAF = /^(fixedTrainingStepsLeft|purchasedTrainingSteps|unlimitedMaxPriority)$/i;

function asRecord(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : null;
}

function toNum(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function walkLeaves(
  raw: unknown,
  prefix: string,
  out: Array<{ path: string; value: string | number | boolean }>,
  depth = 0,
): void {
  if (depth > 6) return;
  const obj = asRecord(raw);
  if (!obj) return;
  for (const [key, val] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      walkLeaves(val, path, out, depth + 1);
      continue;
    }
    if (Array.isArray(val)) {
      if (val.every((x) => typeof x === 'number' || typeof x === 'string')) {
        const joined = val.slice(0, 6).map(String).join(', ');
        if (USAGE_KEY.test(key) || USAGE_KEY.test(path)) out.push({ path, value: joined });
      }
      continue;
    }
    if (typeof val === 'number' || typeof val === 'boolean' || typeof val === 'string') {
      if (SKIP_LEAF.test(key)) continue;
      if (USAGE_KEY.test(key) || USAGE_KEY.test(path)) out.push({ path, value: val });
    }
  }
}

function usagePercentFromRecord(raw: unknown): number | null {
  const rec = asRecord(raw);
  if (!rec) return null;
  return toNum(asRecord(rec.usage)?.percent);
}

function readUsagePercent(
  sub: Record<string, unknown>,
  accountData: unknown,
  extra: Record<string, string | number | boolean>,
): number | null {
  const nested = usagePercentFromRecord(accountData)
    ?? usagePercentFromRecord(asRecord(accountData)?.data)
    ?? usagePercentFromRecord(sub);
  if (nested != null) return nested;
  for (const [key, val] of Object.entries(extra)) {
    if (/(^|\.)usage\.percent$/i.test(key) && typeof val === 'number') return val;
  }
  return null;
}

function omitUsagePercent(
  extra: Record<string, string | number | boolean>,
): Record<string, string | number | boolean> {
  const next: Record<string, string | number | boolean> = {};
  for (const [key, val] of Object.entries(extra)) {
    if (/(^|\.)usage\.percent$/i.test(key)) continue;
    next[key] = val;
  }
  return next;
}

function pickV5Usage(extra: Record<string, string | number | boolean>): NaiV5Usage | undefined {
  const remainingKeys = Object.keys(extra).filter((k) =>
    /remaining|left|current|available|charge/i.test(k) && typeof extra[k] === 'number',
  );
  const maxKeys = Object.keys(extra).filter((k) =>
    /(?:^|\.)(?:max|limit|capacity|total|full)\b/i.test(k) && typeof extra[k] === 'number',
  );
  const remaining = remainingKeys.length ? Number(extra[remainingKeys[0]]) : null;
  const max = maxKeys.length ? Number(extra[maxKeys[0]]) : null;
  if (remaining == null || max == null || max <= 0) return undefined;
  const pct = Math.max(0, Math.min(100, Math.round((remaining / max) * 100)));
  return {
    remaining,
    max,
    pct,
    label: `${remaining} / ${max}`,
  };
}

/** Decode a Risu/nativeFetch body that may already be an object, string, or UTF-8 bytes. */
export function parseJsonBody(raw: unknown): unknown {
  if (raw && typeof raw === 'object' && !Array.isArray(raw) && !(raw instanceof ArrayBuffer) && !(raw instanceof Uint8Array)) {
    const rec = raw as Record<string, unknown>;
    if ('data' in rec && rec.data != null && typeof rec.json !== 'function') {
      return parseJsonBody(rec.data);
    }
    return raw;
  }
  if (typeof raw === 'string') {
    const text = raw.trim();
    if (!text) return null;
    return JSON.parse(text);
  }
  if (raw instanceof Uint8Array) {
    return parseJsonBody(new TextDecoder().decode(raw));
  }
  if (raw instanceof ArrayBuffer) {
    return parseJsonBody(new TextDecoder().decode(new Uint8Array(raw)));
  }
  return null;
}

export function parseNaiQuota(subscription: unknown, accountData?: unknown): NaiQuotaParsed {
  const sub = asRecord(subscription) || {};
  const steps = asRecord(sub.trainingStepsLeft) || {};
  const perks = asRecord(sub.perks) || {};
  const fixed = toNum(steps.fixedTrainingStepsLeft) ?? 0;
  const purchased = toNum(steps.purchasedTrainingSteps) ?? 0;
  const opus = perks.unlimitedMaxPriority === true;
  const unlimitedImageGeneration = perks.unlimitedImageGeneration === true ? true : undefined;

  const extraRows: Array<{ path: string; value: string | number | boolean }> = [];
  walkLeaves(sub, '', extraRows);
  if (accountData) walkLeaves(accountData, 'data', extraRows);

  const extra: Record<string, string | number | boolean> = {};
  for (const row of extraRows) {
    if (extra[row.path] == null) extra[row.path] = row.value;
  }

  const dataRec = asRecord(accountData);
  const priority = asRecord(dataRec?.priority) || dataRec;
  const priorityLeft = toNum(priority?.maxPriorityActions);
  const priorityCap = toNum(perks.maxPriorityActions);
  let v5_usage = pickV5Usage(extra);
  if (!v5_usage && priorityLeft != null && priorityCap != null && priorityCap > 0) {
    const pct = Math.max(0, Math.min(100, Math.round((priorityLeft / priorityCap) * 100)));
    v5_usage = {
      remaining: priorityLeft,
      max: priorityCap,
      pct,
      label: `${priorityLeft} / ${priorityCap}`,
    };
  }
  const usagePercent = readUsagePercent(sub, accountData, extra);
  if (usagePercent != null) {
    v5_usage = {
      remaining: v5_usage?.remaining ?? usagePercent,
      max: v5_usage?.max ?? 100,
      pct: usagePercent,
      label: `${usagePercent}%`,
    };
  }
  const extraOut = omitUsagePercent(extra);
  const out: NaiQuotaParsed = {
    fixed,
    purchased,
    total: fixed + purchased,
    opus,
  };
  if (unlimitedImageGeneration) out.unlimitedImageGeneration = true;
  if (v5_usage) out.v5_usage = v5_usage;
  if (Object.keys(extraOut).length) out.extra = extraOut;
  return out;
}
