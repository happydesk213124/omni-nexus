import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const bundle=await build({entryPoints:['src/services/chat-bake.ts'],bundle:true,write:false,format:'esm',platform:'node',plugins:[{
 name:'bake-dependencies',setup(b){
  b.onResolve({filter:/storage\/(stores|chat-session-store|inray-display-module)$|services\/context$|^\.\/context$/},args=>({path:args.path,namespace:'bake-test'}));
  b.onLoad({filter:/.*/,namespace:'bake-test'},args=>({loader:'js',contents:args.path.endsWith('/stores')?`
    export async function imageAssetRef(id){return globalThis.fixture.assets[id] || null;}
    export async function imagePng(id){globalThis.fixture.pixelReads++;return globalThis.fixture.pixels[id] || null;}
    export async function imageMeta(id){return globalThis.fixture.images[id];}
    export async function idbGet(store,id){if(store!=='cards')throw Error('Unexpected pixel hydration');return globalThis.fixture.cards[id];}
   `:args.path.endsWith('chat-session-store')?'export async function serializeSessionStorage(fn){return fn();}':args.path.endsWith('inray-display-module')?'export async function ensureInrayDisplayModule(){}':'export function getConfig(){return {card:{}};}'}));
 }
}]});
const api=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const target={charIndex:0,chatIndex:0,messageIndex:0,jobId:'job'};
function fixture(){
 const state={writes:0,pixelReads:0,pixels:{},chat:{id:'chat',message:[{data:'text\n[[@inrayspinner::job_0::512::768]][[@inrayspinner::job_1::768::512]]'}]},assets:{a:{path:'a',name:'inxshot_a.webp'},b:{path:'b',name:'inxshot_b.webp'}},images:{},cards:{}};
 globalThis.fixture=state;
 globalThis.risuai={getChatFromIndex:async()=>structuredClone(state.chat),setChatToIndex:async(_c,_t,chat)=>{state.chat=structuredClone(chat);state.writes++;}};
 return state;
}
test('batch completion inherits both spinner dimensions and commits exactly once',async()=>{
 const state=fixture();
 await api.finishJobSpinners({...target,cards:[{shot:0,cardId:'a'},{shot:1,cardId:'b'}]});
 assert.equal(state.writes,1);
 assert.equal(state.pixelReads,0);
 assert.equal(state.chat.message[0].data,'text\n[[@inrayspinner::job_0::512::768]][[@inray::a::inxshot_a.webp::512::768]][[@inrayspinner::job_1::768::512]][[@inray::b::inxshot_b.webp::768::512]]');
});
test('runtime/image dimensions override planned size without image hydration',async()=>{
 const state=fixture();
 state.cards.a={meta_json:JSON.stringify({width:640,height:960})};
 state.images.b={location:{width:960,height:640}};
 await api.finishJobSpinners({...target,cards:[{shot:0,cardId:'a'},{shot:1,cardId:'b'}]});
 assert.equal(state.writes,1);
 assert.match(state.chat.message[0].data,/a.webp::640::960/);
 assert.match(state.chat.message[0].data,/b.webp::960::640/);
});
test('invalid batch has no partial write',async()=>{
 const state=fixture(),before=structuredClone(state.chat);
 await assert.rejects(()=>api.finishJobSpinners({...target,cards:[{shot:0,cardId:'a'},{shot:2,cardId:'b'}]}),/Spinner token missing/);
 assert.equal(state.writes,0);
 assert.deepEqual(state.chat,before);
});
test('explicit completion dimensions are accepted and a second completion is a no-op',async()=>{
 const state=fixture();
 assert.equal(await api.finishJobSpinner({...target,shot:0,cardId:'a',width:700,height:900}),true);
 assert.match(state.chat.message[0].data,/a.webp::700::900/);
 assert.equal(await api.finishJobSpinner({...target,shot:0,cardId:'a'}),false);
 assert.equal(state.writes,1);
});

function pngHeader(width,height){
 const bytes=new Uint8Array(24);
 bytes.set([137,80,78,71,13,10,26,10]);
 const view=new DataView(bytes.buffer);view.setUint32(16,width);view.setUint32(20,height);
 return bytes.buffer;
}

for (const [fromW,fromH] of [[832,1216],[1216,832],[1024,1024]]) {
 for (const [width,height] of [[832,1216],[1216,832],[1024,1024]]) {
  for (const nextId of ['a','replacement']) {
  test(`studio save ${nextId} synchronizes reserved frame ${fromW}x${fromH} to ${width}x${height}`,async()=>{
   const state=fixture();
   const sibling='[[@inrayspinner::job_1::832::1216]][[@inray::b::inxshot_b.webp::832::1216]]';
   state.chat.message[0].data=`text [[@inrayspinner::job_0::${fromW}::${fromH}]]\n[[@inray::a::inxshot_a.webp::${fromW}::${fromH}]]\n${sibling}`;
   state.cards[nextId]={meta_json:JSON.stringify({width,height})};
   state.assets[nextId]={path:nextId,name:`inxshot_${nextId}.webp`};
   await api.rewriteBakedCardInChatMessage({...target,prevCardId:'a',nextCardId:nextId});
   assert.equal(state.chat.message[0].data,`text [[@inrayspinner::job_0::${width}::${height}]]\n[[@inray::${nextId}::inxshot_${nextId}.webp::${width}::${height}]]\n${sibling}`);
   assert.equal(state.pixelReads,0);
  });
  }
 }
}
test('explicit bake recovers intrinsic dimensions from reloaded asset headers',async()=>{
 const state=fixture();
 state.chat.message[0].data='first\nsecond';
 state.pixels.a=pngHeader(832,1216);
 await api.bakeCardsIntoChatMessage({...target,cards:[{id:'a',line:1}]});
 assert.equal(state.pixelReads,1);
 assert.equal(state.writes,1);
 assert.match(state.chat.message[0].data,/inxshot_a.webp::832::1216/);
});
test('explicit reroll reads missing dimensions but known metadata avoids pixel reads',async()=>{
 const state=fixture();
 state.chat.message[0].data='text [[@inray::old::inxshot_old.webp::512::768]]';
 state.pixels.a=pngHeader(1216,832);
 await api.rewriteBakedCardInChatMessage({...target,prevCardId:'old',nextCardId:'a'});
 assert.equal(state.pixelReads,1);
 assert.match(state.chat.message[0].data,/inxshot_a.webp::1216::832/);
 state.cards.b={meta_json:JSON.stringify({width:640,height:960})};
 await api.rewriteBakedCardInChatMessage({...target,prevCardId:'a',nextCardId:'b'});
 assert.equal(state.pixelReads,1);
 assert.match(state.chat.message[0].data,/inxshot_b.webp::640::960/);
});
test('unreadable explicit image keeps legacy bake readable without inventing dimensions',async()=>{
 const state=fixture();state.chat.message[0].data='text';
 state.pixels.a=new Uint8Array([1,2,3]).buffer;
 await api.bakeCardsIntoChatMessage({...target,cards:[{id:'a',line:1}]});
 assert.equal(state.pixelReads,1);
 assert.match(state.chat.message[0].data,/\[\[@inray::a::inxshot_a.webp\]\]/);
});
