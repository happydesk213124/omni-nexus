import { dbg } from '../core/debug';
import { uuid } from '../core/util/text';
import { attachBakeToSpinner, removeJobSpinners, replaceSpinner, spinnerDimensions, spinnerToken, stripBakeTokensExceptJobs, waitToken } from '../domain/chat-bake';
import { replaceInlineShotBlock, stripInlineShotBlocks } from '../domain/prompt/inline-shots';
import { ensureInrayDisplayModule } from '../storage/inray-display-module';
import { putInlineWaits } from '../storage/inline-wait-store';
import { getConfig } from './context';
import { rewriteMessageById, shotBakeToken, type jobChatTarget, type LineBakeBatch } from './chat-bake';

/**
 * Streaming tags keep the line-batch timing (one write when the reply ends, one
 * when every image is done) but not its checks. The block itself is the slot, so
 * the reply text is never compared: line batches compare it because they place
 * by L number, which an edited reply would shift. Each image goes to its own
 * spinner or block; one that has neither is left out alone, never with the rest.
 * A block that ends with no image (broken JSON, a failed or cancelled request)
 * becomes a pink waiting slot holding its shot, so a tap makes exactly it.
 */
export async function writeInlineGroupSlots(target: ReturnType<typeof jobChatTarget>, batches: LineBakeBatch[], final = false): Promise<{ written: boolean; unplaced: number }> {
  if (!batches.some(batch => batch.shots.length)) return { written: true, unplaced: 0 };
  const card = getConfig().card;
  if (!final) await ensureInrayDisplayModule(card.persist_chat_images_folded === true, card.inline_chat_scale_pct, { enabled: card.inline_msg_fan === true, userchat: card.userchat === true });
  const key = (jobId: string, shot: number) => `${jobId}_${shot}`;
  const tokens = new Map<string, string>();
  for (const batch of batches) for (const shot of batch.shots) {
    const cardId = batch.completed.get(shot.shot_index); if (!cardId) continue;
    // A missing asset holds back only this slot; the final save tries it again.
    const token = await shotBakeToken(cardId, shot.width, shot.height).catch(() => '');
    if (token) tokens.set(key(batch.jobId, shot.shot_index), token);
  }
  // Rows first, as for parked slots: a pink slot is tappable the moment it is drawn.
  const waits = new Map<string, string>();
  if (final) {
    const rows = batches.filter(batch => batch.retry && !batch.completed.size).flatMap(batch => batch.shots.map(shot => {
      const id = 'w' + uuid().replace(/-/g, '').slice(0, 20);
      waits.set(key(batch.jobId, shot.shot_index), id);
      return { id, tagged: batch.retry!.tagged, ...(batch.retry!.raw && !batch.retry!.tagged ? { raw: batch.retry!.raw } : {}), line: batch.retry!.line,
        characterId: batch.retry!.characterId, chatId: batch.retry!.chatId, hostMessageId: target.hostMessageId || '', createdAt: Date.now() };
    }));
    if (rows.length) await putInlineWaits(rows).catch(error => { waits.clear(); dbg('inline.bake.wait_fail', { message: String((error as Error)?.message || error).slice(0, 200) }, 'warn'); });
  }
  const missing: Array<{ job: string; n?: number; reason: string }> = [];
  const written = await rewriteMessageById(target, body => {
    missing.length = 0;
    let next = final ? body : stripBakeTokensExceptJobs(body, batches.map(batch => batch.jobId));
    for (const batch of batches) {
      for (const shot of batch.shots) {
        const token = tokens.get(key(batch.jobId, shot.shot_index)) || '', made = batch.completed.has(shot.shot_index);
        const wait = waits.get(key(batch.jobId, shot.shot_index));
        if (wait) {
          const size = spinnerDimensions(next, batch.jobId, shot.shot_index), pink = waitToken(wait, size?.width ?? shot.width, size?.height ?? shot.height);
          next = size ? replaceSpinner(next, batch.jobId, shot.shot_index, pink) : Number.isInteger(shot.inline_block) ? replaceInlineShotBlock(next, shot.inline_block!, pink) : next;
          continue;
        }
        if (spinnerDimensions(next, batch.jobId, shot.shot_index)) {
          if (token) next = attachBakeToSpinner(next, batch.jobId, shot.shot_index, token);
        } else if (Number.isInteger(shot.inline_block) && (token || !final)) {
          // The first write missed this block, or it never ran: the block still marks the place.
          const placed = replaceInlineShotBlock(next, shot.inline_block!, spinnerToken(batch.jobId, shot.shot_index, shot.width, shot.height) + token);
          if (placed === next && final) missing.push({ job: batch.jobId, n: shot.inline_block, reason: 'no slot' });
          next = placed;
        } else if (final && token) missing.push({ job: batch.jobId, reason: 'no slot' });
        if (final && made && !token) missing.push({ job: batch.jobId, n: shot.inline_block, reason: 'no asset' });
      }
      if (final) next = removeJobSpinners(next, batch.jobId);
    }
    // Blocks no job placed (broken, cancelled) never stay in the saved reply.
    return final ? stripInlineShotBlocks(next) : next;
  });
  for (const row of written ? missing : []) dbg('inline.bake.unplaced', { job_id: row.job, block: row.n ?? '', reason: row.reason }, 'warn');
  return { written, unplaced: written ? missing.length : 0 };
}
