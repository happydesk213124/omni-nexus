/**
 * Dragging tiles in a grid, as in a file window: onto a folder to file them, between two tiles to reorder them. A
 * mouse drags once it has moved a little; a finger after a short hold (a quick swipe still scrolls the list). Where
 * the tiles already drag natively (the preset tiles, to reorder), `mouse` is off and the native drop is taken
 * instead; a finger drags them our way all the same.
 *
 * What is dragged is the tile itself, lifted: a copy of it follows the pointer a little above the finger, the places
 * it may be dropped light up for as long as the drag lasts, the list scrolls when it is held near an edge, and on
 * release the copy flies into place (or back where it came from).
 *
 * A finger that holds a tile and does not carry it anywhere wants its menu, not a drag: `held` is told, while the
 * finger is still down once it has stayed put a moment more, or on a release where it was lifted.
 */
export interface DropPlace { el: HTMLElement; /** Between tiles (a reorder): before or after `el`. Absent, onto it. */ side?: 'before' | 'after' }
export interface TileDragOptions {
  list: HTMLElement;
  /** The tile under an event target that may be dragged. */
  source: (target: Element) => HTMLElement | null;
  /** Where a drag would end, with the pointer over `at`. */
  place: (at: Element, x: number, y: number, tile: HTMLElement, touch: boolean) => DropPlace | null;
  drop: (tile: HTMLElement, place: DropPlace) => void;
  /** How many go along with this tile (선택 mode): shown on the copy when more than one. */
  count: (tile: HTMLElement) => number;
  /** The other tiles that go along with it: they dim with it. */
  companions?: (tile: HTMLElement) => HTMLElement[];
  /** A finger held the tile where it was: its menu. */
  held?: (tile: HTMLElement, x: number, y: number) => void;
  mouse: boolean;
}
const HOLD_MS = 360, MENU_MS = 420, MOUSE_SLOP = 6, TOUCH_SLOP = 10, HELD_SLOP = 12, EDGE = 64, GHOST_MAX = 104;
const MARKS = ['nx-drop', 'nx-insert-before', 'nx-insert-after'];
const buzz = (ms: number) => { try { navigator.vibrate?.(ms); } catch { /* no haptics */ } };

