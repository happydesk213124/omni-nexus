import { SOUND_DIALOG } from './panels';
import { SoundLibrary } from './library';
import { bindSoundSettings } from './settings';
import { bindGlossary, renderGlossary } from './glossary';
import { setSoundApplier } from './page';
import { addSoundStructure, applySoundPage, soundStyleText } from './markup';
import { omniSound } from '../services/sound-runtime';
import { el, run } from '../tts-ui/common';
import { placeLlmCommandButton } from '../tts-ui/llm-command';
import { glossaryLlmCommand, soundLlmCommand } from './llm';
import { SOUND_PICK_DIALOG, bindSfxPicker } from './picker';

/**
 * Adds the BGM·효과음 panels and tab buttons to the TTS root, and moves the model
 * panel next to them: both pages must work while TTS itself is switched off.
 * Called before the TTS root binds its tab buttons, so they switch these too.
 */
export function injectSoundPanels(root: HTMLElement): void {
  // Usually already in the markup (soundAwareHtml); a root built elsewhere gets it here.
  addSoundStructure(root);
  if (!el('snd-item-dialog')) el('tts-dialogs')?.insertAdjacentHTML('beforeend', SOUND_DIALOG + SOUND_PICK_DIALOG);
  let style = document.getElementById('omnisound-page-style');
  if (!style) { style = document.createElement('style'); style.id = 'omnisound-page-style'; document.head.append(style); }
  style.textContent = soundStyleText();
}

export async function mountSound(root: HTMLElement, tab: (name: string) => void, live: () => boolean): Promise<void> {
  const apply = () => { if (live()) applySoundPage(root, tab); };
  apply();
  setSoundApplier(apply);
  await omniSound.init(); if (!live()) return;
  bindSoundSettings();
  const libraries = [new SoundLibrary('bgm'), new SoundLibrary('sfx')];
  for (const library of libraries) library.bind();
  bindSfxPicker(); bindGlossary();
  for (const library of libraries) placeLlmCommandButton(`snd-${library.kind}-llm`, el(`snd-${library.kind}-add`), () => soundLlmCommand(library.kind, () => library.render()));
  placeLlmCommandButton('snd-term-llm', el('snd-term-add'), () => glossaryLlmCommand(() => renderGlossary()));
  // Words keep arriving from replies; each visit shows the current lists.
  for (const [id, render] of [['tab-sound-glossary', () => renderGlossary()], ['tab-sound-bgm', () => libraries[0]!.render()], ['tab-sound-sfx', () => libraries[1]!.render()]] as const) el(id)?.addEventListener('click', render);
  let active = libraries[0]!;
  for (const library of libraries) el(`snd-${library.kind}-add`)?.addEventListener('click', () => { active = library; }, true);
  el('snd-item-source')?.addEventListener('change', () => active.syncSource());
  el('snd-item-save')?.addEventListener('click', () => run(() => libraries.find(l => l.kind === el('snd-item-dialog').dataset.kind)!.save().then(() => renderGlossary())));
  el('snd-item-cancel')?.addEventListener('click', () => el<HTMLDialogElement>('snd-item-dialog').close());
  el('snd-move-cancel')?.addEventListener('click', () => el<HTMLDialogElement>('snd-move-dialog').close());
  el('snd-move-confirm')?.addEventListener('click', () => run(async () => {
    const library = libraries.find(l => l.kind === el('snd-move-dialog').dataset.kind);
    await library?.moveSelected((el('snd-move-target') as HTMLSelectElement).value); el<HTMLDialogElement>('snd-move-dialog').close();
  }));
  apply();
}
