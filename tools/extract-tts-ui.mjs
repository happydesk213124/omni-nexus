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
      scope.querySelectorAll('button').forEach(el=>{el.textContent=el.textContent.replaceAll(' · 시안','').replaceAll('시안에 적용','적용');});
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
    const fish=root.querySelector('#tts-fish-key');
    fish?.closest('.field')?.insertAdjacentHTML('afterend','<label class="field"><span>Fish API URL</span><input id="tts-fish-url" type="url" aria-label="Fish API URL"></label>');
    const fishModel=root.querySelector('#tts-fish-model');
    if(fishModel){const field=doc.createElement('input');field.id='tts-fish-model';field.setAttribute('aria-label','Fish 모델');fishModel.replaceWith(field);}
    for(const id of ['character-list','voice-list','voice-folder-list'])root.querySelector('#'+id)?.replaceChildren();
    root.querySelector('#cache-usage').textContent='';
    dialogs.querySelector('#source-intro')?.remove();
    root.querySelectorAll('button:not([id])').forEach(el=>{
      if(el.textContent.includes('연결 확인'))el.remove();
    });
    const styles=[...doc.querySelectorAll('style')].filter(s=>s.textContent.includes('.tts-demo{')).map(s=>s.textContent).join('\n');
    const help={title:'TTS',body:'TTS는 삽화 전원과 독립적으로 작동합니다. 모델 설정에 Fish API 키를 넣고 TTS를 켜면 OmniTTS 표시 모듈이 설치됩니다. 음성 목록에서 나레이션 음성을 지정하고 캐릭터에 음성을 배정하세요. 음성 재생 활성화 버튼은 브라우저의 자동 재생 제한을 해제하기 위한 동작입니다. 미리 만들기는 화면 주변의 양방향 구간을 준비하며, 클릭한 요청은 다음 빈 자리에 우선 배치됩니다. 같은 대사·억양·음성·모델은 캐시를 재사용합니다.'};
    return {html:root.outerHTML,dialogs:dialogs.outerHTML,css:styles,help};
  },html);
  if(/<script|검수용|사이트 목록 예시/.test(pack.html+pack.dialogs))throw Error('Review-only markup leaked');
  await writeFile('src/tts-ui/layout.json',JSON.stringify(pack));
  console.log('TTS production layout extracted without review runtime');
} finally {await browser.close();}
