export interface ProgressToastJob {
  state?: unknown;
  jobId?: unknown;
  kind?: unknown;
  message?: unknown;
  shot_count?: unknown;
  shot_done?: unknown;
  shot_index?: unknown;
  shot_failed?: unknown;
  phase?: unknown;
  batch_count?: unknown;
  batch_done?: unknown;
  batch_failed?: unknown;
}

const count = (n: unknown): number => Number.isFinite(Number(n)) ? Math.max(0, Math.floor(Number(n))) : 0;

/** Percentages from tagging and reroll are estimates, not completed work. */
export function progressToastView(job: ProgressToastJob, elapsedMs = 0) {
  const state = String(job.state || '');
  const message = String(job.message || '').trim();
  const reroll = job.kind === 'reroll' || job.jobId === 'reroll';
  const terminal = ['done', 'error', 'cancelled'].includes(state);
  const total = count(job.shot_count);
  const done = Math.min(total, count(job.shot_done));
  const failed = count(job.shot_failed);
  const current = Math.min(total, Math.max(done + 1, count(job.shot_index) + 1));
  let title = '작업 준비 중';
  let detail = '';
  if (state === 'preparing' || state === 'queued') title = reroll ? '이미지 재생성 준비 중' : '장면 정리 중';
  else if (state === 'tagging') {
    title = /재시도/.test(message) ? '장면 분석 다시 시도 중'
      : /캐릭터.*룩|외형/.test(message) ? '캐릭터 외형 확인 중'
      : /만화.*레이아웃/.test(message) ? '만화 구성 중' : '장면 분석 중';
  } else if (state === 'generating' || state === 'running') {
    title = /반영 중/.test(message) ? '이미지 반영 중'
      : /nai\.read_bytes/.test(message) ? '이미지 받는 중'
      : /생성 준비/.test(message) ? '이미지 생성 준비 중'
      : reroll ? '이미지 재생성 중' : '이미지 생성 중';
    if (total) detail = done >= total ? `${done}장 생성됨 · 마무리 중` : `${current} / ${total}장 · ${done}장 완료`;
  } else if (state === 'done') {
    const stopped = /사용자.*중단/.test(message);
    title = failed ? '일부 이미지 재생성 실패' : stopped ? '생성 중단됨' : reroll ? '재생성 완료' : '생성 완료';
    if (total) detail = failed ? `${done}장 완료 · ${failed}장 실패` : `${stopped ? done : total}장 ${stopped ? '유지' : '완료'}`;
  } else if (state === 'cancelled') {
    title = /사용자.*중단/.test(message) ? (reroll ? '재생성 중단됨' : '생성 중단됨') : '생성 취소됨';
    if (done) detail = `${done} / ${total}장 완료`;
  } else if (state === 'error') {
    title = reroll ? '재생성 실패' : '생성 실패';
    detail = message.split('\n')[0].slice(0, 180) || '설정을 확인한 뒤 다시 시도해 주세요.';
  }
  const elapsed = Math.max(0, Math.floor(elapsedMs / 5000) * 5);
  const clock = !terminal && elapsed >= 5
    ? elapsed < 60 ? `${elapsed}초` : `${Math.floor(elapsed / 60)}분 ${elapsed % 60}초` : '';
  const lineMode=job.kind==='stream-lines';
  if(lineMode) {
    const phase=String(job.phase || ''),batches=count(job.batch_count),tagged=count(job.batch_done),errors=count(job.batch_failed);
    title=state==='done' ? (total ? '선행 생성 완료' : '선행 생성 이미지 생략')
      : state==='error' ? '선행 생성 일부 실패'
      : state==='cancelled' ? '선행 생성 취소됨'
      : phase==='streaming' ? '줄 단위 선행 생성 중'
      : phase==='waiting_tags' ? '남은 구간 태깅 중'
      : phase==='waiting_insert' ? '이미지·스피너 삽입 준비 중'
      : phase==='finalizing' ? '최종 이미지 반영 중' : '선행 이미지 생성 중';
    detail=`태깅 ${tagged}/${batches}구간 · 이미지 ${done}/${total}장`;
    if(phase==='streaming')detail+=' · 응답 출력 중';
    if(errors)detail+=` · ${errors}구간 실패`;
  }
  const success = state === 'done' && !failed && !/사용자.*중단/.test(message);
  const measured = success || (total > 0 && (state === 'generating' || state === 'running') && (!lineMode || ['generating','finalizing'].includes(String(job.phase))));
  const ratio = success ? 1 : measured ? done / total : 0;
  const tone = state === 'error' || (terminal && failed > 0) ? 'error' : success ? 'success' : terminal ? 'muted' : 'busy';
  return { title, detail, clock, terminal, tone, measured, ratio,
    showRail: !terminal || success, announcement: [title, detail].filter(Boolean).join(' · ') };
}

/** Total work may grow while the reply streams; never invent a completion percent. */
export function aggregateStreamLineProgress(rows: Array<{state?:unknown;progress?:Record<string,unknown>}>, flags:{batchCount:number;outputComplete:boolean;committed:boolean}) {
  const groups=rows.map(row=>row.progress?.line_group).filter((v):v is Record<string,unknown>=>!!v && typeof v==='object');
  const max=(key:string)=>Math.max(0,...groups.map(group=>count(group[key])));
  const batches=Math.max(flags.batchCount,max('batches'));
  const tagged=Math.min(batches,Math.max(max('tagged'),rows.filter(row=>!['queued','tagging'].includes(String(row.state))).length));
  const total=groups.length ? max('total') : rows.reduce((n,row)=>n+count(row.progress?.shot_count),0);
  const done=Math.min(total,groups.length ? max('done') : rows.reduce((n,row)=>n+count(row.progress?.shot_done),0));
  const failed=Math.max(max('failed'),rows.filter(row=>row.state==='error').length);
  const finished=flags.outputComplete && flags.committed && rows.length>=batches && rows.every(row=>['done','error','cancelled'].includes(String(row.state)));
  const phase=!flags.outputComplete ? 'streaming' : tagged<batches ? 'waiting_tags' : !flags.committed ? 'waiting_insert' : done<total ? 'generating' : 'finalizing';
  return {kind:'stream-lines',state:finished ? failed?'error':'done' : 'generating',phase,batch_count:batches,batch_done:tagged,batch_failed:failed,shot_count:total,shot_done:done};
}

// High background opacity preserves white-text contrast over bright images.
// No blur, continuous animation, layout reads, or CSS injection in the host.
export const progressToastStyles = {
  card: 'box-sizing:border-box;width:100%;padding:10px 12px;border-radius:12px;background:rgba(0,0,0,.86);color:#fff;border:1px solid rgba(255,255,255,.16);box-shadow:0 4px 16px rgba(0,0,0,.24);font-family:IBM Plex Sans,Helvetica Neue,Helvetica,Arial,Noto Sans KR,sans-serif;user-select:none;',
  header: 'display:flex;align-items:center;gap:8px;min-height:18px;',
  title: 'flex:1;min-width:0;color:#fff;font-size:12px;font-weight:600;line-height:18px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;',
  clock: 'flex:none;color:#fff;font-size:11px;line-height:18px;font-variant-numeric:tabular-nums;',
  detail: 'margin-top:3px;color:#fff;font-size:11px;line-height:16px;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;',
  rail: 'margin-top:8px;height:3px;overflow:hidden;border-radius:2px;background:rgba(255,255,255,.18);',
  fill: 'display:block;height:100%;width:100%;transform-origin:left;border-radius:2px;',
};
