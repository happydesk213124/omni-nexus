/**
 * Shot `line` = 1-based non-empty newline index in the tagged message
 * after removing reasoning blocks. Preserve the L-number the model selected.
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

/** Valid L numbers are authoritative; invalid values land on the last body line. */
export function normalizeShotLines<T extends {line?: unknown}>(shots: readonly T[], text: unknown): T[] {
  const last = Math.max(1, splitTaggerMessageLines(text).length);
  return shots.map(shot => {
    const line = Number(shot.line);
    return {...shot, line: Number.isInteger(line) && line >= 1 && line <= last ? line : last};
  });
}
