import { omniTts } from '../services/tts-runtime';
import { openTtsSettings } from './host-utils';
import { risuHost } from '../core/host';
import layout from './layout.json';

let popup: (() => void) | undefined;
let waiting: { action: () => Promise<void> | void; reservation: number } | undefined;
let opening: Promise<void> | undefined;
let mounted: (() => void) | undefined;
let prompted = false;
let chatPopup: HTMLDialogElement | undefined;

function settingsOpen(): boolean {
  const read=Reflect.get(globalThis,'__OMNI_TTS_SETTINGS_OPEN__');
  return typeof read==='function' ? !!read() : !!popup;
}
async function showChatActivation(): Promise<void> {
  const host=risuHost();
  if(!host?.showContainer)throw new Error('음성 재생 팝업을 표시할 수 없습니다.');
  if(chatPopup?.isConnected){chatPopup.showModal();return;}
  // Own iframe DOM is necessary for a real browser user gesture. Showing this
  // temporary dialog must not navigate to or replace the user's settings tab.
  const holder=document.createElement('div');holder.innerHTML=layout.dialogs;
  const node=holder.querySelector<HTMLDialogElement>('#audio-unlock-dialog')!;
  node.id='omnitts-chat-activation';
  node.style.cssText='width:min(380px,calc(100vw - 40px));box-sizing:border-box;border:1px solid #7543bf;border-radius:14px;padding:20px;background:#101622;color:#eee;font:14px/1.5 sans-serif';
  const buttons=[...node.querySelectorAll<HTMLButtonElement>('button')];
  for(const button of buttons){button.id+='-chat';button.style.cssText='min-height:40px;padding:8px 14px;margin:4px;border:1px solid #ffffff30;border-radius:10px;background:#1b2434;color:#fff;cursor:pointer';}
  const confirm=buttons.find(button=>button.id==='audio-unlock-confirm-chat')!,cancel=buttons.find(button=>button.id==='audio-unlock-cancel-chat')!;
  confirm.style.background='#7132f5';
  let closed=false;
  const close=async()=>{if(closed)return;closed=true;node.remove();if(chatPopup===node)chatPopup=undefined;if(!settingsOpen())await host.hideContainer?.();};
  confirm.addEventListener('click',()=>{confirm.disabled=true;const activated=confirmAudioActivation();void Promise.all([close(),activated]).catch(error=>omniTts.report(error));});
  cancel.addEventListener('click',()=>{cancelAudioActivation();void close().catch(error=>omniTts.report(error));});
  node.addEventListener('cancel',()=>{cancelAudioActivation();void close().catch(error=>omniTts.report(error));});
  document.body.append(node);chatPopup=node;prompted=true;
  try{await host.showContainer('fullscreen');if(!closed)node.showModal();}catch(error){await close();throw error;}
}

export function bindAudioActivation(show: () => void): () => void {
  popup = show;
  mounted?.();
  return () => { if (popup === show) { popup = undefined; waiting = undefined; } };
}
export function promptAudioActivation(): void {
  if (!omniTts.player.ready) { prompted = true; popup?.(); }
}
export function promptInitialAudioActivation(): void {
  if (!prompted) promptAudioActivation();
}
export function cancelAudioActivation(): void { waiting = undefined; }
export async function confirmAudioActivation(): Promise<void> {
  // The resume/play calls must start inside the iframe's own confirmation click.
  await omniTts.player.unlock();
  if (!omniTts.player.ready) return;
  const pending = waiting; waiting = undefined;
  if (pending && omniTts.playbackReserved(pending.reservation)) await pending.action();
}
export async function withTtsAudio(action: () => Promise<void> | void, reservation = omniTts.reservePlayback()): Promise<void> {
  if (!omniTts.playbackReserved(reservation)) return;
  if (omniTts.player.ready) { await action(); return; }
  waiting = { action, reservation };
  if(!settingsOpen()&&risuHost()?.showContainer){try{await showChatActivation();}catch(error){waiting=undefined;throw error;}return;}
  if (!popup) {
    opening ||= (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const ready = new Promise<void>((resolve, reject) => { mounted = resolve; timer = setTimeout(() => reject(new Error('TTS 설정을 열지 못했습니다. 설정에서 다시 시도해 주세요.')), 10000); });
      try { await Promise.all([openTtsSettings(), ready]); }
      finally { clearTimeout(timer); mounted = undefined; }
    })().finally(() => { opening = undefined; });
    try { await opening; } catch (error) { waiting = undefined; throw error; }
  }
  if (waiting && omniTts.playbackReserved(waiting.reservation)) promptAudioActivation();
}
