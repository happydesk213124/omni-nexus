/**
 * Irodori's own voice presets: a tab that stands where 음성 목록 (Fish's library) does while Irodori is the engine,
 * and the sheet a preset is made in. Plain markup with no imports: the page markup is built from it before any
 * script binds (sound-ui/markup.ts), so the right tab is there from the first paint.
 */
export const IRODORI_VOICES_TAB = 'tts-irodori-voices';
const CSS = '#tts-irodori-voices .iv-bar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:8px}'
  + '#tts-irodori-voices .iv-bar input{flex:1 1 180px;min-width:0}#tts-irodori-voices .iv-bar .actions{padding:0;flex-wrap:wrap}'
  + '#tts-irodori-voices .iv-note{margin:0 0 12px;font-size:12px;line-height:1.5;color:var(--muted)}'
  // The list and its tiles are 음성 목록's (sound-ui/style.ts copies its rules over): number, name, tags, the voice's
  // id where the folder is, ▶ 듣기 in the corner.
  + '#tts-irodori-voices .iv-row strong{overflow-wrap:anywhere}'
  + '#tts-irodori-voices .iv-empty{grid-column:1/-1;padding:28px 12px;text-align:center;font-size:13px;color:var(--muted)}'
  + '#tts-irodori-voices .iv-bar select{flex:0 0 auto;width:auto;min-width:0}#tts-irodori-voices .voice-selection-bar{margin-bottom:8px}#tts-irodori-voices .iv-row{cursor:pointer}';
const TAB = `<button role="tab" id="tab-irodori-voices" aria-controls="${IRODORI_VOICES_TAB}" aria-selected="false" tabindex="-1" data-tts-tab="${IRODORI_VOICES_TAB}" hidden>Irodori 목소리</button>`;
const PANEL = `<section class="panel" id="${IRODORI_VOICES_TAB}" role="tabpanel" aria-labelledby="tab-irodori-voices" hidden><style>${CSS}</style>`
  + '<div class="iv-bar"><input id="iv-search" placeholder="이름·태그·ID 검색" aria-label="Irodori 목소리 검색" maxlength="200">'
  + '<select id="iv-gender-filter" aria-label="성별 필터"><option value="all">전체 성별</option><option value="여성">여성</option><option value="남성">남성</option><option value="미지정">미지정</option></select>'
  + '<select id="iv-sort" aria-label="정렬"><option value="added">추가순</option><option value="name">이름순</option><option value="gender">성별순</option></select><span id="iv-count"></span>'
  + '<div class="actions"><button type="button" id="iv-starter" title="성별·나이·성격별 목소리 20개를 서버에서 만들어 프리셋으로 등록합니다">기본 세트 만들기</button><button type="button" id="iv-sync" title="서버에 있는 목소리마다 프리셋을 하나씩 만듭니다">서버 목소리 가져오기</button><button type="button" id="iv-export" title="프리셋 목록을 JSON 파일로 저장합니다. 소리 파일은 서버의 voices 폴더에 있습니다">내보내기</button><button type="button" id="iv-import" title="내보낸 JSON 파일의 프리셋 중 여기 없는 것을 추가합니다">불러오기</button><input type="file" id="iv-import-file" accept="application/json,.json" hidden><button type="button" class="primary" id="iv-add">+ 목소리</button></div></div>'
  + '<p class="iv-note">Irodori는 내 서버에 둔 참조 음성으로 말합니다. 프리셋 하나가 서버의 목소리 하나를 가리키고, 캐릭터 탭에서 캐릭터마다 고릅니다. 프리셋을 고르지 않은 캐릭터와 나레이션은 모델 설정의 기본 목소리로 읽습니다.</p>'
  + '<p id="iv-progress" class="iv-note" role="status" hidden></p>'
  + '<div class="voice-selection-bar"><button type="button" id="iv-apply-picked" hidden disabled>이 목소리 선택</button><button type="button" id="iv-cancel-picked" hidden>선택 취소</button><button type="button" id="iv-multiselect" aria-pressed="false">다중선택</button><span id="iv-selected-count" role="status">선택 없음</span><button type="button" id="iv-select-all">전체 선택</button><button type="button" id="iv-clear-selection" disabled>선택 해제</button><button type="button" id="iv-edit-selected" disabled>수정</button><button type="button" id="iv-delete-selected" class="danger" disabled>삭제</button></div>'
  + '<div id="iv-list" class="voice-list iv-list" role="listbox" aria-multiselectable="true" aria-label="Irodori 목소리 프리셋"></div></section>';
