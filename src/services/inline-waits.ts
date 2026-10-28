import type { ApiResult, TaggerResult } from '../core/types';
import { risuHost } from '../core/host';
import { cleanText, toInt } from '../core/util/text';
import { isBlockWaitId, pendingSpinnerIds, pinkSlotIds, waitSlotBlock, waitTokenDimensions } from '../domain/chat-bake';
import { inlineShotBlocks, inlineShotTagged } from '../domain/prompt/inline-shots';
import { analysisBody } from '../domain/prompt/message-body';
import { dropInlineWait, dropInlineWaits, getInlineWait, listInlineWaits } from '../storage/inline-wait-store';
import { parkAbandonedSpinners, parkJobSpinners, readStoredMessageBody } from './chat-bake';
import { dbg } from '../core/debug';
import { ensureInrayDisplayModule } from '../storage/inray-display-module';
import { streamBlockBusy } from './stream-jobs';
import { statedLocation, statedOutfits } from './stream-continuity';
import { getConfig } from './context';
import { createJob, jobRunning, spinnerJobRunning } from './jobs';

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
  let stored = await readStoredMessageBody(body.char_index, body.chat_index, body.message_index);
  // A spinner its job left behind (the page reloaded, the app closed mid-run) is a
  // slot too when its shot was kept: it becomes the pink slot first, then is drawn.
  if (stored != null && !waitTokenDimensions(stored, id) && pendingSpinnerIds(stored).includes(id)) {
    if (spinnerJobRunning(id)) return fail('busy', '이 칸은 아직 만드는 중입니다.');
    if (!await getInlineWait(id)) return fail('not_found', '이 칸의 태그가 남아 있지 않습니다. 태그를 다시 생성해 주세요.');
    await parkJobSpinners({ charIndex: toInt(body.char_index, -1), chatIndex: toInt(body.chat_index, -1), messageIndex: toInt(body.message_index, -1),
      ...(cleanText(body.host_message_id, 200) ? { hostMessageId: cleanText(body.host_message_id, 200) } : {}) }, [id]);
    stored = await readStoredMessageBody(body.char_index, body.chat_index, body.message_index);
  }
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
  // Outfits the message's earlier blocks still state (a baked one is no longer JSON):
  // a slot tapped later follows its own reply, not wherever the chat is now.
  const earlier = blockN ? inlineShotBlocks(stored).filter(row => row.n < blockN).map(row => inlineShotTagged(row.body, 1)) : [];
  const prior = earlier.map(statedOutfits);
  const priorLocation = earlier.map(statedLocation).filter(Boolean).at(-1) || '';
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
    ...(prior.some(list => list.length) ? { inline_prior: prior } : {}),
    ...(priorLocation ? { inline_prior_location: priorLocation } : {}),
  });
}

/**
 * Boot: spinners a job left without their image when the page last closed become
 * their pink slots, read from the kept shots only (no chat is scanned for them). A
 * shot younger than two minutes is left: another device may still be drawing it.
 */
export async function parkLeftSpinners(): Promise<number> {
  const rows = await listInlineWaits();
  if (!rows.length) return 0;
  const { parked, gone } = await parkAbandonedSpinners(rows, spinnerJobRunning, 2 * 60 * 1000);
  if (gone.length) await dropInlineWaits(gone);
  if (parked.length) dbg('wait.spinners.parked', { count: parked.length });
  return rows.length - gone.length;
}

export interface BulkWaitProgress { done: number; total: number; made: number; jobId?: string; finished?: boolean; stopped?: string }
let bulk: BulkWaitProgress | null = null;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * 분홍 칸 꾹 누르기: every pink slot of the message, from the one pressed down to the
 * last, then from the top. One at a time (NovelAI draws one image per key), each from
 * its own shot like a double tap. A slot refused (made already, its job running) is
 * passed; a reply still streaming stops the run, as every slot would be refused.
 */
export async function generateAllInlineWaits(body: Record<string, unknown>, progress: (state: BulkWaitProgress) => void = () => {}): Promise<ApiResult> {
  if (getConfig().card?.power === false) return fail('power_off', 'Power가 OFF 상태입니다.');
  if (bulk) return fail('busy', `이미 분홍 칸을 만드는 중입니다 (${bulk.done}/${bulk.total})`);
  const stored = await readStoredMessageBody(body.char_index, body.chat_index, body.message_index);
  const ids = stored == null ? [] : pinkSlotIds(stored);
  if (!ids.length) return fail('not_found', '이 메시지에는 분홍 칸이 없습니다.');
  const from = Math.max(0, ids.indexOf(cleanText(body.wait_id, 64)));
  const order = [...ids.slice(from), ...ids.slice(0, from)];
  const state: BulkWaitProgress = bulk = { done: 0, total: order.length, made: 0 };
  void (async () => {
    try {
      for (const id of order) {
        const started = await generateInlineWait({ ...body, wait_id: id }) as { ok?: boolean; job_id?: unknown; error?: { code?: unknown; message?: unknown } };
        const code = started.error?.code;
        if (!started.ok && code === 'busy' && /답변이 끝난 뒤/.test(String(started.error?.message))) { state.stopped = '답변이 끝난 뒤 다시 눌러 주세요.'; break; }
        if (started.ok && started.job_id) {
          state.jobId = String(started.job_id); progress({ ...state });
          while (jobRunning(state.jobId)) await sleep(300);
        }
        state.done++; progress({ ...state });
      }
      // Made is what the message shows: a slot whose job failed is still pink.
      const after = await readStoredMessageBody(body.char_index, body.chat_index, body.message_index);
      const left = new Set(after == null ? order : pinkSlotIds(after));
      state.made = order.filter(id => !left.has(id)).length;
    } catch (error) { state.stopped = String((error as Error)?.message || error); dbg('wait.bulk.fail', { message: state.stopped }, 'warn'); }
    finally { bulk = null; state.finished = true; progress({ ...state }); }
  })();
  return { ok: true, total: order.length, ids: order };
}
