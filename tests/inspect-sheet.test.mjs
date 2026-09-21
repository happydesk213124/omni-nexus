import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {repairAsyncInspect,repairInspectFullscreen} from '../tools/vendor-patches/inspect.mjs';

const runtime=await readFile('tools/vendor-patches/inspect-runtime.js','utf8');
const vendor=await readFile('vendor/inlay-nexus-ui.js','utf8');
const config=await readFile('vite.config.ts','utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('asserted sheet replacement accepts the frozen contract and rejects a changed action',()=>{
  const normalized=config.replaceAll('\r\n','\n');
  const constant=name=>{
    const at=normalized.indexOf('const '+name+' = '),start=normalized.indexOf('`',at),end=normalized.indexOf('`;\n',start)+1;
    assert.ok(at>=0&&end>start);return runInNewContext(normalized.slice(start,end));
  };
  let source=vendor.replaceAll('\r\n','\n');
  for(const name of ['VENDOR_SHOW_INSPECT_ABORT','VENDOR_SHOW_INSPECT_COMMIT'])source=source.replace(constant(name+'_NEEDLE'),constant(name+'_PATCH'));
  source=source.replace('await addInspectBtn(chipRow, "base", "base"','await addInspectBtn(chipRow, "수정", "base"')
    .replace('border-radius:10px;padding:9px 14px;font:700 12px Segoe UI','border-radius:12px;padding:9px 14px;font:700 12px Segoe UI')
    .replace('addInspectBtn(actRow, "재생성", "regen", `${actStyle};background:rgba(124,108,255,.92);color:#fff`)','addInspectBtn(actRow, "재생성", "regen", `${actStyle};background:#7132f5;color:#fff`)');
  source=repairInspectFullscreen(source);
  assert.ok(repairAsyncInspect(source).includes('nxEnsureInspectSheet'));
  const broken=source.replace('await addInspectBtn(closeRow, "닫기"','await addInspectBtn(closeRow, "BROKEN"');
  assert.notEqual(source,broken);
  assert.throws(()=>repairAsyncInspect(broken),/frozen sheet drift/);
});
function sheet() {
  const nodes=[],writes=[];
  class Element {
    constructor(tag) {this.tag=tag;this.children=[];this.html='';this.style='';}
    async setStyleAttribute(value) {this.style=value;writes.push(['style',this,value]);}
    async setInnerHTML(value) {this.html=value;this.children=[];writes.push(['html',this,value]);}
    async setTextContent(value) {this.text=value;}
    async appendChild(child) {this.children.push(child);}
  }
  const fullscreen=new Element('fullscreen'),actionMenu=new Element('menu');
  const c={t:{},inspectOpen:false,actionCard:null,pendingSheetHit:null,inspectGuardUntil:0,inspectZones:[],inspectSheetEl:null,
    nxInspectShell:null,nxInspectBuild:null,nxInspectImageHtml:'',nxInspectPaint:Promise.resolve(),
    fullscreen,actionMenu,hidePressFill:async()=>{},Ie:()=> 'data:image/png;base64,CACHED',h:value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),w:value=>String(value),
    e:{createElement:async tag=>{const node=new Element(tag);nodes.push(node);return node;}},
    hideActionMenu:async()=>{c.actionCard=null;c.inspectZones=[];c.inspectSheetEl=null;await actionMenu.setStyleAttribute('display:none');},
    hideFullscreen:async()=>fullscreen.setStyleAttribute('display:none')};
  const hStart=vendor.indexOf('  async function H(e, n, o = {}) {'),hEnd=vendor.indexOf('  async function rt(',hStart);
  runInNewContext(vendor.slice(hStart,hEnd)+'const '+runtime+'end = null; this.show=showStickyInspect;this.update=updateStickyInspect;',c);
  const a=config.indexOf('const VENDOR_HIDE_INSPECT_BIND_PATCH ='),b=config.indexOf('hideInspect = async () => {',a),end=config.indexOf('\n    };',b);
  runInNewContext('const '+config.slice(b,end)+'};this.close=hideInspect;',c);
  return {c,nodes,writes};
}