export const IRODORI_VOICE_DIALOG = '<dialog id="irodori-voice-dialog" class="editor-sheet"><form id="irodori-voice-form"><div class="dialog-head"><button type="button" data-close="irodori-voice-dialog" aria-label="편집창 접기" class="editor-fold"><span id="iv-dialog-title">Irodori 목소리 추가</span> ▾</button></div><div class="editor-scroll"><div class="fields">'
  + '<label class="field full"><span>목소리 이름</span><input id="iv-name" required maxlength="120"></label>'
  + '<label class="field"><span>성별 분류</span><select id="iv-gender"><option>여성</option><option>남성</option><option>미지정</option></select></label>'
  + '<label class="field"><span>특징 태그 · 쉼표로 구분</span><input id="iv-tags" maxlength="250" placeholder="젊은, 차분한, 부드러운"></label>'
  + '<label class="field full"><span>서버의 목소리 ID</span><input id="iv-id" list="iv-ids" maxlength="200" placeholder="서버 voices 폴더의 파일 이름 · 예: sample" autocomplete="off"><datalist id="iv-ids"></datalist></label>'
  + '<div class="field full"><div class="actions"><button type="button" id="iv-load">서버 목록 불러오기</button><button type="button" id="iv-upload">참조 음성 파일 올리기</button></div><input type="file" id="iv-file" accept="audio/*,.wav,.mp3,.flac,.ogg,.m4a" hidden><small>서버에 이미 있는 목소리는 목록에서 고르고, 없으면 녹음 파일(2분 이내)을 올려 등록합니다.</small></div>'
  + '<div class="field full"><span>LLM으로 채우기 · 캐릭터 설명과 로어북을 보고 이름·성별·태그·설명글을 씁니다</span><div class="actions"><select id="iv-who" aria-label="어느 캐릭터의 목소리인지" style="flex:1 1 150px;min-width:0"></select><select id="iv-model" aria-label="LLM" style="flex:1 1 150px;min-width:0"></select><button type="button" id="iv-write">LLM으로 채우기</button></div>'
  + '<input id="iv-request" maxlength="500" placeholder="요청 (선택) · 한글로 써도 됩니다 · 예: 낮고 나른한 목소리로" aria-label="LLM에게 하는 요청" style="margin-top:6px">'
  + '<label class="switch" id="iv-bind-wrap" hidden><input type="checkbox" id="iv-bind" checked>적용하면 이 캐릭터의 목소리로 지정</label>'
  + '<small>로어북은 그 캐릭터 이름이 나오는 항목만 골라 보냅니다. 채운 뒤 바로 만들어 들려 줍니다.</small></div>'
  + '<label class="field full"><span>설명글로 목소리 만들기 · 일본어로 (비워 두고 만들면 LLM이 씁니다)</span><textarea id="iv-caption" rows="3" maxlength="2000" placeholder="例: 落ち着いた低めの声の若い女性。やさしく、ゆっくり話す。"></textarea></label>'
  + '<div class="field full"><div class="actions"><select id="iv-translate-via" aria-label="번역 방법" style="flex:1 1 150px;min-width:0"><option value="follow">TTS 설정의 번역 따름</option><option value="google-free">Google 무료 번역</option><option value="llm">LLM 번역</option></select><button type="button" id="iv-translate">일본어로 번역</button></div><small>설명글을 한글로 적고 누르면 일본어로 바꿉니다. TTS 설정의 번역이 꺼져 있으면 Google 무료 번역을 씁니다.</small></div>'
  + '<div class="field full"><div class="actions"><button type="button" id="iv-design">만들어 듣기</button><button type="button" id="iv-keep" disabled>이 소리로 등록</button></div><small>누를 때마다 다른 목소리가 나옵니다. 마음에 드는 소리가 나오면 「이 소리로 등록」을 눌러 서버에 저장해야 같은 목소리로 계속 읽습니다.</small></div>'
  + '<small id="iv-status" role="status" class="field full" style="overflow-wrap:anywhere"></small>'
  + '</div></div><div class="dialog-actions"><button type="button" id="iv-listen">▶ 듣기</button><button type="button" data-close="irodori-voice-dialog">취소</button><button class="primary" type="submit">적용</button></div></form></dialog>';
/** The card sheet's own choice of Irodori preset, shown in place of Fish's voice fields while Irodori is the engine. */
export const IRODORI_CARD_FIELD = '<label class="field full" id="c-irodori-wrap" hidden><span>Irodori 목소리</span><select id="c-irodori-voice" aria-label="Irodori 목소리"></select><button type="button" id="c-gemini-design" hidden style="margin-top:6px">태그로 목소리 만들기</button><small>프리셋은 「Irodori 목소리」 탭에서 만듭니다. 고르지 않으면 모델 설정의 기본 목소리로 읽습니다.</small></label>';

/** Adds the tab button (after 음성 목록) and its panel (after Fish's library). Idempotent. */
export function addIrodoriVoicesStructure(root: ParentNode): void {
  if (root.querySelector(`#${IRODORI_VOICES_TAB}`)) return;
  root.querySelector('#tab-voices')?.insertAdjacentHTML('afterend', TAB);
  root.querySelector('#tts-voices')?.insertAdjacentHTML('afterend', PANEL);
}
/** A page's tabs under the engine in use: Irodori's presets stand where Fish's library does. */
export function engineTabs(tabs: readonly string[], engine: 'fish' | 'irodori' | 'gemini'): readonly string[] {
  // Gemini's presets the same way (gemini-voices.ts names that tab; this file imports nothing, so its id is here).
  const own = engine === 'irodori' ? IRODORI_VOICES_TAB : engine === 'gemini' ? 'tts-gemini-voices' : '';
  return own ? tabs.map(tab => tab === 'tts-voices' ? own : tab) : tabs;
}
