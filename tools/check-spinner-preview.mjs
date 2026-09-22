import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

export async function checkSpinnerPreview(page, source, render) {
  const start=source.indexOf('  const nxSpinnerPreviews=new Map();');
  const end=source.indexOf('  async function paintAllMsgFans()',start);
  assert.ok(start>=0 && end>start,'must execute the shipped preview painter');
  const code=source.slice(start,end);
  await page.addScriptTag({content:readFileSync(new URL('../node_modules/dompurify/dist/purify.min.js',import.meta.url),'utf8')});
  const pending=[0,1,2,3].map(i=>render(`[[@inrayspinner::job_${i}::512::768]]`)).join('');
  const result=await page.evaluate(async({code,pending,completed})=>{
    // Risu's chat parser prefixes classes and sanitizes module HTML before the
    // plugin receives SafeElements. Direct setAttribute('x-*') happens later.
    DOMPurify.addHook('uponSanitizeAttribute',(_node,data)=>{
      if(data.attrName==='class')data.attrValue=data.attrValue.split(' ').map(v=>v.startsWith('hljs')||v.startsWith('x-risu-')?v:'x-risu-'+v).join(' ');
    });
    const sanitize=html=>DOMPurify.sanitize(html);
    const check=(value,message)=>{if(!value)throw new Error(message);};
    const seen=new WeakMap();
    let appendGate=null,queries=0,markupReads=0,releases=0;
    class SafeElement {
      #node;
      constructor(node){this.#node=node;}
      querySelector(selector){const n=this.#node.querySelector(selector);return n instanceof HTMLElement?wrap(n):null;}
      getOuterHTML(){markupReads++;return this.#node.outerHTML;}
      release(){releases++;}
      getParent(){return this.#node.parentElement?wrap(this.#node.parentElement):null;}
      getAttribute(name){if(!name.startsWith('x-'))throw new Error('unsupported attribute read');return this.#node.getAttribute(name);}
      setAttribute(name,value){if(!name.startsWith('x-'))throw new Error('unsupported attribute write');this.#node.setAttribute(name,value);}
      setStyleAttribute(css){this.#node.style.cssText=css;}
      setInnerHTML(html){this.#node.innerHTML=sanitize(html);}
      async appendChild(child){if(appendGate)await appendGate;this.#node.appendChild(child.#node);}
      remove(){this.#node.remove();}
    }
    const wrap=n=>{if(!seen.has(n))seen.set(n,new SafeElement(n));return seen.get(n);};
    const doc={querySelector:s=>{queries++;const n=document.querySelector(s);return n?wrap(n):null;},querySelectorAll:s=>{queries++;return [...document.querySelectorAll(s)].map(wrap);}};
    const ownScope=()=>{const refs=new Set();return {own:n=>{if(n)refs.add(n);return n;},all:async nodes=>{for(const n of nodes)refs.add(n);return nodes;},close:async()=>{for(const n of refs)n.release();}};};
    const H=async(_doc,tag,{html})=>{const n=wrap(document.createElement(tag));n.setInnerHTML(html);return n;};
    const logs=[];
    const make=()=>new Function('t','Z','H','nxEnsureFanRemountWatch','y','omniMountFooters','omniStreamObservers','omniDomScope',code+';return {paint:nxPaintSpinnerPreviews,accept:globalThis.__OMNI_SPINNER_PREVIEW__,clear:globalThis.__OMNI_CLEAR_SPINNER_PREVIEW__,rows:nxSpinnerPreviews,schedule:nxScheduleSpinnerPreviews,dispose:nxDisposeSpinnerPreviews};')(
      {hostDoc:doc},async()=>{throw Error('Preview must not load the full character/chat');},H,()=>{},(...args)=>logs.push(args),async()=>{},async()=>{},ownScope);
    const canvas=document.createElement('canvas');canvas.width=512;canvas.height=768;
    canvas.getContext('2d').fillRect(0,0,512,768);const url=canvas.toDataURL('image/png');
    const row=shot=>({jobId:'job',shot,cardId:'card-'+shot,characterId:'bot',chatId:'chat',messageIndex:2,url});
    const mount=html=>{document.body.innerHTML='<div class="risu-chat" data-chat-index="2">'+sanitize(html)+'</div>';};
    const count=()=>document.querySelectorAll('[x-omni-preview]').length;
    const boxes=()=>[...document.querySelectorAll('[data-inray-preview-slot]')].map(n=>{const r=n.getBoundingClientRect();return [r.width,r.height,r.top];});

    mount(pending.replaceAll('data-inray-spinner=','x-inray-spinner=').replaceAll('data-inray-preview-slot=','x-inray-preview-slot=').replaceAll('data-shot=','x-shot='));
    check(!document.querySelector('[x-inray-spinner]'),'sanitizer must reproduce the old missing marker');
    let api=make();await api.accept(row(0));check(count()===0,'old module markup must fail to paint');
    check(logs.some(r=>r[2].startsWith('slot ')),'missing slots need a diagnostic');

    mount(pending);api=make();const initial=boxes();
    check(document.querySelectorAll('.x-risu-omni-spinner').length===4,'each shot must have one dedicated spinner frame');
    check(!document.querySelector('.x-risu-omni-spinner div'),'pending spinner must not contain nested div frames');
    for(let shot=0;shot<4;shot++){
      await api.accept(row(shot));
      await Promise.all([...document.querySelectorAll('[x-omni-preview] img')].map(img=>img.decode()));
      check(count()===shot+1,'each finished image must appear immediately');
      check(JSON.stringify(boxes())===JSON.stringify(initial),'preview must preserve spinner geometry');
      const img=document.querySelector('[x-omni-preview="card-'+shot+'"] img');
      const r=img.getBoundingClientRect(),c=img.parentElement.parentElement.getBoundingClientRect();
      check(r.width<=c.width+1&&r.height<=c.height+1,'image must fit inside its slot');
    }
    queries=0;markupReads=0;const releasedBefore=releases;
    await api.paint();check(count()===4,'repaint must not duplicate images');
    check(queries===1&&markupReads===0,'unchanged previews need one filtered query and no markup reads');
    for(let i=0;i<100;i++)api.schedule();
    await new Promise(resolve=>setTimeout(resolve,160));
    check(queries===2&&markupReads===0,'100 mutation callbacks must coalesce into one additional query');
    mount(pending.replaceAll('data-inray-spinner=','x-inray-spinner='));
    await api.paint();check(count()===4,'dedicated class and shot identity must paint without the fallback marker');
    mount(pending);await api.paint();check(count()===4,'new message DOM must regain all previews');
    check(releases>releasedBefore,'temporary host references must be released after painting');
    check(document.querySelectorAll('[data-inray-spinner]').length===4,'painting must retain spinners');

    mount(pending);api=make();let release;appendGate=new Promise(resolve=>{release=resolve;});
    const painting=api.accept(row(0));
    // Yield until the asynchronous painter reaches its gated append.
    await new Promise(resolve=>setTimeout(resolve,0));
    await api.clear('job');release();await painting;appendGate=null;
    check(api.rows.size===0,'finalization releases references without an asset decode probe');
    mount(completed.replace('{{raw::inxshot_card-0.webp}}',url));
    await api.paint();
    check(count()===0&&api.rows.size===0,'final message DOM must never regain base64 previews');
    await api.accept(row(0));check(count()===0&&api.rows.size===0,'late completion must not reopen a closed job');
    const beforeIdle=queries;api.schedule();api.dispose();
    await new Promise(resolve=>setTimeout(resolve,160));
    check(queries===beforeIdle,'idle/disposed previews must not poll');
    check(!JSON.stringify(logs).includes(url),'diagnostics must not contain image bytes');
    return {passed:true};
  },{code,pending,completed:render('[[@inrayspinner::job_0::512::768]][[@inray::card-0::inxshot_card-0.webp::512::768]]')});
  assert.equal(result.passed,true);
  console.log('Sanitized spinner preview: old-marker failure, 4 sequential images, fixed geometry, remount, dedupe and late-completion cleanup passed.');
}
