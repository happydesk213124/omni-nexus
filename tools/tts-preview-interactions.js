// Standalone review fixture only. No Risu storage or remote provider is connected.
function parseCharacterTags(value){return [...new Set(value.split(',').map(t=>t.trim()).filter(Boolean))].slice(0,30);}
const jevDrafts={
  openrouter:{model:'typesafe/jev-1.13',url:'https://openrouter.ai/api/alpha/decisions',format:'decisions'},
  typesafe:{model:'jev-1.13.0',url:'https://api.typesafe.ai/v1/systemone',format:'systemone'},
  custom:{model:'',url:'',format:'systemone'},
};
let jevProvider='openrouter';
$('jev-provider').onchange=()=>{
  jevDrafts[jevProvider]={model:$('jev-model').value,url:$('jev-url').value,format:$('jev-format').value};
  jevProvider=$('jev-provider').value;const draft=jevDrafts[jevProvider];
  $('jev-model').value=draft.model;$('jev-url').value=draft.url;$('jev-format').value=draft.format;
  $('jev-key').value='';
};
function suggestCharacterVoice(engine){
  const host=$('character-voice-suggestions');host.hidden=false;host.replaceChildren();
  host.append(node('small',`${engine} 추천 화면 예시 · 실제 호출·태그 판단 미연결`));
  const candidates=voices.filter(v=>$('c-gender').value==='미지정'||v.gender===$('c-gender').value).slice(0,3);
  const list=node('div',undefined,'actions');
  for(const voice of candidates){
    const button=node('button',`${voice.number} · ${voice.name}`);button.type='button';
    button.setAttribute('aria-pressed','false');
    button.onclick=()=>{$('c-id').value=voice.id;$('c-id').setCustomValidity('');updateCharacterVoiceChoice();list.querySelectorAll('button').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));};list.append(button);
  }
  host.append(list);
  list.querySelector('button')?.click();
  if(!candidates.length)host.append(node('small','맞는 분류의 음성이 없습니다. 음성 목록에서 추가해 주세요.'));
}
$('recommend-jev').onclick=()=>suggestCharacterVoice('JEV');
$('recommend-llm').onclick=()=>suggestCharacterVoice('LLM');
for(const id of ['c-name','c-gender','c-tags','c-triggers'])$(id).addEventListener('input',()=>{$('character-voice-suggestions').hidden=true;});
const auditionText='안녕하세요, こんにちは, Nice to meet you.';
function previewVoice(name,id){
  if(!id){notify('먼저 음성을 지정해 주세요.');return;}
  interruptPlayback();updatePlayer();
  notify('미리듣기 · 실제 Fish 음성 미연결');
}
function voiceListenButton(name,id){
  const button=node('button','▶ 듣기','tile-audition');button.type='button';button.disabled=!id;
  button.setAttribute('aria-label',name+' 미리듣기');button.title=id?auditionText:'먼저 음성을 지정해 주세요';
  button.onclick=event=>{event.stopPropagation();previewVoice(name,id);};return button;
}
for(const [button,prefix] of [['test-character-editor','c'],['test-voice-editor','v']]){
  $(button).title=auditionText;
  $(button).onclick=()=>{if(normalizeFishInput(prefix+'-id'))previewVoice($(prefix+'-name').value,$(prefix+'-id').value);};
}
function normalizeFishInput(id){
  const input=$(id),value=input.value.trim();input.setCustomValidity('');
  if(value.includes('://')||value.startsWith('fish.audio/')||value.startsWith('www.fish.audio/')){
    try{
      const url=new URL(value.includes('://')?value:'https://'+value);
      const last=url.pathname.split('/').filter(Boolean).at(-1)||'';
      if(!['https:','http:'].includes(url.protocol)||!['fish.audio','www.fish.audio'].includes(url.hostname.toLowerCase())||!/^[a-f0-9]{32}$/i.test(last))throw Error();
      input.value=last.toLowerCase();
    }catch{input.setCustomValidity('Fish Audio 음성 링크 또는 음성 ID를 입력해 주세요.');input.reportValidity();return false;}
  }else input.value=value;
  if(id==='c-id')updateCharacterVoiceChoice();
  return true;
}
for(const id of ['c-id','v-id']){
  $(id).addEventListener('input',()=>$(id).setCustomValidity(''));
  $(id).addEventListener('change',()=>normalizeFishInput(id));
}
function formatGain(value) { return `${value>0?'+':''}${value} dB`; }
$('c-gain').oninput=()=>{$('c-gain-value').value=formatGain(Number($('c-gain').value));};
$('auto-voice').onchange=renderCharacters;

