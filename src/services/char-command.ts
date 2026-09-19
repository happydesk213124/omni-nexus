import { getPrompt } from './settings';
import type { ApiResult, CharacterRecord } from '../core/types';
import { cleanText, stripCbs } from '../core/util/text';
import { parseJsonLoose } from '../core/util/object';
import { applyCharacterCommandDeltas, characterCommandSnapshot } from '../domain/character/command-edit';
import { callLlm } from './llm-call';
import type { LlmMessage } from '../providers/llm/transform';
import { getConfig } from './context';

export interface CharCommandRewriteBody {
  instruction?: unknown;
  character?: unknown;
  signal?: AbortSignal;
}

function asChar(raw: unknown): Partial<CharacterRecord> {
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Partial<CharacterRecord>
    : {};
}

export async function commandRewriteCharacter(
  characterId: string,
  body: CharCommandRewriteBody = {},
): Promise<ApiResult> {
  const current = asChar(body.character);
  if (!cleanText(current.id, 80)) current.id = cleanText(characterId, 80);
  const instruction = cleanText(body.instruction, 4000);
  const system = stripCbs(await getPrompt('command_char_edit'));
  const messages: LlmMessage[] = [
    { role: 'system', content: system || 'Rewrite character tags. Return JSON only.' },
    {
      role: 'user',
      content: JSON.stringify({
        instruction: instruction || '(empty — small coherent add/remove only)',
        character: characterCommandSnapshot(current),
      }),
    },
  ];
  let raw = '';
  try {
    raw = await callLlm(getConfig().llm, messages, { signal: body.signal });
  } catch (err) {
    const aborted = (err as Error)?.name === 'AbortError'
      || /abort/i.test(String((err as Error)?.message || ''));
    return {
      ok: false,
      error: {
        code: aborted ? 'aborted' : 'llm_failed',
        message: aborted
          ? '명령 수정이 취소되었습니다'
          : `명령 수정 LLM 실패: ${String((err as Error)?.message || err).slice(0, 240)}`,
      },
    };
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = parseJsonLoose(raw) as Record<string, unknown>;
  } catch (err) {
    return {
      ok: false,
      error: { code: 'parse_failed', message: String((err as Error)?.message || err).slice(0, 240) },
    };
  }
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, error: { code: 'parse_failed', message: 'LLM returned non-object JSON' } };
  }
  const character = applyCharacterCommandDeltas(current, parsed);
  return { ok: true, character, deltas: parsed };
}
