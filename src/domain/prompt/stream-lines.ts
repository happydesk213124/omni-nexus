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
  let consumed = 0;
  return {
    scan(raw: string, size: number, keywords: readonly string[], final = false, reserve = true) {
      const signal = scanner.scan(raw, keywords);
      const lines = signal ? signal.text.split('\n').filter(Boolean)
        : final && scanner.partialLine ? [...scanner.completedLines, scanner.partialLine] : scanner.completedLines;
      // A reply owns paid L ranges even if the host rewrites its prose.
      // Placement uses the final body's L numbers; never pay for a range twice.
      const batches: StreamLineBatch[] = [];
      const count = Math.max(2, Math.min(100, Math.floor(size) || 30));
      let next = consumed;
      while (lines.length - next >= count) {
        const end = next + count;
        batches.push({ start: next + 1, end, text: lines.slice(0, end).join('\n') });
        next = end;
      }
      // Completion admits only tails at least 80% full, including short replies
      // with no preceding batch. Round upward because L lines are indivisible.
      if (final && lines.length-next>=Math.ceil(count*4/5)) {
        batches.push({ start: next+1, end: lines.length, text: lines.join('\n') });
        next = lines.length;
      }
      // A temporarily unavailable host target must not consume unpaid ranges.
      if (reserve) consumed = next;
      return { batches };
    },
  };
}

export function streamLineRange(request: {stream_line_start?: unknown;stream_line_end?: unknown}) {
  const start=Number(request.stream_line_start), end=Number(request.stream_line_end);
  return Number.isInteger(start) && Number.isInteger(end) && start>=1 && end>=start
    ? {start,end} : null;
}
