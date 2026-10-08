import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {chromium} from 'playwright';

const streamSource=readFileSync(new URL('../tools/vendor-patches/stream-runtime.js',import.meta.url),'utf8');
const streamHelpers=streamSource.slice(streamSource.indexOf('async function omniRelease'),streamSource.indexOf('let omniObserverWork'));
const parts = ['style', '', 'render', 'input', 'position', 'drag'];
const runtime = parts.map(part => readFileSync(new URL(`../tools/vendor-patches/float-viewer${part ? '-'+part : ''}.js`,import.meta.url),'utf8')).join('\n');
const messageRuntime=readFileSync(new URL('../tools/vendor-patches/message-runtime.js',import.meta.url),'utf8');
const countRuntime=messageRuntime.slice(messageRuntime.indexOf('let omniCountWrites='),messageRuntime.indexOf('async function omniDisposeMessageRuntime('));
async function clickAt(page, selector) {
  const rect = await page.locator(selector).boundingBox();
  assert.ok(rect, selector+' must be visible');
  await page.locator('body').dispatchEvent('click',{clientX:rect.x+rect.width/2,clientY:rect.y+rect.height/2,button:0});
  await page.evaluate(()=>fixture.api.apply());
}
async function hoverAt(page, inside) {
  await page.locator('body').dispatchEvent('pointermove',{clientX:inside?30:900,clientY:inside?30:650});
  await page.waitForFunction(want=>fixture.api.hovered()===want,inside);
}

