import { omniTts } from '../services/tts-runtime';
import { ttsData, updateTtsSettings, subscribeTts } from '../storage/tts-store';
import { openTtsSettings, hitHost, releaseHost, safeArray, type HostPoint } from './host-utils';
import { bindTtsDrag } from './host-drag';
import { esc } from './common';
import { withTtsAudio } from './activation';

export async function installTtsViewer(doc: SafeDocument): Promise<{refresh:()=>Promise<void>;dispose:()=>Promise<void>;flash:(message:string)=>void}> {
  const body = await doc.querySelector('body'); if (!body) return {refresh:async()=>{},dispose:async()=>{},flash:()=>{}};
  for(const node of await safeArray(await doc.querySelectorAll('[x-omnitts-viewer],[x-omnitts-toast]'))){await node.remove();await releaseHost(node);}
  const viewer = await doc.createElement('div'), toast = await doc.createElement('div');
  await viewer.setAttribute('x-omnitts-viewer','1'); await toast.setAttribute('x-omnitts-toast','1');
  await body.appendChild(viewer); await body.appendChild(toast);await releaseHost(body);
  let inChat = false, lastAllowed = false, disposed=false, clickEpoch=0;
  const allowed = () => { const blocked=Reflect.get(globalThis,'__OMNI_TTS_HOST_BLOCKED__'); return !disposed && inChat && typeof blocked === 'function' && !blocked(); };
  const actions=new Map<string,{node:SafeElement;run:()=>unknown}>(),events:{type:string;id:string}[]=[];
  let listViewport: SafeElement | undefined;
  let drag:Awaited<ReturnType<typeof bindTtsDrag>>|undefined;
  let painting=false, again=false, signature='', toastSignature='', stateSignature='', notice='', noticeUntil=0, noticeTimer: ReturnType<typeof setTimeout> | undefined;
  let currentLine = -1;
  const act = (f:()=>unknown) => { try { Promise.resolve(f()).catch(error=>omniTts.report(error)); } catch(error) { omniTts.report(error); } };
  const control = (id:string,label:string,title:string,active=false) => `<button data-tts-control="${id}" title="${title}" aria-label="${title}" style="color:#eee;background:${active?'#7132f599':'#11182780'};border:1px solid #ffffff18;border-radius:8px;min-width:36px;min-height:36px;padding:5px;cursor:pointer">${label}</button>`;
  const paint=async()=>{
    if(disposed)return;
    if(painting){again=true;return;} painting=true;
    try {
      const s=ttsData().settings,q=omniTts.queue.status,state=omniTts.player.status;
      // A failed click explains itself; background generation keeps the opt-in toast.
      const failing=!!notice&&Date.now()<noticeUntil;
      const status=failing?notice:`음성 생성 ${q.active}/${s.concurrency}${q.waiting?' · 대기 '+q.waiting:''}`;
      const shown=s.enabled&&allowed()&&(failing||(s.toast&&q.active>0));
      const toastNext=JSON.stringify([status,failing,shown]);
      if(toastNext!==toastSignature){toastSignature=toastNext;await toast.setTextContent(status);
      await toast.setStyleAttribute(`position:fixed;right:16px;top:18px;z-index:2147483200;width:min(290px,calc(100vw - 32px));${failing?'min-height:44px;max-height:120px':'height:44px'};box-sizing:border-box;padding:12px;border:1px solid ${failing?'#f8717188':'#ffffff24'};border-radius:12px;color:#eee;background:${failing?'rgba(69,20,28,.95)':'rgba(23,32,49,.93)'};font:12px/18px sans-serif;overflow:hidden;overflow-wrap:anywhere;pointer-events:none;display:${shown?'block':'none'}`);}
      if(drag?.busy)return;
      const placement=s.viewerAnchor?`right:min(${Math.max(8,s.viewerAnchor.right)}px,calc(100vw - ${s.minimized?46:310}px));top:min(${Math.max(8,s.viewerAnchor.top)}px,calc(100dvh - 64px));max-height:calc(100dvh - min(${Math.max(8,s.viewerAnchor.top)}px,calc(100dvh - 64px)) - 8px)`:'right:16px;bottom:16px;max-height:80vh';
      await viewer.setStyleAttribute(`position:fixed;${placement};z-index:2147483100;width:${s.minimized?'38px':'min(302px,calc(100vw - 24px))'};overflow:auto;border:1px solid #ffffff26;border-radius:12px;background:rgba(16,22,34,.65);color:#eee;text-shadow:0 1px 3px #000;font:12px/1.5 sans-serif;display:${s.enabled&&s.viewer&&allowed()?'block':'none'}`);
      // Playback state is painted in place below: re-rendering would reset the list scroll.
      const next=JSON.stringify([s.minimized,s.panel,s.narration,s.continuous,s.rate,s.volume,s.rates,omniTts.list.map(r=>[r.messageId,r.segment.id,r.segment.text]),s.panel==='cache'?[q,omniTts.cache.count,omniTts.cache.bytes]:null]); if(next===signature){await paintState();return;} signature=next;stateSignature='';currentLine=-1;
      for(const action of actions.values())await releaseHost(action.node);actions.clear();
      await releaseHost(listViewport); listViewport = undefined;
      const header=`<div data-tts-header="1" style="display:flex;gap:3px;align-items:center;cursor:grab;touch-action:none;user-select:none;padding:${s.minimized?'0':'4px'}">${s.minimized?'':`<span data-tts-state="1" style="width:16px;text-align:center">${stateIcon(state)}</span>${control('narration','▤','나레이션 읽기',s.narration)}${control('audio',`${s.rate}×`,'배속·볼륨',s.panel==='audio')}${control('cache','◴','캐시 작업',s.panel==='cache')}${control('list','☷','현재 메시지 음성 목록',s.panel==='list')}<span style="flex:1"></span>${control('settings','⚙','TTS 설정')}`}${control('minimize',s.minimized?'+':'−',s.minimized?'펼치기':'최소화')}</div>`;
      let panel='';
      if(s.panel==='audio')panel=`<div style="display:flex;gap:4px;flex-wrap:wrap">${s.rates.map((r,i)=>control(`rate-${i}`,`${r}×`,'배속',r===s.rate)).join('')}</div><div style="display:flex;gap:6px;align-items:center;margin-top:7px"><span>볼륨 ${Math.round(s.volume*100)}%</span><button data-tts-control="volume" aria-label="볼륨 조절" role="slider" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(s.volume*100)}" style="flex:1;height:32px;border:1px solid #ffffff30;background:linear-gradient(to right,#7132f5 ${s.volume*100}%,#283043 0);border-radius:6px"></button></div>`;
      if(s.panel==='cache')panel=`생성 ${q.active}/${s.concurrency} · 대기 ${q.waiting}<br>캐시 ${omniTts.cache.count}개 · ${(omniTts.cache.bytes/1024/1024).toFixed(1)} MB`;
      if(s.panel==='list')panel=`<div data-tts-list-scroll="1" style="max-height:max(0px,min(240px,35dvh,calc(80vh - 170px)));overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;touch-action:pan-y">${omniTts.list.map((r,i)=>s.narration||r.segment.kind!=='narration'?`<div>${control(`line-${i}`,esc((r.segment.speaker?r.segment.speaker+': ':'')+r.segment.text),'재생')}</div>`:'').join('')}</div>`;
      const content=s.minimized?'':`<div style="padding:4px 9px 9px"><div data-tts-current="1" style="overflow:hidden;white-space:nowrap;text-overflow:ellipsis"></div><div style="display:grid;grid-template-columns:40px 1fr 40px;gap:4px;margin-top:6px">${control('continuous','↪','다음 구간 이어 읽기',s.continuous)}<div style="display:flex;justify-content:center;gap:4px">${control('previous','|◀','이전')}${control('play','▶','재생·일시정지')}${control('next','▶|','다음')}</div>${control('stop','■','정지')}</div>${panel?`<div style="border-top:1px solid #ffffff24;margin-top:8px;padding-top:7px;overflow:hidden">${panel}</div>`:''}</div>`;
      const timeline=s.minimized?'':`<div style="padding:0 9px 8px;display:flex;align-items:center;gap:6px"><small data-tts-time="1">0:00</small><button data-tts-control="seek" aria-label="재생 위치" style="flex:1;border:1px solid #ffffff24;background:#283043;height:12px;border-radius:6px"></button></div>`;
      await viewer.setInnerHTML(header+content+timeline);
      listViewport = await viewer.querySelector('[data-tts-list-scroll]') || undefined;
      const bind=async(id:string,callback:()=>unknown)=>{const node=await viewer.querySelector(`[data-tts-control="${id}"]`);if(node)actions.set(id,{node,run:callback});};
      await bind('minimize',async()=>{const rect=await viewer.getBoundingClientRect(),width=await doc.clientWidth();await updateTtsSettings({minimized:!ttsData().settings.minimized,viewerAnchor:ttsData().settings.viewerAnchor||{right:Math.max(8,width-rect.right),top:rect.top}});});
      if(s.minimized)return;
      await bind('settings',openTtsSettings);await bind('narration',()=>updateTtsSettings({narration:!ttsData().settings.narration}));await bind('continuous',()=>updateTtsSettings({continuous:!ttsData().settings.continuous}));
      for(const name of ['audio','cache','list'] as const)await bind(name,()=>updateTtsSettings({panel:ttsData().settings.panel===name?'':name}));
      await bind('stop',()=>omniTts.stop());await bind('previous',()=>withTtsAudio(()=>omniTts.next(-1)));await bind('next',()=>withTtsAudio(()=>omniTts.next(1)));
      await bind('play',()=>{if(omniTts.player.status==='playing')return omniTts.pause();if(omniTts.player.status==='paused'&&omniTts.player.ready)return omniTts.player.resume();return withTtsAudio(()=>omniTts.replay());});
      for(let i=0;i<s.rates.length;i++)await bind(`rate-${i}`,()=>updateTtsSettings({rate:s.rates[i]}));
      for(let i=0;i<omniTts.list.length;i++)await bind(`line-${i}`,()=>{const list=[...omniTts.list],reservation=omniTts.reservePlayback();return withTtsAudio(()=>omniTts.play(list,i,reservation),reservation);});
      await bind('volume',()=>{});await bind('seek',()=>{});
      await paintState();
    } finally {painting=false;if(again){again=false;void paint();}}
  };
  async function paintState(): Promise<void> {
    const s=ttsData().settings,state=omniTts.player.status,current=omniTts.current;
    if(s.minimized)return;
    const line=current?omniTts.list.findIndex(r=>r.messageId===current.messageId&&r.segment.id===current.segment.id):-1;
    const next=JSON.stringify([state,current?.messageId,current?.segment.id,current?.segment.text,line]);
    if(next===stateSignature)return;stateSignature=next;
    const icon=await viewer.querySelector('[data-tts-state]'),text=await viewer.querySelector('[data-tts-current]');
    try{
      await icon?.setTextContent(stateIcon(state));
      await text?.setTextContent(current?`${current.segment.speaker}${current.segment.tone?' · '+current.segment.tone:''} : ${current.segment.text}`:'');
    }finally{await releaseHost(icon);await releaseHost(text);}
    const play=actions.get('play')?.node;
    if(play){await play.setTextContent(state==='playing'?'Ⅱ':'▶');await play.setStyle('background',state==='playing'?'#7132f599':'#11182780');}
    if(currentLine!==line){
      const old=actions.get(`line-${currentLine}`)?.node,fresh=actions.get(`line-${line}`)?.node;
      if(old)await old.setStyle('background','#11182780');
      if(fresh)await fresh.setStyle('background','#7132f599');
      currentLine=line;
    }
  }
  function stateIcon(state:string):string{return state==='playing'?'◉':state==='loading'?'◌':state==='paused'?'Ⅱ':'○';}
  const render=()=>{void paint().catch(error=>console.warn('OmniTTS viewer',error));};
  const unsubscribeRuntime=omniTts.subscribe(render),unsubscribeSettings=subscribeTts(render);
  await paint();
  const hit=async(e:HostPoint)=>{
    if(!allowed()||!ttsData().settings.enabled||!ttsData().settings.viewer||drag?.suppressClick||!await hitHost(viewer,e))return;
    const insideList = listViewport ? await hitHost(listViewport,e) : false;
    const rows=[...actions.entries()],hits=await Promise.all(rows.map(([id,a])=>id.startsWith('line-')&&!insideList?false:hitHost(a.node,e)));
    return rows[hits.indexOf(true)];
  };
  // SafeElement events are document-wide and contain no event target.
  events.push({type:'click',id:await doc.addEventListener('click',(e:HostPoint)=>{
    const epoch=++clickEpoch;act(async()=>{const row=await hit(e);if(epoch===clickEpoch&&row&&!drag?.busy)await row[1].run();});
  })});
  events.push({type:'pointerdown',id:await doc.addEventListener('pointerdown',(e:HostPoint)=>act(async()=>{
    const row=await hit(e);if(!row||!['volume','seek'].includes(row[0]))return;
    const rect=await row[1].node.getBoundingClientRect(),fraction=Math.max(0,Math.min(1,(e.clientX-rect.left)/rect.width));
    if(row[0]==='volume')await updateTtsSettings({volume:fraction});else omniTts.player.seek(fraction*omniTts.player.progress.duration);
  }))});
  events.push({type:'keydown',id:await doc.addEventListener('keydown',(e:{key:string})=>act(async()=>{
    const volume=actions.get('volume');if(allowed()&&volume&&['ArrowLeft','ArrowRight'].includes(e.key)&&await volume.node.matches(':focus'))await updateTtsSettings({volume:ttsData().settings.volume+(e.key==='ArrowRight'?.05:-.05)});
  }))});
  drag=await bindTtsDrag(doc,viewer,()=>allowed()&&ttsData().settings.enabled&&ttsData().settings.viewer,paint);
  const refreshVisibility = async () => {
    const chat = await doc.querySelector('.default-chat-screen');
    const rect = chat ? await chat.getBoundingClientRect() : null;
    await releaseHost(chat);
    inChat = !!rect && rect.width > 0 && rect.height > 0;
    if(!allowed()&&drag?.busy)await drag.cancel();
    lastAllowed = allowed(); await paint();
  };
  const refreshSignal=()=>{if(!allowed()&&drag?.busy)void drag.cancel();render();};
  Reflect.set(globalThis,'__OMNI_TTS_REFRESH_VISIBILITY__',refreshSignal);
  await refreshVisibility();
  let ticking=false;
  const interval=setInterval(()=>{const visible=allowed();if(visible!==lastAllowed){lastAllowed=visible;refreshSignal();}const s=ttsData().settings;if(!visible||ticking||painting||!s.enabled||!s.viewer||s.minimized||omniTts.player.status!=='playing')return;ticking=true;void(async()=>{const progress=omniTts.player.progress,time=await viewer.querySelector('[data-tts-time]'),seek=actions.get('seek')?.node;const format=(n:number)=>`${Math.floor(n/60)}:${String(Math.floor(n%60)).padStart(2,'0')}`;try{if(time)await time.setTextContent(`${format(progress.current)} / ${format(Number.isFinite(progress.duration)?progress.duration:0)}`);if(seek)await seek.setStyle('background',`linear-gradient(to right,#7132f5 ${progress.duration>0?progress.current/progress.duration*100:0}%,#283043 0)`);}finally{await releaseHost(time);}})().catch(()=>{}).finally(()=>{ticking=false;});},500);
  const flash=(message:string)=>{
    notice=message.slice(0,240);noticeUntil=Date.now()+5000;clearTimeout(noticeTimer);
    noticeTimer=setTimeout(()=>{noticeUntil=0;render();},5100);render();
  };
  return {refresh:refreshVisibility,flash,dispose:async()=>{disposed=true;clearTimeout(noticeTimer);clickEpoch++;clearInterval(interval);unsubscribeRuntime();unsubscribeSettings();await drag?.dispose();for(const e of events)await doc.removeEventListener(e.type,e.id);for(const a of actions.values())await releaseHost(a.node);actions.clear();await releaseHost(listViewport);if(Reflect.get(globalThis,'__OMNI_TTS_REFRESH_VISIBILITY__')===refreshSignal)Reflect.deleteProperty(globalThis,'__OMNI_TTS_REFRESH_VISIBILITY__');await viewer.remove();await toast.remove();await releaseHost(viewer);await releaseHost(toast);}};
}
