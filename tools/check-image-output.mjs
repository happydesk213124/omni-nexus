import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const bundle=await build({entryPoints:['src/tag-studio/mount.ts'],bundle:true,write:false,format:'iife',globalName:'Studio'});
const browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
try {
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  const errors=[];page.on('pageerror',err=>errors.push(err.message));
  await page.setContent('<html><body></body></html>');
  await page.addScriptTag({content:bundle.outputFiles[0].text});
  await page.evaluate(()=>{
    const image=(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;const ctx=c.getContext('2d');ctx.fillStyle='#7132f5';ctx.fillRect(0,0,w,h);return c.toDataURL('image/png');};
    const original=image(832,1216);window.calls=[];window.urls={root:original};
    window.__INLAY_NATIVE__={ensureImageUrl:async id=>urls[id]||'',fetch:async(path,opts)=>{
      if(path.endsWith('/nai-prompt'))return {ok:true,main_prompt:'garden',negative_prompt:'bad',model:'nai-diffusion-5-full',width:832,height:1216,characters:[],seed:1};
      if(path==='/v1/settings')return {settings:{card:{presets:[],studio_folds:{},upscale_button_mode:window.upscaleMode},nai:{}}};
      if(path.endsWith('/history'))return {cards:[{id:'root',seed:1}]};
      if(path.endsWith('/original')){calls.push({path,body:opts.body});urls.root_s0=image(832,1216);return {ok:true,card:{id:'root_s0',image_url:urls.root_s0,width:832,height:1216,seed:1}};}
      if(path.endsWith('/upscale')){calls.push({path,body:opts.body});await new Promise(r=>window.releaseUpscale=r);urls.root_s1=image(1664,2432);return {ok:true,card:{id:'root_s1',image_url:urls.root_s1,width:1664,height:2432,seed:1}};}
      return {ok:true,characters:[],global:[]};
    }};
    void Studio.openTagStudio({id:'root',session_id:'session',image_url:original});
  });
  await page.waitForFunction(()=>document.querySelector('#cv')?.width===832);
  const select=page.locator('[data-resolution-preset]:visible').first();
  await select.waitFor();
  for(const [preset,w,h] of [['Large',1024,1536],['Wallpaper',1088,1920],['Small',512,768],['Normal',832,1216]]) {
    await select.selectOption(preset);
    assert.deepEqual(await page.locator('#cv').evaluate(c=>[c.width,c.height]),[w,h]);
    if(preset==='Wallpaper')assert.equal(await page.locator('[data-size="1472x1472"]').count(),0);
  }
  await mkdir('.test-build/image-output',{recursive:true});
  for(const [width,height] of [[1440,1000],[390,844],[844,390]]){
    await page.setViewportSize({width,height});
    assert.ok(await page.locator('[data-act="upscale"]:visible').count());
    await page.screenshot({path:`.test-build/image-output/studio-${width}.png`});
  }
  await page.setViewportSize({width:1440,height:1000});
  // 🆙 버튼 방식 default: PNG 원본 받아오기, at once, with no dialog: same size, from
  // the selected revision's stored recipe (never the canvas), into the history.
  assert.equal(await page.locator('[data-act="upscale"]:visible').first().textContent(),'🆙 PNG 원본');
  await page.locator('[data-act="upscale"]:visible').first().click();
  await page.waitForFunction(()=>calls.length===1);
  assert.equal(await page.locator('#ask').isVisible(),false,'no dialog: the setting decides');
  assert.equal(await page.evaluate(()=>calls[0].path),'/v1/cards/root/original');
  assert.equal(await page.evaluate(()=>calls[0].body.history_only),true);
  assert.equal(await page.evaluate(()=>calls[0].body.source_id),'root');
  assert.equal(await page.evaluate(()=>'image_data_url' in calls[0].body),false,'the stored recipe is replayed, not the canvas');
  await page.waitForFunction(()=>document.querySelector('[data-act="upscale"]')?.textContent==='🆙 PNG 원본');
  assert.deepEqual(await page.locator('#cv').evaluate(c=>[c.width,c.height]),[832,1216]);
  // 🆙 버튼 방식 Anlas 업스케일: the paid route, guarded against a second spend.
  await page.evaluate(()=>{calls.length=0;window.upscaleMode='upscale';});
  await page.locator('#cancel').click();
  await page.evaluate(()=>{void Studio.openTagStudio({id:'root',session_id:'session',image_url:urls.root});});
  await page.waitForFunction(()=>document.querySelector('[data-act="upscale"]')?.textContent==='🆙 업스케일');
  await page.locator('[data-act="upscale"]:visible').first().click();
  await page.waitForFunction(()=>calls.length===1);
  assert.equal(await page.evaluate(()=>calls[0].path),'/v1/cards/root/upscale');
  assert.match(await page.locator('[data-act="upscale"]:visible').first().textContent(),/업스케일 중/);
  await page.locator('[data-act="upscale"]:visible').first().click();
  assert.equal(await page.evaluate(()=>calls.length),1,'repeat click cannot spend twice');
  assert.equal(await page.evaluate(()=>calls[0].body.history_only),true);
  assert.ok(await page.evaluate(()=>calls[0].body.source_id),'upscales the selected revision');
  await page.evaluate(()=>releaseUpscale());
  await page.waitForFunction(()=>document.querySelector('#cv')?.width===1664);
  assert.deepEqual(await page.locator('#cv').evaluate(c=>[c.width,c.height]),[1664,2432]);
  assert.deepEqual(errors,[]);
  console.log('ok: official presets, desktop/mobile upscale button, busy double-click guard and doubled preview');
} finally {await browser.close();}
