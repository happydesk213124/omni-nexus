import { risuHost } from '../core/host';
export async function safeArray<T>(array: SafeClassArray<T> | T[]): Promise<T[]> {
  // PocketRisu can return an ordinary array from SafeDOM and observer callbacks.
  if (Array.isArray(array)) return array;
  const host = risuHost();
  if (host?.unwarpSafeArray) return host.unwarpSafeArray(array);
  const result: T[] = [];
  for (let i=0, n=await array.length();i<n;i++) { const item=await array.at(i); if (item !== undefined) result.push(item); }
  return result;
}
/** A host list's items, and the list itself let go: Risu holds every object it hands a plugin until it is released. */
export async function itemsOf<T>(list: SafeClassArray<T> | T[]): Promise<T[]> {
  const items = await safeArray(list);
  if (!Array.isArray(list)) await releaseHost(list);
  return items;
}
export async function openTtsSettings(): Promise<void> { const open = Reflect.get(globalThis,'__OMNI_OPEN_TTS__'); if (typeof open !== 'function') throw new Error('플러그인 설정에서 TTS 탭을 열어 주세요.'); await open(); }
export interface HostPoint { clientX:number;clientY:number;button?:number;buttons?:number }
/**
 * A node's own tag, none of what is inside it. A message's or a picture's HTML carries its pictures as base64
 * (megabytes, for one number off the tag); a shallow copy is just the tag. A host without cloneNode: the HTML, cut.
 */
export async function openingTag(node:SafeElement):Promise<string>{
  if(typeof Reflect.get(node,'cloneNode')==='function'){
    try{const copy=await node.cloneNode(false);try{return String(await copy.getOuterHTML()??'');}finally{await releaseHost(copy);}}
    catch{/* the whole HTML, below */}
  }
  const html=String(await node.getOuterHTML()??'');
  return html.slice(0,html.indexOf('>')+1);
}
/**
 * A message's HTML for the text around its controls, read off a copy whose pictures are taken out first: their
 * base64 never crosses the bridge, and nothing read here looks at a picture. A host without cloneNode: the HTML.
 */
export async function htmlWithoutPictures(node:SafeElement):Promise<string>{
  if(typeof Reflect.get(node,'cloneNode')==='function'){
    let copy:SafeElement|null=null;
    try{
      copy=await node.cloneNode(true);
      for(const picture of await itemsOf(await copy.querySelectorAll('img,source,video'))){await picture.remove();await releaseHost(picture);}
      return String(await copy.getOuterHTML()??'');
    }catch{/* the whole HTML, below */}
    finally{await releaseHost(copy);}
  }
  return String(await node.getOuterHTML()??'');
}
/** The message number on a .risu-chat's own tag; NaN without one. */
export function chatIndexOf(html:string):number{return Number(/\bdata-chat-index="(-?\d+)"/.exec(html.slice(0,html.indexOf('>')+1))?.[1]??NaN);}
// Risu sanitizes x-* in HTML but preserves data-*. SafeElement only permits
// getAttribute(x-*), so read the sanitized opening tag, as the image viewer does.
export async function hostAttributes(node:SafeElement):Promise<Record<string,string>> {
  const head=await openingTag(node),attrs:Record<string,string>={};
  for(const match of head.matchAll(/\b((?:data|x)-[\w-]+)="([^"]*)"/g))attrs[match[1]]=match[2].replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
  return attrs;
}
export async function hitHost(node:SafeElement,event:HostPoint):Promise<boolean>{
  if(!Number.isFinite(event.clientX)||!Number.isFinite(event.clientY))return false;
  const r=await node.getBoundingClientRect();
  return r.width>0&&r.height>0&&event.clientX>=r.left&&event.clientX<=r.right&&event.clientY>=r.top&&event.clientY<=r.bottom;
}
export async function releaseHost(value:unknown):Promise<void>{
  if(!value || typeof value!=='object')return;
  const release=Reflect.get(value,'release');
  if(typeof release==='function')await release.call(value);
}
export async function disconnectHost(value:SafeMutationObserver):Promise<void>{
  const disconnect=Reflect.get(value,'disconnect');
  if(typeof disconnect==='function')await disconnect.call(value);
  await releaseHost(value);
}
