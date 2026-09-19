import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const code=readFileSync('tools/vendor-patches/character-lore.js','utf8');
const tick=()=>new Promise(r=>setImmediate(r));
function runtime() {
 const requests=[],paints=[];
 const slot={querySelector:()=>null,set innerHTML(value){paints.push(value);}};
 const t={uiOpen:true,uiTab:'characters',lastScope:{characterId:'A'}};
 const c={t,Map,Set,document:{getElementById:id=>id==='nx-lorefilter-slot'?slot:null},omniLoreHtml:state=>state.character_id+':'+state.selected.join(','),
  K:(url,options)=>new Promise(resolve=>requests.push({url,options,resolve}))};
 runInNewContext(code,c);
 return {c,t,requests,paints};
}
test('switching A to B during automatic fill cannot publish A into B and requests contain no live lore',async()=>{
 const {c,t,requests,paints}=runtime();
 const a=c.omniLoadLorefilter();
 requests[0].resolve({ok:true,character_id:'A',selected:[],catalog:[{id:'a'}]});await tick();
 assert.deepEqual(Object.keys(requests[1].options.body).sort(),['character_id','rescan']);
 t.lastScope={characterId:'B'};
 const b=c.omniLoadLorefilter();
 requests[2].resolve({ok:true,character_id:'B',selected:['b'],catalog:[{id:'b'}],initialized:true});await b;
 const count=paints.length;
 requests[1].resolve({ok:true,character_id:'A',selected:['a'],catalog:[{id:'a'}],initialized:true});await a;
 assert.equal(paints.length,count,'offscreen completion must not touch the mounted region');
 assert.equal(paints.at(-1),'B:b');
 t.lastScope={characterId:'A'};c.omniLoadLorefilter();
 assert.equal(c.omniLoreState().selected[0],'a');assert.equal(requests.length,3,'returning to A reuses completed work');
});
test('manual rescan completion after a switch stays in its captured bot state',async()=>{
 const {c,t,requests,paints}=runtime();
 const a=c.omniLoreState();a.loaded=true;
 const task=c.omniRunLorefilter(a,()=>c.omniScanLorefilter(a));
 t.lastScope={characterId:'B'};const b=c.omniLoreState();b.selected=['b'];b.loaded=true;
 const count=paints.length;
 requests[0].resolve({ok:true,character_id:'A',selected:['a'],catalog:[{id:'a'}]});await task;
 assert.equal(paints.length,count);assert.equal(c.omniLoreState().selected[0],'b');
 assert.equal(a.selected[0],'a');
});
test('repeated renders and A-B-A navigation share the same pending scan',async()=>{
 const {c,t,requests}=runtime();
 const first=c.omniLoadLorefilter();c.omniLoadLorefilter();
 t.lastScope={characterId:'B'};t.lastScope={characterId:'A'};c.omniLoadLorefilter();
 assert.equal(requests.length,1);
 requests[0].resolve({ok:true,character_id:'A',selected:[],catalog:[{id:'a'}],initialized:true});await first;
 assert.equal(requests.length,1,'an intentionally empty selection must not auto-fill again');
});
