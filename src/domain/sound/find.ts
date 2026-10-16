import type { SfxTerm, SoundItem } from '../../core/sound-types';

/** `|` = any of, `&` = all of — the voice list's search rules, over name, tags, folder and link. */
export function matchesSoundSearch(item: SoundItem, query: string): boolean {
  const hay = [item.name, ...item.tags, item.folder || '', item.url || ''].join(' ').normalize('NFKC').toLowerCase();
  const groups = query.normalize('NFKC').toLowerCase().split('|').map(g => g.split('&').map(s => s.trim()).filter(Boolean)).filter(g => g.length);
  return !groups.length || groups.some(group => group.every(term => hay.includes(term)));
}

const termKey = (text: string) => String(text || '').normalize('NFKC').toLowerCase().replace(/[\s~!?.,·…─—\-]+/g, '');
/** 뚜벅뚜벅 → 뚜벅, 쾅쾅 → 쾅: a doubled sound is compared once. */
const half = (text: string) => { const n = text.length; return n >= 2 && n % 2 === 0 && text.slice(0, n / 2) === text.slice(n / 2) ? text.slice(0, n / 2) : text; };
function distance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j]! + 1, next[j - 1]! + 1, row[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length]!;
}

/**
 * How alike two spellings of a sound are, by edit distance over jamo. NFD splits
 * each syllable into jamo, so 콰광 and 콰앙 differ in two jamo rather than in one
 * whole syllable, and 철컥 and 철컹 in one. Order counts: 뚜벅뚜벅 shares most
 * letters with 북적 but sounds nothing like it. Free and local, a first guess
 * the user confirms; the matchers still decide at play time.
 */
export function soundWordSimilarity(a: string, b: string): number {
  const x = half(termKey(a)), y = half(termKey(b));
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.length >= 2 && y.length >= 2 && (x.includes(y) || y.includes(x))) return 0.8;
  const p = x.normalize('NFD'), q = y.normalize('NFD');
  return 1 - distance(p, q) / Math.max(p.length, q.length);
}

/** Up to `limit` effects a word probably means, best first: by their names, tags and glossary words. */
export function suggestSfx(word: string, glossary: readonly SfxTerm[], items: readonly SoundItem[], limit = 3, minScore = 0.45): SoundItem[] {
  const words = new Map<string, string[]>();
  for (const row of glossary) words.set(row.sfxKey, [...(words.get(row.sfxKey) || []), ...row.terms]);
  return items
    .map(item => ({ item, score: Math.max(0, ...[item.name, ...item.tags, ...(words.get(item.key) || [])].map(term => soundWordSimilarity(word, term))) }))
    .filter(row => row.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(row => row.item);
}
