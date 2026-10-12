import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';

test('restricted SafeDOM host binds module buttons, honors five slots, stop interlock and cross-message cache',async()=>{
  const built=await build({stdin:{contents:`import {installTtsHost} from './src/tts-ui/host-chat';import {omniTts} from './src/services/tts-runtime';import {loadTtsData,ttsData,updateTtsSettings} from './src/storage/tts-store';Object.assign(window,{installTtsHost,omniTts,loadTtsData,ttsData,updateTtsSettings});`,resolveDir:process.cwd()},bundle:true,write:false,format:'iife'});
  const browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
  try {
    const page=await browser.newPage(),errors=[];page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));
    await page.route('https://tts.test/',r=>r.fulfill({contentType:'text/html',body:'<body></body>'}));await page.goto('https://tts.test/');
    await page.evaluate(()=>{
      const saved=new Map(),local=new Map();window.requests=[];window.pending=[];window.played=[];window.apiEvents=[];let active=0;window.peak=0;
      class Safe {
        constructor(node){this.node=node;this.listeners=new Map();}
        async querySelector(s){const n=this.node.querySelector(s);return n?new Safe(n):null;}
        async querySelectorAll(s){return [...this.node.querySelectorAll(s)].map(n=>new Safe(n));}
        async getParent(){return this.node.parentElement?new Safe(this.node.parentElement):null;}
        async matches(s){return this.node.nodeType===1&&this.node.matches(s);}
        async getAttribute(k){if(!k.startsWith('x-'))throw Error('Forbidden attribute read '+k);return this.node.getAttribute(k);}
        async setAttribute(k,v){if(!k.startsWith('x-'))throw Error('Forbidden attribute write '+k);this.node.setAttribute(k,v);}
        async setTextContent(v){this.node.textContent=v;}
        async setInnerHTML(v){this.node.innerHTML=v;}
        async setStyle(k,v){this.node.style[k]=v;}
        async setStyleAttribute(v){this.node.style.cssText=v;}
        async appendChild(child){this.node.append(child.node);}
        async clientHeight(){return this.node.clientHeight;}
        async clientWidth(){return this.node.clientWidth;}
        async getBoundingClientRect(){return this.node.getBoundingClientRect().toJSON();}
        async addEventListener(type,fn,options){if(!['click','pointerenter','pointerdown','keydown','scroll'].includes(type))throw Error('Unsupported host event '+type);const id=crypto.randomUUID();const cb=e=>fn({clientX:e.clientX,key:e.key});this.listeners.set(id,[type,cb,options]);this.node.addEventListener(type,cb,options);window.apiEvents.push(type);return id;}
        async removeEventListener(type,id){const x=this.listeners.get(id);if(x){this.node.removeEventListener(type,x[1],x[2]);this.listeners.delete(id);}}
        async createElement(tag){if(!['div','button'].includes(tag))throw Error('Unsupported host element '+tag);return new Safe(document.createElement(tag));}
      }
      const messages=Array.from({length:7},(_,i)=>({role:'char',chatId:'m'+i,data:`하린 (happy): "대사 ${i}."`}));messages.push({...messages[0],chatId:'duplicate'});
      document.body.innerHTML=messages.map((m,i)=>`<div x-omnitts-message="${i}" x-omnitts-line="1" style="height:50px"><span>${m.data}</span><button data-omnitts-play="1" x-omnitts-play="1">▶</button></div>`).join('');
      window.risuai={pluginStorage:{getItem:async k=>saved.get(k),setItem:async(k,v)=>saved.set(k,v)},getLocalPluginStorage:async()=>({getItem:async k=>local.get(k),setItem:async(k,v)=>local.set(k,v),removeItem:async k=>local.delete(k)}),getDatabase:async()=>({modules:[],enabledModules:[]}),setDatabase:async()=>{},requestPluginPermission:async()=>true,getRootDocument:async()=>new Safe(document),unwarpSafeArray:async a=>a,
        createMutationObserver:async fn=>({observe:async(target,options)=>new MutationObserver(rows=>fn(rows.map(row=>({getTarget:async()=>new Safe(row.target)})))).observe(target.node,options)}),addRisuChatListener:async(_mode,fn)=>window.output=fn,
        getCharacter:async()=>({chaId:'c',chatPage:0,chats:[{id:'chat',message:messages}]}),
        nativeFetch:async(_url,options)=>{window.requests.push(JSON.parse(options.body));active++;window.peak=Math.max(window.peak,active);return new Promise(resolve=>window.pending.push(()=>{active--;resolve({ok:true,arrayBuffer:async()=>new Uint8Array(32).buffer});}));}};
      window.Audio=class{src='';currentTime=0;duration=1;async play(){window.played.push(this.src);}pause(){}load(){}removeAttribute(){this.src='';}};
      window.AudioContext=class{state='running';destination={};async resume(){}createGain(){return {gain:{value:1},connect(){return this;}};}createMediaElementSource(){return {connect(node){return node;}};}};
    });
    await page.addScriptTag({content:built.outputFiles[0].text});
    await page.evaluate(async()=>{await window.loadTtsData();const d=window.ttsData();d.settings.enabled=true;d.settings.autoAssign=false;d.settings.fish.key='test-key';d.settings.continuous=false;d.characters=[{id:'h',scope:'global',name:'하린',surname:'',givenName:'하린',surnameAliases:[],givenAliases:[],triggers:['하린'],tags:[],gender:'female',voiceKey:d.voices[0].key,fishId:d.voices[0].fishId,fixed:false,gain:0}];await window.installTtsHost();await window.omniTts.player.unlock();window.played=[];});
    await page.waitForFunction(()=>window.requests.length===5,undefined,{timeout:12000});
    await page.locator('[x-omnitts-play]').nth(0).click();await page.locator('[x-omnitts-play]').nth(1).click();
    await page.evaluate(()=>window.omniTts.stop());
    await page.evaluate(()=>{window.pending.splice(0).forEach(resolve=>resolve());});
    await page.waitForFunction(()=>window.requests.length>=7,undefined,{timeout:12000});
    await page.evaluate(()=>window.pending.splice(0).forEach(resolve=>resolve()));
    await page.waitForFunction(()=>window.omniTts.queue.status.active===0,undefined,{timeout:12000});
    assert.equal(await page.evaluate(()=>window.peak),5);assert.deepEqual(await page.evaluate(()=>window.played),[]);
    const before=await page.evaluate(()=>window.requests.length);
    await page.locator('[x-omnitts-play]').nth(7).click();await page.waitForFunction(()=>window.played.length===1,undefined,{timeout:12000});
    assert.equal(await page.evaluate(()=>window.requests.length),before);
    assert.equal(await page.evaluate(()=>window.requests.every(r=>r.text.startsWith('[happy]')&&r.reference_id&&r.prosody.speed===1)),true);
    const independent = await page.evaluate(async()=>{
      const runtime=window.omniTts, normal=runtime.current, old=runtime.reservePlayback();
      await runtime.play([normal],0,runtime.reservePlayback());
      await runtime.play([{...normal,messageId:'old-click',segment:{...normal.segment,text:'늦게 읽은 삽화'}}],0,old);
      const latest=runtime.current.messageId;
      await runtime.play([{...normal,messageId:'illustration',segment:{...normal.segment,kind:'illustration'}}],0);
      return {latest,normal:normal.messageId,list:runtime.list.map(r=>r.segment.kind),current:runtime.current.segment.kind};
    });
    assert.equal(independent.latest,independent.normal,'late metadata lookup cannot replace a newer click');
    assert.equal(independent.current,'illustration');assert.ok(independent.list.every(k=>k!=='illustration'),'illustration stays out of the message playlist');
    assert.equal(await page.evaluate(()=>window.requests.length),before);
    await page.locator('[x-tts-control="minimize"]').click();
    await page.waitForFunction(()=>window.ttsData().settings.minimized);
    assert.equal(await page.locator('[x-omnitts-viewer] button').count(),1);
    await page.locator('[x-tts-control="minimize"]').click();
    await page.waitForFunction(()=>!window.ttsData().settings.minimized);
    await page.evaluate(()=>window.updateTtsSettings({enabled:false}));await page.waitForFunction(()=>document.querySelector('[x-omnitts-viewer]').style.display==='none',undefined,{timeout:12000});
    assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});
