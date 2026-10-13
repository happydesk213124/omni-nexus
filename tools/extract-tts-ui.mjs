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
    reading?.insertAdjacentHTML('beforeend','<label class="row"><div class="copy"><b>생성에서 제외할 글자 수</b><small>공백·문장부호 제외 · 이 길이 이하는 버튼과 목록도 생략</small></div><div class="control"><input id="tts-skip-chars" type="number" min="1" max="8000" step="1" aria-label="TTS 생성에서 제외할 글자 수" style="width:76px"><span>자 이하</span></div></label>');
    const fish=root.querySelector('#tts-fish-key');
    fish?.closest('.field')?.insertAdjacentHTML('afterend','<label class="field"><span>Fish API URL</span><input id="tts-fish-url" type="url" aria-label="Fish API URL"></label>');
    const fishModel=root.querySelector('#tts-fish-model');
    if(fishModel)fishModel.innerHTML=['s2.1-pro','s2.1-pro-free','s2-pro','s1','drama-3-preview'].map(model=>`<option value="${model}">${model}</option>`).join('');
    for(const id of ['character-list','voice-list','voice-folder-list'])root.querySelector('#'+id)?.replaceChildren();
    root.querySelector('#cache-usage').textContent='';
    dialogs.querySelector('#source-intro')?.remove();
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
