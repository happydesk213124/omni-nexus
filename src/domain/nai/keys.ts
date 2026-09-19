/** Collect / mask NovelAI API tokens. Mutex lanes key off the raw token string. */
import type { NaiSettings } from '../../core/types.ts';
import { cleanText } from '../../core/util/text.ts';
import type { NaiFamily } from './routing.ts';

export function normalizeTokenList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    const t = cleanText(item, 4000);
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

export function maskNaiToken(token: string): string {
  const t = cleanText(token, 4000);
  if (!t) return '';
  return t.slice(-4);
}

/**
 * encode-vibe is a V4-family NovelAI call. Uses `tokensForFamily(v4)`:
 * V4 list, then the other family's list, then legacy `api_key`.
 */
export function vibeEncodeToken(nai: NaiSettings): string {
  return tokensForFamily(nai, 'v4')[0] || '';
}

/** Own list, then the other family's list, then legacy `api_key`. */
export function tokensForFamily(nai: NaiSettings, family: NaiFamily): string[] {
  const own = family === 'v5' ? nai.api_keys_v5 : nai.api_keys_v4;
  const other = family === 'v5' ? nai.api_keys_v4 : nai.api_keys_v5;
  const listed = normalizeTokenList(own);
  if (listed.length) return listed;
  const borrowed = normalizeTokenList(other);
  if (borrowed.length) return borrowed;
  const legacy = cleanText(nai.api_key, 4000);
  return legacy ? [legacy] : [];
}

/** Unique tokens that can run in parallel (union of both tabs + legacy). */
export function allUniqueNaiTokens(nai: NaiSettings): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of [
    ...normalizeTokenList(nai.api_keys_v5),
    ...normalizeTokenList(nai.api_keys_v4),
    cleanText(nai.api_key, 4000),
  ]) {
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

export function naiHasAnyToken(nai: NaiSettings): boolean {
  return allUniqueNaiTokens(nai).length > 0;
}

/** Same token on V5 and V4 → one quota fetch, family label `v5/v4`. */
export function quotaTokenGroups(nai: NaiSettings): Array<{
  token: string;
  families: NaiFamily[];
  suffix: string;
}> {
  const order: Array<{ token: string; families: NaiFamily[]; suffix: string }> = [];
  const index = new Map<string, { token: string; families: NaiFamily[]; suffix: string }>();
  for (const family of ['v5', 'v4'] as const) {
    for (const token of tokensForFamily(nai, family)) {
      const existing = index.get(token);
      if (existing) {
        if (!existing.families.includes(family)) existing.families.push(family);
        continue;
      }
      const row = { token, families: [family] as NaiFamily[], suffix: maskNaiToken(token) };
      index.set(token, row);
      order.push(row);
    }
  }
  return order;
}

export interface KeyQuotaRow {
  family: NaiFamily;
  suffix: string;
  configured: boolean;
}

export function publicKeyRows(nai: NaiSettings): { v5: KeyQuotaRow[]; v4: KeyQuotaRow[] } {
  const toRows = (family: NaiFamily): KeyQuotaRow[] =>
    // Registration describes this tab, not credentials borrowed during generation.
    normalizeTokenList(family === 'v5' ? nai.api_keys_v5 : nai.api_keys_v4).map((t) => ({
      family,
      suffix: maskNaiToken(t),
      configured: true,
    }));
  return { v5: toRows('v5'), v4: toRows('v4') };
}