async function setup(page, width = 1000, cacheGallery = true, runtimeSource = runtime) {
  await page.setViewportSize({width,height:700});
  await page.setContent(`<style>html,body{margin:0;height:100%}.default-chat-screen{height:100vh;overflow:auto}.risu-chat{padding:20px;margin-left:390px}.shot{height:260px;margin-bottom:100px}.shot img{width:80px;height:80px}</style>
    <div class="default-chat-screen"><div class="risu-chat" data-chat-index="4" data-chat-id="message-four"><div class="chattext">
    <div class="shot" x-inlay-inline-shot="a" x-inray-asset="asset-a"><img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E"></div>
    <div class="shot" x-inlay-inline-shot="b" x-inray-asset="asset-b"><img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='red'/%3E"></div>
    </div></div></div>`);
  await page.evaluate(({runtime,cacheGallery}) => {
    const wrap = n => n ? new Safe(n) : null;
    const listeners = new Map(); let serial = 0;
    const stats={bubbleRects:0,bubbleHandles:0,shotQueries:0,galleryLoads:0,floatRects:0,styleWrites:0,textWrites:0};
    class Safe {
      constructor(n) { this.n = n; }
      async querySelector(q) { return wrap(this.n.querySelector(q)); }
      async querySelectorAll(q) {
        if(this.n.matches('.risu-chat'))stats.shotQueries++;
        const nodes=this.n.querySelectorAll(q);
        if(q==='.risu-chat' && window.fixture?.lazy) return {length:async()=>nodes.length,at:async i=>{stats.bubbleHandles++;return wrap(nodes[i]);}};
        return [...nodes].map(wrap);
      }
      async getOuterHTML() { return this.n.outerHTML; }
      async getParent() { return wrap(this.n.parentElement); }
      async getProperty(key) { return this.n[key]; }
      async clientWidth() {return this.n.clientWidth;}
      async clientHeight() {return this.n.clientHeight;}
      async getBoundingClientRect() { if(this.n.matches('.risu-chat'))stats.bubbleRects++;if(this.n.matches('[x-nx-float]'))stats.floatRects++;return this.n.getBoundingClientRect().toJSON(); }
      async setAttribute(k,v) { if(!k.startsWith('x-')) throw Error('Unsafe attribute'); this.n.setAttribute(k,v); }
      async getAttribute(k) { if(!k.startsWith('x-')) throw Error('Unsafe attribute'); return this.n.getAttribute(k); }
      async setStyle(k,v) { this.n.style[k]=v; }
      async setStyleAttribute(v) { stats.styleWrites++;this.n.style.cssText = v; }
      async setInnerHTML(v) { this.n.innerHTML = v; }
      async setTextContent(v) { stats.textWrites++;this.n.textContent = v; }
      async appendChild(n) { this.n.appendChild(n.n); }
      async remove() { this.n.remove(); }
      async addEventListener(kind,fn,options) {
        // Risu apiV3/v3.svelte.ts: callbacks attach to document, even when
        // registered through an individual SafeElement, and omit the target.
        const allowed=['click','dblclick','contextmenu','pointerdown','mouseup','pointermove','mouseover','mouseleave','pointercancel','pointerdown','pointerenter','pointerleave','pointermove','pointerout','pointerover','pointerup','scroll','scrollend','keydown','keyup','keypress'];
        if(!allowed.includes(kind))throw Error(`Event listener of type '${kind}' is not allowed for security reasons.`);
        const callback = e => fn({clientX:e.clientX,clientY:e.clientY,button:e.button,key:e.key});
        const id = ++serial; listeners.set(id,{node:document,kind,callback,options});
        document.addEventListener(kind,callback,options); return id;
      }
      async removeEventListener(kind,id,options) {
        const record = listeners.get(id);
        if (!record || record.kind !== kind) throw Error('Bad listener id');
        if(!!record.options?.capture !== !!options?.capture) throw Error('Capture options must match');
        record.node.removeEventListener(kind,record.callback,options); listeners.delete(id);
      }
    }
    const doc = wrap(document.documentElement), calls = [], targets = new Map();
    const t = {hostDoc:doc,backendSettings:{card:{floating_viewer:true,viewer_minimize_mode:'buttons'}},gallery:[]};
    let scope = {sessionId:'s',characterId:'char',chatId:'chat',charIndex:1,chatIndex:2};
    const cards = ['a','b'].map((id,i)=>({id,session_id:'s',character_id:'char',chat_id:'chat',message_index:4,paragraph:i,shot_index:0}));
    t.gallery=cards;
    if(cacheGallery)t._galleryCache={sessionId:'s'};
    const H = async(_doc,tag,opts={}) => {
      const n = document.createElement(tag);
      if(opts.text) n.textContent=opts.text;
      if(opts.style) n.style.cssText=opts.style;
      return wrap(n);
    };
    globalThis.__INLAY_NATIVE__ = {resolveImageUrl:c=>'data:image/png;base64,'+c.id,ensureImageUrl:async id=>'data:image/png;base64,'+id};
    t._nxInspectOpener = async (...args) => calls.push(['full',...args]);
    const k = {createMutationObserver:async fn=>{const observer=new MutationObserver(fn);return {observe:async(node,opts)=>observer.observe(node.n,opts),disconnect:async()=>observer.disconnect()};}};
    const deps = {omniScope:{pending:null},omniPerf:{released:0,viewerPasses:0},omniReadScope:async()=>scope,t,H,k,pe:async patch=>{await new Promise(r=>setTimeout(r,10));Object.assign(t.backendSettings.card,patch.card);calls.push(['save',patch]);},ue:async()=>doc,Z:async()=>scope,ce:async sid=>{stats.galleryLoads++;t.gallery=sid==='s'?cards:[];t._galleryCache={sessionId:sid};},
      Aa:async()=>({left:10,top:10,w:360,h:560}),loadViewerIconGeo:async()=>({left:10,top:10}),loadViewerMinimized:async()=>false,
      saveViewerMinimized:async v=>calls.push(['collapsed',v]),saveViewerIconGeo:async v=>v,qt:async v=>calls.push(['geo',v]),
      omniFooterTargets:targets,omniFooterAction:async(kind,key)=>calls.push([kind,targets.get(key)]),
      nxUnwrapSafeNodes:async v=>v,hitEl:async(el,x,y)=>{const r=await el.getBoundingClientRect();return r.width>0&&r.height>0&&x>=r.left&&x<=r.right&&y>=r.top&&y<=r.bottom;},
      // Browser animation frames cannot drive work in Risu's hidden plugin iframe.
      requestAnimationFrame:()=>{throw Error('animation frames unavailable in hidden plugin iframe');},
      y:()=>{},$e:()=>{},withImageRerollToast:async(_text,fn)=>fn(),K:async()=>({card:cards[0]})};
    const api = new Function(...Object.keys(deps),runtime+`;return {ensure:nxFloatEnsure,apply:nxFloatApply,show:nxFloatShow,hide:nxFloatHide,scan:nxFloatScan,select:nxFloatShowCard,dispose:nxFloatDispose,
      passes:()=>omniPerf.viewerPasses,
      state:()=>({id:nxFloatCardId,url:nxFloatLastUrl,idle:nxFloatIdle,collapsed:nxFloatCollapsed}),hovered:()=>nxFloatHovered,
      target:()=>omniFooterTargets.get(nxFloatKey),dragCount:()=>nxFloatDrag?1:0,finishMove:()=>nxFloatPaintMove(),armIdle:nxFloatArmIdle};`)(...Object.values(deps));
    window.fixture = {api,t,calls,targets,listeners,stats,scope:v=>{scope={...scope,...v};},wrap};
  },{runtime:streamHelpers+countRuntime+runtimeSource,cacheGallery});
  await page.evaluate(()=>Promise.all([fixture.api.ensure(),fixture.api.ensure(),fixture.api.ensure()]));
}

