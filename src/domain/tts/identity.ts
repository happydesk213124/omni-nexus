import type { TtsCharacter } from '../../core/tts-types';

const key = (text: string): string => text.normalize('NFKC').toLowerCase().replace(/[\s_.·•･-]+/g, '');
const given = (c: TtsCharacter): string[] => [c.givenName || c.name, ...c.givenAliases].map(key).filter(Boolean);
const family = (c: TtsCharacter): string[] => [c.surname, ...c.surnameAliases].map(key).filter(Boolean);
export function sameTtsPerson(a: TtsCharacter, b: TtsCharacter): boolean {
  if (!(key(a.name) && key(a.name) === key(b.name)) && !given(a).some(n => given(b).includes(n))) return false;
  const left = family(a), right = family(b);
  return !left.length || !right.length || left.some(n => right.includes(n));
}
export function resolveTtsSpeaker(name: string, roster: TtsCharacter[], scope: string): TtsCharacter | null {
  const needle = key(name);
  if (!needle) return null;
  const available = roster.filter(c => c.scope === 'global' || c.scope === scope);
  const exact = available.filter(c => key(c.name) === needle || family(c).some(f => given(c).some(g => f + g === needle || g + f === needle)));
  const matches = exact.length ? exact : available.filter(c => [...given(c), ...c.triggers.map(key)].includes(needle));
  if (matches.length === 1) return matches[0]!;
  if (matches.some((a, i) => matches.slice(i + 1).some(b => !sameTtsPerson(a, b)))) return null;
  const local = matches.filter(c => c.scope === scope);
  return local.length === 1 ? local[0]! : null;
}
export function mergeTtsCharacter(roster: TtsCharacter[], draft: TtsCharacter): TtsCharacter[] {
  const original = roster.find(c => c.id === draft.id);
  const candidates = roster.filter(c => c.id !== draft.id && c.scope === draft.scope && sameTtsPerson(c, draft));
  const group = [draft, ...candidates];
  if (group.some((a, i) => group.slice(i + 1).some(b => !sameTtsPerson(a, b)))) throw new Error('같은 이름의 후보가 여러 명입니다. 성을 입력해 주세요.');
  const previous = original || candidates[0];
  const merged = { ...draft, id: previous?.id || draft.id, triggers: [...new Set([...draft.triggers, ...candidates.flatMap(c => c.triggers)])] };
  if (!original && previous) Object.assign(merged, { voiceKey: previous.voiceKey, fishId: previous.fishId, fixed: previous.fixed, gain: previous.gain });
  if (!original) for (const field of ['surname', 'givenName'] as const) merged[field] ||= previous?.[field] || '';
  merged.surnameAliases = [...new Set([...merged.surnameAliases, ...candidates.flatMap(c => c.surnameAliases)])];
  merged.givenAliases = [...new Set([...merged.givenAliases, ...candidates.flatMap(c => c.givenAliases)])];
  const removed = new Set([draft.id, ...candidates.map(c => c.id)]);
  return [...roster.filter(c => !removed.has(c.id)), merged];
}
