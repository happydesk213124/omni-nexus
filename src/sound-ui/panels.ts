/**
 * BGM·효과음 pages. They reuse the TTS settings classes (groups, rows, voice
 * tiles, editor sheets) so the pages look like the rest of the TTS area, and
 * they sit outside #tts-controls so switching TTS off never disables them.
 */
const sw = (id: string, label: string) => `<label class="switch"><input type="checkbox" id="${id}" aria-label="${label}"></label>`;
// Explanations live in help.ts and open with the settings head's 「?」; a row's small line is live status only.
const row = (title: string, control: string, status = '') => `<div class="row"><div class="copy"><b>${title}</b>${status ? `<small>${status}</small>` : ''}</div>${control}</div>`;
const range = (id: string, label: string) => `<div class="control"><input id="${id}" type="range" min="0" max="100" aria-label="${label}"><output class="value" id="${id}-value"></output></div>`;
const matcher = (id: string) => `<select id="${id}" aria-label="고르는 방식"><option value="auto">자동 · 용어집 → JEV → 임베딩 → 글자</option><option value="tag">용어집·글자만 (무료)</option><option value="embedding">용어집 → 임베딩</option><option value="jev">용어집 → JEV</option><option value="llm">용어집 → LLM</option></select>`;

export const SOUND_TABS = [
  ['sound-settings', '설정'], ['sound-bgm', 'BGM 목록'], ['sound-sfx', '효과음 목록'], ['sound-glossary', '효과음 용어집'],
] as const;

/** Same structure and classes as the TTS voice list, so its rules (copied by id) apply. */
function library(kind: 'bgm' | 'sfx', title: string): string {
  const id = (part: string) => `snd-${kind}-${part}`;
  return `<section class="panel" id="sound-${kind}" role="tabpanel" hidden>
<div class="voice-command-bar"><div class="voice-search-wrap"><input id="${id('search')}" placeholder="이름·태그 검색 ( | 또는, &amp; 모두 )" aria-label="${title} 검색" maxlength="500"><button id="${id('search-clear')}" type="button" hidden aria-label="검색 비우기" title="검색 비우기">×</button></div>
<select id="${id('filter')}" aria-label="등록 방식 필터"><option value="all">전체</option><option value="url">주소</option><option value="asset">파일</option></select>
<select id="${id('sort')}" aria-label="${title} 정렬"><option value="added">추가순</option><option value="name">이름순</option><option value="size">크기순</option></select>
<span id="${id('count')}"></span><span class="badge" id="${id('total')}" hidden></span>
<div class="actions voice-tools"><button class="primary" id="${id('add')}">+ ${title}</button><details class="file-menu"><summary>파일 ⋯</summary><div><button id="${id('import')}">JSON 가져오기</button><button id="${id('export')}">JSON 내보내기</button><button id="${id('samples')}" title="기본 예제 중 목록에 없는 것만 더합니다">예제 불러오기</button></div></details></div>
<input type="file" id="${id('file')}" accept=".json,application/json" hidden></div>
<div class="voice-explorer"><aside class="voice-folders"><div class="folder-heading"><b>폴더</b><button id="${id('folder-toggle')}" type="button" aria-expanded="false">폴더 ▾</button><button id="${id('folder-add')}" title="폴더 만들기" aria-label="폴더 만들기">＋</button></div>
<nav id="${id('folders')}" aria-label="${title} 폴더"></nav><button id="${id('folder-edit')}" disabled>폴더 관리</button></aside>
<div class="voice-browser"><div class="voice-selection-bar"><button id="${id('multi')}" type="button" aria-pressed="false">다중선택</button><span id="${id('selected-count')}" role="status">선택 없음</span>
<button id="${id('select-all')}">전체 선택</button><button id="${id('clear')}" disabled>선택 해제</button><button id="${id('edit')}" disabled>수정</button>${kind === 'bgm' ? `<button id="${id('prefetch')}" disabled title="선택한 곡을 이 기기에 미리 받아 둡니다">미리 받기</button>` : ''}<button id="${id('move')}" disabled>폴더 이동</button><button id="${id('delete')}" class="danger" disabled>삭제</button></div>
<div id="${id('list')}" class="voice-list" role="listbox" aria-label="${title} 선택" aria-multiselectable="true"></div></div></div></section>`;
}

