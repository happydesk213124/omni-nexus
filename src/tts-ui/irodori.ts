import type { TtsSettings } from '../core/tts-types';
import { ttsData, updateTtsSettings } from '../storage/tts-store';
import { listIrodoriVoices } from '../providers/tts/irodori';
import { el, esc, on, set, text, val } from './common';

/**
 * 모델 설정's engine choice and the Irodori server's fields. Added to the page here, as the BGM·효과음 panels are:
 * the tab's own markup is generated from the review layout (tools/extract-tts-ui.mjs) and stays as it is.
 */
const ENGINE_GROUP = `<div class="group" id="tts-engine-group"><h3>TTS 엔진</h3><div class="fields"><label class="field full"><span>음성을 만드는 곳</span><select id="tts-engine" aria-label="TTS 엔진"><option value="fish">Fish Audio</option><option value="irodori">Irodori TTS (내 서버)</option></select></label></div></div><hr>`;
const IRODORI_GROUP = `<div class="group" id="tts-irodori-group" hidden><h3>Irodori TTS · 음성 생성</h3><div class="fields">`
  + `<label class="field full"><span>서버 주소</span><input id="tts-irodori-url" type="url" placeholder="http://127.0.0.1:8088" aria-label="Irodori 서버 주소"></label>`
  + `<label class="field full"><span>API Key (서버에 설정한 경우만)</span><input id="tts-irodori-key" type="password" autocomplete="off" placeholder="비워 두면 보내지 않습니다" aria-label="Irodori API Key"></label>`
  + `<label class="field"><span>목소리 (서버의 voice ID)</span><input id="tts-irodori-voice" list="tts-irodori-voices" maxlength="200" placeholder="예: sample" aria-label="Irodori 목소리 ID"><datalist id="tts-irodori-voices"></datalist></label>`
  + `<label class="field"><span>모델 이름</span><input id="tts-irodori-model" maxlength="80" placeholder="irodori-tts" aria-label="Irodori 모델 이름"></label>`
  + `<label class="field"><span>출력 형식</span><select id="tts-irodori-format" aria-label="Irodori 출력 형식"><option value="mp3">mp3 (서버에 FFmpeg 필요)</option><option value="wav">wav</option></select></label>`
  + `<label class="field"><span>동시 생성 수</span><input id="tts-irodori-concurrency" type="number" min="1" max="5" step="1" aria-label="Irodori 동시 생성 수"></label>`
  + `</div><div class="actions" style="margin-top:10px"><button type="button" id="tts-irodori-list">목소리 불러오기</button><button type="button" id="tts-test-irodori">연결 테스트</button><span id="tts-test-irodori-result" role="status" style="font-size:12px;overflow-wrap:anywhere"></span></div></div><hr id="tts-irodori-rule" hidden>`;

/** Before the tab's fields are bound: the engine choice heads the tab, Irodori's fields stand where Fish's do. */
export function injectIrodoriSettings(root: HTMLElement): void {
  const fish = root.querySelector<HTMLElement>('#tts-fish-via')?.closest<HTMLElement>('.group');
  if (!fish || root.querySelector('#tts-engine')) return;
  fish.insertAdjacentHTML('beforebegin', ENGINE_GROUP + IRODORI_GROUP);
}

export function bindIrodoriSettings(): void {
  if (!el('tts-engine')) return;
  const s = ttsData().settings, fish = el('tts-fish-via')?.closest<HTMLElement>('.group');
  // One engine's fields at a time: the rule after Fish's group goes with it.
  const show = () => {
    const irodori = val('tts-engine') === 'irodori';
    el('tts-irodori-group').hidden = !irodori; el('tts-irodori-rule').hidden = !irodori;
    if (fish) { fish.hidden = irodori; if (fish.nextElementSibling?.tagName === 'HR') (fish.nextElementSibling as HTMLElement).hidden = irodori; }
  };
  set('tts-engine', s.engine); set('tts-irodori-url', s.irodori.url); set('tts-irodori-key', s.irodori.key); set('tts-irodori-voice', s.irodori.voice);
  set('tts-irodori-model', s.irodori.model); set('tts-irodori-format', s.irodori.format); set('tts-irodori-concurrency', s.irodori.concurrency);
  show();
  on('tts-engine', () => { show(); return updateTtsSettings({ engine: val('tts-engine') === 'irodori' ? 'irodori' : 'fish' }); }, 'change');
  const read = (): TtsSettings['irodori'] => ({ url: val('tts-irodori-url').trim(), key: val('tts-irodori-key'), voice: val('tts-irodori-voice').trim(), model: val('tts-irodori-model').trim() || 'irodori-tts',
    format: val('tts-irodori-format') === 'wav' ? 'wav' : 'mp3', concurrency: Number(val('tts-irodori-concurrency')) || 1 });
  for (const id of ['tts-irodori-url', 'tts-irodori-key', 'tts-irodori-voice', 'tts-irodori-model', 'tts-irodori-format', 'tts-irodori-concurrency']) on(id, () => updateTtsSettings({ irodori: read() }), 'change');
  on('tts-irodori-list', async () => {
    text('tts-test-irodori-result', '목소리 목록을 불러오는 중…');
    try {
      const ids = await listIrodoriVoices({ irodori: read() });
      el('tts-irodori-voices').innerHTML = ids.map(id => `<option value="${esc(id)}"></option>`).join('');
      // With none chosen yet, the first one is: the tab is usable straight away.
      if (ids.length && !val('tts-irodori-voice').trim()) { set('tts-irodori-voice', ids[0]); await updateTtsSettings({ irodori: read() }); }
      text('tts-test-irodori-result', ids.length ? `목소리 ${ids.length}개: ${ids.slice(0, 12).join(', ')}${ids.length > 12 ? ' …' : ''}` : '서버에 등록된 목소리가 없습니다. 서버의 voices 폴더에 참조 음성을 넣어 주세요.');
    } catch (error) { text('tts-test-irodori-result', String((error as Error)?.message || error)); }
  });
}
