import type { ApiResult, JobRequest } from '../core/types';
import { risuHost } from '../core/host';
import { analysisBody } from '../domain/prompt/message-body';
import { streamLineRange } from '../domain/prompt/stream-lines';
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
  siblings: Set<string>;
  closed: Set<string>;
  cancelledReady: Promise<void>;
  resolveCancelled: () => void;
  imageQueue: Map<string, Promise<void>>;
};
const pending = new Map<string, Pending>();

export function registerStreamJob(id: string, request: JobRequest): void {
  if (!request.defer_attachment) return;
  let resolve!: () => void;
  const ready = new Promise<void>(r => { resolve = r; });
  let resolveCancelled!: () => void;
  const cancelledReady = new Promise<void>(r => { resolveCancelled = r; });
  const sibling=[...pending.values()].find(row=>!row.cancelled && row.request.stream_id===request.stream_id &&
    row.request.host_message_id===request.host_message_id && row.request.character_id===request.character_id &&
    row.request.chat_id===request.chat_id && row.request.session_id===request.session_id);
  const siblings=sibling?.siblings ?? new Set<string>();siblings.add(id);
  pending.set(id, { request, committed: false, cancelled: false, ready, resolve, siblings,
    closed:sibling?.closed ?? new Set(), cancelledReady, resolveCancelled, imageQueue:sibling?.imageQueue ?? new Map() });
}
export function streamJob(id: string): Pending | undefined { return pending.get(id); }
export function closeStreamJob(id: string): void {
  const row=pending.get(id);
  row?.closed.add(id);row?.resolve();pending.delete(id);
}
/** Taggers overlap; paid generation by sibling jobs shares one slot per API key. */
export function runStreamImageTask<T>(id:string,key:string,work:()=>Promise<T>):Promise<T> {
  const row=pending.get(id);
  if(!row || !streamLineRange(row.request))return work();
  const before=row.imageQueue.get(key) ?? Promise.resolve();
  const next=Promise.race([before,row.cancelledReady]).then(()=>{
    if(row.cancelled)throw new DOMException('선행 생성이 취소되었습니다.','AbortError');
    return work();
  });
  // Cancelling a queued caller releases its runtime immediately, but a third
  // sibling must still wait for the paid request already using this key.
  const tail=Promise.all([before,next.catch(()=>{})]).then(()=>{});row.imageQueue.set(key,tail);
  return next.finally(()=>{if(row.imageQueue.get(key)===tail)row.imageQueue.delete(key);});
}
export function cancelStreamJob(id: string): void {
  const row = pending.get(id);
  if (row) {
    row.cancelled = true; row.resolve(); row.resolveCancelled();
    const meta = jobRunMeta.get(id);
    if (meta) { meta.cancelRequested = true; meta.userStop = true; }
    jobLlmControllers.get(id)?.abort();
  }
}
export function streamOwnsMessage(request: Partial<JobRequest>): string | undefined {
  for (const [id, row] of pending) if (!row.cancelled &&
    row.request.character_id === request.character_id && row.request.chat_id === request.chat_id &&
    row.request.host_message_id === request.host_message_id && request.host_message_id) {
      const a=streamLineRange(row.request), b=streamLineRange(request);
      if (a && b && row.request.stream_id===request.stream_id &&
          row.request.session_id===request.session_id && (a.end<b.start || b.end<a.start)) continue;
      return id;
    }
}

/** Completion binds exact host identity, never a similarity search across chat history. */
export async function commitStreamOutput(input: Record<string, unknown>): Promise<ApiResult> {
  const ids=Array.isArray(input.job_ids) ? [...new Set(input.job_ids.map(String))] : [String(input.job_id || '')];
  // Terminal storage rows can be pruned by another sibling's progress write.
  // Retain only closed IDs in the live group, never the finished request body.
  if(Array.isArray(input.job_ids)) {
    const live=ids.map(id=>pending.get(id)).find(row=>row!==undefined);
    for(let i=ids.length-1;i>=0;i--)if(!pending.has(ids[i])) {
      if(!live?.closed.has(ids[i]))
        return {ok:false,error:{code:'not_pending',message:'선행 묶음 작업을 찾을 수 없습니다.'}};
      ids.splice(i,1);
    }
    if(!ids.length)return {ok:true,committed:true,job_ids:[]};
  }
  const id=ids[0], row=pending.get(id);
  if (!row) return { ok: false, error: { code: 'not_pending', message: '대기 중인 선행 작업이 없습니다.' } };
  const rows=ids.map(id=>pending.get(id));
  if(rows.some(value=>!value))return {ok:false,error:{code:'not_pending',message:'선행 묶음 작업을 찾을 수 없습니다.'}};
  const group=rows as Pending[];
  const request = row.request;
  if (group.some(({request:r})=>input.stream_id!==r.stream_id || input.character_id!==r.character_id ||
      input.chat_id!==r.chat_id || input.host_message_id!==r.host_message_id || r.session_id!==request.session_id)) {
    return { ok: false, error: { code: 'identity_mismatch', message: '응답 대상이 일치하지 않습니다.' } };
  }
  if (input.cancel === true) { ids.forEach(cancelStreamJob); return { ok: true, cancelled: true }; }
  if (group.some(r=>r.cancelled)) return { ok: false, error: { code: 'cancelled', message: '취소된 선행 작업입니다.' } };
  if (row.committing) return row.committing;
  if (row.committed) return { ok: true, committed: true, job_id: id, job_ids: ids };
  row.committing = (async () => {
    const index = Number(input.message_index);
    const host = risuHost();
    const character = await host?.getCharacterFromIndex?.(Number(request.char_index));
    const chat = await host?.getChatFromIndex?.(Number(request.char_index), Number(request.chat_index));
    const msg = Number.isInteger(index) && index >= 0 ? chat?.message?.[index] : null;
    const body = String(msg?.data ?? '');
    if (group.some(r=>r.cancelled) || getConfig().card.power === false || !msg ||
        String(character?.chaId || character?.id || '') !== request.character_id ||
        !['char','assistant','bot'].includes(String(msg.role)) ||
        String(chat?.id || chat?.chatId || '') !== request.chat_id ||
        String(msg.chatId || msg.id || '') !== request.host_message_id ||
        body !== String(input.assistant_text ?? '') ||
        group.some(r=>!analysisBody(stripBakeTokens(body)).startsWith(String(r.request.assistant_text || '')))) {
      ids.forEach(cancelStreamJob);
      return { ok: false, error: { code: 'message_changed', message: '본문 또는 대상이 변경되어 선행 이미지 부착을 취소했습니다.' } };
    }
    // Bind all siblings before the first write changes the host message body.
    group.forEach((row,i)=>{
      row.request.message_index=index;
      row.request.content_hash=String(input.content_hash || row.request.content_hash || '');
      const meta=jobRunMeta.get(ids[i]);
      if(meta){meta.messageIndex=index;meta.saveContentHash=row.request.content_hash;meta.saveAssistantPreview=body;}
      row.committed=true;
    });
    // Resolve even if placement fails: the runner must not leak an active lock.
    const attachments=await Promise.allSettled(group.map(async row=>{
      try {await row.attach?.();} finally {row.resolve();}
    }));
    const failed=attachments.find(r=>r.status==='rejected');
    if(failed?.status==='rejected')throw failed.reason;
    return { ok: true, committed: true, job_id: id, job_ids: ids };
  })();
  group.forEach(r=>{r.committing=row.committing;});
  return row.committing;
}