async function verifyNoIdleBridgeWork(page, runtimeSource=runtime) {
  await setup(page,1000,true,runtimeSource);
  await page.evaluate(async()=>{
    const {stats,api}=fixture;
    stats.floatRects=stats.styleWrites=stats.textWrites=0;
    for(let i=0;i<100;i++)document.body.dispatchEvent(new PointerEvent('pointermove',{clientX:900,clientY:650,bubbles:true}));
    await Promise.all(Array.from({length:30},()=>api.apply()));
  });
  const stats=await page.evaluate(()=>({...fixture.stats}));
  assert.equal(stats.floatRects,0,'mouse movement outside the fixed viewer does not read host geometry');
  assert.equal(stats.styleWrites,0,'unchanged maintenance performs no bridge style writes');
  assert.equal(stats.textWrites,0,'unchanged maintenance performs no bridge text writes');
}

test('floating viewer reuses fixed bounds and unchanged chrome; performance guard detects regressions',async()=>{
  const browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
  try {
    const page=await browser.newPage();await verifyNoIdleBridgeWork(page);
    assert.deepEqual(await page.locator('[x-nx-float-headbtns="r"] button').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('x-nx-float-btn'))),['compact','fold','full']);
    await page.close();
    const broken=await browser.newPage();
    const mutation=runtime.replace('nxFloatStyleCache.get(el) === css','false');
    assert.notEqual(mutation,runtime,'the guard mutation must change the runtime');
    await assert.rejects(()=>verifyNoIdleBridgeWork(broken,mutation),/unchanged maintenance performs no bridge style writes/);
    await broken.close();
  } finally {await browser.close();}
});

async function verifyConsumedScan(page,runtimeSource=runtime) {
  await setup(page,1000,true,runtimeSource);
  await page.clock.install();await page.clock.pauseAt(new Date(Date.now()+1000));
  await page.evaluate(async()=>{
    document.querySelector('.default-chat-screen').dispatchEvent(new Event('scroll'));
    await fixture.api.scan();fixture.completedPasses=fixture.api.passes();
  });
  await page.clock.runFor(200);
  assert.equal(await page.evaluate(()=>fixture.api.passes()),await page.evaluate(()=>fixture.completedPasses),'a direct action read must consume the queued scroll read');
}

test('direct viewer reads consume pending scroll scans; the scheduler guard detects a duplicate pass',async()=>{
  const browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
  try {
    const page=await browser.newPage();await verifyConsumedScan(page);await page.close();
    const mutation=runtime.replace('  clearTimeout(nxFloatScanTimer);nxFloatScanTimer=0;','');
    assert.notEqual(mutation,runtime);
    const broken=await browser.newPage();await assert.rejects(()=>verifyConsumedScan(broken,mutation),/a direct action read must consume/);await broken.close();
  } finally {await browser.close();}
});

