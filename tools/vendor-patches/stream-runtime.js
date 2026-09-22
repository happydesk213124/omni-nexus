// One snapshot per activity window, shared by footer and reading-position work.
const omniStream = {paused:false, scope:null, at:0, attemptAt:0, pending:null, timer:0, epoch:0};
const omniPerf = {scopeReads:0, footerPasses:0, viewerPasses:0, released:0};
async function omniRelease(value) {
  if (!value) return;
  try { if (typeof value.release === 'function') { await value.release(); omniPerf.released++; } } catch {}
}
function omniDomScope() {
  const refs = new Set();
  return {
    own(value) { if(value)refs.add(value); return value; },
    keep(value) { refs.delete(value); return value; },
    async all(raw) {
      try { const rows=await nxUnwrapSafeNodes(raw); for(const row of rows)if(row)refs.add(row); return rows; }
      finally { await omniRelease(raw); }
    },
    async close() { for(const ref of refs)await omniRelease(ref); refs.clear(); }
  };
}
function omniStreamArm() {
  if (omniStream.timer || t.unloading || !omniStream.paused) return;
  omniStream.timer=setTimeout(()=>{
    omniStream.timer=0;
    void omniReadScope(true).catch(()=>{}).finally(omniStreamArm);
  },1000);
}
let omniObserverWork=Promise.resolve();
function omniStreamObservers() {
  omniObserverWork=omniObserverWork.catch(()=>{}).then(omniApplyStreamObservers);
  return omniObserverWork;
}
async function omniApplyStreamObservers() {
  if(t.unloading)return;
  // Preview repaint keeps its existing observer while there are live previews.
  // Without previews there is no reason to marshal every streaming mutation.
  if(omniFooterObserver && omniFooterRoot) {
    if(!nxSpinnerPreviews.size)await omniFooterObserver.disconnect();
    else await omniFooterObserver.observe(omniFooterRoot,{childList:true,subtree:true});
  }
  if(nxFloatObserver) {
    await nxFloatObserver.disconnect();
    if(!t.unloading && !omniStream.paused && nxFloatWatchRoot)await nxFloatObserver.observe(nxFloatWatchRoot,{childList:true,subtree:true,attributes:true,attributeFilter:['src','data-inlay-inline-shot','x-inlay-inline-shot']});
  }
}
function omniSetStreaming(paused) {
  const changed=omniStream.paused!==paused;
  omniStream.paused=paused;
  if(paused) {
    clearTimeout(omniFooterTimer);omniFooterTimer=0;omniFooterQueued=false;
    clearTimeout(nxFloatScanTimer);nxFloatScanTimer=0;nxFloatScanAgain=false;
    clearTimeout(t._hashRelinkTimer);t._hashRelinkTimer=null;t._hashRelinkQueued=null;
    omniStreamArm();
  } else {
    clearTimeout(omniStream.timer);omniStream.timer=0;
    if(changed && typeof omniKeywordStreamEnded==='function')omniKeywordStreamEnded();
    if(changed && !t.unloading) {
      omniScheduleFooter();nxFloatScheduleScan();
      // Hosts without the commit listener still need the final hash rebind.
      if(typeof scheduleHashRelinkAfterReply==='function')scheduleHashRelinkAfterReply('chatOutput');
    }
  }
  if(changed)void omniStreamObservers().catch(()=>{});
}
async function omniReadScope(force=false) {
  if(omniStream.pending)return omniStream.pending;
  if(!force && omniStream.scope && Date.now()-omniStream.at<1000)return omniStream.scope;
  const epoch=omniStream.epoch;
  omniStream.attemptAt=Date.now();
  const task=(async()=>{
    const ci=Number(await k.getCurrentCharacterIndex()), ti=Number(await k.getCurrentChatIndex());
    if(!Number.isInteger(ci)||ci<0||!Number.isInteger(ti)||ti<0)throw Error('Chat temporarily unavailable');
    let scope=omniStream.scope || t.lastScope;
    if(!scope || scope.charIndex!==ci || scope.chatIndex!==ti)scope=await Z({useOverride:false});
    else {
      omniPerf.scopeReads++;
      const chat=await k.getChatFromIndex(ci,ti);
      if(!chat)throw Error('Chat temporarily unavailable');
      // Same index can contain a newly selected/replaced chat.
      const chatId=String(chat.id || chat.chatId || `chat_${ti}`);
      scope=chatId===scope.chatId ? {...scope,chat} : await Z({useOverride:false});
    }
    if(epoch!==omniStream.epoch || t.unloading)return null;
    const current=await Promise.all([k.getCurrentCharacterIndex(),k.getCurrentChatIndex()]);
    if(epoch!==omniStream.epoch || t.unloading)return null;
    if(Number(current[0])!==ci || Number(current[1])!==ti) {
      omniStream.at=0;
      omniScheduleFooter();nxFloatScheduleScan();
      return null;
    }
    if(omniStream.scope?.sessionId!==scope.sessionId) {
      nxFloatReadingIndex=-1;nxFloatStructureDirty=true;
      omniFooterTargets.delete(nxFloatKey);
    }
    omniStream.scope=scope;omniStream.at=Date.now();
    if(typeof omniKeywordScope==='function')omniKeywordScope(scope);
    omniSetStreaming(scope.chat?.isStreaming===true || scope.chat?.is_streaming===true);
    return scope;
  })();
  omniStream.pending=task;
  try {return await task;} finally {if(omniStream.pending===task)omniStream.pending=null;}
}
function omniStreamHint() {
  if(t.unloading)return;
  omniSetStreaming(true);
  // The output hook must return immediately; host reads are outside its chain.
  if(Date.now()-omniStream.attemptAt>=1000)void omniReadScope().catch(()=>{});
}
function omniStreamOutput() {
  // Do not trust an output from a background chat to resume the visible chat.
  omniStream.at=0;
  void (async()=>{
    if(omniStream.pending)await omniStream.pending;
    await omniReadScope(true);
    if(!omniStream.paused && !t.unloading){omniScheduleFooter();nxFloatScheduleScan();}
  })().catch(()=>{omniStreamArm();});
}
function omniStreamDispose() {
  if(typeof omniCancelKeywordRun==='function')omniCancelKeywordRun();
  omniStream.epoch++;clearTimeout(omniStream.timer);omniStream.timer=0;
  clearTimeout(omniFooterTimer);omniFooterTimer=0;
  omniStream.scope=null;omniStream.at=0;
}
