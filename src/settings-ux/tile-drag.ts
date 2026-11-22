/**
 * Dragging a tile onto a folder, as in a file window. A mouse drags once it has moved a little; a finger after a
 * short hold (a quick swipe still scrolls the list). Where the tiles already drag natively (the preset tiles, to
 * reorder), `mouse` is off and the native drop is taken instead; a finger drags them our way all the same.
 *
 * What is dragged is the tile itself, lifted: a copy of it follows the pointer a little above the finger, the places
 * it may be dropped light up for as long as the drag lasts, the list scrolls when it is held near an edge, and on
 * release the copy flies into the folder (or back where it came from).
 */
export interface TileDragOptions {
  list: HTMLElement;
  /** The tile under an event target that may be dragged. */
  source: (target: Element) => HTMLElement | null;
  /** A place a drag may end, under the pointer. */
  target: (at: Element) => HTMLElement | null;
  drop: (tile: HTMLElement, target: HTMLElement) => void;
  /** How many go along with this tile (선택 mode): shown on the copy when more than one. */
  count: (tile: HTMLElement) => number;
  mouse: boolean;
}
const HOLD_MS = 360, MOUSE_SLOP = 6, TOUCH_SLOP = 10, EDGE = 64, GHOST_MAX = 104;
const buzz = (ms: number) => { try { navigator.vibrate?.(ms); } catch { /* no haptics */ } };

