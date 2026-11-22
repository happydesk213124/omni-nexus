import type { TtsSettings } from '../core/tts-types';
import { ELEVEN_DEFAULT_MODEL, ELEVEN_MODELS, elevenTagModel } from '../providers/tts/eleven';
import { ensureElevenVoiceList } from '../services/eleven-voices';
import { ttsData, updateTtsSettings } from '../storage/tts-store';
import { el, esc, on, set, text, val } from './common';

/**
 * 모델 설정's ElevenLabs fields: an API key, the model, the voice a card with none of its own speaks with. Standing
 * where Fish's fields do while ElevenLabs is the engine (irodori.ts shows one engine's at a time).
 */
export const ELEVEN_GROUP = `<div class="group" id="tts-eleven-group" hidden><h3>ElevenLabs · 음성 생성</h3><div class="fields">`
  + `<label class="field full"><span>ElevenLabs API Key</span><input id="tts-eleven-key" type="password" autocomplete="off" placeholder="sk_…" aria-label="ElevenLabs API Key"></label>`
  + `<label class="field"><span>모델</span><input id="tts-eleven-model" list="tts-eleven-models" maxlength="80" placeholder="${ELEVEN_DEFAULT_MODEL}" aria-label="ElevenLabs 모델"><datalist id="tts-eleven-models">${ELEVEN_MODELS.map(([id, label]) => `<option value="${id}" label="${label}"></option>`).join('')}</datalist></label>`
  + `<label class="field"><span>기본 목소리 (voice ID)</span><input id="tts-eleven-voice" list="tts-eleven-voice-list" maxlength="60" placeholder="ElevenLabs 목소리 탭에서 고를 수 있습니다" aria-label="ElevenLabs 기본 목소리"><datalist id="tts-eleven-voice-list"></datalist></label>`
  + `<label class="field"><span>동시 생성 수</span><input id="tts-eleven-concurrency" type="number" min="1" max="5" step="1" aria-label="ElevenLabs 동시 생성 수"></label>`
  + `<small id="tts-eleven-model-note" class="field full" role="status"></small>`
  + `</div><div class="actions" style="margin-top:10px"><button type="button" id="tts-test-elevenlabs">연결 테스트</button><span id="tts-test-elevenlabs-result" role="status" style="font-size:12px;overflow-wrap:anywhere"></span></div></div><hr id="tts-eleven-rule" hidden>`;

/** The voices read in, offered by name under the default-voice field. */
export function fillElevenVoiceChoices(): void {
  const list = el('tts-eleven-voice-list');
  if (list) list.innerHTML = ttsData().elevenVoices.slice(0, 500).map(v => `<option value="${esc(v.fishId)}" label="${esc(v.name)}"></option>`).join('');
}
export function bindElevenSettings(): void {
  if (!el('tts-eleven-group')) return;
  const s = ttsData().settings.eleven;
  // What the model does with 대사 중간 감정 태그, said under it: the one thing that differs between the models here.
  const note = () => {
    const model = val('tts-eleven-model').trim() || ELEVEN_DEFAULT_MODEL;
    text('tts-eleven-model-note', elevenTagModel(model)
      ? `${model}: 대사 안 [감정 태그]와 기본 억양을 그대로 보내 연기합니다.`
      : `${model}: 감정 태그를 소리 내어 읽는 모델이라, 태그와 억양은 빼고 대사만 보냅니다. 감정 연기는 eleven_v3 · eleven_v4 계열에서 됩니다.`);
  };
  set('tts-eleven-key', s.key); set('tts-eleven-model', s.model); set('tts-eleven-voice', s.voice); set('tts-eleven-concurrency', s.concurrency);
  fillElevenVoiceChoices(); note();
  const read = (): TtsSettings['eleven'] => ({ key: val('tts-eleven-key').trim(), model: val('tts-eleven-model').trim() || ELEVEN_DEFAULT_MODEL, voice: val('tts-eleven-voice').trim(),
    concurrency: Number(val('tts-eleven-concurrency')) || 3, listed: ttsData().settings.eleven.listed });
  for (const id of ['tts-eleven-key', 'tts-eleven-model', 'tts-eleven-voice', 'tts-eleven-concurrency'])
    on(id, async () => {
      note(); await updateTtsSettings({ eleven: read() });
      // A key just entered: the account's voices, once (the first one becomes the default voice when none is chosen).
      await ensureElevenVoiceList(); set('tts-eleven-voice', ttsData().settings.eleven.voice); fillElevenVoiceChoices();
    }, 'change');
  el('tts-eleven-model')?.addEventListener('input', note);
}
