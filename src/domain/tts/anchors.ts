import type { TtsSegment } from '../../core/tts-types';

/** `text` is the rendered line; `span` is everything since the previous control. */
export interface TtsAnchorText { kind: 'dialogue' | 'narration'; text: string; span?: string }

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
    const whole = html.slice(last, match.index);
    let cut = 0;
    for (const boundary of whole.matchAll(LINE_BREAK)) cut = boundary.index! + boundary[0].length;
    const visible = (value: string) => decode(value.replace(/<[^>]*>/g, '')).trim();
    result.push({ kind: match[1]!.toLowerCase() as TtsAnchorText['kind'], text: visible(whole.slice(cut)), span: visible(whole) });
    last = match.index! + match[0].length;
  }
  return result;
}

// Markdown emphasis, quote marks and spacing differ between source and display.
export function ttsComparable(value: string): string {
  return value.normalize('NFKC').replace(/[\s\u200b-\u200d\u2060\ufeff*_~`"“”'‘’「」『』]/g, '').toLowerCase();
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
  let cursor = 0, run = '';
  return anchors.map(row => {
    const anchor = ttsComparable(row.text);
    const span = ttsComparable(row.span ?? row.text);
    const search = (from: number, to: number, exact: boolean) => { for (let i = from; i < to; i++) if (fits(anchor, i, exact)) return i; return -1; };
    let found = anchor ? search(cursor, segments.length, true) : -1;
    if (found < 0 && anchor) found = search(cursor, segments.length, false);
    if (found < 0 && anchor) found = search(0, cursor, true);
    if (found < 0 && anchor) found = search(0, cursor, false);
    // Quote-box modules can split one spoken line into several boxes (inner
    // 'quotes' become their own blocks). Only the box that ends the line binds,
    // and only when the text since the last bound control holds the whole line.
    if (found < 0 && anchor.length >= 2) {
      const joined = run + span;
      for (let i = cursor; i < segments.length && found < 0; i++) {
        const key = keys[i]!;
        if (segments[i]!.kind === 'dialogue' && key && !used.has(i) && key.endsWith(anchor) && joined.includes(key)) found = i;
      }
    }
    if (found < 0) { run += span; return -1; }
    used.add(found); cursor = found + 1; run = '';
    return found;
  });
}
