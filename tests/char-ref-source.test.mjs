import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {build,transform} from 'esbuild';
import {installHost,PNG_1X1,PNG_NAI_1X1} from '../tools/parity/host.mjs';
const source=readFileSync('src/services/nai-assets.ts','utf8');
const start=source.indexOf('export async function seedCharRefsFromLooks('),end=source.indexOf('\nexport async function setCharRefImage(',start);
assert.ok(start>=0&&end>start);
let functionSource=source.slice(start,end).replace('export async','async');
if(process.env.BREAK_REF_SOURCE) functionSource=functionSource.replace('referenceLooksForTargets(group, characterId, captured)', "referenceLooksForTargets(group, 'A', captured)");
const {code}=await transform(functionSource+'\nreturn seedCharRefsFromLooks;', {loader:'ts'});
const bundle=await build({stdin:{contents:`export {referenceLooksForTargets} from './src/services/reference-assets';export {characterSource} from './src/services/character-source';export {characterIdForRosterScope} from './src/storage/character-roster';export {refSeedTargets,lookBytesForTarget} from './src/domain/character/char-ref-seed';export {unifiedSessionIdForCharacter} from './src/core/util/text';`,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'esm',platform:'node'});
const api=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));

test('reference seeding searches selected bot with or without metadata and publishes only successful writes',async()=>{
 for(const metadata of [false,true]) for(const explicit of [false,true]) {
  installHost({promptsDir:'prompts',seed:42});
  const bots=[{chaId:'A',additionalAssets:[['Alice default','wrong-A']],chats:[]},{chaId:'B',additionalAssets:[['Alice default','correct-B']],chats:[]}];
  const reads=[],writes=[],events=[];
  globalThis.risuai.getCharacter=async()=>bots[0];
  globalThis.risuai.getDatabase=async()=>({characters:bots,modules:[],enabledModules:[]});
  globalThis.risuai.readImage=async key=>{reads.push(key);return metadata?PNG_NAI_1X1:PNG_1X1;};
  const scope=api.unifiedSessionIdForCharacter('B');
  const deps={...api,GLOBAL_SCOPE:'__global__',dbg:()=>{},u8ToArrayBuffer:bytes=>bytes.slice().buffer,
    setCharRefImage:async(scope,id,bytes,opts)=>{writes.push({scope,id,opts});return {ok:true,ref_hash:'a'.repeat(64),preview_url:'data:image/png;base64,test'};},
    publishCharacterImage:event=>events.push(event)};
  const seed=new Function(...Object.keys(deps),code)(...Object.values(deps));
  assert.equal(await seed([{id:'alice',name:'Alice',scope}],explicit?'B':''),1);
  assert.deepEqual(reads,['correct-B']);
  assert.deepEqual(writes,[{scope,id:'alice',opts:{overwrite:false}}]);
  assert.equal(events.length,1);assert.equal(events[0].scope,scope);assert.equal(events[0].id,'alice');
  reads.length=0;
  assert.equal(await seed([{id:'alice',name:'Alice',scope,ref_hash:'b'.repeat(64)}],'B'),0);
  assert.equal(reads.length,0);
  writes.length=0;events.length=0;
  const skipped={...deps,setCharRefImage:async()=>({ok:true,skipped:true})};
  const skipSeed=new Function(...Object.keys(skipped),code)(...Object.values(skipped));
  assert.equal(await skipSeed([{id:'alice',name:'Alice',scope}],'B'),0);assert.equal(events.length,0);
 }
});

test('generation and import forward the initiating bot to automatic references',()=>{
 const chars=readFileSync('src/services/characters.ts','utf8'),imports=readFileSync('src/services/char-import.ts','utf8');
 assert.match(chars,/seedCharRefsFromLooks\(seededRoster, characterId, args.referenceCandidates\)/);
 assert.match(imports,/seedCharRefsFromLooks\(await listCharacters\(writeScope\), characterId\)/);
});
