import { psGet, psSet } from './device-store';

/**
 * 옴니 뷰어's own settings, on this device: AUTO and VOICE (its buttons), the words
 * whose lines it leaves out, how fast the letters come and how large they are. The viewer and its page in
 * 감정 에셋 share them.
 */
export const VIEWER_PREFS_KEY = 'omniviewer.data';
export type ViewerSpeed = 'instant' | 'fast' | 'normal' | 'slow';
export type ViewerTextSize = 'small' | 'normal' | 'large' | 'xlarge';
/** How a reply that says no place gets one: JEV or embedding (자동: whichever has a key), or none (the chat's last place). */
export type ViewerBgPick = 'auto' | 'jev' | 'embedding' | 'off';
const BG_PICKS: readonly ViewerBgPick[] = ['auto', 'jev', 'embedding', 'off'];
/**
 * placeModule: ⚛️ omni place installed and on (the writer marks places). breathe: the
 * people on stage breathe; bounce: one comes in, changes face or steps forward with a spring.
 * sfx: its 효과음 button, the effects of the lines read played (off, passed over).
 * stageReach: a person stays on stage this many lines after their latest line (0: to the
 * reply's end, as the stage once was).
 * revealBase64: risu64 난독's [base64] words read as words, by the viewer and by the voice in the chat too.
 * cgSize: how big a folded picture stays at the top (1 the small thumb, 2 and 3 bigger), set by its + button.
 * floatResume, floatCenter, menuResume, menuCenter: 바로가기, the viewer's two ways in (where the reader left this chat,
 * the message in the middle of the chat screen) as Risu's floating buttons (off unless switched on) and in the chat's
 * ☰ menu (on unless switched off), each up while on.
 * elements: its 요소 button, as AUTO and VOICE are: on, the bot's registered elements come up (any bot, any chat).
 * backTile: a floating 이전 tile on the stage (a step back, as ◀; a phone's next is a tap anywhere, its back the small
 * ◀), off unless switched on; backX, backY: where it was dragged to, as shares of the frame (percent).
 */
export interface ViewerPrefs { auto: boolean; voice: boolean; sfx: boolean; skipWords: string; speed: ViewerSpeed; textSize: ViewerTextSize; placeModule: boolean; bgPick: ViewerBgPick; breathe: boolean; bounce: boolean; stageReach: number; revealBase64: boolean; cgSize: CgSize; floatResume: boolean; floatCenter: boolean; menuResume: boolean; menuCenter: boolean; elements: boolean; backTile: boolean; backX: number; backY: number }
export type CgSize = 1 | 2 | 3;
export const STAGE_REACHES: readonly number[] = [1, 2, 3, 4, 5, 0];
const TEXT_SIZES: readonly ViewerTextSize[] = ['small', 'normal', 'large', 'xlarge'];
/** The box's letters, against 'normal' (the size the viewer had before it was a choice). */
export const TEXT_SCALE: Record<ViewerTextSize, number> = { small: 0.88, normal: 1, large: 1.16, xlarge: 1.34 };
const SPEEDS: readonly ViewerSpeed[] = ['instant', 'fast', 'normal', 'slow'];
/** How long letters take, against 'fast' (the speed the viewer had before it was a choice). */
export const SPEED_PACE: Record<ViewerSpeed, number> = { instant: 0, fast: 1, normal: 1.7, slow: 2.6 };

/** A place on the frame, in percent (0 to 94: the tile stays on it). */
const share = (v: unknown, fallback: number) => { const n = Number(v); return Number.isFinite(n) ? Math.min(94, Math.max(0, n)) : fallback; };
function normalize(raw: unknown): ViewerPrefs {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof ViewerPrefs, unknown>>;
  return {
    auto: r.auto === true, voice: r.voice !== false, sfx: r.sfx !== false,
    skipWords: typeof r.skipWords === 'string' ? r.skipWords.slice(0, 2000) : '',
    speed: SPEEDS.includes(r.speed as ViewerSpeed) ? r.speed as ViewerSpeed : 'fast',
    textSize: TEXT_SIZES.includes(r.textSize as ViewerTextSize) ? r.textSize as ViewerTextSize : 'normal',
    placeModule: r.placeModule === true, bgPick: BG_PICKS.includes(r.bgPick as ViewerBgPick) ? r.bgPick as ViewerBgPick : 'auto',
    breathe: r.breathe !== false, bounce: r.bounce !== false,
    stageReach: typeof r.stageReach === 'number' && STAGE_REACHES.includes(r.stageReach) ? r.stageReach : 3,
    revealBase64: r.revealBase64 === true,
    cgSize: r.cgSize === 2 || r.cgSize === 3 ? r.cgSize : 1,
    // The floating pair is new over the chat: up only once switched on (the menu's pair was always there).
    floatResume: r.floatResume === true, floatCenter: r.floatCenter === true,
    menuResume: r.menuResume !== false, menuCenter: r.menuCenter !== false,
    elements: r.elements === true,
    backTile: r.backTile === true, backX: share(r.backX, 4), backY: share(r.backY, 64),
  };
}
let prefs = normalize(null);
const listeners = new Set<() => void>();
export const viewerPrefs = (): ViewerPrefs => prefs;
export async function loadViewerPrefs(): Promise<ViewerPrefs> {
  prefs = normalize(await psGet(VIEWER_PREFS_KEY).catch(() => null));
  return prefs;
}
export async function saveViewerPrefs(patch: Partial<ViewerPrefs>): Promise<void> {
  prefs = normalize({ ...prefs, ...patch });
  for (const listener of listeners) listener();
  await psSet(VIEWER_PREFS_KEY, prefs).catch(() => {});
}
export function subscribeViewerPrefs(listener: () => void): () => void { listeners.add(listener); return () => listeners.delete(listener); }
/** The leave-out words: split at commas (or new lines), trimmed, no empties, no repeats. */
export function skipWordList(text: string): string[] {
  return [...new Set(String(text || '').split(/[,\n，、]/).map(word => word.trim()).filter(Boolean))].slice(0, 100);
}
