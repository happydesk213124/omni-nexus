import { cleanText } from '../../core/util/text.ts';
import { parseWearState, type WearState } from '../character/wear-state.ts';

export function parseSessionAuthorNote(raw: unknown): {
  prefix: string;
  suffix: string;
  preset_id: string;
  location: string;
  wear: SessionWearEntry[];
  costumes?: SessionCostumeEntry[];
} {
  if (typeof raw === 'string') {
    return { prefix: cleanText(raw, 8000), suffix: '', preset_id: '', location: '', wear: [] };
  }
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const rec = raw as Record<string, unknown>;
    const prefix = cleanText(rec.prefix ?? rec.text ?? '', 8000);
    const suffix = cleanText(rec.suffix ?? rec.post ?? '', 8000);
    const preset_id = cleanText(rec.preset_id ?? rec.presetId ?? '', 80);
    const location = cleanText(rec.location ?? rec.location_tags ?? '', 800);
    const costumes = parseSessionCostumes(rec.costumes);
    return { prefix, suffix, preset_id, location, wear: parseSessionWear(rec.wear), ...(costumes.length ? { costumes } : {}) };
  }
  return { prefix: '', suffix: '', preset_id: '', location: '', wear: [] };
}

/** One remembered outfit state: character id → display name + wear. */
export interface SessionWearEntry {
  id: string;
  name: string;
  wear: WearState;
}

/**
 * Session-note wear map (character id → { name, wear }). Unknown wear states
 * are dropped; entries without a parseable state never reach the prompt.
 */
export function parseSessionWear(raw: unknown): SessionWearEntry[] {
  if (Array.isArray(raw)) raw = Object.fromEntries(raw.filter(e => e && typeof e === 'object' && e.id).map(e => [e.id, e]));
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
  const out: SessionWearEntry[] = [];
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const id = cleanText(key, 200);
    if (!id) continue;
    const rec = value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
    const wear = parseWearState(rec ? rec.wear ?? rec.wear_state ?? rec.state : value);
    if (!wear) continue;
    const name = cleanText(rec?.name, 200);
    out.push({ id, name: name || id, wear });
  }
  return out;
}

export interface SessionCostumeEntry { id: string; name: string; scope: string; costume: string }
export function parseSessionCostumes(raw: unknown): SessionCostumeEntry[] {
  if (Array.isArray(raw)) raw = Object.fromEntries(raw.filter(e => e && typeof e === 'object' && e.id).map(e => [e.id, e]));
  if (!raw || typeof raw !== 'object') return [];
  return Object.entries(raw).flatMap(([id, value]) => {
    if (!value || typeof value !== 'object') return [];
    const rec = value as Record<string, unknown>, costume = cleanText(rec.costume, 200);
    return costume ? [{ id, name: cleanText(rec.name, 200) || id, scope: cleanText(rec.scope, 200), costume }] : [];
  });
}

export function formatSessionCostumeReference(entries: SessionCostumeEntry[]): string {
  if (!entries.length) return '';
  return ['# Reference: 이 세션 현재 코스튬', ...entries.map(e => `- ${e.name}: costume=${e.costume}`),
    '로스터 active_costume보다 이 채팅방의 현재 코스튬을 우선합니다. 이야기에서 갈아입지 않으면 유지하세요.'].join('\n');
}

/**
 * Reference block for the tagger/comic prompt. Deliberately not a Priority
 * block: this is remembered continuity, not a user instruction, so the story
 * may override it. Empty when nothing is remembered.
 */
export function formatSessionWearReference(entries: SessionWearEntry[]): string {
  if (!entries.length) return '';
  return [
    '# Reference: 이 세션 옷 상태',
    ...entries.map((e) => `- ${e.name}: ${e.wear}`),
    '새 샷에서 옷이 바뀌었다는 근거가 없으면 이 상태를 유지하세요.',
  ].join('\n');
}

/** Shared / per-lane user note. Empty body is omitted. */
export function authorNoteSystemContent(label: string, body: unknown): string {
  const text = cleanText(body, 8000);
  if (!text) return '';
  return [
    `# Priority: ${label}`,
    text,
    '> These are instructions explicitly given by the user. If in conflict with previous instructions, this section MUST take precedence.',
  ].join('\n');
}

export function joinSessionAuthorNote(prefix: unknown, suffix: unknown): string {
  return [cleanText(prefix, 8000), cleanText(suffix, 8000)].filter(Boolean).join('\n');
}

/** System turn after the global Author's Note. Session text wins on conflict. */
export function sessionAuthorNoteSystemContent(raw: unknown): string {
  const { prefix, suffix } = typeof raw === 'string' || (raw && typeof raw === 'object' && ('prefix' in (raw as object) || 'suffix' in (raw as object) || 'text' in (raw as object)))
    ? parseSessionAuthorNote(raw)
    : { prefix: cleanText(raw, 8000), suffix: '' };
  if (!prefix && !suffix) return '';
  const body = [
    prefix ? `## 선행\n${prefix}` : '',
    suffix ? `## 후행\n${suffix}` : '',
  ].filter(Boolean).join('\n\n');
  return [
    '# Priority: 이세션 명령어',
    body,
    '> These instructions apply only to this Risu session. If they conflict with the global Author\'s Note above, this section MUST take precedence.',
  ].join('\n');
}
