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

/** Shows the current page's tabs, keeps its last panel open, hides the TTS power on other pages. */
export function applySoundPage(root: HTMLElement, tab: (name: string) => void): void {
  root.dataset.soundPage = page;
  const allowed = SOUND_PAGE_TABS[page];
  for (const b of root.querySelectorAll<HTMLElement>('[data-tts-tab]')) b.hidden = !allowed.includes(b.dataset.ttsTab || '');
  const open = [...root.querySelectorAll<HTMLElement>('section.panel')].find(panel => !panel.hidden)?.id || '';
  if (!allowed.includes(open)) tab(allowed[0]!);
  const line = document.getElementById('nx-version-line');
  if (line) line.textContent = SOUND_PAGE_TITLES[page];
}
let applier: (() => void) | undefined;
/** The mounted root registers how to switch its panels; the nav calls it. */
export function setSoundApplier(apply: (() => void) | undefined): void { applier = apply; }
/** Nav entries carry data-sound-page; remember the choice before the UI re-renders. */
export function bindSoundNav(): void {
  if (document.documentElement.dataset.soundNav) return;
  document.documentElement.dataset.soundNav = '1';
  document.addEventListener('click', event => {
    const target = (event.target as Element | null)?.closest?.('[data-sound-page]');
    if (!target) return;
    setSoundPage(target.getAttribute('data-sound-page'));
    // The tab may already be open (same slot): switch panels without a reload.
    queueMicrotask(() => applier?.());
  }, true);
}
