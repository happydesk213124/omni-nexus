import assert from 'node:assert/strict';
import {test} from 'node:test';
import {build} from 'esbuild';
import {runInNewContext} from 'node:vm';

test('explorer lists only asset names with no lore, recipe, body or pixel reads', async () => {
  const forbidden = () => { throw new Error('Listing touched deferred storage'); };
  const chars = ['a','b'].map(id => ({chaId:id,name:id,chats:[{id:'room',name:'Room'}],additionalAssets:[]}));
  for (const char of chars) {
    Object.defineProperty(char,'globalLore',{get:forbidden});
    Object.defineProperty(char.chats[0],'message',{get:forbidden});
    Object.defineProperty(char.chats[0],'localLore',{get:forbidden});
  }
  const context = {console, Date, setTimeout, clearTimeout, TextEncoder, TextDecoder,
    risuai:{getDatabase:async()=>({characters:chars}),getCurrentCharacterIndex:async()=>1,
      getCharacterFromIndex:forbidden,getChatFromIndex:forbidden,readImage:forbidden,
      pluginStorage:{getItem:forbidden,setItem:forbidden},getLocalPluginStorage:forbidden}};
  const built=await build({stdin:{contents:"export {galleryExplore} from './src/services/gallery'; export {sessionIdHash} from './src/core/util/text'; export {invalidateShotListing} from './src/storage/shot-character';",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'iife',globalName:'Subject'});
  runInNewContext(built.outputFiles[0].text,context);
  const api=context.Subject;
  for (const char of chars) char.additionalAssets.push(
    ['portrait','ignore','png'],
    [`inxshot_${char.chaId}1.srisu_${api.sessionIdHash(char.chaId+'|room')}.webp`,'first','webp'],
    [`inxshot_${char.chaId}2.sold.webp`,'second','webp']);
  const result=await api.galleryExplore();
  assert.deepEqual(Array.from(result.items,row=>row.id),['b2','b1','a2','a1']);
  assert.equal(result.total,4);
  assert.equal(result.folders.find(f=>f.key==='b|unknown').chat_name,'채팅 미확인');
  assert.equal(result.folders.find(f=>f.key==='a|room').chat_name,'Room');
  assert.ok(result.items.every(row=>!row.main_prompt && row.characters.length===0 && row.png_bytes===0));
  const limited=await api.galleryExplore(1);
  assert.equal(limited.items.length,1);
  assert.equal(limited.folders.reduce((n,f)=>n+f.count,0),4);
  assert.equal(limited.total,4);
  chars[1].additionalAssets.push(['inxshot_b3.webp','third','webp']);
  api.invalidateShotListing('b');
  assert.equal((await api.galleryExplore()).items[0].id,'b3');
});


test('thumbnail requests join by id, read listed assets directly and cap concurrency', async () => {
  let active=0, peak=0, reads=0, urls=0;
  const release=[];
  const context={console,Date,setTimeout,clearTimeout,TextEncoder,TextDecoder,Blob,Uint8Array,ArrayBuffer,
    URL:{createObjectURL:()=>`blob:${++urls}`,revokeObjectURL:()=>{}},
    risuai:{getDatabase:async()=>({characters:[{chaId:'a',additionalAssets:Array.from({length:8},(_,i)=>[`inxshot_${i}.webp`,`file/${i}`])}]}),
      readImage:async()=>{reads++;peak=Math.max(peak,++active);await new Promise(resolve=>release.push(resolve));active--;return new Uint8Array(64);},
      pluginStorage:{getItem:()=>{throw new Error('thumbnail must not consult card store');}}}};
  const built=await build({stdin:{contents:"export {listShotAssets} from './src/storage/shot-character'; export {ensureExplorerThumbUrl,dropExplorerThumbUrl} from './src/storage/explorer-thumbs';",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'iife',globalName:'Subject'});
  runInNewContext(built.outputFiles[0].text,context);
  const api=context.Subject;await api.listShotAssets();
  const first=api.ensureExplorerThumbUrl('0');
  assert.equal(api.ensureExplorerThumbUrl('0'),first,'same pending promise');
  const rest=Array.from({length:7},(_,i)=>api.ensureExplorerThumbUrl(String(i+1)));
  api.dropExplorerThumbUrl('7');
  for(let i=0;i<10;i++){release.splice(0).forEach(done=>done());await new Promise(resolve=>setImmediate(resolve));}
  const results=await Promise.all([first,...rest]);
  assert.equal(peak,3);assert.equal(reads,7);assert.equal(urls,7);
  assert.equal(results[7],'','queued offscreen item never loaded');
  assert.equal(await api.ensureExplorerThumbUrl('0'),results[0]);
});
