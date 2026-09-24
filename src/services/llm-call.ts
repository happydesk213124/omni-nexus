/**
 * The LLM entry every feature uses. Applies dashboard reverse-bar / tag-cal
 * around the provider client so a new caller cannot skip them.
 */

import { getPrompt } from './settings';
import { getConfig } from './context';
import { callLlm as callLlmRaw, type CallLlmOptions as RawCallLlmOptions } from '../providers/llm/client';
import type { LlmSettings } from '../core/types';
import { normalizeReverseBarMode } from '../config/schema';
import { stripCbs } from '../core/util/text';
import {
  applyReverseBar,
  applyTagCalInstruct,
  decodeTagCal,
} from '../domain/llm/guardrails';
import type { LlmMessage } from '../providers/llm/transform';

export interface CallLlmOptions extends RawCallLlmOptions {
  /** Skip reverse-bar / tag-cal (LLM connection probe). */
  plain?: boolean;
}

async function prepareMessages(
  messages: LlmMessage[],
  opts: CallLlmOptions,
): Promise<LlmMessage[]> {
  if (opts.plain) return messages;
  const card = getConfig().card || {};
  // Role-swap option bar: memo = Freya role-lock set; authority = fake
  // supervisor approval role-lock set. User guidance is handled by author notes.
  const mode = normalizeReverseBarMode(card.llm_reverse_bar);
  const tagCal = card.llm_tag_cal === true;
  if (mode === 'off' && !tagCal) return messages;

  let out = messages;
  if (mode !== 'off') {
    // Role-lock set per level, mirroring the 4.5.1 jb toggle: memo uses the
    // Freya set (4.4.0 and earlier), authority the fake supervisor-approval
    // set (reintroduced from illustration 3). Prompt-tab editable.
    const pack = mode === 'memo'
      ? {
        jailbreak: stripCbs(await getPrompt('memo_jailbreak')),
        prefill: stripCbs(await getPrompt('memo_prefill')),
        prefillUser: stripCbs(await getPrompt('memo_prefill_user')),
      }
      : {
        jailbreak: stripCbs(await getPrompt('jailbreak')),
        prefill: stripCbs(await getPrompt('prefill')),
        prefillUser: stripCbs(await getPrompt('prefill_user')),
      };
    out = applyReverseBar(out, pack);
  }
  if (tagCal) out = applyTagCalInstruct(out);
  return out;
}

export async function callLlm(
  llm: LlmSettings,
  messages: LlmMessage[],
  opts: CallLlmOptions = {},
): Promise<string> {
  const prepared = await prepareMessages(messages, opts);
  const text = await callLlmRaw(llm, prepared, opts);
  if (opts.plain || getConfig().card?.llm_tag_cal !== true) return text;
  return decodeTagCal(text);
}
