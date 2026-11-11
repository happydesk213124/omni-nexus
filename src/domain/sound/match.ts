import type { SfxTerm, SoundItem } from '../../core/sound-types';
import { BGM_MOOD_TAGS, normalizeSoundTag } from './tags';

/** Shared vocabulary tags between what a reply asks for and what an item carries. */
export function tagScore(wanted: readonly string[], item: Pick<SoundItem, 'tags' | 'name'>): number {
  const have = new Set([...item.tags, item.name].map(normalizeSoundTag).filter(Boolean));
  return [...new Set(wanted.map(normalizeSoundTag))].filter(tag => have.has(tag)).length;
}

export interface BgmPick { key: string; score: number; reason: 'keep' | 'switch' | 'none' }
/** How many of the best-ranked tracks a new song is drawn from: the same scene need not always get the same one. */
export const BGM_DRAW = 3;
/** One of the best-ranked keys (best first): the current track when it ranks first, else a draw among the top `BGM_DRAW`. */
export function drawBgm(ranked: readonly string[], currentKey = '', random: () => number = Math.random): string {
  if (!ranked.length) return '';
  if (ranked[0] === currentKey) return currentKey;
  const top = ranked.slice(0, BGM_DRAW);
  return top[Math.min(top.length - 1, Math.floor(random() * top.length))]!;
}
/** How many tracks a cue's music is picked among. */
export const BGM_POOL = 10;
/** Scene scores (cosine) this close to the best are as good as it: the song is drawn among them. */
export const BGM_NEAR = 0.03;
/** What a track one tag short of the best gives away in its scene score. */
export const BGM_TAG_STEP = 0.03;
export interface BgmCandidate { item: SoundItem; score: number }
export interface BgmPool { best: number; rows: BgmCandidate[] }
/** `count` of the list, each as likely as another; all of it, in its order, when it has no more. */
function sample<T>(list: readonly T[], count: number, random: () => number): T[] {
  if (list.length <= count) return [...list];
  const rest = [...list], out: T[] = [];
  while (out.length < count) out.push(rest.splice(Math.min(rest.length - 1, Math.floor(random() * rest.length)), 1)[0]!);
  return out;
}
/**
 * The tracks a cue's tags leave to pick among, ten at most: every one that shares the most tags, then the ones a
 * single tag short. With thirty tags and a few hundred tracks a dozen share the most, and the first three of the
 * list once took every cue; past ten they are drawn, so each is as likely as another.
 * A track a tag short joins only when all three tags met somewhere (it still shares two) and it has every mood the
 * cue asks for: `romantic, night, slow` never brings a `scary, night, slow`.
 */
export function bgmPool(wanted: readonly string[], items: readonly SoundItem[], random: () => number = Math.random, limit = BGM_POOL): BgmPool {
  const scored = items.map(item => ({ item, score: tagScore(wanted, item) })).filter(row => row.score > 0);
  const best = scored.reduce((most, row) => Math.max(most, row.score), 0);
  if (!best) return { best: 0, rows: [] };
  const top = scored.filter(row => row.score === best);
  if (top.length >= limit || best < 3) return { best, rows: sample(top, limit, random) };
  const moods = [...new Set(wanted.map(normalizeSoundTag))].filter(tag => BGM_MOOD_TAGS.has(tag));
  const near = scored.filter(row => row.score === best - 1 && moods.every(mood => row.item.tags.some(tag => normalizeSoundTag(tag) === mood)));
  return { best, rows: [...top, ...sample(near, limit - top.length, random)] };
}
/** One of the pool by its tags alone: each as likely as another. */
export function drawBgmFromPool(pool: BgmPool, random: () => number = Math.random): string {
  const rows = pool.rows;
  return rows.length ? rows[Math.min(rows.length - 1, Math.floor(random() * rows.length))]!.item.key : '';
}
/**
 * One of the pool by the scene: `scenes[i]` is how near the scene lies to the pool's i-th track (cosine). A track a
 * tag short gives away BGM_TAG_STEP; the song is drawn among those within BGM_NEAR of the best, so the scene decides
 * and the same scene still need not always get the same song.
 */
