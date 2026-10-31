/**
 * 옴니 뷰어's stage: who stands at a scene. Pure, so the rule is tested on its own.
 *
 * A scene is a text line (`who` its speaker's key, '' for narration) or a picture
 * (null, no line; it counts as the line before it). A person comes on with a line and
 * stays `reach` text lines after their latest one; quiet longer, they step off, and they
 * come on again only with their next line. Nobody is on before their line: standing
 * there ahead of it told who was about to speak. At most `max` stand, the latest to
 * speak; `reach` Infinity: none steps off.
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

export function stageAt(lines: readonly (StageLine | null)[], at: number, max = 3, reach = 3): StageMember[] {
  // Which text line each scene is at (a picture: the line before it), to count the lines since someone spoke.
  const textAt: number[] = [];
  let count = -1;
  for (const line of lines) { if (line) count++; textAt.push(count); }
  const here = textAt[Math.min(at, lines.length - 1)] ?? -1;
  const speaker = lines[at]?.who ?? '';
  const seen = new Map<string, { first: number; last: number; face: string | null }>();
  for (let i = 0; i <= at && i < lines.length; i++) {
    const line = lines[i];
    if (!line?.who) continue;
    const row = seen.get(line.who) ?? { first: i, last: i, face: null };
    row.last = i; row.face = line.face ?? row.face;
    seen.set(line.who, row);
  }
  // The latest to speak first (the speaker, then who spoke before them): the first `max` stand, in that order in front.
  const chosen = [...seen.entries()].filter(([, r]) => here - textAt[r.last]! <= reach).sort(([, a], [, b]) => b.last - a.last).slice(0, max);
  const front = chosen.map(([who]) => who);
  // Left to right as they first came into the reply: people keep their spots as others come and go.
  return chosen.sort(([, a], [, b]) => a.first - b.first).map(([who, r]) => ({ who, face: r.face, speaking: who === speaker, front: front.indexOf(who) }));
}
