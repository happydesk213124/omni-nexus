/**
 * V5 treats `comic` / `manga` as a scanned page on white paper.
 * `4koma` / `2koma` in UC fights `Nkoma` in the positive.
 */
import { cleanText, joinTags, splitTagTokens } from '../../core/util/text.ts';

const BANNED_POS = new Set([
  'comic',
  'manga',
  'hatching',
  'hatching (texture)',
  'hatching(texture)',
  'thick outlines',
  'thick outline',
]);

const BANNED_UC = new Set(['4koma', '2koma', '3koma']);

function tokenKey(token: string): string {
  return token.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function filterTokens(text: unknown, banned: Set<string>): string {
  const kept: string[] = [];
  for (const token of splitTagTokens(cleanText(text, 8000))) {
    const t = token.trim();
    if (!t) continue;
    if (banned.has(tokenKey(t))) continue;
    kept.push(t);
  }
  return joinTags(...kept);
}

export function stripComicPageStyleTags(positive: unknown): string {
  return filterTokens(positive, BANNED_POS);
}

export function stripComicKomaFromUc(negative: unknown): string {
  return filterTokens(negative, BANNED_UC);
}

/** Drop banned words even inside a layout sentence (not just comma tags). */
export function stripComicStyleWords(text: unknown): string {
  return cleanText(text, 4000)
    .replace(/\b(comic|manga|hatching)\b/gi, '')
    .replace(/\bthick\s+outlines?\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+,/g, ',')
    .replace(/^,\s*|,\s*$/g, '')
    .trim();
}
