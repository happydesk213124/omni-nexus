import type { ApiResult, TaggerResult } from '../core/types';
import { risuHost } from '../core/host';
import { cleanText, toInt } from '../core/util/text';
import { isBlockWaitId, waitSlotBlock, waitTokenDimensions } from '../domain/chat-bake';
import { inlineShotTagged } from '../domain/prompt/inline-shots';
import { analysisBody } from '../domain/prompt/message-body';
import { dropInlineWait, getInlineWait } from '../storage/inline-wait-store';
import { readStoredMessageBody } from './chat-bake';
import { ensureInrayDisplayModule } from '../storage/inray-display-module';
import { streamBlockBusy } from './stream-jobs';
import { getConfig } from './context';
import { createJob } from './jobs';

/**
 * Streaming tags with 「이미지 바로 생성」 off. At completion the blocks become
 * waiting (pink) slots in place, `[[inxwN]]{json}[[/inxwN]]`: the JSON stays in the
 * message as the slot itself, so a tap reads exactly that shot from there. Older
 * `[[@inraywait]]` slots (their shot in plugin storage) still work.
 */
const fail = (code: string, message: string): ApiResult => ({ ok: false, error: { code, message } });
/** The slot's line is read from where it sits now; the saved shot follows it. */
const atLine = (tagged: TaggerResult, line: number): TaggerResult => ({ ...tagged, scenes: (tagged.scenes || []).map(scene => ({ ...scene, shots: (scene.shots || []).map(shot => ({ ...shot, line })) })) });

/**
 * The reply ended with 「이미지 바로 생성」 off. Its blocks are already the pink
 * slots, as written: nothing is renamed or rewritten here any more (that write
 * could land late or not at all in Risu). The display module is made sure of so
 * the slots draw, and their ids are reported for the frozen UI.
 */
export async function parkInlineShots(body: Record<string, unknown>): Promise<ApiResult> {
  if (getConfig().card?.power === false) return fail('power_off', 'Power가 OFF 상태입니다.');
  const ns = (Array.isArray(body.blocks) ? body.blocks : []).map(row => toInt((row as { n?: unknown } | null)?.n, 0)).filter(n => n > 0);
  if (!ns.length) return { ok: true, parked: 0 };
  const card = getConfig().card;
  await ensureInrayDisplayModule(card.persist_chat_images_folded === true, card.inline_chat_scale_pct, { enabled: card.inline_msg_fan === true, userchat: card.userchat === true });
  return { ok: true, parked: ns.length, wait_ids: ns.map(n => `b${n}`) };
}

/** A tap: one job for this slot only. Its shot comes from the save, its broken block is fixed, or the tagger draws it from its line. */
export async function generateInlineWait(body: Record<string, unknown>): Promise<ApiResult> {
  const id = cleanText(body.wait_id, 64);
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id)) return fail('bad_request', '대기 칸 ID가 올바르지 않습니다.');
  const stored = await readStoredMessageBody(body.char_index, body.chat_index, body.message_index);
  if (stored == null || !waitTokenDimensions(stored, id)) {
    await dropInlineWait(id).catch(() => {});
    return fail('not_found', '이 칸은 이미 만들었거나 메시지가 바뀌었습니다.');
  }
  // Never while the reply is still being written (a write now would put back the chat
  // as it was), nor while this block's own streaming job is drawing it.
  const blockN = isBlockWaitId(id) ? Number(id.slice(1)) : 0;
  const host = risuHost(), chat = await host?.getChatFromIndex?.(toInt(body.char_index, -1), toInt(body.chat_index, -1));
  const messages = Array.isArray(chat?.message) ? chat.message : [];
  if (chat?.isStreaming === true && toInt(body.message_index, -1) === messages.length - 1) return fail('busy', '답변이 끝난 뒤 눌러 주세요.');
  if (blockN && streamBlockBusy(cleanText(body.host_message_id, 200), blockN)) return fail('busy', '이 칸은 이미 만드는 중입니다.');
  // A block slot carries its own shot in the message; an older token's shot is in storage.
  const block = isBlockWaitId(id) ? waitSlotBlock(stored, id) : null;
  const wait = block ? undefined : await getInlineWait(id);
  const lines = analysisBody(stored).split('\n').filter(Boolean);
  const before = analysisBody(stored.slice(0, block ? block.start : stored.indexOf(`[[@inraywait::${id}::`))).split('\n').filter(Boolean).length;
  const line = Math.max(1, Math.min(lines.length, before || wait?.line || 1));
  if (!lines.length) return fail('bad_request', '이 메시지에는 그릴 본문이 없습니다.');
  const tagged = block ? inlineShotTagged(block.body, line) : wait?.tagged ?? null;
  const raw = block ? (tagged ? '' : block.body.slice(0, 4000)) : wait?.raw || '';
  return createJob({
    ...body,
    message_role: 'char',
    content_hash: `wait:${id}`,
    assistant_text: lines.slice(0, line).join('\n'),
    stream_line_start: line,
    stream_line_end: line,
    inline_wait: id,
    // A broken block is fixed first; when that fails too, the tagger draws the line.
    ...(tagged ? { inline_tagged: atLine(tagged, line) } : raw ? { inline_raw: raw } : {}),
    // A failed run puts the block back exactly as it was, ready for another tap.
    ...(block ? { inline_wait_block: block.text } : {}),
  });
}
