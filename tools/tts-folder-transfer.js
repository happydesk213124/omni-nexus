// Folder sharing in the review catalog; no provider keys or character assignments.
let folderImportRows=[];
function updateFolderTransfer(){
  $('export-voice-folder').disabled=activeVoiceFolder==='all';
  $('export-voice-folder').title=activeVoiceFolder==='all'?'내보낼 폴더를 먼저 선택해 주세요.':folderName(activeVoiceFolder)+' 전체 음성 내보내기';
}
const folderMenu=$('voice-folder-menu');
folderMenu.addEventListener('toggle',()=>{
  if(!folderMenu.open)return;
  updateFolderTransfer();
  const anchor=folderMenu.querySelector('summary').getBoundingClientRect(),menu=$('voice-folder-menu-items');
  menu.style.left=Math.max(8,Math.min(innerWidth-188,anchor.right-180))+'px';
  menu.style.top=Math.max(8,Math.min(innerHeight-menu.offsetHeight-8,anchor.bottom+4))+'px';
});
document.addEventListener('pointerdown',event=>{if(!folderMenu.contains(event.target))folderMenu.open=false;});
folderMenu.addEventListener('keydown',event=>{if(event.key==='Escape'){folderMenu.open=false;folderMenu.querySelector('summary').focus();}});
window.addEventListener('resize',()=>folderMenu.open=false);
$('export-voice-folder').onclick=()=>{
  if(activeVoiceFolder==='all')return;
  const name=folderName(activeVoiceFolder);
  const data={format:'omni-tts-folder',version:1,name,voices:voices.filter(v=>(v.folderId||'')===activeVoiceFolder).map(v=>({name:v.name,tag:v.tag,id:v.id}))};
  const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})),link=node('a');
  link.href=url;link.download=(name.replace(/[<>:"/\\|?*\x00-\x1f]/g,'_')||'voice-folder')+'.json';link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);folderMenu.open=false;
};
$('import-voice-folder').onclick=()=>$('voice-folder-file').click();
$('voice-folder-file').onchange=async()=>{
  const file=$('voice-folder-file').files[0];if(!file)return;
  folderImportRows=[];
  try{
    if(file.size>2_000_000)throw Error('2MB 이하 JSON을 선택해 주세요.');
    const parsed=JSON.parse(await file.text());
    const folder=parsed?.format==='omni-tts-folder'&&parsed.version===1;
    const library=parsed?.format==='omni-tts-library'&&parsed.version===1;
    const items=folder||library?parsed.voices:parsed;
    if(!Array.isArray(items)||items.length>2000||!items.every(v=>v&&typeof v.name==='string'&&v.name.trim()&&v.name.length<=120&&typeof v.tag==='string'&&v.tag.length<=250&&typeof v.id==='string'&&v.id.trim()&&v.id.length<=128))throw Error('name, tag, id 음성 배열을 확인하세요.');
    const seen=new Set();
    folderImportRows=items.filter(v=>{const key=v.name+'\t'+v.id;if(seen.has(key))return false;seen.add(key);return true;}).map(v=>({name:v.name,tag:v.tag,id:v.id}));
    const suggested=folder&&typeof parsed.name==='string'?parsed.name:file.name.replace(/\.json$/i,'');
    $('folder-import-name').value=suggested.trim().slice(0,80)||'가져온 음성';
    $('folder-import-status').textContent=`음성 ${folderImportRows.length}개 · 새 폴더로 가져오기`;
    $('folder-import-error').textContent='';folderMenu.open=false;$('folder-import-dialog').showModal();
  }catch(error){notify(error.message);}finally{$('voice-folder-file').value='';}
};
$('folder-import-form').onsubmit=event=>{
  event.preventDefault();const name=$('folder-import-name').value.trim();
  if(!name){$('folder-import-error').textContent='폴더 이름을 입력해 주세요.';return;}
  if(voiceFolders.some(f=>f.name.toLocaleLowerCase()===name.toLocaleLowerCase())){$('folder-import-error').textContent='같은 이름의 폴더가 있습니다. 다른 이름을 입력해 주세요.';return;}
  const folderId=ensureVoiceFolder(name);
  // Copies remain in this folder even if the same preset already exists elsewhere.
  for(const row of folderImportRows){
    const gender=genderOf(row.tag),base=gender==='여성'?1:gender==='남성'?1001:2001;
    voices.push({...row,folderId,key:nextKey++,gender,number:Math.max(base-1,...voices.filter(v=>v.gender===gender).map(v=>v.number))+1});
  }
  const count=folderImportRows.length;folderImportRows=[];activeVoiceFolder=folderId;selectedVoices.clear();voiceAnchor=null;
  $('voice-search').value='';$('gender-filter').value='all';$('folder-import-dialog').close();refreshSelectors();renderVoices();notify(`${name} · 음성 ${count}개 가져오기 완료`);
};
$('folder-import-dialog').addEventListener('close',()=>{folderImportRows=[];});
