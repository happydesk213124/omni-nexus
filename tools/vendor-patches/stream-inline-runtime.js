// Streaming tag generation: each closed [[inxN]] block the chat model writes is
// one line-batch job that skips the tagger. Group, toast, commit and bake are
// the line-batch path; the block's own position is its slot.
function omniStreamMode(card) {
  return card?.stream_inline_tags === true ? 'inline' : card?.stream_lines_enabled ? 'lines' : 'keywords';
}
// A tapped waiting slot is an ordinary job; the frozen poller shows its toast.
function omniTrackJob(sessionId,jobId) {if(!jobId || t.unloading)return;t.activeJobId=jobId;ua(sessionId,jobId,'');}
// Registered at load: a double tap before any chat scope was read still gets its toast.
globalThis.__OMNI_TRACK_JOB__=omniTrackJob;
function omniInlineAutogen(card) { return card?.stream_inline_autogen!==false; }
// 「새 캐릭터를 맨 앞에 쓰기」: the reply's [[inxc]] block registers its new people the
// moment it closes, before their first line. Nothing is drawn, so it runs even when
// 「이미지 바로 생성」 is off. It goes to the reply's address, the one its shot blocks wait for too, and ahead of
// them (their roster reads wait for its write: stream-continuity). It used to be marked sent before that address
// was known: a lookup that came back after a long chat's stream had ended ("not streaming"), or a reply with no
// picture (its run cancelled at the end while the cast still waited), dropped it for good, and its people never
// registered. It is marked sent once sent; a try that failed goes once more with the reply's end.
async function omniSendInlineCast(run, body, final) {
  const target=await run.target;
  // A reply that ended keeps its cast, even when its run is cancelled for having no picture.
  if(!target || t.unloading || (run.cancelled && !final))return false;
  const scope=target.scope;
  const result=await K('/v1/inline-tags/cast',{method:'POST',body:{stream_id:run.streamId,session_id:scope.sessionId,character_id:scope.characterId,chat_id:scope.chatId,
    char_index:scope.charIndex,chat_index:scope.chatIndex,host_message_id:target.id,body:String(body||'').slice(0,12000)}});
  if(!result?.ok)throw Error(result?.error?.message || '새 캐릭터를 등록하지 못했습니다.');
  return true;
}
/** Once while streaming (with the address known) and once with the reply's end if not sent by then. */
function omniTryInlineCast(run, final=false) {
  if(run.castSent || run.castBusy || t.backendSettings?.card?.stream_inline_cast_first===false)return;
  if(final ? run.castFinal : run.castTried)return;
  const cast=globalThis.__INLAY_STREAM_KW__.inlineCastBlock?.(run.text,{live:!final});
  if(!cast)return;
  // While streaming it waits for the address with the shot blocks (asked here as well, as a closed block asks).
  if(!final && !run.identity){omniAskInlineTarget(run);return;}
  run.castBusy=true;
  if(final)run.castFinal=true;else run.castTried=true;
  void omniSendInlineCast(run,cast.body,final).then(sent=>{run.castSent=sent;})
    .catch(error=>{y('warn','stream.inline.cast',String(error));})
    .finally(()=>{run.castBusy=false;if(!run.castSent && run.outputComplete)omniTryInlineCast(run,true);});
}
/**
 * The streaming reply's address, asked once at a time: as it starts (onScriptOutput), and again by a closed block
 * while none is known. With it, the blocks waiting for it go.
 */
function omniAskInlineTarget(run) {
  if(run.target || run.identity)return;
  const target=omniCaptureKeywordTarget().catch(error=>{y('warn','stream.inline.target',String(error));return null;});
  run.target=target;
  void target.then(value=>{
    if(run.target!==target || run.cancelled || run.committing)return;
    // Not marked streaming yet: the next closed block asks again.
    if(!value){run.target=null;return;}
    run.identity=value;run.targetResolved=true;
    omniScanInlineRun(run);
  });
}
function omniScanInlineRun(run, final=false) {
  const SK=globalThis.__INLAY_STREAM_KW__, card=t.backendSettings?.card;
  omniTryInlineCast(run,final);
  // 「이미지 바로 생성」 off: nothing starts while streaming; completion parks every block.
  const parked=!omniInlineAutogen(card);
  if(parked && !final)return run;
  run.inlineSeen ||= new Set();
  // Only text that arrived since the last tick can close a new block.
  // Reasoning is never a slot; while streaming, an unclosed <Thoughts> counts as reasoning.
  const fresh=SK.inlineShotBlocks(run.text,{live:!final}).filter(block=>!run.inlineSeen.has(block.n));
  if(!fresh.length)return run;
  if(!final && !run.identity){omniAskInlineTarget(run);return run;}
  for(const block of fresh) {
    // L numbers count prose only. A block before any prose waits for its line.
    const line=SK.inlineShotLine(run.text,block);
    if(line<1 && !final)continue;
    run.inlineSeen.add(block.n);
    const text=SK.analysisBody(run.text.slice(0,block.start));
    if(!text)continue;
    // A broken block keeps its slot: the job asks to fix its JSON, kept here as written.
    const tagged=SK.inlineShotTagged(block.body,line);
    const batch={start:line,end:line,text,task:null,payload:null,jobId:'',inline:{n:block.n,tagged,raw:tagged?'':String(block.body||'').slice(0,4000),body:String(block.body||'').slice(0,12000)},parked};
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
      host_message_id:target.id,message_index:arg.messageIndex,assistant_text:text,blocks:run.batches.map(batch=>({n:batch.inline.n,line:batch.start,tagged:batch.inline.tagged || null,...(batch.inline.raw?{raw:batch.inline.raw}:{})}))}});
    if(!result?.ok)throw Error(result?.error?.message || '대기 칸을 만들지 못했습니다.');
    run.committed=true;
    globalThis.__OMNI_WAIT_TAPS__?.sync?.();
  }).catch(error=>{y('error','stream.inline.park',String(error));})
    .finally(()=>{if(omniKeywordRun===run)omniKeywordRun=null;});
  return true;
}
