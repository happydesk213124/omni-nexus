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

export interface SfxHit { rule: string; word: string; index: number; length: number }

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');
/**
 * A rule is the marks around an effect word (`§덜컹§`), not a regex: the source is
 * built here. The word never crosses a line, a tag or another mark, so a mark the
 * model forgot to close cannot swallow the rest of the reply. Marks inside a tag
 * (text followed by `>` before any `<`, an attribute) are not effects: the chat
 * button and the played cue are paired in order, so both sides skip them.
 */
export function sfxRuleSource(rule: Pick<SfxRule, 'open' | 'close'>): string {
  const marks = [...new Set([...rule.open, ...rule.close])].map(escapeRegex).join('');
  return `${escapeRegex(rule.open)}([^${marks}\\n<>]{1,60})${escapeRegex(rule.close)}(?![^<>]*>)`;
}
/** Why a pair of marks cannot be a rule; empty when it can. */
export function sfxMarksProblem(open: string, close: string): string {
  if (!open || !close) return '앞·뒤 글자를 모두 넣어 주세요.';
  if (/[\n<>]/.test(open + close)) return '줄바꿈과 < > 는 쓸 수 없습니다.';
  if ([...open].length > 8 || [...close].length > 8) return '앞·뒤 글자는 8자까지입니다.';
  return '';
}
/**
 * Older saves held a regex. Its marks are the literal text before the word's
 * group and after it (`§([^§\n]{1,60})§` → § §); anything else becomes § §.
 */
export function sfxMarksFromPattern(pattern: string): { open: string; close: string } {
  const literal = String.raw`((?:\\.|[^\\()[\]{}|*+?.^$])+)`;
  const hit = new RegExp(`^${literal}\\(.*\\)${literal}$`, 's').exec(String(pattern || ''));
  const marks = hit ? { open: hit[1]!.replace(/\\(.)/g, '$1'), close: hit[2]!.replace(/\\(.)/g, '$1') } : null;
  return marks && !sfxMarksProblem(marks.open, marks.close) ? marks : { open: '§', close: '§' };
}
/** Effect words in a reply, in reading order. */
export function sfxHits(text: string, rules: readonly SfxRule[]): SfxHit[] {
  const hits: SfxHit[] = [];
  for (const rule of rules) {
    if (!rule.enabled || sfxMarksProblem(rule.open, rule.close)) continue;
    for (const match of String(text || '').matchAll(new RegExp(sfxRuleSource(rule), 'gu'))) {
      const word = String(match[1] ?? '').trim();
      if (word) hits.push({ rule: rule.id, word, index: match.index ?? 0, length: match[0].length });
      if (hits.length >= 200) break;
    }
  }
  return hits.sort((a, b) => a.index - b.index);
}
/** The line as spoken: marked effect words are played, not read aloud. */
export function withoutSfx(text: string, rules: readonly SfxRule[]): string {
  const hits = sfxHits(text, rules);
  if (!hits.length) return text;
  let out = '', last = 0;
  for (const hit of hits) { if (hit.index < last) continue; out += text.slice(last, hit.index); last = hit.index + hit.length; }
  return (out + text.slice(last)).replace(/[ \t]{2,}/g, ' ').trim();
}
