export const GEN_SPIN_CSS = `@keyframes nx-gen-orbit{to{transform:rotate(360deg)}}[data-gen-spin="1"]{position:relative;outline:2px solid #22c55e;box-shadow:0 0 0 2px rgba(34,197,94,.35),0 0 14px rgba(34,197,94,.45)}[data-gen-spin="1"]::after{content:"";position:absolute;inset:2px;border-radius:inherit;border:2px solid transparent;border-top-color:#4ade80;border-right-color:#22c55e;animation:nx-gen-orbit .6s linear infinite;pointer-events:none;z-index:2}`;

export function ensureGenSpinStyle(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById('nx-gen-spin-css')) return;
  const el = document.createElement('style');
  el.id = 'nx-gen-spin-css';
  el.textContent = GEN_SPIN_CSS;
  document.documentElement.appendChild(el);
}

export function setGenSpin(el: Element | null | Array<Element | null>, on: boolean): void {
  ensureGenSpinStyle();
  const list = Array.isArray(el) ? el : [el];
  for (const node of list) {
    if (!node) continue;
    node.setAttribute('data-gen-spin', on ? '1' : '0');
    if (node instanceof HTMLButtonElement) node.disabled = on;
  }
}

const FIELD =
  'width:100%;box-sizing:border-box;border-radius:10px;border:1px solid rgba(255,255,255,.14);background:#0b0f18;color:#e8eef8;padding:8px 10px;font:13px Segoe UI,sans-serif';

export function optionBarHtml(ids: {
  name: string;
  select: string;
  save: string;
  del: string;
  namePlaceholder?: string;
}): string {
  return `<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
    <div style="display:flex;align-items:stretch;min-width:160px;flex:1">
      <input data-${ids.name} type="text" placeholder="${ids.namePlaceholder || '프리셋 이름'}" style="${FIELD};border-radius:10px 0 0 10px;border-right:0">
      <div style="position:relative;width:36px;flex:0 0 36px">
        <div aria-hidden="true" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;border:1px solid rgba(255,255,255,.14);border-left:0;border-radius:0 10px 10px 0;background:#0b0f18;color:#9aa6b8;pointer-events:none">▾</div>
        <select data-${ids.select} style="position:absolute;inset:0;opacity:0;width:100%;cursor:pointer"></select>
      </div>
    </div>
    <button type="button" data-${ids.save} style="cursor:pointer;border:0;background:rgba(255,255,255,.08);color:#e8eef8;padding:6px 10px;border-radius:8px;font:650 12px Segoe UI,sans-serif">저장</button>
    <button type="button" data-${ids.del} style="cursor:pointer;border:0;background:rgba(248,113,113,.18);color:#fecaca;padding:6px 10px;border-radius:8px;font:650 12px Segoe UI,sans-serif">삭제</button>
  </div>`;
}
