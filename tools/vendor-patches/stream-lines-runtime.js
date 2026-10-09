function omniScanLineRun(run, final=false) {
  const card=t.backendSettings?.card || {};
  const result=run.lineBatcher.scan(run.text,card.stream_lines_count || 30,parsedStreamKeywords(card),final);
  if(result.reset && run.batches.length) {
    const text=run.text,activeAt=run.activeAt,target=final?run.target:undefined;
    omniCancelKeywordRun(run);
    omniKeywordRun=run=omniNewKeywordRun(target);run.text=text;run.activeAt=activeAt;
    if(!final)omniArmKeywordExpiry(run);
    return omniScanLineRun(run,final);
  }
  for(const range of result.batches) {
    if(messageBodyChars(range.text)<=30)continue;
    const batch={...range,task:null,payload:null,jobId:''};
    run.batches.push(batch);run.fired=true;
    batch.task=omniStartKeywordJob(run,range.text,batch).catch(error=>{
      y('error','stream.lines.start',String(error));return null;
    });
  }
  return run;
}
function omniCommitLineReply(arg,msg,text,key) {
  if(t.unloading || t.backendSettings?.card?.power===false){omniCancelKeywordRun();return false;}
  const characterId=String(arg.char?.chaId || arg.char?.id || ''),chatId=String(arg.chat?.id || arg.chat?.chatId || '');
  const id=String(msg.chatId || msg.id || '');
  let run=omniKeywordRun;
  if(!id || !characterId || !chatId)return false;
  if(run?.identity && (run.identity.scope.characterId!==characterId || run.identity.scope.chatId!==chatId || run.identity.id!==id))return false;
  if(run?.targetResolved && !run.identity){omniCancelKeywordRun(run);run=null;}
  if(run && !run.lineMode){omniCancelKeywordRun(run);run=null;}
  if(!run)omniKeywordRun=run=omniNewKeywordRun();
  // Short replies (or a final burst before the scan window) have no captured
  // streaming target. Use the committed event, with the same identity check.
  if(!run.target)run.target=Promise.resolve().then(async()=>{
    const scope=await Z({useOverride:false});
    if(scope.characterId!==characterId || scope.chatId!==chatId)return null;
    return omniKeywordIdentity({...scope,chat:arg.chat},arg.messageIndex);
  }).then(value=>{run.identity=value;run.targetResolved=true;return value;});
  stopStreamKeywordTick();run.text=text;
  run=omniScanLineRun(run,true);
  omniKeywordSeen.add(key);
  if(omniKeywordSeen.size>128)omniKeywordSeen.delete(omniKeywordSeen.values().next().value);
  // A below-threshold reply is deliberately handled; do not fall through to
  // ordinary auto-generation and bypass the user's per-line count and cutoff.
  if(!run.batches.length){omniCancelKeywordRun(run);return true;}
  run.committing=true;clearTimeout(run.expiry);
  void Promise.all(run.batches.map(batch=>batch.task)).then(async targets=>{
    if(run.cancelled || t.unloading)return;
    const accepted=run.batches.filter((batch,i)=>batch.payload && targets[i]);
    if(!accepted.length)return;
    if(targets.some(target=>target && (target.scope.characterId!==characterId || target.scope.chatId!==chatId || target.id!==id))) {
      omniCancelKeywordRun(run);return;
    }
    const result=await K('/v1/jobs/commit-output',{method:'POST',body:{...accepted[0].payload,
      job_ids:accepted.map(batch=>batch.jobId),message_index:arg.messageIndex,assistant_text:text,content_hash:ye(text)}});
    if(!result?.ok)throw Error(result?.error?.message || '줄 단위 이미지 부착 실패');
    run.committed=true;
    omniPollLineJobs(run.identity.scope.sessionId,result.job_ids || accepted.map(batch=>batch.jobId),ye(text));
  }).catch(error=>{omniCancelKeywordRun(run);y('error','stream.lines.commit',String(error));})
    .finally(()=>{if(omniKeywordRun===run)omniKeywordRun=null;});
  return true;
}
// The frozen poller owns one job ID. A line group needs one shared timer so an
// earlier slow tagger still refreshes the gallery after a later batch finishes.
function omniPollLineJobs(sessionId,ids,hash) {
  const waiting=new Set(ids);let previous='',timer;
  if(t.pollTimer)clearInterval(t.pollTimer);
  const poll=async()=>{
    if(t.unloading || t.pollTimer!==timer)return;
    const jobs=await Promise.all([...waiting].map(async id=>{
      try {const job=await K(`/v1/jobs/${id}`,{method:'GET'},15000);return {id,job};}
      catch {return {id,job:null};}
    }));
    if(t.unloading || t.pollTimer!==timer)return;
    for(const {id,job} of jobs)if(job && (['done','error','cancelled'].includes(job.state) || job.error?.code==='not_found'))waiting.delete(id);
    const stamp=JSON.stringify(jobs.map(({id,job})=>[id,job?.state,job?.progress?.shot_done]));
    const active=jobs.find(({id})=>waiting.has(id));
    t.activeJobId=active?.id || '';
    t.jobProgress=active?.job?.ok ? {...active.job.progress,state:active.job.state,jobId:active.id} : null;
    if(stamp!==previous) {
      previous=stamp;
      try {await ce(sessionId,true);await onSelectionChanged(waiting.size?'content':'full');await Se();}
      catch(error){y('warn','stream.lines.refresh',String(error));}
    }
    if(t.pollTimer!==timer)return;
    if(waiting.size) t.pollTimer=timer=setTimeout(poll,1000);
    else {t.pollTimer=null;t.jobsInFlight?.delete(hash);}
  };
  t.pollTimer=timer=setTimeout(poll,1);
}
