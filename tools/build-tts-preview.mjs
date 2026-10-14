import {readFile,writeFile} from 'node:fs/promises';
import postcss from 'postcss';
import {chromium} from 'playwright';

const base=await readFile('docs/settings-ux-preview.html','utf8');
const template=(await readFile('tools/tts-preview-template.html','utf8')).replace('/*CHARACTER_IDENTITY*/',await readFile('tools/tts-character-identity.js','utf8')).replace('/*VOICE_EXPLORER*/',await readFile('tools/tts-voice-explorer.js','utf8')).replace('/*FOLDER_TRANSFER*/',await readFile('tools/tts-folder-transfer.js','utf8')).replace('/*SPEED_PRESETS*/',await readFile('tools/tts-speed-presets.js','utf8')).replace('/*EXTRA_RUNTIME*/',await readFile('tools/tts-preview-interactions.js','utf8')).replace('/*CHARACTER_BATCH*/',await readFile('tools/tts-character-batch.js','utf8')).replace('/*ILLUSTRATION_PREVIEW*/',await readFile('tools/tts-illustration-preview.js','utf8'));
const browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
let parts;
try{
 const page=await browser.newPage();
 parts=await page.evaluate(({base,template})=>{
  const parser=new DOMParser(),original=parser.parseFromString(base,'text/html'),draft=parser.parseFromString(template,'text/html');
  const root=draft.querySelector('.work'),workspace=draft.querySelector('.workspace');
  workspace.querySelector('.plan-link')?.remove();
  workspace.querySelectorAll('[data-tab]').forEach(b=>{const id=b.dataset.tab;delete b.dataset.tab;b.dataset.ttsTab='tts-'+id;b.setAttribute('aria-controls','tts-'+id);});
  workspace.querySelectorAll('[role=tabpanel]').forEach(p=>p.id='tts-'+p.id);
  const voicesPanel=workspace.querySelector('#tts-voices');
  const voiceCommands=original.createElement('div');voiceCommands.className='voice-command-bar';
  const discover=voicesPanel.querySelector('.voice-discovery a');discover.textContent='Fish ↗';discover.title='Fish Audio에서 음성 탐색';
  voicesPanel.querySelector('#voice-total').hidden=true;
  voiceCommands.append(...voicesPanel.querySelector('.toolbar').children,voicesPanel.querySelector('#voice-count'),voicesPanel.querySelector('#voice-total'),voicesPanel.querySelector('.voice-tools'),discover,voicesPanel.querySelector('#voice-file'));
  voicesPanel.querySelectorAll(':scope > .panel-title,:scope > .toolbar,:scope > .counts,:scope > .voice-discovery').forEach(element=>element.remove());
  voicesPanel.prepend(voiceCommands);
  const voiceSearch=voicesPanel.querySelector('#voice-search');
  const searchWrap=original.createElement('div');searchWrap.className='voice-search-wrap';
  voiceSearch.before(searchWrap);searchWrap.append(voiceSearch);
  voiceSearch.placeholder='이름·태그·ID 검색 ( | 또는, & 모두 )';
  voiceSearch.title='예: 여성 & 차분 | 남성 & 밝은 · & 먼저, | 나중 · 괄호/정규식 없이 문자 그대로 검색';
  voiceSearch.maxLength=500;
  const clearSearch=original.createElement('button');clearSearch.id='clear-voice-search';clearSearch.type='button';clearSearch.textContent='×';clearSearch.hidden=true;clearSearch.setAttribute('aria-label','음성 검색 비우기');clearSearch.title='검색 비우기';searchWrap.append(clearSearch);
  const charactersPanel=workspace.querySelector('#tts-characters');
  const characterCommands=original.createElement('div');characterCommands.className='character-command-bar';
  characterCommands.append(charactersPanel.querySelector('.panel-title h2'),...charactersPanel.querySelector('.toolbar').children,charactersPanel.querySelector('.panel-title .actions'));
  charactersPanel.querySelectorAll(':scope > .panel-title,:scope > .toolbar').forEach(element=>element.remove());
  charactersPanel.prepend(characterCommands);charactersPanel.append(charactersPanel.querySelector('#character-jev-bar'));
  const chatPreview=original.createElement('button');chatPreview.id='chat-preview';chatPreview.type='button';chatPreview.className='icon-btn';chatPreview.innerHTML='<span class=chat-preview-label>채팅 시안</span><span class=chat-preview-symbol aria-hidden=true>▤</span>';chatPreview.setAttribute('aria-label','채팅 시안');chatPreview.title='메시지·플로팅 뷰어 검수 화면';original.getElementById('nx-close').before(chatPreview);

  const settings=original.createElement('div');settings.id='tts-settings-root';settings.className='tts-demo';
  const help={'tts-settings-root':{title:'TTS 사용 안내',body:'삽화 Power와 독립적으로 켜는 음성 기능입니다. 첫 재생 전 음성 재생 활성화를 누르세요. 설정에 마우스를 올리거나 키보드로 선택하면 이곳에 설명이 표시됩니다. 현재는 API·음성·저장 미연결 검수 시안입니다. 분홍색은 실제 제품에 포함하지 않는 검수 전용 요소입니다.'}};
  let helpIndex=0;
  const addHelp=(host,body)=>{
    if(!host||!body.trim())return;
    if(!host.id)host.id='tts-help-'+(++helpIndex);
    const title=host.querySelector('.copy b,:scope > h3,:scope > .panel-title h2,:scope > span')?.textContent||host.querySelector('h3,h2,b')?.textContent||'TTS 안내';
    const prior=help[host.id];help[host.id]={title:prior?.title||title,body:[prior?.body,body.trim()].filter(Boolean).join(' ')};
  };
  workspace.querySelectorAll('.subbox').forEach(box=>{
    if(box.querySelector('button,input,select,a'))return;
    addHelp(box.closest('.group,.panel'),box.textContent);box.remove();
  });
  workspace.querySelectorAll('.copy small,.group > p,.panel > p.hint,.subbox > p.hint').forEach(note=>{
    addHelp(note.parentElement.closest('.row,.field,.group,.subbox,.panel'),note.textContent);
    if(note.id)note.hidden=true;else note.remove();
  });
  const settingsPanel=workspace.querySelector('#tts-settings');
  const panelTitle=settingsPanel.querySelector(':scope > .panel-title');panelTitle.remove();
  const groups=[...settingsPanel.querySelectorAll(':scope > .group')];
  groups[0].append(groups[2].querySelector('.row'));groups[2].remove();
  const playbackTitle=original.createElement('h3');playbackTitle.textContent='재생과 읽기';groups[0].prepend(playbackTitle);
  const settingsColumns=original.createElement('div');settingsColumns.className='tts-settings-columns';
  for(const indices of [[0,3],[1,4,5]]){
    const column=original.createElement('div');column.className='tts-settings-column';
    indices.forEach(i=>column.append(groups[i]));settingsColumns.append(column);
  }
  settingsPanel.append(settingsColumns);
  const powerControls=original.createElement('div');powerControls.id='tts-power-controls';
  powerControls.innerHTML='<button id="audio-enable-settings" type="button" aria-label="음성 재생 활성화" title="음성 재생 활성화"><span class="audio-enable-label">음성 재생 활성화</span><span class="audio-enable-symbol" aria-hidden="true">♪</span></button><label class="switch"><b>TTS 사용</b></label>';
  const power=root.querySelector('#tts-power');power.setAttribute('aria-label','TTS 사용');
  powerControls.querySelector('.switch').append(power);
  help['tts-power']={title:'TTS 사용',body:'삽화 Power와 독립적입니다. 켜면 TTS 설정을 수정할 수 있고, 끄면 재생·새 준비 작업을 멈추고 설정을 잠급니다. 기존 설정은 유지합니다.'};
  help['audio-enable-settings']={title:'음성 재생 활성화',body:'자동/마우스오버 재생 전에 한 번 눌러 주세요. 시스템 권한 팝업이 아닌 음성 시작 버튼입니다. 현재는 실제 오디오가 연결되지 않은 시안입니다.'};
  const offNotice=original.createElement('div');offNotice.id='tts-off-notice';offNotice.hidden=true;
  offNotice.textContent='TTS가 꺼져 있습니다.';
  const controls=original.createElement('fieldset');controls.id='tts-controls';controls.append(workspace);
  const tabBar=original.createElement('div');tabBar.className='tts-tabs-bar';tabBar.append(workspace.querySelector('.tabs'),powerControls);
  settings.append(tabBar,offNotice,controls);
  original.getElementById('tts').replaceChildren(settings);
  original.querySelector('.app').id='settings-stage';
  const curator=original.querySelector('[data-llm-role="curator"]');
  if(curator.previousSibling?.nodeType===3&&!curator.previousSibling.textContent.trim())curator.previousSibling.remove();
  curator.remove();
  original.getElementById('nx-power').removeAttribute('checked');
  const chat=original.createElement('div');chat.id='tts-chat-stage';chat.className='tts-demo';chat.hidden=true;
  chat.innerHTML='<header class="risu-top"><b>RisuAI <small>· 채팅 화면 검수</small></b><button id="back-settings">Omni TTS 설정</button></header><div class="risu-layout"><aside class="risu-sidebar"><div class="risu-avatar">하린</div><b>도서관의 오후</b><p>샘플 캐릭터 · 가상 채팅</p><div class="risu-chat-title">늦은 오후의 이야기</div><small>실제 Risu 데이터는 연결되지 않았습니다.</small></aside><main class="risu-messages"><div class="chat-demo-note">대사 버튼 · 옅은 세로선 · 플로팅 플레이어를 시험하는 별도 메시지 화면입니다. 실제 음성은 나오지 않습니다.</div><article class="user-bubble"><small>사용자</small><p>오늘은 어떤 이야기를 들려줄 거야?</p></article><article class="bot-bubble"><div class="speaker-head"><span>하</span><b>하린</b><small>샘플 메시지</small></div><div id="chat-reader-slot"></div></article><div class="chat-compose"><span>메시지를 입력하세요 · 검수용 화면</span><button disabled>보내기</button></div></main></div>';
  const reader=draft.querySelector('.reader');reader.querySelector('.reader-head h2').textContent='음성 구간';chat.querySelector('#chat-reader-slot').append(reader);
  const chatUnlock=original.createElement('button');chatUnlock.id='audio-enable-chat';chatUnlock.type='button';chatUnlock.textContent='음성 재생 활성화';reader.querySelector('.reader-foot').prepend(chatUnlock);
  chat.append(draft.querySelector('#player'));
  const dialogs=original.createElement('div');dialogs.className='tts-demo';dialogs.id='tts-dialogs';
  dialogs.append(draft.querySelector('#toast'),...draft.querySelectorAll('dialog'));
  // Reuse the character editor's full-width fold bar and plain, row-based fields.
  for(const id of ['character-dialog','voice-dialog','character-source-dialog','bulk-dialog','voice-organize-dialog']){
    const dialog=dialogs.querySelector('#'+id),host=dialog.querySelector('form')||dialog;
    dialog.classList.add('editor-sheet');
    const head=host.querySelector('.dialog-head'),title=head.querySelector('h2'),close=head.querySelector('[data-close]');
    const label=original.createElement('span');label.id=title.id||id+'-title';label.textContent=title.textContent;
    close.className='editor-fold';close.replaceChildren(label,original.createTextNode(' ▾'));close.setAttribute('aria-label','편집창 접기');head.replaceChildren(close);
    const body=original.createElement('div');body.className='editor-scroll';
    const actions=host.querySelector(':scope > .dialog-actions');
    [...host.children].filter(child=>child!==head&&child!==actions).forEach(child=>body.append(child));
    head.after(body);
  }
  const audioDialog=original.createElement('dialog');audioDialog.id='audio-unlock-dialog';audioDialog.innerHTML='<h2>음성 재생을 활성화할까요?</h2><p style="margin-top:14px">브라우저의 자동 재생 제한 때문에 직접 버튼을 눌러 시작해야 할 수 있습니다. 활성화한 뒤 설정한 방식으로 대사를 재생합니다.</p><p class="hint">지금은 화면 검수용입니다. 이 버튼은 실제 브라우저 권한을 바꾸거나 소리를 내지 않습니다.</p><div class="dialog-actions"><button id="audio-unlock-cancel">나중에</button><button class="primary" id="audio-unlock-confirm">음성 재생 활성화</button></div>';
  dialogs.append(audioDialog);
  original.body.append(chat,dialogs,draft.querySelector('#preset-data'));
  const css=draft.querySelector('style').textContent;
  const runtime=[...draft.scripts].find(s=>!s.type).textContent;
  original.title='Omni Nexus · 기존 설정창 TTS 1.2 검수';
  return {html:'<!doctype html>\n'+original.documentElement.outerHTML,css,runtime,help};
 },{base,template});
}finally{await browser.close();}
const cssRoot=postcss.parse(parts.css);
cssRoot.walkRules(rule=>{
 rule.selectors=rule.selectors.map(selector=>selector===':root'||selector==='body'?'.tts-demo':'.tts-demo '+selector);
});
const overrides=`
#settings-stage[hidden],#tts-chat-stage[hidden]{display:none!important}
#tts-settings-root{background:transparent;font:14px/1.5 var(--font);color:var(--text);padding-bottom:25px}
#tts-controls{border:0;padding:0;margin:0;min-width:0;transition:opacity .15s}
#tts-controls:disabled{opacity:.42}
#tts-off-notice{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px;font-size:13px}
#tts-settings-root .tts-tabs-bar{display:flex;align-items:stretch;min-width:0;flex-shrink:0;background:var(--border);border-radius:12px 12px 0 0}
#tts-settings-root .tts-tabs-bar .tabs{flex:1;min-width:0;overflow-x:auto;border-radius:12px 0 0 0;scrollbar-width:thin}
#tts-power-controls{display:flex;align-items:center;justify-content:flex-end;gap:14px;padding:5px 10px;flex-shrink:0}
#tts-power-controls>button{min-height:36px;padding:6px 12px;font-size:12px}
#tts-power-controls .audio-enable-symbol{display:none}
@media(max-width:1100px){#tts-settings-root .tabs button{flex:0 0 auto}#tts-power-controls{gap:8px;padding:4px 6px}#tts-power-controls .audio-enable-label{display:none}#tts-power-controls .audio-enable-symbol{display:inline}#tts-power-controls>button{width:36px;padding:4px}#tts-power-controls .switch{font-size:11px;white-space:nowrap}}
#tts-settings-root .workspace{max-width:none}
#tts-settings-root .tabs button{flex:0 1 160px;font-size:14px}
#tts-settings-root .panel{padding:18px;background:var(--surface)}
#tts-settings-root .group{border:1px solid var(--border);background:var(--surface-2);border-radius:12px;padding:14px 18px;margin-bottom:16px}
#tts-settings-root .tts-settings-columns{display:grid;grid-template-columns:minmax(0,1fr);gap:12px}
#tts-settings-root .tts-settings-column{min-width:0}
#tts-settings-root #tts-settings .group{padding:12px;margin-bottom:12px}
#tts-settings-root #tts-settings .row{min-height:38px;padding:8px 0;gap:10px}
#tts-settings-root #tts-settings .row .control{width:150px}
#tts-settings-root #tts-settings .row>input[type=number]{max-width:95px}
#tts-settings-root #tts-settings .group>h3{margin-bottom:5px}
#tts-settings-root #tts-settings .subbox{padding:10px}
@media(min-width:1000px){#tts-settings-root .tts-settings-columns{grid-template-columns:repeat(2,minmax(0,1fr))}}
#tts-settings-root .row{min-height:48px;padding:10px 0;border-bottom:1px solid var(--border)}
#tts-settings-root .row:last-child{border-bottom:0}
#tts-settings-root .row .control{width:230px}
#tts-settings-root .panel-title{margin-bottom:12px}
#tts-settings-root .voice-list{min-height:180px}
#tts-settings-root .speed-presets-row{flex-wrap:wrap;gap:7px}
#tts-settings-root .speed-presets-row input{flex-basis:100%;font-size:12px}
#tts-settings-root .voice-explorer{display:grid;grid-template-columns:170px minmax(0,1fr);gap:12px}
#tts-settings-root .voice-folders{border-right:1px solid var(--border);padding-right:10px;min-width:0}
#tts-settings-root .folder-heading{display:flex;align-items:center;justify-content:space-between;gap:4px;margin-bottom:8px}
#tts-settings-root .folder-heading #new-voice-folder{padding:8px 10px}
#tts-settings-root #voice-folder-menu summary{font-size:12px;padding:8px 6px;white-space:nowrap}
#tts-settings-root #voice-folder-menu-items{position:fixed;width:180px;z-index:100;right:auto}
#tts-settings-root #voice-folder-menu-items button{width:100%;text-align:left}
#tts-settings-root .voice-folders button{min-height:40px;max-width:100%}
#tts-settings-root #voice-folder-list{display:grid;gap:5px;max-height:360px;overflow:auto;margin-bottom:10px}
#tts-settings-root #voice-folder-list button{display:flex;justify-content:space-between;gap:6px;text-align:left;white-space:normal;overflow-wrap:anywhere}
#tts-settings-root #voice-folder-list button[aria-current=true]{background:#7132f533;border-color:#9463ec}
#tts-settings-root .voice-browser{min-width:0}
#tts-settings-root .voice-selection-bar{display:flex;align-items:center;flex-wrap:wrap;gap:6px;padding:0 0 10px}
#tts-settings-root .voice-selection-bar button{min-height:40px;padding:8px 11px;font-size:12px}
#tts-settings-root #voice-selected-count{font-size:12px;min-width:68px}
#tts-settings-root #delete-selected-voices{border-color:#b6505066;color:#f0aaaa}
#tts-settings-root .voice-error{color:#f0aaaa;font-size:11px}
#tts-dialogs #v-visit{display:block;margin-top:6px;padding:9px 12px;border:1px solid var(--line);border-radius:12px;text-align:center;text-decoration:none;color:var(--text);background:var(--surface)}
#tts-settings-root #voice-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(185px,1fr));gap:9px;align-content:start;padding:8px 4px;max-height:none;overflow:visible}
.main:has(#tts.active #tts-voices:not([hidden])),.main:has(#tts.active #tts-characters:not([hidden])){overflow:hidden;display:flex;flex-direction:column}
#tts.active:has(#tts-voices:not([hidden])),#tts.active:has(#tts-characters:not([hidden])){flex:1;min-height:0;display:flex;flex-direction:column}
#tts-settings-root:has(#tts-voices:not([hidden])),#tts-settings-root:has(#tts-characters:not([hidden])){flex:1;min-height:0;display:flex;flex-direction:column;padding-bottom:0}
#tts-settings-root:has(#tts-voices:not([hidden])) #tts-controls,#tts-settings-root:has(#tts-characters:not([hidden])) #tts-controls{flex:1;min-height:0;display:flex;flex-direction:column}
#tts-settings-root:has(#tts-voices:not([hidden])) .workspace,#tts-settings-root:has(#tts-characters:not([hidden])) .workspace{flex:1;min-height:0;display:flex;flex-direction:column}
#tts-settings-root .tabs{flex-shrink:0}
#tts-settings-root #tts-voices,#tts-settings-root #tts-characters{display:flex;flex-direction:column;flex:1;min-height:0;overflow:hidden}
#tts-settings-root #tts-voices>*,#tts-settings-root #tts-characters>*{flex-shrink:0}
#tts-settings-root #tts-voices .voice-explorer{flex:1;min-height:0}
#tts-settings-root .voice-browser{display:flex;flex-direction:column;min-height:0}
#tts-settings-root .voice-selection-bar{flex-shrink:0}
#tts-settings-root #voice-list{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;scrollbar-gutter:stable}
#tts-settings-root #character-list{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;align-content:start;padding:3px;scrollbar-gutter:stable}
#tts-settings-root .voice-folders{overflow:auto}
#tts-settings-root #voice-folder-toggle{display:none}
#tts-settings-root .voice-discovery{margin:0 0 0 auto}
#tts-settings-root #tts-off-notice{flex-shrink:0}
@media(max-width:768px){
 #tts-settings-root #tts-voices>.panel-title h2{display:none}
 #tts-settings-root #tts-voices .voice-explorer{grid-template-rows:auto minmax(0,1fr)}
 #tts-settings-root .voice-folders .folder-heading>b{display:none}
 #tts-settings-root #voice-folder-toggle{display:block}
 #tts-settings-root .voice-folders:not(.folders-open) #voice-folder-list,#tts-settings-root .voice-folders:not(.folders-open) #edit-voice-folder{display:none}
 #tts-settings-root .voice-folders.folders-open{max-height:170px}
 #tts-settings-root .folder-heading{margin:0}
 #tts-settings-root .voice-selection-bar button:disabled{display:none}
 #tts-settings-root #tts-voices>.toolbar{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px}
 #tts-settings-root #voice-search{grid-column:1/-1;min-width:0!important}
 #tts-settings-root #tts-voices>.toolbar select{max-width:none;width:100%}
 #tts-settings-root .counts{flex-wrap:wrap;gap:4px;margin-bottom:8px}
 #tts-settings-root .voice-discovery{font-size:11px}
}
@media(max-height:500px){
 #tts-settings-root #tts-voices .voice-command-bar{flex-wrap:nowrap;overflow-x:auto;min-height:46px;scrollbar-width:thin}
 #tts-settings-root #tts-voices .voice-command-bar>*{flex-shrink:0}
 #tts-settings-root #tts-voices .voice-command-bar .voice-search-wrap{flex:0 0 170px}
 .main:has(#tts.active #tts-voices:not([hidden])),.main:has(#tts.active #tts-characters:not([hidden])){padding-bottom:8px}
 #tts-settings-root #tts-voices,#tts-settings-root #tts-characters{padding:8px}
 #tts-settings-root .voice-tools{padding:0}
 #tts-settings-root #tts-voices>.panel-title h2,#tts-settings-root #tts-voices>.counts{display:none}
 #tts-settings-root #tts-voices>.panel-title,#tts-settings-root #tts-voices>.toolbar{margin-bottom:6px}
 #tts-settings-root .voice-selection-bar{flex-wrap:nowrap;overflow-x:auto;min-height:46px}
 #tts-settings-root .voice-selection-bar>*{flex-shrink:0}
 #tts-settings-root .voice-selection-bar button:disabled{display:none}
}
#tts-settings-root #voice-multiselect[aria-pressed=true]{background:#7132f53b;border-color:#a780ef;color:#e8dcff}
#tts-settings-root .voice-row{display:flex;position:relative;flex-direction:column;align-items:stretch;justify-content:flex-start;gap:7px;min-height:158px;padding:12px;border:1px solid var(--border);border-radius:12px;text-align:left;white-space:normal;background:var(--surface-2);color:var(--text);user-select:none}
#tts-settings-root .voice-row:hover{border-color:#a780ef;background:#7132f516}
#tts-settings-root .voice-row[aria-selected=true]{border-color:#aa82fa;background:#7132f530;box-shadow:inset 0 0 0 1px #7132f566}
#tts-settings-root .voice-row:focus-visible{outline:2px solid #c4a6ff;outline-offset:1px}
#tts-settings-root #voice-list{grid-auto-rows:max-content;align-items:start}
#tts-settings-root #voice-list .voice-row{width:100%;aspect-ratio:1;min-height:0;gap:4px;overflow:hidden;align-self:start}
#tts-settings-root .voice-name,#tts-settings-root .voice-tags{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;line-height:1.4}
#tts-settings-root .voice-row .duplicate{position:absolute;bottom:10px;right:10px;max-width:60px;background:var(--surface-2);line-height:1.2}
#tts-settings-root .voice-folder-label{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#tts-settings-root .voice-row:has(.duplicate) .voice-folder-label{max-width:55%}
#tts-settings-root .voice-command-bar{display:flex;align-items:center;flex-wrap:wrap;gap:6px;margin-bottom:12px;flex-shrink:0}
#tts-settings-root .voice-command-bar .voice-search-wrap{position:relative;flex:1;min-width:170px}
#tts-dialogs .character-main-fields{grid-column:1/-1;display:grid;grid-template-columns:minmax(0,1fr) 110px minmax(0,1fr) minmax(0,1fr);gap:0 12px}
@media(max-width:768px){#tts-dialogs .character-main-fields{grid-template-columns:repeat(2,minmax(0,1fr))}}
#tts-dialogs .character-main-fields>.field{padding:10px 0;border-bottom:1px solid var(--line)}
#tts-dialogs .identity-fields{grid-column:1/-1;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
@media(max-width:768px){#tts-dialogs .identity-fields{grid-template-columns:repeat(2,minmax(0,1fr))}}
[data-preview-only=true]{color:#ff92c4!important}
button[data-preview-only=true],a[data-preview-only=true]{background:rgba(236,72,153,.15)!important;border:1px solid #a94375!important}
button[data-preview-only=true]:hover,a[data-preview-only=true]:hover{background:rgba(236,72,153,.29)!important;border-color:#ff92c4!important}
button[data-preview-only=true]:focus-visible,a[data-preview-only=true]:focus-visible{outline:2px solid #ff92c4;outline-offset:2px}
#chat-preview .chat-preview-symbol{display:none}
@media(max-width:768px){#chat-preview .chat-preview-label{display:none}#chat-preview .chat-preview-symbol{display:inline}#chat-preview{flex-shrink:0}}
#tts-settings-root .voice-search-wrap #voice-search{width:100%;min-width:0!important;padding-right:38px}
#tts-settings-root .voice-search-wrap #clear-voice-search{position:absolute;right:3px;top:50%;transform:translateY(-50%);width:34px;min-height:34px;padding:0;font-size:21px;background:transparent;border:0}
#tts-settings-root .voice-search-wrap #clear-voice-search:hover{background:#7132f540}
#tts-settings-root .character-command-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:12px;min-width:0}
#tts-settings-root .character-jev-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:12px 0 0;margin-top:8px;border-top:1px solid var(--border);font-size:12px;background:var(--surface);flex-shrink:0}
#tts-settings-root .character-jev-bar label{display:flex;align-items:center;gap:6px}
#tts-settings-root .character-jev-bar select{width:150px}
#tts-settings-root .character-jev-bar button{min-height:40px;font-size:12px}
#tts-settings-root .character-jev-bar small{display:none}
#tts-settings-root .char-batch-check{position:absolute;left:10px;top:10px;z-index:3;width:22px;height:22px;display:grid;place-items:center;border:1px solid #a990da;border-radius:5px;background:#101622bb}
#tts-settings-root .char-card.tile-selected .char-batch-check{background:#7132f5;color:white}
#tts-settings-root #batch-jev-characters[aria-pressed=true]{background:#7132f566;border-color:#aa80ff}
@media(max-width:768px){#tts-settings-root .character-command-bar .actions{flex-wrap:wrap!important}#tts-settings-root .character-command-bar .actions button{flex:1 1 40%!important}}
#tts-chat-stage .illustration-preview{margin:24px 0;max-width:640px}
#tts-chat-stage .illustration-preview>img{display:block;width:100%;border-radius:12px}
#tts-chat-stage .illustration-preview figcaption{font-size:11px;color:#9497a9;margin:7px 0}
#tts-chat-stage .illustration-readbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
#tts-chat-stage .illustration-readbar>button{min-height:44px}
#tts-chat-stage .illustration-readbar{flex-wrap:nowrap;overflow-x:auto}
#tts-chat-stage .illustration-chip{white-space:nowrap;flex-shrink:0}
#tts-chat-stage .illustration-chip[aria-pressed=true]{border-color:#a881ff;background:#7132f550}
#tts-settings-root .character-command-bar h2{font-size:14px;white-space:nowrap;margin:0}
#tts-settings-root .character-command-bar #char-search{flex:1;min-width:140px;width:auto}
#tts-settings-root .character-command-bar #char-scope-filter{width:auto;max-width:115px}
#tts-settings-root .character-command-bar .actions{flex-wrap:nowrap;gap:6px}
#tts-settings-root .character-command-bar button{font-size:12px;min-height:40px;padding:8px 10px;white-space:nowrap}
@media(min-width:1200px){#tts-settings-root .character-command-bar{flex-wrap:nowrap}}
@media(max-width:768px){#tts-settings-root .character-jev-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:12px 0 0;margin-top:8px;border-top:1px solid var(--border);font-size:12px;background:var(--surface);flex-shrink:0}
#tts-settings-root .character-jev-bar label{display:flex;align-items:center;gap:6px}
#tts-settings-root .character-jev-bar select{width:150px}
#tts-settings-root .character-jev-bar button{min-height:40px;font-size:12px}
#tts-settings-root .character-jev-bar small{display:none}
#tts-settings-root .char-batch-check{position:absolute;left:10px;top:10px;z-index:3;width:22px;height:22px;display:grid;place-items:center;border:1px solid #a990da;border-radius:5px;background:#101622bb}
#tts-settings-root .char-card.tile-selected .char-batch-check{background:#7132f5;color:white}
#tts-settings-root #batch-jev-characters[aria-pressed=true]{background:#7132f566;border-color:#aa80ff}
@media(max-width:768px){#tts-settings-root .character-command-bar .actions{flex-wrap:wrap!important}#tts-settings-root .character-command-bar .actions button{flex:1 1 40%!important}}
#tts-chat-stage .illustration-preview{margin:24px 0;max-width:640px}
#tts-chat-stage .illustration-preview>img{display:block;width:100%;border-radius:12px}
#tts-chat-stage .illustration-preview figcaption{font-size:11px;color:#9497a9;margin:7px 0}
#tts-chat-stage .illustration-readbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
#tts-chat-stage .illustration-readbar>button{min-height:44px}
#tts-chat-stage .illustration-readbar{flex-wrap:nowrap;overflow-x:auto}
#tts-chat-stage .illustration-chip{white-space:nowrap;flex-shrink:0}
#tts-chat-stage .illustration-chip[aria-pressed=true]{border-color:#a881ff;background:#7132f550}
#tts-settings-root .character-command-bar h2{display:none}#tts-settings-root .character-command-bar .actions{width:100%}#tts-settings-root .character-command-bar .actions button{flex:1;padding:8px 5px}}
#tts-settings-root .voice-command-bar select{width:auto;max-width:115px}
#tts-settings-root .voice-command-bar #voice-count{font-size:11px;color:var(--muted);white-space:nowrap}
#tts-settings-root .voice-command-bar .voice-tools{padding:0;gap:5px;flex-wrap:nowrap}
#tts-settings-root .voice-command-bar button,#tts-settings-root .voice-command-bar .file-menu summary{font-size:12px;min-height:40px;padding:8px 10px}
#tts-settings-root .voice-command-bar>a{font-size:12px;white-space:nowrap;padding:8px 4px}
#tts-settings-root .voice-picking .voice-selection-bar>button:not(#apply-picked-voice):not(#cancel-picked-voice){display:none}
#tts-settings-root .voice-picking .voice-tools{display:none}
#tts-settings-root .voice-picking .voice-check{display:none}
@media(min-width:1200px){#tts-settings-root .voice-command-bar{flex-wrap:nowrap}}
@media(max-width:768px){#tts-settings-root .voice-command-bar .voice-search-wrap{flex-basis:100%}#tts-settings-root .voice-command-bar .voice-tools{flex-wrap:wrap}#tts-settings-root #voice-list .voice-row{padding:10px}#tts-settings-root .voice-name{font-size:12px}}
#tts-settings-root .voice-tile-top{display:flex;align-items:center;gap:8px;font-size:11px;min-height:24px}
#tts-settings-root .voice-check{width:24px;height:24px;display:grid;place-items:center;border:1px solid #ffffff44;border-radius:6px;color:#d4bdff}
#tts-settings-root .voice-narrator-badge{margin-left:auto;color:#baddce;font-size:10px}
#tts-settings-root .voice-folder-label{margin-top:auto;font-size:10px;color:#c9b4ec;overflow-wrap:anywhere}
#tts-settings-root .voice-name{overflow-wrap:anywhere}
#tts-settings-root .voice-tags{line-height:1.5}
#tts-settings-root .voice-id{display:none}
#tts-settings-root .voice-list>.empty{grid-column:1/-1}
#tts-dialogs .dialog-actions button{min-height:42px;padding:10px 16px}
#tts-dialogs dialog.editor-sheet{position:fixed;inset:auto 0 0;margin:0 auto;width:min(1120px,100vw);max-width:100vw;height:80dvh;max-height:100dvh;padding:0;border-radius:16px 16px 0 0;overflow:hidden;box-shadow:0 -12px 40px #0007;background:var(--surface)}
#tts-dialogs dialog.editor-sheet[open],#tts-dialogs .editor-sheet form{display:flex;flex-direction:column;min-height:0}
#tts-dialogs .editor-sheet form{height:100%;width:100%}
#tts-dialogs .editor-sheet .dialog-head{display:block;padding:0;margin:0;flex-shrink:0}
#tts-dialogs .editor-sheet .editor-fold{width:100%;min-height:64px;padding:12px;border:1px solid #7132f577;border-radius:16px 16px 0 0;background:#7132f52b;color:#ba97ff;font-weight:600;font-size:16px}
#tts-dialogs .editor-scroll{flex:1;min-height:0;overflow:auto;padding:0 12px 16px;overscroll-behavior:contain}
#tts-dialogs .editor-scroll>.fields{grid-template-columns:repeat(3,minmax(0,1fr));gap:0 12px}
#tts-dialogs .editor-scroll>.fields>.field{padding:12px 0;border-bottom:1px solid var(--line)}
#tts-dialogs .editor-scroll>.field{padding:12px 0;border-bottom:1px solid var(--line)}
#tts-dialogs .editor-scroll>.source-choices{margin:0;padding:12px 0;border-bottom:1px solid var(--line)}
#tts-dialogs .editor-scroll>p{margin:12px 0}
#tts-dialogs .editor-scroll input,#tts-dialogs .editor-scroll select{min-height:40px;background:var(--surface2)}
#tts-dialogs .editor-scroll input[type=checkbox]{min-height:18px}
#tts-dialogs .editor-scroll .switch input{background:var(--line)}
#tts-dialogs .editor-scroll .switch input:checked{background:var(--purple)}
#tts-dialogs .editor-scroll small{display:block;margin-top:8px}
#tts-dialogs .editor-sheet .dialog-actions{padding:10px 12px;margin:0;border-top:1px solid var(--line);flex-shrink:0;background:var(--surface)}
#tts-dialogs #delete-character{margin-right:auto}
#tts-dialogs .editor-sheet #bulk-results,#tts-dialogs .editor-sheet #voice-organization-results{max-height:none;overflow:visible}
@media(max-width:768px){#tts-dialogs dialog.editor-sheet{height:90dvh}#tts-dialogs .editor-scroll>.fields{grid-template-columns:repeat(2,minmax(0,1fr))}#tts-dialogs .editor-sheet .editor-fold{min-height:48px}}
#tts-dialogs .review-names{max-height:160px;overflow:auto;font-size:12px;margin:12px 0;white-space:pre-wrap;overflow-wrap:anywhere}

#tts-dialogs #voice-organization-results{margin-top:10px}
#tts-dialogs .organization-row{display:grid;grid-template-columns:24px minmax(0,1fr) minmax(100px,.7fr);gap:8px;padding:10px 0;border-top:1px solid var(--line)}
#tts-dialogs .organization-row small{grid-column:2/-1;overflow-wrap:anywhere}
@media(max-width:768px){#tts-settings-root .voice-explorer{grid-template-columns:minmax(0,1fr)}#tts-settings-root .voice-folders{border:0;padding:0}#tts-settings-root #voice-folder-list{display:flex;flex-wrap:wrap;max-height:150px}#tts-settings-root #voice-folder-list button{flex:0 1 auto}#tts-settings-root #voice-list{grid-template-columns:repeat(auto-fill,minmax(145px,1fr));max-height:none}#tts-settings-root .voice-row{min-height:160px}#tts-dialogs .organization-row{grid-template-columns:24px minmax(0,1fr)}#tts-dialogs .organization-row .organization-folder{grid-column:2}}
#tts-settings-root .tts-demo input{background:var(--surface-2)}
#tts-settings-root a,#tts-chat-stage a{color:#b697ff}
#tts-settings-root .char-card{position:relative;isolation:isolate;display:flex;flex-direction:column;justify-content:flex-end;min-height:254px;padding:12px;background:transparent;gap:8px}
#tts-settings-root .char-card:after{content:'';position:absolute;inset:0;background:linear-gradient(transparent 20%,#080d1833 45%,#080d187d 100%);z-index:-1;pointer-events:none}
#tts-settings-root .reference-preview{position:absolute;inset:0;height:auto;margin:0;z-index:-2;border-radius:inherit}
#tts-settings-root .reference-preview img{object-position:center}
#tts-settings-root .reference-preview small{display:none}
#tts-settings-root .empty-reference{align-items:start;padding-top:72px}
#tts-settings-root .char-card .chips{position:absolute;top:10px;right:10px;justify-content:flex-end;margin:0;max-width:85%;max-height:65px;overflow:auto}
#tts-settings-root .char-card .chip{background:#0a102066;color:#e4dcff;border:1px solid #ffffff24}
#tts-settings-root .char-head,#tts-settings-root .char-detail{background:transparent;text-shadow:0 1px 3px #000}
#tts-settings-root .char-card .avatar{display:none}
#tts-settings-root .char-card{cursor:pointer}
#tts-settings-root .char-card:hover{border-color:#9871df}
#tts-settings-root .char-card.tile-selected{outline:2px solid #a477f4;outline-offset:-2px}
#tts-settings-root .char-card:focus-visible{outline:2px solid #d4bfff;outline-offset:2px}
#tts-settings-root #character-list{grid-auto-rows:max-content;align-items:start;grid-template-columns:repeat(auto-fill,minmax(185px,1fr))}
#tts-settings-root #character-list .char-card{width:100%;aspect-ratio:1;min-height:0;align-self:start}
#tts-settings-root .char-head{padding-right:66px;min-width:0}
#tts-settings-root .char-head>div{min-width:0}
#tts-settings-root .char-head b{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#tts-settings-root .char-voice-label{display:block;font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:3px;color:#ddd7ef}
#tts-settings-root .tile-audition{position:absolute;right:9px;bottom:9px;min-width:58px;min-height:40px;padding:7px 8px;font-size:12px;background:#101622c9;border-color:#ffffff30;z-index:1}
#tts-settings-root .tile-audition:hover{background:#7132f570;border-color:#b697ff}
#tts-settings-root #voice-list .voice-row{padding-bottom:52px}
#tts-settings-root .voice-row .voice-folder-label{position:absolute;bottom:14px;left:10px;right:76px;padding:0;margin:0}
#tts-settings-root .voice-row .duplicate{top:12px;bottom:auto;right:10px}
#tts-settings-root .voice-row:has(.duplicate) .voice-narrator-badge{margin-right:62px}
@media(max-width:768px){#tts-settings-root #character-list{grid-template-columns:repeat(auto-fill,minmax(145px,1fr))}#tts-settings-root .tile-audition{min-height:44px}#tts-settings-root .voice-tags{-webkit-line-clamp:1}}
#tts-settings-root .char-detail{margin:0;gap:4px}
#tts-settings-root .char-card .muted,#tts-settings-root .char-detail{color:#d2d6e3}
#tts-settings-root .scope-label{display:block;color:#d5c4ff;font-size:10px}
#tts-dialogs .source-choices{display:flex;flex-wrap:wrap;gap:16px;margin:18px 0}
#tts-dialogs .source-choices label{display:flex;align-items:center;gap:7px}
#tts-settings-root .char-head button{background:#10162255;min-height:38px}
#tts-settings-root .character-volume{display:flex;align-items:center;gap:7px;font-size:11px;margin-top:3px}
#tts-settings-root .character-volume input{flex:1;min-width:0;height:28px}
#tts-settings-root .character-volume output{min-width:44px;text-align:right;font-variant-numeric:tabular-nums}
#translation-connection{margin-top:16px;border-top:1px solid var(--border)}
#translation-connection>summary{cursor:pointer;padding:13px 0;color:#c9b4ff;font-weight:600}
#translation-connection .group{margin:0!important;background:transparent!important;border:0!important;padding:0!important}
#tts-settings-root .badge{color:#b697ff}
#tts-chat-stage{position:fixed;inset:0;overflow:hidden;background:#0b0e16;color:#e7e9f0}
#tts-chat-stage .risu-top{height:58px;display:flex;align-items:center;justify-content:space-between;padding:0 24px;background:#121824;border-bottom:1px solid #293144}
#tts-chat-stage .risu-top small{font-size:12px;font-weight:400;color:#9497a9}
#tts-chat-stage .risu-layout{display:grid;grid-template-columns:220px 1fr;height:calc(100dvh - 58px)}
#tts-chat-stage .risu-sidebar{padding:30px 20px;background:#101622;border-right:1px solid #293144}
#tts-chat-stage .risu-sidebar p{font-size:12px;color:#9497a9;margin:8px 0 30px}
#tts-chat-stage .risu-avatar{height:150px;background:#22223b;display:grid;place-items:center;border-radius:14px;color:#cbb8f6;font-size:24px;margin-bottom:18px}
#tts-chat-stage .risu-chat-title{background:#1c2232;padding:12px;border-radius:10px;font-size:13px;margin-bottom:18px}
#tts-chat-stage .risu-messages{overflow:auto;padding:25px max(24px,calc((100vw - 1100px)/2)) 180px;min-width:0}
#tts-chat-stage .chat-demo-note{font-size:12px;color:#9497a9;margin:0 0 25px}
#tts-chat-stage .user-bubble{margin:0 0 35px auto;background:#1c2334;border-radius:14px;padding:16px 20px;max-width:560px}
#tts-chat-stage .user-bubble p{margin-top:6px}
#tts-chat-stage .bot-bubble{max-width:850px}
#tts-chat-stage .speaker-head{display:flex;align-items:center;gap:12px;margin-bottom:18px}
#tts-chat-stage .speaker-head>span{background:#302842;color:#cbb8f6;border-radius:11px;width:38px;height:38px;display:grid;place-items:center}
#tts-chat-stage .speaker-head small{font-size:11px}
#tts-chat-stage .reader{position:static;background:transparent;border:0;border-radius:0;overflow:visible}
#tts-chat-stage .reader-head{padding:0 0 10px;border:0}
#tts-chat-stage .reader-body{padding:0;display:block}
#tts-chat-stage .chapter{display:none}
#tts-chat-stage .passage{font-size:17px;line-height:2;padding:8px 0 8px 14px;margin:5px 0;border-radius:0;background:transparent}
#tts-chat-stage .lineplay{position:static;display:inline-flex;align-items:center;justify-content:center;vertical-align:middle;margin-left:5px;width:36px;height:36px;opacity:.85;transform:none;font-size:16px;color:#baa0f4;border:1px solid #8d72bb40;background:#7132f512}
#tts-chat-stage .lineplay{transition:background .12s,border-color .12s,color .12s,box-shadow .12s}
#tts-chat-stage .lineplay:hover:not(:disabled),#tts-chat-stage .lineplay:focus-visible{background:#7132f580;border-color:#ba94ff;color:#fff;opacity:1;box-shadow:0 0 0 2px #7132f528}
#tts-chat-stage .lineplay:active:not(:disabled){background:#7132f5;color:white;box-shadow:inset 0 1px 4px #0005}
#tts-chat-stage .passage.selected .lineplay{background:#7132f55c;border-color:#a67bff;color:#fff;opacity:1}
#tts-chat-stage .passage:has(.lineplay:focus-visible):before{opacity:.2}
#tts-chat-stage .reader-foot{margin-top:20px;border-radius:12px}
#tts-chat-stage .chat-compose{margin-top:36px;padding:15px 18px;background:#161d2b;border:1px solid #293144;border-radius:12px;display:flex;align-items:center;justify-content:space-between;gap:12px}
#tts-chat-stage .chat-compose span{font-size:13px;color:#9497a9}
#tts-chat-stage .player{z-index:150;width:302px;background:rgba(16,22,34,.55);backdrop-filter:none;box-shadow:none;border-color:#ffffff26;border-radius:12px;max-height:calc(100dvh - 24px);overflow:auto;text-shadow:0 1px 3px #000,0 0 5px #000}
#tts-chat-stage .player-top,#tts-chat-stage .player-content{background:transparent}
#tts-chat-stage .player button,#tts-chat-stage .player select{background:#11182780}
#tts-chat-stage .player .transport .primary{background:#7132f5b3}
#tts-chat-stage .player button:hover{background:#7132f580}
#tts-chat-stage .player-top{padding:4px 8px;cursor:grab;gap:4px;justify-content:flex-start}
#tts-chat-stage #minimize{margin-left:auto}
#tts-chat-stage .player-top button{width:38px;height:36px;flex:none;font-size:16px;border-radius:8px}
#tts-chat-stage .player-top #speed-chip{font-size:12px}
#tts-chat-stage .player-top #player-open-settings{margin-left:auto;flex-shrink:0}
#tts-chat-stage .player-top #minimize{margin-left:0;flex-shrink:0}
#tts-chat-stage .player-state{width:22px;flex:none;text-align:center;font-size:15px;color:#d9c9ff}
#tts-chat-stage .player-chip[aria-pressed=true],#tts-chat-stage .player-chip[aria-expanded=true]{background:#7132f580;border:1px solid #b597f880;color:#fff}
#tts-chat-stage .player-chip[aria-pressed=false]{opacity:.6}
#tts-chat-stage .player-chip:hover,#tts-chat-stage #minimize:hover{background:#7132f5a0;color:white}
#tts-chat-stage .player-top .badge{font-size:9px}
#tts-chat-stage .player-content{padding:6px 10px}
#tts-chat-stage .transport{display:grid;grid-template-columns:44px minmax(0,1fr) 44px;gap:0;margin:5px 0}
#tts-chat-stage #player-continuous{grid-column:1;justify-self:start}
#tts-chat-stage .transport-main{grid-column:2;display:flex;justify-content:center;gap:5px}
#tts-chat-stage #stop{grid-column:3;justify-self:end}
#tts-chat-stage .transport button{width:44px;height:44px}
#tts-chat-stage .now-line{display:flex;align-items:baseline;gap:4px;white-space:nowrap;min-width:0;font-size:12px}
#tts-chat-stage #now-name{max-width:43%;overflow:hidden;text-overflow:ellipsis;flex:none;font-size:11px}
#tts-chat-stage #now-text{overflow:hidden;text-overflow:ellipsis;min-width:0}
#tts-chat-stage .player-panel{padding-top:8px;margin-top:6px;border-top:1px solid #ffffff24}
#tts-chat-stage .player.miniplayer{width:38px;min-width:0;height:38px;border:0;overflow:hidden}
#tts-chat-stage .miniplayer .player-top{padding:0;border:0;justify-content:center}
#tts-chat-stage .miniplayer #minimize{margin-left:0}
#tts-chat-stage .miniplayer .player-top>:not(#minimize){display:none}
#tts-chat-stage .timeline{margin-bottom:5px}
#tts-dialogs .source-option-group{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:12px 0;border-bottom:1px solid var(--line)}
#tts-dialogs .source-option-group>b{color:var(--muted);font-size:12px;min-width:64px}
#tts-dialogs .source-option-group .switch{font-size:12px}
#tts-dialogs #character-source-dialog .source-config{grid-template-columns:1fr 1fr;margin-top:10px}
#tts-dialogs .source-review-head{display:flex;align-items:center;gap:12px;margin-top:14px;font-size:12px}
#tts-dialogs .source-help{margin-left:auto;color:var(--muted);font-size:11px}
#tts-dialogs .source-help summary{cursor:pointer}
#tts-dialogs .source-help p{max-width:520px;font-size:11px;margin-top:6px}
#tts-dialogs #source-status{margin:8px 0;font-size:11px;color:var(--muted)}
#tts-dialogs .source-demo-label{margin-right:auto;color:var(--muted);font-size:11px}
#tts-dialogs #character-voice-suggestions button[aria-pressed=true]{background:#7132f54d;border-color:#a77cf5}
@media(max-width:600px){#tts-dialogs .source-option-group{gap:10px}#tts-dialogs .source-option-group>b{width:100%}#tts-dialogs .source-demo-label{width:100%}#tts-dialogs #character-source-dialog .source-config{grid-template-columns:1fr}}
#tts-dialogs dialog{z-index:160}
#tts-dialogs .toast{z-index:170}
#tts-dialogs #toast{width:290px;height:62px;padding:10px 12px;display:grid;grid-template-columns:30px minmax(0,1fr);gap:0 6px;align-content:center;overflow:hidden;box-sizing:border-box;background:rgba(23,32,49,.93)}
#tts-dialogs #toast-text{font-size:12px;line-height:18px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}
#tts-dialogs #toast progress{position:absolute;left:12px;bottom:4px;width:calc(100% - 24px);margin:0}
#tts-chat-stage #player-cache-status{font-size:11px;margin:7px 0}
#tts-chat-stage #player-cache-progress{width:100%;height:5px;accent-color:#a580ed}
@media(max-width:768px){
 #tts-settings-root .panel{padding:12px}
 #tts-settings-root .group{padding:10px 12px}
 #tts-settings-root .tabs button{padding:10px 8px;font-size:12px}
 #tts-settings-root .row .control{width:125px}
 #tts-chat-stage .risu-layout{grid-template-columns:1fr}
 #tts-chat-stage .risu-sidebar{display:none}
 #tts-chat-stage .risu-top{padding:0 14px}
 #tts-chat-stage .risu-messages{padding:18px 15px 280px}
 #tts-chat-stage .passage{font-size:16px}
 #tts-chat-stage .lineplay{width:44px;height:44px}
 #tts-chat-stage .player{width:290px;right:12px;bottom:12px}
}
`;
const runtime=parts.runtime.replaceAll('[data-tab]','[data-tts-tab]').replaceAll('b.dataset.tab','b.dataset.ttsTab').replaceAll('all[next].dataset.tab','all[next].dataset.ttsTab').replaceAll("$('image-power')","$('nx-power')")
 .replace("if($('hover-play').checked)startAt(i)","if($('hover-play').checked)startAt(i,'hover')")
 .replace("if($('auto-play').checked)startAt(eligible()[0])","if($('auto-play').checked)startAt(eligible()[0],'auto')");
