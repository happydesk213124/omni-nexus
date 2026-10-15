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
export const SOUND_PAGE_CSS = '#tts-settings-root[data-sound-page="sound"] #tts-power-controls,#tts-settings-root[data-sound-page="models"] #tts-power-controls,'
  + '#tts-settings-root[data-sound-page="sound"] #tts-off-notice,#tts-settings-root[data-sound-page="models"] #tts-off-notice{display:none!important}'
  + '#tts-settings-root .snd-rule,#tts-settings-root .snd-term,#tts-settings-root .snd-unknown{display:flex;gap:6px;align-items:center;flex-wrap:wrap}'
  + '#tts-settings-root .snd-rule-error{flex-basis:100%;color:#f29da6}'
  // Same grid and square tiles as the voice list (its rules are keyed to #voice-list).
  + '#tts-settings-root :is(#snd-bgm-list,#snd-sfx-list){display:grid;grid-template-columns:repeat(auto-fill,minmax(145px,1fr));grid-auto-rows:max-content;align-items:start;gap:9px;align-content:start;padding:8px 4px;flex:1;min-height:0;overflow:auto;overscroll-behavior:contain}'
  + '#tts-settings-root :is(#snd-bgm-list,#snd-sfx-list) .voice-row{width:100%;aspect-ratio:1;min-height:0;gap:4px;overflow:hidden;align-self:start;padding:10px 10px 52px}'
  + '#tts-settings-root :is(#snd-bgm-list,#snd-sfx-list) .char-empty{grid-column:1/-1}';