test('floating viewer survives coordinate-only host events, scroll, idle, settings and remounts',async()=>{
  const browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
  try {
    const page=await browser.newPage();
    await setup(page);
    assert.equal(await page.locator('[x-nx-float]').count(),1,'concurrent boot mounts exactly one viewer');
    const beforeStreaming=await page.evaluate(()=>fixture.api.passes());
    await page.evaluate(async()=>{fixture.scope({chat:{isStreaming:true}});await fixture.api.scan();});
    assert.ok(await page.evaluate(()=>fixture.api.passes())>beforeStreaming,'streaming does not block viewer updates');
    assert.equal(await page.evaluate(()=>[...fixture.listeners.values()].filter(v=>v.kind==='click').length),1,'exactly one document click handler');
    await page.locator('body').dispatchEvent('click',{clientX:900,clientY:650,button:0});
    await page.locator('body').dispatchEvent('pointerdown',{clientX:900,clientY:650,button:0});
    await page.evaluate(()=>fixture.api.apply());
    assert.deepEqual(await page.evaluate(()=>fixture.calls),[],'chat clicks cannot trigger floating controls');
    assert.equal(await page.evaluate(()=>fixture.api.dragCount()),0,'chat press cannot drag the viewer');
    assert.equal(await page.locator('[x-nx-float-reroll]').count(),1,'initial image must retain reroll button');
    assert.equal(await page.evaluate(()=>fixture.api.state().id),'b','boot picks reading position');
    const target=await page.evaluate(()=>fixture.api.target());
    assert.equal(target.index,4); assert.equal(target.chatIndex,2,'chat index is not message index');
    await page.clock.install();
    await page.clock.pauseAt(new Date(Date.now()+1000));
    // Arm after clock installation so the deadline is deterministic.
    await hoverAt(page,true);
    await hoverAt(page,false);
    await page.clock.runFor(1999);
    assert.equal(await page.evaluate(()=>fixture.api.state().idle),false);
    await page.clock.runFor(1);
    await page.evaluate(()=>fixture.api.apply());
    assert.equal(await page.evaluate(()=>fixture.api.state().idle),true,'fades at two seconds');
    await page.evaluate(async()=>{
      document.querySelector('[x-inlay-inline-shot="a"]').style.transform='translateY(190px)';
      document.querySelector('[x-inlay-inline-shot="b"]').style.transform='translateY(1000px)';
      document.querySelector('.default-chat-screen').dispatchEvent(new Event('scroll'));
    });
    await page.clock.runFor(130);
    await page.evaluate(()=>fixture.api.scan());
    assert.equal(await page.evaluate(()=>fixture.api.state().id),'a');
    assert.equal(await page.evaluate(()=>fixture.api.state().idle),true,'scroll must not wake chrome');
    await page.evaluate(()=>fixture.api.ensure());
    assert.equal(await page.evaluate(()=>fixture.api.state().idle),true,'maintenance must not wake chrome');
    await hoverAt(page,true);
    await page.evaluate(()=>fixture.api.apply());
    assert.equal(await page.evaluate(()=>fixture.api.state().idle),false);
    assert.equal(await page.locator('[x-nx-float]').evaluate(n=>getComputedStyle(n).backdropFilter),'none','hover keeps the alpha surface without background blur');
    assert.equal(await page.locator('[x-nx-float]').evaluate(n=>getComputedStyle(n).boxShadow),'none');
    assert.notEqual(await page.locator('[x-nx-float]').evaluate(n=>getComputedStyle(n).backgroundColor),'rgba(0, 0, 0, 0)','hover restores the alpha surface');
    await page.clock.runFor(2500);
    assert.equal(await page.evaluate(()=>fixture.api.state().idle),false,'hovered controls remain usable');
    await clickAt(page,'[x-nx-float-bar] [x-nx-float-btn="tag"]');
    await clickAt(page,'[x-nx-float-head] [x-nx-float-btn="full"]');
    assert.deepEqual(await page.evaluate(()=>fixture.calls.map(c=>c[0])),['tag','full']);
    await clickAt(page,'[x-nx-float-btn="fold"]');
    await page.evaluate(()=>fixture.api.apply());
    assert.equal(await page.locator('[x-nx-float-foldgrid] button:visible').count(),10);
    await page.evaluate(()=>{fixture.t.uiOpen=true;return fixture.api.hide();});
    await page.clock.runFor(3000);
    await page.evaluate(()=>fixture.api.apply());
    assert.equal(await page.locator('[x-nx-float]').isVisible(),false,'timer cannot resurrect settings-hidden viewer');
    await page.evaluate(()=>{fixture.t.uiOpen=false;return fixture.api.show();});
    assert.equal(await page.locator('[x-nx-float-foldgrid]').isVisible(),true,'buttons-only restores after settings');
    await page.evaluate(()=>{fixture.t.backendSettings.card.viewer_minimize_mode='bubble';return fixture.api.ensure();});
    assert.equal(await page.locator('[x-nx-float-icon]').isVisible(),true);
    const bubble=await page.locator('[x-nx-float]').boundingBox(); assert.equal(bubble.width,52);
    assert.equal(await page.locator('[x-nx-float]').evaluate(n=>getComputedStyle(n).boxShadow),'none','minimized bubble has no shadow');
    assert.equal(await page.locator('[x-nx-float]').evaluate(n=>getComputedStyle(n).borderRadius),'50%');
    await page.evaluate(async()=>{
      fixture.t.backendSettings.card.viewer_minimize_mode='buttons';
      document.querySelector('.default-chat-screen').outerHTML=document.querySelector('.default-chat-screen').outerHTML;
      document.querySelector('[x-nx-float]').remove();
      await fixture.api.ensure();
    });
    assert.equal(await page.locator('[x-nx-float]').count(),1);
    assert.equal(await page.locator('[x-nx-float-foldgrid]').isVisible(),true);
    await page.evaluate(async()=>{fixture.scope({sessionId:'empty',chatId:'empty'});document.querySelector('.default-chat-screen').innerHTML='';await fixture.api.ensure();});
    assert.equal(await page.evaluate(()=>fixture.api.state().url),'','chat switch clears stale pixels');
    assert.equal(await page.evaluate(()=>fixture.api.target()),undefined);
    await page.evaluate(()=>{fixture.t.backendSettings.card.floating_viewer=false;return fixture.api.ensure();});
    assert.equal(await page.locator('[x-nx-float]').count(),0);
    assert.equal(await page.evaluate(()=>fixture.listeners.size),0,'dispose releases every host listener');
    await page.close();
  } finally {await browser.close();}
});

