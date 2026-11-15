/**
 * 모델 설정 › Omni용으로 변환: an exported ComfyUI workflow given Omni's markers and a WebP save node.
 * The links decide what they can; the LLM is asked only for what they leave open, and only when one is set.
 */
import { getConfig } from './context';
import { callLlm } from '../providers/llm/client';
import { normalizeComfyWorkflowJsonText } from '../providers/comfy/client';
import { parseLlmJson } from '../providers/tts/translation';
import { applyConvertEdits, convertComfyWorkflow, convertMessages, type ConvertWorkflow } from '../domain/comfy/omni-convert';

export interface ComfyConversion { text: string; changes: string[]; asked: boolean }

export async function convertComfyWorkflowForOmni(raw: string): Promise<ComfyConversion> {
  if (!String(raw || '').trim()) throw new Error('먼저 ComfyUI에서 내보낸 API JSON을 붙여넣어 주세요.');
  let parsed: unknown;
  try { parsed = JSON.parse(normalizeComfyWorkflowJsonText(raw)); } catch (error) { throw new Error(`JSON을 읽지 못했습니다: ${String((error as Error)?.message || error).slice(0, 120)}`); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('API 포맷(노드 ID → 노드) JSON이 아닙니다.');
  if ((parsed as { nodes?: unknown }).nodes && (parsed as { links?: unknown }).links) throw new Error("UI 저장 포맷 워크플로입니다. ComfyUI에서 'Export (API)'로 내보낸 JSON을 넣어 주세요.");
  let result = convertComfyWorkflow(parsed as ConvertWorkflow), asked = false;
  if (result.missing.length) {
    // No LLM set, or one that fails: what the rules placed still stands, and the gap is said below.
    try { result = applyConvertEdits(result, parseLlmJson(await callLlm(getConfig().llm, convertMessages(result.workflow, result.missing)))); asked = true; } catch { /* reported as missing */ }
  }
  if (result.missing.includes('pos')) throw new Error(`긍정 프롬프트가 들어갈 칸을 찾지 못했습니다${asked ? '' : ' (LLM 호출 실패 · 모델 설정의 LLM을 확인해 주세요)'}. 프롬프트 글자 칸에 [[pos]]를 직접 넣어 주세요.`);
  const names: Record<string, string> = { neg: '부정 프롬프트', width: '크기', height: '크기', seed: '시드' };
  const left = [...new Set(result.missing.map(marker => names[marker]).filter(Boolean))];
  return { text: JSON.stringify(result.workflow, null, 2), changes: [...result.changes, ...(left.length ? [`찾지 못함: ${left.join(', ')} · 워크플로에 적힌 값을 그대로 씁니다`] : [])], asked };
}
