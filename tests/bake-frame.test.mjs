import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from 'playwright';
const bundle=await build({entryPoints:['src/domain/inray-display.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const api=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));

test('final unloaded image reserves the same frame as its single-div spinner',async()=>{
 const browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
 try {
  const page=await browser.newPage();
  await page.route('**/unloaded.webp',route=>route.abort());
  for(const viewport of [375,1440]) for(const [width,height] of [[512,768],[768,512],[1024,1024],[2048,4096]]) for(const scale of [25,100,200]) {
   await page.setViewportSize({width:viewport,height:900});
   const spinner=api.spinnerDisplayRegexScript(scale);
   const pending=`[[@inrayspinner::job_0::${width}::${height}]]`.replace(new RegExp(spinner.in,'g'),spinner.out);
   assert.equal((pending.match(/<div\b/g)||[]).length,1);
   const final=`[[@inray::card::inxshot_card.webp::${width}::${height}]]`.replace(new RegExp(api.INRAY_DISPLAY_IN,'g'),api.inrayDisplayOut(false,scale)).replace('{{raw::inxshot_card.webp}}','https://test.invalid/unloaded.webp');
   await page.setContent(pending+final);
   const result=await page.evaluate(()=>{
    const rect=selector=>{const el=document.querySelector(selector),r=el.getBoundingClientRect();return {width:r.width,height:r.height,radius:getComputedStyle(el).borderRadius};};
    return {pending:rect('.omni-spinner'),final:rect('.inray-clip'),natural:document.querySelector('img').naturalWidth};
   });
   assert.equal(result.natural,0);
   assert.ok(Math.abs(result.pending.width-result.final.width)<1,JSON.stringify({viewport,width,height,scale,result}));
   assert.ok(Math.abs(result.pending.height-result.final.height)<1,JSON.stringify({viewport,width,height,scale,result}));
   assert.equal(result.final.radius,'10px');
  }
  // Negative control: removing reservation must be observable before image load.
  await page.setContent('[[@inray::card::inxshot_card.webp::512::768]]'.replace(new RegExp(api.INRAY_DISPLAY_IN,'g'),api.inrayDisplayOut()));
  const reservation=await page.locator('.inray-clip').evaluate(el=>{
   const before=el.getBoundingClientRect().height;
   el.style.aspectRatio='auto';
   el.querySelector('.inray-image-plane').style.aspectRatio='auto';
   const img=el.querySelector('img');
   img.removeAttribute('width');img.removeAttribute('height');img.removeAttribute('src');
   return {before,after:el.getBoundingClientRect().height};
  });
  assert.ok(reservation.before>reservation.after+100,'guard detects a broken pre-load reservation');
  const legacy='[[@inray::old::inxshot_old.webp]]'.replace(new RegExp(api.INRAY_DISPLAY_IN,'g'),api.inrayDisplayOut());
  assert.ok(legacy.includes('{{raw::inxshot_old.webp}}'));
  assert.ok(!legacy.includes('@inray::'));
  await page.setContent('[[@inray::card::inxshot_card.webp::832::1216]]'.replace(new RegExp(api.INRAY_DISPLAY_IN,'g'),api.inrayDisplayOut(true)));
  const folded=await page.locator('.inray-clip').evaluate(el=>el.getBoundingClientRect().height);
  assert.ok(folded<=73,'initial folded state still caps the reserved frame');
 } finally {await browser.close();}
});
