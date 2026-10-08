import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {build} from 'esbuild';
import {chromium} from 'playwright';

const runtime=readFileSync('tools/vendor-patches/image-history-runtime.js','utf8');
const ui=await build({entryPoints:['src/domain/inray-display.ts'],bundle:true,write:false,format:'iife',globalName:'ImageUi'});
const history=await build({entryPoints:['src/domain/gallery/history-overlay.ts'],bundle:true,write:false,format:'iife',globalName:'HistoryUi'});

test('mobile image tap reveals controls, hidden actions cannot fire, and sticky hover/focus cannot prevent hiding',async()=>{
  const browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
  try {
    for(const [width,height] of [[832,1216],[1216,832],[1024,1024]]) {
      const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
      await page.addScriptTag({content:readFileSync('node_modules/dompurify/dist/purify.min.js','utf8')});
      await page.evaluate(()=>{
        DOMPurify.addHook('uponSanitizeAttribute',(_n,data)=>{if(data.attrName==='class')data.attrValue=data.attrValue.split(' ').map(v=>'x-risu-'+v).join(' ');});
        DOMPurify.addHook('uponSanitizeElement',node=>{if(node.tagName==='STYLE')node.textContent=node.textContent.replace(/\.(inray-[\w-]+)(?![\w-])/g,'.x-risu-$1');});
      });
      await page.addScriptTag({content:ui.outputFiles[0].text});await page.addScriptTag({content:history.outputFiles[0].text});
      await page.evaluate(({width,height})=>{
        const image='data:image/svg+xml,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"/>`);
        const html=ImageUi.inrayDisplayOut().replaceAll('$1','shot_r1').replaceAll('$2','inxshot_shot_r1.webp').replaceAll('$3',width).replaceAll('$4',height).replace('{{raw::inxshot_shot_r1.webp}}',image);
        document.body.innerHTML=DOMPurify.sanitize(html,{FORCE_BODY:true});
      },{width:String(width),height:String(height)});
      // Test the touch deadline with the virtual clock; CSS transitions use
      // the browser's separate animation clock and are covered by desktop tests.
      await page.addStyleTag({content:'*{transition-duration:0s!important}'});
      await page.clock.install();await page.clock.pauseAt(new Date(Date.now()+1000));
      await page.evaluate(runtime=>{
        class Safe {
          constructor(node){this.node=node;}
          async querySelectorAll(s){return [...this.node.querySelectorAll(s)].map(n=>new Safe(n));}
          async querySelector(s){const n=this.node.querySelector(s);return n?new Safe(n):null;}
          async getParent(){return this.node.parentElement?new Safe(this.node.parentElement):null;}
          async getAttribute(k){if(!k.startsWith('x-'))throw Error('unsafe attribute');return this.node.getAttribute(k);}
          async setAttribute(k,v){if(!k.startsWith('x-'))throw Error('unsafe attribute');this.node.setAttribute(k,v);}
          async getOuterHTML(){return this.node.outerHTML;}
          async setInnerHTML(v){this.node.innerHTML=v;}
          async setOuterHTML(v){this.node.outerHTML=v;}
          async setStyle(k,v){this.node.style[k]=v;}
        }
        const doc=new Safe(document),t={hostDoc:doc},actions=[],errors=[];
        const nxUnwrapSafeNodes=async nodes=>nodes,omniRelease=async()=>{},ue=async()=>doc;
        const hitEl=async(el,x,y)=>{const r=el.node.getBoundingClientRect();return r.width>0&&r.height>0&&x>=r.left&&x<=r.right&&y>=r.top&&y<=r.bottom;};
        const nxFloatHtmlAttr=(html,name)=>new RegExp('(?:^|\\s)'+name+'=["\']([^"\']*)["\']','i').exec(html)?.[1]||'';
        const y=(...args)=>errors.push(args),Pe=y;
        const K=async(path,opts)=>opts?.method==='POST'?(actions.push(path),{ok:true}):{cards:[{id:'shot_r1'},{id:'shot'}]};
        globalThis.__INLAY_VIEWER_CORE__=HistoryUi;
        eval(runtime+`;window.fixture={touch:omniHistoryTouch,hide:omniHistoryTouchHide,wait:()=>omniTouchWork,actions,errors,imageTaps:0};
          document.addEventListener('pointerdown',async event=>{
            if(await omniHistoryTouch({clientX:event.clientX,clientY:event.clientY}))return;
            if(await omniHistoryHit(doc,event))return;
            const button=document.querySelector('[data-inray-refresh]');
            if(await hitEl(new Safe(button),event.clientX,event.clientY))actions.push('reroll');
            else fixture.imageTaps++;
          });`);
      },runtime);
      const opacity=()=>page.locator('[data-inray-toolbar]').evaluate(n=>getComputedStyle(n).opacity);
      assert.equal(await opacity(),'0','mobile controls must start hidden');
      const dice=await page.locator('[data-inray-refresh]').boundingBox();
      await page.touchscreen.tap(dice.x+dice.width/2,dice.y+dice.height/2);
      await page.evaluate(()=>fixture.wait());await page.clock.runFor(200);
      assert.equal(await opacity(),'1');
      assert.deepEqual(await page.evaluate(()=>fixture.actions),[],'first tap only reveals the hidden reroll button');
      assert.equal(await page.locator('[data-inray-history-dots] span').textContent(),'2/2','touch loads image counts without requiring hover');
      const pin=await page.locator('[data-inray-history="pin"]').boundingBox();
      await page.touchscreen.tap(pin.x+pin.width/2,pin.y+pin.height/2);
      await page.evaluate(()=>fixture.wait());
      assert.deepEqual(await page.evaluate(()=>fixture.actions),['/v1/cards/shot_r1/pin']);
      await page.clock.runFor(2300);
      assert.equal(await opacity(),'0','persistent native hover/focus cannot keep mobile chrome visible');
      assert.equal(await page.locator('[data-inray-history-dots]').evaluate(n=>getComputedStyle(n).opacity),'0');
      assert.equal(await page.locator('[data-inray-history="prev"]').evaluate(n=>getComputedStyle(n).pointerEvents),'none','invisible arrows cannot intercept taps');
      await page.touchscreen.tap(pin.x+pin.width/2,pin.y+pin.height/2);
      await page.evaluate(()=>fixture.wait());await page.clock.runFor(200);
      assert.equal(await opacity(),'1');
      assert.deepEqual(await page.evaluate(()=>fixture.actions),['/v1/cards/shot_r1/pin'],'expired controls need a new reveal tap');
      await page.evaluate(()=>fixture.hide());await page.clock.runFor(2300);
      assert.equal(await opacity(),'0');
      const image=await page.locator('[data-inray-history-host] img').boundingBox();
      await page.touchscreen.tap(image.x+image.width/2,image.y+image.height/2);
      await page.evaluate(()=>fixture.wait());
      assert.equal(await page.evaluate(()=>fixture.imageTaps),1,'the reveal tap on image pixels must remain available to fullscreen gestures');
      assert.deepEqual(await page.evaluate(()=>fixture.errors),[]);
      await page.close();
    }
  }finally{await browser.close();}
});

