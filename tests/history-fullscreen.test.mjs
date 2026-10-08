import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { build } from 'esbuild';

const source = readFileSync('dist/omninexus.js','utf8');
const section = (start, end) => {
  const at=source.indexOf(start), stop=source.indexOf(end,at);
  assert.ok(at>=0 && stop>at,start);
  return source.slice(at,stop);
};
const inspect = section('nxEnsureInspectSurface = async () => {','findActHit = async');
const opener = section('      const nxOpenAssetInspect = async','      t._nxInspectOpener = nxOpenAssetInspect;') + 't._nxInspectOpener = nxOpenAssetInspect;';
const history = readFileSync('tools/vendor-patches/image-history-runtime.js','utf8');

async function setup(page) {
    await page.addScriptTag({content:readFileSync('node_modules/dompurify/dist/purify.min.js','utf8')});
    await page.evaluate(()=>{
      DOMPurify.addHook('uponSanitizeAttribute',(_n,data)=>{if(data.attrName==='class')data.attrValue=data.attrValue.split(' ').map(v=>v.startsWith('x-risu-')?v:'x-risu-'+v).join(' ');});
      window.risuSanitize=html=>DOMPurify.sanitize(html,{FORCE_BODY:true});
    });
    const ui=await build({entryPoints:['src/domain/gallery/history-overlay.ts'],bundle:true,write:false,format:'iife',globalName:'HistoryUi'});
    await page.setContent('<div x-inlay-inline-shot="shot_r2"><img width="832" height="1216" src="data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'832\' height=\'1216\'%3E%3C/svg%3E"></div>');
    await page.addScriptTag({content:ui.outputFiles[0].text});
    await page.evaluate(({inspect,opener,history})=>{
      class Safe {
        constructor(node){this.node=node;}
        async querySelector(s){const n=this.node.querySelector(s);return n instanceof HTMLElement?new Safe(n):null;}
        async querySelectorAll(s){return [...this.node.querySelectorAll(s)].filter(n=>n instanceof HTMLElement).map(n=>new Safe(n));}
        async setAttribute(k,v){if(!k.startsWith('x-'))throw Error('unsafe attribute');this.node.setAttribute(k,v);}
        async getAttribute(k){if(!k.startsWith('x-'))throw Error('unsafe attribute');return this.node.getAttribute(k);}
        async setStyleAttribute(v){this.node.style.cssText=v;}
        async setStyle(k,v){this.node.style.setProperty(k,v);}
        async setInnerHTML(v){this.node.innerHTML=risuSanitize(v);}
        async setOuterHTML(v){this.node.outerHTML=risuSanitize(v);}
        async setTextContent(v){this.node.textContent=v;}
        async setClassName(v){this.node.className=v;}
        async getOuterHTML(){return this.node.outerHTML;}
        async getBoundingClientRect(){return this.node.getBoundingClientRect();}
        async getParent(){return this.node.parentElement?new Safe(this.node.parentElement):null;}
        async appendChild(n){this.node.appendChild(n.node);}
        async cloneNode(deep){return new Safe(this.node.cloneNode(deep));}
        async remove(){this.node.remove();}
        async addEventListener(kind,fn){document.addEventListener(kind,event=>{void fn({clientX:event.clientX,clientY:event.clientY,key:event.key});});}
      }
      globalThis.__INLAY_VIEWER_CORE__=HistoryUi;
      const doc=new Safe(document.documentElement),body=new Safe(document.body),pins=[],actions=[],pixels=[],reads=[],errors=[];
      const src=id=>'data:image/svg+xml,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="832" height="1216"><title>${id}</title><rect width="100%" height="100%" fill="#725a91"/></svg>`);
      globalThis.__INLAY_NATIVE__={ensureImageUrl:async id=>(pixels.push(id),src(id))};
      const t={hostDoc:doc};
      const H=async(_doc,tag,opts={})=>{if(tag==='style')throw Error('standalone stylesheet unavailable');await new Promise(resolve=>setTimeout(resolve,5));const node=new Safe(document.createElement(tag));if(opts.text)await node.setTextContent(opts.text);if(opts.style)await node.setStyleAttribute(opts.style);return node;};
      const K=async(path,opts)=>{
        if(path.endsWith('/pin')){pins.push(path);return {ok:true};}
        if(path.endsWith('/history')){reads.push(path);return {ok:true,cards:['shot_r2','shot_r1','shot'].map(id=>({id,asset_name:`inxshot_${id}.webp`}))};}
        return {};
      };
      const hitEl=async(el,x,y)=>{const r=el.node.getBoundingClientRect();return x>=r.left&&x<=r.right&&y>=r.top&&y<=r.bottom;};
      const deps={t,H,K,e:doc,o:body,nxUnwrapSafeNodes:async n=>n,omniRelease:async()=>{},ue:async()=>doc,hitEl,
        nxFloatHtmlAttr:(html,name)=>new RegExp('(?:^|\\s)'+name+'=["\']([^"\']*)["\']','i').exec(html)?.[1]||'',
        h:v=>String(v).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;'),w:v=>String(v),Ie:card=>card.image_url||'',hidePressFill:async()=>{},y:(...args)=>errors.push(args)};
      const setup=`let inspectOpen=false,actionCard=null,pendingSheetHit=null,inspectGuardUntil=0,inspectZones=[],inspectSheetEl=null;
        let nxInspectSurface=null,nxInspectSurfaceBuild=null,nxInspectShell=null,nxInspectBuild=null,nxInspectImageHtml='',nxInspectMirroredImage=null,nxInspectPaint=Promise.resolve();
        const nxInspectDroppedImages=new WeakSet();let nxPhysical=null,nxInspectOpeningPointer=null;
        const runInspectAction=async(act,card)=>{actions.push([act,card?.id]);if(act==='close'){inspectOpen=false;++t._inspectGen;++t._inspectEpoch;t._nxHostInspectOpen=false;await nxHideInspectQueued();}};`;
      const api=new Function(...Object.keys(deps),'actions',setup+history+'\nconst '+inspect+'end=null;\n'+opener+`;return {open:nxOpenAssetInspect,hover:omniInspectHistoryHover,state:()=>({id:actionCard?.id,open:inspectOpen}),wait:()=>t._inspectLoad,openingPress:()=>{nxPhysical={held:new Set()};nxInspectOpeningPointer=nxPhysical;}};`)(...Object.values(deps),actions);
      // The shipped pointermove hook shares chat and fullscreen hover handling.
      document.addEventListener('pointermove',event=>{if(t._nxHostInspectOpen&&fixture.hoverEnabled)void api.hover({clientX:event.clientX,clientY:event.clientY});});
      window.fixture={api,pins,actions,pixels,reads,errors,hoverEnabled:true};
    },{inspect,opener,history});
}

test('shipped fullscreen hides navigation and pin, shows count on hover and highlights actions',async()=>{
  const browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
  try {
    const page=await browser.newPage({viewport:{width:1200,height:900}});
    await setup(page);
    await page.evaluate(()=>fixture.api.open({id:'shot_r2'},'inxshot_shot_r2.webp'));
    await page.evaluate(()=>fixture.api.wait());
    await page.waitForFunction(()=>document.querySelector('[data-inray-history-dots] span')?.textContent==='3/3');
    assert.equal(await page.locator('[data-inray-history-dots] small').textContent(),'↻2');
    assert.equal(await page.locator('[data-inray-active="1"]').count(),1);
    assert.equal(await page.locator('.x-risu-inray-history').count(),1,'overlapping image/cast paints create one history layer');
    assert.equal(await page.getByRole('button',{name:'이전 이미지',exact:true}).count(),0);
    assert.equal(await page.getByRole('button',{name:'다음 이미지',exact:true}).count(),0);
    assert.equal(await page.getByRole('button',{name:'이 이미지 고정',exact:true}).count(),0);
    assert.equal(await page.locator('[data-inray-history-dots]').evaluate(n=>getComputedStyle(n).opacity),'0','fullscreen count stays hidden without image hover even without a stylesheet');
    await page.locator('[x-inray-history-host] img').hover({force:true});
    await page.waitForFunction(()=>getComputedStyle(document.querySelector('[data-inray-history-dots]')).opacity==='1');
    const gap=await page.locator('[data-inray-history-dots]').evaluate(n=>n.getBoundingClientRect().top-document.querySelector('[x-inray-history-host] img').getBoundingClientRect().top);
    assert.ok(Math.abs(gap-8)<1,'fullscreen count sits close to the image top');
    await page.mouse.move(0,0);
    await page.waitForFunction(()=>getComputedStyle(document.querySelector('[data-inray-history-dots]')).opacity==='0');
    await page.keyboard.press('ArrowLeft');
    await page.waitForFunction(()=>fixture.api.state().id==='shot_r1');
    assert.equal(await page.evaluate(()=>fixture.api.state().open),true);
    await page.waitForFunction(()=>document.querySelector('[data-inray-history-dots] span')?.textContent==='2/3');
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(()=>fixture.api.state().id==='shot_r2');
    const labels=await page.locator('button span[role=img]').allTextContents();
    assert.deepEqual(labels,['⚛️','🔃','🎲','🔮','닫기']);
    assert.equal(await page.evaluate(()=>fixture.reads.length),1,'fullscreen navigation caches metadata and loads only the chosen pixels');
    assert.deepEqual(await page.evaluate(()=>fixture.pixels),['shot_r1','shot_r2']);
    for(const [name,act] of [['태그 생성','retag'],['메시지 이미지 재생성','regen'],['이 이미지 리롤','reroll'],['샷 태그 수정','base']]) {
      const button=page.getByRole('button',{name,exact:true});
      await page.mouse.move(0,0);
      await page.waitForFunction(want=>{const n=[...document.querySelectorAll('button')].find(n=>n.textContent===want);return getComputedStyle(n).backgroundColor==='rgba(255, 255, 255, 0.08)';},await button.textContent());
      await button.hover();
      await page.waitForFunction(want=>{const n=[...document.querySelectorAll('button')].find(n=>n.textContent===want);return getComputedStyle(n).backgroundColor==='rgba(65, 55, 90, 0.85)';},await button.textContent());
      await button.click();
      await page.waitForFunction(want=>fixture.actions.some(row=>row[0]===want&&row[1]==='shot_r2'),act);
    }
    assert.deepEqual(await page.evaluate(()=>fixture.errors),[]);
    await page.mouse.move(0,0);
    await page.waitForFunction(()=>[...document.querySelectorAll('[data-inray-inspect-action]')].every(n=>getComputedStyle(n.parentElement).backgroundColor==='rgba(255, 255, 255, 0.08)'));
    await page.evaluate(()=>{fixture.hoverEnabled=false;const style=document.createElement('style');style.textContent=HistoryUi.imageHistoryCss();document.head.appendChild(style);});
    const cssButton=page.getByRole('button',{name:'태그 생성',exact:true});
    await cssButton.hover();
    await page.waitForFunction(()=>getComputedStyle(document.querySelector('[data-inray-inspect-action]').parentElement).backgroundColor==='rgba(65, 55, 90, 0.85)');
    await page.evaluate(()=>{fixture.hoverEnabled=true;});
    await page.locator('[x-inray-history-host]').hover();
    await page.waitForFunction(()=>getComputedStyle(document.querySelector('[data-inray-history-dots]')).opacity==='1');
    await page.screenshot({path:'.test-build/history-fullscreen-desktop.png'});
    await page.setViewportSize({width:320,height:900});
    await page.evaluate(()=>fixture.api.open({id:'shot_r2'},'inxshot_shot_r2.webp'));
    await page.evaluate(()=>fixture.api.wait());
    await page.locator('[x-inray-history-host] img').hover({force:true});
    await page.waitForFunction(()=>getComputedStyle(document.querySelector('[data-inray-history-dots]')).opacity==='1');
    assert.equal(await page.locator('[data-inray-history-layer] button').count(),0,'mobile fullscreen also has no arrows');
    await page.screenshot({path:'.test-build/history-fullscreen-mobile.png'});
    const bounds = await page.locator('button span[role=img]').evaluateAll(nodes=>nodes.map(n=>n.closest('button').getBoundingClientRect()).map(r=>({left:r.left,right:r.right})));
    assert.ok(bounds.every(r=>r.left>=0&&r.right<=320),'all emoji actions fit on mobile');
    await page.getByRole('button',{name:'닫기',exact:true}).click();
    await page.waitForFunction(()=>!fixture.api.state().open);
  } finally {await browser.close();}
});

test('fullscreen backdrop closes on the next press even when the chat gesture listener is inactive',async()=>{
  const browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
  try {
    for(const mobile of [false,true]) {
      const page=await browser.newPage({viewport:{width:mobile?390:1200,height:900},hasTouch:mobile,isMobile:mobile});
      await setup(page);
      await page.evaluate(()=>{fixture.api.openingPress();return fixture.api.open({id:'shot_r2'},'inxshot_shot_r2.webp');});
      await page.evaluate(()=>fixture.api.wait());
      if(mobile)await page.touchscreen.tap(2,2);else await page.mouse.click(2,2);
      await page.waitForFunction(()=>!fixture.api.state().open,null,{timeout:1000});
      await page.evaluate(()=>{fixture.api.openingPress();return fixture.api.open({id:'shot_r2'},'inxshot_shot_r2.webp');});
      await page.evaluate(()=>fixture.api.wait());
      const image=await page.locator('[x-inray-history-host] img').boundingBox();
      assert.ok(image && image.height>0);
      if(mobile)await page.touchscreen.tap(image.x+image.width/2,image.y+image.height/2);
      else await page.mouse.click(image.x+image.width/2,image.y+image.height/2);
      assert.equal(await page.evaluate(()=>fixture.api.state().open),true,'image pixels keep the viewer open');
      if(mobile)await page.touchscreen.tap(2,2);else await page.mouse.click(2,2);
      await page.waitForFunction(()=>!fixture.api.state().open,null,{timeout:1000});
      assert.deepEqual(await page.evaluate(()=>fixture.errors),[]);
      await page.close();
    }
  }finally{await browser.close();}
});
