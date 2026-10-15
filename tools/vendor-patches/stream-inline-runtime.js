// Streaming tag generation: each closed [[inxN]] block the chat model writes is
// one line-batch job that skips the tagger. Group, toast, commit and bake are
// the line-batch path; the block's own position is its slot.
function omniStreamMode(card) {
  return card?.stream_inline_tags === true ? 'inline' : card?.stream_lines_enabled ? 'lines' : 'keywords';
}
function omniScanInlineRun(run, final=false) {
  const SK=globalThis.__INLAY_STREAM_KW__;
  run.inlineSeen ||= new Set();
  // Only text that arrived since the last tick can close a new block.
  const fresh=SK.inlineShotBlocks(run.text).filter(block=>!run.inlineSeen.has(block.n));
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
    const batch={start:line,end:line,text,task:null,payload:null,jobId:'',inline:{n:block.n,tagged}};
    run.batches.push(batch);run.fired=true;
    batch.task=omniStartKeywordJob(run,text,batch).catch(error=>{y('error','stream.inline.start',String(error));return null;});
  }
  return run;
}
