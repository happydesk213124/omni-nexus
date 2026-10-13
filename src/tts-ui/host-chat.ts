import { risuHost } from '../core/host';
import { uuid } from '../core/util/text';
import { ttsData, subscribeTts } from '../storage/tts-store';
import { omniTts, type TtsRequest } from '../services/tts-runtime';
import { currentTtsContext, type TtsChatContext } from '../services/tts-context';
import { parseTtsMessage, compactHash, cueLineKey } from '../domain/tts/segment';
import { ttsExcludeTerms } from '../domain/tts/filter';
import { illustrationTtsRequests } from '../services/tts-illustration';
import { safeArray, hitHost, hostAttributes, releaseHost, disconnectHost, type HostPoint } from './host-utils';
import { withTtsAudio } from './activation';
import { installTtsViewer } from './host-viewer';

interface Binding { node: SafeElement; play:()=>Promise<void>; chips: {node:SafeElement;play:()=>Promise<void>}[]; message: number; line: string; source: string; illustration: boolean; narration: boolean; hidden?: boolean }
function requests(context: TtsChatContext, index: number): TtsRequest[] {
  const message = context.messages[index]; if (!message || message.role !== 'char') return [];
  const source = String(message.data || '');
  return parseTtsMessage(source,ttsExcludeTerms(ttsData().settings.excludeText),ttsData().settings.skipChars).map(segment => ({ context, messageId:String(message.chatId || message.id || `${index}:${compactHash(source)}`), sourceKey:cueLineKey(source.slice(segment.start,segment.end)), segment }));
}
function findLine(list: TtsRequest[], key: string, line: string): number {
  if (!key) return list.findIndex(r => r.segment.id === line);
  const exactIndex = list.findIndex(r => r.segment.id === line && r.sourceKey === key);
  return exactIndex >= 0 ? exactIndex : list.findIndex(r => r.sourceKey === key);
}
let installed = false;
export async function installTtsHost(): Promise<void> {
  if (installed) return;
  const host = risuHost(); if (!host?.getRootDocument || !host.createMutationObserver) return;
  await omniTts.init(); const doc = await host.getRootDocument(); if (!doc) return;
  installed = true;
  let refreshViewer = async () => {};
  const bindings = new Map<string,Binding>(); let timer: ReturnType<typeof setTimeout> | undefined, scanning = false, again = false, lastScope = '', lastPrefetch = '', disposed=false, inputEpoch=0, hovered='', bootAttempts=0;
  let visibilityTail: Promise<void> = Promise.resolve(), narration = ttsData().settings.narration;
  // Serialize bridge writes so rapid OFF/ON cannot leave an old hide arriving last.
  const syncVisibility = (only?: Binding): Promise<void> => {
    const result = visibilityTail.catch(() => {}).then(async () => {
      for (const b of only ? [only] : bindings.values()) {
        if (disposed || b.illustration) continue;
        const hidden = b.narration && !ttsData().settings.narration;
        if (b.hidden === hidden) continue;
        await b.node.setStyle('display', hidden ? 'none' : 'inline-flex'); b.hidden = hidden;
      }
    });
    visibilityTail = result; return result;
  };
  const bootstrap=()=>{if(bootAttempts<8)schedule(Math.min(5000,400*2**bootAttempts++));};
  const allowed=()=>{const blocked=Reflect.get(globalThis,'__OMNI_TTS_HOST_BLOCKED__');return !disposed&&ttsData().settings.enabled&&!(typeof blocked==='function'&&blocked());};
  const requestPlay = (list:TtsRequest[], index:number, reservation=omniTts.reservePlayback()) => withTtsAudio(()=>omniTts.play(list,index,reservation),reservation);
  const scan = async () => {
    if (scanning) { again = true; return; } scanning = true;
    try {
      if (disposed || !ttsData().settings.enabled) return;
      await refreshViewer();
      const context = await currentTtsContext().catch(()=>null); if(!context){bootstrap();return;} omniTts.setContext(context);
      if (context.scope !== lastScope) { lastScope = context.scope; lastPrefetch = ''; }
      const nodes = await safeArray(await doc.querySelectorAll('[x-omnitts-play],[data-omnitts-play]'));
      const live = new Set<string>(), nearby: {distance:number;request:TtsRequest}[] = [];
      const height = await doc.clientHeight();
      const perMessage = new Map<number,TtsRequest[]>();
      for (const node of nodes) {
        let key = await node.getAttribute('x-omnitts-bound');
        const parent = await node.getParent(); if (!parent) continue;
        const illustration = await parent.matches('[data-omnitts-image],[x-omnitts-image]');
        let line = '', source = '', message = -1, isNarration = false;
        if (!illustration) { const own=await hostAttributes(node),attrs=own['data-omnitts-line']?own:await hostAttributes(parent);line=attrs['data-omnitts-line']||attrs['x-omnitts-line']||'';source=attrs['data-omnitts-source']||attrs['x-omnitts-source']||'';message=Number(attrs['data-omnitts-message']??attrs['x-omnitts-message']??-1);isNarration=(own['data-omnitts-kind']||attrs['data-omnitts-kind'])==='narration'; }
        if (!key || !bindings.has(key)) {
          key = uuid(); await node.setAttribute('x-omnitts-bound',key); const b:Binding = {node,play:async()=>{},chips:[],message,line,source,illustration,narration:isNarration}; bindings.set(key,b);
          const play = async () => {
            if (!ttsData().settings.enabled) return;
            const reservation = omniTts.reservePlayback();
            const current = await currentTtsContext();
            if (b.illustration) {
              if (!ttsData().settings.illustration) return;
              const bar = await b.node.getParent(), image = await bar?.getParent(); const attrs=image?await hostAttributes(image):{},id=attrs['data-inlay-inline-shot']||attrs['x-inlay-inline-shot']; if (!id) {await releaseHost(image);await releaseHost(bar);return;}
              const list = await illustrationTtsRequests(id,current); const cast = await bar?.querySelector('[data-omnitts-cast]');
              if (cast) { for (const chip of b.chips.splice(0)) await releaseHost(chip.node); await cast.setTextContent(''); for (let i=0;i<list.length;i++) { const chip = await doc.createElement('button'); await chip.setTextContent(list[i].segment.speaker); await chip.setStyleAttribute('padding:8px;border-radius:8px;background:#137448;color:#e4ffec;min-height:36px'); b.chips.push({node:chip,play:()=>requestPlay([list[i]],0,omniTts.reservePlayback())}); await cast.appendChild(chip); } }
              await releaseHost(cast);await releaseHost(image);await releaseHost(bar);
              await requestPlay(list,0,reservation);
            } else { const list = requests(current,b.message), index = findLine(list,b.source,b.line); await requestPlay(list,index,reservation); }
          };
          b.play=play;
        } else {
          await releaseHost(node);
        }
        const binding = bindings.get(key)!; binding.message=message;binding.line=line;binding.source=source;binding.narration=isNarration;
        live.add(key);
        await releaseHost(parent);
        if (!illustration && message >= 0) {
          let list = perMessage.get(message); if (!list) { list=requests(context,message); perMessage.set(message,list); }
          const request = list[findLine(list,source,line)];
          if (request) binding.narration=request.segment.kind==='narration';
          await syncVisibility(binding);
          if (!request || (request.segment.kind === 'narration' && !ttsData().settings.narration)) continue;
          const rect = await binding.node.getBoundingClientRect(); if (rect.width && rect.height) nearby.push({distance:Math.abs(rect.top+rect.height/2-height/2),request});
        }
      }
      for (const [key,b] of bindings) if (!live.has(key)) { await releaseHost(b.node);for (const chip of b.chips) await releaseHost(chip.node); bindings.delete(key); }
      nearby.sort((a,b)=>a.distance-b.distance);
      const reading=nearby[0]?.request;
      // A freshly installed display module may not have invalidated Risu's
      // already rendered message yet. The viewer can read the original reply.
      let readingList=reading?[...perMessage.values()].find(list=>list.some(r=>r===reading))||[]:[];
      if(!nodes.length){
        const chat=await doc.querySelector('.default-chat-screen');
        try{if(chat&&await chat.clientHeight()>0){let index=context.messages.length-1;while(index>=0&&context.messages[index].role!=='char')index--;readingList=requests(context,index);}}finally{await releaseHost(chat);}
        bootstrap();
      }else bootAttempts=8;
      omniTts.reading(readingList);
      const selected = nearby.slice(0,ttsData().settings.prefetch).map(row=>row.request);
      const fingerprint=JSON.stringify([context.scope,selected.map(r=>[r.messageId,r.segment.id,r.segment.text])]);
      if (fingerprint !== lastPrefetch) { lastPrefetch=fingerprint; void omniTts.prefetch(selected); }
    } catch (error) { if (ttsData().settings.enabled) console.warn('OmniTTS chat scan',error); }
    finally { scanning=false; if (again) { again=false; schedule(); } }
  };
  const schedule = (delay=400) => { if (disposed || timer || !ttsData().settings.enabled) return; timer=setTimeout(()=>{timer=undefined;void scan();},delay); };
  const observer = await host.createMutationObserver(records => { void (async()=>{try{ for (const record of await safeArray(records)) { const target=await record.getTarget();try{if (await target.matches('[x-omnitts-viewer],[x-omnitts-viewer] *,[x-omnitts-toast],[x-omnitts-toast] *')) continue; schedule();}finally{await releaseHost(target);await releaseHost(record);} } }finally{await releaseHost(records);} })().catch(error=>console.warn('OmniTTS observer',error)); });
  await observer.observe(doc,{childList:true,subtree:true});
  const events:{type:string;id:string;options?:AddEventListenerOptions}[]=[];
  const listen=async(type:string,fn:(e:HostPoint)=>void,options?:AddEventListenerOptions)=>{events.push({type,id:await doc.addEventListener(type,fn,options),options});};
  const findHit=async(e:HostPoint,hover:boolean)=>{
    if(!allowed())return;
    const viewer=await doc.querySelector('[x-omnitts-viewer]');
    try{if(viewer&&await hitHost(viewer,e))return;}finally{await releaseHost(viewer);}
    const rows=[...bindings.entries()].filter(([,b])=>!b.narration||ttsData().settings.narration).flatMap(([key,b])=>[
      ...(!hover||!b.illustration?[{key,node:b.node,play:b.play,illustration:b.illustration}]:[]),
      ...(!hover?b.chips.map((c,i)=>({key:key+':'+i,node:c.node,play:c.play,illustration:true})):[])
    ]);
    const hits=await Promise.all(rows.map(r=>hitHost(r.node,e)));return rows[hits.indexOf(true)];
  };
  await listen('click',e=>{
    const epoch=++inputEpoch;
    void findHit(e,false).then(row=>{if(epoch===inputEpoch&&row&&(row.illustration||ttsData().settings.clickPlay))return row.play();}).catch(error=>omniTts.report(error));
  });
  await listen('mouseover',e=>{
    if(!ttsData().settings.hoverPlay)return;const epoch=++inputEpoch;
    void findHit(e,true).then(row=>{if(epoch!==inputEpoch)return;if(!row){hovered='';return;}if(hovered!==row.key){hovered=row.key;return row.play();}}).catch(error=>omniTts.report(error));
  });
  await listen('scroll',()=>schedule(),{capture:true,passive:true});
  const unsubscribe=subscribeTts(()=>{if(narration!==ttsData().settings.narration){narration=ttsData().settings.narration;void syncVisibility().catch(error=>console.warn('OmniTTS button visibility',error));}lastPrefetch='';bootAttempts=0;schedule();});
  const seen = new Map<string,string>();
  const output: (arg:ChatOutputListenerArg)=>Promise<void> = async arg=>{
    if (disposed || !ttsData().settings.enabled) return;
    try { const context=await currentTtsContext(); if (String(arg.char?.chaId)!==context.characterId || String(arg.chat?.id)!==context.chatId) return;
      const index=arg.messageIndex, list=requests(context,index); if (!list.length) return;
      const key=JSON.stringify([context.scope,index]), signature=compactHash(String(context.messages[index]?.data || '')); if (seen.get(key)===signature) return; seen.set(key,signature); if (seen.size>100) seen.delete(seen.keys().next().value!);
      if (ttsData().settings.autoReply) await requestPlay(list, list.findIndex(r=>ttsData().settings.narration || r.segment.kind!=='narration')); schedule();
    } catch(error) { omniTts.report(error); }
  };
  if (host.addRisuChatListener) await host.addRisuChatListener('output',output);
  const viewer=await installTtsViewer(doc);refreshViewer=viewer.refresh;await scan();
  if(host.onUnload)await host.onUnload(async()=>{disposed=true;inputEpoch++;installed=false;clearTimeout(timer);unsubscribe();omniTts.stop();await disconnectHost(observer);for(const e of events)await doc.removeEventListener(e.type,e.id,e.options);await host.removeRisuChatListener?.('output',output);for(const b of bindings.values()){await releaseHost(b.node);for(const c of b.chips)await releaseHost(c.node);}bindings.clear();await viewer.dispose();await releaseHost(doc);});
}