export function bindTileDrag(o: TileDragOptions): () => void {
  let tile: HTMLElement | null = null, ghost: HTMLElement | null = null, over: DropPlace | null = null, moving: HTMLElement[] = [];
  let startX = 0, startY = 0, lastX = 0, lastY = 0, moved = 0, dragging = false, touching = false, hold = 0, menu = 0, frame = 0, native: HTMLElement | null = null, wasDraggable = false, quietUntil = 0;
  let size = { w: 0, h: 0 }, origin = { x: 0, y: 0 };
  const doc = o.list.ownerDocument, root = doc.documentElement;
  const scroller = (): HTMLElement | null => { for (let el: HTMLElement | null = o.list; el; el = el.parentElement) { const flow = getComputedStyle(el).overflowY; if ((flow === 'auto' || flow === 'scroll') && el.scrollHeight > el.clientHeight) return el; } return null; };
  const under = (x: number, y: number, from: HTMLElement): DropPlace | null => {
    if (ghost) ghost.style.visibility = 'hidden';
    const at = doc.elementFromPoint(x, y);
    if (ghost) ghost.style.visibility = '';
    return at ? o.place(at, x, y, from, touching) : null;
  };
  const mark = (next: DropPlace | null) => {
    if (over?.el === next?.el && over?.side === next?.side) return;
    over?.el.classList.remove(...MARKS); over = next;
    next?.el.classList.add(next.side ? `nx-insert-${next.side}` : 'nx-drop');
    if (next && touching) buzz(6);
  };
  /** The copy, a little above the pointer so a finger does not cover it. */
  const position = (x: number, y: number) => { if (ghost) ghost.style.transform = `translate(${x - size.w / 2}px, ${y - size.h * (touching ? .92 : .6)}px) rotate(-3deg)`; };
  const begin = (x: number, y: number) => {
    if (!tile) return;
    dragging = true; moved = 0;
    const box = tile.getBoundingClientRect(), shrink = Math.min(1, GHOST_MAX / Math.max(box.width, box.height));
    size = { w: box.width * shrink, h: box.height * shrink }; origin = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    // A copy of the tile with nothing to find it by: the lists look tiles up by their data attributes and ids.
    const copy = tile.cloneNode(true) as HTMLElement;
    for (const node of [copy, ...copy.querySelectorAll<HTMLElement>('*')]) for (const attr of [...node.attributes]) if (attr.name === 'id' || attr.name === 'style' || attr.name.startsWith('data-') || attr.name.startsWith('aria-')) node.removeAttribute(attr.name);
    const n = o.count(tile);
    copy.className = `preset-tile nx-drag-ghost${n > 1 ? ' nx-drag-many' : ''}`; copy.style.width = `${size.w}px`; copy.style.height = `${size.h}px`;
    if (n > 1) { const badge = doc.createElement('em'); badge.textContent = String(n); copy.append(badge); }
    ghost = copy; doc.body.append(ghost);
    moving = [tile, ...(o.companions?.(tile) || []).filter(other => other !== tile)];
    tile.classList.remove('nx-press'); for (const each of moving) each.classList.add('nx-dragging');
    root.classList.add('nx-tile-drag');
    if (touching) buzz(14);
    move(x, y);
    if (!frame) frame = requestAnimationFrame(edgeScroll);
    // Still held where it was lifted a moment later: the finger wants the tile's menu.
    if (touching && o.held) menu = window.setTimeout(() => { if (tile && dragging && moved <= HELD_SLOP) heldHere(); }, MENU_MS);
  };
  const heldHere = () => {
    const from = tile, x = startX, y = startY;
    end(false);
    // The finger is still down (or lifts now): the click or long-press menu that follows is not a choice.
    quietUntil = performance.now() + 500;
    if (from) o.held?.(from, x, y);
  };
  const move = (x: number, y: number) => {
    lastX = x; lastY = y; moved = Math.max(moved, Math.hypot(x - startX, y - startY));
    if (moved > HELD_SLOP) window.clearTimeout(menu);
    position(x, y);
    if (tile) mark(under(x, y, tile));
  };
  /** Held near the top or bottom of the list, the list scrolls: a folder off screen can still be reached. */
  const edgeScroll = () => {
    frame = 0;
    if (!dragging) return;
    const box = scroller();
    if (box) {
      const r = box.getBoundingClientRect(), up = lastY - r.top, down = r.bottom - lastY;
      const step = up < EDGE ? -Math.ceil((EDGE - up) / 5) : down < EDGE ? Math.ceil((EDGE - down) / 5) : 0;
      if (step && tile) { box.scrollTop += step; mark(under(lastX, lastY, tile)); }
    }
    frame = requestAnimationFrame(edgeScroll);
  };
  const end = (commit: boolean, mouse = false) => {
    window.clearTimeout(hold); window.clearTimeout(menu);
    const from = tile, to = commit ? over : null, was = dragging, copy = ghost, group = moving, finger = touching;
    if (from) { from.classList.remove('nx-press'); if (wasDraggable) from.draggable = true; }
    wasDraggable = false; tile = null; ghost = null; dragging = false; touching = false; moving = [];
    if (frame) { cancelAnimationFrame(frame); frame = 0; }
    over?.el.classList.remove(...MARKS); over = null;
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
    // Lifted and let go where it was: the tile's menu, not a move.
    const inPlace = commit && finger && !to && moved <= HELD_SLOP && !!o.held;
    // The copy flies into place, or back to where it was lifted from; the tiles show again when it lands.
    const land = to ? to.el.getBoundingClientRect() : null;
    const goal = land ? { x: to!.side === 'before' ? land.left : to!.side === 'after' ? land.right : land.left + land.width / 2, y: land.top + land.height / 2 } : origin;
    const settle = () => { for (const each of group) each.classList.remove('nx-dragging'); };
    if (copy) {
      copy.classList.add('nx-drag-land');
      copy.style.transform = `translate(${goal.x - size.w / 2}px, ${goal.y - size.h / 2}px) scale(${to && !to.side ? .25 : to ? .6 : 1}) rotate(0deg)`;
      if (to) copy.style.opacity = '0';
      window.setTimeout(() => { copy.remove(); settle(); }, 190);
    } else settle();
    if (to && from) {
      if (!to.side) { to.el.classList.add('nx-drop-done'); window.setTimeout(() => to.el.classList.remove('nx-drop-done'), 420); }
      o.drop(from, to);
    } else if (inPlace && from) { quietUntil = performance.now() + 500; o.held!(from, startX, startY); }
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
      if (!tile || e.pointerType === 'touch' || touching) return;
      if (!dragging && Math.hypot(e.clientX - startX, e.clientY - startY) > MOUSE_SLOP) begin(e.clientX, e.clientY);
      if (dragging) { e.preventDefault(); move(e.clientX, e.clientY); }
    });
    on(doc, 'pointerup', event => { if ((event as PointerEvent).pointerType !== 'touch' && tile && !touching) end(true, true); });
    on(doc, 'pointercancel', event => { if ((event as PointerEvent).pointerType !== 'touch' && tile && !touching) end(false); });
    // A tile is a button: without this a drag selects text or starts a native link drag.
    on(o.list, 'dragstart', event => { if (o.source(event.target as Element)) event.preventDefault(); });
  } else {
    // Native drags (the preset tiles reorder that way): the drop on a folder, and a folder's own move, are ours.
    on(o.list, 'dragstart', event => { native = o.source(event.target as Element); if (native) root.classList.add('nx-tile-drag'); }, { capture: true });
    on(doc, 'dragend', () => { native = null; mark(null); root.classList.remove('nx-tile-drag'); });
    on(doc, 'dragover', event => {
      if (!native) return;
      const e = event as DragEvent, to = o.place(e.target as Element, e.clientX, e.clientY, native, false);
      mark(to);
      if (to) { event.preventDefault(); event.stopPropagation(); }
    }, { capture: true });
    on(doc, 'drop', event => {
      const e = event as DragEvent, to = native ? o.place(e.target as Element, e.clientX, e.clientY, native, false) : null;
      if (!native || !to) return;
      event.preventDefault(); event.stopPropagation();
      const from = native; native = null; mark(null); root.classList.remove('nx-tile-drag');
      if (!to.side) { to.el.classList.add('nx-drop-done'); window.setTimeout(() => to.el.classList.remove('nx-drop-done'), 420); }
      o.drop(from, to);
    }, { capture: true });
  }
  on(o.list, 'touchstart', event => {
    const e = event as TouchEvent;
    if (e.touches.length !== 1) { end(false); return; }
    tile = o.source(e.target as Element);
    if (!tile) return;
    touching = true; moved = 0;
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
  // A held finger is ours: the browser's own long-press menu, and the menus other listeners open on it, stay shut;
  // so does the tap some browsers send when a long press lets go.
  const quiet = () => dragging || !!tile?.classList.contains('nx-press') || performance.now() < quietUntil;
  on(o.list, 'contextmenu', event => { if (quiet()) { event.preventDefault(); event.stopPropagation(); } }, { capture: true });
  on(doc, 'click', event => { if (performance.now() < quietUntil) { quietUntil = 0; event.preventDefault(); event.stopPropagation(); } }, { capture: true });
  return () => { end(false); root.classList.remove('nx-tile-drag'); for (const [node, type, fn, options] of listeners) node.removeEventListener(type, fn, options); };
}
