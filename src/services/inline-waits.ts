import type { ApiResult, TaggerResult } from '../core/types';
import { risuHost } from '../core/host';
import { cleanText, toInt, uuid } from '../core/util/text';
import { waitTokenDimensions } from '../domain/chat-bake';
import { analysisBody } from '../domain/prompt/message-body';
import { resolveShotAspect } from '../domain/nai-meta/aspect';
import { dropInlineWait, getInlineWait, putInlineWaits, type InlineWait } from '../storage/inline-wait-store';
import { parkInlineBlocks, readStoredMessageBody } from './chat-bake';
import { getConfig } from './context';
import { createJob } from './jobs';

/**
 * Streaming tags with 「이미지 바로 생성」 off. At completion the blocks become
 * waiting (pink) slots; a tap on one generates exactly that shot in place.
 */
const SLOT_SIZE: Record<string, [number, number]> = { portrait: [832, 1216], square: [1024, 1024], landscape: [1216, 832] };
const fail = (code: string, message: string): ApiResult => ({ ok: false, error: { code, message } });
/** The slot's line is read from where it sits now; the saved shot follows it. */
const atLine = (tagged: TaggerResult, line: number): TaggerResult => ({ ...tagged, scenes: (tagged.scenes || []).map(scene => ({ ...scene, shots: (scene.shots || []).map(shot => ({ ...shot, line })) })) });

function slotAspect(tagged: TaggerResult | null): string {
  const shot = tagged?.scenes?.[0]?.shots?.[0] as { aspect?: unknown } | undefined;
  return resolveShotAspect(shot?.aspect);
}

/** One write turns the reply's blocks into waiting slots; their shots go to the save. */
export async function parkInlineShots(body: Record<string, unknown>): Promise<ApiResult> {
  if (getConfig().card?.power === false) return fail('power_off', 'Power가 OFF 상태입니다.');
  const blocks = (Array.isArray(body.blocks) ? body.blocks : []).filter((row): row is Record<string, unknown> => !!row && typeof row === 'object')
    .map(row => {
      const tagged = row.tagged && typeof row.tagged === 'object' ? row.tagged as TaggerResult : null;
      return { n: toInt(row.n, 0), line: Math.max(1, toInt(row.line, 1)), tagged, raw: !tagged && typeof row.raw === 'string' ? row.raw.slice(0, 4000) : '' };
    })
    .filter(row => row.n > 0);
  if (!blocks.length) return { ok: true, parked: 0 };
  const charIndex = toInt(body.char_index, -1), chatIndex = toInt(body.chat_index, -1), messageIndex = toInt(body.message_index, -1);
  const characterId = cleanText(body.character_id, 200), chatId = cleanText(body.chat_id, 200), hostMessageId = cleanText(body.host_message_id, 200);
  const host = risuHost();
  const character = await host?.getCharacterFromIndex?.(charIndex);
  const chat = await host?.getChatFromIndex?.(charIndex, chatIndex);
  // The reply is found by its id, as at stream commit: its blocks are the slots,
  // so the text itself is never compared (a regex or an edit may already have changed it).
  if (!hostMessageId || String(character?.chaId || character?.id || '') !== characterId || String(chat?.id || chat?.chatId || '') !== chatId ||
      !(chat?.message || []).some((msg: { chatId?: unknown; id?: unknown }) => String(msg?.chatId || msg?.id || '') === hostMessageId)) {
    return fail('message_changed', '응답 메시지를 찾지 못해 대기 칸을 만들지 않았습니다.');
  }
  const now = Date.now();
  const slots = blocks.map(block => {
    const [width, height] = SLOT_SIZE[slotAspect(block.tagged)] ?? SLOT_SIZE.portrait!;
    return { ...block, id: 'w' + uuid().replace(/-/g, '').slice(0, 20), width, height };
  });
  // Rows first: a slot is tappable the moment it is drawn.
  await putInlineWaits(slots.map((slot): InlineWait => ({ id: slot.id, tagged: slot.tagged, ...(slot.raw ? { raw: slot.raw } : {}), line: slot.line, characterId, chatId, hostMessageId, createdAt: now })));
  if (!await parkInlineBlocks({ charIndex, chatIndex, messageIndex, hostMessageId }, slots)) return fail('message_changed', '응답 메시지를 찾지 못해 대기 칸을 만들지 않았습니다.');
  return { ok: true, parked: slots.length, wait_ids: slots.map(slot => slot.id) };
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
  const wait = await getInlineWait(id);
  const lines = analysisBody(stored).split('\n').filter(Boolean);
  const before = analysisBody(stored.slice(0, stored.indexOf(`[[@inraywait::${id}::`))).split('\n').filter(Boolean).length;
  const line = Math.max(1, Math.min(lines.length, before || wait?.line || 1));
  if (!lines.length) return fail('bad_request', '이 메시지에는 그릴 본문이 없습니다.');
  return createJob({
    ...body,
    message_role: 'char',
    content_hash: `wait:${id}`,
    assistant_text: lines.slice(0, line).join('\n'),
    stream_line_start: line,
    stream_line_end: line,
    inline_wait: id,
    // A broken block is fixed first; when that fails too, the tagger draws the line.
    ...(wait?.tagged ? { inline_tagged: atLine(wait.tagged, line) } : wait?.raw ? { inline_raw: wait.raw } : {}),
  });
}