export const SOUND_PANELS = `<div class="workspace" id="sound-controls">
<section class="panel" id="sound-settings" role="tabpanel" hidden><div class="tts-settings-columns">
<div class="tts-settings-column"><div class="group"><h3>BGM</h3>
${row('BGM 사용', sw('snd-bgm-enabled', 'BGM 사용'))}
<fieldset class="snd-gate" id="snd-bgm-gate">
${row('BGM 볼륨', range('snd-bgm-volume', 'BGM 볼륨'))}
${row('TTS 재생 중 BGM', range('snd-duck', 'TTS 재생 중 BGM 크기'))}
${row('곡 전환', `<div class="control"><input id="snd-crossfade" type="number" min="0" max="10" step="0.5" aria-label="크로스페이드 초" style="width:72px"><span>초 크로스페이드</span></div>`)}
${row('LLM에게 BGM 태그 요청', sw('snd-bgm-prompt', 'LLM에게 BGM 태그 요청'))}
${row('TTS 읽는 위치의 BGM 자동 전환', sw('snd-list-bgm', 'TTS 읽는 위치의 BGM 자동 전환'))}
${row('곡 고르는 방식', matcher('snd-bgm-matcher'))}
${row('곡을 고르는 근거', `<select id="snd-bgm-basis" aria-label="곡을 고르는 근거"><option value="tags">BGM 태그 (없으면 메시지 전체)</option><option value="message">메시지 문장 전체</option><option value="both">BGM 태그 + 메시지 전체</option></select>`)}
<label class="field full"><span>BGM 태그 목록</span><textarea id="snd-bgm-tags" rows="3" maxlength="1200"></textarea></label>
</fieldset></div></div>
<div class="tts-settings-column"><div class="group"><h3>효과음</h3>
${row('효과음 사용', sw('snd-sfx-enabled', '효과음 사용'))}
<fieldset class="snd-gate" id="snd-sfx-gate">
${row('효과음 볼륨', range('snd-sfx-volume', '효과음 볼륨'))}
${row('효과음 크기 자동 맞추기', sw('snd-sfx-normalize', '효과음 크기 자동 맞추기'))}
${row('▶를 다른 모듈보다 먼저 붙이기', sw('snd-sfx-first', '▶를 다른 모듈보다 먼저 붙이기'))}
${row('앞뒤 무음 건너뛰기', sw('snd-sfx-trim', '앞뒤 무음 건너뛰기'))}
${row('효과음 최대 길이', `<div class="control"><input id="snd-sfx-max" type="number" min="0" max="60" step="0.5" aria-label="효과음 최대 길이 초" style="width:72px"><span>초</span></div>`)}
${row('LLM에게 효과음 표시 요청', sw('snd-sfx-cue', 'LLM에게 효과음 표시 요청'), '<span id="snd-sfx-cue-status"></span>')}
${row('TTS 목록·이어 읽기에 효과음', sw('snd-list-sfx', 'TTS 목록·이어 읽기에 효과음'))}
${row('자동 재생', `<select id="snd-sfx-auto" aria-label="효과음 자동 재생"><option value="reply">새 답변 · 이어 읽기 중</option><option value="button">버튼을 눌렀을 때만</option></select>`)}
${row('효과음 고르는 방식', matcher('snd-sfx-matcher'))}
${row('맞는 효과음이 없으면 ElevenLabs로 만들기', sw('snd-sfx-autocreate', '맞는 효과음이 없으면 ElevenLabs로 만들기'))}
${row('생성 길이', `<div class="control"><input id="snd-sfx-duration" type="number" min="0" max="30" step="0.5" aria-label="생성 길이 초" style="width:72px"><span>초 · 0이면 자동</span></div>`)}
<div class="snd-rules-box"><div class="snd-rules-head" id="snd-rules-head"><b>효과음 규칙</b><small>앞 글자 · 효과음 · 뒤 글자</small><button type="button" id="snd-rule-add">+ 규칙</button></div><div class="snd-rules" id="snd-rules"></div></div>
</fieldset></div><div class="group"><h3>파일</h3>
${row('BGM·효과음 설정 파일', `<div class="actions"><button type="button" id="snd-settings-export">내보내기</button><button type="button" id="snd-settings-import">불러오기</button><input type="file" id="snd-settings-file" accept=".json,application/json" hidden></div>`)}
${row('BGM 기기 저장', `<div class="control"><input id="snd-bgm-cache" type="number" min="0" max="4000" step="50" aria-label="BGM 기기 저장 한도 MB" style="width:80px"><span>MB</span><button type="button" id="snd-bgm-cache-clear">비우기</button></div>`, '<span id="snd-bgm-cache-usage"></span>')}
${row('파일 최대 크기', `<div class="control"><input id="snd-max-mb" type="number" min="1" max="50" aria-label="파일 최대 크기 MB" style="width:72px"><span>MB</span></div>`)}
</div></div></div></section>
${library('bgm', 'BGM')}
${library('sfx', '효과음')}
<section class="panel" id="sound-glossary" role="tabpanel" hidden>
<div class="voice-command-bar"><div class="voice-search-wrap"><input id="snd-term-search" placeholder="용어·효과음 검색" aria-label="용어·효과음 검색"></div><div class="actions voice-tools"><button type="button" class="primary" id="snd-term-add">+ 묶음</button></div></div>
<div class="snd-subtabs" role="tablist" aria-label="용어집"><button type="button" role="tab" id="snd-gloss-tab-terms" aria-selected="true">용어 <small id="snd-terms-count"></small></button><button type="button" role="tab" id="snd-gloss-tab-unknown" aria-selected="false">미등록 <small id="snd-unknown-count"></small></button></div>
<div class="snd-gloss-select" id="snd-gloss-select"><button type="button" id="snd-gloss-multi" aria-pressed="false">다중선택</button><span id="snd-gloss-picked" role="status"></span><button type="button" id="snd-gloss-all" hidden>전체 선택</button><button type="button" id="snd-gloss-none" hidden>선택 해제</button><button type="button" id="snd-gloss-delete" class="danger" hidden disabled>선택 삭제</button></div>
<div class="group" id="snd-gloss-terms" role="tabpanel"><h3>용어 → 효과음</h3><small>같은 소리를 뜻하는 말을 한 타일에 모읍니다(한 말은 한 효과음에만). 효과음 이름을 누르면 검색해서 바꿉니다. 「콰아앙 치이익」처럼 이어진 말은 소리마다 따로 찾아 붙입니다(최대 4개).</small><div id="snd-terms"></div></div>
<div class="group" id="snd-gloss-unknown" role="tabpanel" hidden><h3 style="display:flex;align-items:center;gap:8px">미등록 용어<button type="button" class="primary" id="snd-unknown-auto" style="margin-left:auto" title="효과음 고르는 방식의 JEV·LLM으로 자동 등록">⚡ 자동 등록</button><button type="button" id="snd-unknown-clear">모두 지우기</button></h3><small>답변에 나왔지만 용어집에 없는 말입니다. → 추천을 누르거나 직접 고르세요. ⚡는 JEV·LLM(효과음 고르는 방식)이 8개씩 한 번에 골라 주고, 맞는 게 없는 말은 남겨 둡니다.</small><div id="snd-unknown"></div></div>
</section></div>`;

