import type { TtsSegment } from '../../core/tts-types';
import { expressionOfTone } from '../emotion/emotions';
import { INLINE_CAST_MASK_SOURCE } from '../prompt/inline-shot-pattern';

/**
 * 옴니 뷰어: a reply read as visual-novel scenes, from its source text (never the
 * chat's DOM). A line or narration is a scene; an image the reply holds is a CG
 * scene at its own position, and the background from then on.
 */
export type ViewerCg =
  | { kind: 'baked'; card: string; asset: string }
  | { kind: 'slot'; n: number }
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
  cg?: ViewerCg;
}

const BAKED = /\[\[@inray::([^:\[\]]{1,256})::(inxshot_[^:\[\]]{1,2048})(?:::[0-9]{1,6}::[0-9]{1,6})?(?:_[rs][0-9]{1,9})?(?:_pin)?\]\]/g;
const SLOT = /\[\[inx(\d{1,3})\]\]/g;
const WAIT = /\[\[@inraywait::([a-zA-Z0-9_-]{1,64})::/g;

/** Images in a reply, by position. A streaming block is its slot until its image is baked. */
export function replyImages(raw: string): Array<{ at: number; cg: ViewerCg }> {
  const out: Array<{ at: number; cg: ViewerCg }> = [];
  for (const m of raw.matchAll(BAKED)) out.push({ at: m.index!, cg: { kind: 'baked', card: m[1]!, asset: m[2]! } });
  for (const m of raw.matchAll(SLOT)) out.push({ at: m.index!, cg: { kind: 'slot', n: Number(m[1]) } });
  for (const m of raw.matchAll(WAIT)) out.push({ at: m.index!, cg: { kind: 'wait', id: m[1]! } });
  return out.sort((a, b) => a.at - b.at);
}

/**
 * Scenes in reading order. `segments` are the reply's TTS segments (the same
 * splitter the voice uses), so a scene and its voice are always the same line.
 * Sound cues (BGM, effects) are not scenes.
 */
export function buildScenes(raw: string, segments: readonly TtsSegment[], words: Readonly<Record<string, string>> = {}): ViewerScene[] {
  const faces = new Map<string, string>(), out: ViewerScene[] = [];
  const images = replyImages(raw);
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
    // Sound cues are no scene; the clock line shows in the top bar instead.
    if (s.kind === 'illustration' || (s.kind === 'narration' && clockOf(s.text))) continue;
    const line = s.kind === 'dialogue' && !!s.speaker;
    let face: string | null = null;
    if (line) {
      face = expressionOfTone(s.tone, words) ?? faces.get(s.speaker) ?? null;
      if (face) faces.set(s.speaker, face);
    }
    out.push({ id: `l:${s.id}`, kind: line ? 'line' : 'narration', speaker: line ? s.speaker : '', face, text: s.text, start: s.start, end: s.end, segmentId: s.id });
  }
  flushImages(Infinity);
  return out;
}

/**
 * The story's clock line (`[3월 2일 ◆ 오후 4시 ◆ 카페]`, `📅 Day 3 | 08:10 | 교실`):
 * the first short bracketed or separated line with a date or a time in it, its
 * parts joined with ` · `. '' when the reply has none.
 */
const TIME_WORD = /\d{1,2}\s*[:시]\s*\d{0,2}|\d{1,2}\s*월|\d{1,2}\s*일|\d{4}\s*년|오전|오후|아침|점심|저녁|밤|새벽|\bday\s*\d+|\b(?:am|pm)\b|\d{1,2}:\d{2}|월요일|화요일|수요일|목요일|금요일|토요일|일요일/i;
export function clockOf(rawLine: string): string {
  const line = rawLine.replace(/<[^>]*>/g, '').trim();
  if (!line || line.length > 120 || /^["“'‘「『]/.test(line)) return '';
  const inner = line.replace(/^[\s*_`>#\-]*[\[【(〔「]?/, '').replace(/[\]】)〕」]?[\s*_`]*$/, '');
  const parts = inner.split(/\s*[◆◇|｜/·•∙]\s*/).map(p => p.replace(/^[^\p{L}\p{N}]+/u, '').trim()).filter(Boolean);
  return parts.length >= 2 && TIME_WORD.test(inner) ? parts.slice(0, 5).join(' · ').slice(0, 80) : '';
}
export function storyClock(raw: string): string {
  for (const line of raw.split('\n').slice(0, 40)) { const clock = clockOf(line); if (clock) return clock; }
  return '';
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