export function bindTileDrag(o: TileDragOptions): () => void {
  let tile: HTMLElement | null = null, ghost: HTMLElement | null = null, over: HTMLElement | null = null;
  let startX = 0, startY = 0, lastX = 0, lastY = 0, dragging = false, touching = false, hold = 0, frame = 0, native: HTMLElement | null = null, wasDraggable = false;
  let size = { w: 0, h: 0 }, origin = { x: 0, y: 0 };
  const doc = o.list.ownerDocument, root = doc.documentElement;
  const scroller = (): HTMLElement | null => { for (let el: HTMLElement | null = o.list; el; el = el.parentElement) { const flow = getComputedStyle(el).overflowY; if ((flow === 'auto' || flow === 'scroll') && el.scrollHeight > el.clientHeight) return el; } return null; };
  const under = (x: number, y: number): HTMLElement | null => {
    if (ghost) ghost.style.visibility = 'hidden';
    const at = doc.elementFromPoint(x, y);
    if (ghost) ghost.style.visibility = '';
    return at ? o.target(at) : null;
  };
  const mark = (next: HTMLElement | null) => {
    if (over === next) return;
    over?.classList.remove('nx-drop'); over = next; over?.classList.add('nx-drop');
    if (next && touching) buzz(6);
  };
  /** The copy, a little above the pointer so a finger does not cover it. */
  const place = (x: number, y: number, scale = 1) => { if (ghost) ghost.style.transform = `translate(${x - size.w / 2}px, ${y - size.h * (touching ? .92 : .6)}px) scale(${scale}) rotate(-3deg)`; };
  const begin = (x: number, y: number) => {
    if (!tile) return;
    dragging = true;
    const box = tile.getBoundingClientRect(), shrink = Math.min(1, GHOST_MAX / Math.max(box.width, box.height));
    size = { w: box.width * shrink, h: box.height * shrink }; origin = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    // A copy of the tile with nothing to find it by: the lists look tiles up by their data attributes and ids.
    const copy = tile.cloneNode(true) as HTMLElement;
    for (const node of [copy, ...copy.querySelectorAll<HTMLElement>('*')]) for (const attr of [...node.attributes]) if (attr.name === 'id' || attr.name.startsWith('data-') || attr.name.startsWith('aria-')) node.removeAttribute(attr.name);
    copy.className = 'preset-tile nx-drag-ghost'; copy.style.width = `${size.w}px`; copy.style.height = `${size.h}px`;
    const n = o.count(tile);
    if (n > 1) { const badge = doc.createElement('em'); badge.textContent = String(n); copy.append(badge); }
    ghost = copy; doc.body.append(ghost);
    tile.classList.remove('nx-press'); tile.classList.add('nx-dragging'); root.classList.add('nx-tile-drag');
    if (touching) buzz(14);
    move(x, y);
    if (!frame) frame = requestAnimationFrame(edgeScroll);
  };
  const move = (x: number, y: number) => { lastX = x; lastY = y; place(x, y); mark(under(x, y)); };
  /** Held near the top or bottom of the list, the list scrolls: a folder off screen can still be reached. */
  const edgeScroll = () => {
    frame = 0;
    if (!dragging) return;
    const box = scroller();
    if (box) {
      const r = box.getBoundingClientRect(), up = lastY - r.top, down = r.bottom - lastY;
      const step = up < EDGE ? -Math.ceil((EDGE - up) / 5) : down < EDGE ? Math.ceil((EDGE - down) / 5) : 0;
      if (step) { box.scrollTop += step; mark(under(lastX, lastY)); }
    }
    frame = requestAnimationFrame(edgeScroll);
  };
  const end = (commit: boolean, mouse = false) => {
    window.clearTimeout(hold);
    const from = tile, to = commit ? over : null, was = dragging, copy = ghost;
    if (from) { from.classList.remove('nx-press'); if (wasDraggable) from.draggable = true; }
    wasDraggable = false; tile = null; ghost = null; dragging = false; touching = false;
    if (frame) { cancelAnimationFrame(frame); frame = 0; }
    over?.classList.remove('nx-drop'); over = null;
    if (!was) return;
    root.classList.remove('nx-tile-drag');
    // A mouse's release that ends a drag is followed at once by a click: that one is no tap (the tile is not
    // opened). Only that one: the listener is gone by the next task, so a real click right after is taken. A
    // finger's drag ends in no click at all (its moves were cancelled).
    if (mouse) {
      const swallow = (event: Event) => { event.stopPropagation(); event.preventDefault(); };
      doc.addEventListener('click', swallow, { capture: true, once: true });
      window.setTimeout(() => doc.removeEventListener('click', swallow, true), 0);
    }
    // The copy flies into the folder, or back to where it was lifted from; the tile shows again when it lands.
    const land = to ? to.getBoundingClientRect() : null;
    const goal = land ? { x: land.left + land.width / 2, y: land.top + land.height / 2 } : origin;
    if (copy) {
      copy.classList.add('nx-drag-land');
      copy.style.transform = `translate(${goal.x - size.w / 2}px, ${goal.y - size.h / 2}px) scale(${to ? .25 : 1}) rotate(0deg)`;
      if (to) copy.style.opacity = '0';
      window.setTimeout(() => { copy.remove(); from?.classList.remove('nx-dragging'); }, 190);
    } else from?.classList.remove('nx-dragging');
    if (to && from) {
      to.classList.add('nx-drop-done'); window.setTimeout(() => to.classList.remove('nx-drop-done'), 420);
      o.drop(from, to);
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
    on(o.list, 'dragstart', event => { native = o.source(event.target as Element); if (native) root.classList.add('nx-tile-drag'); }, { capture: true });
    on(doc, 'dragend', () => { native = null; over?.classList.remove('nx-drop'); over = null; root.classList.remove('nx-tile-drag'); });
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
      const from = native; native = null; over?.classList.remove('nx-drop'); over = null; root.classList.remove('nx-tile-drag');
      to.classList.add('nx-drop-done'); window.setTimeout(() => to.classList.remove('nx-drop-done'), 420);
      o.drop(from, to);
    }, { capture: true });
  }
  on(o.list, 'touchstart', event => {
    const e = event as TouchEvent;
    if (e.touches.length !== 1) { end(false); return; }
    tile = o.source(e.target as Element);
    if (!tile) return;
    touching = true;
    // A tile that drags natively would start the browser's own drag under a held finger and cancel ours.
    wasDraggable = tile.draggable; if (wasDraggable) tile.draggable = false;
    const t = e.touches[0]!; startX = t.clientX; startY = t.clientY;
    // Pressed in while it is held: the lift is felt coming before it happens.
    tile.classList.add('nx-press');
    window.clearTimeout(hold);
    hold = window.setTimeout(() => { if (tile) begin(startX, startY); }, HOLD_MS);
  }, { passive: true });
  on(o.list, 'touchmove', event => {
    const e = event as TouchEvent, t = e.touches[0];
    if (!tile || !t) return;
    if (dragging) { e.preventDefault(); move(t.clientX, t.clientY); }
    else if (Math.hypot(t.clientX - startX, t.clientY - startY) > TOUCH_SLOP) end(false);
  }, { passive: false });
  on(o.list, 'touchend', () => { if (tile) end(true); });
  on(o.list, 'touchcancel', () => { if (tile) end(false); });
  // A hold that became a drag must not also open the long-press menu.
  on(o.list, 'contextmenu', event => { if (dragging || tile?.classList.contains('nx-press')) event.preventDefault(); });
  return () => { end(false); root.classList.remove('nx-tile-drag'); for (const [node, type, fn, options] of listeners) node.removeEventListener(type, fn, options); };
}
