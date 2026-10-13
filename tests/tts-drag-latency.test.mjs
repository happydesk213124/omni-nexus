import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from 'playwright';

const built=await build({stdin:{contents:"import {bindTtsDrag} from './src/tts-ui/host-drag';import {loadTtsData,ttsData} from './src/storage/tts-store';Object.assign(window,{bindTtsDrag,loadTtsData,ttsData});",resolveDir:process.cwd()},bundle:true,write:false,format:'iife'});
const runtime=built.outputFiles[0].text;

async function setup(page,code=runtime){
  page.setDefaultTimeout(8000);page.on('pageerror',e=>console.error(e.message));
  await page.route('https://tts-drag.test/',r=>r.fulfill({contentType:'text/html',body:'<body></body>'}));await page.goto('https://tts-drag.test/');
  await page.setContent('<div id="viewer" style="position:fixed;left:10px;top:10px;width:240px;height:100px"></div>');
  await page.evaluate(async code=>{
    const frame=document.createElement('iframe');frame.style.display='none';document.body.append(frame);
    window.fixture={writes:[],acks:[],saved:[],finished:false};
    const viewer=document.getElementById('viewer');
    window.addEventListener('message',event=>{
      if(event.source!==frame.contentWindow)return;
      const m=event.data;
      if(m.type==='style'){
        viewer.style[m.key]=m.value;
        const ack=()=>frame.contentWindow.postMessage({type:'ack',id:m.id},'*');
        if(m.value){fixture.writes.push(m.value);fixture.acks.push(ack);}else ack();
      }else if(m.type==='commit'){
        fixture.saved.push(m.anchor);viewer.style.cssText=`position:fixed;left:${2000-m.anchor.right-240}px;top:${m.anchor.top}px;width:240px;height:100px`;fixture.finished=true;
      }else if(m.type==='ready')fixture.ready=true;
      else if(m.type==='started')fixture.started=true;
    });
    frame.contentWindow.Function(code+`
      window.requestAnimationFrame=()=>{throw Error('hidden plugin cannot rely on animation frames');};
      window.risuai={pluginStorage:{getItem:async()=>null,setItem:async()=>{}}};
      const events=new Map(),pending=new Map();let serial=0;
      const rect={left:10,top:10,width:240,height:100,right:250,bottom:110};
      const header={getBoundingClientRect:async()=>({...rect,height:40,bottom:50}),querySelectorAll:async()=>[]};
      const viewer={querySelector:async()=>header,getBoundingClientRect:async()=>rect,setStyle:(key,value)=>new Promise(resolve=>{const id=++serial;pending.set(id,resolve);parent.postMessage({type:'style',id,key,value},'*');})};
      const doc={clientWidth:async()=>2000,clientHeight:async()=>2000,addEventListener:async(type,fn)=>{events.set(type,fn);return type;},removeEventListener:async()=>{}};
      window.addEventListener('message',event=>{
        const m=event.data;
        if(m.type==='ack'){pending.get(m.id)?.();pending.delete(m.id);}
        else if(m.type==='down'){events.get('pointerdown')({clientX:15,clientY:15,button:0});Promise.resolve().then(async()=>{for(let i=0;i<100;i++){if(window.drag.busy)break;await Promise.resolve();}parent.postMessage({type:'started'},'*');});}
        else if(m.type==='move')events.get('pointermove')({clientX:m.x,clientY:m.y});
        else if(m.type==='end')events.get('pointerup')({clientX:m.x,clientY:m.y});
      });
      (async()=>{await loadTtsData();window.drag=await bindTtsDrag(doc,viewer,()=>true,async()=>parent.postMessage({type:'commit',anchor:ttsData().settings.viewerAnchor},'*'));parent.postMessage({type:'ready'},'*');})();
    `)();
    fixture.send=m=>frame.contentWindow.postMessage(m,'*');
    fixture.release=()=>fixture.acks.splice(0).forEach(ack=>ack());
  },code);
  await page.waitForFunction(()=>fixture.ready);
  await page.evaluate(()=>fixture.send({type:'down'}));
  await page.waitForFunction(()=>fixture.started);
}

async function smooth(page,code){
  await setup(page,code);
  await page.evaluate(()=>{for(let i=1;i<=10;i++)fixture.send({type:'move',x:15+i*5,y:15+i*3});});
  await page.waitForFunction(()=>new DOMMatrix(document.getElementById('viewer').style.transform).m41===50,null,{timeout:1500});
  assert.equal(await page.evaluate(()=>fixture.writes.length),10,'host movement continues while every acknowledgement is held');
  await page.evaluate(()=>{fixture.send({type:'end',x:65,y:45});fixture.release();});
  await page.waitForFunction(()=>fixture.acks.length>0||fixture.finished);
  await page.evaluate(()=>fixture.release());
  await page.waitForFunction(()=>fixture.finished);
}

test('TTS hidden-iframe drag matches image-viewer response latency behavior and rejects a serial bridge',async()=>{
  const browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
  try{
    const page=await browser.newPage();await smooth(page,runtime);await page.close();
    const serial=runtime.replace('writes.size >= 16','writes.size >= 1');assert.notEqual(serial,runtime);
    const broken=await browser.newPage();await assert.rejects(()=>smooth(broken,serial),/Timeout 1500ms exceeded/);await broken.close();
    const stalled=await browser.newPage();await setup(stalled);
    await stalled.evaluate(()=>{for(let i=1;i<=100;i++)fixture.send({type:'move',x:15+i*5,y:15+i*3});fixture.send({type:'end',x:515,y:315});});
    await stalled.waitForFunction(()=>fixture.writes.length===16);
    assert.equal(await stalled.evaluate(()=>fixture.finished),false);
    await stalled.evaluate(()=>fixture.release());
    await stalled.waitForFunction(()=>new DOMMatrix(document.getElementById('viewer').style.transform).m41===500);
    assert.equal(await stalled.evaluate(()=>fixture.writes.length),17,'stalled intermediate coordinates coalesce into the latest position');
    await stalled.evaluate(()=>fixture.release());await stalled.waitForFunction(()=>fixture.finished);
    assert.deepEqual(await stalled.evaluate(()=>fixture.saved[0]),{right:1250,top:310});
  }finally{await browser.close();}
});
