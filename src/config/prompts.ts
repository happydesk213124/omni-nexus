/**
 * Prompt text resolution.
 *
 * Prompts have three tiers, checked in order: the user's stored edit (in the
 * `meta` store, handled by the settings service), the build-time pack injected
 * as `__INLAY_NATIVE_PROMPTS__`, and the fallbacks compiled in here. The middle
 * tier lets the shipped prompts be updated by a build without touching code,
 * and the last tier guarantees generation still works if that injection is ever
 * missing.
 *
 * The injected pack is opaque (`{__enc,__v}`) so the shipped bundle does not
 * carry prompt text as plaintext JSON — see `prompt-codec.ts`.
 */

import { cleanText } from '../core/util/text';
import { PROMPT_FALLBACKS } from './defaults';
import { decodePromptPack } from './prompt-codec';

function externalPrompts(): Record<string, string> {
  const g = globalThis as { __INLAY_NATIVE_PROMPTS__?: unknown };
  return decodePromptPack(g.__INLAY_NATIVE_PROMPTS__);
}

/** The shipped default text for a prompt key, ignoring any user edit. */
export function promptText(key: string): string {
  const injected = cleanText(externalPrompts()[key]);
  if (injected) return injected;
  return PROMPT_FALLBACKS[key] || '';
}
