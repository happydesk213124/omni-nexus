import { readFileSync } from 'node:fs';
import { protectSavedFrames } from './protect-saved-frames.mjs';
const read = name => readFileSync(new URL(name,import.meta.url),'utf8');
export function rebuildMessageRuntime(source) {
  let out=source;
  const once=(needle,value)=>{
    if(out.split(needle).length!==2)throw new Error('[runtime rebuild] drift: '+needle.slice(0,90));
    out=out.replace(needle,()=>value);
  };
  const fn=(start,value)=>{
    const at=out.indexOf(start),end=out.indexOf('\n  }',at)+5;
    if(at<0||end<at)throw new Error('[runtime rebuild] function missing: '+start);
    out=out.slice(0,at)+value+'\n'+out.slice(end);
  };
  once('      if (text && text.length > 8) scheduleHashRelinkAfterReply("scriptOutput");', '      // Commit-time output notification owns message relinking.');
  once('    if (typeof schedulePointerSelect == "function") schedulePointerSelect("reply");', '    // Selection refresh is coalesced with the final rebind below.');
  once('      if (gen !== t._hashRelinkGen) return;\n      relinkSelectedMessageHash(source)', '      if (gen !== t._hashRelinkGen) return;\n      if (typeof schedulePointerSelect == "function") schedulePointerSelect("reply");\n      relinkSelectedMessageHash(source)');
  fn('  async function injectChatMsgActions(', '  async function injectChatMsgActions() { omniScheduleFooter(); }');
  fn('  function nxEnsureFanRemountWatch(', '  function nxEnsureFanRemountWatch() { omniScheduleFooter(); }');
  fn('  async function paintAllMsgFans(', '  async function paintAllMsgFans() { await omniMountFooters(); }');
  fn('  async function hitMsgChipAt(', '  async function hitMsgChipAt(doc,x,y) { return omniFooterHit(doc,x,y); }');
  fn('  async function runMsgChipAction(', '  async function runMsgChipAction(kind,key) { return omniFooterAction(kind,key); }');
  fn('  async function pressMsgChip(', '  async function pressMsgChip() {}');
  fn('  async function nxAroundScrollHold(', '  async function nxAroundScrollHold(work) { return work(); }');
  fn('  function nxScheduleScrollHoldCapture(', '  function nxScheduleScrollHoldCapture() {}');
  fn('  async function nxCaptureScrollHold(', '  async function nxCaptureScrollHold() { return false; }');
  fn('  async function nxApplyScrollHold(', '  async function nxApplyScrollHold() { return false; }');
  fn('  async function nxPinChatScrollers(', '  async function nxPinChatScrollers() { return ()=>{}; }');
  const a=out.indexOf('  globalThis.__INLAY_SCROLL_HOLD__ ='),b=out.indexOf('  async function nxWaitNewestDom',a);
  if(a<0||b<0)throw new Error('[runtime rebuild] scroll bridge missing');
  out=out.slice(0,a)+`  globalThis.__INLAY_SCROLL_HOLD__ = omniWithScrollWrite;
  globalThis.__OMNI_BEGIN_SCROLL__ = async()=>{};
  globalThis.__OMNI_END_SCROLL__ = async()=>{};
`+out.slice(b);
  once('  async function Be(e, n, o = !1) {','  async function Be(e, n, o = !1) {');
  once('const l = t.selectedMessage, m = ye(n), selectedMatches', 'const l = t.selectedMessage, m = ye(n), selectedMatches');
  once('p = selectedMatches && l?.chatIndex != null && Number(l.chatIndex) >= 0 ? Number(l.chatIndex) : da(e.chat);', 'p = Number.isInteger(e.actionMessageIndex) ? e.actionMessageIndex : selectedMatches && l?.chatIndex != null && Number(l.chatIndex) >= 0 ? Number(l.chatIndex) : da(e.chat);');
  once('message_role: w(t.selectedMessage?.role || "char", 40),','message_role: w(e.actionMessageRole || t.selectedMessage?.role || "char", 40),');
  once('host_message_id: w(t.selectedMessage?.hostMessageId || t.selectedMessage?.host_message_id || "", 160),','host_message_id: w(omniJobMessageId(e), 160),');
  once('messageIndex: p,\n            role: w(t.selectedMessage?.role || "char", 40)', 'messageIndex: p,\n            hostMessageId: omniJobMessageId(e),\n            role: w(e.actionMessageRole || t.selectedMessage?.role || "char", 40)');
  once('k.onUnload(async () => {','k.onUnload(async () => {\n      await omniDisposeMessageRuntime();');
  // UI retry no longer runs the gallery/linker work repeatedly.
  fn('  async function it() {',`  async function it() {
    if(t.uiOpen)return;
    if(!t.backendSettings)await le();
    t.hostDoc=t.hostDoc || await ue();
    omniScheduleFooter();
    // This shell still owns baked-image pointer events. Coalesce initialization;
    // viewer/gallery construction is explicit via Vt, never a boot prerequisite.
    if(!t.overlayUi?.root) {
      t._omniEventShell ||= Ya().finally(()=>{t._omniEventShell=null;});
      await t._omniEventShell;
    }
    await nxFloatEnsure();
  }`);
  fn('  async function nxSyncVisibleBakedFocus() {', `  async function nxSyncVisibleBakedFocus() {
    if (t.backendSettings?.card?.floating_viewer === false || nxFloatBlocked()) return false;
    if (nxFloatDirty) await nxFloatScan();
    return !!nxFloatCardId;
  }`);
  once('t.hostDoc = null, await it();','await it();');
  fn('  function startHostUiWatchdog() {', '  function startHostUiWatchdog() {}');
  once('      await retryHostUi();', '      void retryHostUi().catch(error=>Pe("host ui init",error));');
  once('const n = t.backendSettings?.card || {}, o = n.floating_viewer === !1 || !!t.galleryUi?.root, a = !!t.overlayUi?.root;',
       'const o = true, a = !!t.overlayUi?.root;');

  once('  async function At() {',`  async function At() {
    if(await globalThis.__INLAY_NATIVE__?.hydrateSettingsPreviews?.(t.uiTab))await le();`);
  once('  async function P() {','  async function P() {\n    if(t.uiOpen && await globalThis.__INLAY_NATIVE__?.hydrateSettingsPreviews?.(t.uiTab))await le();');
  once('const scope=await Z({useOverride:false}); const sid=scope.sessionId;', 'const scope=await Z({useOverride:false}); const sid=msg?.sessionId || scope.sessionId;');
  // Closing a job drops JS references only. The message parser owns DOM replacement.
  once('    nxClosedSpinnerPreviews.add(jobId);','    nxClosedSpinnerPreviews.add(jobId);if(nxClosedSpinnerPreviews.size>128)nxClosedSpinnerPreviews.delete(nxClosedSpinnerPreviews.values().next().value);');
  once('        if(nxSpinnerPreviews.get(key)!==row) {await layer.remove();continue;}', '        if(nxSpinnerPreviews.get(key)!==row) continue;');
  once('    const pin = await savePinPercent(pinXPctDefault, pinYPctDefault);', '    nxFloatGeo = {...se}; nxFloatIconGeo = {...iconSe}; await nxFloatApply();\n    const pin = await savePinPercent(pinXPctDefault, pinYPctDefault);');
  // The inspector used to be published only inside a chat pointerdown. A
  // freshly loaded floating viewer must be able to open it before any chat tap.
  const inspectStart = out.indexOf('      const nxOpenAssetInspect = async (card, assetName, sourceNode) => {');
  const inspectEndText = '      t._nxInspectOpener = nxOpenAssetInspect;';
  const inspectEnd = out.indexOf(inspectEndText, inspectStart) + inspectEndText.length;
  if (inspectStart < 0 || inspectEnd < inspectStart) throw new Error('[runtime rebuild] inspect opener drift');
  const inspect = out.slice(inspectStart, inspectEnd);
  once(inspect, '');
  const inspectHost = '    let pointerGesture = null, mobilePress = null, pinClick = null, actionCard = null, inspectOpen = !1, inspectGuardUntil = 0, pendingSheetHit = null, inspectZones = [], inspectSheetEl = null;';
  once(inspectHost, inspectHost+'\n'+inspect);
  once('      if (t.uiOpen || t._hostChromeBlocked || t.charEditUi) return;\n      const x = f.clientX, I = f.clientY;\n      if (typeof x != "number" || typeof I != "number") return;', '      if (t._nxHostInspectOpen || t.uiOpen || t._hostChromeBlocked || t.charEditUi) return;\n      const x = f.clientX, I = f.clientY;\n      if (typeof x != "number" || typeof I != "number") return;\n      if (await nxFloatHitSurface(x, I)) return;');
  once('    }, onPointerUp = async (f) => {', '    }, onPointerUp = async (f) => {\n      if (t._nxHostInspectOpen) { cancelMobilePress(); pinClick = null; pointerGesture = null; pendingSheetHit = null; t._msgChipPress = null; return; }');
  once('      await restoreFloatingViewerAfterRisuSettings();', '      await restoreFloatingViewerAfterRisuSettings();\n      await nxFloatEnsure();');
  once('  const nxSpinnerPreviews=new Map();',read('stream-runtime.js')+'\n'+read('message-runtime.js')+'\n'+read('scroll-runtime.js')+'\n'+['float-viewer-style.js','float-viewer.js','float-viewer-render.js','float-viewer-input.js','float-viewer-drag.js'].map(read).join('\n')+'\n  const nxSpinnerPreviews=new Map();');
  once('    nxSpinnerPreviews.set(row.jobId+\'_\'+row.shot,{...row});', '    nxSpinnerPreviews.set(row.jobId+\'_\'+row.shot,{...row});\n    await omniMountFooters();\n    await omniStreamObservers();');
  once('    for(const [key,row] of nxSpinnerPreviews) if(row.jobId===jobId) nxSpinnerPreviews.delete(key);', '    for(const [key,row] of nxSpinnerPreviews) if(row.jobId===jobId) nxSpinnerPreviews.delete(key);\n    await omniStreamObservers();');
  fn('  async function onChatOutput(', read('reply-runtime.js'));
  fn('  async function _t(', '');
  fn('  async function chatIsStreaming(', '');
  once('      if (typeof k.addRisuReplacer != "function") throw new Error("addRisuReplacer unavailable");\n      await k.addRisuReplacer("afterRequest", _t), t.replacerReady = !0;', '      t.replacerReady = t._chatOutputReady;\n      if (!t._chatOutputReady) t.replacerError = "응답 완료 API 미지원";');
  once(', await D("removeAfter", () => k.removeRisuReplacer?.("afterRequest", _t), null)', '');
  const waitStart=out.indexOf('      const waitStream = source !== "streamKeywords";');
  const waitEnd=out.indexOf('      try {\n        await le();',waitStart);
  if(waitStart<0 || waitEnd<waitStart)throw new Error('[runtime rebuild] reply stream wait drift');
  out=out.slice(0,waitStart)+out.slice(waitEnd);
  once('      if (card.power === !1 || !card.auto_gen_on_reply) return content;\n      if (!text || text.length <= 8) return content;\n      t._scriptStreaming = !0;', '      t._scriptStreaming = !!text;');
  out=out.replaceAll('afterRequest 활성','응답 완료 API 활성').replace('hook=${t.replacerReady ? "afterRequest"','hook=${t.replacerReady ? "chatOutput"');
  assertCommittedReplyRuntime(out);
  for (const name of ['stopStreamKeywordTick', 'parsedStreamKeywords', 'tickStreamKeywords', 'ensureStreamKeywordTick']) fn('  function '+name+'(', '');
  for (const name of ['runAutoGenFromDom', 'scheduleAutoGenOnReply']) fn('  async function '+name+'(', '');
  fn('  async function onScriptOutput(', read('stream-keyword-runtime.js'));
  once('            <label class="toggle-row" data-nx-help-id="nx-llm-anchor"><input type="checkbox" id="nx-llm-anchor" ${i.llm_anchor_percent ? "checked" : ""}><span>LLM 읽기 위치 배치</span></label>', '');
  once('llm_anchor_percent: ee("nx-llm-anchor"),', 'llm_anchor_percent: false,');
  return protectSavedFrames(retirePercentPlacement(out));
}

export function retirePercentPlacement(out) {
  // Legacy files remain importable; none of the frozen viewer fallbacks may
  // recover percent positioning or its inspector chip from old metadata.
  for (const [expression, count] of [
    ['c?.y_percent ?? c?.anchor_percent ?? c?.read_percent', 2],
    ['e?.y_percent ?? e?.anchor_percent ?? e?.read_percent', 2],
    ['Q.y_percent ?? Q.anchor_percent ?? Q.read_percent', 1],
  ]) {
    if (out.split(expression).length !== count + 1) throw new Error('[runtime rebuild] percent placement drift: ' + expression);
    out = out.replaceAll(expression, 'undefined');
  }
  return out;
}

export function assertCommittedReplyRuntime(out) {
  if (!out.includes('omniGenerateCommittedReply') || !out.includes('addRisuChatListener("output", onChatOutput)')) {
    throw new Error('[build] missing committed-output auto-generation');
  }
  if (out.includes('addRisuReplacer("afterRequest", _t)') || out.includes('scheduleAutoGenOnReply("chatOutput"') || out.includes('while (await chatIsStreaming())')) {
    throw new Error('[build] reply auto-generation must not poll streaming or use afterRequest');
  }
}
