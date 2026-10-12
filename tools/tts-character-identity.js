// Review-only identity rules. Trigger overlap is not evidence of the same person.
function identityKey(value){return String(value||'').normalize('NFKC').toLowerCase().replace(/[\s_.·•･-]+/g,'');}
function identityParts(value){return String(value||'').split(/[,/\n]/).map(identityKey).filter(Boolean);}
function givenKeys(character){return identityParts(character.given_name||character.name).concat(identityParts(character.given_name_variants));}
function surnameKeys(character){return identityParts(character.surname).concat(identityParts(character.surname_variants));}
function sameTtsIdentity(a,b){
  if(!(identityKey(a.name)&&identityKey(a.name)===identityKey(b.name))&&!givenKeys(a).some(key=>givenKeys(b).includes(key)))return false;
  const left=surnameKeys(a),right=surnameKeys(b);
  return !left.length||!right.length||left.some(key=>right.includes(key));
}
function resolveTtsSpeaker(name,roster=chars){
  const key=identityKey(name);if(!key)return null;
  const exact=roster.filter(c=>identityKey(c.name)===key||surnameKeys(c).some(s=>givenKeys(c).some(g=>s+g===key||g+s===key)));
  const candidates=exact.length?exact:roster.filter(c=>[...givenKeys(c),...(c.triggers||[]).map(identityKey)].includes(key));
  if(candidates.length===1)return candidates[0];
  if(candidates.some((a,i)=>candidates.slice(i+1).some(b=>!sameTtsIdentity(a,b))))return null;
  const local=candidates.filter(c=>c.scope==='chat');
  return local.length===1?local[0]:null;
}
function characterIdentityFields(){return Object.fromEntries(['surname','given_name','surname_variants','given_name_variants'].map(field=>[field,$('c-'+field).value.trim()]));}
function saveTtsCharacter(draft,editingKey){
  const candidates=chars.filter(c=>c.key!==editingKey&&c.scope===draft.scope&&sameTtsIdentity(c,draft));
  // A surname-less record must not bridge Kim Minji and Lee Minji into one row.
  const group=[draft,...candidates];
  if(group.some((a,i)=>group.slice(i+1).some(b=>!sameTtsIdentity(a,b)))){
    notify('같은 이름의 후보가 여러 명입니다. 성을 입력해 구분해 주세요.');return false;
  }
  const prior=chars.find(c=>c.key===editingKey),keep=prior||candidates[0];
  const merged={...draft,key:keep?.key??charKey++,triggers:[...new Set([...draft.triggers,...candidates.flatMap(c=>c.triggers)])]};
  for(const field of ['surname','given_name','surname_variants','given_name_variants'])merged[field]=draft[field]||keep?.[field]||candidates.find(c=>c[field])?.[field]||'';
  for(const field of ['surname','given_name']){
    const variants=field+'_variants';
    merged[variants]=[...new Set([merged[variants],...candidates.flatMap(c=>[c[variants],c[field]])].filter(Boolean).flatMap(value=>value.split(/[,/\n]/).map(part=>part.trim()).filter(part=>part&&identityKey(part)!==identityKey(merged[field]))))].join(', ');
  }
  if(candidates.length){
    merged.tags=[...new Set([...draft.tags,...candidates.flatMap(c=>c.tags||[])])];
    // Adding the same person retains their voice preferences; editing can change them.
    if(!prior){merged.voice=keep.voice;merged.lock=keep.lock;merged.gain=keep.gain;merged.name=keep.name;}
  }
  const absorbed=new Set([editingKey,...candidates.map(c=>c.key)]);
  const position=chars.findIndex(c=>absorbed.has(c.key));
  for(let i=chars.length-1;i>=0;i--)if(absorbed.has(chars[i].key))chars.splice(i,1);
  chars.splice(position<0?chars.length:position,0,merged);
  if(candidates.length)notify('같은 이름의 캐릭터를 통합했습니다.');
  return true;
}
