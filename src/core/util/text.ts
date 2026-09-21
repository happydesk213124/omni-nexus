/** Text, tag and alias normalisation. Pure — no I/O, no globals. */

/**
 * Canonical text cleanup applied at nearly every boundary.
 * Collapses horizontal whitespace, caps runs of blank lines at 3, drops NULs.
 */
export function cleanText(value: unknown, limit = 200000): string {
  if (value == null) return '';
  let text = String(value).replace(/\x00/g, ' ').replace(/\r\n/g, '\n');
  text = text.replace(/[ \t\f\v]+/g, ' ').replace(/\n{4,}/g, '\n\n\n').trim();
  return text.slice(0, limit);
}

export function toInt(value: unknown, defaultVal = -1): number {
  if (value == null || (typeof value === 'string' && !value.trim())) return defaultVal;
  const n = parseInt(String(value), 10);
  return Number.isNaN(n) ? defaultVal : n;
}

export function toOptionalFloat(value: unknown): number | null {
  if (value == null || (typeof value === 'string' && !value.trim())) return null;
  const n = parseFloat(String(value));
  return Number.isNaN(n) ? null : n;
}

/**
 * Split a tag string on commas, but keep NovelAI `weight::...::` groups intact
 * so `5::1girl, 1boy::` stays one token (not `5::1girl` + `1boy::`).
 */
export function splitTagTokens(text: unknown): string[] {
  const raw = cleanText(text);
  if (!raw) return [];
  const tokens: string[] = [];
  // Commas inside emphasis groups are not boundaries between independent tags.
  const closing: Record<string, string> = { '{': '}', '[': ']', '(': ')' };
  const stack: string[] = [];
  let weighted = false;
  let start = 0;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '\\') { i++; continue; }
    if (weighted) {
      if (raw.slice(i, i + 2) === '::') { weighted = false; i++; }
      continue;
    }
    const weight = /^-?\d+(?:\.\d+)?::/.exec(raw.slice(i));
    if (weight) { weighted = true; i += weight[0].length - 1; continue; }
    const char = raw[i]!;
    if (closing[char]) stack.push(closing[char]!);
    else if (stack.at(-1) === char) stack.pop();
    else if (char === ',' && !stack.length) {
      const token = raw.slice(start, i).trim(); if (token) tokens.push(token);
      start = i + 1;
    }
  }
  const last = raw.slice(start).trim(); if (last) tokens.push(last);
  return tokens;
}

/** Merges comma-separated tag strings, dropping duplicates case-insensitively. */
export function joinTags(...parts: unknown[]): string {
  const items: string[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    for (const token of splitTagTokens(part)) {
      const t = token.trim();
      if (!t) continue;
      const key = t.toLowerCase();
      // LLMs emit these as "no value"; they are never real tags.
      if (key === 'null' || key === 'none') continue;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(t);
    }
  }
  return items.join(', ');
}

export const normalizeAlias = (value: unknown): string =>
  cleanText(value, 200).toLowerCase().replace(/\s+/g, ' ');

/** Whitespace-free lowercase form, for matching across CJK/Latin spacing differences. */
export const compactText = (text: unknown): string =>
  cleanText(text).toLowerCase().replace(/\s+/g, '');

