// Review-only library state. Provider requests and persistent storage are not connected.
const selectedVoices=new Set(),voiceFolders=[];
let voicePickerActive=false;
let activeVoiceFolder='all',voiceAnchor=null,nextFolder=1,editingFolder=null,multiSelectVoices=false;
let deletionSnapshot=[],movingSnapshot=[],organizationSnapshot=[],organizationProposal=[];
function updateVoiceFishLink(){
  const link=$('v-visit'),value=$('v-id').value.trim();let id=value;
  if(!/^[a-f\d]{32}$/i.test(id)){
    try{const url=new URL(value),parts=url.pathname.split('/').filter(Boolean);id=url.protocol==='https:'&&/(^|\.)fish\.audio$/i.test(url.hostname)&&parts.at(-2)==='m'?parts.at(-1):'';}catch{id='';}
  }
  const valid=/^[a-f\d]{32}$/i.test(id);link.hidden=!valid;
  if(valid)link.href=`https://fish.audio/ko/m/${id.toLowerCase()}/`;else link.removeAttribute('href');
}
$('v-id').addEventListener('input',updateVoiceFishLink);
function updateCharacterVoiceChoice(){
  const voice=voices.find(v=>v.id===$('c-id').value);
  $('character-voice-choice').textContent=voice?voice.name:$('c-id').value?'직접 지정한 음성':'지정된 음성 없음';
}
$('choose-character-voice').onclick=()=>{
  voicePickerActive=true;selectedVoices.clear();voiceAnchor=null;
  $('character-dialog').close();$('tab-voices').textContent='음성 목록 (선택 중)';
  $('tts-voices').classList.add('voice-picking');$('voice-list').setAttribute('aria-multiselectable','false');
  $('apply-picked-voice').hidden=false;$('cancel-picked-voice').hidden=false;
  activeVoiceFolder='all';$('voice-search').value='';$('gender-filter').value='all';
  renderVoices();$('tab-voices').click();
};
function resetVoicePicker(){
  voicePickerActive=false;$('tab-voices').textContent='음성 목록';$('tts-voices').classList.remove('voice-picking');$('apply-picked-voice').hidden=true;$('cancel-picked-voice').hidden=true;$('voice-list').setAttribute('aria-multiselectable','true');
}
function finishVoicePicker(voice){
  if(!voicePickerActive)return;resetVoicePicker();
  if(voice){$('c-id').value=voice.id;$('c-id').setCustomValidity('');updateCharacterVoiceChoice();}
  selectedVoices.clear();voiceAnchor=null;paintVoiceSelection();
  $('tab-characters').click();$('character-dialog').showModal();$('choose-character-voice').focus();
}
$('apply-picked-voice').onclick=()=>{if(selectedVoices.size===1)finishVoicePicker(voices.find(v=>selectedVoices.has(v.key)));};
$('cancel-picked-voice').onclick=()=>finishVoicePicker();
const folderName=id=>voiceFolders.find(f=>f.id===id)?.name||'미분류';
function ensureVoiceFolder(name){
  const clean=String(name||'').trim().slice(0,80);if(!clean)return '';
  const existing=voiceFolders.find(f=>f.name.toLocaleLowerCase()===clean.toLocaleLowerCase());
  if(existing)return existing.id;
  const id='folder-'+nextFolder++;voiceFolders.push({id,name:clean});return id;
}
function visibleVoices(){
  const query=$('voice-search').value.slice(0,500).normalize('NFKC').toLocaleLowerCase(),gender=$('gender-filter').value;
  const groups=query.split('|').map(group=>group.split('&').map(term=>term.trim()).filter(Boolean)).filter(group=>group.length);
  return voices.filter(v=>(activeVoiceFolder==='all'||(v.folderId||'')===activeVoiceFolder)&&
    (gender==='all'||gender===v.gender)&&(!groups.length||groups.some(group=>group.every(term=>`${v.name} ${v.tag} ${v.id}`.normalize('NFKC').toLocaleLowerCase().includes(term)))))
    .sort((a,b)=>$('voice-sort').value==='errors'?((b.error?.count||0)-(a.error?.count||0)||(b.error?.lastAt||0)-(a.error?.lastAt||0)||a.number-b.number):$('voice-sort').value==='name'?a.name.localeCompare(b.name,'ko'):a.number-b.number);
}
function paintVoiceSelection(){
  document.querySelectorAll('.voice-row').forEach(tile=>{
    const selected=selectedVoices.has(Number(tile.dataset.voiceKey));
    tile.setAttribute('aria-selected',String(selected));tile.querySelector('.voice-check').textContent=selected?'✓':'';
  });
  $('apply-picked-voice').disabled=selectedVoices.size!==1;
  const count=selectedVoices.size;$('voice-selected-count').textContent=count?`${count}개 선택`:'선택 없음';
  for(const id of ['selected-narrator','edit-selected-voice'])$(id).disabled=count!==1;
  for(const id of ['clear-voice-selection','move-selected-voices','delete-selected-voices'])$(id).disabled=count===0;
  $('select-visible-voices').disabled=visibleVoices().length===0;
}
function pickVoice(key,event={},allowEdit=true){
  const list=visibleVoices(),at=list.findIndex(v=>v.key===key),anchor=list.findIndex(v=>v.key===voiceAnchor);
  const additive=!voicePickerActive&&(multiSelectVoices||event.ctrlKey||event.metaKey||event.target?.closest?.('.voice-check'));
  if(!voicePickerActive&&event.shiftKey&&anchor>=0){
    if(!additive)selectedVoices.clear();
    list.slice(Math.min(at,anchor),Math.max(at,anchor)+1).forEach(v=>selectedVoices.add(v.key));
  }else if(additive){selectedVoices.has(key)?selectedVoices.delete(key):selectedVoices.add(key);voiceAnchor=key;}
  else if(allowEdit&&selectedVoices.size===1&&selectedVoices.has(key)){if(voicePickerActive)finishVoicePicker(voices.find(v=>v.key===key));else openVoice(key);return;}
  else{selectedVoices.clear();selectedVoices.add(key);voiceAnchor=key;}
  paintVoiceSelection();
}
$('voice-folder-toggle').onclick=()=>{const button=$('voice-folder-toggle'),open=button.getAttribute('aria-expanded')!=='true';button.setAttribute('aria-expanded',String(open));button.closest('.voice-folders').classList.toggle('folders-open',open);};
function renderVoiceFolders(){
  $('voice-folder-toggle').textContent=(activeVoiceFolder==='all'?'전체 음성':folderName(activeVoiceFolder))+' ▾';
  const host=$('voice-folder-list');host.replaceChildren();
  for(const folder of [{id:'all',name:'전체 음성'},{id:'',name:'미분류'},...voiceFolders]){
    const button=node('button'),count=folder.id==='all'?voices.length:voices.filter(v=>(v.folderId||'')===folder.id).length;
    button.type='button';button.dataset.folder=folder.id;button.setAttribute('aria-current',String(folder.id===activeVoiceFolder));
    button.append(node('span',folder.name),node('small',String(count)));
    button.onclick=()=>{$('voice-folder-toggle').setAttribute('aria-expanded','false');button.closest('.voice-folders').classList.remove('folders-open');activeVoiceFolder=folder.id;selectedVoices.clear();voiceAnchor=null;renderVoices();};host.append(button);
  }
  $('edit-voice-folder').disabled=!voiceFolders.some(f=>f.id===activeVoiceFolder);
  updateFolderTransfer();
}
$('clear-voice-search').onclick=()=>{$('voice-search').value='';renderVoices();$('voice-search').focus();};
function renderVoices(){
  $('clear-voice-search').hidden=!$('voice-search').value;
  const shown=visibleVoices(),shownKeys=new Set(shown.map(v=>v.key));
  for(const key of selectedVoices)if(!shownKeys.has(key))selectedVoices.delete(key);
  if(!shownKeys.has(voiceAnchor))voiceAnchor=null;
  $('voice-count').textContent=`${shown.length}/${voices.length}`;
  $('voice-count').title=`${shown.length}개 표시 / 전체 ${voices.length}개`;
  $('voice-total').textContent=`여성 ${voices.filter(v=>v.gender==='여성').length} · 남성 ${voices.filter(v=>v.gender==='남성').length}`;
  $('voice-count').title+=' · '+$('voice-total').textContent;
  const host=$('voice-list');host.replaceChildren();const duplicate=new Map();
  voices.forEach(v=>duplicate.set(v.id,(duplicate.get(v.id)||0)+1));
  shown.forEach(v=>{
    const tile=node('div',undefined,'voice-row'),top=node('span',undefined,'voice-tile-top');
    tile.tabIndex=0;tile.dataset.voiceKey=String(v.key);tile.setAttribute('role','option');
    tile.setAttribute('aria-label',v.name);tile.title=`${v.name}\n${v.tag}\n${v.id}\n${voicePickerActive?'선택된 타일을 다시 누르면 이 음성 사용':'선택된 타일을 다시 누르면 편집'}`;
    const check=node('span','','voice-check');check.setAttribute('aria-hidden','true');
    top.append(check,node('span',String(v.number).padStart(3,'0')));
    if(v.id===narratorVoice)top.append(node('span','나레이션','voice-narrator-badge'));
    tile.append(top,node('span',v.name,'voice-name'),node('span',v.tag||'태그 없음','voice-tags'),node('span',v.id,'voice-id'));
    if(duplicate.get(v.id)>1)tile.append(node('span','중복 Fish ID','duplicate'));
    if(v.error?.count)tile.append(node('small',`HTTP ${v.error.status} 오류 · ${v.error.count}회`,'voice-error'));
    tile.append(node('span','▱ '+folderName(v.folderId),'voice-folder-label'));
    tile.append(voiceListenButton(v.name,v.id));
    tile.onclick=event=>{if(!event.target.closest('.tile-audition'))pickVoice(v.key,event);};
    tile.onkeydown=event=>{
      if(event.target!==tile)return;
      if(event.key==='Enter'){event.preventDefault();pickVoice(v.key,event);return;}
      if(!voicePickerActive&&(event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='a'){event.preventDefault();$('select-visible-voices').click();return;}
      if(event.key==='Escape'){event.preventDefault();if(voicePickerActive)finishVoicePicker();else $('clear-voice-selection').click();return;}
      if(event.key==='Delete'&&!voicePickerActive){event.preventDefault();requestVoiceDeletion();return;}
      if(event.key===' '){event.preventDefault();pickVoice(v.key,{ctrlKey:true},false);return;}
      const delta=event.key==='ArrowRight'?1:event.key==='ArrowLeft'?-1:0;
      if(delta){event.preventDefault();const index=shown.findIndex(x=>x.key===v.key),next=shown[Math.max(0,Math.min(shown.length-1,index+delta))];pickVoice(next.key,event,false);host.querySelector(`[data-voice-key="${next.key}"]`).focus();}
    };
    host.append(tile);
  });
  if(!shown.length)host.append(node('div','검색 결과가 없습니다.','empty'));
  renderVoiceFolders();paintVoiceSelection();
}
$('voice-multiselect').onclick=()=>{
  multiSelectVoices=!multiSelectVoices;
  $('voice-multiselect').setAttribute('aria-pressed',String(multiSelectVoices));
  $('voice-multiselect').textContent=multiSelectVoices?'선택 완료':'다중선택';
  if(!multiSelectVoices&&selectedVoices.size>1){selectedVoices.clear();voiceAnchor=null;}
  paintVoiceSelection();
};
$('select-visible-voices').onclick=()=>{visibleVoices().forEach(v=>selectedVoices.add(v.key));paintVoiceSelection();};
$('clear-voice-selection').onclick=()=>{selectedVoices.clear();voiceAnchor=null;paintVoiceSelection();};
$('selected-narrator').onclick=()=>{const v=voices.find(v=>selectedVoices.has(v.key));if(selectedVoices.size!==1||!v)return;narratorVoice=v.id;renderVoices();notify('나레이션 음성 지정 완료');};
$('edit-selected-voice').onclick=()=>{if(selectedVoices.size===1)openVoice([...selectedVoices][0]);};
function requestVoiceDeletion(){
  deletionSnapshot=voices.filter(v=>selectedVoices.has(v.key));if(!deletionSnapshot.length)return;
  $('voice-delete-title').textContent=`선택 음성 ${deletionSnapshot.length}개를 삭제할까요?`;
  $('voice-delete-message').textContent='확인한 항목만 목록에서 제거합니다.';
  $('voice-delete-names').textContent=deletionSnapshot.map(v=>v.name).join('\n');
  $('voice-delete-dialog').showModal();
}
$('delete-selected-voices').onclick=requestVoiceDeletion;
$('confirm-voice-delete').onclick=()=>{
  const keys=new Set(deletionSnapshot.map(v=>v.key));voices=voices.filter(v=>!keys.has(v.key));
  selectedVoices.clear();deletionSnapshot=[];$('voice-delete-dialog').close();refreshSelectors();renderVoices();notify(`${keys.size}개 음성 삭제 완료`);
};
function openVoiceFolder(id){editingFolder=id;$('voice-folder-title').textContent=id?'폴더 관리':'폴더 만들기';$('voice-folder-name').value=id?folderName(id):'';$('voice-folder-error').textContent='';$('remove-voice-folder').hidden=!id;$('voice-folder-dialog').showModal();}
$('new-voice-folder').onclick=()=>openVoiceFolder(null);
$('edit-voice-folder').onclick=()=>openVoiceFolder(activeVoiceFolder);
$('voice-folder-form').onsubmit=event=>{
  event.preventDefault();const name=$('voice-folder-name').value.trim();if(!name)return;
  if(voiceFolders.some(f=>f.id!==editingFolder&&f.name.toLocaleLowerCase()===name.toLocaleLowerCase())){$('voice-folder-error').textContent='같은 이름의 폴더가 있습니다.';return;}
  if(editingFolder)voiceFolders.find(f=>f.id===editingFolder).name=name;else ensureVoiceFolder(name);
  $('voice-folder-dialog').close();renderVoices();
};
$('remove-voice-folder').onclick=()=>{$('voice-folder-delete-message').textContent=folderName(editingFolder);$('voice-folder-delete-dialog').showModal();};
$('confirm-folder-delete').onclick=()=>{
  const index=voiceFolders.findIndex(f=>f.id===editingFolder);if(index<0)return;
  voices.forEach(v=>{if(v.folderId===editingFolder)v.folderId='';});voiceFolders.splice(index,1);activeVoiceFolder='all';
  $('voice-folder-delete-dialog').close();$('voice-folder-dialog').close();renderVoices();
};
$('move-selected-voices').onclick=()=>{
  movingSnapshot=[...selectedVoices];const select=$('voice-move-target');select.replaceChildren(new Option('미분류',''));
  voiceFolders.forEach(f=>select.add(new Option(f.name,f.id)));$('voice-move-count').textContent=`선택 ${movingSnapshot.length}개`;$('voice-move-dialog').showModal();
};
$('confirm-voice-move').onclick=()=>{voices.forEach(v=>{if(movingSnapshot.includes(v.key))v.folderId=$('voice-move-target').value;});$('voice-move-dialog').close();renderVoices();notify(`${movingSnapshot.length}개 폴더 이동 완료`);};
function resetOrganization(){organizationProposal=[];$('voice-organization-results').replaceChildren();$('apply-voice-organization').disabled=true;$('organize-status').textContent='정리안을 만든 뒤 확인하고 적용하세요.';}
$('organize-voices').onclick=()=>{
  organizationSnapshot=(selectedVoices.size?voices.filter(v=>selectedVoices.has(v.key)):visibleVoices()).map(v=>({...v}));
  $('organize-scope').textContent=`${selectedVoices.size?'선택한':'현재 표시된'} 음성 ${organizationSnapshot.length}개`;
  const select=$('organize-model');select.replaceChildren(new Option('TTS 보조 LLM 연결 사용','shared'));
  [...$('helper-model').options].filter(o=>['model','submodel','emotion','translate','memory','otherAx'].includes(o.value)).forEach(o=>select.add(new Option(o.textContent,o.value)));
  resetOrganization();$('voice-organize-dialog').showModal();
};
$('organize-prompt').oninput=resetOrganization;$('organize-model').onchange=resetOrganization;
$('preview-voice-organization').onclick=()=>{
  resetOrganization();const host=$('voice-organization-results');
  $('organization-folders').replaceChildren(...voiceFolders.map(f=>new Option(f.name)));
  organizationProposal=organizationSnapshot.map(v=>{
    const start=v.name.lastIndexOf('('),end=v.name.lastIndexOf(')');
    const title=start>0&&end>start?v.name.slice(start+1,end).trim():'';
    return {key:v.key,oldName:v.name,name:title?v.name.slice(0,start).trim():v.name,folder:title||folderName(v.folderId),selected:true};
  });
  organizationProposal.forEach(row=>{
    const box=node('div',undefined,'organization-row'),check=node('input'),name=node('input'),folder=node('input');
    check.type='checkbox';check.checked=true;check.setAttribute('aria-label',row.oldName+' 정리안 선택');
    name.value=row.name;name.maxLength=120;name.setAttribute('aria-label',row.oldName+' 변경할 이름');
    folder.value=row.folder;folder.maxLength=80;folder.className='organization-folder';folder.setAttribute('list','organization-folders');folder.setAttribute('aria-label',row.oldName+' 대상 폴더');
    check.onchange=()=>{row.selected=check.checked;$('apply-voice-organization').disabled=!organizationProposal.some(r=>r.selected);};
    name.oninput=()=>row.name=name.value;folder.oninput=()=>row.folder=folder.value;
    box.append(check,name,folder,node('small','기존: '+row.oldName));host.append(box);
  });
  $('organize-status').textContent=`${organizationProposal.length}개 정리안 · 작품별 분류 예시 · 아직 적용 안 함`;
  $('apply-voice-organization').disabled=!organizationProposal.length;
};
$('apply-voice-organization').onclick=()=>{
  const rows=organizationProposal.filter(r=>r.selected);
  if(rows.some(r=>!r.name.trim())){$('organize-status').textContent='빈 음성 이름을 확인해 주세요.';return;}
  for(const row of rows){const voice=voices.find(v=>v.key===row.key);if(voice){voice.name=row.name.trim();voice.folderId=row.folder.trim()==='미분류'?'':ensureVoiceFolder(row.folder);}}
  $('voice-organize-dialog').close();refreshSelectors();renderVoices();notify(`${rows.length}개 정리안 적용 완료`);
};
$('import-voice').onclick=()=>$('voice-file').click();
$('voice-file').onchange=async()=>{
  const file=$('voice-file').files[0];if(!file)return;
  try{
    if(file.size>2_000_000)throw Error('2MB 이하 JSON을 선택해 주세요.');
    const parsed=JSON.parse(await file.text()),library=parsed?.format==='omni-tts-library'&&parsed.version===1;
    const items=library?parsed.voices:parsed,folders=library?parsed.folders:[];
    if(!Array.isArray(items)||items.length>2000||!items.every(v=>v&&typeof v.name==='string'&&v.name.trim()&&v.name.length<=120&&typeof v.tag==='string'&&v.tag.length<=250&&typeof v.id==='string'&&v.id.trim()&&v.id.length<=128))throw Error('name, tag, id 음성 배열을 확인하세요.');
    if(!Array.isArray(folders)||folders.length>500||!folders.every(f=>typeof f?.id==='string'&&typeof f.name==='string'&&f.name.trim()&&f.name.length<=80)||new Set(folders.map(f=>f.id)).size!==folders.length)throw Error('폴더 형식을 확인하세요.');
    if(library&&items.some(v=>v.folderId&&!folders.some(f=>f.id===v.folderId)))throw Error('음성의 대상 폴더가 없습니다.');
    const mapping=new Map(folders.map(f=>[f.id,ensureVoiceFolder(f.name)])),existing=new Set(voices.map(v=>`${v.name}\t${v.id}`));let added=0;
    for(const v of items){const identity=`${v.name}\t${v.id}`;if(existing.has(identity))continue;const gender=genderOf(v.tag),base=gender==='여성'?1:gender==='남성'?1001:2001;
      voices.push({name:v.name,tag:v.tag,id:v.id,folderId:mapping.get(v.folderId)||'',key:nextKey++,gender,number:Math.max(base-1,...voices.filter(v=>v.gender===gender).map(v=>v.number))+1});existing.add(identity);added++;
    }
    activeVoiceFolder='all';refreshSelectors();renderVoices();notify(`${added}개 음성 가져오기 완료`);
  }catch(error){notify(error.message);}finally{$('voice-file').value='';}
};
$('export-voice').onclick=()=>{
  const data={format:'omni-tts-library',version:1,folders:voiceFolders.map(f=>({...f})),voices:voices.map(v=>({name:v.name,tag:v.tag,id:v.id,folderId:v.folderId||''}))};
  const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})),link=node('a');link.href=url;link.download='omni-tts-library.preview.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};

let selectedTtsCharacter=null;
function wireCharacterTile(card,character){
  card.tabIndex=0;card.dataset.characterKey=String(character.key);card.classList.toggle('tile-selected',selectedTtsCharacter===character.key);
  card.setAttribute('aria-label',character.name+(characterBatchActive?' · 음성 배정 대상 선택':' · 선택 후 다시 누르면 편집'));
  if(characterBatchActive){card.setAttribute('role','button');card.append(node('span',undefined,'char-batch-check'));}
  const pick=event=>{if(characterBatchActive){pickCharacterBatch(character.key,event);return;}if(selectedTtsCharacter===character.key){openCharacter(character.key);return;}selectedTtsCharacter=character.key;document.querySelectorAll('.char-card').forEach(c=>c.classList.toggle('tile-selected',Number(c.dataset.characterKey)===selectedTtsCharacter));};
  card.onclick=event=>{if(event.target.closest('input,label,button'))return;pick(event);};
  card.onkeydown=event=>{if(event.target===card&&['Enter',' '].includes(event.key)){event.preventDefault();pick(event);}};
}
