import { SOUND_TABS } from './panels';

/**
 * The menu group "TTS · BGM · 감정 에셋" has five entries that all open the one
 * frozen-UI tab slot (`curation`); which panels show is decided here. TTS 캐릭터 is
 * TTS 설정's 캐릭터 tab on its own: the one most often wanted, a tap from the menu.
 */
export type SoundPage = 'tts' | 'sound' | 'people' | 'models' | 'asset';
export const SOUND_PAGE_TABS: Record<SoundPage, readonly string[]> = {
  tts: ['tts-settings', 'tts-characters', 'tts-voices'],
  sound: SOUND_TABS.map(([id]) => id),
  people: ['tts-characters'],
  models: ['tts-models'],
  asset: ['emo-viewer', 'emo-bg', 'emo-assets'],
};
export const SOUND_PAGE_TITLES: Record<SoundPage, string> = { tts: 'TTS 설정(beta)', sound: 'BGM·효과음', people: 'TTS 캐릭터', models: 'TTS·BGM·JEV 모델 설정', asset: '뷰어 및 감정 에셋' };
let page: SoundPage = 'tts';
export const soundPage = (): SoundPage => page;
export function setSoundPage(next: unknown): void { if (typeof next === 'string' && Object.hasOwn(SOUND_PAGE_TABS, next)) page = next as SoundPage; }
/**
 * A panel to open the page on, and what its search starts with: 옴니 뷰어's 👨‍👩‍👧‍👦 opens the
 * 캐릭터 tab on the reply's people ("하린, 세라"), and a name over a line that person's sheet
 * (`sheet`: their card, else a new one in their name). Shown from the first paint; taken once,
 * by the mount, which says `shown` once the page (and the sheet) is up, and the sheet `done`
 * when it is closed for good.
 */
export interface SoundFocus { panel: string; search: string; sheet?: { id: string; name: string }; shown?: () => void; done?: () => void }
let focus: SoundFocus | null = null;
export function focusSoundPanel(panel: string, search = '', more: Omit<SoundFocus, 'panel' | 'search'> = {}): void { focus = { panel, search, ...more }; }
export const soundFocus = (): SoundFocus | null => focus;
export function takeSoundFocus(): SoundFocus | null { const f = focus; focus = null; return f; }

/** Whether the settings window is up: the frozen UI's own flag. */
export function soundWindowOpen(): boolean { const read = Reflect.get(globalThis, '__OMNI_TTS_SETTINGS_OPEN__'); return typeof read === 'function' && !!read(); }
/** The settings window closed as its ✕ does, its save first. */
export function closeSoundWindow(): void { document.getElementById('nx-close')?.click(); }

/**
 * Marks the open page in the menu and the header. The vendor marks every entry
 * of the open slot, which here is all five.
 */
export function markSoundNav(slot: string): void {
  document.querySelectorAll('#nx-tabs [data-nx-tab]').forEach(btn => {
    const on = btn.getAttribute('data-nx-tab') === slot && (slot !== 'curation' || (btn.getAttribute('data-sound-page') || 'tts') === page);
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-current', on ? 'page' : 'false');
  });
  const line = document.getElementById('nx-version-line');
  if (line && slot === 'curation') line.textContent = SOUND_PAGE_TITLES[page];
}

let applier: (() => void) | undefined;
/** The mounted root registers how to switch its panels; the nav calls it. */
export function setSoundApplier(apply: (() => void) | undefined): void { applier = apply; }
/** Nav entries carry data-sound-page; remember the choice before the UI re-renders. */
export function bindSoundNav(): void {
  if (document.documentElement.dataset.soundNav) return;
  document.documentElement.dataset.soundNav = '1';
  const choose = (event: Event) => {
    const target = (event.target as Element | null)?.closest?.('[data-sound-page]');
    if (!target) return;
    setSoundPage(target.getAttribute('data-sound-page'));
    // The tab may already be open (same slot): switch panels without a reload.
    queueMicrotask(() => applier?.());
  };
  // The vendor switches tabs on pointerdown and paints right away: the page has to be chosen before that.
  document.addEventListener('pointerdown', choose, true);
  document.addEventListener('click', choose, true);
}
