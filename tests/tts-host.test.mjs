import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

test('restricted SafeDOM host binds module buttons, honors five slots, stop interlock and cross-message cache',async()=>{
  const built=await build({stdin:{contents:`import {installTtsHost} from './src/tts-ui/host-chat';import {cueLineKey} from './src/domain/tts/segment';import {TTS_MODULE_CSS} from './src/domain/tts/module';import {omniTts} from './src/services/tts-runtime';import {loadTtsData,ttsData,updateTtsSettings} from './src/storage/tts-store';Object.assign(window,{cueLineKey,TTS_MODULE_CSS,installTtsHost,omniTts,loadTtsData,ttsData,updateTtsSettings});`,resolveDir:process.cwd()},bundle:true,write:false,format:'iife'});
  const browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
  try {
    const page=await browser.newPage(),errors=[];page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));
    await page.route('https://tts.test/',r=>r.fulfill({contentType:'text/html',body:'<body></body>'}));await page.goto('https://tts.test/');
    await page.addScriptTag({content:readFileSync('node_modules/dompurify/dist/purify.min.js','utf8')});
    const blockedSource=readFileSync('tools/vendor-patches/float-viewer.js','utf8').match(/globalThis\.__OMNI_TTS_HOST_BLOCKED__ = (.*);/)[1];
    await page.evaluate(blockedSource=>{
      window.hostScreenState={};window.__OMNI_TTS_HOST_BLOCKED__=new Function('t','return '+blockedSource)(window.hostScreenState);
      const saved=new Map(),local=new Map(),hostUUID=crypto.randomUUID.bind(crypto);window.moduleWrites=0;window.requests=[];window.pending=[];window.played=[];window.apiEvents=[];let active=0;window.peak=0;
      class Safe {
        constructor(node){this.node=node;this.listeners=new Map();}
        async querySelector(s){const n=this.node.querySelector(s);return n?new Safe(n):null;}
        async querySelectorAll(s){return [...this.node.querySelectorAll(s)].map(n=>new Safe(n));}
        async getParent(){return this.node.parentElement?new Safe(this.node.parentElement):null;}
        async matches(s){return this.node.nodeType===1&&this.node.matches(s);}
        async getAttribute(k){if(!k.startsWith('x-'))throw Error('Forbidden attribute read '+k);return this.node.getAttribute(k);}
        async setAttribute(k,v){if(!k.startsWith('x-'))throw Error('Forbidden attribute write '+k);this.node.setAttribute(k,v);}
        async setTextContent(v){this.node.textContent=v;}
        async getOuterHTML(){window.outerReads=(window.outerReads||0)+1;return this.node.outerHTML;}
        async setInnerHTML(v){this.node.innerHTML=DOMPurify.sanitize(v);}
        async setStyle(k,v){this.node.style[k]=v;}
        async setStyleAttribute(v){this.node.style.cssText=v;}
        async appendChild(child){this.node.append(child.node);}
        async remove(){this.node.remove();}
        async scrollIntoView(o){window.scrolled=(window.scrolled||[]).concat(this.node.getAttribute('data-omnitts-kind')||this.node.tagName);this.node.scrollIntoView(o);}
        async clientHeight(){return this.node.clientHeight;}
        async clientWidth(){return this.node.clientWidth;}
        async getBoundingClientRect(){return this.node.getBoundingClientRect().toJSON();}
        async addEventListener(type,fn,options){if(!['click','pointerenter','pointerdown','pointermove','pointerup','pointercancel','mouseover','keydown','scroll'].includes(type))throw Error('Unsupported host event '+type);const id=hostUUID();const cb=e=>fn({clientX:e.clientX,clientY:e.clientY,button:e.button,buttons:e.buttons,key:e.key});this.listeners.set(id,[type,cb,options]);document.addEventListener(type,cb,options);window.apiEvents.push(type);return id;}
        async removeEventListener(type,id){const x=this.listeners.get(id);if(x){document.removeEventListener(type,x[1],x[2]);this.listeners.delete(id);}}
        async createElement(tag){if(!['div','button'].includes(tag))throw Error('Unsupported host element '+tag);return new Safe(document.createElement(tag));}
      }
      const messages=Array.from({length:7},(_,i)=>({role:'char',chatId:'m'+i,data:`하린 (happy): "대사 ${i}."`}));messages.push({...messages[0],chatId:'duplicate'});
      window.messages=messages;window.contextReady=false;document.body.innerHTML='<div class="default-chat-screen">'+messages.map(m=>'<p>'+m.data+'</p>').join('')+'</div>';
      window.risuai={pluginStorage:{getItem:async k=>saved.get(k),setItem:async(k,v)=>saved.set(k,v)},getLocalPluginStorage:async()=>({getItem:async k=>local.get(k),setItem:async(k,v)=>local.set(k,v),removeItem:async k=>local.delete(k)}),getDatabase:async()=>({modules:[],enabledModules:[]}),setDatabase:async()=>{window.moduleWrites++;},requestPluginPermission:async()=>true,getRootDocument:async()=>new Safe(document.documentElement),unwarpSafeArray:async a=>{const result=[];for(let i=0,n=await a.length();i<n;i++)result.push(await a.at(i));return result;},
        createMutationObserver:async fn=>{const observer=new MutationObserver(rows=>fn(rows.map(row=>({getTarget:async()=>new Safe(row.target)}))));return {observe:async(target,options)=>observer.observe(target.node,options),disconnect:async()=>observer.disconnect()};},addRisuChatListener:async(_mode,fn)=>window.output=fn,removeRisuChatListener:async()=>{window.output=null;},onUnload:async fn=>window.unload=fn,
        getCharacter:async()=>window.contextReady?({chaId:'c',chatPage:0,chats:[{id:'chat',message:messages}]}):{},
        nativeFetch:async(_url,options)=>{window.requests.push(JSON.parse(options.body));active++;window.peak=Math.max(window.peak,active);return new Promise(resolve=>window.pending.push(()=>{active--;resolve({ok:true,arrayBuffer:async()=>new Uint8Array(32).buffer});}));}};
      window.Audio=class{src='';currentTime=0;duration=1;async play(){window.played.push(this.src);}pause(){}load(){}removeAttribute(){this.src='';}};
      window.AudioContext=class{state='running';destination={};async resume(){}createGain(){return {gain:{value:1},connect(){return this;}};}createMediaElementSource(){return {connect(node){return node;}};}};
    },blockedSource);
    await page.evaluate(()=>{window.crypto.randomUUID=undefined;});
    await page.addScriptTag({content:built.outputFiles[0].text});
    await page.evaluate(async()=>{await window.loadTtsData();const d=window.ttsData();d.settings.translation.provider='off';d.settings.enabled=true;d.settings.autoAssign=false;d.settings.fish.key='test-key';d.settings.continuous=false;d.characters=[{id:'h',scope:'global',name:'하린',surname:'',givenName:'하린',surnameAliases:[],givenAliases:[],triggers:['하린'],tags:[],gender:'female',voiceKey:d.voices[0].key,fishId:d.voices[0].fishId,fixed:false,gain:0}];await window.installTtsHost();await window.omniTts.player.unlock();window.played=[];});
    await page.evaluate(()=>window.contextReady=true);
    await page.waitForFunction(()=>window.omniTts.list.length===1);
    assert.equal(await page.locator('[x-omnitts-viewer]').isVisible(),true,'existing chat works on startup without leaving and reopening it');
    assert.equal(await page.evaluate(()=>window.omniTts.notice),'','temporarily unavailable chat IDs are normal startup state');
    assert.equal(await page.locator('[x-omnitts-toast]').isVisible(),false,'no toast is shown before a real synthesis request');
    // Module output: no ids, only a zero-width control after each rendered line.
    const tail=kind=>`<span data-omnitts-tail="1"><button type="button" data-omnitts-play="1" data-omnitts-kind="${kind}" title="재생" aria-label="재생"></button></span>`;
    await page.evaluate(([dialogue,narration])=>{const style=document.createElement('style');style.textContent=window.TTS_MODULE_CSS;document.head.append(style);document.querySelector('.default-chat-screen').innerHTML=DOMPurify.sanitize(window.messages.map((m,i)=>`<div class="risu-chat" data-chat-index="${i}" data-chat-id="${m.chatId}"><div class="regex-quote-block" style="height:50px">“${m.data.match(/"(.*)"/)[1]}”${dialogue}</div>${i===2?`<div>[상태] 체력 99${narration}</div>`:''}</div>`).join(''));},[tail('dialogue'),tail('narration')]);
    await page.waitForFunction(()=>window.requests.length===5,undefined,{timeout:12000});
    await page.waitForFunction(()=>document.querySelector('[data-chat-index="2"] [data-omnitts-kind="narration"]').style.display==='none');
    assert.equal(await page.locator('[data-chat-index="2"] [data-omnitts-kind="narration"]').isVisible(),false,'a line without a source segment keeps no visible control');
    assert.equal(await page.evaluate(()=>[...document.querySelectorAll('[data-omnitts-kind="dialogue"]')].every(n=>n.getAttribute('x-omnitts-bound')&&n.style.display!=='none')),true,'every rendered cue binds to its own source line');
    assert.equal(await page.evaluate(()=>window.omniTts.list.length),1,'the viewer knows the visible message before a dialogue is clicked');
    await page.locator('[data-tts-control="play"]').click();
    await page.waitForFunction(()=>window.omniTts.player.status==='loading');
    const controlsBefore=await page.evaluate(()=>({narration:window.ttsData().settings.narration,continuous:window.ttsData().settings.continuous,volume:window.ttsData().settings.volume,minimized:window.ttsData().settings.minimized}));
    await page.locator('[data-omnitts-kind="dialogue"]').nth(0).click();await page.locator('[data-omnitts-kind="dialogue"]').nth(1).click();
    await page.evaluate(()=>window.omniTts.stop());
    await page.evaluate(()=>{window.pending.splice(0).forEach(resolve=>resolve());});
    await page.waitForFunction(()=>window.requests.length>=7,undefined,{timeout:12000});
    await page.evaluate(()=>window.pending.splice(0).forEach(resolve=>resolve()));
    await page.waitForFunction(()=>window.omniTts.queue.status.active===0,undefined,{timeout:12000});
    assert.equal(await page.locator('[x-omnitts-toast]').isVisible(),false,'toast hides as soon as synthesis finishes');
    await page.evaluate(()=>window.omniTts.report(new Error('채팅 ID를 선택해 주세요.')));
    assert.equal(await page.locator('[x-omnitts-toast]').isVisible(),false,'setup notices must not become generation toasts');
    await page.evaluate(()=>window.omniTts.report(''));
    assert.equal(await page.evaluate(()=>window.peak),5);assert.deepEqual(await page.evaluate(()=>window.played),[]);
    const before=await page.evaluate(()=>window.requests.length);
    await page.locator('[data-omnitts-kind="dialogue"]').nth(7).click();await page.waitForFunction(()=>window.played.length===1,undefined,{timeout:12000});
    assert.equal(await page.evaluate(()=>window.requests.length),before);
    assert.deepEqual(await page.evaluate(()=>({narration:window.ttsData().settings.narration,continuous:window.ttsData().settings.continuous,volume:window.ttsData().settings.volume,minimized:window.ttsData().settings.minimized})),controlsBefore,'chat clicks must not execute viewer controls registered on the document');
    assert.ok(await page.evaluate(()=>window.apiEvents.length)<15,'listeners must not grow with dialogue count or viewer repaint');
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
    for(const flag of ['uiOpen','_nxHostInspectOpen','_hostChromeBlocked','_viewerHiddenForModal','_viewerHiddenForRisuSettings']) {
      await page.evaluate(flag=>{window.hostScreenState[flag]=true;window.__OMNI_TTS_REFRESH_VISIBILITY__();},flag);
      await page.waitForFunction(()=>document.querySelector('[x-omnitts-viewer]').style.display==='none');
      await page.evaluate(flag=>{window.hostScreenState[flag]=false;window.__OMNI_TTS_REFRESH_VISIBILITY__();},flag);
      await page.waitForFunction(()=>document.querySelector('[x-omnitts-viewer]').style.display==='block');
    }
    assert.equal(await page.evaluate(()=>window.omniTts.notice),'','native observer arrays must not cause a repeated error toast');
    await page.waitForTimeout(700); // let pending chat scans settle before faking a long list
    await page.evaluate(()=>{window.omniTts.stop();const first=window.omniTts.list[0];window.omniTts.reading(Array.from({length:30},(_,i)=>({...first,segment:{...first.segment,id:String(i)}})));});
    await page.locator('[data-tts-control="list"]').click();
    await page.waitForFunction(()=>!!document.querySelector('[data-tts-list-scroll]'));
    const beforeWheel=await page.locator('[data-tts-header]').boundingBox();
    const scroll=page.locator('[data-tts-list-scroll]');
    assert.equal(await scroll.evaluate(n=>n.scrollHeight>n.clientHeight&&getComputedStyle(n).overflowY==='auto'),true);
    const listBox=await scroll.boundingBox();await page.mouse.move(listBox.x+listBox.width/2,listBox.y+listBox.height/2);await page.mouse.wheel(0,300);
    await page.waitForFunction(()=>document.querySelector('[data-tts-list-scroll]').scrollTop>0);
    assert.deepEqual(await page.locator('[data-tts-header]').boundingBox(),beforeWheel,'list scrolling leaves the header in place');
    assert.equal(await page.locator('[x-omnitts-viewer]').evaluate(n=>n.scrollTop),0,'the viewer itself does not scroll with its list');
    assert.equal(await page.evaluate(()=>document.scrollingElement.scrollTop),0,'list wheel does not scroll chat');
    const scrolled=await scroll.evaluate(n=>n.scrollTop);
    await page.locator('[data-tts-list-scroll] [data-tts-control="line-12"]').click();
    await page.waitForFunction(()=>window.omniTts.current?.segment.id==='12');
    await page.waitForTimeout(150);
    assert.equal(await page.locator('[data-tts-list-scroll]').evaluate(n=>n.scrollTop),scrolled,'picking a line keeps the list where it was');
    assert.equal(await page.locator('[data-tts-control="line-12"]').evaluate(n=>n.style.background),'rgba(113, 50, 245, 0.6)','the picked line is highlighted in place');
    await page.evaluate(()=>window.omniTts.stop());
    await page.locator('[data-tts-control="list"]').click();
    const oldRect=await page.locator('[x-omnitts-viewer]').boundingBox();
    const header=await page.locator('[data-tts-header]').boundingBox();
    await page.mouse.move(header.x+10,header.y+18);await page.mouse.down();
    await page.waitForTimeout(80);await page.mouse.move(header.x-70,header.y-62,{steps:6});
    await page.mouse.up();
    await page.waitForFunction(()=>window.ttsData().settings.viewerAnchor!==null);
    const movedRect=await page.locator('[x-omnitts-viewer]').boundingBox();
    assert.ok(movedRect.x<oldRect.x-60&&movedRect.y<oldRect.y-60,'header drag moves the actual host viewer');
    const anchor=await page.evaluate(()=>window.ttsData().settings.viewerAnchor);
    await page.waitForTimeout(450);
    await page.locator('[data-tts-control="continuous"]').click();
    await page.waitForFunction(()=>window.ttsData().settings.continuous);
    assert.deepEqual(await page.evaluate(()=>window.ttsData().settings.viewerAnchor),anchor,'header controls do not drag the viewer');
    // A drag may start on a header button or a little outside the header; a still press stays a click.
    await page.waitForTimeout(450);const panelBefore=await page.evaluate(()=>window.ttsData().settings.panel);
    const cache=await page.locator('[data-tts-control="cache"]').boundingBox();
    await page.mouse.move(cache.x+cache.width/2,cache.y+cache.height/2);await page.mouse.down();await page.waitForTimeout(80);await page.mouse.move(cache.x-30,cache.y+40,{steps:6});await page.mouse.up();
    await page.waitForFunction(a=>JSON.stringify(window.ttsData().settings.viewerAnchor)!==JSON.stringify(a),anchor);
    await page.waitForTimeout(450);assert.equal(await page.evaluate(()=>window.ttsData().settings.panel),panelBefore,'dragging from a button does not also press it');
    const head=await page.locator('[data-tts-header]').boundingBox(),moved2=await page.evaluate(()=>window.ttsData().settings.viewerAnchor);
    await page.mouse.move(head.x+head.width/2,head.y-8);await page.mouse.down();await page.waitForTimeout(80);await page.mouse.move(head.x+head.width/2-40,head.y+30,{steps:6});await page.mouse.up();
    await page.waitForFunction(a=>JSON.stringify(window.ttsData().settings.viewerAnchor)!==JSON.stringify(a),moved2);
    await page.waitForTimeout(450);await page.locator('[data-tts-control="minimize"]').click();
    await page.waitForFunction(()=>window.ttsData().settings.minimized);
    assert.equal(await page.locator('[x-omnitts-viewer] button').count(),1);
    await page.locator('[data-tts-control="minimize"]').click();
    await page.waitForFunction(()=>!window.ttsData().settings.minimized);
    const moduleWrites=await page.evaluate(()=>window.moduleWrites);
    await page.evaluate(async tail=>{
      await window.updateTtsSettings({prefetch:0,narration:false,narrationVoice:window.ttsData().voices[0].key});
      const m={role:'char',chatId:'narration',data:'햇빛이 도서관을 비추었다.'};window.messages.push(m);
      const parent=document.createElement('div');parent.innerHTML=DOMPurify.sanitize(`<div class="risu-chat" data-chat-index="8"><p><em>햇빛이</em> 도서관을 비추었다.${tail}</p></div>`);
      document.querySelector('.default-chat-screen').append(parent);window.narrationNode=parent.querySelector('[data-omnitts-play]');
    },tail('narration'));
    const narrationButton=page.locator('[data-chat-index="8"] [data-omnitts-kind="narration"]');
    const shown=()=>window.narrationNode.getAttribute('x-omnitts-bound')&&getComputedStyle(window.narrationNode).display!=='none';
    await page.waitForFunction(()=>window.narrationNode.getAttribute('x-omnitts-bound')&&window.narrationNode.style.display==='none');
    assert.equal(await page.evaluate(()=>document.body.hasAttribute('x-omnitts-narration')),false,'the plugin hides the control itself, not through a module rule');
    assert.equal(await narrationButton.count(),1,'OFF retains the module button in DOM on its first scan');
    await page.evaluate(()=>window.updateTtsSettings({narration:true}));
    await page.waitForFunction(shown);
    assert.equal(await narrationButton.evaluate(n=>n===window.narrationNode),true,'ON restores the same button without rerendering chat');
    await narrationButton.click();await page.waitForFunction(()=>window.omniTts.player.status==='loading');
    await page.evaluate(()=>window.updateTtsSettings({narration:false}));
    await page.waitForFunction(()=>getComputedStyle(window.narrationNode).display==='none'&&window.omniTts.player.status==='idle');
    const playedBefore=await page.evaluate(()=>window.played.length);
    await page.evaluate(()=>window.pending.splice(0).forEach(resolve=>resolve()));
    await page.waitForFunction(()=>window.omniTts.queue.status.active===0);
    assert.equal(await page.evaluate(()=>window.played.length),playedBefore,'OFF cancels narration waiting for Fish bytes');
    await page.evaluate(async()=>{await window.updateTtsSettings({narration:true});await window.updateTtsSettings({narration:false});await window.updateTtsSettings({narration:true});});
    await page.waitForFunction(shown);
    await narrationButton.click();await page.waitForFunction(()=>window.omniTts.player.status==='playing');
    await page.evaluate(()=>{window.scrolled=[];});await page.locator('[data-tts-control="locate"]').click();
    await page.waitForFunction(()=>window.scrolled.includes('narration'),undefined,{timeout:3000});
    assert.ok(await page.evaluate(()=>window.scrolled.includes('narration')),'⌖ also scrolls the chat to the line being read');
    assert.deepEqual(await page.evaluate(()=>[document.scrollingElement.scrollTop,document.scrollingElement.scrollLeft]),[0,0],'centering never leaves the whole page pushed');
    await page.waitForFunction(()=>window.narrationNode.getAttribute('x-omnitts-state')==='playing');
    assert.equal(await page.evaluate(()=>getComputedStyle(window.narrationNode).animationName),'omnitts-pulse','the line being read visibly plays');
    await page.locator('[data-tts-control="narration"]').click();
    await page.waitForFunction(()=>getComputedStyle(window.narrationNode).display==='none'&&window.omniTts.player.status==='idle');
    await page.waitForFunction(()=>window.narrationNode.getAttribute('x-omnitts-state')==='');
    assert.equal(await page.locator('[data-omnitts-kind="dialogue"]').first().isVisible(),true,'dialogue controls stay visible');
    await page.evaluate(()=>window.updateTtsSettings({narration:true}));
    await page.waitForFunction(shown);
    assert.equal(await page.evaluate(()=>window.moduleWrites),moduleWrites,'narration toggles never write or reinstall the module');
    // Lines inside a folded <details> are off screen: not listed, not read on.
    await page.evaluate(async tail=>{
      const lines=['펼쳐진 첫 줄입니다.','접힌 둘째 줄입니다.','접힌 셋째 줄입니다.','펼쳐진 넷째 줄입니다.'];
      window.messages.push({role:'char',chatId:'folded',data:lines.join('\n')});
      const parent=document.createElement('div');
      parent.innerHTML=DOMPurify.sanitize(`<div class="risu-chat" data-chat-index="${window.messages.length-1}"><p>${lines[0]}${tail}</p><details><summary>접힘</summary><p>${lines[1]}${tail}</p><p>${lines[2]}${tail}</p></details><p>${lines[3]}${tail}</p></div>`);
      document.querySelector('.default-chat-screen').append(parent);
    },tail('narration'));
    const folded=page.locator('[data-chat-index="9"] [data-omnitts-play]');
    await page.waitForFunction(()=>[...document.querySelectorAll('[data-chat-index="9"] [data-omnitts-play]')].every(n=>n.getAttribute('x-omnitts-bound')));
    await folded.first().click();
    await page.waitForFunction(()=>window.omniTts.current?.segment.text==='펼쳐진 첫 줄입니다.');
    assert.deepEqual(await page.evaluate(()=>window.omniTts.list.map(r=>r.segment.text)),['펼쳐진 첫 줄입니다.','펼쳐진 넷째 줄입니다.'],'folded lines stay out of the list and continuous reading');
    await page.evaluate(()=>window.omniTts.stop());
    await page.locator('[data-chat-index="9"] summary').click();
    await page.waitForTimeout(700);
    await folded.first().click();
    await page.waitForFunction(()=>window.omniTts.list.length===4,undefined,{timeout:4000});
    // No chat scan competes with a viewer drag; the change is picked up on drop.
    await page.waitForTimeout(600);
    await page.evaluate(()=>{window.__OMNI_VIEWER_DRAGGING__=true;window.outerReads=0;const p=document.createElement('p');p.textContent='드래그 중 추가';document.querySelector('.default-chat-screen').append(p);});
    await page.waitForTimeout(700);
    assert.equal(await page.evaluate(()=>window.outerReads),0,'chat changes during a drag wait');
    await page.evaluate(()=>{window.__OMNI_VIEWER_DRAGGING__=false;});
    await page.waitForFunction(()=>window.outerReads>0,undefined,{timeout:3000});
    await page.evaluate(()=>{document.querySelector('.default-chat-screen').remove();});
    await page.waitForFunction(()=>document.querySelector('[x-omnitts-viewer]').style.display==='none');
    await page.evaluate(()=>window.updateTtsSettings({enabled:false}));await page.waitForFunction(()=>document.querySelector('[x-omnitts-viewer]').style.display==='none',undefined,{timeout:12000});
    await page.evaluate(()=>window.unload());
    assert.equal(await page.locator('[x-omnitts-viewer]').count(),0,'unload removes the viewer and its document listeners');
    assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});
