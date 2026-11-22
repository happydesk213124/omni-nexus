/**
 * A menu that opens under its button (or where a tile was right-clicked) and closes on a choice, a tap elsewhere or
 * Esc. Its items are ordinary buttons with their own ids and handlers: the menu only shows and hides them.
 */
export interface Menu { openAt(x: number, y: number): void; openBy(anchor: HTMLElement): void; close(): void; readonly open: boolean }

export function bindMenu(menu: HTMLElement, trigger?: HTMLElement | null, onOpen?: () => void): Menu {
  const doc = menu.ownerDocument, view = doc.defaultView || window;
  let from: HTMLElement | null = null;
  const close = () => {
    if (menu.hidden) return;
    menu.hidden = true; from?.setAttribute('aria-expanded', 'false'); from = null;
    doc.removeEventListener('pointerdown', outside, true); doc.removeEventListener('keydown', key, true);
  };
  const outside = (event: Event) => { const at = event.target as Node; if (!menu.contains(at) && !(from && from.contains(at))) close(); };
  const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); close(); } };
  const show = (x: number, y: number, up: boolean) => {
    onOpen?.();
    menu.hidden = false;
    const box = menu.getBoundingClientRect(), pad = 8;
    // Kept on screen: flipped above its button near the bottom, pulled in from the right edge.
    const top = up ? y - box.height : y;
    menu.style.left = `${Math.max(pad, Math.min(x, view.innerWidth - box.width - pad))}px`;
    menu.style.top = `${Math.max(pad, Math.min(top, view.innerHeight - box.height - pad))}px`;
    doc.addEventListener('pointerdown', outside, true); doc.addEventListener('keydown', key, true);
    menu.querySelector<HTMLElement>('button:not([hidden]):not(:disabled)')?.focus({ preventScroll: true });
  };
  const openBy = (anchor: HTMLElement) => {
    const r = anchor.getBoundingClientRect(), below = view.innerHeight - r.bottom;
    from = anchor; anchor.setAttribute('aria-expanded', 'true');
    // Under the button, its right edges in line; above it when the button sits at the bottom (the dock).
    menu.hidden = false;
    const width = menu.getBoundingClientRect().width;
    menu.hidden = true;
    if (below < 220 && r.top > below) show(r.right - width, r.top - 4, true); else show(r.right - width, r.bottom + 4, false);
  };
  // A choice closes it; the item's own handler has run by then.
  menu.addEventListener('click', event => { if ((event.target as Element).closest('button')) view.setTimeout(close, 0); });
  trigger?.addEventListener('click', () => { if (menu.hidden) openBy(trigger); else close(); });
  return { openAt: (x, y) => { close(); show(x, y, false); }, openBy: anchor => { close(); openBy(anchor); }, close, get open() { return !menu.hidden; } };
}