const bridge=`
const settingsStage=document.getElementById('settings-stage');
const chatStage=document.getElementById('tts-chat-stage');

function showChat(on){
 settingsStage.hidden=on;chatStage.hidden=!on;
 document.body.classList.remove('nav-open');
 history.replaceState(null,'',on?'#chat':'#tts');
}
document.getElementById('back-settings').onclick=()=>{document.querySelector('#nav [data-tab="tts"]').click();showChat(false);};
document.getElementById('nx-close').onclick=()=>showChat(true);
document.getElementById('chat-preview').onclick=()=>showChat(true);
document.getElementById('player-open-settings').onclick=()=>{document.querySelector('#nav [data-tab="tts"]').click();document.getElementById('tab-settings').click();showChat(false);};
for(const id of ['audio-enable-settings','audio-enable-chat'])document.getElementById(id).onclick=()=>{pendingStart=null;document.getElementById('audio-unlock-dialog').showModal();};
document.getElementById('audio-unlock-dialog').addEventListener('cancel',()=>{interruptPlayback();});
document.getElementById('audio-unlock-cancel').onclick=()=>{interruptPlayback();document.getElementById('audio-unlock-dialog').close();};
document.getElementById('audio-unlock-confirm').onclick=()=>{audioReady=true;document.getElementById('audio-enable-settings').setAttribute('aria-pressed','true');document.getElementById('audio-enable-chat').textContent='음성 활성화됨 · 시안';document.getElementById('audio-unlock-dialog').close();const next=pendingStart;pendingStart=null;if(next!==null&&next.intent===playbackIntent){showChat(true);if(next.illustration)requestIllustration(next.i);else startAt(next.i,'click',next.source);}notify('음성 시작 절차의 화면 시안입니다. 실제 오디오는 재생하지 않습니다.');};
document.querySelector('#nav [data-tab="tts"]').click();
document.getElementById('live').textContent='검수 시안 · 저장 안 함';
for(const selector of ['#chat-preview','#back-settings','#simulate-reply','#restore-player','#test-toast','#bulk-example','#live','.reader-foot','a[href="tts-1.2-plan.html"]','a[href="tts-1.2-module.draft.json"]'])document.querySelectorAll(selector).forEach(element=>{element.dataset.previewOnly='true';element.title=[element.title,'검수 전용 · 실제 제품에 포함하지 않음'].filter(Boolean).join(' · ');});
document.getElementById('nx-help-toggle').addEventListener('click',()=>{
 if(document.body.classList.contains('help-on')&&document.getElementById('tts').classList.contains('active'))setHeadHelp(HELP['tts-settings-root']);
});
document.querySelector('.main').addEventListener('focusin',event=>paintHelp(event.target));
if(location.hash==='#chat')showChat(true);
`;
if(!parts.html.includes('    const HELP_ALIAS = {'))throw Error('Existing settings help integration point changed');
parts.html=parts.html.replace('    const HELP_ALIAS = {','    Object.assign(HELP,'+JSON.stringify(parts.help).replaceAll('<','\\u003c')+');\n    const HELP_ALIAS = {');
let out=parts.html.replace('</head>','<style>\n'+cssRoot.toString()+'\n'+overrides+'\n</style></head>').replaceAll('live.textContent = "저장됨"','live.textContent = "검수 시안 · 저장 안 함"').replaceAll('live.textContent = "바로 저장됨"','live.textContent = "검수 시안 · 저장 안 함"');
out=out.replace('</body>','<script>\n(()=>{\n'+runtime+'\n'+bridge+'\n})();\n</script></body>');
await writeFile('docs/tts-1.2-preview.html',out);
console.log('Built TTS review on the exact current settings shell; separate #chat Risu mock screen.');
