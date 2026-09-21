import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {build} from 'esbuild';
import {chromium} from 'playwright';
const compiled=await build({entryPoints:['src/domain/message-controls.ts'],bundle:true,write:false,format:'esm'});
const {messageControlsTrigger}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const lua=messageControlsTrigger(true,false).effect[0].code;
const buttons=lua.match(/<button[\s\S]*?<\/button>(?=<\/div>)/)?.[0];
const css=lua.match(/<style>(.*?)<\/style>/s)[1];
const runtime=readFileSync('tools/vendor-patches/message-runtime.js','utf8');

test('module controls are display-only and preserve the seven actions',()=>{
 assert.match(lua,/listenEdit\("editDisplay"/);
 assert.doesNotMatch(lua,/getFullChat|setChat|setChatVar|request\(/);
 assert.equal((buttons.match(/data-omni-action=/g)||[]).length,7);
 assert.match(messageControlsTrigger(false,false).effect[0].code,/if not false/);
 assert.match(messageControlsTrigger(true,true).effect[0].code,/true and row.role == "user"/);
});

test('module-owned controls dispatch, reject stale targets, and lazily reuse persisted counts',async()=>{
 const browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
 try {
  for(const width of [320,1440,3440]) {
   const page=await browser.newPage({viewport:{width,height:900}});
   const result=await page.evaluate(async({runtime,buttons,css})=>{
    class Safe {
      constructor(n){this.n=n;}
      async querySelector(q){const n=this.n.querySelector(q);return n?new Safe(n):null;}
      async querySelectorAll(q){return [...this.n.querySelectorAll(q)].map(n=>new Safe(n));}
      async getOuterHTML(){return this.n.outerHTML;}
      async getParent(){return this.n.parentElement?new Safe(this.n.parentElement):null;}
      async setAttribute(k,v){if(!k.startsWith('x-'))throw Error('restricted attribute');this.n.setAttribute(k,v);}
      async getAttribute(k){if(!k.startsWith('x-'))throw Error('restricted attribute');return this.n.getAttribute(k);}
      async setStyleAttribute(v){this.n.style.cssText=v;}
      async appendChild(n){this.n.appendChild(n.n);}
      async setTextContent(v){this.n.textContent=v;}
      async remove(){this.n.remove();}
      async addEventListener(k,f){document.addEventListener(k,f);return f;}
      async removeEventListener(k,f){document.removeEventListener(k,f);}
    }
    const doc=new Safe(document),t={hostDoc:doc,backendSettings:{card:{image_min:1,image_max:4}}};
    const calls=[],writes=[],errors=[];let observers=0;
    const scope={characterId:'c',chatId:'chat',sessionId:'s',chat:{message:[{id:'m',data:'본문 😀',role:'char'}]}};
    const deps={t,k:{createMutationObserver:async()=>({observe:async()=>observers++,disconnect:async()=>{}})},
      H:async(_,tag,opts={})=>{const n=document.createElement(tag);n.textContent=opts.text||'';return new Safe(n);},
      Z:async()=>scope,nxMsgFan:()=>true,nxUnwrapSafeNodes:async a=>a,nxSpinnerPreviews:new Map(),
      omniRelease:async()=>{},omniStream:{paused:false},y:()=>{},Be:async(...a)=>calls.push(a),$e:e=>errors.push(e),
      pe:async patch=>{await new Promise(r=>setTimeout(r,2));Object.assign(t.backendSettings.card,patch.card);writes.push(patch);},
    };
    const api=new Function(...Object.keys(deps),runtime+';return {mount:omniMountFooters,bind:omniBindModuleButton,run:omniFooterAction,token:omniMessageToken,count:omniChangeCount};')(...Object.values(deps));
    const render=()=>{document.body.innerHTML='<style>'+css+'</style>'+['top','bottom'].map(edge=>'<div data-omni-footer="'+api.token(0,scope.chat.message[0].data)+'" data-omni-edge="'+edge+'">'+buttons+'</div>').join('<p>본문 😀</p>');};
    render();await api.mount();
    const first=document.querySelector('[data-omni-footer]'),bounds=first.getBoundingClientRect();
    const invoke=async q=>{const hit=await api.bind(new Safe(first.querySelector(q)));if(hit)await api.run(hit.kind,hit.index);return hit;};
    const tag=await invoke('[data-omni-action="tag"]');
    await invoke('[data-omni-action="counts"]');const panel=first.querySelector('[x-omni-counts]');
    await invoke('[data-omni-action="counts"]');const hidden=panel.style.display==='none';
    await invoke('[data-omni-action="counts"]');const reused=panel===first.querySelector('[x-omni-counts]');
    await invoke('[x-omni-action="min-up"]');
    await Promise.all([api.count('max-up'),api.count('max-up')]);
    await api.count('min-down');await api.count('min-down');
    const range=panel.querySelector('[x-omni-count-value]').textContent;
    scope.chat.message[0].data='edited';await api.run('tag',tag.index);
    const stale=await api.bind(new Safe(first.querySelector('[data-omni-action="tag"]')));
    render();await api.mount();const after=document.querySelectorAll('[data-omni-footer]').length;
    const noPanel=!document.querySelector('[x-omni-counts]');
    return {right:bounds.right,width:innerWidth,calls:calls.length,hidden,reused,range,writes:writes.length,after,noPanel,stale:stale===null,observers,errors};
   },{runtime,buttons,css});
   assert.ok(result.right<=result.width);
   assert.equal(result.calls,1);assert.equal(result.hidden,true);assert.equal(result.reused,true);
   assert.equal(result.range,'1~6');assert.equal(result.writes,4);assert.equal(result.after,2);
   assert.equal(result.noPanel,true);assert.equal(result.stale,true);assert.equal(result.observers,0);assert.deepEqual(result.errors,[]);
   await page.close();
  }
 } finally {await browser.close();}
});

test('module button renderer regression guard rejects a deliberately removed action',()=>{
 const check=s=>assert.equal((s.match(/data-omni-action=/g)||[]).length,7);
 check(buttons);
 assert.throws(()=>check(buttons.replace('data-omni-action=','data-removed=')),assert.AssertionError);
});
