import { risuHost } from '../core/host';
import { COSTUME_FIELDS } from '../domain/character/costume';
import { characterAssetTerms } from '../domain/nai-meta/reference-search';
import { parseAliasList } from '../core/util/text';
import { openAssetDialog } from './asset-dialog';

function blobDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(String(reader.result||''));
    reader.onerror=()=>reject(reader.error||new Error('에셋 이미지 인코딩 실패'));
    reader.readAsDataURL(blob);
  });
}

export async function pickCharacterAsset(card: HTMLElement, source: 'character' | 'module' = 'character'): Promise<void> {
  const host = risuHost();
  const targetId = card.dataset.charId;
  const selected = document.querySelector<HTMLSelectElement>('#nx-scope-char')?.value || 'live';
  const selection = selected === 'live' ? host?.getCurrentCharacterIndex?.() : Promise.resolve(Number(selected));
  const current = () => card.isConnected
    && card.dataset.charId === targetId
    && (document.querySelector<HTMLSelectElement>('#nx-scope-char')?.value || 'live') === selected
    && (!document.getElementById('nx-char-edit-body')?.dataset.selectedId
      || document.getElementById('nx-char-edit-body')?.dataset.selectedId === card.dataset.charId);
  const scope = card.dataset.charRefScope;
  let character: Record<string, unknown> | undefined;
  const field = (name: string) => card.querySelector<HTMLInputElement>(`[data-char-${name}]`)?.value || '';
  const costumeLabel = document.createElement('label');
  const asCostume = document.createElement('input'); asCostume.type = 'checkbox';
  costumeLabel.append(asCostume, ' 코스튬으로 추가');
  await openAssetDialog({
    source, label: '캐릭터 에셋 선택', characterIndex: selection ?? Promise.resolve(undefined), current,
    search: characterAssetTerms({ name: field('name'), aliases: parseAliasList(field('aliases')),
      surname: field('surname'), given_name: field('given'),
      surname_variants: parseAliasList(field('surname-variants')), given_name_variants: parseAliasList(field('given-variants')) }).join(', '),
    extras: [costumeLabel],
    onCharacter: row => { character = row; },
    pick: async (asset, blob, ui) => {
      ui.status('에셋 분석 중…');
      const native=(globalThis as typeof globalThis & {
        __INLAY_NATIVE__?:{fetch?:(path:string,opts:Record<string,unknown>,timeout?:number)=>Promise<Record<string,unknown>>}
      }).__INLAY_NATIVE__;
      if(!native?.fetch)throw new Error('에셋 분석 연결 없음');
      const aliases=card.querySelector<HTMLInputElement>('[data-char-aliases]')?.value||'';
      const rosterName=card.querySelector<HTMLInputElement>('[data-char-name]')?.value||asset.name;
      const hostCharacterId=String(character?.chaId||character?.chid||'');
      const imageB64 = await blobDataUrl(blob);
      const result=await native.fetch('/v1/characters/analyze-asset',{
        method:'POST',
        body:{
          image_b64:imageB64,
          asset_name:asset.name,
          name:rosterName,
          aliases,
          session_id:scope||'',
          character_id:hostCharacterId,
        },
      },180000);
      if (!result || !COSTUME_FIELDS.some(key => typeof result[key] === 'string' && result[key])) throw new Error('외형 분석 결과가 없습니다.');
      if (ui.closed() || !current()) return;
      if (targetId && scope) {
        await native.fetch('/v1/characters/ref', { method: 'POST', body: {
          character_id: targetId, scope, session_id: scope, image_b64: imageB64, overwrite: false,
        } }, 60000);
        if (ui.closed() || !current()) return;
      }
      const select = card.querySelector<HTMLSelectElement>('[data-char-costume]');
      if (asCostume.checked) {
        if (!select) throw new Error('코스튬 선택 연결 없음');
        select.value = '__add__'; select.dispatchEvent(new Event('change', { bubbles: true }));
      }
      for (const key of COSTUME_FIELDS) {
        const input = card.querySelector<HTMLInputElement>(`[data-char-${key.replaceAll('_', '-')}]`);
        if (!input) continue;
        input.value = result[key] == null ? (asCostume.checked ? '[base]' : '') : String(result[key]);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      if(!asCostume.checked && typeof result.gender==='string' && result.gender) {
        const gender=card.querySelector<HTMLSelectElement>('[data-char-gender]');
        if(gender) { gender.value=result.gender; gender.dispatchEvent(new Event('change',{bubbles:true})); }
      }
      ui.status(result.source==='metadata'?'메타데이터 · 에셋 태거 완료':'메타데이터 없음 · 이미지 오토태그 완료');
      card.dispatchEvent(new Event('omni-autotag')); ui.close();
    },
  });
}
