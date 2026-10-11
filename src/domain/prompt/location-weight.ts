import { cleanText } from '../../core/util/text';
import { stripCharacterEmphasis } from './character-weight';

export function normalizeLocationWeight(value: unknown): number {
  const n = value == null || String(value).trim() === '' ? 1 : Number(value);
  return Number.isFinite(n) ? Math.min(5, Math.max(0, n)) : 1;
}

export function weightLocationTags(value: unknown, weight: unknown): string {
  const tags = cleanText(value, 800);
  const n = normalizeLocationWeight(weight);
  if (!tags || n === 1) return tags;
  const body = stripCharacterEmphasis(tags);
  return body ? `${n}::${body}::` : '';
}
