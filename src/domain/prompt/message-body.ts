/** Analysis projection. Keep original nonempty-line indices for durable placement. */
export function projectMessageBody(value: unknown, keepMarker = false): { text: string; sourceLines: number[]; ranges: Array<[number, number]> } {
  const raw = String(value ?? '').replace(/\r\n/g, '\n');
  const token = /<\/?(?:thoughts|think)\b[^>]*>|\[\[imgstart\]\]|\[\[@inray(?:spinner)?::[^\]]+\]\]|\{\{#asset::inxbake_[^}]+\}\}/gi;
  let depth = 0, start = 0, masked = '';
  const blank = (s: string) => s.replace(/[^\n]/g, ' ');
  for (const match of raw.matchAll(token)) {
    const i = match.index!;
    const piece = raw.slice(start, i);
    masked += depth ? blank(piece) : piece;
    const tag = match[0];
    masked += keepMarker && !depth && tag.toLowerCase() === '[[imgstart]]' ? tag : blank(tag);
    if (tag.startsWith('<')) depth = tag.startsWith('</') ? Math.max(0, depth - 1) : depth + 1;
    start = i + tag.length;
  }
  let tail = raw.slice(start);
  // A split opening tag is not prose yet; do not let a partial delimiter leak.
  const open = tail.lastIndexOf('<');
  if (open >= 0 && !tail.slice(open).includes('>')) {
    const partial = tail.slice(open).toLowerCase();
    if (['<thoughts', '<think', '</thoughts', '</think'].some(tag => tag.startsWith(partial) || partial.startsWith(tag))) tail = tail.slice(0, open);
  }
  masked += depth ? blank(tail) : tail;
  const originals = raw.split('\n'), visible = masked.split('\n');
  const lines: string[] = [], sourceLines: number[] = [];
  const ranges: Array<[number, number]> = [];
  let source = 0, offset = 0;
  originals.forEach((line, i) => {
    if (line.trim()) source++;
    const text = (visible[i] || '').trim();
    if (text) {
      lines.push(text); sourceLines.push(source);
      const visibleLine = visible[i]!;
      ranges.push([offset + visibleLine.search(/\S/), offset + visibleLine.trimEnd().length]);
    }
    offset += line.length + 1;
  });
  return { text: lines.join('\n'), sourceLines, ranges };
}

/** L-numbers address source prose, not rendered HTML lines or thought-tag rows. */
export function insertAtAnalysisLine(value: unknown, line: number, side: 'before' | 'after', snippet: string): string {
  const raw = String(value ?? '').replace(/\r\n/g, '\n');
  const {ranges} = projectMessageBody(raw);
  const range = ranges[line - 1] ?? ranges.at(-1);
  if (!range) return raw;
  const at = side === 'before' ? range[0] : range[1];
  const insert = side === 'before' ? snippet + '\n' : '\n' + snippet;
  return raw.slice(0, at) + insert + raw.slice(at);
}

export const analysisBody = (value: unknown): string => projectMessageBody(value).text;

/** Preserve the marker until matching; thought contents can never be signals. */
export function findStreamSignal(value: unknown, keywords: readonly string[]): { text: string; signal: string } | null {
  const marker = '[[imgstart]]';
  const body = projectMessageBody(value, true).text;
  const lower = body.toLowerCase();
  let at = lower.indexOf(marker.toLowerCase()), signal = '[[imgstart]]';
  for (const key of keywords) {
    if (!key.trim()) continue;
    const index = lower.indexOf(key.toLowerCase());
    if (index >= 0 && (at < 0 || index < at)) { at = index; signal = key; }
  }
  return at < 0 ? null : { text: body.slice(0, at).trim(), signal };
}

/** Only remove the exact retired shipped requirement/example, never arbitrary user prose. */
export function withoutLegacyPercentPrompt(text: string): string {
  return text.replace(/Every shot MUST include `y_percent` \(0–100\), increasing with roughly even gaps across the full message\. No duplicates, all-under-40 clustering or gaps under ~15 unless one shot\./g, '')
    .replace(/"y_percent"\s*:\s*50\s*,\s*/g, '');
}
