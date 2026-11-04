import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {readFileSync} from 'node:fs';
import {chromium} from 'playwright';

// The TTS window hears whether the chat screen is up from the one check it shares (chat-screen-watch.ts), and only
// while TTS is on. It looked for the screen itself once a second before, TTS on or off: two calls and a release.
test('SafeDOM: with TTS off the TTS window asks Risu nothing; on, its check is one call a second, the chat screen kept until it is gone',async()=>{
  const built=await build({stdin:{contents:`import {installTtsHost} from './src/tts-ui/host-chat';import {loadTtsData,ttsData,updateTtsSettings} from './src/storage/tts-store';Object.assign(window,{installTtsHost,loadTtsData,ttsData,updateTtsSettings});`,resolveDir:process.cwd()},bundle:true,write:false,format:'iife'});
  const browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
  try {
    const page=await browser.newPage(),errors=[];page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));
    await page.route('https://tts.test/',r=>r.fulfill({contentType:'text/html',body:'<body></body>'}));await page.goto('https://tts.test/');
    await page.addScriptTag({content:readFileSync('node_modules/dompurify/dist/purify.min.js','utf8')});
    const blockedSource=readFileSync('tools/vendor-patches/float-viewer.js','utf8').match(/globalThis\.__OMNI_TTS_HOST_BLOCKED__ = (.*);/)[1];
    await page.evaluate(blockedSource=>{
      window.__OMNI_TTS_HOST_BLOCKED__=new Function('t','return '+blockedSource)({});
      const saved=new Map([['omnisound.data','{}']]),local=new Map(),hostUUID=crypto.randomUUID.bind(crypto);
      // Only the chat screen check is counted (the chat scans read the screen too, on their own schedule).
      window.screenCalls={lookups:0,sizes:0};
      const theCheck=()=>/lookAtChatScreen/.test(new Error().stack);
      class Safe {
        constructor(node){this.node=node;this.listeners=new Map();}
        async querySelector(s){if(s==='.default-chat-screen'&&theCheck())window.screenCalls.lookups++;const n=this.node.querySelector(s);return n?new Safe(n):null;}
        async querySelectorAll(s){return [...this.node.querySelectorAll(s)].map(n=>new Safe(n));}
        async getParent(){return this.node.parentElement?new Safe(this.node.parentElement):null;}
        async matches(s){return this.node.nodeType===1&&this.node.matches(s);}
        async getAttribute(k){if(!k.startsWith('x-'))throw Error('Forbidden attribute read '+k);return this.node.getAttribute(k);}
        async setAttribute(k,v){if(!k.startsWith('x-'))throw Error('Forbidden attribute write '+k);this.node.setAttribute(k,v);}
        async setTextContent(v){this.node.textContent=v;}
        async getOuterHTML(){return this.node.outerHTML;}
        async setInnerHTML(v){this.node.innerHTML=DOMPurify.sanitize(v);}
        async setStyle(k,v){this.node.style[k]=v;}
        async setStyleAttribute(v){this.node.style.cssText=v;}
        async appendChild(child){this.node.append(child.node);}
        async remove(){this.node.remove();}
        async scrollIntoView(o){this.node.scrollIntoView(o);}
        async clientHeight(){return this.node.clientHeight;}
        async clientWidth(){return this.node.clientWidth;}
        async getBoundingClientRect(){if(this.node.classList?.contains('default-chat-screen')&&theCheck())window.screenCalls.sizes++;return this.node.getBoundingClientRect().toJSON();}
        async addEventListener(type,fn,options){const id=hostUUID();const cb=e=>fn({clientX:e.clientX,clientY:e.clientY,button:e.button,buttons:e.buttons,key:e.key});this.listeners.set(id,[type,cb,options]);document.addEventListener(type,cb,options);return id;}
        async removeEventListener(type,id){const x=this.listeners.get(id);if(x){document.removeEventListener(type,x[1],x[2]);this.listeners.delete(id);}}
        async createElement(tag){return new Safe(document.createElement(tag));}
      }
      document.body.innerHTML='<div class="default-chat-screen" style="height:400px"><p>하린: "안녕."</p></div>';
      window.risuai={pluginStorage:{getItem:async k=>saved.get(k),setItem:async(k,v)=>saved.set(k,v)},getLocalPluginStorage:async()=>({getItem:async k=>local.get(k),setItem:async(k,v)=>local.set(k,v),removeItem:async k=>local.delete(k)}),
        getDatabase:async()=>({modules:[],enabledModules:[]}),setDatabase:async()=>{},requestPluginPermission:async()=>true,getRootDocument:async()=>new Safe(document.documentElement),
        unwarpSafeArray:async a=>{const result=[];for(let i=0,n=await a.length();i<n;i++)result.push(await a.at(i));return result;},
        createMutationObserver:async fn=>{const observer=new MutationObserver(rows=>fn(rows.map(row=>({getTarget:async()=>new Safe(row.target)}))));return {observe:async(target,options)=>observer.observe(target.node,options),disconnect:async()=>observer.disconnect()};},
        addRisuChatListener:async()=>{},removeRisuChatListener:async()=>{},onUnload:async()=>{},
        getCharacter:async()=>({chaId:'c',chatPage:0,chats:[{id:'chat',message:[{role:'char',chatId:'m0',data:'하린: "안녕."'}]}]}),
        nativeFetch:async()=>({ok:false,status:599,arrayBuffer:async()=>new ArrayBuffer(0)})};
    },blockedSource);
    await page.addScriptTag({content:built.outputFiles[0].text});
    await page.evaluate(async()=>{await window.loadTtsData();await window.updateTtsSettings({enabled:false,viewer:true});await window.installTtsHost();});
    await page.waitForTimeout(1500);
    const count=async ms=>{await page.evaluate(()=>{window.screenCalls={lookups:0,sizes:0};});await page.waitForTimeout(ms);return page.evaluate(()=>window.screenCalls);};
    assert.deepEqual(await count(2300),{lookups:0,sizes:0},'TTS off: its window never shows, and nothing is asked for it');
    await page.evaluate(async()=>{await window.updateTtsSettings({enabled:true});});
    await page.waitForTimeout(600);
    const on=await count(2300);
    assert.equal(on.lookups,0,'on: the chat screen is kept from check to check');
    assert.ok(on.sizes>=1&&on.sizes<=4,`on: its size, about once a second (${on.sizes})`);
    assert.equal(await page.locator('[x-omnitts-viewer]').isVisible(),true,'the window is up over the chat');
    // Risu draws the chat screen anew: looked up again once, then kept.
    await page.evaluate(()=>{const old=document.querySelector('.default-chat-screen');old.replaceWith(old.cloneNode(true));});
    const anew=await count(2300);
    assert.equal(anew.lookups,1,'the new screen looked up once');
    assert.equal(await page.locator('[x-omnitts-viewer]').isVisible(),true,'and the window still up');
    // Off the chat (Risu's other pages): the window goes.
    await page.evaluate(()=>document.querySelector('.default-chat-screen').remove());
    await page.waitForFunction(()=>{const v=document.querySelector('[x-omnitts-viewer]');return !v||getComputedStyle(v).display==='none'||v.getBoundingClientRect().width===0;});
    assert.deepEqual(errors,[]);
  } finally {await browser.close();}
});
