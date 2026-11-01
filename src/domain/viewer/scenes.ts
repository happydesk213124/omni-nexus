import type { TtsSegment } from '../../core/tts-types';
import { expressionOfTone } from '../emotion/emotions';
import { INLINE_CAST_MASK_SOURCE } from '../prompt/inline-shot-pattern';
import { imageHistoryRoot } from '../gallery/image-history';
import { clockLines, clockOf } from './clock';

export { clockLines, clockOf, lastClock, storyClock, type ClockMark } from './clock';

/**
 * 옴니 뷰어: a reply read as visual-novel scenes, from its source text (never the
 * chat's DOM). A line or narration is a scene; an image the reply holds is a CG
 * scene at its own position, and the background from then on.
 */
export type ViewerCg =
  | { kind: 'baked'; card: string; asset: string }
  | { kind: 'slot'; n: number }
  /** A spinner a batch of lines is drawn in (`jobId_shot`), until its image is baked. */
  | { kind: 'spin'; id: string }
  | { kind: 'wait'; id: string };
export interface ViewerScene {
  id: string;
  kind: 'line' | 'narration' | 'cg';
  speaker: string;
  /** The face for this line: its own `(tone)`, else the speaker's last one. Null for narration and CGs. */
  face: string | null;
  text: string;
  start: number;
  end: number;
  /** The segment this scene voices (TTS), when it is one. */
  segmentId?: string;
  /** The costume its cue names (`이름_2`); absent, the default one. */
  costume?: number;
  cg?: ViewerCg;
}

const BAKED = /\[\[@inray::([^:\[\]]{1,256})::(inxshot_[^:\[\]]{1,2048})(?:::[0-9]{1,6}::[0-9]{1,6})?(?:_[rs][0-9]{1,9})?(?:_pin)?\]\]/g;
const SLOT = /\[\[inx(\d{1,3})\]\]/g;
const WAIT = /\[\[@inraywait::([a-zA-Z0-9_-]{1,64})::/g;
const SPIN = /\[\[@inrayspinner::([^:\[\]]{1,200})::/g;

/**
 * Images in a reply, by position. A streaming block is its slot until its image is baked.
 * A picture redrawn keeps its earlier draws beside it (`card`, `card_r1`, … the newest
 * last): the chat draws only the last of such a run, and so is it one scene here, not
 * one per draw (each a picture never shown, and one more in the count). So is a line
 * batch's picture that kept its spinner as its frame, the image right after it.
 */
export function replyImages(raw: string): Array<{ at: number; cg: ViewerCg }> {
  const out: Array<{ at: number; cg: ViewerCg }> = [];
  const baked = [...raw.matchAll(BAKED)], bakedAt = new Set(baked.map(m => m.index!));
  // Where the text goes on past the white space from `from`: only white space may stand between the two.
  const space = /\s*/y, solidFrom = (from: number): number => { space.lastIndex = from; space.exec(raw); return space.lastIndex; };
  baked.forEach((m, i) => {
    const next = baked[i + 1];
    if (next && next.index === solidFrom(m.index! + m[0].length) && imageHistoryRoot(next[1]!) === imageHistoryRoot(m[1]!)) return;
    out.push({ at: m.index!, cg: { kind: 'baked', card: m[1]!, asset: m[2]! } });
  });
  for (const m of raw.matchAll(SLOT)) out.push({ at: m.index!, cg: { kind: 'slot', n: Number(m[1]) } });
  for (const m of raw.matchAll(WAIT)) out.push({ at: m.index!, cg: { kind: 'wait', id: m[1]! } });
  for (const m of raw.matchAll(SPIN)) {
    const end = raw.indexOf(']]', m.index!);
    if (end >= 0 && bakedAt.has(solidFrom(end + 2))) continue;
    out.push({ at: m.index!, cg: { kind: 'spin', id: m[1]! } });
  }
  return out.sort((a, b) => a.at - b.at);
}

/**
 * Scenes in reading order. `segments` are the reply's TTS segments (the same
 * splitter the voice uses), so a scene and its voice are always the same line.
 * Sound cues (BGM, effects) are not scenes.
 */
export function buildScenes(raw: string, segments: readonly TtsSegment[], words: Readonly<Record<string, string>> = {}): ViewerScene[] {
  const faces = new Map<string, string>(), out: ViewerScene[] = [];
  const images = replyImages(raw), clocks = clockLines(raw);
  let next = 0;
  const flushImages = (before: number) => {
    while (next < images.length && images[next]!.at < before) {
      const { at, cg } = images[next++]!;
      out.push({ id: `cg:${at}`, kind: 'cg', speaker: '', face: null, text: '', start: at, end: at, cg });
    }
  };
  for (const s of segments) {
    if (s.kind !== 'dialogue' && s.kind !== 'narration' && s.kind !== 'illustration') continue;
    flushImages(s.start);
    // Sound cues are no scene; the clock line shows in the top bar instead (found by line, once a reply).
    if (s.kind === 'illustration' || (s.kind === 'narration' && clocks.some(c => s.start >= c.start && s.end <= c.end))) continue;
    const line = s.kind === 'dialogue' && !!s.speaker;
    let face: string | null = null;
    if (line) {
      face = expressionOfTone(s.tone, words) ?? faces.get(s.speaker) ?? null;
      if (face) faces.set(s.speaker, face);
    }
    out.push({ id: `l:${s.id}`, kind: line ? 'line' : 'narration', speaker: line ? s.speaker : '', face, text: s.text, start: s.start, end: s.end, segmentId: s.id, ...(line && s.costume ? { costume: s.costume } : {}) });
  }
  flushImages(Infinity);
  return out;
}

const CAST_BLOCK = new RegExp(INLINE_CAST_MASK_SOURCE, 'g');
/**
 * A reply's first readable line, for its tile in the message list: markup, tags,
 * the cast block and the story clock left out. A bulleted "Label: value" line is
 * a status panel's field, never the story (the chat usually hides those).
 */
export function replyGist(raw: string, max = 44): string {
  const text = raw.replace(CAST_BLOCK, ' ').replace(/\[\[[^\]]*\]\]/g, ' ').replace(/<(style|script)\b[\s\S]*?<\/\1\s*>/gi, ' ').replace(/<[^>]*>/g, ' ').replace(/\{\{[\s\S]*?\}\}/g, ' ');
  for (const rawLine of text.split('\n').slice(0, 80)) {
    const line = rawLine.replace(/[*_`#>~]+/g, '').replace(/\s+/g, ' ').trim();
    if (!line || clockOf(line) || /^[-=─—]{3,}$/.test(line) || /^[-•·]\s*[^:：\n]{1,40}[:：]/.test(line)) continue;
    return line.length > max ? `${line.slice(0, max - 1)}…` : line;
  }
  return '';
}
