import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {readFileSync} from 'node:fs';
import {chromium} from 'playwright';

/**
 * The chat as Risu draws it: the newest message first in the page, in a column drawn bottom up, and every picture in a
 * message held as base64 (megabytes on a phone). A scan asks which messages to go through and reads only those, and
 * never a picture; a streaming reply is the one message read per chunk; a setting that does not shape the lines (the
 * TTS window moved or folded) reads nothing of the chat; a tap is placed by halving, the screen's order and not the
 * page's.
 */
const MESSAGES=40,LINES=6,PICTURE=80_000;
test('SafeDOM, Risu\'s own layout: a scan reads only what changed and never a picture; a stream reads its reply alone; the TTS window\'s settings read nothing',{timeout:90000},async()=>{
  const built=await build({stdin:{contents:`import {installTtsHost} from './src/tts-ui/host-chat';import {omniTts} from './src/services/tts-runtime';import {loadTtsData,updateTtsSettings,ttsData} from './src/storage/tts-store';import {loadSoundData,updateSoundSettings} from './src/storage/sound-store';Object.assign(window,{installTtsHost,omniTts,loadTtsData,updateTtsSettings,ttsData,loadSoundData,updateSoundSettings});`,resolveDir:process.cwd()},bundle:true,write:false,format:'iife'});
  const browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
  try {
    const page=await browser.newPage({viewport:{width:420,height:860}}),errors=[];page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
    await page.route('https://tts.test/',r=>r.fulfill({contentType:'text/html',body:'<body style="margin:0"></body>'}));await page.goto('https://tts.test/');
    await page.addScriptTag({content:readFileSync('node_modules/dompurify/dist/purify.min.js','utf8')});
    const blockedSource=readFileSync('tools/vendor-patches/float-viewer.js','utf8').match(/globalThis\.__OMNI_TTS_HOST_BLOCKED__ = (.*);/)[1];
    await page.evaluate(({blockedSource,MESSAGES,LINES,PICTURE})=>{
      window.__OMNI_TTS_HOST_BLOCKED__=new Function('t','return '+blockedSource)({});
      const saved=new Map(),local=new Map(),hostUUID=crypto.randomUUID.bind(crypto);
      window.calls={};window.bytes=0;window.readMessages=[];
      const count=name=>{window.calls[name]=(window.calls[name]||0)+1;};
      const own=node=>!!node.closest?.('[x-omnitts-viewer],[x-omnitts-toast]');
      const tally=(name,node)=>count(own(node)?'event:window':name);
      // Which message a read was of: a copy keeps the number on its tag.
      const which=node=>node.closest?.('.risu-chat')?.getAttribute('data-chat-index')??node.getAttribute?.('data-chat-index');
      class Safe {
        constructor(node){this.node=node;}
        async querySelector(s){tally('querySelector',this.node);const n=this.node.querySelector(s);return n?new Safe(n):null;}
        async querySelectorAll(s){tally(/risu-chat/.test(s)?'chatQuery':'querySelectorAll',this.node);const list=[...this.node.querySelectorAll(s)].map(n=>new Safe(n));return {length:async()=>{count('array');return list.length;},at:async i=>{count('array');return list[i];},release:async()=>count('released')};}
        async getParent(){count('getParent');return this.node.parentElement?new Safe(this.node.parentElement):null;}
        async matches(s){count('matches');return this.node.nodeType===1&&this.node.matches(s);}
        async getAttribute(k){tally('getAttribute',this.node);if(!k.startsWith('x-'))throw Error('Forbidden attribute read '+k);return this.node.getAttribute(k);}
        async setAttribute(k,v){tally('setAttribute',this.node);if(!k.startsWith('x-'))throw Error('Forbidden attribute write '+k);this.node.setAttribute(k,v);}
        async setTextContent(v){tally('setTextContent',this.node);this.node.textContent=v;}
        async cloneNode(deep){tally('cloneNode',this.node);const copy=this.node.cloneNode(deep);return new Safe(copy);}
        async getOuterHTML(){const html=this.node.outerHTML;if(!own(this.node)){count('getOuterHTML');window.bytes+=html.length;const i=which(this.node);if(i!=null)window.readMessages.push(Number(i));}return html;}
        async setInnerHTML(v){tally('setInnerHTML',this.node);this.node.innerHTML=DOMPurify.sanitize(v);}
        async setStyle(k,v){tally('setStyle',this.node);this.node.style[k]=v;}
        async setStyleAttribute(v){tally('setStyleAttribute',this.node);this.node.style.cssText=v;}
        async appendChild(child){tally('appendChild',this.node);this.node.append(child.node);}
        async remove(){count('remove');this.node.remove();}
        async scrollIntoView(){count('scrollIntoView');}
        async clientHeight(){count('clientHeight');return this.node===document.documentElement?innerHeight:this.node.clientHeight;}
        async clientWidth(){count('clientWidth');return this.node===document.documentElement?innerWidth:this.node.clientWidth;}
        async getBoundingClientRect(){count(this.node.classList?.contains('default-chat-screen')?'event:window-check':own(this.node)?'event:window':'getBoundingClientRect');return this.node.getBoundingClientRect().toJSON();}
        async addEventListener(type,fn,options){count('addEventListener');const id=hostUUID();const cb=e=>{count('event:'+type);fn({clientX:e.clientX,clientY:e.clientY,button:e.button,buttons:e.buttons,key:e.key});};document.addEventListener(type,cb,options);(this.listeners||=new Map()).set(id,[type,cb,options]);return id;}
        async removeEventListener(type,id){const x=this.listeners?.get(id);if(x){document.removeEventListener(type,x[1],x[2]);this.listeners.delete(id);}}
        async createElement(tag){count('createElement');return new Safe(document.createElement(tag));}
      }
      // Each message holds a picture: its base64 is what must never cross.
      const picture=`<div class="inray-shot" data-inlay-inline-shot="s"><img src="data:image/png;base64,${'A'.repeat(PICTURE)}" style="width:40px;height:40px"></div>`;
      const tail=kind=>`<span data-omnitts-tail="1"><button type="button" data-omnitts-play="1" data-omnitts-kind="${kind}" title="재생" aria-label="재생" style="width:12px;height:12px"></button></span>`;
      window.lineOf=(i,j)=>j%3===2?`창밖에 비가 내렸다 ${i}-${j}.`:`하린 (happy): "대사 ${i}-${j}."`;
      window.messages=Array.from({length:MESSAGES},(_,i)=>({role:'char',chatId:'m'+i,data:Array.from({length:LINES},(_,j)=>lineOf(i,j)).join('\n')}));
      window.row=(m,i)=>`<div class="chat-message-container"><div class="risu-chat" data-chat-index="${i}" style="padding:8px 0">${picture}`+m.data.split('\n').map((line,j)=>`<p>${line}${tail(j%3===2?'narration':'dialogue')}</p>`).join('')+'</div></div>';
      // Risu's chat screen: a column drawn bottom up, the list of messages in it newest first.
      document.body.innerHTML=`<div class="default-chat-screen" style="position:fixed;inset:0;overflow:auto;display:flex;flex-direction:column-reverse"><div style="height:60px;flex:none">입력창</div><div class="flex-col-reverse" style="display:flex;flex-direction:column-reverse;flex:none">${messages.map(row).reverse().join('')}</div></div>`;
      window.risuai={pluginStorage:{getItem:async k=>saved.get(k),setItem:async(k,v)=>saved.set(k,v)},getLocalPluginStorage:async()=>({getItem:async k=>local.get(k),setItem:async(k,v)=>local.set(k,v),removeItem:async k=>local.delete(k)}),
        getDatabase:async()=>({modules:[],enabledModules:[]}),setDatabase:async()=>{},requestPluginPermission:async()=>true,getRootDocument:async()=>new Safe(document.documentElement),
        unwarpSafeArray:async a=>{const result=[];for(let i=0,n=await a.length();i<n;i++)result.push(await a.at(i));return result;},
        createMutationObserver:async fn=>{const observer=new MutationObserver(rows=>fn(rows.map(row=>({getTarget:async()=>new Safe(row.target)}))));return {observe:async(target,options)=>observer.observe(target.node,options),disconnect:async()=>observer.disconnect()};},
        addRisuChatListener:async()=>{},removeRisuChatListener:async()=>{},onUnload:async()=>{},
        getCurrentCharacterIndex:async()=>0,getCurrentChatIndex:async()=>0,
        getChatFromIndex:async()=>{count('api.getChat');return structuredClone({id:'chat',isStreaming:window.streaming===true,message:window.messages});},
        getCharacter:async()=>{count('api.getCharacter');return structuredClone({chaId:'c',name:'하린',chatPage:0,chats:[{id:'chat',isStreaming:window.streaming===true,message:window.messages}]});},
        nativeFetch:async()=>({ok:false,status:599,arrayBuffer:async()=>new ArrayBuffer(0),json:async()=>({}),text:async()=>''})};
      window.Audio=class{src='';currentTime=0;duration=1;async play(){}pause(){}load(){}removeAttribute(){this.src='';}};
      window.AudioContext=class{state='running';destination={};async resume(){}createGain(){return {gain:{value:1},connect(){return this;}};}createMediaElementSource(){return {connect(node){return node;}};}};
      window.middle=()=>{const y=innerHeight/2;const hit=[...document.querySelectorAll('.risu-chat')].find(n=>{const r=n.getBoundingClientRect();return r.top<=y&&r.bottom>=y;});return hit?'m'+hit.getAttribute('data-chat-index'):'';};
      window.readingId=()=>window.omniTts.list[0]?.messageId||'';
    },{blockedSource,MESSAGES,LINES,PICTURE});
    await page.addScriptTag({content:built.outputFiles[0].text});
    await page.evaluate(async()=>{await window.loadTtsData();await window.loadSoundData();await window.updateTtsSettings({enabled:true,viewer:true,autoAssign:false,prefetch:0});await window.updateSoundSettings({bgmEnabled:false,sfxEnabled:false});await window.installTtsHost();});
    // Scrolled well up into the chat (not to its middle, where a halving's first look lands either way): the reader is
    // on the message across the middle of the screen, found among messages drawn bottom up.
    await page.evaluate(()=>{const screen=document.querySelector('.default-chat-screen');screen.scrollTop=-(screen.scrollHeight-screen.clientHeight)*0.72;});
    await page.waitForFunction(()=>window.middle()&&window.readingId()===window.middle(),undefined,{timeout:8000});
    await page.waitForTimeout(500);
    const reset=()=>page.evaluate(()=>{window.calls={};window.bytes=0;window.readMessages=[];});
    const measured=()=>page.evaluate(()=>({calls:window.calls,bytes:window.bytes,read:[...new Set(window.readMessages)]}));
    const sum=c=>Object.entries(c).filter(([k])=>!k.startsWith('event:')&&k!=='released').reduce((s,[,v])=>s+v,0);

    // Something in the chat screen changed that is no message: a scan asks which messages to go through, and reads none.
    await reset();
    await page.evaluate(()=>{const note=document.createElement('span');note.textContent='.';document.querySelector('.default-chat-screen').append(note);});
    await page.waitForTimeout(700);
    const idle=await measured();
    assert.equal(idle.bytes,0,`nothing read of any message: ${JSON.stringify(idle)}`);
    assert.equal((idle.calls['api.getCharacter']||0)+(idle.calls['api.getChat']||0),0,'nor of the chat');
    assert.ok(sum(idle.calls)<=30,`a few calls whatever the chat's length (${sum(idle.calls)}: ${JSON.stringify(idle.calls)})`);

    // A line added to one message: only it is read, without its picture.
    await reset();
    await page.evaluate(()=>{const i=12;window.messages[i].data+='\n'+window.lineOf(i,9);const p=document.createElement('p');p.innerHTML=window.lineOf(i,9)+'<span data-omnitts-tail="1"><button type="button" data-omnitts-play="1" data-omnitts-kind="dialogue" style="width:12px;height:12px"></button></span>';document.querySelector('.risu-chat[data-chat-index="12"]').append(p);});
    await page.waitForFunction(()=>document.querySelectorAll('.risu-chat[data-chat-index="12"] [x-omnitts-bound]').length===7);
    await page.waitForTimeout(400);
    const one=await measured();
    assert.deepEqual(one.read,[12],'only the message that changed is read');
    assert.ok(one.bytes<20_000,`and not its picture (${one.bytes} bytes; the picture alone is ${PICTURE})`);
    assert.equal(one.calls.released>0,true,'the lists Risu hands out are let go');

    // A reply streaming into the newest message: each chunk reads that message alone.
    await reset();
    await page.evaluate(()=>{window.streaming=true;window.__OMNI_REPLY_STREAMING__=()=>true;});
    for(let chunk=0;chunk<4;chunk++){
      await page.evaluate(chunk=>{const i=window.messages.length-1,j=20+chunk;window.messages[i].data+='\n'+window.lineOf(i,j);const p=document.createElement('p');p.innerHTML=window.lineOf(i,j)+'<span data-omnitts-tail="1"><button type="button" data-omnitts-play="1" data-omnitts-kind="dialogue" style="width:12px;height:12px"></button></span>';document.querySelector(`.risu-chat[data-chat-index="${i}"]`).append(p);},chunk);
      await page.waitForTimeout(450);
    }
    await page.evaluate(()=>{window.streaming=false;window.__OMNI_REPLY_STREAMING__=()=>false;});
    const streamed=await measured();
    assert.deepEqual(streamed.read,[MESSAGES-1],`every chunk read the reply alone (${JSON.stringify(streamed.read)})`);
    assert.ok(streamed.bytes<4*20_000,`never a picture (${streamed.bytes} bytes)`);
    assert.ok((streamed.calls['api.getCharacter']||0)<=1&&(streamed.calls['api.getChat']||0)>=3,`the bot itself is not read again for each chunk, the chat alone (${JSON.stringify(streamed.calls)})`);

    // The TTS window folded, unfolded and moved: settings that shape no line read nothing of the chat.
    await page.waitForTimeout(400);
    await reset();
    await page.evaluate(async()=>{await window.updateTtsSettings({minimized:true});await window.updateTtsSettings({minimized:false});await window.updateTtsSettings({viewerAnchor:{right:16,top:8}});await window.updateTtsSettings({volume:.5});});
    await page.waitForTimeout(900);
    const settings=await measured();
    assert.equal(settings.bytes,0,`no message read (${JSON.stringify(settings)})`);
    assert.equal(settings.calls.chatQuery||0,0,'no scan at all');
    assert.equal((settings.calls['api.getCharacter']||0)+(settings.calls['api.getChat']||0),0,'nor the chat');

    // A tap on a line in the middle of the screen plays that line: the message under it found by halving.
    await page.evaluate(async()=>{await window.omniTts.player.unlock();window.omniTts.play=async(list,index)=>{window.played=list[index];};});
    await reset();
    const target=await page.evaluate(()=>{const id=window.middle(),node=document.querySelector(`.risu-chat[data-chat-index="${id.slice(1)}"] [data-omnitts-kind="dialogue"]`),r=node.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,id,text:node.parentElement.parentElement.textContent};});
    await page.mouse.click(target.x,target.y);
    await page.waitForFunction(()=>!!window.played);
    const tap=await measured(),played=await page.evaluate(()=>({id:window.played.messageId,text:window.played.segment.text}));
    assert.equal(played.id,target.id,'the message tapped');
    assert.ok(target.text.includes(played.text),`the line tapped is the line played (${played.text})`);
    assert.equal(tap.bytes,0,'a tap reads no message');
    assert.ok((tap.calls.getBoundingClientRect||0)<=LINES+12,`the tapped message's controls and a few boxes (${JSON.stringify(tap.calls)})`);
    assert.deepEqual(errors,[]);
  } finally {await browser.close();}
});
