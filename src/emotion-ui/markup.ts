import { BASE_EXPRESSIONS, DEFAULT_POSE } from '../domain/emotion/emotions';

/**
 * 뷰어 및 감정 에셋: three tabs like BGM·효과음's, the same classes. 뷰어 is the
 * viewer's own screen, 배경 its stage (places and the backgrounds drawn for them),
 * 감정 에셋 the faces. A row's small line is live status only; what a row does opens
 * with the settings head's 「?」 (help.ts).
 */
export const EMOTION_TABS = [['emo-viewer', '뷰어'], ['emo-bg', '배경'], ['emo-assets', '감정 에셋']] as const;
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const sw = (id: string, label: string) => `<label class="switch"><input type="checkbox" id="${id}" aria-label="${label}"></label>`;
const row = (title: string, control: string, status = '') => `<div class="row"><div class="copy"><b>${title}</b>${status ? `<small>${status}</small>` : ''}</div>${control}</div>`;
const select = (id: string, label: string, options: ReadonlyArray<readonly [string, string]>) => `<select id="${id}" aria-label="${label}">${options.map(([value, text]) => `<option value="${value}">${text}</option>`).join('')}</select>`;

const VIEWER_PANEL = `<section class="panel" id="emo-viewer" role="tabpanel" hidden><div class="tts-settings-columns">
<div class="tts-settings-column"><div class="group"><h3>화면</h3>
${row('글자 크기', select('emo-size', '글자 크기', [['small', '작게'], ['normal', '보통'], ['large', '크게'], ['xlarge', '아주 크게']]))}
${row('글자 속도', select('emo-speed', '글자 속도', [['instant', '즉시'], ['fast', '빠르게'], ['normal', '보통'], ['slow', '느리게']]))}
</div></div>
<div class="tts-settings-column"><div class="group"><h3>장면</h3><div class="fields">
<label class="field full"><span>장면으로 띄우지 않을 단어 · 쉼표로 구분</span><textarea id="emo-skip" rows="3" maxlength="2000" placeholder="예: 상태창, OOC, 시스템"></textarea></label>
</div></div></div>
</div></section>`;

const BACKGROUND_PANEL = `<section class="panel" id="emo-bg" role="tabpanel" hidden><div class="tts-settings-columns">
<div class="tts-settings-column"><div class="group"><h3>배경</h3>
${row('장소 배경', sw('emo-places', '장소 배경'))}
<fieldset class="snd-gate" id="emo-bg-gate">
${row('장소 태그 쓰게 하기 · ⚛️ omni place', sw('emo-place-module', '장소 태그 쓰게 하기'), '<span id="emo-place-module-status" role="status"></span>')}
${row('장소 없는 메시지', select('emo-bg-pick', '장소 없는 메시지', [['auto', '자동 · JEV → 임베딩'], ['jev', 'JEV'], ['embedding', '임베딩'], ['off', '고르지 않음 · 작가노트 장소']]))}
</fieldset></div></div>
<div class="tts-settings-column"><div class="group"><h3>이 봇의 배경 <small id="emo-bg-count"></small></h3>
<div id="emo-bg-list" class="emo-bg-grid" role="list"></div>
<details class="emo-bg-samples"><summary>샘플 장소 · 눌러서 미리 그리기</summary><div id="emo-bg-samples" class="emo-chips"></div></details>
</div></div>
</div></section>`;

