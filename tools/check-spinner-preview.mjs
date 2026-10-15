import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

/**
 * The shipped preview painter, run against sanitized module markup. Previews are
 * one <style> rule per image outside the chat, so a rebuilt or remounted message
 * shows them at once without any host query.
 */
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
    let queries=0,lists=0,markupReads=0,sends=0,releases=0;
    class SafeElement {
      #node;
      constructor(node){this.#node=node;}
      querySelector(selector){queries++;const n=this.#node.querySelector(selector);return n instanceof HTMLElement?wrap(n):null;}
      getOuterHTML(){markupReads++;return this.#node.outerHTML;}
      release(){releases++;}
      setTextContent(text){sends++;this.#node.textContent=text;}
      async appendChild(child){this.#node.appendChild(child.#node);}
      remove(){this.#node.remove();}
    }
    const wrap=n=>{if(!seen.has(n))seen.set(n,new SafeElement(n));return seen.get(n);};
    const doc={querySelector:s=>{queries++;const n=document.querySelector(s);return n?wrap(n):null;},querySelectorAll:s=>{lists++;return [...document.querySelectorAll(s)].map(wrap);},
      createElement:tag=>wrap(document.createElement(tag))};
    const logs=[];
    const make=()=>new Function('t','y','omniMountFooters','omniRelease',code+';return {paint:nxPaintSpinnerPreviews,accept:globalThis.__OMNI_SPINNER_PREVIEW__,clear:globalThis.__OMNI_CLEAR_SPINNER_PREVIEW__,release:globalThis.__OMNI_REPAINT_SPINNER_PREVIEWS__,schedule:nxScheduleSpinnerPreviews,dispose:nxDisposeSpinnerPreviews,rows:nxPreviewRules,previews:nxSpinnerPreviews};')(
      {hostDoc:doc},(...args)=>logs.push(args),async()=>{},async v=>{if(v?.release)v.release();});
    const canvas=document.createElement('canvas');canvas.width=512;canvas.height=768;
    canvas.getContext('2d').fillRect(0,0,512,768);const url=canvas.toDataURL('image/png');
    const row=shot=>({jobId:'job',shot,cardId:'card-'+shot,characterId:'bot',chatId:'chat',messageIndex:2,url});
    const mount=html=>{document.querySelector('#chat')?.remove();const chat=document.createElement('div');chat.id='chat';chat.innerHTML='<div class="risu-chat" data-chat-index="2">'+sanitize(html)+'</div>';document.body.prepend(chat);};
    const painted=()=>[...document.querySelectorAll('[data-inray-preview-slot]')].filter(n=>getComputedStyle(n).backgroundImage.includes('data:image/png')).length;
    const wheelsHidden=()=>[...document.querySelectorAll('[data-inray-preview-slot] svg')].filter(n=>getComputedStyle(n).opacity==='0').length;
    const boxes=()=>[...document.querySelectorAll('[data-inray-preview-slot]')].map(n=>{const r=n.getBoundingClientRect();return [r.width,r.height,r.top];});
    const styles=()=>document.querySelectorAll('body > style').length;

    mount(pending.replaceAll('data-inray-spinner=','x-inray-spinner=').replaceAll('data-inray-preview-slot=','x-inray-preview-slot=').replaceAll('data-shot=','x-shot='));
    check(!document.querySelector('[x-inray-spinner]'),'sanitizer must reproduce the old missing marker');
    let api=make();await api.accept(row(0));
    check(document.querySelectorAll('[data-inray-preview-slot]').length===0 && styles()===1,'old module markup has no slot to paint; the rule waits harmlessly');
    api.dispose();await new Promise(resolve=>setTimeout(resolve,0));
    check(styles()===0,'dispose removes every rule');

    mount(pending);api=make();queries=0;lists=0;
    await api.accept({...row(0),deferPaint:true});
    check(lists===0 && markupReads===0 && queries===1,'a preview needs only the one body lookup: no chat query, no markup read');
    check(painted()===1,'a line batch preview shows as soon as its slot exists');
    api.dispose();await new Promise(resolve=>setTimeout(resolve,0));

    mount(pending);api=make();const initial=boxes();
    check(document.querySelectorAll('.x-risu-omni-spinner').length===4,'each shot must have one dedicated spinner frame');
    sends=0;
    for(let shot=0;shot<4;shot++){
      await api.accept(row(shot));
      check(painted()===shot+1 && wheelsHidden()===shot+1,'each finished image must appear immediately, over the wheel');
      check(JSON.stringify(boxes())===JSON.stringify(initial),'preview must preserve spinner geometry');
    }
    await api.accept(row(0));check(sends===4,'an unchanged image is never sent again');
    queries=0;lists=0;markupReads=0;
    for(let i=0;i<100;i++)api.schedule();await api.paint();
    await new Promise(resolve=>setTimeout(resolve,160));
    check(queries===0 && lists===0 && markupReads===0,'chat mutations cost nothing: there is nothing to repaint');
    check(api.previews.size===0,'the mutation watcher never has previews to wait for');
    mount(pending);
    check(painted()===4,'a rebuilt message shows every image at once');
    check(queries===0 && lists===0,'rebuilding needs no host call');

    mount(pending);await api.clear('job');
    check(painted()===4,'a finished job keeps its images until its slots are replaced');
    mount(completed.replace('{{raw::inxshot_card-0.webp}}',url));
    await new Promise(resolve=>setTimeout(resolve,2300));
    check(api.rows.size===0 && styles()===0,'the rules go once the slots are gone');
    check(!document.querySelector('[data-inray-spinner]') || painted()===0,'final message DOM never carries a base64 preview');
    await api.accept(row(0));check(api.rows.size===0 && styles()===0,'late completion must not reopen a closed job');
    check(!JSON.stringify(logs).includes(url),'diagnostics must not contain image bytes');
    check(releases>0,'temporary host references must be released');
    api.dispose();
    return {passed:true};
  },{code,pending,completed:render('[[@inrayspinner::job_0::512::768]][[@inray::card-0::inxshot_card-0.webp::512::768]]')});
  assert.equal(result.passed,true);
  console.log('Spinner preview rules: no-host-call paint, immediate images over the wheel, fixed geometry, rebuild/remount, send-once, sweep after bake and late-completion cleanup passed.');
}
