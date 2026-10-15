import type { SfxTerm, SoundItem } from '../../core/sound-types';
import { normalizeSoundTag } from './tags';

/** Shared vocabulary tags between what a reply asks for and what an item carries. */
export function tagScore(wanted: readonly string[], item: Pick<SoundItem, 'tags' | 'name'>): number {
  const have = new Set([...item.tags, item.name].map(normalizeSoundTag).filter(Boolean));
  return [...new Set(wanted.map(normalizeSoundTag))].filter(tag => have.has(tag)).length;
}

export interface BgmPick { key: string; score: number; reason: 'keep' | 'switch' | 'none' }
/**
 * Picks the BGM for a reply's tags. The current track stays unless another one
 * shares strictly more tags — a scene does not need a new song every reply.
 */
export function pickBgm(wanted: readonly string[], items: readonly SoundItem[], currentKey = ''): BgmPick {
  const scored = items.map(item => ({ item, score: tagScore(wanted, item) })).filter(row => row.score > 0);
  const current = scored.find(row => row.item.key === currentKey);
  const best = scored.sort((a, b) => b.score - a.score)[0];
  if (!best) return { key: currentKey, score: 0, reason: currentKey ? 'keep' : 'none' };
  if (current && current.score >= best.score) return { key: current.item.key, score: current.score, reason: 'keep' };
  return { key: best.item.key, score: best.score, reason: best.item.key === currentKey ? 'keep' : 'switch' };
}
/** Several equally good tracks: the matcher hands only these to embedding/JEV. */
export function bgmCandidates(wanted: readonly string[], items: readonly SoundItem[], limit = 5): SoundItem[] {
  return items.map(item => ({ item, score: tagScore(wanted, item) })).filter(row => row.score > 0)
    .sort((a, b) => b.score - a.score).slice(0, limit).map(row => row.item);
}

const termKey = (text: string) => String(text || '').normalize('NFKC').toLowerCase().replace(/[\s~!?.,·…─—\-]+/g, '');
/**
 * The sound effect for an effect word (`덜컹! 덜컹!`). The glossary decides
 * first; otherwise an effect's own name or tags may contain the word.
 */
export function pickSfx(word: string, glossary: readonly SfxTerm[], items: readonly SoundItem[]): SoundItem | null {
  const needle = termKey(word);
  if (!needle) return null;
  const byKey = new Map(items.map(item => [item.key, item]));
  for (const row of glossary) {
    if (!row.enabled) continue;
    if (row.terms.some(term => { const key = termKey(term); return key && needle.includes(key); })) {
      const item = byKey.get(row.sfxKey);
      if (item) return item;
    }
  }
  return items.find(item => [item.name, ...item.tags].some(term => { const key = termKey(term); return key.length >= 2 && needle.includes(key); })) || null;
}
