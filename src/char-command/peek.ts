/** Centered image overlay. Does not close parent modals. */

let active: HTMLElement | null = null;
let releaseKey: (() => void) | null = null;

export function closeImagePeek(): void {
  releaseKey?.();
  releaseKey = null;
  active?.remove();
  active = null;
}

/** `over`: the modal window it opens from. A modal is drawn above the whole page, so the picture must go inside it. */
export function openImagePeek(src: string, over?: Element | null): void {
  if (!src) return;
  closeImagePeek();
  const veil = document.createElement('div');
  veil.setAttribute('data-nx-peek', '1');
  veil.style.cssText = 'position:fixed;inset:0;z-index:200000;background:rgba(4,8,16,.78);display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box';
  const img = document.createElement('img');
  img.src = src;
  img.alt = '크게보기';
  img.style.cssText = 'max-width:min(92vw,1100px);max-height:92vh;object-fit:contain;border-radius:12px;box-shadow:0 24px 80px rgba(0,0,0,.55)';
  const close = () => closeImagePeek();
  veil.addEventListener('click', (ev) => {
    if (ev.target === veil) close();
  });
  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      close();
    }
  };
  document.addEventListener('keydown', onKey, true);
  releaseKey = () => document.removeEventListener('keydown', onKey, true);
  // 닫기: on a phone the picture fills the screen, and the dark around it (or Esc) was all that closed it.
  const shut = document.createElement('button');
  shut.type = 'button';
  shut.setAttribute('data-nx-peek-close', '1');
  shut.setAttribute('aria-label', '닫기');
  shut.textContent = '✕';
  shut.style.cssText = 'position:fixed;top:max(12px,env(safe-area-inset-top));right:max(12px,env(safe-area-inset-right));width:44px;height:44px;min-width:0;padding:0;border-radius:50%;border:1px solid rgba(255,255,255,.35);background:rgba(10,12,20,.82);color:#fff;font:600 20px/1 system-ui,sans-serif;cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,.5);z-index:1';
  shut.addEventListener('click', (ev) => { ev.preventDefault(); ev.stopPropagation(); close(); });
  veil.appendChild(img);
  veil.appendChild(shut);
  (over ?? document.body).appendChild(veil);
  active = veil;
}
