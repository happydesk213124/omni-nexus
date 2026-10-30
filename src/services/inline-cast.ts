import type { ApiResult, JobRequest } from '../core/types';
import { dbg } from '../core/debug';
import { cleanText, sessionIdHash, writeSessionId } from '../core/util/text';
import { inlineCastCharacters } from '../domain/prompt/inline-shots';
import { flushShotAssets } from '../storage/shot-character';
import { mergeRosterFromTagged } from './characters';
import { recordStreamBlock, rosterWritten } from './stream-continuity';

/**
 * 「새 캐릭터를 맨 앞에 쓰기」: the streaming runtime sends the reply's
 * `[[inxc]]{"new_characters":[…]}[[/inxc]]` the moment it closes, before any
 * of the story is written. It is the reply's block 0: shot blocks wait for its
 * roster write like they wait for an earlier block's (stream-continuity), so a
 * person it registers is known by name in block 1 even when both close at once.
 */
export async function registerInlineCast(body: Record<string, unknown>): Promise<ApiResult> {
  const characterId = cleanText(body.character_id, 200), chatId = cleanText(body.chat_id, 200);
  // The roster finds its bot only by this id (bot|chat hashed), the one a job of this chat uses.
  const sessionId = characterId && chatId ? writeSessionId({ sessionId: body.session_id || `risu_${sessionIdHash(`${characterId}|${chatId}`)}`, characterId }) : '';
  if (!characterId || !chatId || !sessionId) return { ok: false, error: { code: 'bad_request', message: '캐릭터와 채팅 ID가 필요합니다.' } };
  const people = Array.isArray(body.new_characters) ? inlineCastCharacters({ new_characters: body.new_characters }) : inlineCastCharacters(body.body);
  if (!people) return { ok: false, error: { code: 'bad_json', message: '캐스트 블록 JSON을 읽지 못했습니다.' } };
  const request: Partial<JobRequest> = {
    stream_id: cleanText(body.stream_id, 200), character_id: characterId, chat_id: chatId,
    host_message_id: cleanText(body.host_message_id, 200), inline_block: 0, inline_tagged: { new_characters: people, scenes: [] },
  };
  recordStreamBlock(request);
  try {
    if (people.length) {
      await mergeRosterFromTagged({
        sessionId, tagged: { new_characters: people, scenes: [] }, shotChars: [],
        unifiedSessionId: sessionId, characterId, sourceSessionIds: [],
        // Never a character write mid-reply: it goes out with the reply's bake, or after the reply ends.
        bufferWrites: true,
      });
      flushWhenReplyEnds();
    }
  } finally {
    rosterWritten(request);
  }
  dbg('inline-cast.registered', { message: people.map(p => cleanText(p.name, 80)).join(', '), count: people.length });
  return { ok: true, session_id: sessionId, registered: people.map(p => cleanText(p.name, 120)) };
}

/**
 * A reply with a cast block and no image block has no bake to carry the buffered
 * roster write, so it goes once the reply stops streaming. A bake that runs first
 * flushes it anyway; flushing an empty buffer writes nothing.
 */
const POLL_MS = 1500, GIVE_UP_MS = 15 * 60_000;
let flushTimer: ReturnType<typeof setTimeout> | undefined;
function replyStreaming(): boolean {
  const live = Reflect.get(globalThis, '__OMNI_REPLY_STREAMING__');
  return typeof live === 'function' && !!live();
}
export function flushWhenReplyEnds(startedAt = Date.now()): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = undefined;
    if (replyStreaming() && Date.now() - startedAt < GIVE_UP_MS) { flushWhenReplyEnds(startedAt); return; }
    void flushShotAssets().catch(error => dbg('inline-cast.flush', { message: String((error as Error)?.message || error) }, 'warn'));
  }, POLL_MS);
}
