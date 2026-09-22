// Run separately with installed Chrome: node tools/check-inspect-mirror.mjs
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {chromium} from 'playwright';
const config=readFileSync('vite.config.ts','utf8'),vendor=readFileSync('vendor/inlay-nexus-ui.js','utf8');
const between=(s,a,b)=>{const i=s.indexOf(a),j=s.indexOf(b,i);assert.ok(i>=0&&j>i);return s.slice(i,j);};
const helper=between(vendor,'  async function H(e, n, o = {}) {','  async function rt(');
const opener=between(config,'      const nxOpenAssetInspect = async','      const nxFireTap = async');
const close=between(config.slice(config.indexOf('const VENDOR_HIDE_INSPECT_BIND_PATCH =')),'hideInspect = async () => {','\n    };')+'\n};';
let surface=readFileSync('tools/vendor-patches/inspect-surface.js','utf8');
if(process.argv.includes('--negative-hover'))surface=surface.replace('depth < 4','depth < 0');
let runtime=readFileSync('tools/vendor-patches/inspect-runtime.js','utf8');
// Prove the layout assertion rejects the old auto-height chip area.
if(process.argv.includes('--negative-control'))runtime=runtime.replaceAll('height:72px;min-height:72px;','');
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
 for(const [width,height] of [[900,700],[320,568],[568,320]]) {
  const page=await browser.newPage({viewport:{width,height}});
  await page.setContent('<div data-inlay-inline-shot="a"><div class="inray-bar"><button>Full</button></div><div class="inray-clip"><img class="original"></div></div>');
  await page.addScriptTag({path:'node_modules/dompurify/dist/purify.js'});
  const result=await page.evaluate(async({helper,opener,close,surface,runtime})=>{
   const original=document.querySelector('img'),shot=document.querySelector('[data-inlay-inline-shot]');
   const canvas=document.createElement('canvas');canvas.width=320;canvas.height=1000;
   const blob=await new Promise(r=>canvas.toBlob(r));const url=URL.createObjectURL(blob);
   original.src=url;original.style.cssText='width:60px;height:auto';await original.decode();
   const originalMarkup=shot.outerHTML;
   const state={errors:[],actions:[],routes:[],releases:0,clones:0};
   const pending=new Set();
   class Safe {
    constructor(node){this.node=node;}
    async setStyleAttribute(s){this.node.style.cssText=s;}
    async setClassName(s){this.node.className=s;}
    async setInnerHTML(s){this.node.innerHTML=DOMPurify.sanitize(s);}
    async setTextContent(s){this.node.textContent=s;}
    async appendChild(child){this.node.appendChild(child.node);}
    async remove(){this.node.remove();}
    async cloneNode(deep){state.clones++;return new Safe(this.node.cloneNode(deep));}
    async querySelector(s){const n=this.node.querySelector(s);return n?new Safe(n):null;}
    async closest(){throw Error('closest unsupported by host');}
    async getParent(){const n=this.node.parentElement;return n?new Safe(n):null;}
    async getBoundingClientRect(){return this.node.getBoundingClientRect();}
    async addEventListener(type,fn){
     document.addEventListener(type,event=>{
      const data=type==='keydown'?{key:event.key}:{clientX:event.clientX,clientY:event.clientY};
      const p=Promise.resolve(fn(data)).catch(e=>state.errors.push(String(e)));
      pending.add(p);p.finally(()=>pending.delete(p));
     });return type;
    }
   }
   const e={createElement:async tag=>new Safe(document.createElement(tag)),querySelector:async s=>{throw Error('global fallback must not be needed for hover button');}};
   const o=new Safe(document.body);
   const hitEl=async(el,x,y)=>{const r=await el.getBoundingClientRect();return r.width>0&&r.height>0&&x>=r.left&&x<=r.right&&y>=r.top&&y<=r.bottom;};
   let resolveCast;
   let names=new Promise(r=>{resolveCast=r;});
   const K=async route=>{state.routes.push(route);if(route!=='/v1/shots/resolve-cast')throw Error('pixel I/O forbidden: '+route);return names;};
   window.btoa=()=>{throw Error('base64 forbidden');};
   URL.createObjectURL=()=>{throw Error('new Blob URL forbidden');};
   const script=`
    let nxInspectSurface=null,nxInspectSurfaceBuild=null,nxInspectShell=null,nxInspectBuild=null,nxInspectImageHtml='',nxInspectMirroredImage=null,nxInspectPaint=Promise.resolve();
    const nxInspectDroppedImages=new WeakSet();
    let inspectOpen=false,actionCard=null,pendingSheetHit=null,inspectGuardUntil=0,inspectZones=[],inspectSheetEl=null;
    const t={},k={showContainer:()=>{throw Error('iframe fullscreen forbidden');},hideContainer:()=>{throw Error('iframe hide forbidden');}};
    const h=v=>String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),w=v=>String(v);
    const hidePressFill=async()=>{},Ie=()=>'',y=(...v)=>state.errors.push(v),omniRelease=async()=>{state.releases++;};
    ${helper}
    const ${surface}${runtime}end=null;
    const ${close}
    const runInspectAction=async(act,card,index)=>{state.actions.push([act,card?.id,index]);if(act==='close')await hideInspect();};
    ${opener}
    return {t,open:nxOpenAssetInspect,close:hideInspect,surface:()=>nxInspectSurface,sheet:()=>nxInspectShell};
   `;
   const api=new Function('e','o','hitEl','K','state',script)(e,o,hitEl,K,state);
   const tick=()=>new Promise(r=>setTimeout(r,0));
   const settle=async()=>{await tick();await Promise.all([...pending]);await tick();};
   const click=async(x,y)=>{document.elementFromPoint(x,y).dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:x,clientY:y}));await settle();};
   await api.open({id:'a'},'inxshot_a.c1234-5678-9999.webp',new Safe(shot.querySelector('button')));
   await tick();
   let img=api.surface().fullscreen.node.querySelector('img');await img.decode();
   const imageBefore=img.getBoundingClientRect().toJSON();
   const panelBefore=api.sheet().sheet.node.getBoundingClientRect().toJSON();
   const chipsBefore=api.sheet().castRow.node.getBoundingClientRect().height;
   resolveCast({'1234':'길고 긴 첫 번째 캐릭터 이름','5678':'길고 긴 두 번째 캐릭터 이름','9999':'세 번째 캐릭터 이름'});
   await api.t._inspectLoad;
   const imageAfter=img.getBoundingClientRect().toJSON();
   const panelAfter=api.sheet().sheet.node.getBoundingClientRect().toJSON();
   const stable=JSON.stringify(imageBefore)===JSON.stringify(imageAfter)&&JSON.stringify(panelBefore)===JSON.stringify(panelAfter);
   const chipHeight=api.sheet().castRow.node.getBoundingClientRect().height;
   const actionRects=[...api.sheet().sheet.node.querySelectorAll('button')].filter(n=>['태그','재생성','리롤','수정','닫기'].includes(n.textContent)).map(n=>n.getBoundingClientRect());
   const compact=panelAfter.height<=138&&actionRects.length===5&&actionRects.every(r=>r.top===actionRects[0].top&&r.height===36);
   const noOverlap=imageAfter.bottom<=api.surface().actionMenu.node.getBoundingClientRect().top;
   await click(3,3);
   const openingClickIgnored=api.surface().root.node.style.display!=='none';
   await new Promise(r=>setTimeout(r,420));
   await click(imageAfter.left+imageAfter.width/2,imageAfter.top+imageAfter.height/2);
   const imageOpen=api.surface().root.node.style.display!=='none';
   const edit=[...api.sheet().sheet.node.querySelectorAll('button')].find(n=>n.textContent==='수정').getBoundingClientRect();
   await click(edit.left+edit.width/2,edit.top+edit.height/2);
   await click(3,3);
   const backgroundCloses=api.surface().root.node.style.display==='none';
   names=Promise.resolve({'1234':'Renamed'});
   await api.open({id:'a'},'inxshot_a.c1234.webp',new Safe(shot));await api.t._inspectLoad;
   img=api.surface().fullscreen.node.querySelector('img');await img.decode();
   const reopened=img.src===url;
   const unchanged=shot.outerHTML===originalMarkup;
   const noBase64=img.src===url&&img.src.startsWith('blob:');
   document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));await settle();
   return {...state,compact,stable,chipsBefore,chipHeight,noOverlap,openingClickIgnored,imageOpen,backgroundCloses,reopened,unchanged,noBase64,closed:api.surface().root.node.style.display==='none'};
  },{helper,opener,close,surface,runtime});
  assert.deepEqual(result.errors,[]);
  for(const key of ['compact','stable','noOverlap','openingClickIgnored','imageOpen','backgroundCloses','reopened','unchanged','noBase64','closed'])assert.equal(result[key],true,key);
  assert.equal(result.chipsBefore,72);assert.equal(result.chipHeight,72);
  assert.equal(result.clones,2);
  assert.deepEqual(result.actions,[['base','a',-1],['close','a',-1],['close','a',-1]]);
  assert.ok(result.routes.every(x=>x==='/v1/shots/resolve-cast'));
  console.log(`PASS ${width}x${height}: host mirror, zero pixel I/O, two reserved chip rows, unchanged geometry, controls and backdrop close.`);
  await page.close();
 }
}finally{await browser.close();}
