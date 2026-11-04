import { safeArray, releaseHost, type HostPoint } from './host-utils';
import { updateTtsSettings } from '../storage/tts-store';

/** headerOffset: height of a bar shown above the header; the stored anchor is the header's top. */
export async function bindTtsDrag(doc:SafeDocument,viewer:SafeElement,allowed:()=>boolean,refresh:()=>Promise<void>,headerOffset:()=>number=()=>0) {
  let held=false,start:HostPoint|undefined,latest:HostPoint|undefined;
  let drag:{rect:DOMRect;w:number;h:number;left:number;top:number;moved:boolean}|undefined;
  let starting:Promise<void>|undefined,ending:Promise<void>|undefined,dirty=false,suppress=0;
  const writes=new Set<Promise<void>>();
  const listeners:{type:string;id:string}[]=[];
  // While dragging, a transparent page cover sits just under the viewer. A fast
  // pointer that leaves the header then crosses no chat element, so no hover
  // handler or style recalculation competes with the move writes.
  for(const old of await safeArray(await doc.querySelectorAll('[x-omnitts-shield]'))){await old.remove();await releaseHost(old);}
  const shield=await doc.createElement('div'),body=await doc.querySelector('body');
  await shield.setAttribute('x-omnitts-shield','1');
  await shield.setStyleAttribute('position:fixed;inset:0;z-index:2147483099;display:none;background:transparent;cursor:grabbing;touch-action:none');
  await body?.appendChild(shield);await releaseHost(body);
  let shielded=false;
  // Pointer events cross the bridge in bursts, so moves land unevenly. A short
  // transform transition while dragging glides between them instead of jumping;
  // it is removed before the final position is committed.
  const cover=(on:boolean)=>{if(shielded===on)return;shielded=on;Reflect.set(globalThis,'__OMNI_VIEWER_DRAGGING__',on);void viewer.setStyle('transition',on?'transform 8ms linear':'').catch(()=>{});void shield.setStyle('display',on?'block':'none').catch(()=>{});};
  const move=()=>{
    if(!drag||!start||!latest||writes.size>=16||!dirty)return;
    dirty=false;
    drag.moved ||= Math.hypot(latest.clientX-start.clientX,latest.clientY-start.clientY)>4;
    if(!drag.moved)return;
    cover(true);
    const dx=latest.clientX-start.clientX,dy=latest.clientY-start.clientY;
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
    const finished=drag;drag=undefined;dirty=false;cover(false);
    if(finished?.moved){suppress=Date.now()+400;if(!cancel)await updateTtsSettings({viewerAnchor:{right:Math.max(8,finished.w-finished.left-finished.rect.width),top:finished.top+headerOffset()}});}
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
      // A press a little outside the header, or on one of its buttons, may
      // still start a drag: it only becomes one after the pointer moves, so a
      // still press on a button remains an ordinary click.
      const r=await header.getBoundingClientRect(),slack=12;
      if(!(r.width>0&&e.clientX>=r.left-slack&&e.clientX<=r.right+slack&&e.clientY>=r.top-slack&&e.clientY<=r.bottom+slack))return;
      const rect=await viewer.getBoundingClientRect();
      if(!held||!allowed())return;
      // SafeDocument already wraps documentElement; html is not its descendant.
      drag={rect,w:await doc.clientWidth(),h:await doc.clientHeight(),left:rect.left,top:rect.top,moved:false};
      // From the grab on, the whole screen is the handle: a pointer that outruns
      // the window never lands on chat, links or text while the viewer catches up.
      cover(true);dirty=true;move();
      }finally{await releaseHost(header);}
    })().catch(error=>console.warn('OmniTTS drag',error)).finally(()=>{starting=undefined;});
  });
  await listen('pointermove',e=>{
    latest=e;if(drag&&held){dirty=true;move();}
  });
  // Decide click suppression now: the click arrives before the drag finishes.
  await listen('pointerup',e=>{if(!held)return;latest=e;dirty=true;move();if(drag?.moved)suppress=Date.now()+400;void end();});
  await listen('pointercancel',()=>{if(held)void end(true);});
  return {get busy(){return !!drag;},get suppressClick(){return Date.now()<suppress;},cancel:()=>end(true),dispose:async()=>{await end(true);for(const l of listeners)await doc.removeEventListener(l.type,l.id,{capture:true});await shield.remove();await releaseHost(shield);}};
}
