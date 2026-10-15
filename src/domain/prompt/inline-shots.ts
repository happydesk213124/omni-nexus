import type { TaggerResult } from '../../core/types';
import { parseJsonLoose } from '../../core/util/object';
import { analysisBody } from './message-body';
import { INLINE_SHOT_CLOSED_SOURCE as CLOSED_SOURCE, INLINE_SHOT_MASK_SOURCE } from './inline-shot-pattern';

export { INLINE_SHOT_MASK_SOURCE };

/**
 * Streaming tag generation: the chat model writes each shot where its image
 * belongs, `[[inxN]]{one shot as JSON}[[/inxN]]`, so no separate tagger call is
 * needed. The block's position is the image position; it never becomes an L line.
 */
export const INLINE_SHOT_MAX_BLOCKS = 20;

export interface InlineShotBlock { n: number; start: number; end: number; body: string }

export function inlineShotBlocks(raw: unknown): InlineShotBlock[] {
  const text = String(raw ?? '');
  const found: InlineShotBlock[] = [], seen = new Set<number>();
  for (const hit of text.matchAll(new RegExp(CLOSED_SOURCE, 'g'))) {
    const n = Number(hit[1]);
    // A repeated number is the model restarting its count; the first one owns it.
    if (!n || seen.has(n)) continue;
    seen.add(n);
    found.push({ n, start: hit.index!, end: hit.index! + hit[0].length, body: hit[2]! });
    if (found.length >= INLINE_SHOT_MAX_BLOCKS) break;
  }
  return found;
}

/** Analysis lines before the block: the image follows the line it illustrates. */
export function inlineShotLine(raw: unknown, block: Pick<InlineShotBlock, 'start'>): number {
  return analysisBody(String(raw ?? '').slice(0, block.start)).split('\n').filter(Boolean).length;
}

const shotObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/**
 * One block as a tagger result with exactly one shot. The model may write the
 * compact form (shot fields with `place` and `new_characters` beside them) or
 * the tagger's own `{scenes:[{place,shots:[…]}]}` shape.
 */
export function inlineShotTagged(body: unknown, line: number): TaggerResult | null {
  let parsed: unknown;
  try { parsed = parseJsonLoose(String(body ?? '').trim()); } catch { return null; }
  if (!shotObject(parsed)) return null;
  const extras = (row: Record<string, unknown>) => ({
    new_characters: Array.isArray(row.new_characters) ? row.new_characters as TaggerResult['new_characters'] : [],
    ...(Array.isArray(row.new_costumes) ? { new_costumes: row.new_costumes as TaggerResult['new_costumes'] } : {}),
  });
  if (Array.isArray(parsed.scenes)) {
    const scene = (parsed.scenes as unknown[]).find(row => shotObject(row) && Array.isArray(row.shots) && row.shots.some(shotObject)) as Record<string, unknown> | undefined;
    const shot = (scene?.shots as unknown[] | undefined)?.find(shotObject);
    if (!scene || !shot) return null;
    return { ...extras(parsed), scenes: [{ place: String(scene.place ?? ''), shots: [{ ...shot, line, paragraph: 0 }] }] } as TaggerResult;
  }
  const { place, new_characters: _n, new_costumes: _c, scenes: _s, line: _l, paragraph: _p, ...shot } = parsed;
  if (!Object.keys(shot).length) return null;
  return { ...extras(parsed), scenes: [{ place: String(place ?? ''), shots: [{ ...shot, line, paragraph: 0 }] }] } as TaggerResult;
}

/** The block's own line, with the line break that held it, becomes `replacement`. */
export function replaceInlineShotBlock(raw: unknown, n: number, replacement: string): string {
  const text = String(raw ?? '');
  const block = inlineShotBlocks(text).find(row => row.n === n);
  if (!block) return text;
  return text.slice(0, block.start) + replacement + text.slice(block.end);
}

/** Removes every block (and a still-open one at the end), keeping the prose as written. */
export function stripInlineShotBlocks(raw: unknown): string {
  return String(raw ?? '')
    .replace(new RegExp(`(?:${INLINE_SHOT_MASK_SOURCE})[ \\t]*\\n?`, 'g'), '')
    .replace(/\n{3,}/g, '\n\n');
}
