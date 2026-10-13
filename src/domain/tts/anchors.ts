import type { TtsSegment } from '../../core/tts-types';

export interface TtsAnchorText { kind: 'dialogue' | 'narration'; text: string }

// Rendered lines end at these; everything before belongs to an earlier line.
const LINE_BREAK = /<(?:br|hr|\/?(?:p|div|li|ul|ol|dl|dt|dd|h[1-6]|blockquote|section|article|header|footer|main|nav|aside|figure|figcaption|table|thead|tbody|tr|td|th|pre|details|summary))\b[^>]*>|\n/gi;
const ANCHOR = /<button\b[^>]*\bdata-omnitts-kind="(dialogue|narration)"[^>]*>/gi;
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

function decode(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (all, name: string) => {
    if (name[0] === '#') { const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : Number(name.slice(1)); return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : all; }
    return ENTITIES[name.toLowerCase()] ?? all;
  });
}

/** Visible text of each rendered line that ends in a TTS control, in DOM order. */
export function ttsAnchorTexts(html: string): TtsAnchorText[] {
  const result: TtsAnchorText[] = [];
  let last = 0;
  for (const match of html.matchAll(ANCHOR)) {
    let chunk = html.slice(last, match.index);
    let cut = 0;
    for (const boundary of chunk.matchAll(LINE_BREAK)) cut = boundary.index! + boundary[0].length;
    chunk = chunk.slice(cut);
    result.push({ kind: match[1]!.toLowerCase() as TtsAnchorText['kind'], text: decode(chunk.replace(/<[^>]*>/g, '')).trim() });
    last = match.index! + match[0].length;
  }
  return result;
}

// Markdown emphasis, quote marks and spacing differ between source and display.
export function ttsComparable(value: string): string {
  return value.normalize('NFKC').replace(/[\s​-‍⁠﻿*_~`"“”'‘’「」『』]/g, '').toLowerCase();
}

/**
 * Pairs rendered controls with parsed source segments. Display rules may drop
 * or restyle lines, so a control only binds to a segment whose text it shows.
 * Order is preferred; a later control never claims an earlier unused match
 * unless nothing ahead fits (modules can move blocks).
 */
export function matchTtsAnchors(anchors: readonly TtsAnchorText[], segments: readonly Pick<TtsSegment, 'kind' | 'text'>[]): number[] {
  const keys = segments.map(s => ttsComparable(s.text)), used = new Set<number>();
  const fits = (anchor: string, index: number, exact: boolean): boolean => {
    const key = keys[index]!;
    if (!key || used.has(index)) return false;
    if (exact) return segments[index]!.kind === 'dialogue' ? anchor.endsWith(key) : anchor === key;
    return anchor.includes(key) || (segments[index]!.kind !== 'dialogue' && key.includes(anchor) && anchor.length >= Math.min(4, key.length));
  };
  let cursor = 0;
  return anchors.map(row => {
    const anchor = ttsComparable(row.text);
    if (!anchor) return -1;
    const search = (from: number, to: number, exact: boolean) => { for (let i = from; i < to; i++) if (fits(anchor, i, exact)) return i; return -1; };
    let found = search(cursor, segments.length, true);
    if (found < 0) found = search(cursor, segments.length, false);
    if (found < 0) found = search(0, cursor, true);
    if (found < 0) found = search(0, cursor, false);
    if (found < 0) return -1;
    used.add(found); cursor = found + 1;
    return found;
  });
}
