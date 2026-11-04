import {test,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const bundle=await build({stdin:{contents:`export * from './src/storage/character-roster';export * from './src/storage/primed-character';export {sessionIdHash} from './src/core/util/text';`,resolveDir:process.cwd()},bundle:true,write:false,format:'esm'});
const api=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));

let chars,reads;
const realNow=Date.now;
beforeEach(()=>{
  Date.now=realNow;
  chars=['bot-a','bot-b'].map(chaId=>({chaId,globalLore:[],chats:[{id:'one'},{id:'two'}]}));
  reads={getDatabase:0,getCharacterFromIndex:0};
  globalThis.risuai={getCurrentCharacterIndex:async()=>0,
    getDatabase:async()=>{reads.getDatabase++;return {characters:structuredClone(chars)};},
    getCharacterFromIndex:async i=>{reads.getCharacterFromIndex++;return structuredClone(chars[i]);},
    setCharacterToIndex:async(i,c)=>{chars[i]=structuredClone(c);}};
  api.forgetPrimedCharacter();
});
const scope=chat=>'risu_'+api.sessionIdHash('bot-a|'+chat);
const alice={id:'alice',name:'Alice',appearance:'blue eyes',attire:'shirt',costumes:[{name:'default',attire:'shirt'}]};
const bob={id:'bob',name:'Bob',appearance:'green eyes',attire:'coat',costumes:[{name:'default',attire:'coat'}]};
const names=rows=>rows.map(r=>r.name).sort();

test('a chat request\'s own bot, just read: its roster comes from that copy, by any scope of it, with no directory and no second read',async()=>{
  await api.mutateCharacterRoster('bot-a',()=>[alice]);
  api.primeCharacter(structuredClone(chars[0]),0);
  reads.getDatabase=0;reads.getCharacterFromIndex=0;
  for(const s of [scope('one'),scope('two'),'bot-a'])assert.deepEqual(names(await api.readCharacterRoster(s)),['Alice']);
  assert.deepEqual(reads,{getDatabase:0,getCharacterFromIndex:0},'every read from the request\'s copy');
  // A change waiting for the bake (no character write yet) shows on top of it, as on a read of Risu's.
  await api.mutateCharacterRoster(scope('one'),rows=>[...rows,bob],{buffer:true});
  reads.getDatabase=0;reads.getCharacterFromIndex=0;
  assert.deepEqual(names(await api.readCharacterRoster(scope('one'))),['Alice','Bob']);
  assert.deepEqual(reads,{getDatabase:0,getCharacterFromIndex:0});
});

test('a character write drops it: the next read is Risu\'s, and sees the write',async()=>{
  await api.mutateCharacterRoster('bot-a',()=>[alice]);
  api.primeCharacter(structuredClone(chars[0]),0);
  await api.mutateCharacterRoster('bot-a',rows=>[...rows,bob]);
  reads.getCharacterFromIndex=0;
  assert.deepEqual(names(await api.readCharacterRoster(scope('one'))),['Alice','Bob']);
  assert.ok(reads.getCharacterFromIndex>0,'read from Risu');
  // The other writers of a character drop it too.
  api.primeCharacter(structuredClone(chars[0]),0);
  await api.writeCharacterLoreText('bot-a','omni.test.note','hello');
  assert.equal(api.primedCharacter('bot-a'),null);
  api.primeCharacter(structuredClone(chars[0]),0);
  await api.writeCharacterEntryKey('bot-a','lorefilter',['t:Alice']);
  assert.equal(api.primedCharacter('bot-a'),null);
});

test('it is kept for seconds, and answers only for its own bot',async()=>{
  await api.mutateCharacterRoster('bot-a',()=>[alice]);
  await api.mutateCharacterRoster('bot-b',()=>[bob]);
  const at=realNow();
  api.primeCharacter(structuredClone(chars[0]),0);
  reads.getCharacterFromIndex=0;
  assert.deepEqual(names(await api.readCharacterRoster('bot-b')),['Bob'],'another bot is read from Risu');
  assert.equal(reads.getCharacterFromIndex,1);
  // Well past the five seconds: the copy was primed a moment after `at`, never before it.
  Date.now=()=>at+6000;
  reads.getCharacterFromIndex=0;
  assert.deepEqual(names(await api.readCharacterRoster(scope('one'))),['Alice']);
  assert.equal(reads.getCharacterFromIndex,1,'five seconds on, read from Risu again');
  assert.equal(api.primedCharacter('bot-a'),null);
});