test('floating position lookup stays bounded across a large jump and never searches for distant images',async()=>{
 const browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
 try {
  const page=await browser.newPage();await setup(page,1000,false);
  assert.equal(await page.evaluate(()=>fixture.stats.galleryLoads),0,'mount must not load the gallery or rehash the chat');
  await page.evaluate(()=>{
   fixture.retainedImage=document.querySelector('[x-nx-float-body] img');
   fixture.lazy=true;
   const screen=document.querySelector('.default-chat-screen');
   screen.innerHTML=Array.from({length:1000},(_,i)=>`<div class="risu-chat" data-chat-index="${i}" data-chat-id="m${i}" style="height:100px;box-sizing:border-box">${i===0?'<div x-inlay-inline-shot="a"><img src="data:image/png;base64,a"></div>':'text '+i}</div>`).join('');
   screen.scrollTop=80000;
  });
  assert.ok(await page.evaluate(()=>!!fixture.retainedImage),'the previously displayed image must exist');
  await page.evaluate(async()=>{fixture.stats.bubbleRects=0;fixture.stats.shotQueries=0;await fixture.api.scan();});
  const stats=await page.evaluate(()=>({...fixture.stats}));
  assert.ok(stats.bubbleRects<40,JSON.stringify(stats));
  assert.ok(stats.bubbleHandles<40,JSON.stringify(stats));
  assert.ok(stats.shotQueries<=3,JSON.stringify(stats));
  assert.equal(await page.evaluate(()=>fixture.api.state().id),'b','missing nearby image must keep the previous selection');
  assert.equal(await page.evaluate(()=>document.querySelector('[x-nx-float-body] img')===fixture.retainedImage),true,'an image miss must not replace the displayed DOM image');
  assert.equal(await page.locator('[x-nx-float-empty]').count(),0);
  await page.waitForTimeout(220);
  const before=await page.evaluate(()=>fixture.api.passes());
  await page.evaluate(()=>{document.querySelector('[data-chat-index="5"]').textContent='unrelated edit';});
  await page.waitForTimeout(220);
  assert.equal(await page.evaluate(()=>fixture.api.passes()),before,'an unrelated message must not restart the viewer');
  await page.evaluate(()=>{fixture.stats.shotQueries=0;const index=fixture.api.target().index;document.querySelector('[data-chat-index="'+index+'"]').innerHTML='<div x-inlay-inline-shot="a"><img style="width:60px;height:60px" src="data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\'/%3E"></div>';});
  await page.waitForFunction(()=>fixture.api.state().id==='a');
  assert.equal(await page.evaluate(()=>fixture.stats.shotQueries),1,'only the changed nearby message is reread');
  await page.evaluate(async()=>{fixture.stats.shotQueries=0;await fixture.api.scan();});
  assert.equal(await page.evaluate(()=>fixture.stats.shotQueries),0,'unchanged neighboring image metadata is reused');
  await page.evaluate(async()=>{document.querySelector('.default-chat-screen').scrollTop=80300;await fixture.api.scan();});
  assert.equal(await page.evaluate(()=>fixture.api.target().index),806,'a moderate scroll must still track the message at the reading position');
  await page.evaluate(async()=>{
   const screen=document.querySelector('.default-chat-screen');
   screen.style.display='flex';screen.style.flexDirection='column-reverse';
   for(const row of screen.querySelectorAll('.risu-chat'))row.style.flexShrink='0';
   screen.scrollTop=-60000;
   fixture.stats.bubbleRects=0;await fixture.api.scan();
  });
  const reverse=await page.evaluate(()=>({actual:fixture.api.target().index,
   expected:Number(document.elementFromPoint(600,350).closest('.risu-chat').dataset.chatIndex),rects:fixture.stats.bubbleRects}));
  assert.equal(reverse.actual,reverse.expected,'reverse chat layout must keep the reading position');
  assert.ok(reverse.rects<40,JSON.stringify(reverse));
  await page.evaluate(()=>fixture.api.dispose());
 }finally{await browser.close();}
});

test('floating snapshots refresh when bubble layout changes without a message mutation',async()=>{
 const browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
 try {
  const page=await browser.newPage();await setup(page);
  assert.equal(await page.evaluate(()=>fixture.api.state().id),'b');
  await page.evaluate(async()=>{fixture.stats.shotQueries=0;document.querySelector('style').textContent+=' .shot{height:520px}';await fixture.api.scan();});
  assert.equal(await page.evaluate(()=>fixture.api.state().id),'a','external layout changes must not reuse old image positions');
  assert.equal(await page.evaluate(()=>fixture.stats.shotQueries),1,'only the resized bubble is reread');
  await page.evaluate(async()=>{fixture.stats.shotQueries=0;await fixture.api.scan();});
  assert.equal(await page.evaluate(()=>fixture.stats.shotQueries),0);
  await page.evaluate(()=>fixture.api.dispose());
 }finally{await browser.close();}
});

