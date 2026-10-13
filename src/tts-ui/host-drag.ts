import { safeArray, hitHost, releaseHost, type HostPoint } from './host-utils';
import { updateTtsSettings } from '../storage/tts-store';

export async function bindTtsDrag(doc:SafeDocument,viewer:SafeElement,allowed:()=>boolean,refresh:()=>Promise<void>) {
  let held=false,start:HostPoint|undefined,latest:HostPoint|undefined;
  let drag:{rect:DOMRect;w:number;h:number;left:number;top:number;moved:boolean}|undefined;
  let starting:Promise<void>|undefined,ending:Promise<void>|undefined,dirty=false,suppress=0;
  const writes=new Set<Promise<void>>();
  const listeners:{type:string;id:string}[]=[];
  const move=()=>{
    if(!drag||!start||!latest||writes.size>=16||!dirty)return;
    dirty=false;
    const dx=latest.clientX-start.clientX,dy=latest.clientY-start.clientY;
    drag.moved ||= Math.hypot(dx,dy)>4;
    if(!drag.moved)return;
    drag.left=Math.max(0,Math.min(drag.w-drag.rect.width,drag.rect.left+dx));
    drag.top=Math.max(0,Math.min(drag.h-drag.rect.height,drag.rect.top+dy));
    // Risu applies ordered writes before acknowledging them. As in the image
    // viewer, send input immediately and coalesce only if the bridge stalls.
    const work=viewer.setStyle('transform',`translate3d(${drag.left-drag.rect.left}px,${drag.top-drag.rect.top}px,0)`).catch(error=>console.warn('OmniTTS drag',error)).finally(()=>{writes.delete(work);move();});
    writes.add(work);
  };
  const end=(cancel=false):Promise<void>=>ending||=(async()=>{
    held=false;await starting;move();
    while(writes.size){await Promise.all([...writes]);move();}
    const finished=drag;drag=undefined;dirty=false;
    if(finished?.moved){suppress=Date.now()+400;if(!cancel)await updateTtsSettings({viewerAnchor:{right:Math.max(8,finished.w-finished.left-finished.rect.width),top:finished.top}});}
    await refresh();await viewer.setStyle('transform','');
  })().finally(()=>{ending=undefined;});
  const listen=async(type:string,fn:(e:HostPoint)=>void)=>listeners.push({type,id:await doc.addEventListener(type,fn,{capture:true,passive:true})});
  await listen('pointerdown',e=>{
    if(!allowed()||e.button!==0||starting||drag||ending)return;
    held=true;start=e;latest=e;
    starting=(async()=>{
      const header=await viewer.querySelector('[data-tts-header]');
      if(!header)return;
      try{
      if(!await hitHost(header,e))return;
      const buttons=await safeArray(await header.querySelectorAll('button'));
      let buttonHit=false;try{buttonHit=(await Promise.all(buttons.map(b=>hitHost(b,e)))).some(Boolean);}finally{for(const b of buttons)await releaseHost(b);}
      if(buttonHit)return;
      const rect=await viewer.getBoundingClientRect();
      if(!held||!allowed())return;
      // SafeDocument already wraps documentElement; html is not its descendant.
      drag={rect,w:await doc.clientWidth(),h:await doc.clientHeight(),left:rect.left,top:rect.top,moved:false};dirty=true;move();
      }finally{await releaseHost(header);}
    })().catch(error=>console.warn('OmniTTS drag',error)).finally(()=>{starting=undefined;});
  });
  await listen('pointermove',e=>{latest=e;if(drag&&held){dirty=true;move();}});
  await listen('pointerup',e=>{if(!held)return;latest=e;dirty=true;move();void end();});
  await listen('pointercancel',()=>{if(held)void end(true);});
  return {get busy(){return !!drag;},get suppressClick(){return Date.now()<suppress;},cancel:()=>end(true),dispose:async()=>{await end(true);for(const l of listeners)await doc.removeEventListener(l.type,l.id,{capture:true});}};
}
