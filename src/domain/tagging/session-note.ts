import { cleanText } from '../../core/util/text.ts';
import { parseWearState, type WearState } from '../character/wear-state.ts';
import { costumeKey } from '../character/costume.ts';

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

/**
 * This chat's outfits, for the image LLMs. Deliberately not a Priority block: this is remembered continuity, not a
 * user instruction, so the story may override it. Only what differs from clothed in the default costume, one line a
 * person (wear and costume together): nearly everyone is that, and a line each for all of them went with every
 * request. `skip`: people whose outfit the roster lines above already give. `isDefault`: by the costume's place ([0])
 * where the roster is known, else by its name. Empty when nothing is left.
 */
export function formatSessionOutfitReference(wear: SessionWearEntry[], costumes: SessionCostumeEntry[],
  opts: { skip?: ReadonlySet<string>; isDefault?: (entry: SessionCostumeEntry) => boolean } = {}): string {
  const isDefault = opts.isDefault ?? ((entry: SessionCostumeEntry) => costumeKey(entry.costume) === 'default');
  const people = new Map<string, { name: string; wear: string; costume: string }>();
  for (const e of wear) if (e.wear !== 'clothed') people.set(e.id, { name: e.name, wear: e.wear, costume: '' });
  for (const e of costumes) if (!isDefault(e)) people.set(e.id, { name: e.name, wear: '', ...people.get(e.id), costume: e.costume });
  const lines = [...people].filter(([id]) => !opts.skip?.has(id))
    .map(([, p]) => `- ${p.name}: ${[p.wear, p.costume ? `costume=${p.costume}` : ''].filter(Boolean).join(' · ')}`);
  if (!lines.length) return '';
  const listed = !!opts.skip?.size;
  return [
    `# Reference: this chat's outfits${listed ? ' (people not in the list above)' : ''}`,
    ...lines,
    listed ? 'Anyone in neither list is clothed, in their default costume. Keep these unless the story changes them.'
      : "Anyone not listed is clothed, in their default costume. These win over the roster's active_costume; keep them unless the story changes them.",
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

/**
 * Client Comments block, verbatim logic of the 4.5.1 module
 * (`lb-xnai.lb.whole.nl` / `lb-xnai.lb.whole.tag`): the direction text and the
 * focus line wrapped in `<instruction>` plus "precedes all previous
 * instructions". Both empty → '' (the module renders "(None specified)",
 * which is inert, so the central path injects nothing).
 */
export function formatClientComments(direction: unknown, focus: unknown): string {
  const dir = cleanText(direction, 8000);
  const foc = cleanText(focus, 8000);
  if (!dir && !foc) return '';
  const focusLine = foc
    ? `I want to focus on the character(s): "${foc}". Include at least one eligible focused character in every Scene. Apply the featured-character eligibility rules to a focused character. Keep other visible participants when the selected event requires them, but do not create a Scene centered only on other characters.`
    : '';
  if (dir) {
    return [
      'The Client has specified what they want:',
      '',
      '<instruction>',
      focusLine ? `${focusLine}\n\n${dir}` : dir,
      '</instruction>',
      '',
      'The above instruction precedes all previous instructions.',
    ].join('\n');
  }
  return [
    '<instruction>',
    focusLine,
    '</instruction>',
    '',
    'The above instruction precedes all previous instructions.',
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
