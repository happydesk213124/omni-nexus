import { characterImages, characterImagePatch, subscribeCharacterImages, type CharacterImageChange } from '../core/character-ui-events';
import { referenceProgress, subscribeReferenceProgress } from '../core/reference-progress';
let installed=false;
function applyImage(change:CharacterImageChange):void {
  const bridge=Reflect.get(globalThis,'__OMNI_PATCH_CHARACTER__') as ((scope:string,id:string,patch:Record<string,unknown>)=>void)|undefined;
  bridge?.(change.scope,change.id,characterImagePatch(change));
  for(const card of document.querySelectorAll<HTMLElement>('.char-card[data-char-id]')) {
    if(card.dataset.charId!==change.id || card.dataset.charRefScope!==change.scope)continue;
    const slot=card.querySelector<HTMLElement>(change.kind==='ref'?'[data-char-ref-preview]':'[data-char-ex-preview]');
    if(slot) {
      slot.replaceChildren();
      if(change.url){const img=document.createElement('img');img.src=change.url;img.alt='';img.style.cssText='width:100%;height:100%;object-fit:contain';slot.append(img);}
    }
    if(change.kind==='ref'){const status=card.querySelector('[data-char-ref-status]');if(status)status.textContent=change.configured?'설정됨':'없음';}
    card.dispatchEvent(new Event('omni-character-refresh'));
  }
  syncCharacterTilePreviews();
}
export function connectCharacterImages():void {
  if(!installed){installed=true;subscribeReferenceProgress(paintReferenceProgress);subscribeCharacterImages(applyImage);}
  for(const image of characterImages())applyImage(image);
}

/** Mirror the latest hidden vendor preview into the visible square tile. */
export function syncCharacterTilePreviews():void {
  const cards=[...document.querySelectorAll<HTMLElement>('.char-card[data-char-id]')];
  for(const tile of document.querySelectorAll<HTMLElement>('[data-ux-character-tile]')) {
    const card=cards.find(c=>c.dataset.charId===tile.dataset.uxCharacterTile && c.dataset.charScope===tile.dataset.uxCharacterScope);
    if(!card)continue;
    const label=tile.querySelector<HTMLElement>('[data-character-label]');
    if(label)label.textContent=card.querySelector<HTMLInputElement>('[data-char-name]')?.value || '(이름 없음)';
    // A registered/generated reference is the roster thumbnail. Example-shot is fallback only.
    const source=card.querySelector<HTMLImageElement>('[data-char-ref-preview] img')
      || card.querySelector<HTMLImageElement>('[data-char-ex-preview] img');
    let image=tile.querySelector<HTMLImageElement>('img[data-character-preview]');
    if(!source?.src) { image?.remove(); continue; }
    if(!image) {
      image=document.createElement('img');
      image.dataset.characterPreview='1';
      image.alt='';
      tile.prepend(image);
    }
    if(image.src!==source.src) image.src=source.src;
  }
}

export function paintReferenceProgress():void {
  if(!installed)connectCharacterImages();
  syncCharacterTilePreviews();
  for(const state of referenceProgress()) {
    const tiles=[...document.querySelectorAll<HTMLElement>(state.kind==='preset'?'[data-preset-select]':'[data-ux-character-tile]')];
    for(const tile of tiles) {
      if((state.kind==='preset'?tile.dataset.presetSelect:tile.dataset.uxCharacterTile)!==state.id)continue;
      if(state.kind==='character') {
        const card=[...document.querySelectorAll<HTMLElement>('.char-card[data-char-id]')].find(c=>c.dataset.charId===state.id && c.dataset.charScope===tile.dataset.uxCharacterScope);
        if(card?.dataset.charRefScope!==state.scope)continue;
      }
      tile.setAttribute('aria-busy',String(state.busy));
      tile.querySelector('[data-reference-status]')?.remove();
      if(state.busy || state.error){const status=document.createElement('span');status.dataset.referenceStatus='1';status.textContent=state.busy?'생성 중':state.error!;if(state.busy){const ring=document.createElement('i');ring.style.cssText='width:22px;height:22px;border:3px solid #5741d8;border-top-color:transparent;border-radius:50%';ring.animate([{transform:'rotate(0deg)'},{transform:'rotate(360deg)'}],{duration:900,iterations:Infinity});status.prepend(ring);}status.style.cssText='position:absolute;inset:0;display:grid;place-items:center;background:#101620cc;color:#c4b5fd;';tile.append(status);}
      if(!state.busy && !state.error && state.url){let img=tile.querySelector<HTMLImageElement>('img[data-character-preview],img');if(!img){img=document.createElement('img');img.dataset.characterPreview='1';img.alt='';tile.prepend(img);}img.src=state.url;}
    }
  }
}
