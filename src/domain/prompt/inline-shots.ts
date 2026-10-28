import type { TaggerResult } from '../../core/types';
import { parseJsonLoose } from '../../core/util/object';
import { analysisBody } from './message-body';
import { INLINE_SHOT_CLOSED_SOURCE as CLOSED_SOURCE, INLINE_SHOT_MASK_SOURCE, INLINE_WAIT_BLOCK_SOURCE } from './inline-shot-pattern';

export { INLINE_SHOT_MASK_SOURCE };

/**
 * Streaming tag generation: the chat model writes each shot where its image
 * belongs, `[[inxN]]{one shot as JSON}[[/inxN]]`, so no separate tagger call is
 * needed. The block's position is the image position; it never becomes an L line.
 */
// A safety stop for a model that runs away with blocks. Users who illustrate long replies
// heavily reached 20, and every block past it stayed pink for a tap of its own.
export const INLINE_SHOT_MAX_BLOCKS = 100;

export interface InlineShotBlock { n: number; start: number; end: number; body: string }

const THOUGHT_TAG = /<(\/)?(thoughts|think)\b[^>]*>/gi;
/**
 * Reasoning spans (`<Thoughts>`, `<think>`). A shot the model drafts while it
 * thinks is not in the story. `live`: the reply is still streaming, so an open
 * span counts too (it may close later). A finished reply that never closed its
 * tag keeps the analysis rule: only paired spans are reasoning.
 */
export function thoughtRanges(raw: unknown, live = false): Array<[number, number]> {
  const text = String(raw ?? ''), ranges: Array<[number, number]> = [], open: Array<{ name: string; at: number }> = [];
  for (const tag of text.matchAll(THOUGHT_TAG)) {
    const name = tag[2]!.toLowerCase();
    if (!tag[1]) { open.push({ name, at: tag.index! }); continue; }
    for (let i = open.length - 1; i >= 0; i--) {
      if (open[i]!.name !== name) continue;
      ranges.push([open[i]!.at, tag.index! + tag[0].length]);
      open.splice(i);
      break;
    }
  }
  if (live) for (const row of open) ranges.push([row.at, text.length]);
  return ranges;
}

export function inlineShotBlocks(raw: unknown, opts: { live?: boolean } = {}): InlineShotBlock[] {
  const text = String(raw ?? '');
  const found: InlineShotBlock[] = [], seen = new Set<number>();
  const thinking = thoughtRanges(text, opts.live === true);
  for (const hit of text.matchAll(new RegExp(CLOSED_SOURCE, 'g'))) {
    // Before numbering: a draft in the thoughts must not take a story block's number.
    if (thinking.some(([from, to]) => hit.index! >= from && hit.index! < to)) continue;
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
/**
 * Something to draw: people, or a description beyond the framing. A block like
 * {"aspect":"portrait"} or {"x":1} parses, but would send an empty prompt; it is
 * treated as broken so it gets repaired or a pink slot instead of a junk image.
 */
const FRAMING = new Set(['aspect', 'camera', 'kind', 'shot_index', 'width', 'height']);
function drawable(shot: Record<string, unknown>): boolean {
  if (Array.isArray(shot.characters)) return true;
  return Object.entries(shot).some(([key, value]) => !FRAMING.has(key) &&
    (typeof value === 'string' ? !!value.trim() : Array.isArray(value) ? value.length > 0 : false));
}

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
    if (!scene || !shot || !drawable(shot)) return null;
    return { ...extras(parsed), scenes: [{ place: String(scene.place ?? ''), shots: [{ ...shot, line, paragraph: 0 }] }] } as TaggerResult;
  }
  const { place, new_characters: _n, new_costumes: _c, scenes: _s, line: _l, paragraph: _p, ...shot } = parsed;
  if (!Object.keys(shot).length || !drawable(shot)) return null;
  return { ...extras(parsed), scenes: [{ place: String(place ?? ''), shots: [{ ...shot, line, paragraph: 0 }] }] } as TaggerResult;
}

/** The block's own line, with the line break that held it, becomes `replacement`. */
export function replaceInlineShotBlock(raw: unknown, n: number, replacement: string): string {
  const text = String(raw ?? '');
  const block = inlineShotBlocks(text).find(row => row.n === n);
  if (!block) return text;
  return text.slice(0, block.start) + replacement + text.slice(block.end);
}

/**
 * A block with no image yet, written back after a failed or cancelled run: the
 * same `[[inxN]]{json}[[/inxN]]` it was. Blocks are no longer renamed to `inxw`
 * once a reply ends — that extra chat write could land late or not at all in
 * Risu — so a block that has no image is itself the pink slot.
 */
export function waitingInlineBlock(n: number, body: string): string {
  return `[[inx${n}]]${body}[[/inx${n}]]`;
}
/** The slot of block n in a message: an older `inxw` block first, else the `inx` block itself. */
export function waitingBlock(raw: unknown, n: number): { text: string; body: string; start: number } | null {
  const text = String(raw ?? '');
  for (const hit of text.matchAll(new RegExp(INLINE_WAIT_BLOCK_SOURCE, 'g'))) if (Number(hit[1]) === n) return { text: hit[0], body: hit[2] ?? '', start: hit.index ?? 0 };
  const block = inlineShotBlocks(text).find(row => row.n === n);
  return block ? { text: text.slice(block.start, block.end), body: block.body, start: block.start } : null;
}
/** Only a block still open at the end (the reply stopped inside it): closed blocks are slots and stay. */
export function stripOpenInlineShotBlock(raw: unknown): string {
  const text = String(raw ?? ''), closed = inlineShotBlocks(text);
  const tail = closed.length ? closed[closed.length - 1]!.end : 0;
  const open = /\[\[inx\d{1,3}\]\]/.exec(text.slice(tail));
  return open ? text.slice(0, tail + open.index).replace(/[ \t]*\n?$/, '').replace(/\n{3,}/g, '\n\n') : text;
}
/** Removes every block (and a still-open one at the end), keeping the prose as written. */
export function stripInlineShotBlocks(raw: unknown): string {
  return String(raw ?? '')
    .replace(new RegExp(`(?:${INLINE_SHOT_MASK_SOURCE})[ \\t]*\\n?`, 'g'), '')
    .replace(/\n{3,}/g, '\n\n');
}