test('frozen sheet exposes close during loading and reuses all nodes on reopen',async()=>{
  const {c,nodes}=sheet();
  const view={id:'a',image_url:'',characters:[],_nxAssetLoading:true,_nxCastLoading:true};
  await c.show(view);
  assert.match(c.fullscreen.html,/이미지 불러오는 중/);
  assert.match(c.fullscreen.style,/display:flex/);
  assert.deepEqual(Array.from(c.inspectZones,z=>z.act),['retag','regen','reroll','base','close']);
  const edit=c.inspectZones.find(z=>z.act==='base').el,reroll=c.inspectZones.find(z=>z.act==='reroll').el;
  assert.equal(edit.style.split(';background:')[0],reroll.style.split(';background:')[0]);
  assert.match(edit.style,/background:rgba\(124,108,255,.22\)/);
  view.image_url='data:image/png;base64,FILE';view._nxAssetLoading=false;
  await c.update(view);
  assert.match(c.fullscreen.html,/base64,FILE/);
  view.characters=[{name:'Alice',cast_id:'9396'}];view._nxCastLoading=false;
  await c.update(view);
  const count=nodes.length,zone=c.inspectZones.find(z=>z.act==='char');
  assert.equal(zone.el.text,'c1·Alice');assert.equal(zone.charI,0);
  await c.close();assert.equal(c.inspectOpen,false);assert.match(c.actionMenu.style,/display:none/);
  await c.show({...view});
  assert.equal(nodes.length,count,'reopening must create zero SafeDOM elements');
  assert.equal(c.inspectZones.find(z=>z.act==='char').el,zone.el);
  assert.equal(c.inspectZones.find(z=>z.act==='reroll').act,'reroll');
});

test('closing during delayed host paint never reopens or hides the next inspect',async()=>{
  const {c}=sheet();let release;
  const original=c.fullscreen.setInnerHTML.bind(c.fullscreen);
  c.fullscreen.setInnerHTML=async html=>{await new Promise(resolve=>{release=resolve;});await original(html);};
  const old=c.show({id:'old',image_url:'',characters:[],_nxAssetLoading:true});await tick();
  const closing=c.close();
  c.fullscreen.setInnerHTML=original;
  const fresh=c.show({id:'new',image_url:'data:image/png;base64,NEW',characters:[{name:'New'}]});
  release();await old;await fresh;await closing;
  assert.equal(c.actionCard.id,'new');assert.match(c.fullscreen.html,/base64,NEW/);assert.match(c.actionMenu.style,/display:flex/);
  await c.close();const hidden=c.actionMenu.style;
  await c.update({id:'old',image_url:'data:image/png;base64,OLD',characters:[]});
  assert.equal(c.actionMenu.style,hidden);assert.equal(c.inspectOpen,false);
});

test('updated chips keep frozen character indexes and escape names through text nodes',async()=>{
  const {c,nodes}=sheet();
  const view={id:'a',image_url:'data:image/png;base64,FILE',characters:[{name:'Old'}]};
  await c.show(view);const shell=c.inspectSheetEl,staticButtons=nodes.filter(n=>['수정','태그','리롤','닫기'].includes(n.text));
  view.characters=[{name:'<img onerror=evil>'},{name:'Second'}];
  await c.update(view);
  assert.equal(c.inspectSheetEl,shell);
  assert.deepEqual(Array.from(c.inspectZones.filter(z=>z.act==='char'),z=>[z.charI,z.el.text]),[[0,'c1·<img onerror=evil>'],[1,'c2·Second']]);
  for(const node of staticButtons)assert.ok(c.inspectZones.some(z=>z.el===node));
});

