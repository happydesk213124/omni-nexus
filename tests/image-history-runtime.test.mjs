import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { build } from 'esbuild';
import { inrayDisplayOut } from '../.test-build/inray-display.mjs';
const runtime = readFileSync(new URL('../tools/vendor-patches/image-history-runtime.js', import.meta.url),'utf8');

test('history arrows preview, pin posts the viewed revision, and scale updates current frames', async () => {
  const browser = await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
  try {
    const page = await browser.newPage({viewport:{width:1200,height:1000}});
    await page.addScriptTag({content:readFileSync('node_modules/dompurify/dist/purify.min.js','utf8')});
    await page.evaluate(()=>{
      DOMPurify.addHook('uponSanitizeAttribute',(_n,data)=>{if(data.attrName==='class')data.attrValue=data.attrValue.split(' ').map(v=>v.startsWith('x-risu-')?v:'x-risu-'+v).join(' ');});
      DOMPurify.addHook('uponSanitizeElement',node=>{if(node.tagName==='STYLE')node.textContent=node.textContent.replace(/\.(inray-[\w-]+|omni-spinner)(?![\w-])/g,'.x-risu-$1');});
      window.risuSanitize=html=>DOMPurify.sanitize(html,{FORCE_BODY:true});
    });
    const settings = await build({entryPoints:['src/settings-ux/tab-html.ts'],bundle:true,write:false,format:'iife',globalName:'SettingsTabs'});
    await page.addScriptTag({content:settings.outputFiles[0].text});
    const historyUi = await build({entryPoints:['src/domain/gallery/history-overlay.ts'],bundle:true,write:false,format:'iife',globalName:'HistoryUi'});
    await page.addScriptTag({content:historyUi.outputFiles[0].text});
    await page.evaluate(()=>{globalThis.__INLAY_VIEWER_CORE__=HistoryUi;});
    const options = await page.evaluate(()=>{
      document.body.innerHTML=SettingsTabs.tabHtml('gen_options','',{card:{character_height:false,character_age:true}});
      const saved=[document.getElementById('nx-character-height').checked,document.getElementById('nx-character-age').checked];
      document.body.innerHTML=SettingsTabs.tabHtml('gen_options','',{card:{}});
      const defaults=[document.getElementById('nx-character-height').checked,document.getElementById('nx-character-age').checked];
      return {saved,defaults,help:{'nx-character-height':SettingsTabs.previewHelp('nx-character-height'),'nx-character-age':SettingsTabs.previewHelp('nx-character-age')}};
    });
    assert.deepEqual(options.saved,[false,true]);assert.deepEqual(options.defaults,[true,true]);
    assert.match(options.help['nx-character-height'].body,/170cm/);assert.match(options.help['nx-character-age'].body,/24 years old/);
    for (const [width,height] of [[832,1216],[1216,832],[1024,1024]]) {
      await page.evaluate(html=>{document.body.innerHTML=risuSanitize(html);},inrayDisplayOut().replaceAll('$1','shot_r2').replaceAll('$2','inxshot_shot_r2.webp').replaceAll('$3',String(width)).replaceAll('$4',String(height)));
      await page.evaluate(({runtime})=>{
        class Safe {
          constructor(node){this.node=node;}
          async querySelectorAll(s){return [...this.node.querySelectorAll(s)].map(n=>new Safe(n));}
          async querySelector(s){const n=this.node.querySelector(s);return n?new Safe(n):null;}
          async getAttribute(k){if(!k.startsWith('x-'))throw Error('Can only get x- attributes');return this.node.getAttribute(k);}
          async setAttribute(k,v){if(!k.startsWith('x-'))throw Error('Can only set x- attributes');this.node.setAttribute(k,v);}
          async getOuterHTML(){return this.node.outerHTML;}
          async setInnerHTML(v){this.node.innerHTML=risuSanitize(v);}
          async setOuterHTML(v){this.node.outerHTML=risuSanitize(v);}
          async getParent(){return this.node.parentElement?new Safe(this.node.parentElement):null;}
          async setStyle(k,v){this.node.style[k]=v;}
          async getStyleAttribute(){return this.node.getAttribute("style")||"";}
          async setStyleAttribute(v){this.node.style.cssText=v;}
        }
        const doc = new Safe(document);
        const t={hostDoc:doc,backendSettings:{card:{inline_chat_scale_pct:100}}};
        const nxUnwrapSafeNodes=async n=>n;
        const omniRelease=async()=>{};
        const ue=async()=>doc;
        const hitEl=async(el,x,y)=>{const r=el.node.getBoundingClientRect();return x>=r.left&&x<=r.right&&y>=r.top&&y<=r.bottom;};
        const nxFloatHtmlAttr=(html,name)=>new RegExp('(?:^|\\s)'+name+'=["\']([^"\']*)["\']','i').exec(html)?.[1] || '';
        const pins=[],reads=[];
        const K=async(path,opts)=>opts?.method==='POST'?(pins.push(path),{ok:true}):(reads.push(path),{cards:[{id:'shot_r2',asset_name:'inxshot_shot_r2.webp'},{id:'shot_r1',asset_name:'inxshot_shot_r1.webp'},{id:'shot',asset_name:'inxshot_shot.webp'}]});
        const Pe=(_title,error)=>{throw error;};
        const preview=id=>{const img=document.querySelector('.x-risu-inray-shot-img');return 'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="'+img.width+'" height="'+img.height+'"><title>'+id+'</title><rect width="100%" height="100%" fill="#725a91"/></svg>');};
        globalThis.__INLAY_NATIVE__={ensureImageUrl:async id=>preview(id)};
        document.querySelector('.x-risu-inray-shot-img').src=preview('shot_r2');
        eval(runtime + ';window.fixture={hover:omniHistoryHover,scale:async value=>{t.backendSettings.card.inline_chat_scale_pct=value;await omniApplyChatScale();},hit:async action=>{document.activeElement?.blur();const r=document.querySelector("[data-inray-history="+action+"]").getBoundingClientRect();return omniHistoryHit(doc,{clientX:r.x+r.width/2,clientY:r.y+r.height/2});},pins,reads};');
      },{runtime});
      const baseline = await page.locator('.x-risu-inray-clip').evaluate(n=>n.getBoundingClientRect().width);
      const parent = await page.locator('.x-risu-inray-shot').evaluate(n=>n.getBoundingClientRect().width);
      assert.ok(Math.abs(baseline-Math.min(parent,width,640,780*width/height))<2,'PC fits every orientation into 640 by 780 at 100%');
      const actualHeight=await page.locator('.x-risu-inray-clip').evaluate(n=>n.getBoundingClientRect().height);
      assert.ok(Math.abs(actualHeight-baseline*height/width)<2,'height follows intrinsic ratio without a viewport-height cap');
      await page.evaluate(()=>fixture.scale(50));
      const half=await page.locator('.x-risu-inray-clip').evaluate(n=>n.getBoundingClientRect().width);
      assert.ok(Math.abs(half-baseline/2)<2,`${width}x${height}: ${half} vs ${baseline/2}`);
      await page.evaluate(()=>fixture.scale(100));
      await page.evaluate(()=>Promise.all([fixture.scale(25),fixture.scale(75),fixture.scale(100)]));
      assert.ok(Math.abs(await page.locator('.x-risu-inray-clip').evaluate(n=>n.getBoundingClientRect().width)-baseline)<2);
      await page.mouse.move(0,0);
      await page.waitForFunction(()=>getComputedStyle(document.querySelector('[data-inray-history-dots]')).opacity==='0');
      assert.equal(await page.locator('[data-inray-history-dots]').evaluate(n=>getComputedStyle(n).opacity),'0','history count stays hidden without image hover');
      await page.locator('.x-risu-inray-clip').hover();
      await page.evaluate(()=>fixture.hover());
      await page.waitForFunction(()=>getComputedStyle(document.querySelector('[data-inray-history-dots]')).opacity==='1');
      const badge=await page.locator('[data-inray-history-dots]').evaluate(n=>{const r=n.getBoundingClientRect(),image=n.closest('[data-inray-history-host]').getBoundingClientRect(),bar=document.querySelector('[data-inray-toolbar]').getBoundingClientRect();return {top:r.top-image.top,separate:r.right<=bar.left};});
      assert.ok(Math.abs(badge.top-8)<1,'history count sits 8px below the image top');
      assert.equal(badge.separate,true,'history count must not cover the upper-right actions');
      assert.equal(await page.locator('[data-inray-history-dots] span').textContent(),'3/3','first hover loads pagination without clicking');
      await page.mouse.move(0,0);
      assert.equal(await page.evaluate(()=>fixture.hit('prev')),true);
      assert.equal(await page.locator('[data-inray-history-dots] span').textContent(),'2/3');
      assert.equal(await page.locator('[data-inray-history-dots] i').count(),3);
      assert.equal(await page.locator('[data-inray-history-dots] small').textContent(),'↻2');
      assert.equal(await page.locator('[data-inray-active="1"]').count(),1,'the active dot survives sanitizing');
      assert.equal(await page.locator('[data-inray-bake]').getAttribute('x-inray-history-current'),'shot_r1');
      assert.equal(await page.locator('[data-inray-refresh]').getAttribute('x-inray-refresh'),'shot_r1');
      assert.equal(await page.evaluate(()=>fixture.hit('pin')),true);
      assert.deepEqual(await page.evaluate(()=>fixture.pins),['/v1/cards/shot_r1/pin']);
      await page.evaluate(()=>fixture.hit('next'));
      assert.equal(await page.locator('[data-inray-bake]').getAttribute('x-inray-history-current'),'shot_r2');
      assert.equal(await page.locator('.x-risu-inray-next').getAttribute('x-inray-history-edge'),'1');
      assert.equal(await page.locator('.x-risu-inray-prev').getAttribute('x-inray-history-edge'),'0');
      assert.equal(await page.evaluate(()=>fixture.reads.length),1,'navigation reuses family metadata');
      const layout = await page.evaluate(()=>{
        const box=s=>document.querySelector(s).getBoundingClientRect();
        const clip=box('.x-risu-inray-clip'),left=box('.x-risu-inray-prev'),right=box('.x-risu-inray-next');
        return {left:left.left-clip.left,right:clip.right-right.right,diceInside:box('.x-risu-inray-refresh').top>=clip.top && box('.x-risu-inray-refresh').bottom<=clip.bottom,pinInside:box('[data-inray-history=pin]').top>=clip.top && box('[data-inray-history=pin]').bottom<=clip.bottom,fullscreenInside:box('[data-inray-fs]').top>=clip.top && box('[data-inray-fs]').bottom<=clip.bottom};
      });
      assert.deepEqual(layout,{left:0,right:0,diceInside:true,pinInside:true,fullscreenInside:true});
      await page.locator('.x-risu-inray-clip').hover();
      await page.waitForFunction(()=>getComputedStyle(document.querySelector('.x-risu-inray-prev')).opacity==='1');
      await page.screenshot({path:`.test-build/history-chat-${width}x${height}.png`});
      await page.setViewportSize({width:320,height:900});
      const available = await page.locator('.x-risu-inray-shot').evaluate(n=>n.getBoundingClientRect().width);
      assert.ok(Math.abs(await page.locator('.x-risu-inray-clip').evaluate(n=>n.getBoundingClientRect().width)-available)<2,'100% fills the mobile message width without a hidden 78% reduction');
      await page.evaluate(()=>fixture.scale(50));
      assert.ok(Math.abs(await page.locator('.x-risu-inray-clip').evaluate(n=>n.getBoundingClientRect().width)-available/2)<2,'50% uses half the mobile message width');
      await page.evaluate(()=>fixture.scale(100));
      assert.ok(Math.abs(await page.locator('.x-risu-inray-clip').evaluate(n=>n.getBoundingClientRect().width)-available)<2,'live dashboard updates return to full mobile width');
      const mobile = await page.evaluate(()=>{
        const clip=document.querySelector('.x-risu-inray-clip').getBoundingClientRect(),die=document.querySelector('.x-risu-inray-refresh').getBoundingClientRect(),pin=document.querySelector('[data-inray-history=pin]').getBoundingClientRect();
        return {inside:die.top>=clip.top && pin.top>=clip.top && die.bottom<=clip.bottom && pin.bottom<=clip.bottom,fit:die.left>=0&&pin.right<=innerWidth};
      });
      assert.deepEqual(mobile,{inside:true,fit:true});
      if(width===832) await page.screenshot({path:'.test-build/history-chat-mobile.png'});
      await page.setViewportSize({width:1200,height:1000});
    }
  } finally {await browser.close();}
});
