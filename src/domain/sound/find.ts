import type { SfxTerm, SoundItem } from '../../core/sound-types';

/** `|` = any of, `&` = all of — the voice list's search rules, over name, tags, folder and link. */
export function matchesSoundSearch(item: SoundItem, query: string): boolean {
  const hay = [item.name, ...item.tags, item.folder || '', item.url || ''].join(' ').normalize('NFKC').toLowerCase();
  const groups = query.normalize('NFKC').toLowerCase().split('|').map(g => g.split('&').map(s => s.trim()).filter(Boolean)).filter(g => g.length);
  return !groups.length || groups.some(group => group.every(term => hay.includes(term)));
}

const termKey = (text: string) => String(text || '').normalize('NFKC').toLowerCase().replace(/[\s~!?.,·…─—\-]+/g, '');
const pairs = (text: string) => { const out = new Set<string>(); for (let i = 0; i + 1 < text.length; i++) out.add(text.slice(i, i + 2)); return out; };

/**
 * How alike two spellings of a sound are: shared jamo and jamo pairs. NFD splits
 * a syllable into jamo, so 콰광 and 콰앙 share ㅋㅘ and ㅘㅇ though no syllable,
 * and 뚜벅뚜벅 is near 저벅저벅. Free and local, for a first guess the user
 * confirms; the matchers still decide at play time.
 */
export function soundWordSimilarity(a: string, b: string): number {
  const x = termKey(a), y = termKey(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.length >= 2 && y.length >= 2 && (x.includes(y) || y.includes(x))) return 0.8;
  const jamo = (s: string) => s.normalize('NFD'), letters = (s: string) => new Set([...jamo(s)]);
  const jaccard = (p: Set<string>, q: Set<string>) => { const all = new Set([...p, ...q]); return all.size ? [...p].filter(v => q.has(v)).length / all.size : 0; };
  return Math.max(jaccard(letters(x), letters(y)) * 0.75, jaccard(pairs(jamo(x)), pairs(jamo(y))));
}

/** Up to `limit` effects a word probably means, best first: by their names, tags and glossary words. */
export function suggestSfx(word: string, glossary: readonly SfxTerm[], items: readonly SoundItem[], limit = 3, minScore = 0.34): SoundItem[] {
  const words = new Map<string, string[]>();
  for (const row of glossary) words.set(row.sfxKey, [...(words.get(row.sfxKey) || []), ...row.terms]);
  return items
    .map(item => ({ item, score: Math.max(0, ...[item.name, ...item.tags, ...(words.get(item.key) || [])].map(term => soundWordSimilarity(word, term))) }))
    .filter(row => row.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(row => row.item);
}
