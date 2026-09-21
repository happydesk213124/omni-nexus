import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
const built=await build({stdin:{contents:`
export * from './src/domain/nai-meta/reference-search';
export {refSeedTargets,lookBytesForTarget} from './src/domain/character/char-ref-seed';
export {collectReferenceCandidates,referenceLooksForTargets} from './src/services/reference-assets';
`,loader:'ts',resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'node',plugins:process.env.BREAK_REFERENCE_RANK ? [{name:'break-rank',setup(builder){
 builder.onLoad({filter:/reference-search\.ts$/},async({path})=>({loader:'ts',contents:(await readFile(path,'utf8')).replace("if (words.includes('default')) return 4;","if (words.includes('default')) return 0;")}));
}}] : []});
const api=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));

test('reference search and link tolerate spaces, hyphens and given names',()=>{
 const names=api.characterAssetTerms({name:'윤 지호',surname:'윤',given_name:'지호',aliases:['Yoon Ji-ho'],given_name_variants:['Ji-ho']});
 assert.ok(names.includes('지호')); assert.ok(names.includes('Ji-ho')); assert.ok(!names.includes('윤'));
 for(const file of ['윤지호_default.png','Yoon_Ji_ho_default.png','지호_normal.png','folder/Ji-ho_profile.webp']) {
  assert.ok(api.assetMatchesTerms(file,names),file);
 }
 const bytes=new Uint8Array([7]);
 assert.equal(api.lookBytesForTarget({names:['Yoon Ji-ho']},[{trigger:'yoonjiho',bytes}]),bytes);
 assert.equal(api.lookBytesForTarget({names:['윤 지호']},[{trigger:'윤지호',bytes}]),bytes);
});

test('rank once across full name and aliases: exact, default, profile, normal/smile, other',()=>{
 const files=['JIH0_angry','Ji-ho_normal','윤지호_profile','Ji-ho_default','윤 지호','Ji-ho_smile','unrelated_default'];
 const result=api.rankedReferenceAssets(files.map(name=>({name})),['윤지호','Ji-ho','JIH0']).map(x=>x.name);
 assert.equal(result[0],'윤 지호');assert.equal(result[1],'Ji-ho_default');assert.equal(result[2],'윤지호_profile');
 assert.deepEqual(new Set(result.slice(3,5)),new Set(['Ji-ho_normal','Ji-ho_smile']));assert.equal(result[5],'JIH0_angry');
 assert.ok(!result.includes('unrelated_default'));
});

test('captured lore-trigger candidates survive LLM names and bypass a second host search',async()=>{
 const reads=[];
 const bot={chaId:'B',additionalAssets:[['marin_normal','normal'],['herin_default','default'],['other_default','wrong']],globalLore:[{key:'kimherin, herin, marin',comment:'김혜린'}],chats:[]};
 globalThis.risuai={getCharacter:async()=>bot,getDatabase:async()=>({characters:[bot],modules:[],enabledModules:[]}),readImage:async key=>{reads.push(key);return new Uint8Array([key==='default'?2:1]);}};
 const captured=await api.collectReferenceCandidates(['kimherin'],'B');
 assert.equal(captured.length,2);assert.ok(captured.every(c=>c.terms.includes('marin')));
 // The open chat and asset catalogue can change while the LLM is responding.
 globalThis.risuai.getDatabase=async()=>{throw new Error('must use captured candidates');};
 const targets=api.refSeedTargets([{id:'h',scope:'B',name:'김혜린',surname:'김',given_name:'혜린'}]);
 const result=await api.referenceLooksForTargets(targets,'B',captured);
 assert.equal(result.length,1);assert.equal(result[0].targetId,'h');assert.equal(result[0].bytes[0],2);
 assert.deepEqual(reads,['default']);
});

test('missing preferred image tries the next ranked candidate without mixing characters',async()=>{
 globalThis.risuai={readImage:async key=>key==='missing'?null:new Uint8Array([5])};
 const targets=[{id:'a',scope:'B',names:['Alice']}];
 const refs=[{name:'Alice_default',key:'missing',terms:['Alice']},{name:'Alice_normal',key:'normal',terms:['Alice']},{name:'Bob',key:'wrong',terms:['Bob']}];
 const result=await api.referenceLooksForTargets(targets,'B',refs);
 assert.equal(result.length,1);assert.equal(result[0].targetId,'a');
});

test('selected character modules cannot include the currently open other chat modules',async()=>{
 const bot={chaId:'B',additionalAssets:[],modules:['bmod'],chats:[{modules:[]}]};
 globalThis.risuai={getCharacter:async()=>({chaId:'A'}),getCurrentCharacterIndex:async()=>0,getCurrentChatIndex:async()=>0,getChatFromIndex:async()=>({modules:['amod']}),
  getDatabase:async()=>({characters:[bot],enabledModules:[],modules:[{id:'amod',assets:[['Alice','wrong']]},{id:'bmod',assets:[['Alice_default','right']]}]})};
 const result=await api.collectReferenceCandidates(['Alice'],'B',[]);
 assert.deepEqual(result.map(x=>x.key),['right']);
});