test('floating counts opens below viewer, edits saved min/max and works folded without resizing image',async()=>{
  const browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
  try {
    const page=await browser.newPage();await setup(page,320);
    await page.evaluate(()=>Object.assign(fixture.t.backendSettings.card,{image_min:3,image_max:7}));
    const frame=await page.locator('[x-nx-float]').boundingBox();
    const image=await page.locator('[x-nx-float-body]').boundingBox();
    await clickAt(page,'[x-nx-float-bar] [x-nx-float-btn="counts"]');
    assert.equal(await page.locator('[x-nx-float-counts]').count(),1,'counts opens locally');
    const panel=page.locator('[x-nx-float-counts]');
    assert.equal(await panel.locator('[x-omni-count-value]').textContent(),'3~7');
    assert.deepEqual(await page.locator('[x-nx-float]').boundingBox(),frame);
    assert.deepEqual(await page.locator('[x-nx-float-body]').boundingBox(),image);
    const bounds=await panel.boundingBox();
    assert.ok(bounds.y>=frame.y+frame.height && bounds.x>=0 && bounds.x+bounds.width<=320);
    await clickAt(page,'[x-nx-float-btn="min-up"]');
    await page.waitForFunction(()=>fixture.t.backendSettings.card.image_min===4);
    await clickAt(page,'[x-nx-float-btn="max-down"]');
    await page.waitForFunction(()=>fixture.t.backendSettings.card.image_max===6);
    assert.equal(await panel.locator('[x-omni-count-value]').textContent(),'4~6');
    await page.evaluate(()=>{
      const r=document.querySelector('[x-nx-float-btn="max-up"]').getBoundingClientRect();
      for(let i=0;i<2;i++)document.body.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:r.x+r.width/2,clientY:r.y+r.height/2,button:0}));
    });
    await page.waitForFunction(()=>fixture.t.backendSettings.card.image_max===8);
    await page.clock.install();
    await page.clock.pauseAt(new Date(Date.now()+1000));
    await page.locator('body').dispatchEvent('pointermove',{clientX:bounds.x+20,clientY:bounds.y+20});
    await page.waitForFunction(()=>fixture.api.hovered());
    await page.clock.runFor(2500);
    assert.equal(await page.evaluate(()=>fixture.api.state().idle),false,'hovering popup keeps controls visible');
    await hoverAt(page,false);
    await page.clock.runFor(2000);
    await page.evaluate(()=>fixture.api.apply());
    assert.equal(await panel.evaluate(n=>n.style.opacity),'0');
    await hoverAt(page,true);
    await page.evaluate(()=>fixture.api.apply());
    assert.equal(await page.evaluate(()=>fixture.calls.some(c=>c[0]==='counts')),false,'no settings-tab action');
    await clickAt(page,'[x-nx-float-btn="fold"]');
    await clickAt(page,'[x-nx-float-foldgrid] [x-nx-float-btn="counts"]');
    assert.equal(await panel.isVisible(),false,'same toggle closes while folded');
    await clickAt(page,'[x-nx-float-foldgrid] [x-nx-float-btn="counts"]');
    assert.equal(await panel.isVisible(),true);
    const folded=await page.locator('[x-nx-float]').boundingBox();
    await clickAt(page,'[x-nx-float-foldgrip] [x-nx-float-btn="compact"]');
    const compact=await page.locator('[x-nx-float]').boundingBox();
    assert.equal(compact.width,64);assert.equal(compact.height,82);
    const compactGrip=await page.locator('[x-nx-float-foldgrip] span').boundingBox();
    const restoreButton=await page.locator('[x-nx-float-foldgrip] button').boundingBox();
    assert.ok(restoreButton.y>=compactGrip.y+compactGrip.height,'restore sits below the header');
    assert.ok(compact.width<folded.width && compact.height<folded.height,'header-only mode shrinks both dimensions');
    assert.equal(await page.locator('[x-nx-float] button:visible').count(),1,'only the restore button remains');
    assert.equal(await page.locator('[x-nx-float-foldgrip] button').textContent(),'+');
    assert.equal(await panel.isVisible(),false,'compact mode hides open count controls');
    await page.evaluate(()=>{fixture.t.uiOpen=true;return fixture.api.hide();});
    await page.evaluate(()=>{fixture.t.uiOpen=false;return fixture.api.show();});
    assert.deepEqual(await page.locator('[x-nx-float]').boundingBox(),compact,'settings round trip preserves compact mode');
    await clickAt(page,'[x-nx-float-foldgrip] [x-nx-float-btn="compact"]');
    assert.deepEqual(await page.locator('[x-nx-float]').boundingBox(),folded,'restore keeps folded geometry');
    assert.equal(await panel.isVisible(),true,'restore brings back the open counts');
    await clickAt(page,'[x-nx-float-btn="unfold"]');
    await clickAt(page,'[x-nx-float-head] [x-nx-float-btn="compact"]');
    assert.equal(await page.locator('[x-nx-float-body]').isVisible(),false);
    await clickAt(page,'[x-nx-float-foldgrip] [x-nx-float-btn="compact"]');
    assert.deepEqual(await page.locator('[x-nx-float]').boundingBox(),frame,'restore also keeps expanded geometry');
    assert.deepEqual(await page.locator('[x-nx-float-body]').boundingBox(),image);
    await page.evaluate(()=>Object.assign(fixture.t.backendSettings.card,{image_min:6,image_max:6}));
    await clickAt(page,'[x-nx-float-btn="min-up"]');
    await clickAt(page,'[x-nx-float-btn="max-down"]');
    assert.equal(await page.evaluate(()=>fixture.t.backendSettings.card.image_min),6);
    assert.equal(await page.evaluate(()=>fixture.t.backendSettings.card.image_max),6);
    await page.evaluate(()=>{fixture.t.uiOpen=true;return fixture.api.hide();});
    assert.equal(await panel.isVisible(),false);
    await page.evaluate(()=>fixture.api.dispose());
  } finally {await browser.close();}
});

