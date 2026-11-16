import type { TtsSettings } from '../core/tts-types';
import { GEMINI_PREBUILT_NAMES } from '../domain/tts/gemini-voices';
import { GEMINI_DEFAULT_MODEL, parseServiceAccount } from '../providers/tts/gemini';
import { ttsData, updateTtsSettings } from '../storage/tts-store';
import { ensureGeminiVoiceList } from '../services/gemini-voices';
import { el, esc, on, set, text, val } from './common';

/**
 * 모델 설정's Gemini TTS fields: by an AI Studio key, or a Vertex AI service account's JSON key (pasted, or read from
 * its file). Standing where Fish's fields do while Gemini is the engine (irodori.ts shows one engine's at a time).
 */
const MODELS = ['gemini-3.8-flash-tts', 'gemini-3.8-flash-lite-tts', 'gemini-3.1-flash-tts-preview', 'gemini-2.5-flash-preview-tts', 'gemini-2.5-pro-preview-tts'];
export const GEMINI_GROUP = `<div class="group" id="tts-gemini-group" hidden><h3>Gemini TTS · 음성 생성</h3><div class="fields">`
  + `<label class="field full"><span>연결 방식</span><select id="tts-gemini-via" aria-label="Gemini 연결 방식"><option value="studio">AI Studio · API 키</option><option value="vertex">Vertex AI · 서비스 계정 JSON</option></select></label>`
  + `<label class="field full" id="tts-gemini-key-wrap"><span>Gemini API Key (AI Studio)</span><input id="tts-gemini-key" type="password" autocomplete="off" placeholder="AIza…" aria-label="Gemini API Key"></label>`
  + `<div class="field full" id="tts-gemini-vertex-wrap" hidden><span>서비스 계정 JSON · Vertex AI 사용자 권한</span><textarea id="tts-gemini-sa" rows="4" spellcheck="false" autocomplete="off" placeholder='{"type": "service_account", "project_id": …}' aria-label="Vertex 서비스 계정 JSON"></textarea>`
  + `<div class="actions" style="margin-top:6px"><button type="button" id="tts-gemini-sa-file">JSON 파일에서 읽기</button><input type="file" id="tts-gemini-sa-input" accept=".json,application/json" hidden><small id="tts-gemini-sa-status" role="status"></small></div></div>`
  + `<label class="field" id="tts-gemini-location-wrap" hidden><span>Vertex 지역</span><input id="tts-gemini-location" maxlength="40" placeholder="global" aria-label="Vertex 지역"></label>`
  + `<label class="field"><span>모델</span><input id="tts-gemini-model" list="tts-gemini-models" maxlength="80" placeholder="${GEMINI_DEFAULT_MODEL}" aria-label="Gemini TTS 모델"><datalist id="tts-gemini-models">${MODELS.map(m => `<option value="${m}"></option>`).join('')}</datalist></label>`
  + `<label class="field"><span>기본 목소리</span><input id="tts-gemini-voice" list="tts-gemini-voice-list" maxlength="200" placeholder="Kore" aria-label="Gemini 기본 목소리"><datalist id="tts-gemini-voice-list">${GEMINI_PREBUILT_NAMES.map(n => `<option value="${n}"></option>`).join('')}</datalist></label>`
  + `<label class="field"><span>동시 생성 수</span><input id="tts-gemini-concurrency" type="number" min="1" max="5" step="1" aria-label="Gemini 동시 생성 수"></label>`
  + `<label class="field"><span>캐릭터 특징을 말투에 반영</span><select id="tts-gemini-persona" aria-label="캐릭터 특징을 말투에 반영"><option value="1">켜기 · 같은 목소리도 다르게</option><option value="0">끄기</option></select></label>`
  + `<label class="field"><span>새 화자의 목소리</span><select id="tts-gemini-design" aria-label="새 화자의 목소리"><option value="0">목록에서 고르기</option><option value="1">화자마다 새로 만들기</option></select></label>`
  + `</div><div class="actions" style="margin-top:10px"><button type="button" id="tts-test-gemini">연결 테스트</button><span id="tts-test-gemini-result" role="status" style="font-size:12px;overflow-wrap:anywhere"></span></div></div><hr id="tts-gemini-rule" hidden>`;

export function bindGeminiSettings(): void {
  if (!el('tts-gemini-group')) return;
  const s = ttsData().settings.gemini;
  const show = () => {
    const vertex = val('tts-gemini-via') === 'vertex';
    el('tts-gemini-key-wrap').hidden = vertex; el('tts-gemini-vertex-wrap').hidden = !vertex; el('tts-gemini-location-wrap').hidden = !vertex;
  };
  // What the JSON is, said under it (never the key itself): whose account and which project, or why it does not read.
  const account = () => {
    const raw = val('tts-gemini-sa').trim(), parsed = raw ? parseServiceAccount(raw) : null;
    text('tts-gemini-sa-status', !raw ? '' : parsed ? `${parsed.client_email} · 프로젝트 ${parsed.project_id}` : '서비스 계정 JSON이 아닙니다. 받은 JSON 파일 내용을 그대로 넣어 주세요.');
  };
  set('tts-gemini-via', s.via); set('tts-gemini-key', s.key); set('tts-gemini-sa', s.serviceAccountJson); set('tts-gemini-location', s.location);
  set('tts-gemini-model', s.model); set('tts-gemini-voice', s.voice); set('tts-gemini-concurrency', s.concurrency);
  set('tts-gemini-persona', s.persona ? '1' : '0'); set('tts-gemini-design', s.design ? '1' : '0');
  show(); account();
  const read = (): TtsSettings['gemini'] => ({ via: val('tts-gemini-via') === 'vertex' ? 'vertex' : 'studio', key: val('tts-gemini-key').trim(), serviceAccountJson: val('tts-gemini-sa').trim(),
    location: val('tts-gemini-location').trim() || 'global', model: val('tts-gemini-model').trim() || GEMINI_DEFAULT_MODEL, voice: val('tts-gemini-voice').trim(), concurrency: Number(val('tts-gemini-concurrency')) || 3,
    persona: val('tts-gemini-persona') !== '0', design: val('tts-gemini-design') === '1', listed: ttsData().settings.gemini.listed });
  for (const id of ['tts-gemini-via', 'tts-gemini-key', 'tts-gemini-sa', 'tts-gemini-location', 'tts-gemini-model', 'tts-gemini-voice', 'tts-gemini-concurrency', 'tts-gemini-persona', 'tts-gemini-design'])
    on(id, async () => { show(); account(); await updateTtsSettings({ gemini: read() }); void ensureGeminiVoiceList(); }, 'change');
  el('tts-gemini-sa')?.addEventListener('input', account);
  on('tts-gemini-sa-file', () => el<HTMLInputElement>('tts-gemini-sa-input')?.click());
  el('tts-gemini-sa-input')?.addEventListener('change', () => void (async () => {
    const node = el<HTMLInputElement>('tts-gemini-sa-input'), file = node?.files?.[0];
    if (!node || !file) return;
    node.value = '';
    if (file.size > 64 * 1024) { text('tts-gemini-sa-status', '서비스 계정 JSON 파일이 너무 큽니다.'); return; }
    set('tts-gemini-sa', (await file.text()).trim()); account();
    await updateTtsSettings({ gemini: read() }); void ensureGeminiVoiceList();
  })().catch(error => text('tts-gemini-sa-status', esc(String((error as Error)?.message || error)))));
}
