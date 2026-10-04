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
import { guardrailSettings, normalizeGuardrailPreset } from '../domain/llm/guardrail-preset';
import { llmModelName } from '../providers/llm/model-name';
import { beginGuardrailRequest } from '../providers/llm/request-hook';
import { llmIsRisuSource } from '../providers/llm/transform';
import type { ReverseBarTexts } from '../domain/llm/guardrails';
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

async function reverseBarTexts(mode: 'memo' | 'authority'): Promise<ReverseBarTexts> {
  const keys = mode === 'memo' ? ['memo_jailbreak', 'memo_prefill', 'memo_prefill_user'] : ['jailbreak', 'prefill', 'prefill_user'];
  const texts = await Promise.all(keys.map(async key => stripCbs(await getPrompt(key)).trim()));
  return { jailbreak: texts[0], prefill: texts[1], prefillUser: texts[2] };
}

async function prepareMessages(
  messages: LlmMessage[],
  mode: 'off' | 'memo' | 'authority',
  tagCal: boolean,
): Promise<LlmMessage[]> {
  // Role-swap option bar: memo = Freya role-lock set; authority = fake
  // supervisor approval role-lock set. User guidance is handled by author notes.
  if (mode === 'off' && !tagCal) return messages;

  let out = messages;
  if (mode !== 'off') {
    // Role-lock set per level, mirroring the 4.5.1 jb toggle: memo uses the
    // Freya set (4.4.0 and earlier), authority the fake supervisor-approval
    // set (reintroduced from illustration 3). Prompt-tab editable.
    const pack = await reverseBarTexts(mode);
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
  const card = getConfig().card;
  const preset = normalizeGuardrailPreset(card.llm_guardrail_preset);
  const model = !opts.plain && preset === 'auto' ? await llmModelName(llm) : '';
  const { mode, tagCal } = guardrailSettings(preset, model, normalizeReverseBarMode(card.llm_reverse_bar), card.llm_tag_cal === true);
  const hook = !opts.plain && preset === 'auto' && llmIsRisuSource(llm.source)
    ? await beginGuardrailRequest({ mode, tagCal, memo: await reverseBarTexts('memo'), authority: await reverseBarTexts('authority') }) : null;
  let text: string;
  try {
    let prepared = opts.plain ? messages : await prepareMessages(messages, mode, tagCal);
    if (hook) prepared = [{ role: 'system', content: hook.request.marker }, ...prepared];
    text = await callLlmRaw(llm, prepared, opts);
  }
  finally { hook?.end(); }
  // Decode with the same decision that built this request, even if settings change mid-call.
  if (opts.plain || !(hook?.request.appliedTagCal ?? tagCal)) return text;
  return decodeTagCal(text);
}
