import layout from './layout.json';
import { omniTts } from '../services/tts-runtime';
import { bindTtsSettings } from './settings';
import { TtsLibrary } from './library';
import { TtsCharacters } from './characters';
import { bindTtsLlmActions } from './llm-actions';
import { placeLlmCommandButton } from './llm-command';
import { voiceLlmCommand } from './voice-llm';
import { bindTtsConnectionTests } from './connection-tests';
import { el, dialog, on, LISTEN_CSS } from './common';
import { attachTtsHelp } from './help';
import { exportableTtsSettings, importTtsSettings } from './settings-transfer';
import { download, readJson, notify, run, input } from './common';
import { bindAudioActivation, cancelAudioActivation, confirmAudioActivation, promptInitialAudioActivation } from './activation';
import { ttsData } from '../storage/tts-store';
import { injectSoundPanels, mountSound } from '../sound-ui/mount';
import { soundAwareHtml } from '../sound-ui/markup';

/** Built for the open menu page (TTS / BGM·효과음 / models) so the first paint is already right. */
export const ttsSettingsHtml = () => soundAwareHtml(layout.html);
export const ttsHelp = layout.help;
export async function mountTts(): Promise<void> {
  const root = el('tts-settings-root'); if (!root || root.dataset.bound) return; root.dataset.bound = '1';
  await omniTts.init(); if (!root.isConnected) return;
  root.style.height = 'calc(100dvh - 116px)';
  root.style.minHeight = '320px';
  let style=el<HTMLStyleElement>('omnitts-settings-style');if(!style){style=document.createElement('style');style.id='omnitts-settings-style';}
  // Settings pane width can be narrower than the desktop viewport. Let commands
  // wrap at their actual available width instead of pushing them off screen.
  style.textContent=layout.css+'\n#tts-settings-root{min-width:0;width:100%}#tts-settings-root fieldset{min-inline-size:0}#tts-settings-root .character-command-bar{flex-wrap:wrap!important}#tts-settings-root .character-command-bar #char-search{flex:1 1 160px;min-width:0;max-width:100%}#tts-settings-root .character-command-bar .actions{max-width:100%;flex-wrap:wrap!important;padding:0}#tts-settings-root [hidden],#tts-dialogs [hidden]{display:none!important}#tts-settings-root .voice-row.selected{outline:2px solid #9562ff}#tts-settings-root .voice-top{display:flex;gap:8px}#tts-settings-root .char-triggers{position:absolute;right:8px;top:8px;display:flex;flex-wrap:wrap;justify-content:flex-end;gap:4px;max-width:calc(100% - 16px)}#tts-settings-root .char-triggers span{padding:4px;background:#10162288;border-radius:4px;font-size:10px}#tts-settings-root .character-jev-bar{flex-shrink:0}#tts-settings-root .character-batch-tools{display:flex;align-items:center;gap:8px;flex-wrap:wrap}#tts-settings-root #character-jev-count{min-width:72px}#tts-settings-root .char-empty{grid-column:1/-1;padding:20px 8px;color:var(--muted);font-size:13px}'+LISTEN_CSS;document.body.append(style);
  el('tts-dialogs')?.remove(); const holder = document.createElement('div'); holder.innerHTML = layout.dialogs; const dialogs=holder.firstElementChild!; document.body.append(dialogs);
  const live=()=>root.isConnected && document.getElementById('tts-settings-root')===root;
  const unbindActivation=bindAudioActivation(()=>dialog('audio-unlock-dialog'));
  on('audio-unlock-confirm', async () => { const activated=confirmAudioActivation(); dialog('audio-unlock-dialog',false); await activated; });
  on('audio-unlock-cancel', () => { cancelAudioActivation(); dialog('audio-unlock-dialog',false); });
  el<HTMLDialogElement>('audio-unlock-dialog').addEventListener('cancel',cancelAudioActivation);
  const observer = new MutationObserver(() => { if (!live()) { unbindActivation(); document.removeEventListener('omnitts-library',refresh); characters.dispose(); dialogs.remove(); observer.disconnect(); } });
  // The settings iframe owns these normal DOM dialogs; chat markup is module-owned.
  // BGM·효과음 share this root: their panels and tabs exist before the tab buttons bind.
  injectSoundPanels(root);
  for (const b of el('tts-dialogs').querySelectorAll<HTMLElement>('[data-close]')) b.addEventListener('click',event => { event.preventDefault(); dialog(b.dataset.close!,false); });
  const tab = (name: string) => { for (const panel of root.querySelectorAll<HTMLElement>('section.panel')) panel.hidden = panel.id !== name; for (const b of root.querySelectorAll<HTMLElement>('[data-tts-tab]')) { const active = b.dataset.ttsTab === name; b.setAttribute('aria-selected',String(active)); b.tabIndex = active ? 0 : -1; } };
  for (const b of root.querySelectorAll<HTMLElement>('[data-tts-tab]')) b.addEventListener('click', () => tab(b.dataset.ttsTab!)); tab([...root.querySelectorAll<HTMLElement>('section.panel')].find(panel => !panel.hidden)?.id || 'tts-settings');
  attachTtsHelp(root); bindTtsSettings(); bindTtsConnectionTests();
  on('tts-settings-export', () => download(exportableTtsSettings(ttsData().settings), 'omnitts-settings.json'));
  on('tts-settings-import', () => input('tts-settings-file-input').click());
  el('tts-settings-file-input')?.addEventListener('change', () => run(async () => {
    const file = input('tts-settings-file-input').files?.[0]; if (!file) return;
    await importTtsSettings(await readJson(file)); input('tts-settings-file-input').value = '';
    // Rebuild the tab from the loaded values; API keys on this device are kept.
    const holder = document.createElement('div'); holder.innerHTML = ttsSettingsHtml(); const fresh = holder.firstElementChild as HTMLElement;
    fresh.style.cssText = root.style.cssText; root.replaceWith(fresh); await mountTts(); notify('TTS 설정을 불러왔습니다 · API 키는 그대로입니다.');
  })); const library = new TtsLibrary(tab); library.bind(); const characters = new TtsCharacters(library,tab);
  const refresh = () => { if(live()){library.render(); characters.render();} };
  observer.observe(document.body,{childList:true,subtree:true});
  await characters.bind(live); if(!live())return;
  bindTtsLlmActions(refresh);
  // 「LLM으로 추가」 and 「LLM 정리 요청」 are one request now: add, rename, refile and retag.
  for (const id of ['bulk-voice', 'organize-voices']) el(id)?.setAttribute('hidden', '');
  placeLlmCommandButton('voice-llm-command', el('add-voice'), () => voiceLlmCommand(refresh));
  document.addEventListener('omnitts-library',refresh);
  await mountSound(root, tab, live); if(!live())return;
  if(ttsData().settings.enabled)promptInitialAudioActivation();
}
