// The host pushes snapshots. No DOM reads or chat-history polling belong here.
let omniKeywordRun = null;
const omniKeywordSeen = new Set();
function stopStreamKeywordTick() {
  if (omniKeywordRun?.timer) clearTimeout(omniKeywordRun.timer);
  if (omniKeywordRun) omniKeywordRun.timer = 0;
}
function parsedStreamKeywords(card) {
  return card.stream_keywords_enabled ? globalThis.__INLAY_STREAM_KW__.parseStreamKeywords(card.stream_keywords) : [];
}
function omniSignal(text) {
  return globalThis.__INLAY_STREAM_KW__.findStreamSignal(text, parsedStreamKeywords(t.backendSettings?.card || {}));
}
function omniKeywordIdentity(scope, index) {
  const msg = scope.chat?.message?.[index];
  const id = msg?.chatId || msg?.id;
  return id && isSelectedCharRole(msg.role) ? {scope, index, id:String(id), role:msg.role} : null;
}
async function omniCaptureKeywordTarget() {
  const scope = await Z({useOverride:false});
  if (!scope || !(scope.chat?.isStreaming || scope.chat?.is_streaming) || scope.chatIndex === 'unified') return null;
  const current = await Promise.all([k.getCurrentCharacterIndex(), k.getCurrentChatIndex()]);
  if (Number(current[0]) !== scope.charIndex || Number(current[1]) !== scope.chatIndex) return null;
  return omniKeywordIdentity(scope, (scope.chat.message?.length || 0)-1);
}
function omniNewKeywordRun(target) {
  // Streaming tags replace line batches and keywords: one reply, one way to tag it.
  const mode=omniStreamMode(t.backendSettings?.card),lineMode=mode==='lines',inlineMode=mode==='inline';
  const run = {target, text:'', checked:'', timer:0, fired:false, cancelled:false, committed:false,
    streamId:'stream_'+Date.now()+'_'+Math.random().toString(36).slice(2), task:null, jobId:'', expiry:0,
    activeAt:Date.now(),assistantText:'',scanner:globalThis.__INLAY_STREAM_KW__.createStreamSignalScanner(),
    mode,lineMode,inlineMode,batches:[],lineBatcher:lineMode?globalThis.__INLAY_STREAM_KW__.createStreamLineBatcher():null};
  if(target!==undefined)run.target=Promise.resolve(target).catch(()=>null).then(value=>{run.identity=value;run.targetResolved=true;return value;});
  return run;
}
// Quiet for 3 seconds: read the chat once. Risu ends a reply that failed or was
// stopped without its completion signal but keeps the text it got, and turns
// streaming off either way. Streaming off and no completion 2 seconds later (a
// completed reply sends it right after its finishing passes) means it ended without
// one: that text is the reply, committed like a completed one, so the images
// already made bake into it. A stream still running (a long pause) is read again
// at 6, 12, 24, then every 30 seconds, for up to five minutes.
const OMNI_QUIET_MS=3000, OMNI_END_GRACE_MS=2000, OMNI_STALL_LIMIT_MS=5*60*1000;
// Replies committed that way: their completion, if it comes late, is not a second one.
const omniEndedReplies=new Set();
function omniArmKeywordExpiry(run, delay=OMNI_QUIET_MS) {
  if(run.expiry)return;
  run.expiry=setTimeout(()=>{
    run.expiry=0;
    if(run!==omniKeywordRun || run.cancelled || run.committing)return;
    const remaining=OMNI_QUIET_MS-(Date.now()-run.activeAt);
    if(remaining>0)omniArmKeywordExpiry(run,remaining);
    else void omniEndWithoutOutput(run);
  },delay);
}
async function omniEndWithoutOutput(run) {
  try {
    const identity=run.identity;
    if(!identity){omniCancelKeywordRun(run);return;}
    const {charIndex,chatIndex,characterId,chatId}=identity.scope;
    const chat=await k.getChatFromIndex(charIndex,chatIndex);
    if(run!==omniKeywordRun || run.cancelled || run.committing)return;
    if(!chat || String(chat.id || chat.chatId || '')!==chatId){omniCancelKeywordRun(run);return;}
    if(chat.isStreaming || chat.is_streaming) {
      run.endSeenAt=0;run.stalls=(run.stalls || 0)+1;
      if(Date.now()-run.activeAt>OMNI_STALL_LIMIT_MS){omniCancelKeywordRun(run);return;}
      omniArmKeywordExpiry(run,Math.min(OMNI_QUIET_MS*2**run.stalls,30000));return;
    }
    const messages=Array.isArray(chat.message)?chat.message:[];
    const index=messages.findIndex(msg=>String(msg?.chatId || msg?.id || '')===identity.id);
    if(index<0){omniCancelKeywordRun(run);return;}
    if(!run.endSeenAt){run.endSeenAt=Date.now();omniArmKeywordExpiry(run,OMNI_END_GRACE_MS);return;}
    const msg=messages[index],text=String(msg.data ?? msg.content ?? '');
    y('warn','stream.end.without.output','reply ended without completion · committing its text');
    const committed=omniCommitStreamReply({char:{chaId:characterId},chat,characterIndex:charIndex,chatIndex,messageIndex:index},msg,text);
    if(!committed){omniCancelKeywordRun(run);return;}
    void omniStreamScrollEnd();
    omniEndedReplies.add(characterId+'|'+chatId+'|'+identity.id);
    if(omniEndedReplies.size>64)omniEndedReplies.delete(omniEndedReplies.values().next().value);
  } catch(error) {
    y('warn','stream.end.check',String(error));omniCancelKeywordRun(run);
  }
}
function onScriptOutput(content) {
  if (t.unloading || t.backendSettings?.card?.power === false) return content;
  // A reply is streaming while its chunks keep coming: what 꾹 누르기 (wait-taps) asks
  // before it does anything. No end event is needed, so a stopped reply clears itself.
  t._omniReplyChunkAt=Date.now();
  globalThis.__OMNI_REPLY_STREAMING__ ||= ()=>Date.now()-(t._omniReplyChunkAt || 0)<4000;
  omniStreamScrollTrack();
  let run = omniKeywordRun;
  if(run && run.mode!==omniStreamMode(t.backendSettings?.card)) {omniCancelKeywordRun(run);run=null;}
  if (!run) omniKeywordRun = run = omniNewKeywordRun();
  run.text=String(content || '');run.activeAt=Date.now();
  if(run.cancelled || run.committing)return content;
  omniArmKeywordExpiry(run);
  if (!run.timer) run.timer = setTimeout(() => {
    run.timer = 0;
    if (run !== omniKeywordRun || run.cancelled || run.committing ||
      (run.text === run.checked && (!(run.lineMode || run.inlineMode) || run.identity))) return;
    if(run.inlineMode) {run.checked=run.text;omniScanInlineRun(run);return;}
    if(run.lineMode) {run.checked=run.text;omniScanLineRun(run);return;}
    // Full-prefix comparisons belong to the scan window, never each chunk.
    if(run.fired && !run.text.startsWith(run.checked)) {
      const text=run.text,activeAt=run.activeAt;
      omniCancelKeywordRun(run);
      omniKeywordRun=run=omniNewKeywordRun();run.text=text;run.activeAt=activeAt;
      omniArmKeywordExpiry(run);
    }
    run.checked = run.text;
    if(run.fired)return;
    const hit = run.scanner.scan(run.text,parsedStreamKeywords(t.backendSettings?.card || {}));
    if (!hit || messageBodyChars(hit.text) <= 30) return;
    run.fired = true;run.assistantText=hit.text;
    run.task = omniStartKeywordJob(run, hit.text).catch(error => {y('error','stream.start',String(error));return null;});
  }, 1000);
  return content;
}
function omniKeywordScope(scope) {
  // Streaming tags send this chat's registered people with the next request; the
  // request hook itself never asks the host, so the state is refreshed here.
  if(t.backendSettings?.card?.stream_inline_tags===true) {
    globalThis.__OMNI_INLINE_TAGS__?.scope?.({sessionId:scope.sessionId,characterId:scope.characterId,chatId:scope.chatId});
    // Pink slots left from earlier replies become tappable once the chat is known.
    globalThis.__OMNI_TRACK_JOB__=omniTrackJob;
    globalThis.__OMNI_WAIT_TAPS__?.sync?.();
  }
  const run=omniKeywordRun, target=run?.identity;
  if(!target || run.committing)return;
  // Viewer scopes cache identity only; their message rows may predate this reply.
  // Exact message identity is checked again by the committed-output path.
  if(scope.characterId!==target.scope.characterId || scope.chatId!==target.scope.chatId)omniCancelKeywordRun(run);
}
async function omniStartKeywordJob(run, text, batch) {
  if(!run.target)run.target=omniCaptureKeywordTarget().catch(()=>null).then(value=>{run.identity=value;run.targetResolved=true;return value;});
  const target = await run.target;
  if (!target || run.cancelled || t.unloading || !(await ve()).enabled || t.backendSettings?.card?.power === false) return null;
  const {scope,index,id,role} = target, card = t.backendSettings.card, char = scope.character || {};
  // A block the model wrote needs no tagger, so no lorebook read either.
  const lore = card.lorebook && !batch?.inline?.tagged ? await la() : [];
  if (run.cancelled) return null;
  const result = await K('/v1/jobs/create',{method:'POST',body:{
    stream_id:run.streamId, defer_attachment:true, session_id:scope.sessionId,
    character_id:scope.characterId, character_name:scope.characterName || char.name || '',
    chat_id:scope.chatId, chat_name:scope.chatName || '', char_index:scope.charIndex, chat_index:scope.chatIndex,
    host_message_id:id, message_index:index, message_role:role, content_hash:ye(text), assistant_text:text,
    ...(batch?{stream_line_start:batch.start,stream_line_end:batch.end}:{}),
    ...(batch?.inline?{inline_block:batch.inline.n,...(batch.inline.tagged?{inline_tagged:batch.inline.tagged}:batch.inline.raw?{inline_raw:batch.inline.raw}:{}),...(batch.inline.body?{inline_body:batch.inline.body}:{})}:{}),
    lorebook:lore, recent_messages:Xe({...scope.chat,message:scope.chat.message.slice(0,index)},re(card.include_max,0,20,0),!!card.userchat),
    character_description:char.description || char.desc || '', persona_description:char.personality || ''
  }});
  if (!result?.accepted || !result.job_id) return null;
  const owner=batch || run;
  owner.jobId = result.job_id;
  owner.payload = {job_id:owner.jobId,stream_id:run.streamId,character_id:scope.characterId,chat_id:scope.chatId,host_message_id:id};
  if(batch && !run.cancelled)omniPollLineJobs(scope.sessionId,[], '',run);
  if (run.cancelled) await K('/v1/jobs/commit-output',{method:'POST',body:{...owner.payload,cancel:true}});
  return target;
}
function omniCancelKeywordRun(run = omniKeywordRun) {
  if (!run || run.committed) return;
  run.cancelled = true; clearTimeout(run.timer); clearTimeout(run.expiry);
  if(run.linePollTimer && t.pollTimer===run.linePollTimer) {
    clearTimeout(run.linePollTimer);t.pollTimer=null;
    if(t.jobProgress?.jobId===run.streamId)t.jobProgress={...t.jobProgress,state:'cancelled'};
    if(typeof syncProgressToast==='function')void syncProgressToast().catch(()=>{});
  }
  if (run.payload) void K('/v1/jobs/commit-output',{method:'POST',body:{...run.payload,cancel:true}}).catch(()=>{});
  for(const batch of run.batches)if(batch.payload)void K('/v1/jobs/commit-output',{method:'POST',body:{...batch.payload,cancel:true}}).catch(()=>{});
  if (omniKeywordRun === run) omniKeywordRun = null;
}
function omniCommitStreamReply(arg, msg, text) {
  const characterId=String(arg.char?.chaId || arg.char?.id || ''), chatId=String(arg.chat?.id || arg.chat?.chatId || '');
  const id=String(msg.chatId || msg.id || ''), key=JSON.stringify([characterId,chatId,id,ye(globalThis.__INLAY_STREAM_KW__.analysisBody(text))]);
  if (!id || !characterId || !chatId) return false;
  if (omniKeywordSeen.has(key)) return true;
  if (omniEndedReplies.has(characterId+'|'+chatId+'|'+id)) return true;
  const mode=omniStreamMode(t.backendSettings?.card);
  if(omniKeywordRun && omniKeywordRun.mode!==mode)omniCancelKeywordRun();
  if(mode!=='keywords') return omniCommitLineReply(arg,msg,text,key);
  let run = omniKeywordRun;
  if(run?.identity && (run.identity.scope.characterId!==characterId || run.identity.scope.chatId!==chatId || run.identity.id!==id))return false;
  if(run?.fired && run.checked && !text.startsWith(run.checked) &&
    !globalThis.__INLAY_STREAM_KW__.analysisBody(text).startsWith(run.assistantText)) {
    omniCancelKeywordRun(run);run=null;
  }
  stopStreamKeywordTick();
  if (!run?.fired || (run.targetResolved && !run.identity)) {
    const hit = omniSignal(text);
    if (!hit || messageBodyChars(hit.text)<=30 || t.backendSettings?.card?.power===false) {omniCancelKeywordRun(run);return false;}
    omniCancelKeywordRun(run);
    const target=(async()=>{
      const scope=await Z({useOverride:false});
      if(scope.characterId!==characterId || scope.chatId!==chatId)return null;
      return omniKeywordIdentity({...scope,chat:arg.chat},arg.messageIndex);
    })();
    omniKeywordRun=run=omniNewKeywordRun(target);run.fired=true;run.assistantText=hit.text;
    run.task=omniStartKeywordJob(run,hit.text).catch(error=>{y('error','stream.start',String(error));return null;});
  }
  const selected=run;
  selected.committing=true;
  clearTimeout(selected.expiry);
  omniKeywordSeen.add(key);
  if(omniKeywordSeen.size>128)omniKeywordSeen.delete(omniKeywordSeen.values().next().value);
  void (async()=>{
    const target=await selected.task;
    if(!target || selected.cancelled)return;
    if(target.scope.characterId!==characterId || target.scope.chatId!==chatId || target.id!==id) {
      omniCancelKeywordRun(selected);return;
    }
    const result=await K('/v1/jobs/commit-output',{method:'POST',body:{...selected.payload,
      message_index:arg.messageIndex,assistant_text:text,content_hash:ye(text)}});
    if(!result?.ok)throw Error(result?.error?.message || '선행 이미지 부착 실패');
    selected.committed=true;
    t.activeJobId=selected.jobId;
    ua(target.scope.sessionId,selected.jobId,ye(text));
  })().catch(error=>{omniCancelKeywordRun(selected);y('error','stream.commit',String(error));})
    .finally(()=>{if(omniKeywordRun===selected)omniKeywordRun=null;});
  return true;
}
