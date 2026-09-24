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
  const run = {target, text:'', checked:'', timer:0, fired:false, cancelled:false, committed:false,
    streamId:'stream_'+Date.now()+'_'+Math.random().toString(36).slice(2), task:null, jobId:'', expiry:0};
  if(target!==undefined)run.target=Promise.resolve(target).catch(()=>null).then(value=>{run.identity=value;run.targetResolved=true;return value;});
  return run;
}
function onScriptOutput(content) {
  if (t.unloading || t.backendSettings?.card?.power === false) return content;
  let run = omniKeywordRun;
  const text=String(content || '');
  // A replaced response cannot inherit an abandoned run. Chunk activity owns
  // idle cleanup only; this timer never infers successful completion.
  if (run?.fired && run.text && !text.startsWith(run.text)) {omniCancelKeywordRun(run);run=null;}
  if (!run) omniKeywordRun = run = omniNewKeywordRun();
  run.text=text;
  clearTimeout(run.expiry);
  run.expiry=setTimeout(()=>omniCancelKeywordRun(run),30000);
  if (run.fired || run.cancelled) return content;
  if (!run.timer && run.text !== run.checked) run.timer = setTimeout(() => {
    run.timer = 0;
    if (run !== omniKeywordRun || run.cancelled || run.fired || run.text === run.checked) return;
    run.checked = run.text;
    const hit = omniSignal(run.text);
    if (!hit || messageBodyChars(hit.text) <= 30) return;
    run.fired = true;
    run.task = omniStartKeywordJob(run, hit.text).catch(error => {y('error','stream.start',String(error));return null;});
  }, 1000);
  return content;
}
function omniKeywordScope(scope) {
  const run=omniKeywordRun, target=run?.identity;
  if(!target || run.committing)return;
  // Viewer scopes cache identity only; their message rows may predate this reply.
  // Exact message identity is checked again by the committed-output path.
  if(scope.characterId!==target.scope.characterId || scope.chatId!==target.scope.chatId)omniCancelKeywordRun(run);
}
async function omniStartKeywordJob(run, text) {
  if(!run.target)run.target=omniCaptureKeywordTarget().catch(()=>null).then(value=>{run.identity=value;run.targetResolved=true;return value;});
  const target = await run.target;
  if (!target || run.cancelled || t.unloading || !(await ve()).enabled || t.backendSettings?.card?.power === false) return null;
  const {scope,index,id,role} = target, card = t.backendSettings.card, char = scope.character || {};
  const lore = card.lorebook ? await la() : [];
  if (run.cancelled) return null;
  const result = await K('/v1/jobs/create',{method:'POST',body:{
    stream_id:run.streamId, defer_attachment:true, session_id:scope.sessionId,
    character_id:scope.characterId, character_name:scope.characterName || char.name || '',
    chat_id:scope.chatId, chat_name:scope.chatName || '', char_index:scope.charIndex, chat_index:scope.chatIndex,
    host_message_id:id, message_index:index, message_role:role, content_hash:ye(text), assistant_text:text,
    lorebook:lore, recent_messages:Xe({...scope.chat,message:scope.chat.message.slice(0,index)},re(card.include_max,0,20,0),!!card.userchat),
    character_description:char.description || char.desc || '', persona_description:char.personality || ''
  }});
  if (!result?.accepted || !result.job_id) return null;
  run.jobId = result.job_id;
  run.payload = {job_id:run.jobId,stream_id:run.streamId,character_id:scope.characterId,chat_id:scope.chatId,host_message_id:id};
  if (run.cancelled) await K('/v1/jobs/commit-output',{method:'POST',body:{...run.payload,cancel:true}});
  return target;
}
function omniCancelKeywordRun(run = omniKeywordRun) {
  if (!run || run.committed) return;
  run.cancelled = true; clearTimeout(run.timer); clearTimeout(run.expiry);
  if (run.payload) void K('/v1/jobs/commit-output',{method:'POST',body:{...run.payload,cancel:true}}).catch(()=>{});
  if (omniKeywordRun === run) omniKeywordRun = null;
}
function omniCommitStreamReply(arg, msg, text) {
  const characterId=String(arg.char?.chaId || arg.char?.id || ''), chatId=String(arg.chat?.id || arg.chat?.chatId || '');
  const id=String(msg.chatId || msg.id || ''), key=JSON.stringify([characterId,chatId,id,ye(globalThis.__INLAY_STREAM_KW__.analysisBody(text))]);
  if (!id || !characterId || !chatId) return false;
  if (omniKeywordSeen.has(key)) return true;
  let run = omniKeywordRun;
  if(run?.identity && (run.identity.scope.characterId!==characterId || run.identity.scope.chatId!==chatId || run.identity.id!==id))return false;
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
    omniKeywordRun=run=omniNewKeywordRun(target);run.fired=true;
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
