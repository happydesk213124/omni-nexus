import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {readFileSync} from 'node:fs';
import {chromium} from 'playwright';

const MESSAGES=60,LINES=8;
test('SafeDOM: with TTS on, a scrolling chat asks Risu nothing; stopped, the reader is placed in a few calls; a scan goes through only what changed',async()=>{
  const built=await build({stdin:{contents:`import {installTtsHost} from './src/tts-ui/host-chat';import {omniTts} from './src/services/tts-runtime';import {loadTtsData,updateTtsSettings} from './src/storage/tts-store';import {loadSoundData,updateSoundSettings} from './src/storage/sound-store';Object.assign(window,{installTtsHost,omniTts,loadTtsData,updateTtsSettings,loadSoundData,updateSoundSettings});`,resolveDir:process.cwd()},bundle:true,write:false,format:'iife'});
  const browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
  try {
    const page=await browser.newPage({viewport:{width:420,height:860}}),errors=[];page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
    await page.route('https://tts.test/',r=>r.fulfill({contentType:'text/html',body:'<body style="margin:0"></body>'}));await page.goto('https://tts.test/');
    await page.addScriptTag({content:readFileSync('node_modules/dompurify/dist/purify.min.js','utf8')});
    const blockedSource=readFileSync('tools/vendor-patches/float-viewer.js','utf8').match(/globalThis\.__OMNI_TTS_HOST_BLOCKED__ = (.*);/)[1];
    await page.evaluate(({blockedSource,MESSAGES,LINES})=>{
      window.__OMNI_TTS_HOST_BLOCKED__=new Function('t','return '+blockedSource)({});
      const saved=new Map(),local=new Map(),hostUUID=crypto.randomUUID.bind(crypto);
      window.calls={};const count=name=>{window.calls[name]=(window.calls[name]||0)+1;};
      // The TTS window painting its own list (the line read moved) is told apart from the chat's reads.
      const own=(node,s='')=>/tts/.test(s)||!!node.closest?.('[x-omnitts-viewer],[x-omnitts-toast]');
      const tally=(name,node,s)=>count(own(node,s)?'event:window':name);
      class Safe {
        constructor(node){this.node=node;this.listeners=new Map();}
        async querySelector(s){tally('querySelector',this.node,s);const n=this.node.querySelector(s);return n?new Safe(n):null;}
        async querySelectorAll(s){count('querySelectorAll');const list=[...this.node.querySelectorAll(s)].map(n=>new Safe(n));return {length:async()=>{count('array');return list.length;},at:async i=>{count('array');return list[i];}};}
        async getParent(){count('getParent');return this.node.parentElement?new Safe(this.node.parentElement):null;}
        async matches(s){count('matches');return this.node.nodeType===1&&this.node.matches(s);}
        async getAttribute(k){count('getAttribute');if(!k.startsWith('x-'))throw Error('Forbidden attribute read '+k);return this.node.getAttribute(k);}
        async setAttribute(k,v){count('setAttribute');if(!k.startsWith('x-'))throw Error('Forbidden attribute write '+k);this.node.setAttribute(k,v);}
        async setTextContent(v){tally('setTextContent',this.node);this.node.textContent=v;}
        async getOuterHTML(){count('getOuterHTML');return this.node.outerHTML;}
        async setInnerHTML(v){tally('setInnerHTML',this.node);this.node.innerHTML=DOMPurify.sanitize(v);}
        async setStyle(k,v){tally('setStyle',this.node);this.node.style[k]=v;}
        async setStyleAttribute(v){tally('setStyleAttribute',this.node);this.node.style.cssText=v;}
        async appendChild(child){count('appendChild');this.node.append(child.node);}
        async remove(){count('remove');this.node.remove();}
        async scrollIntoView(){count('scrollIntoView');}
        async clientHeight(){count('clientHeight');return this.node===document.documentElement?innerHeight:this.node.clientHeight;}
        async clientWidth(){count('clientWidth');return this.node.clientWidth;}
        // The TTS window's own once-a-second look at the chat screen is told apart: it is not the scroll's.
        async getBoundingClientRect(){count(this.node.classList?.contains('default-chat-screen')?'event:window-check':'getBoundingClientRect');return this.node.getBoundingClientRect().toJSON();}
        async addEventListener(type,fn,options){count('addEventListener');const id=hostUUID();const cb=e=>{count('event:'+type);fn({clientX:e.clientX,clientY:e.clientY,button:e.button,buttons:e.buttons,key:e.key});};this.listeners.set(id,[type,cb,options]);document.addEventListener(type,cb,options);return id;}
        async removeEventListener(type,id){count('removeEventListener');const x=this.listeners.get(id);if(x){document.removeEventListener(type,x[1],x[2]);this.listeners.delete(id);}}
        async createElement(tag){count('createElement');return new Safe(document.createElement(tag));}
      }
      // A long chat as Risu draws it with the TTS module on: a play button after every line.
      const tail=kind=>`<span data-omnitts-tail="1"><button type="button" data-omnitts-play="1" data-omnitts-kind="${kind}" title="재생" aria-label="재생"></button></span>`;
      window.lineOf=(i,j)=>j%4===3?`그녀는 창밖을 바라보았다 ${i}-${j}.`:`하린 (happy): "대사 ${i}-${j}."`;
      window.messages=Array.from({length:MESSAGES},(_,i)=>({role:'char',chatId:'m'+i,data:Array.from({length:LINES},(_,j)=>lineOf(i,j)).join('\n')}));
      document.body.innerHTML='<div class="default-chat-screen" style="height:860px;overflow:auto">'+messages.map((m,i)=>`<div class="risu-chat" data-chat-index="${i}">`+Array.from({length:LINES},(_,j)=>`<p>${lineOf(i,j)}${tail(j%4===3?'narration':'dialogue')}</p>`).join('')+'</div>').join('')+'</div>';
      window.risuai={pluginStorage:{getItem:async k=>saved.get(k),setItem:async(k,v)=>saved.set(k,v)},getLocalPluginStorage:async()=>({getItem:async k=>local.get(k),setItem:async(k,v)=>local.set(k,v),removeItem:async k=>local.delete(k)}),
        getDatabase:async()=>({modules:[],enabledModules:[]}),setDatabase:async()=>{},requestPluginPermission:async()=>true,getRootDocument:async()=>new Safe(document.documentElement),
        unwarpSafeArray:async a=>{const result=[];for(let i=0,n=await a.length();i<n;i++)result.push(await a.at(i));return result;},
        createMutationObserver:async fn=>{const observer=new MutationObserver(rows=>fn(rows.map(row=>({getTarget:async()=>new Safe(row.target)}))));return {observe:async(target,options)=>observer.observe(target.node,options),disconnect:async()=>observer.disconnect()};},
        addRisuChatListener:async()=>{},removeRisuChatListener:async()=>{},onUnload:async()=>{},
        getCharacter:async()=>{count('api.getCharacter');return structuredClone({chaId:'c',name:'하린',chatPage:0,chats:[{id:'chat',message:window.messages}]});},
        nativeFetch:async()=>({ok:false,status:599,arrayBuffer:async()=>new ArrayBuffer(0),json:async()=>({}),text:async()=>''})};
      // Which message is across the middle of the screen, and which one the reader reads.
      window.middle=()=>{const y=innerHeight/2;const hit=[...document.querySelectorAll('.risu-chat')].find(n=>{const r=n.getBoundingClientRect();return r.top<=y&&r.bottom>=y;});return 'm'+hit.getAttribute('data-chat-index');};
      window.readingId=()=>window.omniTts.list[0]?.messageId||'';
    },{blockedSource,MESSAGES,LINES});
    await page.addScriptTag({content:built.outputFiles[0].text});
    await page.evaluate(async()=>{await window.loadTtsData();await window.loadSoundData();await window.updateTtsSettings({enabled:true,viewer:true,autoAssign:false,prefetch:0});await window.updateSoundSettings({bgmEnabled:false,sfxEnabled:false});await window.installTtsHost();});
    await page.waitForFunction(()=>window.readingId()===window.middle());
    await page.waitForTimeout(800);
    const reset=()=>page.evaluate(()=>{window.calls={};});
    const calls=()=>page.evaluate(()=>window.calls);
    const sum=c=>Object.entries(c).filter(([k])=>!k.startsWith('event:')).reduce((s,[,v])=>s+v,0);

    // A finger on the chat for a second and a half: nothing is asked of Risu while it moves.
    await reset();
    await page.evaluate(async()=>{const screen=document.querySelector('.default-chat-screen');const end=performance.now()+1500;while(performance.now()<end){screen.scrollTop+=6;await new Promise(r=>requestAnimationFrame(r));}});
    const moving=await calls();
    assert.ok((moving['event:scroll']||0)>20,'the scroll was seen');
    assert.equal(sum(moving),0,`nothing asked while it scrolled: ${JSON.stringify(moving)}`);
    // Stopped: the reader is placed on the message now in the middle, in a few calls and with no read of the chat.
    await page.waitForFunction(()=>window.readingId()===window.middle());
    await page.waitForTimeout(400);
    const placed=await calls();
    assert.equal(placed['api.getCharacter']||0,0,'no read of the whole character');
    assert.equal(placed.getOuterHTML||0,0,'no message read');
    assert.ok(sum(placed)<=40,`placed in a few calls (${sum(placed)}: ${JSON.stringify(placed)})`);

    // One message drawn anew (a line added): only it is gone through, with one read of the chat.
    await reset();
    await page.evaluate(()=>{const i=5,j=8;window.messages[i].data+='\n'+window.lineOf(i,j);const p=document.createElement('p');p.innerHTML=window.lineOf(i,j)+'<span data-omnitts-tail="1"><button type="button" data-omnitts-play="1" data-omnitts-kind="dialogue"></button></span>';document.querySelector('.risu-chat[data-chat-index="5"]').append(p);});
    await page.waitForFunction(()=>document.querySelectorAll('.risu-chat[data-chat-index="5"] [x-omnitts-bound]').length===9);
    await page.waitForTimeout(500);
    const changed=await calls();
    assert.equal(changed['api.getCharacter'],1,'the chat read once, for the message that changed');
    assert.equal(changed.getOuterHTML,61,'every message read once, the changed one again as drawn now');
    assert.ok((changed.getAttribute||0)<=LINES+2,`the unchanged messages\' controls are not asked about (${changed.getAttribute})`);
    // A tap in the chat (it may have folded a <details>): a scan, nothing drawn anew, no read of the chat.
    await reset();
    const where=await page.locator('.risu-chat[data-chat-index="20"] p').first().boundingBox();
    await page.mouse.click(where.x+5,where.y+5);
    await page.waitForTimeout(700);
    const tapped=await calls();
    assert.equal(tapped['api.getCharacter']||0,0,'nothing changed: the chat is not read');
    assert.ok((tapped.getOuterHTML||0)>=MESSAGES,'the scan ran');

    // TTS and BGM·효과음 both off: the scroll is not listened to at all.
    await page.evaluate(async()=>{await window.updateTtsSettings({enabled:false});});
    await page.waitForTimeout(300);
    await reset();
    await page.evaluate(async()=>{const screen=document.querySelector('.default-chat-screen');for(let i=0;i<30;i++){screen.scrollTop-=6;await new Promise(r=>requestAnimationFrame(r));}});
    await page.waitForTimeout(500);
    const off=await calls();
    assert.equal(off['event:scroll']||0,0,'no scroll event comes over');
    assert.equal(sum(off),0);
    assert.deepEqual(errors,[]);
  } finally {await browser.close();}
});
