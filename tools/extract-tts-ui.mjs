import {readFile,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';

// Accepted review layout only. None of the review's scripts or sample data ship.
const html=await readFile('docs/tts-1.2-preview.html','utf8');
const browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
try {
  const page=await browser.newPage();
  const pack=await page.evaluate(html=>{
    const doc=new DOMParser().parseFromString(html,'text/html');
    const root=doc.getElementById('tts-settings-root'),dialogs=doc.getElementById('tts-dialogs');
    if(!root||!dialogs)throw Error('TTS layout missing');
    for(const scope of [root,dialogs]) {
      scope.querySelectorAll('script,#test-toast,#bulk-example,#toast,[data-preview-only]').forEach(el=>el.remove());
      scope.querySelectorAll('button').forEach(el=>{for(const child of el.childNodes)if(child.nodeType===3)child.textContent=child.textContent.replaceAll(' · 시안','').replaceAll('시안에 적용','적용');});
      scope.querySelectorAll('p,small,.hint').forEach(el=>{if(/시안|예시|미연결|구현 예정|검수용|저장된 실제 음성은 없습니다/.test(el.textContent))el.remove();});
      scope.querySelectorAll('input,textarea').forEach(el=>{el.removeAttribute('value');if(el.tagName==='TEXTAREA')el.textContent='';if(/시안|검수/.test(el.getAttribute('placeholder')||''))el.setAttribute('placeholder',el.type==='password'?'API 키 입력':'');});
    }
    for(const el of root.querySelectorAll('input,select')) {
      if(el.id)continue;
      const label=el.getAttribute('aria-label')||'';
      const ids={'목소리 크기 자동 조절':'tts-normalize','Fish API Key':'tts-fish-key','Fish 모델':'tts-fish-model','출력 형식':'tts-format','보조 LLM 모델 이름':'tts-llm-model','보조 LLM API URL':'tts-llm-url','보조 LLM API Key':'tts-llm-key','Google API Key':'tts-google-key','DeepL 플랜':'tts-deepl-plan','DeepL API Key':'tts-deepl-key','번역 API URL':'tts-translation-url','번역 모델 이름':'tts-translation-model','번역 API Key':'tts-translation-key'};
      if(ids[label])el.id=ids[label];
    }
    const format=root.querySelector('#tts-format');if(format)format.closest('label')?.remove();
    root.querySelector('#line-mark')?.closest('.row')?.remove();
    const activation=root.querySelector('#audio-enable-settings'),reading=root.querySelector('#tts-help-4');
    if(activation&&reading){const row=doc.createElement('div');row.className='row';row.innerHTML='<div class="copy"><b>음성 재생</b></div>';row.append(activation);reading.querySelector('h3').after(row);}
    reading?.insertAdjacentHTML('beforeend','<label class="row"><div class="copy"><b>생성에서 제외할 글자 수</b></div><div class="control"><input id="tts-skip-chars" type="number" min="0" max="8000" step="1" aria-label="TTS 생성에서 제외할 글자 수" style="width:76px"><span>자 이하</span></div></label>');
    // Same comma list as the dashboard field; both write settings.excludeText.
    reading?.insertAdjacentHTML('beforeend','<div class="row tts-exclude-row" style="flex-direction:column;align-items:stretch;gap:6px"><div class="copy"><b>이 텍스트 포함하면 생성 안 함</b></div><textarea id="tts-exclude-text" rows="3" maxlength="4000" aria-label="이 텍스트 포함하면 TTS 생성 안 함 · 쉼표로 구분" placeholder="예: 상태창, 시스템 안내" style="width:100%;box-sizing:border-box;resize:vertical"></textarea></div>');
    // Descriptions live in the ? help panel, not under the controls.
    reading?.insertAdjacentHTML('beforeend','<div class="row"><div class="copy"><b>숫자·기호만 있는 줄 건너뛰기</b></div><label class="switch"><input id="skip-symbol-only" type="checkbox" checked aria-label="숫자·기호만 있는 줄 건너뛰기"></label></div>');
    reading?.insertAdjacentHTML('beforeend','<label class="row" style="flex-direction:column;align-items:stretch;gap:6px"><div class="copy"><b>생략할 문자들</b></div><input id="tts-omit-characters" type="text" maxlength="4000" aria-label="생략할 문자들 · 쉼표로 구분" placeholder="예: [, ], 【, 】" style="width:100%;box-sizing:border-box"></label>');
    const fish=root.querySelector('#tts-fish-key');
    fish?.closest('.field')?.insertAdjacentHTML('afterend','<label class="field"><span>Fish API URL</span><input id="tts-fish-url" type="url" aria-label="Fish API URL"></label>');
    const fishModel=root.querySelector('#tts-fish-model');
    if(fishModel){fishModel.innerHTML=[...['s2.1-pro','s2.1-pro-free','s2-pro','s1','drama-3'].map(model=>`<option value="${model}">${model}</option>`),'<option value="custom">직접 입력</option>'].join('');
      fishModel.closest('.field')?.insertAdjacentHTML('afterend','<label class="field" id="tts-fish-model-custom-wrap" hidden><span>음성 생성 모델 이름</span><input id="tts-fish-model-custom" maxlength="80" placeholder="예: s2.2-pro" aria-label="음성 생성 모델 직접 입력"></label>');}
    for(const id of ['character-list','voice-list','voice-folder-list'])root.querySelector('#'+id)?.replaceChildren();
    root.querySelector('#cache-usage').textContent='';
    dialogs.querySelector('#source-intro')?.remove();
    // One bottom bar that is always there: selection mode on the left, and the
    // selection tools (all/none/delete/JEV) only while selecting.
    const selectBar=root.querySelector('#character-jev-bar'),selectToggle=root.querySelector('#batch-jev-characters');
    if(selectBar&&selectToggle){
      selectBar.removeAttribute('hidden');selectToggle.textContent='선택 모드';
      const tools=doc.createElement('span');tools.id='character-batch-tools';tools.className='character-batch-tools';tools.hidden=true;
      // The exploration folder is a standing choice for every assignment, so it lives in the command bar.
      const folderSelect=selectBar.querySelector('#character-jev-folder');
      if(folderSelect){selectBar.querySelector('label:has(#character-jev-folder)')?.remove();folderSelect.setAttribute('aria-label','음성 탐색 폴더');folderSelect.title='LLM·JEV가 음성을 고를 때 살펴볼 폴더';folderSelect.style.cssText='width:auto;max-width:115px';root.querySelector('#char-scope-filter')?.after(folderSelect);}
      for(const node of [selectBar.querySelector('#character-jev-all'),selectBar.querySelector('#character-jev-clear')])if(node)tools.append(node);
      const clear=tools.querySelector('#character-jev-clear');if(clear)clear.textContent='전체 해제';
      tools.insertAdjacentHTML('beforeend','<button id="character-delete-selected" class="danger" disabled>삭제</button>');
      const apply=selectBar.querySelector('#character-jev-apply');if(apply){apply.textContent='JEV 음성 배정';tools.append(apply);}
      selectBar.querySelector('#character-jev-cancel')?.remove();
      selectBar.querySelector('#character-jev-count')?.after(selectToggle);
      selectBar.append(tools);
    }
    // Non-global TTS characters belong to the bot (its lorebook), not one chat.
    for(const option of [...root.querySelectorAll('#char-scope-filter option[value="chat"]'),...dialogs.querySelectorAll('#c-scope option[value="chat"],#source-scope option[value="chat"]')])option.textContent='현재 봇';
    for(const option of dialogs.querySelectorAll('#c-scope option[value="global"],#source-scope option[value="global"]'))option.textContent='글로벌 · 모든 봇';
    // Per-character translation target, next to the storage scope.
    dialogs.querySelector('#c-scope')?.closest('label')?.insertAdjacentHTML('beforebegin','<label class="field"><span>번역 언어</span><select id="c-language"><option value="">설정에 따름 · 기본</option><option value="original">번역 안 함</option><option value="en">영어</option><option value="ja">일본어</option><option value="ko">한국어</option><option value="custom">직접 입력</option></select></label><label class="field" id="c-language-custom-wrap" hidden><span>언어 코드</span><input id="c-language-custom" placeholder="예: fr, de, zh"></label>');
    // Characters (not voices) may also be 기타: non-human or genderless.
    dialogs.querySelector('#c-gender')?.insertAdjacentHTML('beforeend','<option>기타</option>');
    // The free grid cell beside the tags: languages the voice speaks (from Fish).
    dialogs.querySelector('#v-tags')?.closest('label')?.insertAdjacentHTML('afterend','<label class="field"><span>예측 언어 · 쉼표로 구분</span><input id="v-languages" placeholder="ko, ja, en" maxlength="60" aria-label="예측 언어"></label>');
    // Speed is picked from the custom rate list, not a free slider.
    const speed=root.querySelector('#speed');
    if(speed){const select=doc.createElement('select');select.id='speed';select.setAttribute('aria-label','음성 배속');speed.replaceWith(select);root.querySelector('#speed-value')?.remove();}
    // Per-character gain sits behind an "auto" switch in the label's top-right corner.
    const gainLabel=dialogs.querySelector('#c-gain')?.closest('label')?.querySelector('span');
    if(gainLabel){gainLabel.style.cssText='display:flex;align-items:center;justify-content:space-between;gap:8px';gainLabel.insertAdjacentHTML('beforeend','<span class="switch" style="display:inline-flex;align-items:center;gap:6px;font-weight:400">지정<input id="c-gain-manual" type="checkbox" aria-label="음량 직접 지정 (끄면 목소리 크기 자동 조절에 맡김)"></span>');}
    // Own speed per character, and the role-card (narrator / monologue) controls.
    dialogs.querySelector('#c-gain')?.closest('label')?.insertAdjacentHTML('afterend','<label class="field"><span style="display:flex;align-items:center;justify-content:space-between;gap:8px">개별 속도<span class="switch" style="display:inline-flex;align-items:center;gap:6px;font-weight:400">지정<input id="c-rate-on" type="checkbox" aria-label="개별 속도 사용"></span></span><select id="c-rate" aria-label="개별 속도" disabled></select></label>');
    dialogs.querySelector('#c-scope')?.closest('label')?.insertAdjacentHTML('beforebegin','<label class="field" id="c-follow-global-wrap" hidden><span style="display:flex;align-items:center;justify-content:space-between;gap:8px">글로벌 따라가기<span class="switch" style="display:inline-flex;align-items:center;gap:6px;font-weight:400"><input id="c-follow-global" type="checkbox" checked aria-label="글로벌 카드 따라가기"></span></span><small>끄면 이 봇에서만 이 카드의 설정을 씁니다.</small></label><label class="field" id="c-follow-char-wrap" hidden><span>따라갈 캐릭터 카드</span><select id="c-follow-char" aria-label="따라갈 캐릭터 카드"></select></label>');
    // The follow-global switch leads the form: while it is on, everything below is greyed out.
    {const lead=dialogs.querySelector('#c-follow-global-wrap'),fields=dialogs.querySelector('#character-form .fields'),borrow=dialogs.querySelector('#c-follow-char-wrap');if(lead&&fields){lead.classList.add('full');fields.prepend(lead);}
    // Borrowing another card's voice belongs with the voice presets.
    const presets=dialogs.querySelector('#choose-character-voice')?.closest('.field');if(borrow&&presets){borrow.classList.add('full');presets.after(borrow);}}
    // Share the TTS setup without keys: export/import next to the other settings.
    const lastColumn=[...root.querySelectorAll('#tts-settings .tts-settings-column')].at(-1);
    lastColumn?.insertAdjacentHTML('beforeend','<div class="group" id="tts-settings-file"><h3>설정 파일</h3><div class="actions"><button type="button" id="tts-settings-export">설정 내보내기</button><button type="button" id="tts-settings-import">설정 불러오기</button><input type="file" id="tts-settings-file-input" accept=".json,application/json" hidden></div></div>');
    const characterForm=dialogs.querySelector('#character-form');
    if(characterForm){
      characterForm.querySelector('#c-triggers')?.removeAttribute('required');
      characterForm.querySelector('#c-id')?.removeAttribute('required');
      characterForm.querySelector('[data-close="character-dialog"]:not(.editor-fold)')?.remove();
      const done=characterForm.querySelector('button[type="submit"]');
      if(done){done.type='button';done.id='character-done';done.textContent='닫기';}
      const status=doc.createElement('small');status.id='character-save-status';status.setAttribute('role','status');status.style.marginRight='auto';
      characterForm.querySelector('.dialog-actions')?.prepend(status);
    }
    const sourceTitle=dialogs.querySelector('#source-dialog-title');if(sourceTitle)sourceTitle.textContent='LLM한테 시키기';
    dialogs.querySelectorAll('details.source-help').forEach(el=>{if(!el.querySelector('p'))el.remove();});
    root.querySelectorAll('button:not([id])').forEach(el=>{
      if(el.textContent.includes('연결 확인'))el.remove();
    });
    root.querySelector('a[href="tts-1.2-module.draft.json"]')?.closest('.group')?.remove();
    for(const [field,name] of [['tts-fish-key','fish'],['helper-model','llm'],['jev-url','jev'],['translation','translation']]){
      root.querySelector('#'+field)?.closest('.group')?.insertAdjacentHTML('beforeend',`<div class="actions" style="margin-top:10px"><button type="button" id="tts-test-${name}">연결 테스트</button><span id="tts-test-${name}-result" role="status" style="font-size:12px;overflow-wrap:anywhere"></span></div>`);
    }
    const styles=[...doc.querySelectorAll('style')].filter(s=>s.textContent.includes('.tts-demo{')).map(s=>s.textContent).join('\n');
    const help={title:'TTS',body:'TTS는 삽화 전원과 독립적으로 작동합니다. 모델 설정에 Fish API 키를 넣고 TTS를 켜면 OmniTTS 표시 모듈이 설치됩니다. 처음에는 음성 활성화 팝업이 열립니다. 재생 중 팝업이 열렸다면 확인 후 요청한 대사를 바로 준비해 재생합니다. 새 화자 자동 배정과 음성 선택 모델을 설정하면 미지정 음성을 자동으로 채웁니다. 음성 목록에서 나레이션 음성을 지정하세요. 미리 만들기는 화면 주변의 양방향 구간을 준비하며, 클릭한 요청은 다음 빈 자리에 우선 배치됩니다. 같은 대사·억양·음성·모델은 캐시를 재사용합니다.'};
    return {html:root.outerHTML,dialogs:dialogs.outerHTML,css:styles,help};
  },html);
  if(/<script|검수용|사이트 목록 예시/.test(pack.html+pack.dialogs))throw Error('Review-only markup leaked');
  await writeFile('src/tts-ui/layout.json',JSON.stringify(pack));
  console.log('TTS production layout extracted without review runtime');
} finally {await browser.close();}
