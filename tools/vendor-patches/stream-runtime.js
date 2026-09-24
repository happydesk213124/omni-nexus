// UI-driven scope lookup only: no streaming-state polling or pause/resume gate.
const omniScope = {scope:null, at:0, pending:null, epoch:0};
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
let omniObserverWork=Promise.resolve();
function omniStreamObservers() {
  omniObserverWork=omniObserverWork.catch(()=>{}).then(async()=>{
    if(t.unloading)return;
    // Only pending previews need this observer. Viewer observation stays active.
    if(omniFooterObserver && omniFooterRoot) {
      if(!nxSpinnerPreviews.size)await omniFooterObserver.disconnect();
      else await omniFooterObserver.observe(omniFooterRoot,{childList:true,subtree:true});
    }
  });
  return omniObserverWork;
}
async function omniReadScope() {
  if(t.unloading)return null;
  if(omniScope.pending)return omniScope.pending;
  if(omniScope.scope && Date.now()-omniScope.at<1000)return omniScope.scope;
  const epoch=omniScope.epoch;
  const task=(async()=>{
    const [ci,ti]=(await Promise.all([k.getCurrentCharacterIndex(),k.getCurrentChatIndex()])).map(Number);
    if(!Number.isInteger(ci)||ci<0||!Number.isInteger(ti)||ti<0)return null;
    // Rendering needs identity, not a fresh copy of every message. Action handlers
    // validate the actual message separately before changing it.
    let scope=t.lastScope || omniScope.scope;
    if(!scope || scope.charIndex!==ci || scope.chatIndex!==ti) {
      omniPerf.scopeReads++;
      scope=await Z({useOverride:false});
      const current=await Promise.all([k.getCurrentCharacterIndex(),k.getCurrentChatIndex()]);
      if(Number(current[0])!==scope.charIndex || Number(current[1])!==scope.chatIndex)return null;
    }
    if(epoch!==omniScope.epoch || t.unloading)return null;
    if(omniScope.scope?.sessionId!==scope.sessionId) {
      nxFloatReadingIndex=-1;nxFloatStructureDirty=true;
      omniFooterTargets.delete(nxFloatKey);
    }
    omniScope.scope=scope;omniScope.at=Date.now();
    if(typeof omniKeywordScope==='function')omniKeywordScope(scope);
    return scope;
  })();
  omniScope.pending=task;
  try {return await task;} finally {if(omniScope.pending===task)omniScope.pending=null;}
}
function omniStreamOutput() {
  omniScope.at=0;
  if(!t.unloading){omniScheduleFooter();nxFloatScheduleScan();}
}
function omniStreamDispose() {
  if(typeof omniCancelKeywordRun==='function')omniCancelKeywordRun();
  omniScope.epoch++;
  clearTimeout(omniFooterTimer);omniFooterTimer=0;
  omniScope.scope=null;omniScope.at=0;
}
