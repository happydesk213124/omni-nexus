import { SOUND_DIALOG, SOUND_PANELS, SOUND_TABS } from './panels';
import { SoundLibrary } from './library';
import { bindSoundSettings } from './settings';
import { bindGlossary, renderGlossary } from './glossary';
import { SOUND_PAGE_CSS, applySoundPage, setSoundApplier } from './page';
import { omniSound } from '../services/sound-runtime';
import { el, run } from '../tts-ui/common';

/**
 * Adds the BGM·효과음 panels and tab buttons to the TTS root, and moves the model
 * panel next to them: both pages must work while TTS itself is switched off.
 * Called before the TTS root binds its tab buttons, so they switch these too.
 */
export function injectSoundPanels(root: HTMLElement): void {
  if (root.querySelector('#sound-controls')) return;
  const nav = root.querySelector('.tts-tabs-bar nav');
  nav?.insertAdjacentHTML('beforeend', SOUND_TABS.map(([id, label]) => `<button role="tab" id="tab-${id}" aria-controls="${id}" aria-selected="false" tabindex="-1" data-tts-tab="${id}">${label}</button>`).join(''));
  root.querySelector('#tts-controls')?.insertAdjacentHTML('afterend', SOUND_PANELS);
  const models = root.querySelector('#tts-models');
  if (models) root.querySelector('#sound-controls')?.append(models);
  el('tts-dialogs')?.insertAdjacentHTML('beforeend', SOUND_DIALOG);
  let style = document.getElementById('omnisound-page-style');
  if (!style) { style = document.createElement('style'); style.id = 'omnisound-page-style'; document.head.append(style); }
  style.textContent = SOUND_PAGE_CSS;
}

export async function mountSound(root: HTMLElement, tab: (name: string) => void, live: () => boolean): Promise<void> {
  const apply = () => { if (live()) applySoundPage(root, tab); };
  apply();
  setSoundApplier(apply);
  await omniSound.init(); if (!live()) return;
  bindSoundSettings();
  const libraries = [new SoundLibrary('bgm'), new SoundLibrary('sfx')];
  for (const library of libraries) library.bind();
  bindGlossary();
  // Words keep arriving from replies; each visit shows the current lists.
  for (const [id, render] of [['tab-sound-glossary', renderGlossary], ['tab-sound-bgm', () => libraries[0]!.render()], ['tab-sound-sfx', () => libraries[1]!.render()]] as const) el(id)?.addEventListener('click', render);
  let active = libraries[0]!;
  for (const library of libraries) el(`snd-${library.kind}-add`)?.addEventListener('click', () => { active = library; }, true);
  el('snd-item-source')?.addEventListener('change', () => active.syncSource());
  el('snd-item-save')?.addEventListener('click', () => run(() => libraries.find(l => l.kind === el('snd-item-dialog').dataset.kind)!.save().then(() => renderGlossary())));
  el('snd-item-cancel')?.addEventListener('click', () => el<HTMLDialogElement>('snd-item-dialog').close());
  apply();
}
