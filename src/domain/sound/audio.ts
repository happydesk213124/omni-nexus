import type { SfxRule } from '../../core/sound-types';

/** Audio type from the first bytes; '' when the bytes are not a playable audio file. */
export function sniffAudioMime(input: ArrayBuffer | Uint8Array): string {
  const b = input instanceof Uint8Array ? input : new Uint8Array(input);
  const ascii = (at: number, text: string) => [...text].every((c, i) => b[at + i] === c.charCodeAt(0));
  if (b.length < 12) return '';
  if (ascii(0, 'ID3') || (b[0] === 0xff && (b[1]! & 0xe0) === 0xe0)) return 'audio/mpeg';
  if (ascii(0, 'RIFF') && ascii(8, 'WAVE')) return 'audio/wav';
  if (ascii(0, 'OggS')) return 'audio/ogg';
  if (ascii(0, 'fLaC')) return 'audio/flac';
  if (ascii(4, 'ftyp')) return 'audio/mp4';
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'audio/webm';
  return '';
}
export const AUDIO_EXTENSIONS: Record<string, string> = {
  'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/ogg': 'ogg', 'audio/flac': 'flac', 'audio/mp4': 'm4a', 'audio/webm': 'webm',
};

export interface SfxHit { rule: string; word: string; index: number }
/**
 * Effect words in a reply, in reading order. A rule's first capture group is the
 * word (`§(덜컹)§`); without one, the whole match is. Invalid rules are skipped.
 */
export function sfxHits(text: string, rules: readonly SfxRule[]): SfxHit[] {
  const hits: SfxHit[] = [];
  for (const rule of rules) {
    if (!rule.enabled || !rule.pattern) continue;
    let pattern: RegExp;
    try { pattern = new RegExp(rule.pattern, [...new Set(['g', ...rule.flags.replace(/[^imsu]/g, '')])].join('')); } catch { continue; }
    for (const match of String(text || '').matchAll(pattern)) {
      const word = String(match[1] ?? match[0]).trim();
      if (word) hits.push({ rule: rule.id, word, index: match.index ?? 0 });
      if (hits.length >= 200) break;
    }
  }
  return hits.sort((a, b) => a.index - b.index);
}
/** Whether a rule compiles; the settings form shows the error instead of saving. */
export function sfxRuleError(pattern: string, flags = ''): string {
  try { new RegExp(pattern, flags.replace(/[^imsu]/g, '')); return ''; } catch (error) { return String((error as Error).message || error); }
}
