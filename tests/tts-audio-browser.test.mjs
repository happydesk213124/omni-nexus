import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';

test('native browser audio unlocks and plays after an asynchronous host callback in the Risu sandbox',async()=>{
  const built=await build({stdin:{contents:`import {TtsPlayer} from './src/providers/tts/player';window.player=new TtsPlayer();`,resolveDir:process.cwd()},bundle:true,write:false,format:'iife'});
  const browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
  try{
    const page=await browser.newPage();
    await page.route('https://tts.test/',r=>r.fulfill({contentType:'text/html',body:'<iframe sandbox="allow-scripts allow-modals allow-downloads" style="width:500px;height:300px"></iframe>'}));await page.goto('https://tts.test/');
    await page.locator('iframe').evaluate((iframe,code)=>{
      iframe.srcdoc=`<meta http-equiv="Content-Security-Policy" content="connect-src 'none'; script-src 'nonce-tts-check' 'wasm-unsafe-eval'; frame-src 'none'; object-src 'none'; style-src * 'unsafe-inline'; default-src 'none'; img-src * data: blob:; font-src * data: blob:; media-src * data: blob:; base-uri 'none';"><button id="activate">음성 재생 활성화</button><script nonce="tts-check">${code}
      window.errors=[];window.ended=0;player.onChange=(_,error)=>{if(error)errors.push(error)};player.onEnded=()=>ended++;
      const bytes=new Uint8Array(16044),view=new DataView(bytes.buffer);const ascii=(at,s)=>[...s].forEach((c,i)=>view.setUint8(at+i,c.charCodeAt(0)));
      ascii(0,'RIFF');view.setUint32(4,16036,true);ascii(8,'WAVEfmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,8000,true);view.setUint32(28,16000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);ascii(36,'data');view.setUint32(40,16000,true);
      document.getElementById('activate').onclick=()=>player.unlock().catch(e=>errors.push(String(e)));
      addEventListener('message',e=>{if(e.data==='play')void player.play('native',async()=>{await new Promise(r=>setTimeout(r,30));return bytes.buffer;});});
      <\/script>`;
    },built.outputFiles[0].text);
    const frame=page.frameLocator('iframe');await frame.locator('#activate').click();
    const sandbox=page.frames().find(f=>f!==page.mainFrame());
    await sandbox.waitForFunction(()=>player.ready);
    await page.locator('iframe').evaluate(f=>f.contentWindow.postMessage('play','*'));
    await sandbox.waitForFunction(()=>player.status==='playing'&&player.progress.current>0);
    assert.equal(await sandbox.evaluate(()=>player.key),'native');
    await sandbox.waitForFunction(()=>ended===1);
    assert.equal(await sandbox.evaluate(()=>player.status),'idle');
    assert.deepEqual(await sandbox.evaluate(()=>errors),[]);
  }finally{await browser.close();}
});
