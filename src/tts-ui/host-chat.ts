import { risuHost } from '../core/host';
import { uuid } from '../core/util/text';
import { sleep } from '../core/util/async';
import { ttsData, subscribeTts } from '../storage/tts-store';
import { omniTts, type TtsRequest } from '../services/tts-runtime';
import { currentTtsContext, type TtsChatContext } from '../services/tts-context';
import { parseTtsMessage, compactHash, cueLineKey } from '../domain/tts/segment';
import { ttsExcludeTerms } from '../domain/tts/filter';
import { matchTtsAnchors, ttsAnchorTexts } from '../domain/tts/anchors';
import { illustrationTtsRequests } from '../services/tts-illustration';
import { safeArray, hitHost, hostAttributes, releaseHost, disconnectHost, type HostPoint } from './host-utils';
import { withTtsAudio } from './activation';
import { installTtsViewer } from './host-viewer';

interface Binding { node: SafeElement; play:()=>Promise<void>; chips: {node:SafeElement;play:()=>Promise<void>}[]; message: number; messageId: string; line: string; source: string; illustration: boolean; narration: boolean; dead?: boolean; hidden?: boolean; state?: string }
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
  let refreshViewer = async () => {}, flash = (_message: string) => {};
  const bindings = new Map<string,Binding>(); let timer: ReturnType<typeof setTimeout> | undefined, scanTask: Promise<void> | undefined, again = false, lastScope = '', lastPrefetch = '', disposed=false, inputEpoch=0, hovered='', bootAttempts=0;
  // Lines a module control is actually shown for; status panels other modules
  // turned into markup never get a control and so never join the playlist.
  const anchored = new Map<number,TtsRequest[]>();
  let visibilityTail: Promise<void> = Promise.resolve(), stateTail: Promise<void> = Promise.resolve();
  // The plugin owns visibility: unbound controls and narration while it is OFF
  // are hidden on the node itself, never by a module rule.
  const hidden = (b: Binding) => !b.illustration && (!!b.dead || (b.narration && !ttsData().settings.narration));
  const syncVisibility = (only?: Binding): Promise<void> => {
    visibilityTail = visibilityTail.catch(() => {}).then(async () => {
      for (const b of only ? [only] : bindings.values()) {
        if (disposed) return;
        const hide = hidden(b);
        if (b.hidden === hide) continue;
        b.hidden = hide; await b.node.setStyle('display', hide ? 'none' : '');
      }
    });
    return visibilityTail;
  };
  const syncState = (): Promise<void> => {
    stateTail = stateTail.catch(() => {}).then(async () => {
      const current = omniTts.current, status = omniTts.player.status;
      const active = status === 'loading' || status === 'playing' || status === 'paused' ? status : '';
      for (const b of bindings.values()) {
        if (disposed) return;
        const mine = !!active && !!current && !!b.messageId && b.messageId === current.messageId && (b.illustration || b.line === current.segment.id);
        const want = mine ? active : '';
        if ((b.state || '') !== want) { b.state = want; await b.node.setAttribute('x-omnitts-state', want); }
      }
    });
    return stateTail;
  };
  const bootstrap=()=>{if(bootAttempts<8)schedule(Math.min(5000,400*2**bootAttempts++));};
  const allowed=()=>{const blocked=Reflect.get(globalThis,'__OMNI_TTS_HOST_BLOCKED__');return !disposed&&ttsData().settings.enabled&&!(typeof blocked==='function'&&blocked());};
  const report = (error: unknown) => { omniTts.report(error); const text = String((error as Error)?.message || error || ''); if (text) flash(text); };
  // User-started playback reports its own failure; background work stays quiet.
  const requestPlay = async (list:TtsRequest[], index:number, reservation=omniTts.reservePlayback()) => {
    await withTtsAudio(()=>omniTts.play(list,index,reservation),reservation);
    if (['error','blocked'].includes(omniTts.player.status) && omniTts.notice) flash(omniTts.notice);
  };
  const bind = async (node: SafeElement, illustration: boolean): Promise<string> => {
    let key = await node.getAttribute('x-omnitts-bound');
    if (key && bindings.has(key)) { await releaseHost(node); return key; }
    key = uuid(); await node.setAttribute('x-omnitts-bound',key);
    const b: Binding = {node,play:async()=>{},chips:[],message:-1,messageId:'',line:'',source:'',illustration,narration:false};
    b.play = async () => {
      if (!ttsData().settings.enabled) return;
      const reservation = omniTts.reservePlayback();
      const current = await currentTtsContext();
      if (b.illustration) {
        if (!ttsData().settings.illustration) return;
        const bar = await b.node.getParent(), image = await bar?.getParent();
        try {
          const attrs=image?await hostAttributes(image):{},id=attrs['data-inlay-inline-shot']||attrs['x-inlay-inline-shot'];
          if (!id) throw new Error('삽화 ID를 찾지 못했습니다. 채팅을 다시 열어 주세요.');
          b.messageId = `illustration:${id}`;
          const list = await illustrationTtsRequests(id,current); const cast = await bar?.querySelector('[data-omnitts-cast]');
          try {
            if (cast) { for (const chip of b.chips.splice(0)) await releaseHost(chip.node); await cast.setTextContent(''); for (let i=0;i<list.length;i++) { const chip = await doc.createElement('button'); await chip.setTextContent(list[i].segment.speaker); await chip.setStyleAttribute('padding:8px;border-radius:8px;background:#137448;color:#e4ffec;min-height:36px'); b.chips.push({node:chip,play:()=>requestPlay([list[i]],0,omniTts.reservePlayback())}); await cast.appendChild(chip); } }
          } finally { await releaseHost(cast); }
          await requestPlay(list,0,reservation);
        } finally { await releaseHost(image); await releaseHost(bar); }
      } else {
        const list = requests(current,b.message), index = findLine(list,b.source,b.line);
        if (index < 0) throw new Error('이 줄의 원문을 찾지 못했습니다. 메시지가 바뀌었다면 잠시 후 다시 눌러 주세요.');
        await requestPlay(list,index,reservation);
      }
    };
    bindings.set(key,b);
    return key;
  };
  const scanOnce = async () => {
    try {
      if (disposed || !ttsData().settings.enabled) return;
      await refreshViewer();
      const context = await currentTtsContext().catch(()=>null); if(!context){bootstrap();return;} omniTts.setContext(context);
      if (context.scope !== lastScope) { lastScope = context.scope; lastPrefetch = ''; }
      const live = new Set<string>(), nearby: {distance:number;request:TtsRequest}[] = [];
      const height = await doc.clientHeight();
      const perMessage = new Map<number,TtsRequest[]>();
      anchored.clear();
      let lines = 0;
      for (const chat of await safeArray(await doc.querySelectorAll('.risu-chat'))) {
        try {
          const nodes = await safeArray(await chat.querySelectorAll('[data-omnitts-kind]'));
          if (!nodes.length) continue;
          lines += nodes.length;
          // One read per message: the rendered line text identifies each control,
          // so the module never has to stamp ids into another module's input.
          const html = await chat.getOuterHTML();
          const index = Number(/\bdata-chat-index="(-?\d+)"/.exec(html.slice(0, html.indexOf('>') + 1))?.[1] ?? NaN);
          const list = Number.isInteger(index) ? perMessage.get(index) ?? requests(context,index) : [];
          if (Number.isInteger(index)) perMessage.set(index,list);
          const matches = matchTtsAnchors(ttsAnchorTexts(html), list.map(r => r.segment));
          const shown: TtsRequest[] = [];
          for (let j=0;j<nodes.length;j++) {
            const key = await bind(nodes[j]!, false), b = bindings.get(key)!, request = list[matches[j] ?? -1];
            live.add(key);
            b.message = index; b.messageId = request?.messageId || ''; b.line = request?.segment.id || ''; b.source = request?.sourceKey || ''; b.narration = request?.segment.kind === 'narration';
            b.dead = !request;
            await syncVisibility(b);
            if (!request || b.hidden) continue;
            // A control inside a folded block (closed <details>, hidden pane)
            // has no box: that line is not on screen and stays out of the list.
            const rect = await b.node.getBoundingClientRect();
            if (!rect.width || !rect.height) continue;
            shown.push(request);
            nearby.push({distance:Math.abs(rect.top+rect.height/2-height/2),request});
          }
          if (shown.length) anchored.set(index, shown);
        } finally { await releaseHost(chat); }
      }
      for (const node of await safeArray(await doc.querySelectorAll('[data-omnitts-image] [data-omnitts-play],[x-omnitts-image] [x-omnitts-play]'))) live.add(await bind(node, true));
      for (const [key,b] of bindings) if (!live.has(key)) { await releaseHost(b.node);for (const chip of b.chips) await releaseHost(chip.node); bindings.delete(key); }
      nearby.sort((a,b)=>a.distance-b.distance);
      const reading=nearby[0]?.request;
      let readingList=reading?anchored.get([...anchored.entries()].find(([,list])=>list.includes(reading))?.[0] ?? -1)||[]:[];
      if(!lines){
        // A freshly installed display module may not have re-rendered Risu's
        // existing messages yet. The viewer can still read the original reply.
        const chat=await doc.querySelector('.default-chat-screen');
        try{if(chat&&await chat.clientHeight()>0){let index=context.messages.length-1;while(index>=0&&context.messages[index].role!=='char')index--;readingList=requests(context,index);}}finally{await releaseHost(chat);}
        bootstrap();
      }else bootAttempts=8;
      omniTts.reading(readingList);
      await syncState();
      const selected = nearby.slice(0,ttsData().settings.prefetch).map(row=>row.request);
      const fingerprint=JSON.stringify([context.scope,selected.map(r=>[r.messageId,r.segment.id,r.segment.text])]);
      if (fingerprint !== lastPrefetch) { lastPrefetch=fingerprint; void omniTts.prefetch(selected); }
    } catch (error) { if (ttsData().settings.enabled) console.warn('OmniTTS chat scan',error); }
  };
  const requestScan = (): Promise<void> => {
    if (scanTask) { again = true; return scanTask; }
    scanTask = (async () => { try { do { again = false; await scanOnce(); } while (again && !disposed); } finally { scanTask = undefined; } })();
    return scanTask;
  };
  const schedule = (delay=400) => { if (disposed || timer || !ttsData().settings.enabled) return; timer=setTimeout(()=>{timer=undefined;void requestScan();},delay); };
  const observer = await host.createMutationObserver(records => { void (async()=>{try{ for (const record of await safeArray(records)) { const target=await record.getTarget();try{if (await target.matches('[x-omnitts-viewer],[x-omnitts-viewer] *,[x-omnitts-toast],[x-omnitts-toast] *,[x-omnitts-shield]')) continue; schedule(200);}finally{await releaseHost(target);await releaseHost(record);} } }finally{await releaseHost(records);} })().catch(error=>console.warn('OmniTTS observer',error)); });
  await observer.observe(doc,{childList:true,subtree:true});
  const events:{type:string;id:string;options?:AddEventListenerOptions}[]=[];
  const listen=async(type:string,fn:(e:HostPoint)=>void,options?:AddEventListenerOptions)=>{events.push({type,id:await doc.addEventListener(type,fn,options),options});};
  const findHit=async(e:HostPoint,hover:boolean)=>{
    if(!allowed())return;
    const viewer=await doc.querySelector('[x-omnitts-viewer]');
    try{if(viewer&&await hitHost(viewer,e))return;}finally{await releaseHost(viewer);}
    const rows=[...bindings.entries()].filter(([,b])=>!hidden(b)).flatMap(([key,b])=>[
      ...(!hover||!b.illustration?[{key,node:b.node,play:b.play,illustration:b.illustration}]:[]),
      ...(!hover?b.chips.map((c,i)=>({key:key+':'+i,node:c.node,play:c.play,illustration:true})):[])
    ]);
    const hits=await Promise.all(rows.map(r=>hitHost(r.node,e)));return rows[hits.indexOf(true)];
  };
  await listen('click',e=>{
    const epoch=++inputEpoch;
    void findHit(e,false).then(row=>{if(epoch===inputEpoch&&row&&(row.illustration||ttsData().settings.clickPlay))return row.play();}).catch(report);
  });
  await listen('mouseover',e=>{
    if(!ttsData().settings.hoverPlay)return;const epoch=++inputEpoch;
    void findHit(e,true).then(row=>{if(epoch!==inputEpoch)return;if(!row){hovered='';return;}if(hovered!==row.key){hovered=row.key;return row.play();}}).catch(report);
  });
  await listen('scroll',()=>schedule(),{capture:true,passive:true});
  const unsubscribe=subscribeTts(()=>{void syncVisibility().catch(error=>console.warn('OmniTTS button visibility',error));lastPrefetch='';bootAttempts=0;schedule();});
  const unsubscribeState=omniTts.subscribe(()=>{void syncState().catch(error=>console.warn('OmniTTS playing state',error));});
  const seen = new Map<string,string>();
  const output: (arg:ChatOutputListenerArg)=>Promise<void> = async arg=>{
    if (disposed || !ttsData().settings.enabled) return;
    try { const context=await currentTtsContext(); if (String(arg.char?.chaId)!==context.characterId || String(arg.chat?.id)!==context.chatId) return;
      const index=arg.messageIndex; let list=requests(context,index); if (!list.length) return;
      const key=JSON.stringify([context.scope,index]), signature=compactHash(String(context.messages[index]?.data || '')); if (seen.get(key)===signature) return; seen.set(key,signature); if (seen.size>100) seen.delete(seen.keys().next().value!);
      if (!ttsData().settings.autoReply) { schedule(); return; }
      // Let Risu render the reply first so panels other modules drew are skipped.
      await sleep(250); await requestScan();
      const shown = anchored.get(index); if (shown?.length) list = shown;
      await requestPlay(list, list.findIndex(r=>ttsData().settings.narration || r.segment.kind!=='narration'));
    } catch(error) { report(error); }
  };
  if (host.addRisuChatListener) await host.addRisuChatListener('output',output);
  const viewer=await installTtsViewer(doc);refreshViewer=viewer.refresh;flash=viewer.flash;await requestScan();
  if(host.onUnload)await host.onUnload(async()=>{disposed=true;inputEpoch++;installed=false;clearTimeout(timer);unsubscribe();unsubscribeState();omniTts.stop();await disconnectHost(observer);for(const e of events)await doc.removeEventListener(e.type,e.id,e.options);await host.removeRisuChatListener?.('output',output);for(const b of bindings.values()){await releaseHost(b.node);for(const c of b.chips)await releaseHost(c.node);}bindings.clear();await viewer.dispose();await releaseHost(doc);});
}
