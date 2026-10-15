/**
 * BGM·효과음 pages. They reuse the TTS settings classes (groups, rows, voice
 * tiles, editor sheets) so the pages look like the rest of the TTS area, and
 * they sit outside #tts-controls so switching TTS off never disables them.
 */
const sw = (id: string, label: string) => `<label class="switch"><input type="checkbox" id="${id}" aria-label="${label}"></label>`;
const row = (title: string, control: string, hint = '') => `<div class="row"><div class="copy"><b>${title}</b>${hint ? `<small>${hint}</small>` : ''}</div>${control}</div>`;
const range = (id: string, label: string) => `<div class="control"><input id="${id}" type="range" min="0" max="100" aria-label="${label}"><output class="value" id="${id}-value"></output></div>`;
const matcher = (id: string) => `<select id="${id}" aria-label="고르는 방식"><option value="auto">자동 · 글자 → 임베딩 → JEV</option><option value="tag">글자 매칭만 (무료)</option><option value="embedding">임베딩</option><option value="jev">JEV</option><option value="llm">LLM</option></select>`;

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
<div class="actions voice-tools"><button class="primary" id="${id('add')}">+ ${title}</button><details class="file-menu"><summary>파일 ⋯</summary><div><button id="${id('import')}">JSON 가져오기</button><button id="${id('export')}">JSON 내보내기</button></div></details></div>
<input type="file" id="${id('file')}" accept=".json,application/json" hidden></div>
<div class="voice-explorer"><aside class="voice-folders"><div class="folder-heading"><b>폴더</b><button id="${id('folder-toggle')}" type="button" aria-expanded="false">폴더 ▾</button><button id="${id('folder-add')}" title="폴더 만들기" aria-label="폴더 만들기">＋</button></div>
<nav id="${id('folders')}" aria-label="${title} 폴더"></nav><button id="${id('folder-edit')}" disabled>폴더 관리</button></aside>
<div class="voice-browser"><div class="voice-selection-bar"><button id="${id('multi')}" type="button" aria-pressed="false">다중선택</button><span id="${id('selected-count')}" role="status">선택 없음</span>
<button id="${id('select-all')}">전체 선택</button><button id="${id('clear')}" disabled>선택 해제</button><button id="${id('edit')}" disabled>수정</button><button id="${id('move')}" disabled>폴더 이동</button><button id="${id('delete')}" class="danger" disabled>삭제</button></div>
<div id="${id('list')}" class="voice-list" role="listbox" aria-label="${title} 선택" aria-multiselectable="true"></div></div></div></section>`;
}

export const SOUND_PANELS = `<div class="workspace" id="sound-controls">
<section class="panel" id="sound-settings" role="tabpanel" hidden><div class="tts-settings-columns">
<div class="tts-settings-column"><div class="group"><h3>BGM</h3>
${row('BGM 사용', sw('snd-bgm-enabled', 'BGM 사용'), '켜면 ⚛️ omni bgm 모듈이 설치되고 [[bgm:…]] 줄이 ♪ 버튼이 됩니다.')}
${row('BGM 볼륨', range('snd-bgm-volume', 'BGM 볼륨'))}
${row('TTS 재생 중 BGM', range('snd-duck', 'TTS 재생 중 BGM 크기'), 'TTS가 말하는 동안 이만큼으로 줄입니다.')}
${row('곡 전환', `<div class="control"><input id="snd-crossfade" type="number" min="0" max="10" step="0.5" aria-label="크로스페이드 초" style="width:72px"><span>초 크로스페이드</span></div>`)}
${row('LLM에게 BGM 태그 요청', sw('snd-bgm-prompt', 'LLM에게 BGM 태그 요청'), '곡이 바뀔 만할 때만(이 채팅의 첫 장면, 분위기·장소가 확 바뀔 때) 그 부분의 첫 나레이션·대사 바로 앞 줄에 [[bgm:분위기,장소,템포]]를 쓰게 합니다. 같은 분위기가 이어지면 쓰지 않고 곡이 계속 흐릅니다(답변당 최대 3개). 곡 목록은 보내지 않습니다.')}
${row('TTS 목록·이어 읽기에 BGM', sw('snd-list-bgm', 'TTS 목록·이어 읽기에 BGM'), 'TTS 뷰어 목록에 ♪ 줄이 생기고, 이어 읽다가 그 줄에 오면 곡이 바뀝니다. 끄면 새 답변이 올 때 첫 태그로만 바뀝니다.')}
${row('곡 고르는 방식', matcher('snd-bgm-matcher'))}
<label class="field full"><span>BGM 태그 목록 · 쉼표로 구분 (LLM은 이 안에서만 고릅니다)</span><textarea id="snd-bgm-tags" rows="3" maxlength="1200"></textarea></label>
</div></div>
<div class="tts-settings-column"><div class="group"><h3>효과음</h3>
${row('효과음 사용', sw('snd-sfx-enabled', '효과음 사용'), '켜면 ⚛️ omni 효과음 모듈이 설치되고 규칙에 걸린 말에 회색 ▶ 버튼이 붙습니다.')}
${row('효과음 볼륨', range('snd-sfx-volume', '효과음 볼륨'))}
${row('LLM에게 효과음 표시 요청', sw('snd-sfx-cue', 'LLM에게 효과음 표시 요청'), '소리가 나는 곳에 §쾅§처럼 쓰게 합니다(답변당 최대 5개). 기본 § 규칙이 켜져 있을 때만 보냅니다.')}
${row('TTS 목록·이어 읽기에 효과음', sw('snd-list-sfx', 'TTS 목록·이어 읽기에 효과음'), 'TTS 뷰어 목록에 ▶ 줄이 생기고, 이어 읽다가 그 줄에 오면 효과음을 틀고 끝나면 다음 대사로 넘어갑니다.')}
${row('자동 재생', `<select id="snd-sfx-auto" aria-label="효과음 자동 재생"><option value="reply">새 답변 · 이어 읽기 중</option><option value="button">버튼을 눌렀을 때만</option></select>`)}
${row('효과음 고르는 방식', matcher('snd-sfx-matcher'))}
${row('맞는 효과음이 없으면 ElevenLabs로 만들기', sw('snd-sfx-autocreate', '맞는 효과음이 없으면 ElevenLabs로 만들기'), 'JEV·LLM이 "맞는 게 없다"고 답한 말만 만듭니다(유료). 만든 효과음은 「자동 생성」 폴더와 용어집에 들어갑니다.')}
<label class="field full"><span>생성 프롬프트 · {word} 자리에 효과음 말(영어)이 들어갑니다</span><input id="snd-sfx-prompt" maxlength="400"></label>
${row('생성 길이', `<div class="control"><input id="snd-sfx-duration" type="number" min="0" max="30" step="0.5" aria-label="생성 길이 초" style="width:72px"><span>초 · 0이면 자동</span></div>`)}
<div class="field full"><span>효과음 규칙 · 정규식 (첫 괄호가 효과음 말)</span><div id="snd-rules"></div><div class="actions"><button type="button" id="snd-rule-add">+ 규칙</button></div></div>
<label class="field full"><span>규칙 테스트 · 예시 문장</span><textarea id="snd-rule-test" rows="2" placeholder="§덜컹! 덜컹! 와르르──!§"></textarea><small id="snd-rule-result"></small></label>
</div><div class="group"><h3>파일</h3>
${row('파일 최대 크기', `<div class="control"><input id="snd-max-mb" type="number" min="1" max="50" aria-label="파일 최대 크기 MB" style="width:72px"><span>MB</span></div>`, '파일은 모듈에 저장되어 저장 파일·동기화 크기가 늘어납니다. 큰 곡은 주소로 등록하세요.')}
</div></div></div></section>
${library('bgm', 'BGM')}
${library('sfx', '효과음')}
<section class="panel" id="sound-glossary" role="tabpanel" hidden>
<div class="voice-command-bar"><div class="voice-search-wrap"><input id="snd-term-search" placeholder="용어 검색" aria-label="용어 검색"></div><div class="actions voice-tools"><button type="button" class="primary" id="snd-term-add">+ 용어</button></div></div>
<div class="group"><h3>용어 → 효과음</h3><small>같은 소리를 뜻하는 말을 쉼표로 묶어 하나의 효과음에 연결합니다. 예: 덜컹, 쾅, 문 닫힘</small><div id="snd-terms"></div></div>
<div class="group"><h3>미등록 용어</h3><small>규칙에 걸렸지만 용어집에 없는 말이 여기에 모입니다. 효과음을 고르면 용어집에 추가됩니다.</small><div id="snd-unknown"></div></div>
</section></div>`;

export const SOUND_DIALOG = `<dialog id="snd-move-dialog"><h2>폴더 이동</h2><label class="field"><span>옮길 폴더</span><select id="snd-move-target"></select></label><div class="dialog-actions"><button type="button" id="snd-move-cancel">취소</button><button type="button" id="snd-move-confirm" class="primary">이동</button></div></dialog><dialog id="snd-item-dialog" class="editor-sheet"><form id="snd-item-form"><div class="dialog-head"><span id="snd-item-title">추가</span></div><div class="editor-scroll"><div class="fields">
<label class="field full"><span>이름</span><input id="snd-item-name" maxlength="120"></label>
<label class="field full"><span>태그 · 쉼표로 구분</span><input id="snd-item-tags" maxlength="500" placeholder="tense, chase, fast"></label>
<label class="field"><span>폴더</span><select id="snd-item-folder"></select></label>
<label class="field"><span>등록 방식</span><select id="snd-item-source"><option value="url">오디오 파일 주소 (https)</option><option value="file">파일 직접 등록 (모듈에 저장)</option><option value="eleven">ElevenLabs로 만들기 (유료)</option></select></label>
<label class="field full" id="snd-item-url-wrap"><span>오디오 파일 주소</span><input id="snd-item-url" type="url" placeholder="https://…/sound.mp3" maxlength="2000"></label>
<label class="field full" id="snd-item-prompt-wrap" hidden><span id="snd-item-prompt-label">만들 효과음 설명 · 영어가 가장 정확합니다</span><textarea id="snd-item-prompt" rows="2" maxlength="450" placeholder="heavy wooden door slamming shut"></textarea><span>길이 (초 · 0이면 자동)</span><input id="snd-item-duration" type="number" min="0" max="30" step="0.5" value="0" style="width:72px"></label>
<label class="field full" id="snd-item-file-wrap" hidden><span>파일 (mp3 · wav · ogg · m4a · flac · webm)</span><input id="snd-item-file" type="file" accept="audio/*"></label>
<small id="snd-item-status" role="status"></small></div></div>
<div class="dialog-actions"><button type="button" id="snd-item-cancel">취소</button><button type="button" id="snd-item-save" class="primary">추가</button></div></form></dialog>`;
