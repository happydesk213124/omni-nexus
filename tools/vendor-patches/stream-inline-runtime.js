// Streaming tag generation: each closed [[inxN]] block the chat model writes is
// one line-batch job that skips the tagger. Group, toast, commit and bake are
// the line-batch path; the block's own position is its slot.
function omniStreamMode(card) {
  return card?.stream_inline_tags === true ? 'inline' : card?.stream_lines_enabled ? 'lines' : 'keywords';
}
// A tapped waiting slot is an ordinary job; the frozen poller shows its toast.
function omniTrackJob(sessionId,jobId) {if(!jobId || t.unloading)return;t.activeJobId=jobId;ua(sessionId,jobId,'');}
function omniInlineAutogen(card) { return card?.stream_inline_autogen!==false; }
function omniScanInlineRun(run, final=false) {
  const SK=globalThis.__INLAY_STREAM_KW__;
  // 「이미지 바로 생성」 off: nothing starts while streaming; completion parks every block.
  const parked=!omniInlineAutogen(t.backendSettings?.card);
  if(parked && !final)return run;
  run.inlineSeen ||= new Set();
  // Only text that arrived since the last tick can close a new block.
  // Reasoning is never a slot; while streaming, an unclosed <Thoughts> counts as reasoning.
  const fresh=SK.inlineShotBlocks(run.text,{live:!final}).filter(block=>!run.inlineSeen.has(block.n));
  if(!fresh.length)return run;
  if(!final && !run.identity) {
    if(!run.target) {
      const target=omniCaptureKeywordTarget().catch(error=>{y('warn','stream.inline.target',String(error));return null;});
      run.target=target;
      void target.then(value=>{
        if(run.target!==target || run.cancelled || run.committing)return;
        if(!value){run.target=null;return;}
        run.identity=value;run.targetResolved=true;
        omniScanInlineRun(run);
      });
    }
    return run;
  }
  for(const block of fresh) {
    // L numbers count prose only. A block before any prose waits for its line.
    const line=SK.inlineShotLine(run.text,block);
    if(line<1 && !final)continue;
    run.inlineSeen.add(block.n);
    const text=SK.analysisBody(run.text.slice(0,block.start));
    if(!text)continue;
    // A broken block keeps its slot: the job asks the tagger for that one shot.
    const tagged=SK.inlineShotTagged(block.body,line);
    const batch={start:line,end:line,text,task:null,payload:null,jobId:'',inline:{n:block.n,tagged},parked};
    run.batches.push(batch);run.fired=true;
    if(!parked)batch.task=omniStartKeywordJob(run,text,batch).catch(error=>{y('error','stream.inline.start',String(error));return null;});
  }
  return run;
}
// Every block becomes a waiting (pink) slot in one write; a tap generates it later.
function omniParkInlineReply(run,arg,text,key) {
  omniKeywordSeen.add(key);
  if(omniKeywordSeen.size>128)omniKeywordSeen.delete(omniKeywordSeen.values().next().value);
  run.committing=true;clearTimeout(run.expiry);
  void Promise.resolve(run.target).then(async target=>{
    if(!target || run.cancelled || t.unloading)return;
    const scope=target.scope;
    const result=await K('/v1/inline-tags/park',{method:'POST',body:{character_id:scope.characterId,chat_id:scope.chatId,char_index:scope.charIndex,chat_index:scope.chatIndex,
      host_message_id:target.id,message_index:arg.messageIndex,assistant_text:text,blocks:run.batches.map(batch=>({n:batch.inline.n,line:batch.start,tagged:batch.inline.tagged || null}))}});
    if(!result?.ok)throw Error(result?.error?.message || '대기 칸을 만들지 못했습니다.');
    run.committed=true;
    globalThis.__OMNI_WAIT_TAPS__?.sync?.();
  }).catch(error=>{y('error','stream.inline.park',String(error));})
    .finally(()=>{if(omniKeywordRun===run)omniKeywordRun=null;});
  return true;
}
