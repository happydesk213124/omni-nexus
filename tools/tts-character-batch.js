// Review-only batch selection; no JEV request is sent.
let characterBatchActive=false,characterBatchAnchor=null;
const batchCharacters=new Set();
function visibleCharacterKeys(){return [...document.querySelectorAll('.char-card')].map(card=>Number(card.dataset.characterKey));}
function paintCharacterBatch(){
  $('character-jev-bar').hidden=!characterBatchActive;
  $('batch-jev-characters').setAttribute('aria-pressed',String(characterBatchActive));
  $('character-jev-count').textContent=`선택 중 · ${batchCharacters.size}명`;
  $('character-jev-apply').disabled=!batchCharacters.size;
  $('character-jev-clear').disabled=!batchCharacters.size;
  if(!characterBatchActive)return;
  document.querySelectorAll('.char-card').forEach(card=>{
    const selected=batchCharacters.has(Number(card.dataset.characterKey));
    card.classList.toggle('tile-selected',selected);card.setAttribute('aria-pressed',String(selected));
    card.querySelector('.char-batch-check').textContent=selected?'✓':'';
  });
}
function pickCharacterBatch(key,event={}){
  const keys=visibleCharacterKeys(),from=keys.indexOf(characterBatchAnchor),to=keys.indexOf(key);
  if(event.shiftKey&&from>=0&&to>=0)keys.slice(Math.min(from,to),Math.max(from,to)+1).forEach(k=>batchCharacters.add(k));
  else{if(batchCharacters.has(key))batchCharacters.delete(key);else batchCharacters.add(key);characterBatchAnchor=key;}
  paintCharacterBatch();
}
function finishCharacterBatch(){characterBatchActive=false;batchCharacters.clear();characterBatchAnchor=null;renderCharacters();}
$('batch-jev-characters').onclick=()=>{
  if(characterBatchActive){finishCharacterBatch();return;}
  characterBatchActive=true;batchCharacters.clear();characterBatchAnchor=null;
  $('character-jev-folder').replaceChildren(new Option('전체 폴더','all'),new Option('미분류',''),...voiceFolders.map(f=>new Option(f.name,f.id)));
  renderCharacters();
};
$('character-jev-all').onclick=()=>{visibleCharacterKeys().forEach(k=>batchCharacters.add(k));paintCharacterBatch();};
$('character-jev-clear').onclick=()=>{batchCharacters.clear();characterBatchAnchor=null;paintCharacterBatch();};
$('character-jev-cancel').onclick=finishCharacterBatch;
$('character-jev-apply').onclick=()=>{
  const folder=$('character-jev-folder').value,candidates=voices.filter(v=>folder==='all'||(v.folderId||'')===folder);
  let assigned=0,locked=0,missing=0;
  for(const c of chars.filter(c=>batchCharacters.has(c.key))){
    if(c.lock){locked++;continue;}
    const voice=candidates.find(v=>c.gender==='미지정'||c.gender===v.gender);
    if(!voice){missing++;continue;}c.voice=voice.id;assigned++;
  }
  finishCharacterBatch();
  notify(`${assigned}명 배정 예시 · 고정 ${locked} · 후보 없음 ${missing} · JEV 미연결`);
};
