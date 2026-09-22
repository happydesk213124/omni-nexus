import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
const config=await readFile('vite.config.ts','utf8');
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function runtime(K, clone=async card=>({id:card.id})) {
  const paints=[],updates=[],errors=[],dropped=[];
  const c={t:{},K,nxCloneInspectImage:clone,nxInspectMirroredImage:null,
    nxDropInspectImage:async image=>dropped.push(image),y:(...args)=>errors.push(args),
    showStickyInspect:async view=>paints.push({...view}),
    updateStickyInspect:async view=>{updates.push({...view});if(view._nxImage)c.nxInspectMirroredImage=view._nxImage;}};
  const start=config.indexOf('      const nxOpenAssetInspect = async');
  const end=config.indexOf('      const nxFireTap = async',start);
  assert.ok(start>0&&end>start);
  runInNewContext(config.slice(start,end)+'this.open=nxOpenAssetInspect;',c);
  return {c,paints,updates,errors,dropped};
}
test('inspect opens and mirrors before filename lookup completes',async()=>{
  let resolveName;
  const name=new Promise(resolve=>{resolveName=resolve;});
  const {c,paints,updates}=runtime(async()=>({}));
  await c.open({id:'a'},name);await turn();
  assert.equal(paints.length,1);assert.equal(paints[0]._nxAssetLoading,true);
  assert.ok(updates.some(view=>view._nxImage?.id==='a'));
  resolveName('inxshot_a.webp');await c.t._inspectLoad;
});
test('mirror renders while cast names are pending; reopen never reads pixel files',async()=>{
  let resolveNames,reads=0,clones=0;
  const names=new Promise(resolve=>{resolveNames=resolve;});
  const {c,updates}=runtime(async url=>{
    assert.equal(url,'/v1/shots/resolve-cast');reads++;return names;
  },async card=>({id:card.id,copy:++clones}));
  await c.open({id:'a'},'inxshot_a.c9396.webp');await turn();
  assert.ok(updates.some(view=>view._nxImage?.id==='a'));
  resolveNames({'9396':'Alice'});await c.t._inspectLoad;
  assert.equal(updates.at(-1).characters[0].name,'Alice');
  await c.open({id:'a'},'inxshot_a.c9396.webp');await c.t._inspectLoad;
  assert.equal(clones,2);assert.equal(reads,2,'only cast names refresh');
});
test('closing during a clone prevents every late paint and releases the copy',async()=>{
  let resolve;
  const {c,updates,dropped}=runtime(async()=>({}),()=>new Promise(done=>{resolve=done;}));
  await c.open({id:'a'},'inxshot_a.webp');await turn();
  const before=updates.length;c.t._inspectEpoch++;
  const image={id:'late'};resolve(image);await c.t._inspectLoad;
  assert.equal(updates.length,before);assert.deepEqual(dropped,[image]);
});
test('reopening uses a fresh mirror so host image replacements are reflected',async()=>{
  let version=1;
  const {c,updates}=runtime(async()=>({}),async()=>({version}));
  await c.open({id:'a'},'inxshot_a.webp');await c.t._inspectLoad;
  version=2;await c.open({id:'a'},'inxshot_a.webp');await c.t._inspectLoad;
  assert.equal(updates.at(-1)._nxImage.version,2);
});
test('cast-name failure keeps the mirrored image available',async()=>{
  const {c,updates}=runtime(async()=>{throw Error('roster');});
  await c.open({id:'a'},'inxshot_a.c9396.webp');await c.t._inspectLoad;
  assert.equal(updates.at(-1)._nxImage.id,'a');
  assert.ok(updates.at(-1)._nxCastError);assert.equal(updates.at(-1)._nxInspectError,'');
});
