/**
 * The LLM entry every feature uses. Applies dashboard reverse-bar / tag-cal
 * around the provider client so a new caller cannot skip them.
 */

import { getPrompt } from './settings';
import { getConfig } from './context';
import { callLlm as callLlmRaw, type CallLlmOptions as RawCallLlmOptions } from '../providers/llm/client';
import type { LlmSettings } from '../core/types';
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
  const reverse = card.llm_reverse_bar === true;
  const tagCal = card.llm_tag_cal === true;
  if (!reverse && !tagCal) return messages;

  let out = messages;
  if (reverse) {
    out = applyReverseBar(out, {
      jailbreak: stripCbs(await getPrompt('jailbreak')),
      prefill: stripCbs(await getPrompt('prefill')),
      prefillUser: stripCbs(await getPrompt('prefill_user')),
    });
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
