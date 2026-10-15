import { SOUND_PANELS, SOUND_TABS } from './panels';
import { SOUND_PAGE_TABS, markSoundNav, soundPage } from './page';
import { SOUND_PAGE_CSS, voiceListCssFor } from './style';
import layout from '../tts-ui/layout.json';

/**
 * Adds the BGM·효과음 tabs and panels to the TTS root and moves the model panel
 * out of the TTS power fieldset (both must work while TTS is off). Idempotent.
 */
export function addSoundStructure(root: ParentNode): void {
  if (root.querySelector('#sound-controls')) return;
  root.querySelector('.tts-tabs-bar nav')?.insertAdjacentHTML('beforeend', SOUND_TABS.map(([id, label]) => `<button role="tab" id="tab-${id}" aria-controls="${id}" aria-selected="false" tabindex="-1" data-tts-tab="${id}">${label}</button>`).join(''));
  root.querySelector('#tts-controls')?.insertAdjacentHTML('afterend', SOUND_PANELS);
  const models = root.querySelector('#tts-models');
  if (models) root.querySelector('#sound-controls')?.append(models);
  // ElevenLabs belongs to the shared model page; BGM·효과음 uses it to generate effects.
  models?.insertAdjacentHTML('beforeend', '<div class="group" id="snd-eleven-group"><h3>ElevenLabs · 효과음 생성</h3><div class="fields"><label class="field full"><span>ElevenLabs API Key</span><input type="password" id="snd-eleven-key" autocomplete="off" placeholder="효과음 생성에만 씁니다 (유료)"></label></div></div>');
}

/**
 * Page visibility as plain attributes, so the right tabs and panels show from the
 * first paint: nothing is shown first and hidden after an asynchronous mount.
 * Only one of the two containers exists in layout at a time — both flex to fill
 * the height, and a hidden-by-panels but present container took half of it.
 */
export function markSoundPage(root: HTMLElement, openPanel?: string): void {
  const page = soundPage(), allowed = SOUND_PAGE_TABS[page];
  root.dataset.soundPage = page;
  const open = openPanel && allowed.includes(openPanel) ? openPanel : allowed[0]!;
  for (const b of root.querySelectorAll<HTMLElement>('[data-tts-tab]')) {
    const tab = b.dataset.ttsTab || '';
    b.hidden = !allowed.includes(tab);
    b.setAttribute('aria-selected', String(tab === open)); b.tabIndex = tab === open ? 0 : -1;
  }
  for (const panel of root.querySelectorAll<HTMLElement>('section.panel')) panel.hidden = panel.id !== open;
  const tts = page === 'tts';
  const toggle = (selector: string, show: boolean) => { const node = root.querySelector<HTMLElement>(selector); if (node) node.hidden = !show; };
  toggle('#tts-controls', tts); toggle('#tts-power-controls', tts); toggle('#sound-controls', !tts);
  if (!tts) toggle('#tts-off-notice', false);
}

const SOUND_STYLE = () => SOUND_PAGE_CSS + voiceListCssFor(layout.css);
/** The TTS area's markup for the open page, with its styles, ready before any script runs. */
export function soundAwareHtml(html: string): string {
  if (typeof document === 'undefined') return html;
  const box = document.createElement('template'); box.innerHTML = html;
  const root = box.content.querySelector<HTMLElement>('#tts-settings-root');
  if (!root) return html;
  addSoundStructure(root);
  markSoundPage(root);
  // Both style sheets travel with the markup; the mount refreshes them in place.
  root.insertAdjacentHTML('afterbegin', `<style id="omnitts-settings-style">${layout.css}</style><style id="omnisound-page-style">${SOUND_STYLE()}</style>`);
  return box.innerHTML;
}
export const soundStyleText = SOUND_STYLE;

/** Switches an already mounted root to the current page, keeping its open panel when it belongs there. */
export function applySoundPage(root: HTMLElement, tab: (name: string) => void): void {
  const open = [...root.querySelectorAll<HTMLElement>('section.panel')].find(panel => !panel.hidden)?.id;
  markSoundPage(root, open);
  tab([...root.querySelectorAll<HTMLElement>('section.panel')].find(panel => !panel.hidden)!.id);
  markSoundNav('curation');
}