test('floating drag cleans up on settings hide and late pixels cannot cross chats',async()=>{
  const browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
  try {
    const page=await browser.newPage(); await setup(page);
    const handle=await page.locator('[x-nx-float-resize]').boundingBox();
    await page.locator('[x-nx-float-resize]').dispatchEvent('pointerdown',{clientX:handle.x+20,clientY:handle.y+20,button:0});
    await page.waitForFunction(()=>fixture.api.dragCount()===1);
    await page.locator('body').dispatchEvent('pointermove',{clientX:handle.x+70,clientY:handle.y+50});
    await page.evaluate(()=>fixture.api.finishMove());
    const resized=await page.locator('[x-nx-float]').boundingBox();
    assert.equal(resized.width,410);
    await page.evaluate(()=>{fixture.t.uiOpen=true;return fixture.api.hide();});
    assert.equal(await page.evaluate(()=>fixture.api.dragCount()),0,'hiding cancels active gesture listeners');
    await page.evaluate(()=>{fixture.t.uiOpen=false;return fixture.api.show();});
    await page.evaluate(()=>{
      document.querySelector('.default-chat-screen').innerHTML='';
      __INLAY_NATIVE__.resolveImageUrl=()=>'';
      __INLAY_NATIVE__.ensureImageUrl=()=>new Promise(resolve=>{fixture.finishPixels=resolve;});
      fixture.pending=fixture.api.select('a');
    });
    await page.waitForFunction(()=>!!fixture.finishPixels);
    await page.evaluate(async()=>{fixture.scope({sessionId:'empty',chatId:'empty'});await fixture.api.ensure();fixture.finishPixels('data:image/png;base64,old');await fixture.pending;});
    assert.equal(await page.evaluate(()=>fixture.api.state().url),'');
    assert.equal(await page.evaluate(()=>fixture.api.target()),undefined);
    await page.evaluate(()=>fixture.api.dispose());
    assert.equal(await page.evaluate(()=>fixture.listeners.size),0);
  } finally {await browser.close();}
});

test('floating viewer fits narrow windows and preserves reroll across image replacement',async()=>{
  const browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
  try {
    const page=await browser.newPage(); await setup(page,320);
    await page.evaluate(()=>{document.querySelector('.default-chat-screen').innerHTML='';});
    await page.evaluate(()=>fixture.api.select('a'));
    await page.evaluate(()=>fixture.api.select('b'));
    assert.match(await page.evaluate(()=>fixture.api.state().url),/b$/,'no previous DOM URL leaks into next card');
    assert.equal(await page.locator('[x-nx-float-reroll]').count(),1);
    const bounds=await page.locator('[x-nx-float]').boundingBox();
    assert.ok(bounds.x>=0 && bounds.x+bounds.width<=320,'host viewport clamps window width');
    assert.ok(bounds.y>=0 && bounds.y+bounds.height<=700,'host viewport clamps window height');
    const image=await page.locator('[x-nx-float-body] img').boundingBox();
    assert.ok(image.height>100 && image.height<bounds.height,'image flexes between controls');
    await page.evaluate(()=>fixture.api.dispose());
  } finally {await browser.close();}
});


