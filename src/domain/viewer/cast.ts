/**
 * 옴니 뷰어's stage: who stands at a scene. Pure, so the rule is tested on its own.
 *
 * A scene is a text line (`who` its speaker's key, '' for narration) or a picture
 * (null, no line). A person comes on with their first line and stands while they have
 * a line within `reach` text lines of the one read, before or after it: one who went
 * quiet steps off, one about to speak again stays (or is back) for it. At most `max`
 * stand; the speaker always, then the nearest.
 */
export interface StageLine { who: string; face: string | null }
export interface StageMember {
  who: string;
  /** Their latest line's face, up to here. */
  face: string | null;
  speaking: boolean;
  /** Who is in front when they overlap: 0 spoke last, then on back. */
  front: number;
}

export function stageAt(lines: readonly (StageLine | null)[], at: number, max = 3, reach = 2): StageMember[] {
  const text: number[] = [];
  lines.forEach((line, i) => { if (line) text.push(i); });
  // A picture has no line of its own: the window stands around where it is in the text.
  let here = text.findIndex(i => i >= at);
  if (here < 0) here = text.length;
  const onText = text[here] === at;
  const from = Math.max(0, here - reach), to = Math.min(text.length - 1, here + (onText ? reach : reach - 1));
  const near = new Set<string>();
  for (let t = from; t <= to; t++) { const who = lines[text[t]!]!.who; if (who) near.add(who); }
  const speaker = onText ? lines[at]!.who : '';
  const seen = new Map<string, { first: number; last: number; next: number; face: string | null }>();
  lines.forEach((line, i) => {
    if (!line?.who || !near.has(line.who)) return;
    const row = seen.get(line.who) ?? { first: i, last: -1, next: Infinity, face: null };
    if (i <= at) { row.last = i; row.face = line.face ?? row.face; }
    else if (row.next === Infinity) row.next = i;
    seen.set(line.who, row);
  });
  // Nobody comes on before their first line.
  const gap = (r: { last: number; next: number }) => Math.min(at - r.last, r.next - at);
  const chosen = [...seen.entries()].filter(([, r]) => r.last >= 0)
    .sort(([a, ra], [b, rb]) => Number(b === speaker) - Number(a === speaker) || gap(ra) - gap(rb) || rb.last - ra.last)
    .slice(0, max);
  const byRecency = [...chosen].sort(([, a], [, b]) => b.last - a.last).map(([who]) => who);
  // Left to right as they first came into the reply: people keep their spots as others come and go.
  return chosen.sort(([, a], [, b]) => a.first - b.first).map(([who, r]) => ({
    who, face: r.face, speaking: who === speaker, front: byRecency.indexOf(who),
  }));
}
