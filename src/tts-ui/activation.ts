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
  // The window is hidden only once the unlock has settled (or three seconds passed): WebKit stopped the sound of a
  // window hidden while it was still starting, and the next line asked for the tap again.
  confirm.addEventListener('click',()=>{confirm.disabled=true;const activated=confirmAudioActivation();void Promise.race([activated.catch(error=>omniTts.report(error)),new Promise(done=>setTimeout(done,3000))]).finally(()=>void close().catch(error=>omniTts.report(error)));});
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
/**
 * The popup asking for a tap to unlock the voice, when it is still locked: a click a moment ago may be unlocking it
 * already (armSilentUnlock), and a context WebKit stopped is woken first. Asked only if neither does it.
 */
export function promptAudioActivation(): void {
  if (omniTts.player.ready) return;
  void (async () => {
    await omniTts.player.pending?.catch(() => undefined);
    if (await omniTts.player.wake()) return;
    prompted = true; popup?.();
  })();
}
let armed = false;
/**
 * Any tap in the plugin's own window (the TTS tab, a switch, a list) is a tap inside the plugin: the voice is unlocked
 * there and then, silently (a tenth of a second of silence), so the popup is needed only when no tap here came first
 * (a line played from the chat). touchend and click: what an iPhone counts as a tap that may start sound.
 */
export function armSilentUnlock(doc: Document = document): void {
  if (armed) return;
  armed = true;
  const tap = () => {
    const player = omniTts.player;
    if (player.ready || player.pending || player.status === 'playing' || player.status === 'loading') return;
    void player.unlock(true).catch(() => undefined);
  };
  doc.addEventListener('touchend', tap, true);
  doc.addEventListener('click', tap, true);
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
  // Unlocking already (a tap a moment ago), or unlocked and only stopped by WebKit since: no popup for that.
  await omniTts.player.pending?.catch(() => undefined);
  if (omniTts.player.ready || await omniTts.player.wake()) { if (omniTts.playbackReserved(reservation)) await action(); return; }
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
