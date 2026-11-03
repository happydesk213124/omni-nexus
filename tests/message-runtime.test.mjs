import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {build} from 'esbuild';
import {chromium} from 'playwright';
const compiled=await build({entryPoints:['src/domain/message-controls.ts'],bundle:true,write:false,format:'esm'});
const {messageControlsTrigger,messageControlsDisplayScript}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const lua=messageControlsTrigger(true,false).effect[0].code;
const display=messageControlsDisplayScript();
const buttons=display.out.match(/<button[\s\S]*?<\/button>(?=<\/div>)/)?.[0];
const css=display.out.match(/<style>(.*?)<\/style>/s)[1];
const runtime=readFileSync('tools/vendor-patches/message-runtime.js','utf8');

test('module controls are display-only and preserve the seven actions',()=>{
 assert.match(lua,/listenEdit\("editDisplay"/);
 assert.doesNotMatch(lua,/getFullChat|setChat|setChatVar|request\(/);
 assert.equal((buttons.match(/data-omni-action=/g)||[]).length,7);
 assert.doesNotMatch(lua, /<button|<style/);
 assert.match(display.flag, /<order -10090>/);
 assert.match(messageControlsTrigger(false,false).effect[0].code,/if not false/);
 assert.match(messageControlsTrigger(true,true).effect[0].code,/true and role == "user"/);
});

test('display buttons read only the role and never retrieve or hash the message body',()=>{
 assert.match(lua,/getChatRole\(tid, meta.index\)/);
 assert.doesNotMatch(lua,/getChat\(|raw:byte|#raw|for i = 1/);
});

test('module-owned controls dispatch, reject stale targets, and lazily reuse persisted counts',async()=>{
 const browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
 try {
  for(const width of [320,1440,3440]) for(const legacy of [false,true]) {
   const page=await browser.newPage({viewport:{width,height:900}});
   const result=await page.evaluate(async({runtime,buttons,css,legacy})=>{
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
    const calls=[],writes=[],errors=[],notes=[];let observers=0;
    const scope={characterId:'c',chatId:'chat',sessionId:'s',chat:{message:[{id:'m',data:'본문 😀',role:'char'}]}};
    const deps={t,k:{createMutationObserver:async()=>({observe:async()=>observers++,disconnect:async()=>{}})},
      H:async(_,tag,opts={})=>{const n=document.createElement(tag);n.textContent=opts.text||'';return new Safe(n);},
      Z:async()=>scope,nxMsgFan:()=>true,nxUnwrapSafeNodes:async a=>a,nxSpinnerPreviews:new Map(),
      omniRelease:async()=>{},omniStream:{paused:false},y:()=>{},Be:async(...a)=>calls.push(a),$e:e=>errors.push(e),
      openOmniNote:async(_msg,resolveTarget)=>notes.push((await resolveTarget()).target),
      pe:async patch=>{await new Promise(r=>setTimeout(r,2));Object.assign(t.backendSettings.card,patch.card);writes.push(patch);},
    };
    const api=new Function(...Object.keys(deps),runtime+';return {mount:omniMountFooters,bind:omniBindModuleButton,run:omniFooterAction,token:omniMessageToken,count:omniChangeCount};')(...Object.values(deps));
    const render=()=>{document.body.innerHTML='<style>'+css+'</style><div class="risu-chat" data-chat-index="0" data-chat-id="'+scope.chat.message[0].id+'">'+['top','bottom'].map(edge=>'<div data-omni-footer="'+(legacy?api.token(0,scope.chat.message[0].data):'0')+'" data-omni-edge="'+edge+'">'+buttons+'</div>').join('<p>본문 😀</p>')+'</div>';};
    render();await api.mount();
    const first=document.querySelector('[data-omni-footer]'),bounds=first.getBoundingClientRect();
    const invoke=async q=>{const hit=await api.bind(new Safe(first.querySelector(q)));if(hit)await api.run(hit.kind,hit.index);return hit;};
    const tag=await invoke('[data-omni-action="tag"]');
    await invoke('[data-omni-action="note"]');
    await invoke('[data-omni-action="counts"]');const panel=first.querySelector('[x-omni-counts]');
    await invoke('[data-omni-action="counts"]');const hidden=panel.style.display==='none';
    await invoke('[data-omni-action="counts"]');const reused=panel===first.querySelector('[x-omni-counts]');
    await invoke('[x-omni-action="min-up"]');
    await Promise.all([api.count('max-up'),api.count('max-up')]);
    await api.count('min-down');await api.count('min-down');
    const range=panel.querySelector('[x-omni-count-value]').textContent;
    scope.chat.message[0].data='edited';await api.run('tag',tag.index);await api.run('note',tag.index);
    const stale=await api.bind(new Safe(first.querySelector('[data-omni-action="tag"]')));
    if(stale)await api.run(stale.kind,stale.index);
    scope.chat.message[0].id='replacement-in-another-chat';
    const wrongIdentity=await api.bind(new Safe(first.querySelector('[data-omni-action="tag"]')));
    render();await api.mount();const after=document.querySelectorAll('[data-omni-footer]').length;
    const noPanel=!document.querySelector('[x-omni-counts]');
    return {right:bounds.right,width:innerWidth,calls:calls.length,lastText:calls.at(-1)[1],hidden,reused,range,writes:writes.length,after,noPanel,stale:stale===null,wrongIdentity:wrongIdentity===null,observers,errors,notes};
   },{runtime,buttons,css,legacy});
   assert.ok(result.right<=result.width);
   assert.equal(result.calls,legacy?1:2);assert.equal(result.lastText,legacy?'본문 😀':'edited');assert.equal(result.hidden,true);assert.equal(result.reused,true);
   assert.equal(result.notes.length,1);assert.equal(result.notes[0].text,'본문 😀');assert.equal(result.notes[0].sessionId,'s');
   assert.equal(result.range,'1~6');assert.equal(result.writes,4);assert.equal(result.after,2);
   assert.equal(result.noPanel,true);assert.equal(result.stale,legacy);assert.equal(result.observers,0);assert.deepEqual(result.errors,['메시지가 바뀌었습니다. 다시 눌러 주세요.']);
   assert.equal(result.wrongIdentity,true);
   await page.close();
  }
 } finally {await browser.close();}
});

test('바로가기툴 접어두기: folded, only 🟪 shows; pressed, the seven and the 🔢 panel open; pressed again, they fold',async()=>{
 const folded=messageControlsDisplayScript(true);
 assert.equal((folded.out.match(/data-omni-action=/g)||[]).length,7);
 assert.match(folded.out,/data-omni-folded><label data-omni-fold[^>]*><input type="checkbox">🟪<\/label><button/);
 assert.doesNotMatch(display.out,/data-omni-fold/,'unfolded unless switched');
 assert.equal(folded.in,display.in);
 const browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
 try {
  const page=await browser.newPage({viewport:{width:560,height:700}});
  const html=folded.out.replace('$1','3').replace('$2','bottom');
  const seen=await page.evaluate(async html=>{
   // A phone's chat about 520 px wide (Risu's text a size down), where the seven and 🔢's panel once just fit.
   document.body.innerHTML='<div class="risu-chat" data-chat-index="3" style="width:520px"><p>본문</p>'+html+'</div>';
   const footer=document.querySelector('[data-omni-footer]'),label=footer.querySelector('[data-omni-fold]');
   // The chat's 🔢 panel, as omniToggleCounts appends it: − + 4~7 − +, its display inline.
   const panel=document.createElement('div');panel.setAttribute('x-omni-counts','1');panel.style.cssText='display:flex;gap:6px;align-items:center';
   for(const text of ['−','+','4~7','−','+']){const n=document.createElement(text==='4~7'?'span':'button');n.textContent=text;if(text==='4~7')n.style.font='18px system-ui';panel.append(n);}
   footer.append(panel);
   window.readRow=()=>{const s=getComputedStyle(footer);return {buttons:[...footer.querySelectorAll(':scope > button')].filter(b=>getComputedStyle(b).display!=='none').length,panel:getComputedStyle(panel).display,height:Math.round(footer.getBoundingClientRect().height),border:s.borderTopWidth,box:s.backgroundColor,panelTop:Math.round(panel.getBoundingClientRect().top),labelTop:Math.round(label.getBoundingClientRect().top),label:getComputedStyle(label).display};};
   const r=label.getBoundingClientRect();
   return {before:readRow(),at:{x:r.left+r.width/2,y:r.top+r.height/2}};
  },html);
  assert.equal(seen.before.buttons,0,'folded: no button');
  assert.equal(seen.before.panel,'none','folded: no 🔢 panel');
  assert.notEqual(seen.before.label,'none');
  // Folded, the row keeps its box: a fold never changes its height.
  assert.deepEqual([seen.before.border,seen.before.box],['1px','rgb(22, 30, 44)'],'folded, its box stays');
  await page.mouse.click(seen.at.x,seen.at.y);
  const open=await page.evaluate(()=>readRow());
  assert.deepEqual([open.buttons,open.panel],[7,'flex'],'pressed: the seven and the panel');
  assert.equal(open.height,seen.before.height,'open, as tall as folded');
  assert.ok(Math.abs(open.panelTop-open.labelTop)<=4,'🔢\'s panel on the same line, right of the seven');
  await page.mouse.click(seen.at.x,seen.at.y);
  const again=await page.evaluate(()=>readRow());
  assert.equal(again.buttons,0,'pressed again: folded');
  assert.equal(again.height,seen.before.height,'folded again, the same height');
 } finally {await browser.close();}
});

test('🔢 for 옴니 뷰어 and the 🟪 bar: the counts read back, a step by the chat\'s own serialized write, an unknown step none',async()=>{
 const t={backendSettings:{card:{image_min:2,image_max:3}}},writes=[];
 const pe=async patch=>{await new Promise(r=>setTimeout(r,2));Object.assign(t.backendSettings.card,patch.card);writes.push(patch);};
 const before=globalThis.__OMNI_IMAGE_COUNTS__,action=globalThis.__OMNI_MESSAGE_ACTION__;
 try {
  new Function('t','pe','y','omniRelease','nxUnwrapSafeNodes',runtime)(t,pe,()=>{},async()=>{},async a=>a);
  const counts=globalThis.__OMNI_IMAGE_COUNTS__;
  assert.equal(typeof counts,'function');
  assert.deepEqual(await counts(),{min:2,max:3});
  assert.equal(writes.length,0,'a read writes nothing');
  assert.deepEqual(await Promise.all([counts('max-up'),counts('max-up')]).then(r=>r.at(-1)),{min:2,max:5},'quick steps add up');
  assert.deepEqual(await counts('min-down'),{min:1,max:5});
  assert.deepEqual(await counts('min-down'),{min:1,max:5},'never under one');
  assert.deepEqual(await counts('sideways'),{min:1,max:5});
  assert.deepEqual(writes,[{card:{image_max:4}},{card:{image_max:5}},{card:{image_min:1}}]);
 } finally {globalThis.__OMNI_IMAGE_COUNTS__=before;globalThis.__OMNI_MESSAGE_ACTION__=action;}
});

test('module button renderer regression guard rejects a deliberately removed action',()=>{
 const check=s=>assert.equal((s.match(/data-omni-action=/g)||[]).length,7);
 check(buttons);
 assert.throws(()=>check(buttons.replace('data-omni-action=','data-removed=')),assert.AssertionError);
});