export function parseAliasList(value: unknown): string[] {
  if (value == null) return [];
  let raw: string[];
  if (Array.isArray(value)) {
    raw = value.map((v) => cleanText(v, 200));
  } else {
    const text = cleanText(value, 2000);
    raw = text ? text.split(/[,|/]|,(?=\s)|、|\//) : [];
    // A single-token result usually means the author used newlines instead.
    if (raw.length <= 1 && text) raw = text.split(/\n+/);
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const cleaned = cleanText(item, 200);
    if (!cleaned) continue;
    const key = normalizeAlias(cleaned);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
  }
  return out;
}

/**
 * Rejects alias fragments too short to match safely.
 * Two-letter Latin words produce constant false positives in prose, so Latin
 * needs 3+ characters while CJK needs only 2.
 */
export function aliasTokenOk(token: unknown, allowShort = false): boolean {
  const t = cleanText(token, 200);
  if (!t) return false;
  const compact = compactText(t);
  if (!compact) return false;
  if (!allowShort && compact.length < 2) return false;
  if (/^[a-zA-Z]+$/.test(t) && t.length < 3) return false;
  return true;
}

/**
 * Expands names into every fragment worth matching: the whole name, each word,
 * and adjacent word pairs for 3+ word names.
 */
export function expandAliasParts(...values: unknown[]): string[] {
  const seeds: string[] = [];
  for (const v of values) seeds.push(...parseAliasList(v));

  const out: string[] = [];
  const seen = new Set<string>();
  const add = (item: unknown, allowShort = false): void => {
    const cleaned = cleanText(item, 200);
    if (!aliasTokenOk(cleaned, allowShort)) return;
    const key = normalizeAlias(cleaned);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(cleaned);
  };

  for (const seed of seeds) {
    add(seed, true);
    const parts = seed.split(/[\s\-·•･]+/).filter(Boolean);
    // A one-word seed may be short; fragments of a longer name may not.
    for (const part of parts) add(part, parts.length === 1);
    if (parts.length >= 3) {
      for (let i = 0; i < parts.length - 1; i += 1) add(`${parts[i]} ${parts[i + 1]}`);
    }
  }
  return out;
}

export function hashCode(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i += 1) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  return h;
}

/**
 * FNV-style 64-bit-ish fingerprint. Must stay byte-identical to the UI bundle's
 * `ye()` — session ids are computed on both sides and compared.
 */
export function sessionIdHash(raw: unknown): string {
  const n = cleanText(raw, 1e6);
  let o = 2166136261;
  let a = 2654435769;
  for (let r = 0; r < n.length; r += 1) {
    const i = n.charCodeAt(r);
    o ^= i;
    o = Math.imul(o, 16777619);
    a ^= i + ((o << 6) | (o >>> 26));
    a = Math.imul(a, 2246822507);
  }
  return `${(o >>> 0).toString(16).padStart(8, '0')}${(a >>> 0).toString(16).padStart(8, '0')}`;
}

export function unifiedSessionIdForCharacter(characterId: unknown): string {
  const id = cleanText(characterId ?? '', 200);
  return id ? `risu_${sessionIdHash(`${id}|__unified__`)}` : '';
}

/** Card / roster / job / note writes go to the character unified id when we have one. */
export function writeSessionId(args: {
  sessionId?: unknown;
  characterId?: unknown;
  unifiedSessionId?: unknown;
} = {}): string {
  const unified = cleanText(args.unifiedSessionId, 200)
    || unifiedSessionIdForCharacter(args.characterId);
  return unified || cleanText(args.sessionId, 200);
}

/** Strips Risu CBS template syntax so tag text never leaks `{{...}}` into prompts. */
export function stripCbs(text: string): string {
  let out = text;
  // Nested blocks need repeated passes; 20 is far beyond any real nesting depth.
  for (let i = 0; i < 20; i += 1) {
    const next = out
      .replace(/\{\{#when[\s\S]*?\}\}([\s\S]*?)\{\{\/when\}\}/g, '$1')
      .replace(/\{\{#if[\s\S]*?\}\}([\s\S]*?)\{\{\/if\}\}/g, '$1')
      .replace(/\{\{:else\}\}[\s\S]*?(?=\{\{\/)/g, '');
    if (next === out) break;
    out = next;
  }
  return out.replace(/\{\{[^}]+\}\}/g, '').trim();
}

/** Splits a `[Positive] … [Negative] …` preset body. */
export function extractPreset(content: string): [string, string] {
  const positive = content.match(/\[Positive\]\s*([\s\S]*?)\s*\[Negative\]/);
  const negative = content.match(/\[Negative\]\s*([\s\S]*?)\s*$/);
  if (positive || negative) return [cleanText(positive?.[1] ?? ''), cleanText(negative?.[1] ?? '')];
  return [cleanText(content), ''];
}

export function uuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** Persist enough of the message body to re-link by prefix after streaming edits. */
export const ASSISTANT_PREVIEW_LIMIT = 4000;
