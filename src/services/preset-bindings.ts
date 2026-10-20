import { PRESET_BINDINGS_KEY } from '../core/constants';
import { cleanText } from '../core/util/text';
import type { ApiResult } from '../core/types';
import { psGet, psSet } from '../storage/device-store';
import { characterPreset, effectivePreset, FOLLOW_OMNI, normalizePresetBindings, type EffectivePreset, type PresetBindings } from '../domain/style-presets/binding';
import { getConfig, getPresetLookPreviewUrl } from './context';

/**
 * Which image preset a bot and a session draw with. Kept in plugin storage, not
 * in the chat or the bot: picking a tile rewrites neither, so nothing is drawn
 * again. A copied chat has a new id and follows its bot.
 */
let cache: PresetBindings | null = null;
let writes: Promise<unknown> = Promise.resolve();

async function load(): Promise<PresetBindings> {
  return cache ??= normalizePresetBindings(await psGet(PRESET_BINDINGS_KEY));
}

function presetList(): Array<{ id: string; name: string }> {
  return (getConfig().card?.presets || []).flatMap(raw => {
    const id = cleanText(raw?.id, 120);
    return id ? [{ id, name: cleanText(raw?.name, 200) || '이름 없음' }] : [];
  });
}

function named(effective: EffectivePreset, list: Array<{ id: string; name: string }>): EffectivePreset & { name: string } {
  return { ...effective, name: list.find(p => p.id === effective.id)?.name || '' };
}

/** The preset id a job for this bot and session draws with. */
export async function effectivePresetIdFor(characterId: unknown, sessionId: unknown): Promise<string> {
  const bindings = await load();
  const active = cleanText(getConfig().card?.active_preset_id, 120);
  const ids = new Set(presetList().map(p => p.id));
  return effectivePreset(ids, active, bindings.characters[cleanText(characterId, 200)] || '', bindings.sessions[cleanText(sessionId, 200)] || '').id;
}

async function describe(characterId: string, sessionId: string): Promise<ApiResult> {
  const bindings = await load();
  const list = presetList(), ids = new Set(list.map(p => p.id));
  const active = cleanText(getConfig().card?.active_preset_id, 120);
  const character = bindings.characters[characterId] || '', session = bindings.sessions[sessionId] || '';
  return {
    ok: true,
    character_id: characterId,
    session_id: sessionId,
    character,
    session,
    omni: named({ id: active, source: 'omni' }, list),
    character_effective: named(characterPreset(ids, active, character), list),
    effective: named(effectivePreset(ids, active, character, session), list),
    presets: list.map(p => ({ ...p, look_preview_url: getPresetLookPreviewUrl(p.id) || '' })),
  };
}

export async function getPresetBindings(query: Record<string, unknown>): Promise<ApiResult> {
  return describe(cleanText(query.character_id, 200), cleanText(query.session_id, 200));
}

/**
 * `character`: a preset id or "" (follow Omni). `session`: a preset id, "omni"
 * (follow Omni) or "" (follow the bot). A field left out is not changed.
 */
export function savePresetBindings(body: Record<string, unknown>): Promise<ApiResult> {
  const run = writes.catch(() => {}).then(async () => {
    const characterId = cleanText(body.character_id, 200), sessionId = cleanText(body.session_id, 200);
    const ids = new Set(presetList().map(p => p.id));
    const valid = (value: string, omniAllowed: boolean) => !value || ids.has(value) || (omniAllowed && value === FOLLOW_OMNI);
    const next = structuredClone(await load());
    if ('character' in body) {
      const choice = cleanText(body.character, 120);
      if (!characterId) return { ok: false, error: { code: 'bad_request', message: 'character_id required' } };
      if (!valid(choice, false)) return { ok: false, error: { code: 'bad_request', message: '없는 프리셋입니다.' } };
      if (choice) next.characters[characterId] = choice; else delete next.characters[characterId];
    }
    if ('session' in body) {
      const choice = cleanText(body.session, 120);
      if (!sessionId) return { ok: false, error: { code: 'bad_request', message: 'session_id required' } };
      if (!valid(choice, true)) return { ok: false, error: { code: 'bad_request', message: '없는 프리셋입니다.' } };
      if (choice) next.sessions[sessionId] = choice; else delete next.sessions[sessionId];
    }
    await psSet(PRESET_BINDINGS_KEY, next);
    cache = next;
    return describe(characterId, sessionId);
  });
  writes = run;
  return run;
}
