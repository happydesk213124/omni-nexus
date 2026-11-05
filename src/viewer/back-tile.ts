import { saveViewerPrefs } from '../storage/viewer-prefs';
import { quiet, release } from './safe-dom';

/**
 * 이전 tile (뷰어 설정 · 이전 버튼 타일): a floating ◀ 이전 on the stage, a step back as the menu's ◀ is, for a phone
 * whose next is a tap anywhere and whose back is a small ◀ at the box's foot. It is one of the viewer's buttons
 * (data-vn-act="back": its tap is the viewer's), dragged anywhere besides: a press on it is followed while it lasts
 * (closed, the move costs Risu nothing), the drop kept as shares of the frame (any screen keeps it), and the click a
 * drag ends with is no tap.
 */
interface HostPoint { clientX: number; clientY: number }
interface Box { left: number; top: number; width: number; height: number }
export interface BackTileHost {
  doc: () => SafeDocument | null;
  root: () => SafeElement | null;
  frame: () => Box;
  /** The stage's style text written again (it places the tile where the settings say). */
  restyle: () => Promise<void>;
  /** The tile's rectangle read again, for the taps. */
  remeasure: () => Promise<void>;
}
interface Drag { x0: number; y0: number; left: number; top: number; dx: number; dy: number; el: SafeElement | null; painted: string }
/** A finger wobbles further than a mouse: under this a press was a tap. */
const SLOP = 8;
let host: BackTileHost | null = null, drag: Drag | null = null, moveId: Promise<string> | null = null;
let timer: ReturnType<typeof setTimeout> | undefined, blockedUntil = 0;
const inside = (p: HostPoint, r: Box) => p.clientX >= r.left && p.clientX <= r.left + r.width && p.clientY >= r.top && p.clientY <= r.top + r.height;
const share = (px: number, of: number) => Math.min(94, Math.max(0, Math.round(px / Math.max(1, of) * 1000) / 10));

export function backTileAttach(h: BackTileHost): void { host = h; drag = null; blockedUntil = 0; }
export async function backTileDetach(): Promise<void> {
  const d = drag;
  drag = null;
  await endMove();
  await release(d?.el ?? null);
  host = null;
}
/** The click a drag of the tile ended with: no tap. */
export const backTileBlocked = (): boolean => Date.now() < blockedUntil;

/** A press on the tile (where it was last read): its own, followed until it ends. */
export function backTileDown(p: HostPoint, tile: Box | null): boolean {
  const h = host, doc = h?.doc();
  if (!h || !doc || !tile || tile.width <= 0 || !inside(p, tile)) return false;
  const f = h.frame(), d: Drag = { x0: p.clientX, y0: p.clientY, left: tile.left - f.left, top: tile.top - f.top, dx: 0, dy: 0, el: null, painted: '' };
  drag = d;
  void (async () => { const root = h.root(); d.el = root ? await root.querySelector('[data-vn-act="back"]') : null; })().catch(() => {});
  moveId = doc.addEventListener('pointermove', (e: HostPoint) => onMove(e));
  return true;
}
function onMove(p: HostPoint): void {
  const d = drag;
  if (!d || !Number.isFinite(p?.clientX)) return;
  d.dx = p.clientX - d.x0; d.dy = p.clientY - d.y0;
  if (timer) return;
  timer = setTimeout(() => { timer = undefined; void paint(d).catch(() => {}); }, 32);
}
async function paint(d: Drag): Promise<void> {
  if (d !== drag || !d.el || Math.hypot(d.dx, d.dy) < SLOP) return;
  const style = `left:${Math.round(d.left + d.dx)}px;top:${Math.round(d.top + d.dy)}px`;
  if (style !== d.painted) { d.painted = style; await d.el.setStyleAttribute(style); }
}
/**
 * The press on the tile ended (true: it was the tile's, no swipe, no line). Under the slop it was a tap, which the
 * viewer's click does; moved, its place is kept (the settings, then the stage's style text, then its own px let go: no
 * jump) and the click it ends with is none.
 */
export function backTileUp(p: HostPoint): boolean {
  const d = drag, h = host;
  drag = null;
  if (!d || !h) return false;
  if (Number.isFinite(p?.clientX)) { d.dx = p.clientX - d.x0; d.dy = p.clientY - d.y0; }
  const moved = Math.hypot(d.dx, d.dy) >= SLOP, f = h.frame();
  if (moved) blockedUntil = Date.now() + 250;
  void (async () => {
    await endMove();
    if (moved) {
      await saveViewerPrefs({ backX: share(d.left + d.dx, f.width), backY: share(d.top + d.dy, f.height) });
      await h.restyle();
      if (d.el) await quiet(d.el.setStyleAttribute(''));
      await h.remeasure();
    }
    await release(d.el);
  })().catch(() => {});
  return true;
}
async function endMove(): Promise<void> {
  clearTimeout(timer); timer = undefined;
  const id = moveId, doc = host?.doc();
  moveId = null;
  if (id && doc) { const resolved = await id.catch(() => ''); if (resolved) await quiet(doc.removeEventListener('pointermove', resolved)); }
}
