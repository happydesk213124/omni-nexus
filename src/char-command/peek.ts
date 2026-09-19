/** Centered image overlay. Does not close parent modals. */

let active: HTMLElement | null = null;

export function closeImagePeek(): void {
  active?.remove();
  active = null;
}

export function openImagePeek(src: string): void {
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
      document.removeEventListener('keydown', onKey, true);
    }
  };
  document.addEventListener('keydown', onKey, true);
  veil.appendChild(img);
  document.body.appendChild(veil);
  active = veil;
}