const FACES_PANEL = `<section class="panel" id="emo-assets" role="tabpanel" hidden><div class="tts-settings-columns">
<div class="tts-settings-column"><div class="group"><h3>감정 에셋</h3>
${row('감정 에셋 사용', sw('emo-enabled', '감정 에셋 사용'))}
<fieldset class="snd-gate" id="emo-faces-gate">
${row('봇에 있는 기존 에셋 쓰기', sw('emo-existing', '봇에 있는 기존 에셋 쓰기'))}
${row('없는 그림 자동 생성', sw('emo-auto', '없는 그림 자동 생성'))}
</fieldset></div>
<div class="group"><h3>그리기 · 태그로만</h3><div class="fields">
<label class="field"><span>모델</span><select id="emo-family"><option value="v5">NAI V5</option><option value="v4">NAI V4.5</option></select></label>
<label class="field"><span>투명 배경 (V5)</span><select id="emo-transparent"><option value="1">투명</option><option value="0">흰 배경</option></select></label>
<label class="field"><span>가로</span><input id="emo-width" type="number" min="512" max="1600" step="64"></label>
<label class="field"><span>세로</span><input id="emo-height" type="number" min="512" max="1600" step="64"></label>
<label class="field full"><span>선행 프롬프트</span><textarea id="emo-prefix" rows="2" maxlength="2000"></textarea></label>
<label class="field full"><span>자세 태그 · 비우면 기본</span><input id="emo-pose" maxlength="600" placeholder="${esc(DEFAULT_POSE)}"></label>
<label class="field full"><span>후행 프롬프트</span><textarea id="emo-suffix" rows="2" maxlength="2000"></textarea></label>
</div></div></div>
<div class="tts-settings-column"><div class="group"><h3>이 봇의 캐릭터</h3><div id="emo-people" class="emo-people" role="list"></div></div>
<div class="group"><h3>감정 표 · 표정 태그</h3><div id="emo-faces" class="emo-faces">${BASE_EXPRESSIONS.map(e => `<label class="emo-face-row"><span><b>${esc(e.label)}</b><small>${esc(e.key)} · ${esc(e.words.slice(0, 5).join(', '))}</small></span><input id="emo-face-${e.key}" data-face="${e.key}" maxlength="400" placeholder="${esc(e.tags)}"></label>`).join('')}</div>
<div class="fields"><label class="field full"><span>단어 더하기 · 한 줄에 하나 (예: pouting=sad)</span><textarea id="emo-words" rows="3" maxlength="4000"></textarea></label></div></div></div>
</div></section>`;

export const EMOTION_PANEL = VIEWER_PANEL + BACKGROUND_PANEL + FACES_PANEL;

/** The character sheet's view switch and its 감정 에셋 section. */
export const EMOTION_SHEET_SWITCH = '<div class="emo-sheet-switch" role="tablist"><button type="button" role="tab" data-emo-tab="voice" aria-selected="true">음성</button><button type="button" role="tab" data-emo-tab="faces" aria-selected="false">감정 에셋</button></div>';
export const EMOTION_SHEET = '<div id="emo-char-section"><p id="emo-char-looks" class="emo-looks"></p><div class="actions"><button type="button" id="emo-char-make-seen">본 감정 모두 만들기</button><button type="button" id="emo-char-make-all">기본 표정 전부 만들기</button><small id="emo-char-status" role="status"></small></div><div id="emo-char-grid" class="emo-grid"></div></div>';

export const EMOTION_CSS = `
#emo-bg .emo-bg-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(132px,1fr));gap:8px}
#emo-bg .emo-bg-tile{display:flex;flex-direction:column;gap:4px;min-width:0}
#emo-bg .emo-bg-pic{aspect-ratio:1216/832;border-radius:8px;border:1px solid #ffffff18;background:#0b0e14 center/cover no-repeat;display:flex;align-items:center;justify-content:center;font-size:11px;opacity:.9}
#emo-bg .emo-bg-pic[data-busy="1"]{outline:2px solid #22c55e;outline-offset:-2px}
#emo-bg .emo-bg-tile small{font-size:11px;opacity:.75;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#emo-bg .emo-bg-samples{margin-top:10px}
#emo-bg .emo-bg-samples summary{cursor:pointer;opacity:.85;min-height:32px;display:flex;align-items:center}
#emo-bg .emo-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
#emo-bg .emo-chips button{min-height:30px;padding:4px 10px;font-size:12px;border-radius:999px}
#emo-bg .emo-chips button[data-made="1"]{border-color:#22c55e88;opacity:.6}
#emo-bg h3 small{font-weight:400;opacity:.6;margin-left:6px}
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
