import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from 'playwright';

test('large roster thumbnail updates use scoped indexes, preserve fallback and survive remount',async()=>{
 const bundle=await build({stdin:{contents:`
 export * from './src/settings-ux/character-preview-index';
 export * from './src/settings-ux/reference-progress';
 export {publishCharacterImage} from './src/core/character-ui-events';
 `,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'iife',globalName:'previewTest'});
 const browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
 try {
  const page=await browser.newPage();
  await page.setContent('<main></main>');
  await page.addScriptTag({content:bundle.outputFiles[0].text});
  const result=await page.evaluate(()=>{
   const api=previewTest,main=document.querySelector('main');
   let creates=0,globalScans=0;
   const query=document.querySelectorAll.bind(document),create=document.createElement.bind(document);
   document.querySelectorAll=(selector)=>{globalScans++;return query(selector);};
   document.createElement=(tag,...args)=>{if(tag==='img')creates++;return create(tag,...args);};
   const make=(scope,id)=>{
    const card=create('div');card.className='char-card';card.dataset.charId=id;card.dataset.charScope=scope;card.dataset.charRefScope=scope;
    card.innerHTML='<input data-char-name value="Alice"><div data-char-ref-preview></div><div data-char-ex-preview><img src="data:image/png;base64,EXAMPLE"></div><span data-char-ref-status></span>';
    const tile=create('button');tile.dataset.uxCharacterTile=id;tile.dataset.uxCharacterScope=scope;tile.innerHTML='<span data-character-label></span>';
    main.append(card,tile);api.registerCharacterPreview(card,tile);return {card,tile};
   };
   api.resetCharacterPreviewIndex();
   const pairs=Array.from({length:500},(_,i)=>make('bot-A',String(i)));
   const other=make('bot-B','0');
   api.syncCharacterTilePreviews();
   const initialScans=globalScans;
   api.connectCharacterImages();globalScans=0;creates=0;
   for(let i=0;i<500;i++)api.publishCharacterImage({scope:'bot-A',id:String(i),kind:'ref',url:'data:image/png;base64,REF'+i,configured:true});
   const updateScans=globalScans;
   const image=pairs[0].card.querySelector('img');
   api.publishCharacterImage({scope:'bot-A',id:'0',kind:'ref',url:'data:image/png;base64,REF0',configured:true});
   const sameNode=image===pairs[0].card.querySelector('img');
   const isolated=other.tile.querySelector('img').getAttribute('src').endsWith('EXAMPLE');
   api.publishCharacterImage({scope:'bot-A',id:'0',kind:'ref',url:'',configured:false});
   const fallback=pairs[0].tile.querySelector('img').getAttribute('src').endsWith('EXAMPLE');
   const held=pairs[1];held.card.remove();held.tile.remove();
   const disconnected=api.characterPreviewPairs('bot-A','1').length;
   main.append(held.card,held.tile);
   const restored=api.characterPreviewPairs('bot-A','1').length;
   main.replaceChildren();api.resetCharacterPreviewIndex();
   const replacement=make('bot-C','0');api.connectCharacterImages();
   const stale=!!replacement.card.querySelector('[data-char-ref-preview] img');
   return {initialScans,updateScans,sameNode,isolated,fallback,disconnected,restored,stale};
  });
  assert.equal(result.initialScans,1);
  assert.equal(result.updateScans,0,'image updates must not search the document');
  assert.equal(result.sameNode,true);
  assert.equal(result.isolated,true);
  assert.equal(result.fallback,true);
  assert.equal(result.disconnected,0);
  assert.equal(result.restored,1);
  assert.equal(result.stale,false);
 } finally {await browser.close();}
});
