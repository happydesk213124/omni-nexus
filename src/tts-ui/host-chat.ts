import { risuHost } from '../core/host';
import { ttsData, subscribeTts } from '../storage/tts-store';
import { omniTts, type TtsRequest } from '../services/tts-runtime';
import { currentTtsContext, type TtsChatContext } from '../services/tts-context';
import { parseTtsMessage, compactHash, cueLineKey } from '../domain/tts/segment';
import { illustrationTtsRequests } from '../services/tts-illustration';
import { safeArray, openTtsSettings } from './host-utils';
import { installTtsViewer } from './host-viewer';

interface Binding { node: SafeElement; events: [string,string][]; chips: {node:SafeElement;id:string}[]; message: number; line: string; source: string; illustration: boolean }
function requests(context: TtsChatContext, index: number): TtsRequest[] {
  const message = context.messages[index]; if (!message || message.role !== 'char') return [];
  const source = String(message.data || '');
  return parseTtsMessage(source).map(segment => ({ context, messageId:String(message.chatId || message.id || `${index}:${compactHash(source)}`), sourceKey:cueLineKey(source.slice(segment.start,segment.end)), segment }));
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
  const bindings = new Map<string,Binding>(); let timer: ReturnType<typeof setTimeout> | undefined, scanning = false, again = false, lastScope = '', lastPrefetch = '';
  const requestPlay = async (list:TtsRequest[], index:number, reservation?:number) => { if (!omniTts.player.ready) { await openTtsSettings(); omniTts.report(new Error('음성 재생 활성화 버튼을 한 번 눌러 주세요.')); return; } await omniTts.play(list,index,reservation); };
  const scan = async () => {
    if (scanning) { again = true; return; } scanning = true;
    try {
      if (!ttsData().settings.enabled) return;
      const context = await currentTtsContext(); omniTts.setContext(context);
      if (context.scope !== lastScope) { lastScope = context.scope; lastPrefetch = ''; }
      const nodes = await safeArray(await doc.querySelectorAll('[x-omnitts-play],[data-omnitts-play]'));
      const live = new Set<string>(), nearby: {distance:number;request:TtsRequest}[] = [];
      const html = await doc.querySelector('html'), height = html ? await html.clientHeight() : 800;
      const perMessage = new Map<number,TtsRequest[]>();
      for (const node of nodes) {
        let key = await node.getAttribute('x-omnitts-bound');
        const parent = await node.getParent(); if (!parent) continue;
        const illustration = await parent.matches('[data-omnitts-image],[x-omnitts-image]');
        let line = '', source = '', message = -1;
        if (!illustration) { line = await parent.getAttribute('x-omnitts-line') || ''; source = await parent.getAttribute('x-omnitts-source') || ''; message = Number(await parent.getAttribute('x-omnitts-message') ?? -1); }
        if (!key || !bindings.has(key)) {
          key = crypto.randomUUID(); await node.setAttribute('x-omnitts-bound',key); const b:Binding = {node,events:[],chips:[],message,line,source,illustration}; bindings.set(key,b);
          const play = async () => {
            if (!ttsData().settings.enabled) return;
            const reservation = omniTts.reservePlayback();
            const current = await currentTtsContext();
            if (b.illustration) {
              if (!ttsData().settings.illustration) return;
              const bar = await b.node.getParent(), image = await bar?.getParent(); const id = await image?.getAttribute('x-inlay-inline-shot'); if (!id) return;
              const list = await illustrationTtsRequests(id,current); const cast = await bar?.querySelector('[data-omnitts-cast]');
              if (cast) { for (const chip of b.chips.splice(0)) await chip.node.removeEventListener('click',chip.id); await cast.setTextContent(''); for (let i=0;i<list.length;i++) { const chip = await doc.createElement('button'); await chip.setTextContent(list[i].segment.speaker); await chip.setStyleAttribute('padding:8px;border-radius:8px;background:#22192faa;color:#e4dcff;min-height:36px'); const id=await chip.addEventListener('click', () => { void requestPlay([list[i]],0).catch(error => omniTts.report(error)); }); b.chips.push({node:chip,id}); await cast.appendChild(chip); } }
              await requestPlay(list,0,reservation);
            } else { const list = requests(current,b.message), index = findLine(list,b.source,b.line); await requestPlay(list,index,reservation); }
          };
          b.events.push(['click',await node.addEventListener('click', () => { if (ttsData().settings.clickPlay || illustration) void play().catch(error => omniTts.report(error)); })]);
          if (!illustration) b.events.push(['pointerenter',await node.addEventListener('pointerenter', () => { if (ttsData().settings.hoverPlay) void play().catch(error => omniTts.report(error)); })]);
        }
        const binding = bindings.get(key)!; binding.message=message;binding.line=line;binding.source=source;
        live.add(key);
        if (!illustration && message >= 0) {
          let list = perMessage.get(message); if (!list) { list=requests(context,message); perMessage.set(message,list); }
          const request = list[findLine(list,source,line)]; if (!request || (request.segment.kind === 'narration' && !ttsData().settings.narration)) continue;
          const rect = await node.getBoundingClientRect(); if (rect.width && rect.height) nearby.push({distance:Math.abs(rect.top+rect.height/2-height/2),request});
        }
      }
      for (const [key,b] of bindings) if (!live.has(key)) { for (const [type,id] of b.events) await b.node.removeEventListener(type,id).catch(() => {}); for (const chip of b.chips) await chip.node.removeEventListener('click',chip.id).catch(()=>{}); bindings.delete(key); }
      const selected = nearby.sort((a,b)=>a.distance-b.distance).slice(0,ttsData().settings.prefetch).map(row=>row.request);
      const fingerprint=JSON.stringify([context.scope,selected.map(r=>[r.messageId,r.segment.id,r.segment.text])]);
      if (fingerprint !== lastPrefetch) { lastPrefetch=fingerprint; void omniTts.prefetch(selected); }
    } catch (error) { if (ttsData().settings.enabled) omniTts.report(error); }
    finally { scanning=false; if (again) { again=false; schedule(); } }
  };
  const schedule = () => { if (timer || !ttsData().settings.enabled) return; timer=setTimeout(()=>{timer=undefined;void scan();},400); };
  const observer = await host.createMutationObserver(records => { void (async()=>{ for (const record of await safeArray(records)) { const target=await record.getTarget(); if (await target.matches('[x-omnitts-viewer],[x-omnitts-viewer] *,[x-omnitts-toast],[x-omnitts-toast] *')) continue; schedule(); break; } })().catch(error=>omniTts.report(error)); });
  await observer.observe(doc,{childList:true,subtree:true});
  await doc.addEventListener('scroll',schedule,{capture:true,passive:true});
  subscribeTts(()=>{lastPrefetch='';schedule();});
  const seen = new Map<string,string>();
  if (host.addRisuChatListener) await host.addRisuChatListener('output',async arg=>{
    if (!ttsData().settings.enabled) return;
    try { const context=await currentTtsContext(); if (String(arg.char?.chaId)!==context.characterId || String(arg.chat?.id)!==context.chatId) return;
      const index=arg.messageIndex, list=requests(context,index); if (!list.length) return;
      const key=JSON.stringify([context.scope,index]), signature=compactHash(String(context.messages[index]?.data || '')); if (seen.get(key)===signature) return; seen.set(key,signature); if (seen.size>100) seen.delete(seen.keys().next().value!);
      if (ttsData().settings.autoReply) await requestPlay(list, list.findIndex(r=>ttsData().settings.narration || r.segment.kind!=='narration')); schedule();
    } catch(error) { omniTts.report(error); }
  });
  await installTtsViewer(doc); schedule();
}
