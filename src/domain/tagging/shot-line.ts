/**
 * Shot `line` = 1-based non-empty newline index in the tagged message
 * (same split as viewer-core splitMessageLines). Models often emit 1,2,3…
 * as shot order; detect that and remap from y_percent.
 */

/** Non-empty trimmed lines — keep in sync with viewer-core.splitMessageLines. */
export function splitTaggerMessageLines(text: unknown): string[] {
  return String(text ?? '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

const CSS_PREVIEW_CHARS = 50;

/** Heuristic: stylesheet text leaked from <style> after tag strip. */
export function looksLikeCssLine(line: unknown): boolean {
  const s = String(line ?? '').trim();
  if (s.length < 24) return false;
  if (/^@(?:keyframes|media|supports|font-face|import|charset)\b/i.test(s)) return true;
  if (/^\.[a-zA-Z_-][\w-]*(?:\s+\.[a-zA-Z_-][\w-]*)*\s*\{/.test(s)) return true;
  if (
    /[{;].*(?:position|display|rgba?\(|linear-gradient|border-radius|z-index|padding|margin|font-size|background|transform|opacity)\s*:/i.test(s)
  ) {
    return true;
  }
  return false;
}

/** LLM-only: same line index, CSS rows collapsed. Never used for placement. */
export function formatLineForTaggerPrompt(line: unknown): string {
  const s = String(line ?? '');
  if (!looksLikeCssLine(s)) return s;
  const preview = s.slice(0, CSS_PREVIEW_CHARS);
  const more = s.length > CSS_PREVIEW_CHARS ? '…' : '';
  return `maybeCSSCode<< ${preview}${more}`;
}

/** Prefix each line so the tagger can cite L# in shot.line. */
export function numberMessageLinesForTagger(text: unknown): string {
  const lines = splitTaggerMessageLines(text);
  if (!lines.length) return '';
  return lines.map((line, i) => `L${i + 1}|${formatLineForTaggerPrompt(line)}`).join('\n');
}

/** True when lines are exactly 1..N in order (lazy shot-index fill). */
export function isLazySequentialShotLines(lines: readonly unknown[]): boolean {
  if (lines.length < 2) return false;
  for (let i = 0; i < lines.length; i += 1) {
    const n = Math.floor(Number(lines[i]));
    if (!Number.isFinite(n) || n !== i + 1) return false;
  }
  return true;
}

/**
 * Map y_percent → 1-based line indices; nudge collisions forward/back so
 * multiple shots do not stack on one line when the message has room.
 */
export function assignLinesFromYPercent(
  yPercents: readonly unknown[],
  lineCount: number,
): number[] {
  const max = Math.max(1, Math.floor(Number(lineCount) || 0));
  const used = new Set<number>();
  return yPercents.map((y) => {
    const p = Number(y);
    const pct = Number.isFinite(p) ? Math.max(0, Math.min(100, p)) : 50;
    let n = max <= 1 ? 1 : Math.max(1, Math.min(max, Math.round((pct / 100) * (max - 1)) + 1));
    if (!used.has(n)) {
      used.add(n);
      return n;
    }
    for (let d = 1; d < max; d += 1) {
      const up = n + d;
      if (up <= max && !used.has(up)) {
        used.add(up);
        return up;
      }
      const down = n - d;
      if (down >= 1 && !used.has(down)) {
        used.add(down);
        return down;
      }
    }
    used.add(n);
    return n;
  });
}

export type ShotWithLine = { line?: unknown; y_percent?: unknown };

/**
 * If shots used lazy 1..N lines, replace with y_percent-derived indices.
 * No-op when lineCount < 2 or pattern is not sequential.
 */
export function repairLazyShotLines<T extends ShotWithLine>(
  shots: readonly T[],
  messageText: unknown,
): T[] {
  if (!Array.isArray(shots) || shots.length < 2) return shots.slice();
  const lineCount = splitTaggerMessageLines(messageText).length;
  if (lineCount < 2) return shots.slice();
  if (!isLazySequentialShotLines(shots.map((s) => s.line))) return shots.slice();
  const mapped = assignLinesFromYPercent(
    shots.map((s) => s.y_percent),
    lineCount,
  );
  return shots.map((s, i) => ({ ...s, line: mapped[i] ?? s.line }));
}
