import layout from './layout.json';
import { omniTts } from '../services/tts-runtime';
import { bindTtsSettings } from './settings';
import { TtsLibrary } from './library';
import { TtsCharacters } from './characters';
import { bindTtsLlmActions } from './llm-actions';
import { el, dialog, on } from './common';

export const ttsSettingsHtml = () => layout.html;
export const ttsHelp = layout.help;
export async function mountTts(): Promise<void> {
  const root = el('tts-settings-root'); if (!root || root.dataset.bound) return; root.dataset.bound = '1';
  await omniTts.init(); if (!root.isConnected) return;
  root.style.height = 'calc(100dvh - 116px)';
  root.style.minHeight = '320px';
  if (!el('omnitts-settings-style')) { const style = document.createElement('style'); style.id = 'omnitts-settings-style'; style.textContent = layout.css + '\n#tts-settings-root [hidden],#tts-dialogs [hidden]{display:none!important}#tts-settings-root .voice-row.selected{outline:2px solid #9562ff}#tts-settings-root .voice-top{display:flex;gap:8px}#tts-settings-root .char-triggers{position:absolute;right:8px;top:8px;display:flex;gap:4px}#tts-settings-root .char-triggers span{padding:4px;background:#10162288;border-radius:4px;font-size:10px}'; document.body.append(style); }
  el('tts-dialogs')?.remove(); const holder = document.createElement('div'); holder.innerHTML = layout.dialogs; document.body.append(holder.firstElementChild!);
  // The settings iframe owns these normal DOM dialogs; chat markup is module-owned.
  for (const b of el('tts-dialogs').querySelectorAll<HTMLElement>('[data-close]')) b.addEventListener('click',event => { event.preventDefault(); dialog(b.dataset.close!,false); });
  const tab = (name: string) => { for (const panel of root.querySelectorAll<HTMLElement>('section.panel')) panel.hidden = panel.id !== name; for (const b of root.querySelectorAll<HTMLElement>('[data-tts-tab]')) { const active = b.dataset.ttsTab === name; b.setAttribute('aria-selected',String(active)); b.tabIndex = active ? 0 : -1; } };
  for (const b of root.querySelectorAll<HTMLElement>('[data-tts-tab]')) b.addEventListener('click', () => tab(b.dataset.ttsTab!)); tab('tts-settings');
  bindTtsSettings(); const library = new TtsLibrary(tab); library.bind(); const characters = new TtsCharacters(library,tab); await characters.bind();
  const refresh = () => { library.render(); characters.render(); }; bindTtsLlmActions(refresh);
  document.addEventListener('omnitts-library',refresh);
  const observer = new MutationObserver(() => { if (!root.isConnected) { document.removeEventListener('omnitts-library',refresh); el('tts-dialogs')?.remove(); observer.disconnect(); } }); observer.observe(document.body,{childList:true,subtree:true});
  on('audio-unlock-confirm', async () => { await omniTts.player.unlock(); dialog('audio-unlock-dialog',false); }); on('audio-unlock-cancel', () => dialog('audio-unlock-dialog',false));
}
