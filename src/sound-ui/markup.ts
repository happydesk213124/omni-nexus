import { SOUND_PANELS, SOUND_TABS } from './panels';
import { SOUND_PAGE_OPENS, SOUND_PAGE_TABS, markSoundNav, soundFocus, soundPage } from './page';
import { SOUND_LIST_CSS, SOUND_PAGE_CSS, voiceListCssFor } from './style';
import layout from '../tts-ui/layout.json';
import { EMBEDDING_PROVIDERS } from '../providers/embedding/client';
import { attachSoundHelp } from './help';
import { addEmotionStructure, emotionStyleText } from '../emotion-ui/mount';

/**
 * The embedding behind 「자동」 matching (after JEV) and the 「임베딩」 setting. An
 * OpenRouter key left empty borrows the JEV key, so most users set nothing here.
 */
const EMBED_GROUP = '<div class="group" id="snd-embed-group"><h3>임베딩 · 효과음·BGM 고르기</h3><div class="fields">'
  + `<label class="field"><span>제공자</span><select id="snd-embed-provider">${EMBEDDING_PROVIDERS.map(p => `<option value="${p.value}">${p.label}</option>`).join('')}</select></label>`
  + '<label class="field"><span>모델</span><input id="snd-embed-model" maxlength="200" autocomplete="off"></label>'
  + '<label class="field full"><span>API Key</span><input type="password" id="snd-embed-key" autocomplete="off"></label>'
  + '<label class="field full"><span>주소</span><input id="snd-embed-endpoint" maxlength="500" autocomplete="off"></label>'
  + '<div class="actions"><button type="button" id="snd-embed-test">연결 테스트</button><small id="snd-embed-status" role="status"></small></div>'
  // 맞춰 보기: what the embedding would play for a word in a scene, with scores, nothing played or learned.
  + '<label class="field"><span>맞춰 보기 · 효과음 단어</span><input id="snd-embed-try-word" maxlength="40" placeholder="찔걱" autocomplete="off"></label>'
  + '<label class="field full"><span>앞뒤 문장 (비워도 됩니다)</span><textarea id="snd-embed-try-story" rows="2" maxlength="700" placeholder="젖은 손이 미끄러졌다."></textarea></label>'
  + '<div class="actions"><button type="button" id="snd-embed-try">맞춰 보기</button><small id="snd-embed-try-result" role="status"></small></div></div></div>';

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
  models?.insertAdjacentHTML('beforeend', '<div class="group" id="snd-eleven-group"><h3>ElevenLabs · 효과음·BGM 생성</h3><div class="fields"><label class="field full"><span>ElevenLabs API Key</span><input type="password" id="snd-eleven-key" autocomplete="off"></label></div></div>' + EMBED_GROUP);
  attachSoundHelp(root);
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
  const focus = soundFocus()?.panel;
  const open = openPanel && allowed.includes(openPanel) ? openPanel : focus && allowed.includes(focus) ? focus : SOUND_PAGE_OPENS[page] ?? allowed[0]!;
  for (const b of root.querySelectorAll<HTMLElement>('[data-tts-tab]')) {
    const tab = b.dataset.ttsTab || '';
    b.hidden = !allowed.includes(tab);
    b.setAttribute('aria-selected', String(tab === open)); b.tabIndex = tab === open ? 0 : -1;
  }
  for (const panel of root.querySelectorAll<HTMLElement>('section.panel')) panel.hidden = panel.id !== open;
  // TTS 캐릭터 is a page of TTS 설정's: its switch and notice stay with it (a character's fields wait on TTS on).
  const tts = page === 'tts' || page === 'people';
  const toggle = (selector: string, show: boolean) => { const node = root.querySelector<HTMLElement>(selector); if (node) node.hidden = !show; };
  toggle('#tts-controls', tts); toggle('#tts-power-controls', tts); toggle('#sound-controls', !tts);
  if (!tts) toggle('#tts-off-notice', false);
}

const SOUND_STYLE = () => SOUND_PAGE_CSS + voiceListCssFor(layout.css) + SOUND_LIST_CSS + emotionStyleText();
/** The TTS area's markup for the open page, with its styles, ready before any script runs. */
export function soundAwareHtml(html: string): string {
  if (typeof document === 'undefined') return html;
  const box = document.createElement('template'); box.innerHTML = html;
  const root = box.content.querySelector<HTMLElement>('#tts-settings-root');
  if (!root) return html;
  addSoundStructure(root);
  addEmotionStructure(root);
  markSoundPage(root);
  // Both style sheets travel with the markup; the mount refreshes them in place.
  root.insertAdjacentHTML('afterbegin', `<style id="omnitts-settings-style">${layout.css}</style><style id="omnisound-page-style">${SOUND_STYLE()}</style>`);
  return box.innerHTML;
}
export const soundStyleText = SOUND_STYLE;

/**
 * Switches an already mounted root to the current page, keeping its open panel when it belongs there. Chosen
 * from the menu, the page opens on its own tab instead: TTS 캐릭터 on 캐릭터 even after TTS 설정's 음성 목록.
 */
export function applySoundPage(root: HTMLElement, tab: (name: string) => void, chosen = false): void {
  const open = chosen ? undefined : [...root.querySelectorAll<HTMLElement>('section.panel')].find(panel => !panel.hidden)?.id;
  markSoundPage(root, open);
  tab([...root.querySelectorAll<HTMLElement>('section.panel')].find(panel => !panel.hidden)!.id);
  markSoundNav('curation');
}
