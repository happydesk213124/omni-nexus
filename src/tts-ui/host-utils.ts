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
export async function openTtsSettings(): Promise<void> { const open = Reflect.get(globalThis,'__OMNI_OPEN_TTS__'); if (typeof open !== 'function') throw new Error('플러그인 설정에서 TTS 탭을 열어 주세요.'); await open(); }
export interface HostPoint { clientX:number;clientY:number;button?:number;buttons?:number }
// Risu sanitizes x-* in HTML but preserves data-*. SafeElement only permits
// getAttribute(x-*), so read the sanitized opening tag, as the image viewer does.
export async function hostAttributes(node:SafeElement):Promise<Record<string,string>> {
  const html=await node.getOuterHTML(),head=html.slice(0,html.indexOf('>')+1),attrs:Record<string,string>={};
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