export function drawBgmByScene(pool: BgmPool, scenes: readonly number[], random: () => number = Math.random): string {
  const rows = pool.rows.map((row, i) => ({ key: row.item.key, score: (Number(scenes[i]) || 0) - (pool.best - row.score) * BGM_TAG_STEP }));
  const best = rows.reduce((most, row) => Math.max(most, row.score), -Infinity);
  const near = rows.filter(row => row.score >= best - BGM_NEAR);
  return near.length ? near[Math.min(near.length - 1, Math.floor(random() * near.length))]!.key : '';
}
/**
 * Picks the BGM for a reply's tags. The current track stays unless another one
 * shares strictly more tags — a scene does not need a new song every reply. A new
 * one is drawn from the pool (bgmPool).
 */
export function pickBgm(wanted: readonly string[], items: readonly SoundItem[], currentKey = '', random: () => number = Math.random): BgmPick {
  const pool = bgmPool(wanted, items, random), current = items.find(item => item.key === currentKey);
  if (!pool.rows.length) return { key: currentKey, score: 0, reason: currentKey ? 'keep' : 'none' };
  const held = current ? tagScore(wanted, current) : 0;
  if (current && held >= pool.best) return { key: current.key, score: held, reason: 'keep' };
  const key = drawBgmFromPool(pool, random), chosen = pool.rows.find(row => row.item.key === key)!;
  return { key, score: chosen.score, reason: key === currentKey ? 'keep' : 'switch' };
}
/** Several equally good tracks: the matcher hands only these to embedding/JEV. */
export function bgmCandidates(wanted: readonly string[], items: readonly SoundItem[], limit = 5): SoundItem[] {
  return items.map(item => ({ item, score: tagScore(wanted, item) })).filter(row => row.score > 0)
    .sort((a, b) => b.score - a.score).slice(0, limit).map(row => row.item);
}

const termKey = (text: string) => String(text || '').normalize('NFKC').toLowerCase().replace(/[\s~!?.,·…─—\-]+/g, '');
/**
 * The effect a whole word names exactly (a glossary term, an effect's name or
 * tag, spelled the same up to spacing and marks). A compound like `문 쾅` that is
 * itself an effect's name stays one effect instead of being split.
 */
export function exactSfx(word: string, glossary: readonly SfxTerm[], items: readonly SoundItem[]): SoundItem | null {
  const needle = termKey(word);
  if (!needle) return null;
  const byKey = new Map(items.map(item => [item.key, item]));
  for (const row of glossary) if (row.enabled && row.terms.some(term => termKey(term) === needle)) { const item = byKey.get(row.sfxKey); if (item) return item; }
  return items.find(item => [item.name, ...item.tags].some(term => termKey(term) === needle)) || null;
}
/**
 * The effect the glossary gives a word: a row whose word the word contains
 * (`덜컹! 덜컹!` holds 덜컹). The glossary is what the user and JEV settled, so
 * it decides before anything is asked.
 */
export function glossarySfx(word: string, glossary: readonly SfxTerm[], items: readonly SoundItem[]): SoundItem | null {
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
  return null;
}
/**
 * A free guess from the effects' own names and tags containing the word: the
 * last resort, after JEV and embedding (or the only one with neither set up).
 * A one-letter name (쾅) only matches itself; inside a longer word it would match far too much.
 */
export function guessSfx(word: string, items: readonly SoundItem[]): SoundItem | null {
  const needle = termKey(word);
  if (!needle) return null;
  return items.find(item => [item.name, ...item.tags].some(term => { const key = termKey(term); return !!key && (key === needle || (key.length >= 2 && needle.includes(key))); })) || null;
}
/** The glossary, then the free guess: what a word plays with nothing asked (the rule preview). */
export function pickSfx(word: string, glossary: readonly SfxTerm[], items: readonly SoundItem[]): SoundItem | null {
  return glossarySfx(word, glossary, items) || guessSfx(word, items);
}
