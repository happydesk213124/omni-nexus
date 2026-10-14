import type { TtsCharacter, TtsSegment, TtsVoice } from '../../core/tts-types';
import { uuid } from '../../core/util/text';

export type TtsRole = NonNullable<TtsCharacter['role']>;
export const TTS_ROLE_NAMES: Record<TtsRole, string> = { narrator: '나레이션', monologue: '혼잣말' };
/** Adds any missing narrator / monologue card for the scope; returns the same array when nothing was missing. */
export function ensureTtsRoleCards(roster: TtsCharacter[], scope: string, voices: readonly TtsVoice[] = [], narrationVoice = '', narrationLanguage = 'original'): TtsCharacter[] {
  const added: TtsCharacter[] = [];
  for (const role of Object.keys(TTS_ROLE_NAMES) as TtsRole[]) {
    if (roster.some(c => c.role === role && c.scope === scope)) continue;
    const voice = role === 'narrator' && scope === 'global' ? voices.find(v => v.key === narrationVoice) : undefined;
    added.push({ id: uuid(), scope, name: TTS_ROLE_NAMES[role], surname: '', givenName: '', surnameAliases: [], givenAliases: [], triggers: [], tags: [], gender: 'unknown', voiceKey: voice?.key || '', fishId: voice?.fishId || '', fixed: true, gain: 0, role, ...(role === 'narrator' ? { language: narrationLanguage } : {}), ...(scope === 'global' ? {} : { followGlobal: true }) });
  }
  return added.length ? [...added, ...roster] : roster;
}
/** The card that voices a role in this bot: its own when it stopped following the global one, else the global card. */
export function resolveTtsRole(role: TtsRole, roster: readonly TtsCharacter[], scope: string): TtsCharacter | null {
  const cards = roster.filter(c => c.role === role);
  const card = (scope !== 'global' ? cards.find(c => c.scope === scope && c.followGlobal === false) : undefined) || cards.find(c => c.scope === 'global') || null;
  const followed = card?.followId ? roster.find(c => c.id === card.followId && !c.role) : undefined;
  return card && followed ? { ...card, voiceKey: followed.voiceKey, fishId: followed.fishId, gain: followed.gain, autoGain: followed.autoGain } : card;
}
export const ttsSegmentRole = (s: Pick<TtsSegment, 'kind' | 'speaker' | 'monologue'>): TtsRole | null => s.kind === 'narration' || (s.kind === 'illustration' && !s.speaker) ? 'narrator' : s.monologue ? 'monologue' : null;
/** Who voices a line: its role card, else the named speaker's card. */
export function ttsSegmentOwner(s: Pick<TtsSegment, 'kind' | 'speaker' | 'monologue'>, roster: TtsCharacter[], scope: string): TtsCharacter | null {
  const role = ttsSegmentRole(s);
  return role ? resolveTtsRole(role, roster, scope) : s.speaker ? resolveTtsSpeaker(s.speaker, roster, scope) : null;
}

/** Case-, width- and spacing-insensitive name key: Jet, JET and ｊｅｔ are one person. */
/** Volume correction actually applied: none while the character uses automatic loudness. */
export function ttsCharacterGain(c: Pick<TtsCharacter, 'gain' | 'autoGain'>): number {
  const auto = c.autoGain ?? c.gain === 0;
  return auto ? 0 : c.gain;
}
export const ttsNameKey = (text: string): string => text.normalize('NFKC').toLowerCase().replace(/[\s_.·•･-]+/g, '');
const key = ttsNameKey;
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
  const available = roster.filter(c => !c.role && (c.scope === 'global' || c.scope === scope));
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
  // Updating or merging a person must retain the surviving tile's position.
  return previous ? roster.flatMap(c => c.id === merged.id ? [merged] : removed.has(c.id) ? [] : [c]) : [...roster, merged];
}

/** An illustration-roster person: Korean display name plus trigger words and name variants. */
export interface IllustrationPerson { name: string; aliases?: string[]; surname?: string; given_name?: string; surname_variants?: string[]; given_name_variants?: string[] }
/**
 * Finds the TTS character for an illustration speaker (보민 → Bomin). Trigger
 * words decide first; when several share one, surname and given name (Korean
 * or English variants) pick the person. Without a trigger hit a full or given
 * name match is required, so a shared surname alone never decides.
 */
export function matchIllustrationSpeaker(person: IllustrationPerson, roster: TtsCharacter[], scope: string): TtsCharacter | null {
  const available = roster.filter(c => !c.role && (c.scope === 'global' || c.scope === scope));
  const words = new Set([person.name, ...(person.aliases || [])].map(key).filter(Boolean));
  const surnames = [person.surname || '', ...(person.surname_variants || [])].map(key).filter(Boolean);
  const givens = [person.given_name || '', ...(person.given_name_variants || [])].map(key).filter(Boolean);
  const fulls = new Set(surnames.flatMap(s => givens.flatMap(g => [s + g, g + s])));
  const score = (c: TtsCharacter): number => {
    const names = [c.name, ...c.triggers].map(key);
    const theirGiven = given(c), theirFamily = family(c);
    if (names.some(n => fulls.has(n)) || theirFamily.some(f => theirGiven.some(g => fulls.has(f + g) || fulls.has(g + f)))) return 3;
    const sameGiven = givens.some(g => theirGiven.includes(g) || names.includes(g));
    const sameFamily = !theirFamily.length || !surnames.length || surnames.some(s => theirFamily.includes(s));
    return sameGiven && sameFamily ? 2 : sameFamily && surnames.length && theirFamily.length ? 1 : 0;
  };
  const best = (pool: TtsCharacter[], minimum: number): TtsCharacter | null => {
    const ranked = pool.map(c => ({ c, s: score(c) + (c.scope === scope ? .5 : 0) })).filter(r => r.s >= minimum).sort((a, b) => b.s - a.s);
    return ranked.length && (ranked.length === 1 || ranked[0]!.s > ranked[1]!.s) ? ranked[0]!.c : null;
  };
  const hits = available.filter(c => [c.name, ...c.triggers].some(n => words.has(key(n))));
  if (hits.length === 1) return hits[0]!;
  if (hits.length > 1) return best(hits, 0);
  return best(available, 2);
}
