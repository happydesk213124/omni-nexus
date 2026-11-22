/**
 * Dragging a tile onto a folder, as in a file window. A mouse drags once it has moved a little; a finger after a
 * short hold (a quick swipe still scrolls the list). Where the tiles already drag natively (the preset tiles, to
 * reorder), `mouse` is off and the native drop is taken instead.
 */
export interface TileDragOptions {
  list: HTMLElement;
  /** The tile under an event target that may be dragged. */
  source: (target: Element) => HTMLElement | null;
  /** A place a drag may end, under the pointer. */
  target: (at: Element) => HTMLElement | null;
  drop: (tile: HTMLElement, target: HTMLElement) => void;
  label: (tile: HTMLElement) => string;
  mouse: boolean;
}
const HOLD_MS = 380, MOUSE_SLOP = 6, TOUCH_SLOP = 10;

export function bindTileDrag(o: TileDragOptions): () => void {
  let tile: HTMLElement | null = null, ghost: HTMLElement | null = null, over: HTMLElement | null = null;
  let startX = 0, startY = 0, dragging = false, hold = 0, native: HTMLElement | null = null;
  const doc = o.list.ownerDocument;
  const under = (x: number, y: number): HTMLElement | null => {
    if (ghost) ghost.hidden = true;
    const at = doc.elementFromPoint(x, y);
    if (ghost) ghost.hidden = false;
    return at ? o.target(at) : null;
  };
  const mark = (next: HTMLElement | null) => { if (over !== next) { over?.classList.remove('nx-drop'); over = next; over?.classList.add('nx-drop'); } };
  const begin = (x: number, y: number) => {
    if (!tile) return;
    dragging = true;
    tile.classList.add('nx-dragging');
    ghost = doc.createElement('div'); ghost.className = 'nx-drag-ghost'; ghost.textContent = o.label(tile);
    doc.body.append(ghost);
    move(x, y);
  };
  const move = (x: number, y: number) => { if (ghost) ghost.style.transform = `translate(${x + 12}px, ${y + 12}px)`; mark(under(x, y)); };
  const end = (commit: boolean, mouse = false) => {
    window.clearTimeout(hold);
    const from = tile, to = over, was = dragging;
    tile?.classList.remove('nx-dragging'); ghost?.remove(); mark(null);
    tile = null; ghost = null; dragging = false;
    if (was) {
      // A mouse's release that ends a drag is followed at once by a click: that one is no tap (the tile is not
      // opened). Only that one: the listener is gone by the next task, so a real click right after is taken. A
      // finger's drag ends in no click at all (its moves were cancelled).
      if (mouse) {
        const swallow = (event: Event) => { event.stopPropagation(); event.preventDefault(); };
        doc.addEventListener('click', swallow, { capture: true, once: true });
        window.setTimeout(() => doc.removeEventListener('click', swallow, true), 0);
      }
      if (commit && from && to) o.drop(from, to);
    }
  };
  const listeners: Array<[EventTarget, string, EventListener, AddEventListenerOptions?]> = [];
  const on = (node: EventTarget, type: string, fn: EventListener, options?: AddEventListenerOptions) => { node.addEventListener(type, fn, options); listeners.push([node, type, fn, options]); };

  if (o.mouse) {
    on(o.list, 'pointerdown', event => {
      const e = event as PointerEvent;
      if (e.pointerType === 'touch' || e.button !== 0) return;
      tile = o.source(e.target as Element); startX = e.clientX; startY = e.clientY;
    });
    on(doc, 'pointermove', event => {
      const e = event as PointerEvent;
      if (!tile || e.pointerType === 'touch') return;
      if (!dragging && Math.hypot(e.clientX - startX, e.clientY - startY) > MOUSE_SLOP) begin(e.clientX, e.clientY);
      if (dragging) { e.preventDefault(); move(e.clientX, e.clientY); }
    });
    on(doc, 'pointerup', event => { if ((event as PointerEvent).pointerType !== 'touch' && tile) end(true, true); });
    on(doc, 'pointercancel', event => { if ((event as PointerEvent).pointerType !== 'touch' && tile) end(false); });
    // A tile is a button: without this a drag selects text or starts a native link drag.
    on(o.list, 'dragstart', event => { if (o.source(event.target as Element)) event.preventDefault(); });
  } else {
    // Native drags (the preset tiles reorder that way): the drop on a folder is ours.
    on(o.list, 'dragstart', event => { native = o.source(event.target as Element); }, { capture: true });
    on(doc, 'dragend', () => { native = null; mark(null); });
    on(doc, 'dragover', event => {
      if (!native) return;
      const to = o.target(event.target as Element);
      mark(to);
      if (to) { event.preventDefault(); event.stopPropagation(); }
    }, { capture: true });
    on(doc, 'drop', event => {
      const to = native ? o.target(event.target as Element) : null;
      if (!native || !to) return;
      event.preventDefault(); event.stopPropagation();
      const from = native; native = null; mark(null);
      o.drop(from, to);
    }, { capture: true });
  }
  on(o.list, 'touchstart', event => {
    const e = event as TouchEvent;
    if (e.touches.length !== 1) { end(false); return; }
    tile = o.source(e.target as Element);
    if (!tile) return;
    const t = e.touches[0]!; startX = t.clientX; startY = t.clientY;
    window.clearTimeout(hold);
    hold = window.setTimeout(() => { if (tile) { try { navigator.vibrate?.(12); } catch { /* no haptics */ } begin(startX, startY); } }, HOLD_MS);
  }, { passive: true });
  on(o.list, 'touchmove', event => {
    const e = event as TouchEvent, t = e.touches[0];
    if (!tile || !t) return;
    if (dragging) { e.preventDefault(); move(t.clientX, t.clientY); }
    else if (Math.hypot(t.clientX - startX, t.clientY - startY) > TOUCH_SLOP) { window.clearTimeout(hold); tile = null; }
  }, { passive: false });
  on(o.list, 'touchend', () => { if (tile) end(true); });
  on(o.list, 'touchcancel', () => { if (tile) end(false); });
  // A hold that became a drag must not also open the long-press menu.
  on(o.list, 'contextmenu', event => { if (dragging) event.preventDefault(); });
  return () => { end(false); for (const [node, type, fn, options] of listeners) node.removeEventListener(type, fn, options); };
}
