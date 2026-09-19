import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {readFileSync} from 'node:fs';
import {checkSpinnerPreview} from './check-spinner-preview.mjs';

const bundle=await build({entryPoints:['src/domain/inray-display.ts'],bundle:true,write:false,format:'esm'});
const display=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
try {
 const page=await browser.newPage();
 const scripts=[display.framedAssetDisplayRegexScript(),display.inrayDisplayRegexScript(),display.spinnerDisplayRegexScript()];
 const render=text=>scripts.reduce((s,r)=>s.replace(new RegExp(r.in,r.flag),r.out),text);
 for(const width of [320,1440]) for(const [w,h] of [[512,768],[768,512],[1024,1024]]) {
   await page.setViewportSize({width,height:900});
   const slot=`[[@inrayspinner::job_0::${w}::${h}]]`;
   const pending=render(slot),ready=render(slot+`[[@inray::ready::inxshot_ready.webp::${w}::${h}]]`);
   assert.ok(!ready.includes('[[@'),'display consumes the baked token');
   await page.setContent('<style>body{margin:0}.screen{height:850px;overflow:auto;display:flex;flex-direction:column-reverse}.message{flex:none}.pad{height:1200px}</style><div class="screen"><div class="message"><div id="slot">'+pending+'</div><p id="anchor">Reading here</p></div><div class="pad"></div></div>');
   const measure=()=>page.evaluate(()=>{const r=document.querySelector('[data-inray-spinner],.inray-clip').getBoundingClientRect();return {w:r.width,h:r.height,anchor:document.querySelector('#anchor').getBoundingClientRect().top};});
   const before=await measure();
   await page.evaluate(html=>{document.querySelector('#slot').innerHTML=html;},ready);
   assert.equal(await page.locator('[data-inray-spinner]').count(),0,'completed display has no spinner');
   assert.equal(await page.locator('.inray-shot-img').count(),1,'completed display has one baked image');
   assert.equal(await page.locator('.inray-bar').count(),1,'one action bar, never spinner+image duplicate');
   assert.equal(await page.locator('animate').count(),0,'completed pair has no running spinner animation');
   await page.evaluate(({w,h})=>{document.querySelector('.inray-shot-img').src='data:image/svg+xml,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="purple"/></svg>`);}, {w,h});
   await page.waitForFunction(()=>document.querySelector('.inray-shot-img').naturalWidth>0);
   const loaded=await measure();assert.ok(Math.abs(loaded.w-before.w)<1&&Math.abs(loaded.h-before.h)<1,'pair preserves the original frame dimensions');assert.ok(loaded.w<=width+0.5&&loaded.h<=900.5,'baked image stays inside the viewport');
   const imageRect=()=>page.locator('.inray-shot-img').evaluate(img=>{const r=img.getBoundingClientRect();return {w:r.width,h:r.height,top:r.top-img.closest('.inray-clip').getBoundingClientRect().top};});
   const expanded=await imageRect();
   await page.locator('.inray-fold-cb').evaluate(cb=>{cb.checked=true;});
   await page.locator('.inray-clip').evaluate(async node=>{await Promise.all(node.getAnimations().map(a=>a.finished));});
   const collapsed=await imageRect(),clipped=await measure();
   assert.ok(clipped.h<loaded.h,'fold clips the outer window');
   assert.ok(Math.abs(collapsed.w-expanded.w)<1&&Math.abs(collapsed.h-expanded.h)<1,'fold must not resize the image');
   assert.ok(Math.abs(collapsed.top)<1,'fold keeps the image top visible');

 }
 console.log('Spinner preview slot and spinner-free baked layout: 320px and PC, portrait/landscape/square passed.');
 const source=readFileSync('dist/omninexus.js','utf8');
 await checkSpinnerPreview(page,source,render);
 const runtime=readFileSync('tools/vendor-patches/message-runtime.js','utf8');
 for(const width of [320,1440,3440]) {
   await page.setViewportSize({width,height:900});
   await page.setContent('<div class="default-chat-screen"><div class="risu-chat" data-chat-index="0"><div class="chattext"><p>Reading anchor</p></div></div></div>');
   const result=await page.evaluate(async runtime=>{
     const t={hostDoc:document,backendSettings:{card:{}}};
     const make=new Function('t','k','H','Z','nxMsgFan','nxUnwrapSafeNodes','nxSpinnerPreviews','y',runtime+';return {mount:omniMountFooters,close:()=>{t.unloading=true;omniFooterObserver.disconnect();}};');
     const api=make(t,{createMutationObserver:async cb=>new MutationObserver(cb)},async(_d,tag,o={})=>{const n=document.createElement(tag);if(o.className)n.className=o.className;if(o.html)n.innerHTML=o.html;if(o.text)n.textContent=o.text;return n;},async()=>({characterId:'c',chatId:'chat',chat:{message:[{data:'Reading anchor',role:'char'}]}}),()=>true,async a=>Array.from(a),new Map(),()=>{});
     HTMLElement.prototype.getOuterHTML=function(){return this.outerHTML;};
     await api.mount();await api.mount();
     const footer=document.querySelector('[x-omni-edge="bottom"]'),rect=footer.getBoundingClientRect();
     const result={start:document.querySelector('.chattext').firstElementChild.matches('[x-omni-edge="top"]'),count:document.querySelectorAll('[x-omni-footer]').length,end:document.querySelector('.chattext').lastElementChild===footer,right:rect.right,width:innerWidth,position:getComputedStyle(footer).position};
     api.close();return result;
   },runtime);
   assert.equal(result.count,2);assert.equal(result.start,true);assert.equal(result.end,true);assert.equal(result.position,'relative');assert.ok(result.right<=result.width);
 }
 console.log('Message actions: chattext top and bottom, no horizontal overflow at 320/1440/3440px.');
} finally {await browser.close();}
