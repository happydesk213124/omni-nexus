import { applyReverseBar, applyTagCalInstruct, TAG_CAL_INSTRUCT, type ReverseBarTexts } from './guardrails';
import { guardrailSettings } from './guardrail-preset';
import type { ReverseBarMode } from '../../core/types';

type Bag = Record<string, unknown>;
export interface GuardrailRequest {
  marker: string;
  mode: ReverseBarMode;
  tagCal: boolean;
  appliedTagCal?: boolean;
  memo: ReverseBarTexts;
  authority: ReverseBarTexts;
}
const bag = (value: unknown): Bag => value && typeof value === 'object' && !Array.isArray(value) ? value as Bag : {};

/** Only a marked Omni request is touched; unrelated chat requests pass through. */
export function applyGuardrailBody(raw: unknown, type: string, request: GuardrailRequest): unknown {
  const serialized = typeof raw === 'string' ? raw : JSON.stringify(raw);
  if (!serialized?.includes(request.marker)) return raw;
  let body: Bag;
  try { body = bag(JSON.parse(serialized)); } catch { return raw; }
  const model = typeof body.model === 'string' ? body.model : (/gemini/i.test(type) ? 'gemini' : '');
  const next = guardrailSettings('auto', model, request.mode, request.tagCal);
  const old = request.mode === 'memo' ? request.memo : request.mode === 'authority' ? request.authority : {};
  const known = /gemini|deepseek|glm/i.test(model);
  const remove = [request.marker, ...(known ? [old.jailbreak, old.prefill, old.prefillUser, ...(request.tagCal ? [TAG_CAL_INSTRUCT] : [])] : [])].filter((v): v is string => Boolean(v));
  const clean = (value: unknown): unknown => {
    if (typeof value === 'string') return remove.reduce((text, token) => text.split(token).join(''), value);
    if (Array.isArray(value)) return value.map(clean);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clean(item)]));
    return value;
  };
  // Clean prompt fields only: numeric parameters and model ids never change.
  for (const key of ['messages', 'contents', 'systemInstruction', 'system_instruction', 'system', 'input', 'instructions']) {
    if (body[key] != null) body[key] = clean(body[key]);
  }
  const pack = next.mode === 'memo' ? request.memo : next.mode === 'authority' ? request.authority : {};
  const system = [pack.jailbreak, next.tagCal ? TAG_CAL_INSTRUCT : ''].filter(Boolean).join('\n\n');
  const hasContent = (value: unknown): boolean => {
    if (typeof value === 'string') return Boolean(value.trim());
    if (Array.isArray(value)) return value.some(hasContent);
    return Boolean(value && typeof value === 'object' && Object.entries(value).some(([key, item]) => key !== 'type' && key !== 'role' && hasContent(item)));
  };
  const nonempty = (row: Bag) => (row.type && row.type !== 'message') || row.tool_calls || row.function_call || hasContent(row.multimodals) || hasContent(row.content ?? row.parts);
  if (!known) {
    for (const key of ['messages', 'contents', 'input']) if (Array.isArray(body[key])) body[key] = body[key].map(bag).filter(nonempty);
    request.appliedTagCal = request.tagCal;
    return typeof raw === 'string' ? JSON.stringify(body) : body;
  }
  if (Array.isArray(body.contents)) {
    const contents = body.contents.map(bag).filter(nonempty);
    const turns: Bag[] = [];
    if (pack.prefill) turns.push({ role: 'model', parts: [{ text: pack.prefill }] });
    if (pack.prefillUser) turns.push({ role: 'user', parts: [{ text: pack.prefillUser }] });
    body.contents = [...turns, ...contents];
    if (system) {
      const key = body.system_instruction ? 'system_instruction' : 'systemInstruction';
      const current = bag(body[key]);
      body[key] = { ...current, parts: [...(Array.isArray(current.parts) ? current.parts : []), { text: system }] };
    }
  } else if (Array.isArray(body.messages)) {
    const rows = body.messages.map(bag).filter(nonempty).map(row => ({ ...row, role: String(row.role || 'user'), content: row.content }));
    if (body.system != null) {
      // Anthropic keeps system instructions outside its user/assistant turns.
      const turns: Bag[] = [];
      if (pack.prefill) turns.push({ role: 'assistant', content: pack.prefill });
      if (pack.prefillUser) turns.push({ role: 'user', content: pack.prefillUser });
      body.messages = [...turns, ...rows];
      if (system) body.system = typeof body.system === 'string' ? [body.system, system].filter(Boolean).join('\n\n')
        : [...(Array.isArray(body.system) ? body.system : []), { type: 'text', text: system }];
    } else {
      let messages = applyReverseBar(rows, pack);
      if (next.tagCal) messages = applyTagCalInstruct(messages);
      body.messages = messages;
    }
  } else if (Array.isArray(body.input)) {
    const turns: Bag[] = [];
    if (system) turns.push({ role: 'system', content: system });
    if (pack.prefill) turns.push({ role: 'assistant', content: pack.prefill });
    if (pack.prefillUser) turns.push({ role: 'user', content: pack.prefillUser });
    body.input = [...turns, ...body.input.map(bag).filter(nonempty)];
  } else return raw;
  request.appliedTagCal = next.tagCal;
  return typeof raw === 'string' ? JSON.stringify(body) : body;
}
