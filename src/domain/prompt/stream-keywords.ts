/**
 * Dashboard stream-keyword box: comma-separated needles, min 3 chars.
 * Matching is case-insensitive substring against accumulated script output.
 */

const MIN_KEYWORD_CHARS = 3;

/** Trim, split on commas, drop short/duplicate (casefold) needles. */
export function parseStreamKeywords(raw: unknown): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of String(raw ?? '').split(',')) {
    const token = part.trim();
    if (token.length < MIN_KEYWORD_CHARS) continue;
    const fold = token.toLowerCase();
    if (seen.has(fold)) continue;
    seen.add(fold);
    out.push(token);
  }
  return out;
}

/** True if any parsed keyword is a substring of haystack (case-insensitive). */
export function haystackHasStreamKeyword(haystack: unknown, keywords: readonly string[]): boolean {
  if (!keywords.length) return false;
  const h = String(haystack ?? '').toLowerCase();
  if (!h) return false;
  for (const k of keywords) {
    if (k.length < MIN_KEYWORD_CHARS) continue;
    if (h.includes(k.toLowerCase())) return true;
  }
  return false;
}
