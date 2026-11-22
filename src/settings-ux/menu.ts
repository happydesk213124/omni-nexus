/**
 * A menu that opens under its button (or where a tile was right-clicked or held) and closes on a choice, a tap
 * elsewhere or Esc. Its items are ordinary buttons with their own ids and handlers: the menu only shows and hides them.
 */
export interface Menu { openAt(x: number, y: number): void; openBy(anchor: HTMLElement): void; close(): void; readonly open: boolean }

export function bindMenu(menu: HTMLElement, trigger?: HTMLElement | null, onOpen?: () => void, onClose?: () => void): Menu {
  const doc = menu.ownerDocument, view = doc.defaultView || window;
  let from: HTMLElement | null = null;
  const close = () => {
    if (menu.hidden) return;
    menu.hidden = true; from?.setAttribute('aria-expanded', 'false'); from = null;
    doc.removeEventListener('pointerdown', outside, true); doc.removeEventListener('keydown', key, true);
    onClose?.();
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

/**
 * A menu made of buttons that already exist somewhere else (the 선택 bar's): each row presses its button. For a held
 * or right-clicked tile, where the bar's own buttons are a thumb's reach away. Gone when it closes.
 */
export function openButtonMenu(x: number, y: number, title: string, buttons: readonly HTMLButtonElement[]): void {
  const usable = buttons.filter(button => !button.hidden && !button.disabled);
  if (!usable.length) return;
  const menu = document.createElement('div');
  menu.className = 'nx-menu nx-button-menu'; menu.hidden = true; menu.setAttribute('role', 'menu');
  const head = document.createElement('small'); head.className = 'nx-menu-title'; head.textContent = title;
  menu.append(head);
  for (const button of usable) {
    const row = document.createElement('button');
    row.type = 'button'; row.setAttribute('role', 'menuitem'); row.textContent = button.textContent;
    if (/삭제/.test(button.textContent || '')) row.className = 'danger';
    row.addEventListener('click', () => button.click());
    menu.append(row);
  }
  document.body.append(menu);
  bindMenu(menu, null, undefined, () => menu.remove()).openAt(x, y);
}
