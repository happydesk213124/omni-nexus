// Only committed chat output can start reply auto-generation. Never infer completion from DOM/chunks.
const omniReplySeen = new Set();
async function onChatOutput(arg) {
  if(t.unloading)return;
  omniStreamOutput();
  stopStreamKeywordTick();
  t._scriptStreaming=false;
  t._scriptStreamPrevLen=0;
  t._scriptStreamText='';
  t._streamKwFired=false;
  const index=arg?.messageIndex;
  const msg=Number.isInteger(index)&&index>=0?arg?.chat?.message?.[index]:null;
  if(!msg || !isSelectedCharRole(msg.role))return;
  scheduleHashRelinkAfterReply('chatOutput');
  const card=t.backendSettings?.card || {};
  const text=String(msg.data ?? msg.content ?? '');
  if(t.unloading || card.power===false || !card.auto_gen_on_reply || messageBodyChars(text)<=30)return;
  const characterId=String(arg.char?.chaId || arg.char?.id || arg.char?.name || `char_${arg.characterIndex}`);
  const chatId=String(arg.chat?.id || arg.chat?.chatId || `chat_${arg.chatIndex}`);
  const key=JSON.stringify([characterId,chatId,msg.chatId || msg.id || index,ye(text)]);
  if(omniReplySeen.has(key) || t._afterGenRunning || t._afterGenTimer || t.jobsInFlight?.size)return;
  omniReplySeen.add(key);
  if(omniReplySeen.size>128)omniReplySeen.delete(omniReplySeen.values().next().value);
  t._afterGenRunning=true;
  // The host awaits listeners: never hold its completion path open for generation.
  void omniGenerateCommittedReply(arg,msg,text,characterId,chatId).catch(error=>{
    y('error','chatOutput.fail',String(error));
  }).finally(()=>{t._afterGenRunning=false;});
}
async function omniGenerateCommittedReply(arg,msg,text,characterId,chatId) {
  if(!(await ve()).enabled)return;
  const scope=await Z({useOverride:false});
  // A late event must never generate from whichever chat the user opened next.
  if(scope.characterId!==characterId || scope.chatId!==chatId)return;
  const index=arg.messageIndex,row=scope.chat?.message?.[index];
  if(!row || String(row.data ?? row.content ?? '')!==text)return;
  const id=msg.chatId || msg.id;
  if(id && String(row.chatId || row.id || '')!==String(id))return;
  const card=t.backendSettings?.card || {};
  if(t.unloading || card.power===false || !card.auto_gen_on_reply || t.jobsInFlight?.size)return;
  const busy=await K('/v1/jobs/busy-message',{method:'POST',body:{session_id:scope.sessionId,character_id:characterId,chat_id:chatId,message_index:index,role:msg.role}});
  const latest=t.backendSettings?.card || {};
  if(busy?.busy || t.unloading || latest.power===false || !latest.auto_gen_on_reply || t.jobsInFlight?.size)return;
  // Non-forced generation preserves the existing image/rebind and job-lock safeguards.
  await Be({...scope,actionMessageIndex:index,actionMessageRole:msg.role,actionMessageId:id},text,false);
}
