import { buildSettingsAskMessages, normalizeSettingsAsk, parseSettingsAnswer } from '../domain/settings-ask';
import { callLlm } from './llm-call';
import { getConfig } from './context';

/**
 * 설정 검색 → LLM한테 물어보기. One call to the main LLM per question, with no
 * reverse bar or tag calibration: it is a question about the window, not a story.
 */
export async function askSettings(body: unknown): Promise<Record<string, unknown>> {
  const input = normalizeSettingsAsk(body);
  if (!input) return { ok: false, error: { code: 'bad_request', message: '질문과 설정 목록이 필요합니다.' } };
  const listed = new Set(input.tabs.flatMap(tab => tab.items.map(item => item.n)));
  let raw = '';
  try {
    raw = await callLlm(getConfig().llm, buildSettingsAskMessages(input), { plain: true });
  } catch (err) {
    return { ok: false, error: { code: 'llm_failed', message: `LLM 호출 실패: ${String((err as Error)?.message || err).slice(0, 240)}` } };
  }
  const { answer, picks } = parseSettingsAnswer(raw, listed);
  if (!answer && !picks.length) return { ok: false, error: { code: 'llm_empty', message: 'LLM이 답을 주지 않았습니다.' } };
  return { ok: true, answer, picks };
}
