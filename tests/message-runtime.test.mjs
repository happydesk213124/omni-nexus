import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {chromium} from 'playwright';
const runtime=readFileSync(new URL('../tools/vendor-patches/message-runtime.js',import.meta.url),'utf8');
test('footer uses SafeElement methods, wraps at 320px, remounts after edit, and dispatches its own message',async()=>{
 const browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
 try {
  for(const width of [320,1440,3440]) {
   const page=await browser.newPage({viewport:{width,height:900}});
   await page.setContent('<div class="default-chat-screen"><div class="risu-chat" data-chat-index="0" data-chat-id="m"><div class="chattext"><p>message</p></div></div></div>');
   const result=await page.evaluate(async(runtime)=>{
    const wrap=n=>n?new Safe(n):null;
    class Safe {
      constructor(n){this.n=n;}
      async querySelector(q){return wrap(this.n.querySelector(q));}
      async querySelectorAll(q){return [...this.n.querySelectorAll(q)].map(wrap);}
      async getOuterHTML(){return this.n.outerHTML;}
      async setAttribute(k,v){if(!k.startsWith('x-'))throw Error('forbidden attribute '+k);this.n.setAttribute(k,v);}
      async getAttribute(k){if(!k.startsWith('x-'))throw Error('forbidden attribute '+k);return this.n.getAttribute(k);}
      async appendChild(n){this.n.appendChild(n.n);}
      async prepend(n){this.n.prepend(n.n);}
      async remove(){this.n.remove();}
      async setTextContent(v){this.n.textContent=v;}
      async addEventListener(kind,fn){this.n.addEventListener(kind,fn);return 'listener';}
      async removeEventListener(){}
    }
    const doc=wrap(document),t={hostDoc:doc,backendSettings:{card:{image_min:1,image_max:4}}},calls=[];
    const scope={characterId:'c',chatId:'chat',charIndex:0,chatIndex:0,chat:{message:[{id:'m',data:'message',role:'char'}]}};
    const k={createMutationObserver:async cb=>{const mo=new MutationObserver(cb);return{observe:async(n,opts)=>mo.observe(n.n,opts),disconnect:async()=>mo.disconnect()};}};
    const H=async(_doc,tag,opts={})=>{const n=document.createElement(tag);if(opts.className)n.className=opts.className;if(opts.text)n.textContent=opts.text;if(opts.html)n.innerHTML=opts.html;return wrap(n);};
    const api=new Function('t','k','H','Z','nxMsgFan','nxUnwrapSafeNodes','nxSpinnerPreviews','y','Be',runtime+';return {mount:omniMountFooters,run:omniFooterAction,close:async()=>{t.unloading=true;await omniFooterObserver?.disconnect();}};')(
      t,k,H,async()=>scope,()=>true,async v=>v,new Map(),()=>{},async(...args)=>calls.push(args));
    await api.mount();
    const footer=document.querySelector('[x-omni-footer]'),bounds=footer.getBoundingClientRect();
    const icons=[...footer.querySelectorAll('button')].map(n=>n.textContent);
    const key=Number(footer.getAttribute('x-omni-footer'));
    await api.run('tag',key);
    const bubble=document.querySelector('.risu-chat');
    bubble.innerHTML='<textarea>edit</textarea>';await api.mount();
    const duringEdit=bubble.querySelectorAll('[x-omni-footer]').length;
    bubble.innerHTML='<div class="chattext"><p>edited</p></div>';await api.mount();
    await new Promise(r=>setTimeout(r,30));await api.mount();
    const restored=bubble.querySelectorAll('[x-omni-footer]').length;
    await api.run('tag',key); // Old DOM's key cannot trigger a new job.
    await api.close();
    return {icons,right:bounds.right,width:innerWidth,duringEdit,restored,calls:calls.length,index:calls[0][0].actionMessageIndex};
   },runtime);
    assert.deepEqual(result.icons,['⚛️','🔃','👨‍👩‍👧‍👦','🟥','📚','✒️','🔢']);
    assert.ok(result.right<=result.width);assert.equal(result.duringEdit,0);assert.equal(result.restored,2);assert.equal(result.calls,1);assert.equal(result.index,0);
    await page.close();
   }
  } finally {await browser.close();}
});
test('footer defers newest bubble while streaming, mounts after end',async()=>{
 const browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
 try {
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  await page.setContent('<div class="default-chat-screen"><div class="risu-chat" data-chat-index="0" data-chat-id="a"><div class="chattext"><p>old</p></div></div><div class="risu-chat" data-chat-index="1" data-chat-id="b"><div class="chattext"><p>new</p></div></div></div>');
  const result=await page.evaluate(async(runtime)=>{
    const wrap=n=>n?new Safe(n):null;
    class Safe {
      constructor(n){this.n=n;}
      async querySelector(q){return wrap(this.n.querySelector(q));}
      async querySelectorAll(q){return [...this.n.querySelectorAll(q)].map(wrap);}
      async getOuterHTML(){return this.n.outerHTML;}
      async setAttribute(k,v){if(!k.startsWith('x-'))throw Error('forbidden attribute '+k);this.n.setAttribute(k,v);}
      async getAttribute(k){if(!k.startsWith('x-'))throw Error('forbidden attribute '+k);return this.n.getAttribute(k);}
      async appendChild(n){this.n.appendChild(n.n);}
      async prepend(n){this.n.prepend(n.n);}
      async remove(){this.n.remove();}
      async setTextContent(v){this.n.textContent=v;}
      async addEventListener(kind,fn){this.n.addEventListener(kind,fn);return 'listener';}
      async removeEventListener(){}
    }
    const doc=wrap(document),t={hostDoc:doc,backendSettings:{card:{image_min:1,image_max:4}}};
    let streaming=true;
    const scope={characterId:'c',chatId:'chat',charIndex:0,chatIndex:0,chat:{message:[{id:'a',data:'old',role:'char'},{id:'b',data:'new',role:'char'}]}};
    const k={createMutationObserver:async cb=>{const mo=new MutationObserver(cb);return{observe:async(n,opts)=>mo.observe(n.n,opts),disconnect:async()=>mo.disconnect()};}};
    const H=async(_doc,tag,opts={})=>{const n=document.createElement(tag);if(opts.className)n.className=opts.className;if(opts.text)n.textContent=opts.text;if(opts.html)n.innerHTML=opts.html;return wrap(n);};
    const api=new Function('t','k','H','Z','Za','nxMsgFan','nxUnwrapSafeNodes','nxSpinnerPreviews','y','Be',runtime+';return {mount:omniMountFooters,close:async()=>{t.unloading=true;await omniFooterObserver?.disconnect();}};')(
      t,k,H,async()=>scope,async()=>({chat:streaming?{isStreaming:true}:{}}),()=>true,async v=>v,new Map(),()=>{},async()=>0);
    await api.mount();
    const during=document.querySelectorAll('[x-omni-footer]').length;
    streaming=false;
    await api.mount();
    await new Promise(r=>setTimeout(r,30));await api.mount();
    const after=document.querySelectorAll('[x-omni-footer]').length;
    await api.close();
    return {during,after};
   },runtime);
  assert.equal(result.during,2);
  assert.equal(result.after,4);
  await page.close();
 } finally {await browser.close();}
});
