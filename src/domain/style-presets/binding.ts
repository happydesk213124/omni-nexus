/**
 * Image preset per bot and per session.
 *
 * A bot either picks a preset or follows Omni (the preset chosen in 스타일 프리셋,
 * `active_preset_id`). A session either follows its bot, follows Omni, or picks a
 * preset. Only the first preset is bound: the secondary stays one, for every chat.
 * A choice that names a preset no longer there falls through as if it were unset.
 */

/** A session's "follow Omni" choice; an empty choice follows the bot. */
export const FOLLOW_OMNI = 'omni';

export interface PresetBindings { characters: Record<string, string>; sessions: Record<string, string> }
export type PresetSource = 'session' | 'character' | 'omni';
export interface EffectivePreset { id: string; source: PresetSource }

const ID = /^[^\s]{1,120}$/;
const table = (raw: unknown): Record<string, string> => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (key && key.length <= 200 && typeof value === 'string' && ID.test(value)) out[key] = value;
  }
  return out;
};

export function normalizePresetBindings(raw: unknown): PresetBindings {
  const row = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  return { characters: table(row.characters), sessions: table(row.sessions) };
}

/** What a bot's own choice resolves to: its preset, else Omni's. */
export function characterPreset(presetIds: ReadonlySet<string>, activeId: string, characterChoice: string): EffectivePreset {
  return characterChoice && characterChoice !== FOLLOW_OMNI && presetIds.has(characterChoice)
    ? { id: characterChoice, source: 'character' }
    : { id: activeId, source: 'omni' };
}

/** The preset a session draws with: its own, else its bot's, else Omni's. */
export function effectivePreset(presetIds: ReadonlySet<string>, activeId: string, characterChoice: string, sessionChoice: string): EffectivePreset {
  if (sessionChoice === FOLLOW_OMNI) return { id: activeId, source: 'omni' };
  if (sessionChoice && presetIds.has(sessionChoice)) return { id: sessionChoice, source: 'session' };
  return characterPreset(presetIds, activeId, characterChoice);
}

/**
 * The settings a job draws with: the bound preset in first place. When it is the
 * one picked as secondary, the secondary steps aside so the two stay distinct.
 */
export function cardWithPreset<T extends { active_preset_id?: string; secondary_preset_id?: string }>(card: T, presetId: string | undefined): T {
  if (!presetId || presetId === card.active_preset_id) return card;
  return { ...card, active_preset_id: presetId, secondary_preset_id: card.secondary_preset_id === presetId ? '' : card.secondary_preset_id };
}
