import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';

test('image peek releases keyboard listeners on mouse close, replacement, and Escape', async () => {
  const script = await build({entryPoints:['src/char-command/peek.ts'],bundle:true,write:false,format:'iife',globalName:'Peek'});
  const browser = await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
  try {
    const page = await browser.newPage();
    await page.setContent('<body></body>');
    await page.addScriptTag({content:script.outputFiles[0].text});
    const counts = await page.evaluate(() => {
      const listeners = new Set(), add = document.addEventListener.bind(document), remove = document.removeEventListener.bind(document);
      document.addEventListener = (type, fn, opts) => {if(type==='keydown')listeners.add(fn);return add(type,fn,opts);};
      document.removeEventListener = (type, fn, opts) => {if(type==='keydown')listeners.delete(fn);return remove(type,fn,opts);};
      for(let i=0;i<100;i++) {Peek.openImagePeek('data:image/png;base64,AA==');document.querySelector('[data-nx-peek]').click();}
      const mouse = listeners.size;
      for(let i=0;i<100;i++) Peek.openImagePeek('data:image/png;base64,AA==');
      const replacement = listeners.size;
      document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));
      const escape = listeners.size;
      Peek.openImagePeek('data:image/png;base64,AA==');Peek.closeImagePeek();
      return {mouse,replacement,escape,programmatic:listeners.size,overlays:document.querySelectorAll('[data-nx-peek]').length};
    });
    assert.deepEqual(counts,{mouse:0,replacement:1,escape:0,programmatic:0,overlays:0});
  } finally {await browser.close();}
});