function referencePreview(character) {
  const fixtures = [
    {aliases:['하린','Harin'], label:'하린 · 참조 이미지 예시', color:'#9289bf'},
    {aliases:['도윤','Doyun'], label:'도윤 · 레퍼 이미지 예시', color:'#7193ae'},
  ];
  const normalize = value => value.normalize('NFKC').trim().toLocaleLowerCase();
  const matches = fixtures.filter(f => f.aliases.some(a => character.triggers.some(t => normalize(t) === normalize(a))));
  const wrapper = node('div',undefined,'reference-preview');
  if(matches.length !== 1) {
    wrapper.classList.add('empty-reference');
    wrapper.textContent = matches.length ? '별칭 중복 · 이미지 선택 필요' : '일치하는 삽화 캐릭터 없음';
    return wrapper;
  }
  const fixture = matches[0], img = node('img');
  img.alt = fixture.label + ' · 실제 사용자 이미지 미연결';
  img.src = 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="500" height="240" viewBox="0 0 500 240"><rect width="500" height="240" fill="#202538"/><circle cx="380" cy="40" r="140" fill="${fixture.color}" opacity=".15"/><circle cx="250" cy="84" r="43" fill="${fixture.color}"/><path d="M149 244c0-73 39-113 101-113s101 40 101 113" fill="${fixture.color}" opacity=".7"/></svg>`);
  wrapper.append(img,node('small',fixture.label+' · 시안'));
  return wrapper;
}

function renderSegmentList() {
  const host = $('segment-list');
  // Keep focused controls stable while the simulated playback clock ticks.
  if(!host.children.length) messageLines.forEach((line,i) => {
    const button = node('button',`${i+1}. ${line.name} · ${line.text}`);
    button.type = 'button';button.onclick = () => startAt(i,'click',messageLines);
    host.append(button);
  });
  [...host.children].forEach((button,i) => {
    button.disabled = !$('tts-power').checked;
    button.hidden = !eligible(messageLines).includes(i);
    button.setAttribute('aria-current',String(lines===messageLines&&i===index));
  });
}
function paintContinuous(){
  const on=$('continuous').checked;
  $('player-continuous').setAttribute('aria-pressed',String(on));
  $('player-continuous').title=on?'이어 읽기 ON · 다음 구간 자동 재생':'이어 읽기 OFF · 선택 구간만 재생';
}
$('continuous').onchange=paintContinuous;
$('player-continuous').onclick=()=>{$('continuous').checked=!$('continuous').checked;paintContinuous();};
paintContinuous();
$('player-narration').onclick = () => {
  $('narration').checked = !$('narration').checked;
  $('narration').onchange();
};
document.querySelectorAll('[data-player-panel]').forEach(button=>button.onclick=()=>{
  const open=button.getAttribute('aria-expanded')!=='true';
  document.querySelectorAll('[data-player-panel]').forEach(other=>{
    const active=other===button&&open;
    other.setAttribute('aria-expanded',String(active));$(other.dataset.playerPanel).hidden=!active;
  });
  if(open&&$('player').classList.contains('miniplayer'))$('minimize').click();
});
let expandedPlayerPosition=null;
$('minimize').onclick=()=>{
  const player=$('player'),button=$('minimize');
  const mini=!player.classList.contains('miniplayer');
  if(mini){
    const rect=player.getBoundingClientRect(),anchor=button.getBoundingClientRect();
    expandedPlayerPosition={left:rect.left,top:rect.top};
    player.classList.add('miniplayer');
    Object.assign(player.style,{left:anchor.left+'px',top:anchor.top+'px',right:'auto',bottom:'auto'});
  }else{
    player.classList.remove('miniplayer');
    if(expandedPlayerPosition)Object.assign(player.style,{
      left:Math.max(0,Math.min(innerWidth-player.offsetWidth,expandedPlayerPosition.left))+'px',
      top:Math.max(0,Math.min(innerHeight-player.offsetHeight,expandedPlayerPosition.top))+'px',right:'auto',bottom:'auto'
    });
  }
  button.textContent=mini?'+':'−';button.title=mini?'플레이어 펼치기':'플레이어 접기';button.setAttribute('aria-label',button.title);
};
for(const prefix of ['v','c']) $(prefix+'-fetch').onclick = () => {
  if(!normalizeFishInput(prefix+'-id'))return;
  const voice = voices.find(v => v.id === $(prefix+'-id').value.trim());
  const output = $(prefix+'-metadata');
  if(!voice) {
    $(prefix+'-gender').value='미지정';
    output.textContent='API 미연결 · 이 ID의 정보는 아직 조회하지 않았습니다. 성별 미지정.';
    return;
  }
  $(prefix+'-gender').value=voice.gender;
  if(prefix==='v') {
    $('v-name').value=voice.name;
    $('v-tags').value=voice.tag.split(',').map(t=>t.trim()).filter(t=>!['여성','남성','미지정'].includes(t)).join(', ');
  }
  output.textContent='로컬 프리셋 정보 예시: '+voice.name+' · '+voice.tag+' (Fish 실시간 조회 아님)';
};
for(const id of ['concurrency','background-concurrency']) $(id).onchange = () => {
  const total=Math.max(1,Math.min(5,Math.floor(Number($('concurrency').value)||1)));
  $('concurrency').value=String(total);
  $('background-concurrency').max=String(total);
  $('background-concurrency').value=String(Math.max(1,Math.min(total,Math.floor(Number($('background-concurrency').value)||1))));
};
const risuModes = ['model','submodel','emotion','translate','memory','otherAx'];
$('helper-model').onchange = () => {
  const host=$('helper-model').closest('.fields');
  host.querySelectorAll('input').forEach(input=>input.closest('label').hidden=risuModes.includes($('helper-model').value));
};
let progressTimer,previewBackgroundActive=false;
$('tts-toast-enabled').onchange=()=>{if(!$('tts-toast-enabled').checked)$('toast').hidden=true;};
function progressDemo() {
  clearInterval(progressTimer);previewBackgroundActive=true;
  let done=0;
  const progress=$('toast-progress') || node('progress');
  progress.id='toast-progress';progress.max=20;progress.value=0;
  progress.setAttribute('aria-label','음성 준비 진행률 · 시안');
  $('toast').append(progress);
  const show=()=>{
    notify(`준비 ${done}/20 · 생성 ${Math.min(5,20-done)} · 대기 ${Math.max(0,15-done)}`);
    $('player-cache-status').textContent=`준비 ${done}/20 · 생성 ${Math.min(5,20-done)} · 대기 ${Math.max(0,15-done)}`;
    $('player-cache-progress').value=done;$('cache-chip').textContent=done===20?'✓':'◌';
    $('cache-chip').title=$('player-cache-status').textContent;
    progress.hidden=false;progress.value=done;
  };
  show();
  progressTimer=setInterval(()=>{
    if(!$('tts-power').checked){clearInterval(progressTimer);previewBackgroundActive=false;progress.hidden=true;$('player-cache-status').textContent='TTS OFF · 준비 중단';$('cache-chip').textContent='◌';notify('TTS OFF · 준비 중단');return;}
    done++;releaseIllustrationSlot();show();
    if(done===20){clearInterval(progressTimer);previewBackgroundActive=false;}
  },400);
}

const bulkModel=$('bulk-model');
bulkModel.append(new Option('TTS 보조 LLM 연결 사용','shared'));
for(const mode of risuModes) bulkModel.append(new Option($('helper-model').querySelector(`option[value="${mode}"]`).textContent,mode));
const sourceModel=$('source-model');
sourceModel.append(new Option('TTS 보조 LLM 연결 사용','shared'));
for(const mode of risuModes) sourceModel.append(new Option($('helper-model').querySelector(`option[value="${mode}"]`).textContent,mode));
let sourceRows=[],sourceCommandMode=false;
const sourceInputs=['source-lore','source-persona','source-illustration','source-scope','source-model','source-assign-voice','source-update-existing','source-add-new'];
function resetSourceReview(){sourceRows=[];$('source-results').replaceChildren();$('source-apply').disabled=true;$('source-status').textContent='제안을 받으면 변경 전후를 확인할 수 있습니다.';}
sourceInputs.forEach(id=>$(id).onchange=resetSourceReview);
function openSourceDialog(command){sourceCommandMode=command;$('source-command-fields').hidden=!command;$('source-dialog-title').textContent=command?'LLM한테 시키기':'자료에서 캐릭터 가져오기';$('source-intro').textContent=command?'현재 채팅·글로벌 캐릭터 전체를 검토해 이름·트리거워드·분위기 태그·음성 변경과 신규 추가를 제안합니다. 체크한 결과만 적용합니다.':'선택한 자료를 LLM이 읽고 이름·트리거워드·분위기 태그와 음성 후보를 정리합니다.';resetSourceReview();$('character-source-dialog').showModal();}
$('command-characters').onclick=()=>openSourceDialog(true);$('source-command').oninput=resetSourceReview;
$('source-extract').onclick=()=>{
  sourceRows=[];$('source-results').replaceChildren();
  const fixtures=[
    {input:'source-lore',source:'로어북',name:'서윤',triggers:['서윤','Seoyun'],gender:'여성'},
    {input:'source-persona',source:'페르소나',name:'유진',triggers:['유진','Yujin'],gender:'미지정'},
    {input:'source-illustration',source:'삽화 캐릭터',name:'하린',triggers:['하린','Harin'],gender:'여성'},
  ];
  const hasCommand=!!$('source-command').value.trim();
  const requestedCandidates=[{source:'요청 예시',name:'서윤',triggers:['서윤','Seoyun'],gender:'여성'},{source:'요청 예시',name:'민준',triggers:['민준','Minjun'],gender:'남성'}];
  const candidates=$('source-add-new').checked?(hasCommand?requestedCandidates:fixtures.filter(f=>$(f.input).checked)):[];
  if(sourceCommandMode&&$('source-update-existing').checked)for(const current of chars)candidates.push({...current,source:'기존 캐릭터 수정',targetKey:current.key,snapshot:JSON.stringify(current)});
  const scope=$('source-scope').value;

  for(const item of candidates) {
    const targetScope=item.targetKey!==undefined?item.scope:scope;
    const duplicate=chars.some(c=>c.key!==item.targetKey&&c.scope===targetScope&&sameTtsIdentity(c,item));
    const shadow=chars.some(c=>c.scope!==targetScope&&sameTtsIdentity(c,item));
    const preset=(sourceCommandMode?$('source-assign-voice').checked:$('auto-voice').checked)&&item.gender!=='미지정'?voices.find(v=>v.gender===item.gender):null;
    const voice=item.lock?item.voice:preset?.id||item.voice||'';
    const tags=[...new Set([...(item.tags||[]),'차분한'])];
    const entry={...item,tags,scope:targetScope,voice,selected:!duplicate};sourceRows.push(entry);
    const row=node('label',undefined,'bulk-row'),check=node('input'),text=node('span',item.name+' · '+item.source+' · '+(targetScope==='global'?'글로벌':'현재 채팅'));
    check.type='checkbox';check.checked=entry.selected;check.disabled=duplicate;
    check.onchange=()=>{entry.selected=check.checked;$('source-apply').disabled=!sourceRows.some(r=>r.selected);};
    const assigned=voices.find(v=>v.id===voice);
    text.append(node('small',[item.triggers.join(', '),duplicate?'동일 범위 중복 · 제외':shadow?'별도 범위에 존재 · 현재 채팅 우선':'',voice?assigned?`음성 ${assigned.number} · ${assigned.name}`:'직접 지정 음성 유지':'음성 선택 대기',item.lock?'음성 고정 유지':''].filter(Boolean).join(' · ')));
    text.append(node('small',`태그: ${item.targetKey!==undefined?(item.tags||[]).join(', ')||'없음':'없음'} → ${tags.join(', ')}`));
    if(item.targetKey!==undefined)text.append(node('small',`음성: ${voices.find(v=>v.id===item.voice)?.name||(item.voice?'직접 지정':'미지정')} → ${assigned?.name||(voice?'직접 지정':'미지정')}`));
    row.append(check,text);$('source-results').append(row);
  }
  $('source-status').textContent=sourceRows.length?`${sourceRows.length}명 제안 예시 · 실제 자료/LLM 미연결`:'추가·수정할 대상 또는 자료를 선택해 주세요.';
  $('source-apply').disabled=!sourceRows.some(r=>r.selected);
};
$('source-apply').onclick=()=>{
  const selected=sourceRows.filter(r=>r.selected);
  for(const item of selected){
    if(item.targetKey!==undefined){
      const index=chars.findIndex(c=>c.key===item.targetKey);
      if(index<0||JSON.stringify(chars[index])!==item.snapshot){$('source-status').textContent='검토 중 캐릭터가 바뀌었습니다. 다시 제안을 받아 주세요.';return;}
    }
  }
  for(const item of selected){
    const index=chars.findIndex(c=>c.key===item.targetKey),prior=index>=0?chars[index]:null;
    const next={surname:item.surname||'',given_name:item.given_name||'',surname_variants:item.surname_variants||'',given_name_variants:item.given_name_variants||'',key:prior?.key??charKey++,name:item.name,triggers:[...item.triggers],tags:[...item.tags],gender:item.gender,scope:item.scope,voice:item.voice,gain:prior?.gain??0,lock:prior?.lock??false};
    if(prior)chars[index]=next;else chars.push(next);
  }
  $('char-scope-filter').value='all';renderCharacters();$('character-source-dialog').close();notify(`${selected.length}명 시안 적용 · 원본 자료는 변경하지 않았습니다.`);
};
let bulkRows=[];
const bulkExample='별빛 도서관 음성 세트\n새벽 안내자 | https://fish.audio/m/11111111111111111111111111111111 | 여성, 차분함\n여행자 | https://fish.audio/m/22222222222222222222222222222222 | 남성, 밝은\n밤의 화자 | 링크 없음';
$('bulk-voice').onclick=()=>{$('bulk-dialog').showModal();};
$('bulk-example').onclick=()=>{$('bulk-input').value=bulkExample;$('bulk-input').oninput();};
$('bulk-input').oninput=()=>{bulkRows=[];$('bulk-results').replaceChildren();$('bulk-apply').disabled=true;$('bulk-status').textContent='내용이 바뀌었습니다. 다시 변환해 주세요.';};
$('bulk-convert').onclick=()=>{
  bulkRows=[];$('bulk-results').replaceChildren();$('bulk-apply').disabled=true;
  const input=$('bulk-input').value.trim();
  if(input===bulkExample) {
    bulkRows=[{name:'새벽 안내자',id:'11111111111111111111111111111111',tag:'여성, 차분함'},
      {name:'여행자',id:'22222222222222222222222222222222',tag:'남성, 밝은'},
      {name:'밤의 화자',id:'',tag:''}];
    $('bulk-status').textContent='고정 변환 예시 · 가상의 ID 2개 / ID 누락 1개. 실제 Fish 음성 아님.';
  } else {
    try {
      const parsed=JSON.parse(input);
      if(!Array.isArray(parsed)||parsed.length>500||!parsed.length)throw Error();
      bulkRows=parsed.map(v=>({name:typeof v?.name==='string'?v.name.slice(0,120):'',id:typeof v?.id==='string'?v.id.trim():'',tag:typeof v?.tag==='string'?v.tag.slice(0,250):''}));
      $('bulk-status').textContent='JSON 입력을 검수합니다. LLM 변환·Fish 실존 조회는 하지 않았습니다.';
    } catch {
      $('bulk-status').textContent='자유 형식 변환은 LLM 연결 후 가능합니다. 지금은 ‘사이트 목록 예시 넣기’로 검수하거나 name/tag/id JSON을 붙여 넣으세요.';
      return;
    }
  }
  bulkRows.forEach((v,i)=>{
    const valid=Boolean(v.name.trim())&&/^[a-f0-9]{32}$/i.test(v.id);
    const duplicate=voices.some(old=>old.id===v.id)||bulkRows.slice(0,i).some(old=>old.id===v.id);
    v.selected=valid&&!duplicate;
    const row=node('label',undefined,'bulk-row'),check=node('input'),text=node('span',v.name||'이름 없음');
    check.type='checkbox';check.checked=v.selected;check.disabled=!valid||duplicate;
    check.onchange=()=>{v.selected=check.checked;$('bulk-apply').disabled=!bulkRows.some(v=>v.selected);};
    text.append(node('small',!valid?'이름·ID 확인 필요 · 추가 제외':duplicate?'중복 ID · 추가 제외':`${genderOf(v.tag)} · ${v.id}`));
    row.append(check,text);$('bulk-results').append(row);
  });
  $('bulk-apply').disabled=!bulkRows.some(v=>v.selected);
};
$('bulk-apply').onclick=()=>{
  let added=0;
  for(const v of bulkRows.filter(v=>v.selected)) {
    if(voices.some(old=>old.id===v.id))continue;
    const gender=genderOf(v.tag),base=gender==='여성'?1:gender==='남성'?1001:2001;
    voices.push({name:v.name,tag:v.tag,id:v.id,key:nextKey++,gender,number:Math.max(base-1,...voices.filter(v=>v.gender===gender).map(v=>v.number))+1});added++;
  }
  refreshSelectors();renderVoices();$('bulk-dialog').close();notify(`${added}개 음성을 시안 목록에 추가했습니다.`);
};
