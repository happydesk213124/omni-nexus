import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';
import { repairInspectFullscreen } from '../tools/vendor-patches/inspect.mjs';

const config = await readFile('vite.config.ts', 'utf8');
function opener(context) {
  context.nxCloneInspectImage ||= async card => ({cardId:card.id});
  context.nxDropInspectImage = async () => {};
  context.nxInspectMirroredImage = null;
  const start = config.indexOf('      const nxOpenAssetInspect = async');
  const end = config.indexOf('      const nxFireTap = async', start);
  assert.ok(start > 0 && end > start);
  runInNewContext(config.slice(start, end) + '\nthis.open = nxOpenAssetInspect;', context);
  return context.open;
}
test('inspect fills resolved names without querying chip DOM', async () => {
  let painted;
  const c = { t: {}, K: async url => url==='/v1/shots/resolve-cast' ? {9396:'First',1234:'Second'} : ({image_url:'data:image/webp;base64,FILE', ids:['9396','1234'], names:{}}),
    showStickyInspect: async view => {painted = structuredClone(view);},
    updateStickyInspect: async view => {painted = structuredClone(view);},
    e:{querySelectorAll:()=>{throw new Error('SafeDOM does not expose data attributes');}}, k:{}, y:()=>{} };
  const card={id:'card',characters:[{name:'Old'}]};
  await opener(c)(card,'inxshot_card.c9396-1234.webp');
  await c.t._inspectLoad;
  assert.deepEqual(painted.characters.map(row=>row.name), ['First','Second']);
  assert.equal(painted._nxImage.cardId,'card');
  assert.equal(card.characters[0].name,'Old');
});
test('a missing file replaces loading with an explicit error in the open inspect', async () => {
  let opened=0,last; const errors=[];
  const c={t:{},nxCloneInspectImage:async()=>{throw new Error('image_not_found');},K:async()=>{throw new Error('asset_not_found');},showStickyInspect:async()=>opened++,updateStickyInspect:async view=>{last={...view};},y:(...args)=>errors.push(args)};
  await opener(c)({id:'card'},'inxshot_missing.webp');
  await c.t._inspectLoad;
  assert.equal(opened,1); assert.ok(errors.length); assert.ok(last._nxInspectError);assert.equal(last._nxAssetLoading,false);
});

test('frozen fullscreen uses file base64 even when the card cache returns another image', async () => {
  const source = repairInspectFullscreen(await readFile('vendor/inlay-nexus-ui.js','utf8'));
  const start = source.indexOf('showFullscreen = async (f) => {');
  const end = source.indexOf('}, addInspectBtn =',start);
  let html;
  const c={Ie:()=> 'blob:stale-thumbnail', fullscreen:{setInnerHTML:async value=>{html=value;},setStyleAttribute:async()=>{}}};
  runInNewContext('const '+source.slice(start,end)+'}; this.show=showFullscreen;',c);
  await c.show({id:'card',image_url:'data:image/webp;base64,FILE'});
  assert.match(html,/src="data:image\/webp;base64,FILE"/);
  assert.throws(()=>repairInspectFullscreen(source),/needle drift/);
});

test('tap awaits a rejected SafeDOM preventDefault promise and still opens inspect', async () => {
  const start=config.indexOf('      const nxFireTap = async');
  const end=config.indexOf('      const nxArmInspect =',start);
  let settled=false,opened=false;
  const c={t:{},nxTapNeed:()=>3,x:0,I:0,nxAssetNameOf:async()=> 'asset',
    f:{preventDefault:async()=>{await Promise.resolve();settled=true;throw new Error('Method preventDefault missing on instance');}},
    __INLAY_VIEWER_CORE__:{imagePressTapHits:()=>({hit:true,count:3})},cancelMobilePress:()=>{},
    nxOpenAssetInspect:async()=>{assert.ok(settled);opened=true;}};
  runInNewContext(config.slice(start,end)+'this.tap=nxFireTap;',c);
  await c.tap({id:'card'},{}); assert.ok(opened);
});

test('fullscreen button cancels the event, never the SafeDOM document', async () => {
  const start=config.indexOf('      // Baked Inray fullscreen chip');
  const end=config.indexOf('      // Baked overlay: 새로고침',start);
  assert.ok(start>0 && end>start);
  let documentCalls=0,eventSettled=false,opened=false;
  const node={getAttribute:async key=>key==='data-inray-fs'?'card':''};
  const c={inspectOpen:false,x:0,I:0,t:{gallery:[{id:'card'}]},k:{},hitEl:async()=>true,
    e:{querySelectorAll:async()=>[node],preventDefault:()=>{documentCalls++;throw new Error('Not an event');}},
    f:{preventDefault:async()=>{await Promise.resolve();eventSettled=true;throw new Error('Method missing');}},
    cancelMobilePress:()=>{},nxAssetNameOf:async()=> 'filename',
    nxOpenAssetInspect:async(card,name)=>{assert.equal(await name,'filename');assert.ok(eventSettled);opened=true;}};
  runInNewContext('this.press=async()=>{'+config.slice(start,end)+'};',c);
  await c.press(); assert.equal(documentCalls,0);assert.ok(opened);
});

