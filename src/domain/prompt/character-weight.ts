import { cleanText } from '../../core/util/text';

export function stripCharacterEmphasis(value: unknown): string {
  return cleanText(value).replace(/\\[\s\S]|-?(?:\d+(?:\.\d+)?|\.\d+)::|::|[{}\[\]]/g,
    token => token.startsWith('\\') ? token : '').trim();
}

export function normalizeCharacterWeight(value: unknown): number {
  const n = value == null || String(value).trim() === '' ? 0.5 : Number(value);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.5;
}

/** One flat group: existing emphasis must not override the selected weight. */
export function weightCharacterPrompt(value: unknown, weight: unknown = 0.5): string {
  const body = stripCharacterEmphasis(value);
  return body ? `${normalizeCharacterWeight(weight)}::${body}::` : '';
}

/** The image's leading group supplies the editor value; tail weights stay intact. */
export function readCharacterWeightGroup(value: unknown): { weight: number; body: string } | null {
  const match = /^(\d+(?:\.\d+)?|\.\d+)::([\s\S]*?)::(?:,\s*([\s\S]*))?$/.exec(cleanText(value));
  if (!match || Number(match[1]) > 1 || match[2]!.includes('::')) return null;
  return { weight: Number(match[1]), body: [match[2]!.trim(), match[3]].filter(Boolean).join(', ') };
}
