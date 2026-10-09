import { createStreamSignalScanner } from './stream-signal';

export type StreamLineBatch = { start: number; end: number; text: string };

/** Preserve zero; line batches have a separate budget from normal generation. */
export function streamLineImageLimits(card: {stream_lines_image_min?: unknown;stream_lines_image_max?: unknown}) {
  const count=(value:unknown,fallback:number)=>value==null || !Number.isFinite(Number(value))
    ? fallback : Math.max(0,Math.min(20,Math.floor(Number(value))));
  const min=count(card.stream_lines_image_min,0);
  return {min,max:Math.max(min,count(card.stream_lines_image_max,2))};
}

/** Reserve each range once; an unfinished last line never counts toward a batch. */
export function createStreamLineBatcher() {
  const scanner = createStreamSignalScanner(true);
  let consumed = 0, revision = 0, covered = '';
  return {
    scan(raw: string, size: number, keywords: readonly string[], final = false) {
      const signal = scanner.scan(raw, keywords);
      const changed = revision !== scanner.revision;
      revision = scanner.revision;
      const lines = signal ? signal.text.split('\n').filter(Boolean)
        : final && scanner.partialLine ? [...scanner.completedLines, scanner.partialLine] : scanner.completedLines;
      // A host may trim the final newline or remove closed thought wrappers.
      // Equivalent prose must not reserve the same paid range twice.
      const reset = changed && (!covered || lines.slice(0, consumed).join('\n') !== covered);
      if (reset) { consumed = 0; covered = ''; }
      const batches: StreamLineBatch[] = [];
      const count = Math.max(2, Math.min(100, Math.floor(size) || 30));
      while (lines.length - consumed >= count) {
        const end = consumed + count;
        batches.push({ start: consumed + 1, end, text: lines.slice(0, end).join('\n') });
        consumed = end;
        covered = batches.at(-1)!.text;
      }
      // Completion admits only tails at least 80% full, including short replies
      // with no preceding batch. Round upward because L lines are indivisible.
      if (final && lines.length-consumed>=Math.ceil(count*4/5)) {
        batches.push({ start: consumed+1, end: lines.length, text: lines.join('\n') });
        consumed = lines.length;
        covered = batches.at(-1)!.text;
      }
      return { reset, batches };
    },
  };
}

export function streamLineRange(request: {stream_line_start?: unknown;stream_line_end?: unknown}) {
  const start=Number(request.stream_line_start), end=Number(request.stream_line_end);
  return Number.isInteger(start) && Number.isInteger(end) && start>=1 && end>=start
    ? {start,end} : null;
}
