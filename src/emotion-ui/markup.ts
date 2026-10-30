import { BASE_EXPRESSIONS, DEFAULT_POSE } from '../domain/emotion/emotions';

/**
 * TTS · 감정 에셋 page and the character sheet's 「감정 에셋」 view. Same classes
 * as the TTS and BGM pages, so they look like the rest of the area.
 */
export const EMOTION_TABS = [['emo-assets', '감정 에셋']] as const;
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const sw = (id: string, label: string) => `<label class="switch"><input type="checkbox" id="${id}" aria-label="${label}"></label>`;
const row = (title: string, control: string, status = '') => `<div class="row"><div class="copy"><b>${title}</b>${status ? `<small>${status}</small>` : ''}</div>${control}</div>`;

export const EMOTION_PANEL = `<section class="panel" id="emo-assets" role="tabpanel" hidden><div class="tts-settings-columns">
<div class="tts-settings-column"><div class="group"><h3>감정 에셋</h3>
${row('감정 에셋 사용', sw('emo-enabled', '감정 에셋 사용'), '옴니 뷰어가 말하는 캐릭터의 표정 그림을 띄웁니다')}
${row('봇에 있는 기존 에셋 쓰기', sw('emo-existing', '봇에 있는 기존 에셋 쓰기'), '이름_감정 · 감정_이름 · 별칭 · 감정 이미지 · 켜진 모듈')}
${row('없는 감정 자동 생성', sw('emo-auto', '없는 감정 자동 생성'), '뷰어에 필요한 표정만 · 기본 표정을 먼저 보여주고 다 되면 교체 · NAI가 쉴 때 다음 답장 것을 미리(무료 생성일 때만)')}
${row('장소 배경 만들기', sw('emo-places', '장소 배경 만들기'), '답장 맨 앞 캐스트 블록의 장소로 사람 없는 배경을 만들어 뷰어 배경으로 씁니다')}
</div>
<div class="group"><h3>그리기 · LLM 없이 태그로만</h3><div class="fields">
<label class="field"><span>모델</span><select id="emo-family"><option value="v5">NAI V5</option><option value="v4">NAI V4.5</option></select></label>
<label class="field"><span>투명 배경 (V5)</span><select id="emo-transparent"><option value="1">투명</option><option value="0">흰 배경</option></select></label>
<label class="field"><span>가로</span><input id="emo-width" type="number" min="512" max="1600" step="64"></label>
<label class="field"><span>세로</span><input id="emo-height" type="number" min="512" max="1600" step="64"></label>
<label class="field full"><span>선행 프롬프트</span><textarea id="emo-prefix" rows="2" maxlength="2000"></textarea></label>
<label class="field full"><span>자세 태그 · 비우면 기본</span><input id="emo-pose" maxlength="600" placeholder="${esc(DEFAULT_POSE)}"></label>
<label class="field full"><span>후행 프롬프트</span><textarea id="emo-suffix" rows="2" maxlength="2000"></textarea></label>
</div><small>외형은 삽화 캐릭터 탭의 태그를 그대로 씁니다(없으면 봇 에셋 메타데이터). 스타일 프리셋은 지금 켜진 것을 씁니다.</small></div></div>
<div class="tts-settings-column"><div class="group"><h3>이 봇의 캐릭터</h3><div id="emo-people" class="emo-people" role="list"></div></div>
<div class="group"><h3>감정 표 · 표정 태그</h3><div id="emo-faces" class="emo-faces">${BASE_EXPRESSIONS.map(e => `<label class="emo-face-row"><span><b>${esc(e.label)}</b><small>${esc(e.key)} · ${esc(e.words.slice(0, 5).join(', '))}</small></span><input id="emo-face-${e.key}" data-face="${e.key}" maxlength="400" placeholder="${esc(e.tags)}"></label>`).join('')}</div>
<label class="field full"><span>단어 더하기 · 한 줄에 하나 (예: pouting=sad)</span><textarea id="emo-words" rows="3" maxlength="4000"></textarea></label></div></div>
</div></section>`;

/** The character sheet's view switch and its 감정 에셋 section. */
export const EMOTION_SHEET_SWITCH = '<div class="emo-sheet-switch" role="tablist"><button type="button" role="tab" data-emo-tab="voice" aria-selected="true">음성</button><button type="button" role="tab" data-emo-tab="faces" aria-selected="false">감정 에셋</button></div>';
export const EMOTION_SHEET = '<div id="emo-char-section"><p id="emo-char-looks" class="emo-looks"></p><div class="actions"><button type="button" id="emo-char-make-seen">본 감정 모두 만들기</button><button type="button" id="emo-char-make-all">기본 표정 전부 만들기</button><small id="emo-char-status" role="status"></small></div><div id="emo-char-grid" class="emo-grid"></div></div>';

export const EMOTION_CSS = `
#emo-assets .emo-faces{display:grid;gap:6px}
#emo-assets .emo-face-row{display:grid;grid-template-columns:minmax(110px,30%) 1fr;gap:8px;align-items:center}
#emo-assets .emo-face-row span{display:flex;flex-direction:column;min-width:0}
#emo-assets .emo-face-row small{opacity:.6;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#emo-assets .emo-people{display:grid;gap:6px}
#emo-assets .emo-person{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 8px;border:1px solid #ffffff18;border-radius:8px}
#emo-assets .emo-person small{opacity:.7}
.emo-sheet-switch{display:flex;gap:4px;margin:0 0 10px}
.emo-sheet-switch button{flex:1;min-height:34px}
.emo-sheet-switch button[aria-selected="true"]{border-color:#7132f5;background:#7132f533}
#character-form[data-emo-view="faces"] .editor-scroll>:not(.emo-sheet-switch):not(#emo-char-section){display:none!important}
#character-form:not([data-emo-view="faces"]) #emo-char-section{display:none}
#emo-char-section .emo-looks{font-size:12px;opacity:.8;margin:0 0 8px;word-break:break-word}
.emo-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(104px,1fr));gap:8px;margin-top:10px}
.emo-tile{display:flex;flex-direction:column;gap:4px;padding:6px;border:1px solid #ffffff18;border-radius:10px;background:#ffffff08}
.emo-tile[data-seen="1"]{border-color:#ec489966}
.emo-tile .emo-pic{aspect-ratio:832/1216;border-radius:8px;background:#0b0e14 center/contain no-repeat;display:flex;align-items:center;justify-content:center;font-size:11px;opacity:.9}
.emo-tile .emo-pic[data-busy="1"]{outline:2px solid #22c55e;outline-offset:-2px}
.emo-tile b{font-size:12px}
.emo-tile small{font-size:10px;opacity:.7}
.emo-tile button{min-height:30px;font-size:12px}
`;
