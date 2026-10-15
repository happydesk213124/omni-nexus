import { SOUND_TABS } from './panels';

/**
 * The menu group "TTS · BGM · 효과음" has three entries that all open the one
 * frozen-UI tab slot (`curation`); which panels show is decided here.
 */
export type SoundPage = 'tts' | 'sound' | 'models';
export const SOUND_PAGE_TABS: Record<SoundPage, readonly string[]> = {
  tts: ['tts-settings', 'tts-characters', 'tts-voices'],
  sound: SOUND_TABS.map(([id]) => id),
  models: ['tts-models'],
};
export const SOUND_PAGE_TITLES: Record<SoundPage, string> = { tts: 'TTS 설정(beta)', sound: 'BGM·효과음', models: '소리 모델 설정' };
let page: SoundPage = 'tts';
export const soundPage = (): SoundPage => page;
export function setSoundPage(next: unknown): void { if (next === 'tts' || next === 'sound' || next === 'models') page = next; }

/**
 * Marks the open page in the menu and the header. The vendor marks every entry
 * of the open slot, which here is all three.
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
