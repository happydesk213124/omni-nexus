import { omniTts } from '../services/tts-runtime';
import { ttsData, updateTtsSettings, subscribeTts } from '../storage/tts-store';
import { openTtsSettings } from './host-utils';
import { esc } from './common';

export async function installTtsViewer(doc: SafeDocument): Promise<void> {
  const body = await doc.querySelector('body'); if (!body) return;
  const viewer = await doc.createElement('div'), toast = await doc.createElement('div');
  await viewer.setAttribute('x-omnitts-viewer','1'); await toast.setAttribute('x-omnitts-toast','1');
  await body.appendChild(viewer); await body.appendChild(toast);
  const events:{node:SafeElement;type:string;id:string}[]=[];
  let painting=false, again=false, signature='', toastSignature='', toastTimer:ReturnType<typeof setTimeout>|undefined;
  const act = (f:()=>unknown) => { try { Promise.resolve(f()).catch(error=>omniTts.report(error)); } catch(error) { omniTts.report(error); } };
  const control = (id:string,label:string,title:string,active=false) => `<button x-tts-control="${id}" title="${title}" aria-label="${title}" style="color:#eee;background:${active?'#7132f599':'#11182780'};border:1px solid #ffffff18;border-radius:8px;min-width:36px;min-height:36px;padding:5px;cursor:pointer">${label}</button>`;
  const paint=async()=>{
    if(painting){again=true;return;} painting=true;
    try {
      const s=ttsData().settings,q=omniTts.queue.status,state=omniTts.player.status,current=omniTts.current;
      const status=omniTts.notice || `${omniTts.stage || '음성 준비'} · 생성 ${q.active}/${s.concurrency} · 대기 ${q.waiting}`;
      if(status!==toastSignature){toastSignature=status;await toast.setTextContent(status); if(toastTimer)clearTimeout(toastTimer); if(!q.active&&!q.waiting)toastTimer=setTimeout(()=>{void toast.setStyle('display','none');},3500);}
      await toast.setStyleAttribute(`position:fixed;right:16px;top:18px;z-index:2147483200;width:min(290px,calc(100vw - 32px));height:62px;box-sizing:border-box;padding:12px;border:1px solid #ffffff24;border-radius:12px;color:#eee;background:rgba(23,32,49,.93);font:12px/18px sans-serif;overflow:hidden;pointer-events:none;display:${s.enabled&&s.toast&&(q.active||q.waiting||omniTts.notice)?'block':'none'}`);
      const placement=s.viewerAnchor?`right:min(${Math.max(8,s.viewerAnchor.right)}px,calc(100vw - ${s.minimized?46:310}px));top:min(${Math.max(8,s.viewerAnchor.top)}px,calc(100dvh - 64px));max-height:calc(100dvh - min(${Math.max(8,s.viewerAnchor.top)}px,calc(100dvh - 64px)) - 8px)`:'right:16px;bottom:16px;max-height:80vh';
      await viewer.setStyleAttribute(`position:fixed;${placement};z-index:2147483100;width:${s.minimized?'38px':'min(302px,calc(100vw - 24px))'};overflow:auto;border:1px solid #ffffff26;border-radius:12px;background:rgba(16,22,34,.65);color:#eee;text-shadow:0 1px 3px #000;font:12px/1.5 sans-serif;display:${s.enabled&&s.viewer?'block':'none'}`);
      const next=JSON.stringify([s.minimized,s.panel,s.narration,s.continuous,s.rate,s.volume,s.rates,state,current?.messageId,current?.segment.id,omniTts.list.map(r=>r.segment.id),q,omniTts.cache.count,omniTts.cache.bytes]); if(next===signature)return; signature=next;
      for(const e of events.splice(0))await e.node.removeEventListener(e.type,e.id).catch(()=>{});
      const header=`<div style="display:flex;gap:3px;align-items:center;padding:${s.minimized?'0':'4px'}">${s.minimized?'':`<span style="width:16px;text-align:center">${state==='playing'?'◉':state==='loading'?'◌':state==='paused'?'Ⅱ':'○'}</span>${control('narration','▤','나레이션 읽기',s.narration)}${control('audio',`${s.rate}×`,'배속·볼륨',s.panel==='audio')}${control('cache','◴','캐시 작업',s.panel==='cache')}${control('list','☷','현재 메시지 음성 목록',s.panel==='list')}<span style="flex:1"></span>${control('settings','⚙','TTS 설정')}`}${control('minimize',s.minimized?'+':'−',s.minimized?'펼치기':'최소화')}</div>`;
      let panel='';
      if(s.panel==='audio')panel=`<div style="display:flex;gap:4px;flex-wrap:wrap">${s.rates.map((r,i)=>control(`rate-${i}`,`${r}×`,'배속',r===s.rate)).join('')}</div><div style="display:flex;gap:6px;align-items:center;margin-top:7px"><span>볼륨 ${Math.round(s.volume*100)}%</span><button x-tts-control="volume" aria-label="볼륨 조절" role="slider" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(s.volume*100)}" style="flex:1;height:32px;border:1px solid #ffffff30;background:linear-gradient(to right,#7132f5 ${s.volume*100}%,#283043 0);border-radius:6px"></button></div>`;
      if(s.panel==='cache')panel=`생성 ${q.active}/${s.concurrency} · 대기 ${q.waiting}<br>캐시 ${omniTts.cache.count}개 · ${(omniTts.cache.bytes/1024/1024).toFixed(1)} MB`;
      if(s.panel==='list')panel=omniTts.list.map((r,i)=>s.narration||r.segment.kind!=='narration'?`<div>${control(`line-${i}`,esc((r.segment.speaker?r.segment.speaker+': ':'')+r.segment.text),'재생',r===current)}</div>`:'').join('');
      const content=s.minimized?'':`<div style="padding:4px 9px 9px"><div style="overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${esc(current?`${current.segment.speaker}${current.segment.tone?' · '+current.segment.tone:''} : ${current.segment.text}`:'')}</div><div style="display:grid;grid-template-columns:40px 1fr 40px;gap:4px;margin-top:6px">${control('continuous','↪','다음 구간 이어 읽기',s.continuous)}<div style="display:flex;justify-content:center;gap:4px">${control('previous','|◀','이전')}${control('play',state==='playing'?'Ⅱ':'▶','재생·일시정지',state==='playing')}${control('next','▶|','다음')}</div>${control('stop','■','정지')}</div>${panel?`<div style="border-top:1px solid #ffffff24;margin-top:8px;padding-top:7px;overflow:hidden">${panel}</div>`:''}</div>`;
      const timeline=s.minimized?'':`<div style="padding:0 9px 8px;display:flex;align-items:center;gap:6px"><small x-tts-time="1">0:00</small><button x-tts-control="seek" aria-label="재생 위치" style="flex:1;border:1px solid #ffffff24;background:#283043;height:12px;border-radius:6px"></button></div>`;
      await viewer.setInnerHTML(header+content+timeline);
      const bind=async(id:string,callback:()=>unknown)=>{const node=await viewer.querySelector(`[x-tts-control="${id}"]`);if(node)events.push({node,type:'click',id:await node.addEventListener('click',()=>act(callback))});};
      await bind('minimize',async()=>{const rect=await viewer.getBoundingClientRect();const html=await doc.querySelector('html');const width=html?await html.clientWidth():rect.right+16;await updateTtsSettings({minimized:!ttsData().settings.minimized,viewerAnchor:ttsData().settings.viewerAnchor||{right:Math.max(8,width-rect.right),top:rect.top}});});
      if(s.minimized)return;
      await bind('settings',openTtsSettings);await bind('narration',()=>updateTtsSettings({narration:!ttsData().settings.narration}));await bind('continuous',()=>updateTtsSettings({continuous:!ttsData().settings.continuous}));
      for(const name of ['audio','cache','list'] as const)await bind(name,()=>updateTtsSettings({panel:ttsData().settings.panel===name?'':name}));
      await bind('stop',()=>omniTts.stop());await bind('previous',()=>omniTts.next(-1));await bind('next',()=>omniTts.next(1));
      await bind('play',()=>{if(!omniTts.player.ready)return openTtsSettings();if(omniTts.player.status==='playing')return omniTts.pause();if(omniTts.player.status==='paused')return omniTts.player.resume();if(current)return omniTts.replay();});
      for(let i=0;i<s.rates.length;i++)await bind(`rate-${i}`,()=>updateTtsSettings({rate:s.rates[i]}));
      for(let i=0;i<omniTts.list.length;i++)await bind(`line-${i}`,()=>omniTts.play([...omniTts.list],i));
      const volume=await viewer.querySelector('[x-tts-control="volume"]');if(volume){events.push({node:volume,type:'pointerdown',id:await volume.addEventListener('pointerdown',(event:{clientX:number})=>act(async()=>{const rect=await volume.getBoundingClientRect();await updateTtsSettings({volume:Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width))});}))});events.push({node:volume,type:'keydown',id:await volume.addEventListener('keydown',(event:{key:string})=>{if(['ArrowLeft','ArrowRight'].includes(event.key))act(()=>updateTtsSettings({volume:ttsData().settings.volume+(event.key==='ArrowRight'?.05:-.05)}));})});}
      const seek=await viewer.querySelector('[x-tts-control="seek"]');if(seek)events.push({node:seek,type:'pointerdown',id:await seek.addEventListener('pointerdown',(event:{clientX:number})=>act(async()=>{const rect=await seek.getBoundingClientRect();omniTts.player.seek((event.clientX-rect.left)/rect.width*omniTts.player.progress.duration);}))});
    } finally {painting=false;if(again){again=false;void paint();}}
  };
  omniTts.subscribe(()=>{void paint().catch(error=>console.warn('OmniTTS viewer',error));}); subscribeTts(()=>{void paint().catch(error=>console.warn('OmniTTS viewer',error));}); await paint();
  let ticking=false;
  setInterval(()=>{const s=ttsData().settings;if(ticking||painting||!s.enabled||!s.viewer||s.minimized||omniTts.player.status!=='playing')return;ticking=true;void(async()=>{const progress=omniTts.player.progress,time=await viewer.querySelector('[x-tts-time]'),seek=await viewer.querySelector('[x-tts-control="seek"]');const format=(n:number)=>`${Math.floor(n/60)}:${String(Math.floor(n%60)).padStart(2,'0')}`;if(time)await time.setTextContent(`${format(progress.current)} / ${format(Number.isFinite(progress.duration)?progress.duration:0)}`);if(seek)await seek.setStyle('background',`linear-gradient(to right,#7132f5 ${progress.duration>0?progress.current/progress.duration*100:0}%,#283043 0)`);})().catch(()=>{}).finally(()=>{ticking=false;});},500);
}
