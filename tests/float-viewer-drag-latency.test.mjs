import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {chromium} from 'playwright';

const source=readFileSync(new URL('../tools/vendor-patches/float-viewer-drag.js',import.meta.url),'utf8');

async function setup(page,runtime=source) {
  await page.setContent('<div id="viewer" style="position:fixed;left:10px;top:10px;width:240px;height:320px"></div>');
  await page.evaluate(async runtime=>{
    const frame=document.createElement('iframe');frame.style.display='none';
    document.body.append(frame);
    const viewer=document.querySelector('#viewer'),acks=[];
    window.fixture={acks,writes:[],saved:[],finished:false};
    window.addEventListener('message',event=>{
      if(event.source!==frame.contentWindow)return;
      const message=event.data;
      if(message.type==='style') {
        viewer.style[message.key]=message.value;
        fixture.writes.push(message.value);
        acks.push(()=>frame.contentWindow.postMessage({type:'ack',id:message.id},'*'));
      } else if(message.type==='commit') {
        viewer.style.cssText=`position:fixed;left:${message.geo.left}px;top:${message.geo.top}px;width:240px;height:320px`;
        fixture.finished=true;
      } else if(message.type==='save')fixture.saved.push(message.geo);
    });
    const prefix=`
      let nxFloatGeo={left:10,top:10,w:240,h:320},nxFloatIconGeo=null;
      let nxFloatDrag={kind:'move',sx:10,sy:10,left:10,top:10,w:240,h:320,geo:nxFloatGeo,visibleW:240,visibleH:320,moved:false,pos:{x:10,y:10}};
      let serial=0;const pending=new Map();
      const nxFloatRoot={setStyle:(key,value)=>new Promise(resolve=>{const id=++serial;pending.set(id,resolve);parent.postMessage({type:'style',id,key,value},'*');})};
      const nxFloatViewport=()=>({w:2000,h:2000}),nxFloatLog=()=>{},nxFloatStyleCache=new WeakMap();
      const nxFloatApply=async()=>parent.postMessage({type:'commit',geo:nxFloatGeo},'*');
      const qt=async geo=>parent.postMessage({type:'save',geo},'*');
      const nxFloatDirty=false,nxFloatArmIdle=()=>{};
      let nxFloatIdleTimer=0;
    `;
    frame.contentWindow.Function(prefix+runtime+`
      window.addEventListener('message',event=>{
        const m=event.data;
        if(m.type==='ack'){pending.get(m.id)?.();pending.delete(m.id);}
        if(m.type==='move')nxFloatMoveDrag({clientX:m.x,clientY:m.y});
        if(m.type==='end')void nxFloatEndDrag();
      });
      window.requestAnimationFrame=()=>{throw Error('hidden iframe cannot provide animation frames');};
    `)();
    fixture.move=(x,y)=>frame.contentWindow.postMessage({type:'move',x,y},'*');
    fixture.end=()=>frame.contentWindow.postMessage({type:'end'},'*');
    fixture.release=()=>{for(const ack of acks.splice(0))ack();};
  },runtime);
}

async function verifyUnblockedMovement(page,runtime=source) {
  await setup(page,runtime);
  await page.evaluate(()=>{for(let i=1;i<=10;i++)fixture.move(10+i*5,10+i*3);});
  // Host writes happen before their responses return to the hidden plugin.
  // Holding those responses isolates bridge waiting from machine performance.
  await page.waitForFunction(()=>fixture.writes.length>0);
  await page.waitForFunction(()=>new DOMMatrix(document.querySelector('#viewer').style.transform).m41===50,null,{timeout:1000});
  assert.equal(await page.evaluate(()=>fixture.acks.length),10,'coordinates must continue reaching the host without waiting for acknowledgements');
  await page.evaluate(()=>fixture.end());
  assert.equal(await page.evaluate(()=>fixture.finished),false,'final geometry must wait until outstanding transforms finish');
  await page.evaluate(()=>{fixture.move(1000,1000);fixture.end();});
  await page.evaluate(()=>fixture.release());
  await page.waitForFunction(()=>fixture.finished && fixture.saved.length===1);
  assert.deepEqual(await page.evaluate(()=>fixture.saved[0]),{left:60,top:40,w:240,h:320});
  assert.equal(await page.locator('#viewer').evaluate(n=>n.style.transform),'','committing geometry must clear the temporary transform');
}

test('hidden-iframe drag continues while bridge acknowledgements are delayed',async()=>{
  const browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
  try {
    const page=await browser.newPage();await verifyUnblockedMovement(page);await page.close();
    const serial=source.replace('nxFloatMoveWrites.size<16','nxFloatMoveWrites.size<1');
    assert.notEqual(serial,source);
    const broken=await browser.newPage();
    await assert.rejects(()=>verifyUnblockedMovement(broken,serial),/Timeout 1000ms exceeded/);
    await broken.close();
  } finally {await browser.close();}
});

test('a stalled bridge has bounded drag writes and resumes at the latest coordinates',async()=>{
  const browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
  try {
    const page=await browser.newPage();await setup(page);
    await page.evaluate(()=>{for(let i=1;i<=100;i++)fixture.move(10+i*5,10+i*3);fixture.end();});
    await page.waitForFunction(()=>fixture.writes.length===16,null,{timeout:1000});
    await page.evaluate(()=>fixture.release());
    await page.waitForFunction(()=>new DOMMatrix(document.querySelector('#viewer').style.transform).m41===500);
    assert.equal(await page.evaluate(()=>fixture.writes.length),17,'intermediate positions beyond the bridge budget must coalesce into one latest position');
    await page.evaluate(()=>fixture.release());
    await page.waitForFunction(()=>fixture.finished && fixture.saved.length===1);
    assert.deepEqual(await page.evaluate(()=>fixture.saved[0]),{left:510,top:310,w:240,h:320});
  } finally {await browser.close();}
});