test('generation follows the central text-only message while the viewer keeps its previous image',async()=>{
  const browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
  try {
    const page=await browser.newPage();await setup(page);
    await page.evaluate(async()=>{
      document.querySelector('.default-chat-screen').innerHTML='<div class="risu-chat" data-chat-index="9" data-chat-id="text-nine" style="height:680px">Only text here</div>';
      await fixture.api.scan();
    });
    await clickAt(page,'[x-nx-float-bar] [x-nx-float-btn="tag"]');
    const action=await page.evaluate(()=>fixture.calls.find(c=>c[0]==='tag'));
    assert.equal(action[1].index,9);assert.equal(action[1].hostId,'text-nine');
    assert.equal(await page.evaluate(()=>fixture.api.state().id),'b');
    assert.equal(await page.locator('[x-nx-float-empty]').count(),0);
    await page.evaluate(()=>fixture.api.dispose());
  }finally{await browser.close();}
});

test('mobile header drag updates immediately and stores geometry exactly once on release',async()=>{
  const browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
  try {
    const page=await browser.newPage();await setup(page);await clickAt(page,'[x-nx-float-btn="fold"]');
    const grip=await page.locator('[x-nx-float-foldgrip]').boundingBox();assert.ok(grip&&grip.height>=44);
    const x=grip.x+grip.width/2,y=grip.y+grip.height/2;
    await page.locator('body').dispatchEvent('pointerdown',{clientX:x,clientY:y,button:0,pointerType:'touch'});
    await page.waitForFunction(()=>fixture.api.dragCount()===1);
    for(let i=1;i<=20;i++)await page.locator('body').dispatchEvent('pointermove',{clientX:x+i*4,clientY:y+i*3,pointerType:'touch'});
    await page.evaluate(()=>fixture.api.finishMove());
    assert.equal(await page.evaluate(()=>fixture.calls.filter(c=>c[0]==='geo').length),0);
    const moving=await page.locator('[x-nx-float]').boundingBox();assert.ok(moving.x>60&&moving.y>50);
    await page.locator('body').dispatchEvent('pointerup',{clientX:x+80,clientY:y+60,pointerType:'touch'});
    await page.waitForFunction(()=>fixture.calls.filter(c=>c[0]==='geo').length===1);
    await page.evaluate(()=>fixture.api.dispose());assert.equal(await page.evaluate(()=>fixture.listeners.size),0);
  }finally{await browser.close();}
});

async function verifyTouchIdle(page,runtimeSource=runtime) {
  await setup(page,320,true,runtimeSource);
  await page.addStyleTag({content:'*{transition-duration:0s!important}'});
  assert.equal(await page.evaluate(()=>matchMedia('(hover: none)').matches),true);
  await page.clock.install();await page.clock.pauseAt(new Date(Date.now()+1000));
  await page.evaluate(()=>{fixture.api.armIdle();return fixture.api.apply();});
  await page.clock.runFor(2500);
  assert.equal(await page.evaluate(()=>fixture.api.state().idle),true);
  const button=await page.locator('[x-nx-float-head] [x-nx-float-btn="full"]').boundingBox();
  const point={clientX:button.x+button.width/2,clientY:button.y+button.height/2,button:0};
  await page.locator('body').dispatchEvent('pointerdown',point);
  await page.evaluate(()=>fixture.api.apply());
  await page.locator('body').dispatchEvent('pointermove',point);
  await page.locator('body').dispatchEvent('pointerup',point);
  await page.locator('body').dispatchEvent('click',point);
  await page.locator('body').dispatchEvent('pointermove',point);
  await page.evaluate(()=>fixture.api.apply());
  assert.equal(await page.evaluate(()=>fixture.api.state().idle),false,'touch reveals floating buttons');
  assert.equal(await page.evaluate(()=>fixture.calls.filter(c=>c[0]==='full').length),0,'the reveal tap cannot activate a hidden fullscreen button');
  await page.clock.runFor(2500);
  await page.evaluate(()=>fixture.api.apply());
  assert.equal(await page.evaluate(()=>fixture.api.state().idle),true,'stationary touch coordinates cannot keep hover alive after release');
  const opacity=await page.locator('[x-nx-float-reroll]').evaluate(n=>getComputedStyle(n).opacity);
  assert.equal(opacity,'0','touch hover cannot leave reroll visible after idle');
  await page.evaluate(()=>fixture.api.dispose());
}

test('touch-only floating controls reveal safely and hide after release; sticky-hover guard detects regression',async()=>{
  const browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
  try {
    const page=await browser.newPage({hasTouch:true,isMobile:true});await verifyTouchIdle(page);await page.close();
    const mutation=runtime.replace('nxFloatDrag || nxFloatTouchOnly()','nxFloatDrag');
    assert.notEqual(mutation,runtime);
    const broken=await browser.newPage({hasTouch:true,isMobile:true});
    await assert.rejects(()=>verifyTouchIdle(broken,mutation),/stationary touch coordinates cannot keep hover alive/);
    await broken.close();
  } finally {await browser.close();}
});
