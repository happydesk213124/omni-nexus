import { PROMPT_KEYS, RETIRED_PROMPT_KEYS } from '../core/constants';
import { hashCode } from '../core/util/text';
import { promptText } from '../config/prompts';
import { idbGet, idbPut } from '../storage/stores';

export const promptRevision = (key: string): string => String(hashCode(promptText(key)));
const storageKey = (key: string) => `prompt:__applied__:${key}`;

export async function acknowledgePromptDefault(key: string): Promise<void> {
  await idbPut('meta', { key: storageKey(key), text: promptRevision(key) });
}

/** Used only when introducing revision tracking to an older prompt store. */
export async function hasPromptDefaultRevision(key: string): Promise<boolean> {
  return Boolean(await idbGet('meta', storageKey(key)));
}

/** A changed shipped revision remains visible until that prompt is reset. */
export async function pendingPromptDefaults(): Promise<string[]> {
  const pending = await Promise.all(PROMPT_KEYS.map(async key => {
    if (RETIRED_PROMPT_KEYS.has(key)) return '';
    const row = await idbGet('meta', storageKey(key));
    return row?.text === promptRevision(key) ? '' : key;
  }));
  return pending.filter(Boolean);
}
