/**
 * While a reply streams, its text only grows at the end: a line the model has
 * already ended with a newline never changes again, but the last one does with
 * every chunk. Voicing that one ahead would make 「미야: 태평」, then 「미야:
 * 태평하게 여기」… each its own paid request. So only segments that end before
 * the last newline are settled; the rest wait for the reply to finish.
 * A segment spanning lines (「미야:」 then the quote below) is settled only when
 * its last line is.
 */
export function settledWhileStreaming<T extends { segment: { end: number } }>(requests: readonly T[], source: string): T[] {
  const cut = source.lastIndexOf('\n');
  return requests.filter(request => request.segment.end <= cut);
}
