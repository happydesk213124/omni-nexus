import type { ApiResult, JobRequest } from '../core/types';
import { risuHost } from '../core/host';
import { analysisBody } from '../domain/prompt/message-body';
import { stripBakeTokens } from '../domain/chat-bake';
import { getConfig, jobRunMeta, jobLlmControllers } from './context';

type Pending = {
  request: JobRequest;
  committed: boolean;
  cancelled: boolean;
  ready: Promise<void>;
  resolve: () => void;
  attach?: () => Promise<void>;
  committing?: Promise<ApiResult>;
};
const pending = new Map<string, Pending>();

export function registerStreamJob(id: string, request: JobRequest): void {
  if (!request.defer_attachment) return;
  let resolve!: () => void;
  const ready = new Promise<void>(r => { resolve = r; });
  pending.set(id, { request, committed: false, cancelled: false, ready, resolve });
}
export function streamJob(id: string): Pending | undefined { return pending.get(id); }
export function closeStreamJob(id: string): void { pending.get(id)?.resolve(); pending.delete(id); }
export function cancelStreamJob(id: string): void {
  const row = pending.get(id);
  if (row) {
    row.cancelled = true; row.resolve();
    const meta = jobRunMeta.get(id);
    if (meta) { meta.cancelRequested = true; meta.userStop = true; }
    jobLlmControllers.get(id)?.abort();
  }
}
export function streamOwnsMessage(request: Partial<JobRequest>): string | undefined {
  for (const [id, row] of pending) if (!row.cancelled &&
    row.request.character_id === request.character_id && row.request.chat_id === request.chat_id &&
    row.request.host_message_id === request.host_message_id && request.host_message_id) return id;
}

/** Completion binds exact host identity, never a similarity search across chat history. */
export async function commitStreamOutput(input: Record<string, unknown>): Promise<ApiResult> {
  const id = String(input.job_id || ''), row = pending.get(id);
  if (!row) return { ok: false, error: { code: 'not_pending', message: '대기 중인 선행 작업이 없습니다.' } };
  const request = row.request;
  if (input.stream_id !== request.stream_id || input.character_id !== request.character_id ||
      input.chat_id !== request.chat_id || input.host_message_id !== request.host_message_id) {
    return { ok: false, error: { code: 'identity_mismatch', message: '응답 대상이 일치하지 않습니다.' } };
  }
  if (input.cancel === true) { cancelStreamJob(id); return { ok: true, cancelled: true }; }
  if (row.cancelled) return { ok: false, error: { code: 'cancelled', message: '취소된 선행 작업입니다.' } };
  if (row.committing) return row.committing;
  if (row.committed) return { ok: true, committed: true, job_id: id };
  row.committing = (async () => {
    const index = Number(input.message_index);
    const host = risuHost();
    const character = await host?.getCharacterFromIndex?.(Number(request.char_index));
    const chat = await host?.getChatFromIndex?.(Number(request.char_index), Number(request.chat_index));
    const msg = Number.isInteger(index) && index >= 0 ? chat?.message?.[index] : null;
    const body = String(msg?.data ?? '');
    if (row.cancelled || getConfig().card.power === false || !msg ||
        String(character?.chaId || character?.id || '') !== request.character_id ||
        !['char','assistant','bot'].includes(String(msg.role)) ||
        String(chat?.id || chat?.chatId || '') !== request.chat_id ||
        String(msg.chatId || msg.id || '') !== request.host_message_id ||
        body !== String(input.assistant_text ?? '') ||
        !analysisBody(stripBakeTokens(body)).startsWith(String(request.assistant_text || ''))) {
      cancelStreamJob(id);
      return { ok: false, error: { code: 'message_changed', message: '본문 또는 대상이 변경되어 선행 이미지 부착을 취소했습니다.' } };
    }
    request.message_index = index;
    request.content_hash = String(input.content_hash || request.content_hash || '');
    const meta = jobRunMeta.get(id);
    if (meta) { meta.messageIndex = index; meta.saveContentHash = request.content_hash; meta.saveAssistantPreview = body; }
    row.committed = true;
    // Resolve even if placement fails: the runner must not leak an active lock.
    try { await row.attach?.(); } finally { row.resolve(); }
    return { ok: true, committed: true, job_id: id };
  })();
  return row.committing;
}