test('open paints the empty overlay before content; cast loading is a spinner left of close',async()=>{
  const {c,nodes,writes}=sheet();
  await c.show({id:'a',image_url:'',characters:[],_nxAssetLoading:true,_nxCastLoading:true});
  const styleIdx=writes.findIndex(([kind,el])=>kind==='style'&&el===c.fullscreen&&/display:flex/.test(el.style));
  const htmlIdx=writes.findIndex(([kind,el])=>kind==='html'&&el===c.fullscreen);
  assert.ok(styleIdx>=0&&htmlIdx>=0&&styleIdx<htmlIdx,'backdrop must land before content');
  const spinner=nodes.find(n=>n.tag==='div'&&/nxInspectSpin/.test(n.style||''));
  assert.ok(spinner,'spinner node exists');
  const closeRow=nodes.find(n=>(n.children||[]).includes(spinner));
  assert.ok(closeRow,'spinner lives in a row');
  assert.equal(closeRow.children[0],spinner,'spinner sits left of close');
  assert.ok(closeRow.children.some(n=>n.text==='닫기'));
  const statuses=c.inspectSheetEl.children.filter(n=>(n.children||[]).length===0);
  assert.equal(statuses.length,1,'single status node');
  assert.ok(!('text' in statuses[0]),'status row never written while cast resolves');
  assert.match(spinner.style,/animation:nxInspectSpin/,'spinner visible while loading');
});

test('cast resolve hides the spinner and keeps errors on the status row',async()=>{
  const {c,nodes}=sheet();
  const view={id:'a',image_url:'',characters:[],_nxAssetLoading:true,_nxCastLoading:true};
  await c.show(view);
  const spinner=nodes.find(n=>n.tag==='div'&&/nxInspectSpin/.test(n.style||''));
  view.characters=[{name:'Alice',cast_id:'9396'}];view._nxCastLoading=false;
  await c.update(view);
  assert.match(spinner.style,/display:none/,'spinner hidden after resolve');
  view._nxCastError='캐릭터 이름을 불러오지 못했습니다.';
  await c.update(view);
  const status=nodes.find(n=>n.tag==='div'&&('text' in n));
  assert.match(status.text,/불러오지 못했습니다/,'hard errors keep the status row');
});

test('rapid close then open ends open through the single queue',async()=>{
  const {c}=sheet();
  await c.show({id:'a',image_url:'data:image/png;base64,A',characters:[]});
  const closing=c.close();
  const opening=c.show({id:'b',image_url:'data:image/png;base64,B',characters:[]});
  await closing;await opening;
  assert.equal(c.inspectOpen,true);
  assert.equal(c.actionCard.id,'b');
  assert.match(c.fullscreen.html,/base64,B/);
  assert.match(c.actionMenu.style,/display:flex/);
});

test('inspect toggle repairs apply to the frozen bundle and reject drift',async()=>{
  const {readFile}=await import('node:fs/promises');
  const {repairInspectCloseNow,repairInspectGuardClose,repairInspectGuardCloseUp}=await import('../tools/vendor-patches/inspect.mjs');
  const vendorSrc=await readFile('vendor/inlay-nexus-ui.js','utf8');
  const out=repairInspectGuardCloseUp(repairInspectGuardClose(repairInspectCloseNow(vendorSrc)));
  assert.ok(out.includes('hideInspect().catch(() => {})'),'close fires without awaiting');
  assert.ok(out.includes('nxCloseZone'),'guard still delivers close taps');
  assert.ok(out.includes('hit.act === "close"'),'fast close taps survive pointerup');
  assert.throws(()=>repairInspectCloseNow(vendorSrc.replace('act === "close"','act === "BROKEN"')),/close dispatch needle drift/);
  assert.throws(()=>repairInspectGuardClose(vendorSrc.replace('kind: "guard"','kind: "BROKEN"')),/guard pointerdown needle drift/);
  assert.throws(()=>repairInspectGuardCloseUp(vendorSrc.replace('if (Date.now() < inspectGuardUntil || hit?.kind === "guard") return;','if (Date.now() < inspectGuardUntil || hit?.kind === "BROKEN") return;')),/guard pointerup needle drift/);
});