export const SOUND_DIALOG = `<dialog id="snd-move-dialog"><h2>폴더 이동</h2><label class="field"><span>옮길 폴더</span><select id="snd-move-target"></select></label><div class="dialog-actions"><button type="button" id="snd-move-cancel">취소</button><button type="button" id="snd-move-confirm" class="primary">이동</button></div></dialog><dialog id="snd-item-dialog" class="editor-sheet"><form id="snd-item-form"><div class="dialog-head"><span id="snd-item-title">추가</span></div><div class="editor-scroll"><div class="fields">
<label class="field full"><span>이름</span><input id="snd-item-name" maxlength="120"></label>
<label class="field full"><span>태그 · 쉼표로 구분</span><input id="snd-item-tags" maxlength="500" placeholder="tense, chase, fast"></label>
<label class="field"><span>폴더</span><select id="snd-item-folder"></select></label>
<label class="field full" id="snd-item-terms-wrap" hidden><span>용어집 단어 · 이 말이 나오면 이 효과음 (쉼표로 구분)</span><input id="snd-item-terms" maxlength="500" placeholder="쾅, 콰앙, 쿵"></label>
<label class="field"><span>등록 방식</span><select id="snd-item-source"><option value="url">오디오 파일 주소 (https)</option><option value="file">파일 직접 등록 (모듈에 저장)</option><option value="eleven">ElevenLabs로 만들기 (유료)</option></select></label>
<label class="field full" id="snd-item-url-wrap"><span>오디오 파일 주소</span><input id="snd-item-url" type="url" placeholder="https://…/sound.mp3" maxlength="2000"></label>
<label class="field full" id="snd-item-prompt-wrap" hidden><span id="snd-item-prompt-label">만들 효과음 설명 · 영어가 가장 정확합니다</span><textarea id="snd-item-prompt" rows="2" maxlength="450" placeholder="heavy wooden door slamming shut"></textarea><span>길이 (초 · 0이면 자동)</span><input id="snd-item-duration" type="number" min="0" max="30" step="0.5" value="0" style="width:72px"></label>
<label class="field full" id="snd-item-file-wrap" hidden><span>파일 (mp3 · wav · ogg · m4a · flac · webm)</span><input id="snd-item-file" type="file" accept="audio/*"></label>
<small id="snd-item-status" role="status"></small></div></div>
<div class="dialog-actions"><button type="button" id="snd-item-cancel">취소</button><button type="button" id="snd-item-save" class="primary">추가</button></div></form></dialog>`;