test('mobile fullscreen count follows image taps and expires without pointer movement',async()=>{
  const browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
  try {
    const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
    await page.addScriptTag({content:history.outputFiles[0].text});
    await page.evaluate(()=>{
      document.body.innerHTML=`<style>${HistoryUi.imageHistoryCss()}*{transition-duration:0s!important}</style><div x-inray-history-host="1" style="position:fixed;left:30px;top:30px;width:300px;height:400px"><img style="width:300px;height:400px" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E">${HistoryUi.imageHistoryControls(true,false)}</div>`;
    });
    await page.clock.install();await page.clock.pauseAt(new Date(Date.now()+1000));
    await page.evaluate(runtime=>{
      class Safe {
        constructor(node){this.node=node;}
        async querySelector(s){const n=this.node.querySelector(s);return n?new Safe(n):null;}
        async getBoundingClientRect(){return this.node.getBoundingClientRect();}
        async setStyleAttribute(v){this.node.style.cssText=v;}
        async setStyle(k,v){this.node.style[k]=v;}
        async setAttribute(k,v){if(!k.startsWith('x-'))throw Error('unsafe attribute');this.node.setAttribute(k,v);}
      }
      const fullscreen=document.querySelector('[x-inray-history-host]'),dots=document.querySelector('[data-inray-history-dots]');
      dots.innerHTML=HistoryUi.imageHistoryIndicators(3,2);
      const t={_inspectGen:1},nxInspectSurface={fullscreen:new Safe(fullscreen)};
      const nxInspectShell={historyLayer:new Safe(document.querySelector('[data-inray-history-layer]')),historyChrome:[new Safe(dots)]};
      let inspectOpen=true,nxInspectPaint=Promise.resolve();
      const omniRelease=async()=>{},y=()=>{};
      eval(runtime+`;window.fixture={touch:omniInspectHistoryTouch,taps:0};
        fullscreen.addEventListener('click',async event=>{if(await omniInspectHistoryTouch(event))fixture.taps++;});`);
    },runtime);
    const opacity=()=>page.locator('[data-inray-history-dots]').evaluate(n=>getComputedStyle(n).opacity);
    assert.equal(await opacity(),'0');
    await page.touchscreen.tap(180,200);
    await page.waitForFunction(()=>fixture.taps===1);
    assert.equal(await opacity(),'1');
    await page.clock.runFor(2300);
    assert.equal(await opacity(),'0','fullscreen has no permanent touch-hover fallback');
    await page.touchscreen.tap(180,200);
    await page.waitForFunction(()=>fixture.taps===2);
    assert.equal(await opacity(),'1');
    assert.equal(await page.locator('[data-inray-history="prev"]').count(),0,'touch does not restore the removed fullscreen navigation');
  }finally{await browser.close();}
});
