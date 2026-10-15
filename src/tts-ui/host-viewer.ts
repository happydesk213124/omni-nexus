import { omniTts } from '../services/tts-runtime';
import { ttsData, updateTtsSettings, subscribeTts } from '../storage/tts-store';
import { openTtsSettings, hitHost, releaseHost, safeArray, type HostPoint } from './host-utils';
import { bindTtsDrag } from './host-drag';
import { esc } from './common';
import { withTtsAudio } from './activation';
import type { TtsSegment } from '../core/tts-types';
import { omniSound } from '../services/sound-runtime';
import { soundData, updateSoundSettings, subscribeSound } from '../storage/sound-store';

/** The BGM bar opens above the header; a top-anchored viewer moves up by this much so the header stays put. */
const BGM_H = 76;
const clock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

const LINE_STYLE='backdrop-filter:none!important;-webkit-backdrop-filter:none!important;box-shadow:none;text-shadow:none;transition:none;display:block;width:100%;box-sizing:border-box;margin:0 0 3px;padding:5px 8px;min-height:30px;border:1px solid #ffffff18;border-radius:8px;color:#eee;text-align:left;font:inherit;cursor:pointer;';

export async function installTtsViewer(doc: SafeDocument, revealInChat: () => Promise<void> = async () => {}): Promise<{refresh:()=>Promise<void>;dispose:()=>Promise<void>;flash:(message:string)=>void}> {
  const body = await doc.querySelector('body'); if (!body) return {refresh:async()=>{},dispose:async()=>{},flash:()=>{}};
  await omniSound.init().catch(error=>console.warn('OmniSound',error));
  const bgmOpen=()=>{try{return soundData().settings.viewerBgm;}catch{return false;}};
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
  let currentLine = -1, locating = false;
  // The BGM track list, opened from the track name. Not a <select>: SafeDOM gives
  // neither its change event nor its value, so it is a list of rows like ☷.
  let bgmPicking = false;
  const act = (f:()=>unknown) => { try { Promise.resolve(f()).catch(error=>omniTts.report(error)); } catch(error) { omniTts.report(error); } };
  const control = (id:string,label:string,title:string,active=false) => `<button data-tts-control="${id}" title="${title}" aria-label="${title}" style="backdrop-filter:none!important;-webkit-backdrop-filter:none!important;box-shadow:none;text-shadow:none;transition:none;color:#eee;background:${active?'#7132f599':'#11182780'};border:1px solid #ffffff18;border-radius:8px;min-width:36px;min-height:36px;padding:5px;cursor:pointer">${label}</button>`;
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
      const bgmLift=!s.minimized&&bgmOpen()?BGM_H:0;
      const placement=s.viewerAnchor?`right:min(${Math.max(8,s.viewerAnchor.right)}px,calc(100vw - ${s.minimized?46:310}px));top:min(${Math.max(8,s.viewerAnchor.top-bgmLift)}px,calc(100dvh - 64px));max-height:calc(100dvh - min(${Math.max(8,s.viewerAnchor.top-bgmLift)}px,calc(100dvh - 64px)) - 8px)`:'right:16px;bottom:16px;max-height:80vh';
      await viewer.setStyleAttribute(`position:fixed;${placement};z-index:2147483100;will-change:transform;contain:layout style;width:${s.minimized?'38px':'min(302px,calc(100vw - 24px))'};overflow:auto;border:1px solid #ffffff26;border-radius:12px;background:rgba(16,22,34,.82);color:#eee;text-shadow:none;-webkit-backdrop-filter:none!important;backdrop-filter:none!important;box-shadow:none;user-select:none;-webkit-user-select:none;font:12px/1.5 sans-serif;display:${s.enabled&&s.viewer&&allowed()?'block':'none'}`);
      // Playback state is painted in place below: re-rendering would reset the list scroll.
      const picking=bgmPicking&&bgmOpen()&&!s.minimized;
      const next=JSON.stringify([bgmOpen()&&!s.minimized?bgmState():null,picking?soundData().bgm.map(item=>[item.key,item.name,item.folder]):null,s.minimized,s.panel,s.narration,s.continuous,s.rate,s.volume,s.rates,omniTts.list.map(r=>[r.messageId,r.segment.id,r.segment.text]),s.panel==='cache'?[q,omniTts.cache.count,omniTts.cache.bytes]:null]); if(next===signature){await paintState();return;} signature=next;stateSignature='';currentLine=-1;
      for(const action of actions.values())await releaseHost(action.node);actions.clear();
      await releaseHost(listViewport); listViewport = undefined;
      const header=`<div data-tts-header="1" style="display:flex;gap:3px;align-items:center;cursor:grab;touch-action:none;user-select:none;padding:${s.minimized?'0':'4px'}">${s.minimized?'':`<span data-tts-state="1" style="width:16px;text-align:center">${stateIcon(state)}</span>${control('narration','▤','나레이션 읽기',s.narration)}${control('audio',`${s.rate}×`,'배속·볼륨',s.panel==='audio'&&!picking)}${control('cache','◴','캐시 작업',s.panel==='cache'&&!picking)}${control('list','☷','현재 메시지 음성 목록',s.panel==='list'&&!picking)}<span style="flex:1;display:flex;justify-content:center">${control('bgm','♪','BGM',bgmOpen())}</span>${control('settings','⚙','TTS 설정')}`}${control('minimize',s.minimized?'+':'−',s.minimized?'펼치기':'최소화')}</div>`;
      const current=omniTts.current;
      let panel='';
      if(s.panel==='audio')panel=`<div style="display:flex;gap:4px;flex-wrap:wrap">${s.rates.map((r,i)=>control(`rate-${i}`,`${r}×`,'배속',r===s.rate)).join('')}</div><div style="display:flex;gap:6px;align-items:center;margin-top:7px"><span>볼륨 ${Math.round(s.volume*100)}%</span><button data-tts-control="volume" aria-label="볼륨 조절" role="slider" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(s.volume*100)}" style="flex:1;height:32px;border:1px solid #ffffff30;background:linear-gradient(to right,#7132f5 ${s.volume*100}%,#283043 0);border-radius:6px"></button></div>`;
      if(s.panel==='cache')panel=`생성 ${q.active}/${s.concurrency} · 대기 ${q.waiting}<br>캐시 ${omniTts.cache.count}개 · ${(omniTts.cache.bytes/1024/1024).toFixed(1)} MB`;
      if(s.panel==='list')panel=`<div data-tts-list-scroll="1" style="max-height:max(0px,min(240px,35dvh,calc(80vh - 170px)));overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;touch-action:pan-y">${omniTts.list.map((r,i)=>s.narration||r.segment.kind!=='narration'?`<button data-tts-control="line-${i}" title="재생" aria-label="${esc(lineLabel(r.segment))} 재생" style="${LINE_STYLE}background:#11182780">${lineHtml(r.segment)}</button>`:'').join('')}</div>`;
      // The track list stands in for whichever panel is open; closing it brings that one back.
      if(picking)panel=bgmPicker();
      // Fixed rows in a fixed order: the line, the controls, then the seek bar.
      // Panels open below them, so toggling one never moves the player.
      const content=s.minimized?'':`<div style="padding:4px 9px 9px"><div data-tts-current="1" style="height:22px;line-height:22px;overflow:hidden">${current?lineHtml(current.segment):''}</div><div style="display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:4px;margin-top:6px">${control('continuous','↪','다음 구간 이어 읽기',s.continuous)}${control('locate','⌖','목록에서 지금 줄 찾기')}${control('previous','|◀','이전')}${control('play','▶','재생·일시정지')}${control('next','▶|','다음')}${control('regenerate','↻','이 줄 음성 다시 만들기')}${control('stop','■','정지')}</div><div style="display:flex;align-items:center;gap:6px;margin-top:7px"><small data-tts-time="1" style="min-width:58px">0:00</small><button data-tts-control="seek" aria-label="재생 위치" style="flex:1;border:1px solid #ffffff24;background:#283043;height:12px;border-radius:6px"></button></div>${panel?`<div style="border-top:1px solid #ffffff24;margin-top:8px;padding-top:7px;overflow:hidden">${panel}</div>`:''}</div>`;
      await viewer.setInnerHTML((bgmLift?bgmBar():'')+header+content);
      listViewport = await viewer.querySelector('[data-tts-list-scroll]') || undefined;
      const bind=async(id:string,callback:()=>unknown)=>{const node=await viewer.querySelector(`[data-tts-control="${id}"]`);if(node)actions.set(id,{node,run:callback});};
      await bind('minimize',async()=>{const rect=await viewer.getBoundingClientRect(),width=await doc.clientWidth();await updateTtsSettings({minimized:!ttsData().settings.minimized,viewerAnchor:ttsData().settings.viewerAnchor||{right:Math.max(8,width-rect.right),top:rect.top+(bgmOpen()?BGM_H:0)}});});
      if(s.minimized)return;
      await bind('settings',openTtsSettings);
      await bind('bgm',()=>{bgmPicking=false;return updateSoundSettings({viewerBgm:!bgmOpen()});});
      await bind('bgm-play',()=>omniSound.toggleBgm());
      await bind('bgm-pick',()=>{bgmPicking=!bgmPicking;return paint();});
      await bind('bgm-seek',()=>{});
      if(picking)for(const [i,item] of soundData().bgm.entries())await bind(`bgm-item-${i}`,async()=>{
        bgmPicking=false;
        // Picking a track means music: BGM turns on with it.
        if(!soundData().settings.bgmEnabled)await updateSoundSettings({bgmEnabled:true});
        await omniSound.play(item);await paint();
      });
      await bind('bgm-power',()=>updateSoundSettings({bgmEnabled:!soundData().settings.bgmEnabled}));await bind('narration',()=>updateTtsSettings({narration:!ttsData().settings.narration}));await bind('continuous',()=>updateTtsSettings({continuous:!ttsData().settings.continuous}));
      for(const name of ['audio','cache','list'] as const)await bind(name,()=>{const shown=ttsData().settings.panel===name&&!picking;bgmPicking=false;return shown?updateTtsSettings({panel:''}):ttsData().settings.panel===name?paint():updateTtsSettings({panel:name});});
      await bind('locate',async()=>{locating=true;void revealInChat().catch(error=>omniTts.report(error));if(ttsData().settings.panel!=='list')await updateTtsSettings({panel:'list'});else{stateSignature='';await paintState();}});
      await bind('regenerate',()=>withTtsAudio(()=>omniTts.regenerate()));
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
      await text?.setInnerHTML(current?lineHtml(current.segment):'');
    }finally{await releaseHost(icon);await releaseHost(text);}
    const play=actions.get('play')?.node;
    if(play){await play.setTextContent(state==='playing'?'Ⅱ':'▶');await play.setStyle('background',state==='playing'?'#7132f599':'#11182780');}
    if(currentLine!==line){
      const old=actions.get(`line-${currentLine}`)?.node,fresh=actions.get(`line-${line}`)?.node;
      if(old)await old.setStyle('background','#11182780');
      if(fresh)await fresh.setStyle('background','#7132f599');
      currentLine=line;
    }
    if(locating&&s.panel==='list'){
      locating=false;
      // "nearest" only moves the list itself, and not at all when the row is
      // already visible, so the chat page behind never jumps.
      await actions.get(`line-${line}`)?.node.scrollIntoView({block:'nearest',inline:'nearest'});
    }
  }
  function bgmState(){const player=omniSound.player;return [soundData().settings.bgmEnabled,player.bgmKey,player.bgmPlaying,omniSound.bgmName(),bgmPicking];}
  const bgmFill=(p:{current:number;duration:number})=>`linear-gradient(to right,#7132f5 ${p.duration>0?p.current/p.duration*100:0}%,#283043 0)`;
  /**
   * BGM bar: the time and its seek bar on top (like the voice bar), then play,
   * the track (opens the track list) and on/off. Repainted with the viewer; the
   * time ticks separately.
   */
  function bgmBar():string{
    const on=soundData().settings.bgmEnabled,playing=omniSound.player.bgmPlaying,p=omniSound.player.bgmProgress;
    const name=esc(omniSound.bgmName()||(soundData().bgm.length?'곡 고르기':'BGM 없음'));
    return `<div data-tts-bgm="1" style="height:${BGM_H}px;box-sizing:border-box;padding:6px 9px;border-bottom:1px solid #ffffff24">`
      +`<div style="display:flex;align-items:center;gap:6px;height:14px"><small data-tts-bgm-time="1" style="min-width:58px;line-height:14px">${clock(p.current)} / ${clock(p.duration)}</small><button data-tts-control="bgm-seek" aria-label="BGM 재생 위치" style="flex:1;border:1px solid #ffffff24;background:${bgmFill(p)};height:10px;border-radius:5px;padding:0;cursor:pointer"></button></div>`
      +`<div style="display:flex;gap:6px;align-items:center;margin-top:6px">${control('bgm-play',playing?'Ⅱ':'▶','BGM 재생·일시정지',playing)}`
      +`<button data-tts-control="bgm-pick" title="BGM 곡 고르기" aria-label="BGM 곡 고르기" aria-expanded="${bgmPicking}" style="${LINE_STYLE}flex:1;min-width:0;width:auto;margin:0;min-height:36px;display:flex;align-items:center;gap:4px;background:${bgmPicking?'#7132f599':'#11182780'}"><span style="flex:1;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">♪ ${name}</span><span aria-hidden="true">${bgmPicking?'▴':'▾'}</span></button>`
      +`${control('bgm-power',on?'ON':'OFF','BGM 켜기·끄기',on)}</div></div>`;
  }
  /** The BGM list by folder; the track that plays is marked. */
  function bgmPicker():string{
    const items=soundData().bgm,current=omniSound.player.bgmKey;
    if(!items.length)return '등록된 BGM이 없습니다. BGM·효과음 설정에서 추가해 주세요.';
    const folders=[...soundData().folders.bgm.filter(folder=>items.some(item=>item.folder===folder)),...(items.some(item=>!item.folder||!soundData().folders.bgm.includes(item.folder))?['']:[])];
    const row=(i:number)=>{const item=items[i]!;return `<button data-tts-control="bgm-item-${i}" title="${esc(item.name)} 재생" aria-label="${esc(item.name)} 재생" style="${LINE_STYLE}background:${item.key===current?'#7132f599':'#11182780'}">♪ ${esc(item.name)}${item.tags.length?` <small style="color:#9aa3b5">${esc(item.tags.slice(0,4).join(', '))}</small>`:''}</button>`;};
    return `<div data-tts-list-scroll="1" style="max-height:max(0px,min(240px,35dvh,calc(80vh - 170px)));overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;touch-action:pan-y">${folders.map(folder=>{
      const rows=items.map((item,i)=>({item,i})).filter(({item})=>folder?item.folder===folder:!item.folder||!soundData().folders.bgm.includes(item.folder)).map(({i})=>row(i)).join('');
      return `<div style="margin:4px 0 3px;color:#9aa3b5;font-size:11px">${esc(folder||'미분류')}</div>${rows}`;
    }).join('')}</div>`;
  }
  /** The time and the seek bar fill, in place. */
  async function paintBgmTime():Promise<void>{
    const node=await viewer.querySelector('[data-tts-bgm-time]'),seek=actions.get('bgm-seek')?.node;
    try{const p=omniSound.player.bgmProgress;await node?.setTextContent(`${clock(p.current)} / ${clock(p.duration)}`);await seek?.setStyle('background',bgmFill(p));}
    finally{await releaseHost(node);}
  }
  function stateIcon(state:string):string{return state==='playing'?'◉':state==='loading'?'◌':state==='paused'?'Ⅱ':'○';}
  const CUE:Partial<Record<TtsSegment['kind'],[string,string,string]>>={bgm:['♪','BGM','#9aa3b5'],sfx:['▶','효과음','#9aa3b5']};
  function lineLabel(segment:TtsSegment):string{const cue=CUE[segment.kind];if(cue)return `${cue[1]}: ${segment.text}`;const text=segment.spoken??segment.text;return segment.speaker?`${segment.speaker}: ${text}`:segment.monologue?`혼잣말: ${text}`:text;}
  // One line per entry: "speaker: text", narration without a colon, tone as a chip.
  // BGM·효과음 cues are gray rows: what plays there, never read aloud.
  function lineHtml(segment:TtsSegment):string{
    const cue=CUE[segment.kind];
    if(cue)return `<span style="display:flex;align-items:center;gap:6px;min-width:0;width:100%;color:${cue[2]}"><span style="flex:none;width:16px;text-align:center">${cue[0]}</span><span style="flex:1;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis"><b>${cue[1]}</b> · ${esc(segment.text)}</span></span>`;
    const tone=segment.tone?`<span style="flex:none;padding:0 6px;border:1px solid #ffffff38;border-radius:6px;background:#ffffff12;color:#d8c8ff;font-size:10px;line-height:16px">${esc(segment.tone)}</span>`:'';
    return `<span style="display:flex;align-items:center;gap:6px;min-width:0;width:100%"><span style="flex:1;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${segment.speaker?`<b>${esc(segment.speaker)}</b>: `:segment.monologue?'<b>혼잣말</b>: ':''}${esc(segment.spoken??segment.text)}</span>${tone}</span>`;
  }
  const render=()=>{void paint().catch(error=>console.warn('OmniTTS viewer',error));};
  const unsubscribeRuntime=omniTts.subscribe(render),unsubscribeSettings=subscribeTts(render),unsubscribeSound=subscribeSound(render);
  const soundChange=omniSound.player.onChange;omniSound.player.onChange=()=>{soundChange();render();};
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
    if(!allowed()||drag?.busy||!await hitHost(viewer,e))return;
    const sliders=(['volume','seek','bgm-seek'] as const).flatMap(id=>{const a=actions.get(id);return a?[[id,a] as const]:[];});
    const hits=await Promise.all(sliders.map(([,a])=>hitHost(a.node,e))),row=sliders[hits.indexOf(true)];if(!row)return;
    const rect=await row[1].node.getBoundingClientRect(),fraction=Math.max(0,Math.min(1,(e.clientX-rect.left)/rect.width));
    if(row[0]==='volume')await updateTtsSettings({volume:fraction});else if(row[0]==='bgm-seek'){omniSound.player.seekBgm(fraction*omniSound.player.bgmProgress.duration);await paintBgmTime();}else omniTts.player.seek(fraction*omniTts.player.progress.duration);
  }))});
  events.push({type:'keydown',id:await doc.addEventListener('keydown',(e:{key:string})=>act(async()=>{
    const volume=actions.get('volume');if(allowed()&&volume&&['ArrowLeft','ArrowRight'].includes(e.key)&&await volume.node.matches(':focus'))await updateTtsSettings({volume:ttsData().settings.volume+(e.key==='ArrowRight'?.05:-.05)});
  }))});
  drag=await bindTtsDrag(doc,viewer,()=>allowed()&&ttsData().settings.enabled&&ttsData().settings.viewer,paint,()=>!ttsData().settings.minimized&&bgmOpen()?BGM_H:0);
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
  // The chat watcher cannot see its own screen leave the page, so check once a
  // second (never during a drag) whether the chat is still on screen.
  let checking=false,tick=0;
  const interval=setInterval(()=>{if(++tick%2===0&&!checking&&!drag?.busy&&!painting){checking=true;void refreshVisibility().catch(()=>{}).finally(()=>{checking=false;});}const visible=allowed();if(visible!==lastAllowed){lastAllowed=visible;refreshSignal();}const s=ttsData().settings;if(!visible||ticking||painting||drag?.busy||!s.enabled||!s.viewer||s.minimized||omniTts.player.status!=='playing')return;ticking=true;void(async()=>{const progress=omniTts.player.progress,time=await viewer.querySelector('[data-tts-time]'),seek=actions.get('seek')?.node;const format=(n:number)=>`${Math.floor(n/60)}:${String(Math.floor(n%60)).padStart(2,'0')}`;try{if(time)await time.setTextContent(`${format(progress.current)} / ${format(Number.isFinite(progress.duration)?progress.duration:0)}`);if(seek)await seek.setStyle('background',`linear-gradient(to right,#7132f5 ${progress.duration>0?progress.current/progress.duration*100:0}%,#283043 0)`);}finally{await releaseHost(time);}})().catch(()=>{}).finally(()=>{ticking=false;});},500);
  // BGM time, once a second while the bar is open and music plays (never during a drag).
  const bgmTick=setInterval(()=>{if(!allowed()||painting||drag?.busy||ttsData().settings.minimized||!bgmOpen()||!omniSound.player.bgmPlaying)return;void paintBgmTime().catch(()=>{});},1000);
  const flash=(message:string)=>{
    notice=message.slice(0,240);noticeUntil=Date.now()+5000;clearTimeout(noticeTimer);
    noticeTimer=setTimeout(()=>{noticeUntil=0;render();},5100);render();
  };
  return {refresh:refreshVisibility,flash,dispose:async()=>{disposed=true;clearTimeout(noticeTimer);clickEpoch++;clearInterval(interval);clearInterval(bgmTick);unsubscribeRuntime();unsubscribeSettings();unsubscribeSound();omniSound.player.onChange=soundChange;await drag?.dispose();for(const e of events)await doc.removeEventListener(e.type,e.id);for(const a of actions.values())await releaseHost(a.node);actions.clear();await releaseHost(listViewport);if(Reflect.get(globalThis,'__OMNI_TTS_REFRESH_VISIBILITY__')===refreshSignal)Reflect.deleteProperty(globalThis,'__OMNI_TTS_REFRESH_VISIBILITY__');await viewer.remove();await toast.remove();await releaseHost(viewer);await releaseHost(toast);}};
}
