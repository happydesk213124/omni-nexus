import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

const config=await readFile('vite.config.ts','utf8');
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function runtime(K) {
  const paints=[],updates=[],errors=[];
  const c={t:{},K,y:(...args)=>errors.push(args),
    showStickyInspect:async view=>paints.push(structuredClone(view)),
    updateStickyInspect:async view=>updates.push(structuredClone(view))};
  const start=config.indexOf('      const nxOpenAssetInspect = async');
  const end=config.indexOf('      const nxFireTap = async',start);
  assert.ok(start>0&&end>start);
  runInNewContext(config.slice(start,end)+'this.open=nxOpenAssetInspect;',c);
  return {c,paints,updates,errors};
}
test('inspect opens before even the filename lookup completes',async()=>{
  let resolveName;
  const name=new Promise(resolve=>{resolveName=resolve;});
  const {c,paints}=runtime(async()=>({image_url:'data:image/png;base64,FILE',ids:[],names:{}}));
  const opening=c.open({id:'a'},name);await turn();
  assert.equal(paints.length,1,'loading shell must already be open');
  assert.equal(paints[0]._nxAssetLoading,true);
  resolveName('inxshot_a.webp');await opening;await c.t._inspectLoad;
});
test('pixels render while cast names are still pending; reopen never rereads the same file',async()=>{
  let resolveNames,reads=0;
  const names=new Promise(resolve=>{resolveNames=resolve;});
  const {c,paints,updates}=runtime(async url=>{
    if(url==='/v1/shots/resolve-cast')return names;
    reads++;return {image_url:'data:image/png;base64,FILE',ids:['9396'],names:{}};
  });
  const opening=c.open({id:'a'},'inxshot_a.c9396.webp');await turn();
  assert.equal(paints.length,1);
  assert.ok(updates.some(view=>view.image_url==='data:image/png;base64,FILE'));
  resolveNames({'9396':'Alice'});await opening;await c.t._inspectLoad;
  assert.equal(updates.at(-1).characters[0].name,'Alice');
  c.t._inspectEpoch++;
  await c.open({id:'a'},'inxshot_a.c9396.webp');await c.t._inspectLoad;
  assert.equal(paints.at(-1).image_url,'data:image/png;base64,FILE');
  assert.equal(reads,1);
});
test('closing during a file read prevents every late paint and reopening',async()=>{
  let resolve;
  const {c,paints,updates}=runtime(()=>new Promise(done=>{resolve=done;}));
  const opening=c.open({id:'a'},'inxshot_a.webp');await turn();
  const before=updates.length;
  c.t._inspectEpoch++;
  resolve({image_url:'data:image/png;base64,LATE',ids:[],names:{}});
  await opening;await c.t._inspectLoad;
  assert.equal(paints.length,1);assert.equal(updates.length,before);
});

test('reopening an older file from the recent set skips the network',async()=>{
  let reads=0;
  const {c}=runtime(async()=>{reads++;return {image_url:'data:image/png;base64,FILE',ids:[],names:{}};});
  await c.open({id:'a'},'inxshot_a.webp');await c.t._inspectLoad;
  await c.open({id:'b'},'inxshot_b.webp');await c.t._inspectLoad;
  assert.equal(reads,2);
  const reopened=c.open({id:'a'},'inxshot_a.webp');await reopened;await c.t._inspectLoad;
  assert.equal(reads,2,'third open must come from the recent set');
});

test('reopening during a pending read joins it; names refresh after a rename',async()=>{
  let release,reads=0,name='Alice';
  const {c,updates}=runtime(async url=>{
    if(url==='/v1/shots/resolve-cast')return {'9396':name};
    reads++;return new Promise(resolve=>{release=resolve;});
  });
  await c.open({id:'a'},'inxshot_a.c9396.webp');const firstLoad=c.t._inspectLoad;await turn();
  c.t._inspectEpoch++;name='Renamed';
  await c.open({id:'a'},'inxshot_a.c9396.webp');await turn();
  assert.equal(reads,1);
  release({image_url:'data:image/png;base64,FILE',ids:['9396'],names:{}});
  await firstLoad;await c.t._inspectLoad;
  assert.equal(updates.at(-1).characters[0].name,'Renamed');
  assert.equal(updates.at(-1).image_url,'data:image/png;base64,FILE');
});