const bundle = await build({stdin:{contents:"export {shotAssetByName} from './src/services/cast-ids'; export {invalidateShotListing} from './src/storage/shot-character';",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'esm',platform:'node'});
const api = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
test('Blob inspect returns original bytes without calling the base64 encoder', async () => {
  const name = 'inxshot_blob.webp';
  const bytes = Uint8Array.from({length: 64}, (_, i) => i);
  globalThis.risuai = {getDatabase: async () => ({characters: [], modules: [{id:'inlay-gallery',assets:[[name,'blob/path','webp']]}]}), readImage: async () => bytes};
  api.invalidateShotListing();
  const original = globalThis.btoa;
  globalThis.btoa = () => { throw new Error('base64 encoding forbidden'); };
  let result;
  try {
    result = await api.shotAssetByName(name, false, 'blob');
    assert.match(result.image_url, /^blob:/);
    assert.equal(result.image_bytes, bytes.byteLength);
    const response = await fetch(result.image_url);
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
  } finally {
    globalThis.btoa = original;
    if (result) URL.revokeObjectURL(result.image_url);
  }
});
test('file lookup reads character and legacy module assets; misses are explicit', async () => {
  const name='inxshot_old.c9396-1234.webp';
  const bytes=new Uint8Array(64);
  globalThis.risuai={getDatabase:async()=>({characters:[],modules:[{id:'inlay-gallery',assets:[[name,'saved/path','webp']]}]}),readImage:async path=>{assert.equal(path,'saved/path');return bytes;}};
  api.invalidateShotListing();
  const result=await api.shotAssetByName(name);
  assert.match(result.image_url,/^data:image\//);
  assert.deepEqual(result.ids,['9396','1234']);
  await assert.rejects(api.shotAssetByName('inxshot_missing.webp'), /asset_not_found/);
});

test('character asset wins over legacy; unreadable pixels fail and roster errors keep pixels', async () => {
  const name='inxshot_live.c9396-1234.webp';
  const roster=[{id:'first',name:'Renamed',cast_id:'9396'},{id:'second',name:'Second',cast_id:'1234'}];
  const lore={comment:'omni.nexus.data.global',key:'',alwaysActive:false,mode:'normal',content:JSON.stringify({version:1,characterId:'bot',roster})};
  const char={chaId:'bot',additionalAssets:[[name,'live/path','webp']],globalLore:[lore]};
  let unreadable=false;
  globalThis.risuai={getDatabase:async()=>({characters:[char],modules:[{id:'inlay-gallery',assets:[[name,'old/path','webp']]}]}),
    getCharacterFromIndex:async()=>char,readImage:async path=>{assert.equal(path,'live/path');return unreadable?null:new Uint8Array(64);}};
  api.invalidateShotListing();
  const result=await api.shotAssetByName(name);
  assert.deepEqual(result.ids,['9396','1234']);
  assert.equal(result.names['9396'],'Renamed');
  assert.equal(result.names['1234'],'Second');
  unreadable=true;
  await assert.rejects(api.shotAssetByName(name),error=>error.status===422 && error.data.error.code==='asset_read_failed');
  unreadable=false;lore.content='invalid JSON';
  const pixelsOnly=await api.shotAssetByName(name,false);
  assert.match(pixelsOnly.image_url,/^data:image\//);assert.equal(pixelsOnly.warning,undefined);
  assert.deepEqual(pixelsOnly.names,{});
  const partial=await api.shotAssetByName(name);
  assert.match(partial.image_url,/^data:image\//);assert.match(partial.warning,/cast_resolve_failed/);
});

test('missing DOM name resolves through card id without reading pixel files', async () => {
  const calls=[],painted=[];
  const c={t:{},K:async url=>{calls.push(url);if(url.startsWith('/v1/shots/cast?'))return {name:'inxshot_fallback.c9396.webp'};return {'9396':'Alice'};},
    showStickyInspect:async()=>{},updateStickyInspect:async view=>painted.push({...view}),y:()=>{}};
  await opener(c)({id:'fallback'},'');await c.t._inspectLoad;
  assert.equal(painted.at(-1)._nxImage.cardId,'fallback');
  assert.equal(painted.at(-1).characters[0].name,'Alice');
  assert.deepEqual(calls,['/v1/shots/cast?card_id=fallback','/v1/shots/resolve-cast']);
});
