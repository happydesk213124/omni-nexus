/**
 * Comic-LLM user prose only. Placement still uses raw split lines.
 */
import { comicLineRange } from './kind.ts';
import {
  formatLineForTaggerPrompt,
  numberMessageLinesForTagger,
  splitTaggerMessageLines,
} from '../tagging/shot-line.ts';

/** English, short — code-injected, not the comic prompt pack. */
export const COMIC_FULL_MESSAGE_REF = 'Full message (reference only):';

export function comicPageLinesForLlm(
  text: unknown,
  start: unknown,
  end: unknown,
): string {
  const lines = splitTaggerMessageLines(text);
  const [a, b] = comicLineRange(start, end, lines.length);
  return lines.slice(a - 1, b).map((line, i) => `L${a + i}|${formatLineForTaggerPrompt(line)}`).join('\n');
}

export function comicProseBlockForLlm(
  text: unknown,
  start: unknown,
  end: unknown,
): string {
  const page = comicPageLinesForLlm(text, start, end);
  const full = numberMessageLinesForTagger(text);
  if (!full) return page;
  const lines = splitTaggerMessageLines(text);
  const [a, b] = comicLineRange(start, end, lines.length);
  if (a === 1 && b === lines.length) return page;
  return `${page}\n\n${COMIC_FULL_MESSAGE_REF}\n${full}`;
}
