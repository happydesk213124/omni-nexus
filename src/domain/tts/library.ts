import type { TtsGender, TtsVoice } from '../../core/tts-types';
import { uuid } from '../../core/util/text';

export function fishVoiceId(input: string): string {
  const value = input.trim();
  if (/^[a-f\d]{32}$/i.test(value)) return value.toLowerCase();
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !/(^|\.)fish\.audio$/i.test(url.hostname)) return '';
    const parts = url.pathname.split('/').filter(Boolean);
    const id = parts.at(-1) || '';
    return parts.at(-2) === 'm' && /^[a-f\d]{32}$/i.test(id) ? id.toLowerCase() : '';
  } catch { return ''; }
}
export function voiceGender(tags: string[]): TtsGender {
  const values = tags.map(t => t.trim().toLowerCase());
  const female = values.some(t => ['여성', '여자', 'female', 'woman'].includes(t));
  const male = values.some(t => ['남성', '남자', 'male', 'man'].includes(t));
  return female === male ? 'unknown' : female ? 'female' : 'male';
}
export function matchesVoiceSearch(voice: TtsVoice, query: string): boolean {
  const text = [voice.name, voice.fishId, ...voice.tags].join(' ').normalize('NFKC').toLowerCase();
  const groups = query.normalize('NFKC').toLowerCase().split('|').map(g => g.split('&').map(s => s.trim()).filter(Boolean)).filter(g => g.length);
  return !groups.length || groups.some(group => group.every(term => text.includes(term)));
}
export function compareVoiceErrors(a: TtsVoice, b: TtsVoice): number {
  return (b.error?.count || 0) - (a.error?.count || 0) || (b.error?.lastAt || 0) - (a.error?.lastAt || 0);
}
export function parseVoiceImport(input: unknown, folder = ''): TtsVoice[] {
  const root = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const rows: unknown = Array.isArray(input) ? input : root.voices;
  if (!Array.isArray(rows) || !rows.length || rows.length > 2000) throw new Error('음성 목록은 1~2000개여야 합니다.');
  const seen = new Set<string>();
  return rows.flatMap((raw, i) => {
    if (!raw || typeof raw !== 'object') throw new Error(`${i + 1}번 음성 형식이 잘못되었습니다.`);
    const row = raw as Record<string, unknown>;
    const fishId = fishVoiceId(String(row.fishId || row.id || ''));
    const name = String(row.name || '').trim().slice(0, 200);
    if (!fishId || !name) throw new Error(`${i + 1}번 음성의 이름 또는 Fish ID를 확인하세요.`);
    const tags = (Array.isArray(row.tags) ? row.tags.map(String) : String(row.tag || '').split(',')).map(t => t.trim()).filter(Boolean).slice(0, 40);
    const signature = JSON.stringify([name, fishId]);
    if (seen.has(signature)) return [];
    seen.add(signature);
    const gender: TtsGender = ['female','male','unknown'].includes(String(row.gender)) ? row.gender as TtsGender : voiceGender(tags);
    return [{ key: uuid(), name, fishId, tags, gender, folder }];
  });
}
export function parseRates(value: string, defaults: number[]): number[] {
  if (!value.trim()) return [...defaults];
  const pieces = value.split(',').map(v => v.trim());
  if (pieces.length > 32 || pieces.some(v => !/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(v) || Number(v) < .25 || Number(v) > 4)) {
    throw new Error('배속은 0.25~4 사이 숫자를 쉼표로 구분해 주세요.');
  }
  return [...new Set(pieces.map(Number))].sort((a, b) => a - b);
}
/** A JEV pick fills only what the character lacks: mood tags, and gender while unknown. */
export function adoptVoiceTags(character: { tags: string[]; gender?: string }, voice: { tags: string[]; gender?: string }): void {
  if (!character.tags.length && voice.tags.length) character.tags = [...voice.tags];
  if (character.gender === 'unknown' && (voice.gender === 'female' || voice.gender === 'male')) character.gender = voice.gender;
}
