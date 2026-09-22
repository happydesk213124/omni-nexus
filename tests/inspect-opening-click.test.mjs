import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// Exercise the shipped patches together: raw inspect-runtime.js still contains
// the old timer guard before gesture-repairs runs at build time.
const source=readFileSync(new URL('../dist/omninexus.js',import.meta.url),'utf8');
function section(startText,endText) {
  const start=source.indexOf(startText),end=source.indexOf(endText,start);
  assert.ok(start>=0&&end>start, startText);
  return source.slice(start,end);
}
const down=section('p = f => {','    }, resolvePointerDown = async')+'}';
const up=section('onPointerUp = async (f) => {','      if (t.uiOpen || t._hostChromeBlocked)')+'}';
const show=section('showStickyInspect = async (f) => {','findActHit = async').trim().replace(/,$/,'');
const click=section('await root.addEventListener("click", async event => {','    await root.addEventListener("keydown"')
  .trim().replace(/^await root\.addEventListener\("click", /,'').replace(/\);$/,'');
const button=section('      // Baked Inray fullscreen chip','      // Baked overlay: 새로고침');
const tap=section('      const nxFireTap = async','      const nxArmInspect =');
const hold=section('      const nxArmInspect = (F) => {','      // Msg chips:');
const drain=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};

function harness(clickSource=click) {
  let now=1000,timerId=0;
  const timers=new Map();
  const deps={Date:{now:()=>now},setTimeout:(fn,ms)=>{timers.set(++timerId,{fn,at:now+ms});return timerId;},clearTimeout:id=>timers.delete(id)};
  const api=new Function(...Object.keys(deps),`
    let nxPhysical=null,nxInspectOpeningPointer=null,nxPointerWork=Promise.resolve();
    let mobilePress=null,pointerGesture=null,pinClick=null,pendingSheetHit=null;
    let inspectOpen=false,actionCard=null,inspectGuardUntil=0,inspectZones=[],inspectSheetEl=null;
    let mode='button',opens=0,closes=0;
    const t={gallery:[{id:'card'}]},PRESS_MS=550,k={};
    const root={box:[0,0,1000,800]},image={box:[250,30,750,630]},closeButton={box:[850,700,990,790]};
    const nxInspectShell={sheet:{box:[200,650,990,800]}},nxInspectMirroredImage=image;
    const node={box:[900,0,1000,100],getAttribute:async()=> 'card'};
    const e={querySelectorAll:async()=>[node]};
    const hitEl=async(el,x,y)=>{const [l,t,r,b]=el.box;return x>=l&&x<=r&&y>=t&&y<=b;};
    const nxAssetNameOf=async()=> 'inxshot_card.webp';
    const nxInspectAllowed=()=>true,nxTapNeed=()=>3;
    const cancelMobilePress=()=>{if(mobilePress?.timer)clearTimeout(mobilePress.timer);mobilePress=null;};
    const hidePressFill=async()=>{};
    const nxPaintInspect=async()=>{opens++;inspectZones=[{el:closeButton,act:'close'}];};
    const runInspectAction=async act=>{if(act==='close'){closes++;inspectOpen=false;t._nxHostInspectOpen=false;t._inspectGen++;t._inspectEpoch=(t._inspectEpoch||0)+1;}};
    const y=(...args)=>{throw Error(args.join(' '));};
    const ${show};
    const nxOpenAssetInspect=async card=>{t._inspectEpoch=(t._inspectEpoch||0)+1;await showStickyInspect({...card});};
    const resolvePointerDown=async(f,physical)=>{
      if(inspectOpen)return;
      const x=f.clientX,I=f.clientY;
      if(mode==='button') {${button}}
      if(mode==='tap') {${tap} await nxFireTap(t.gallery[0],node);return;}
      ${hold}
      const F={card:t.gallery[0],thumb:node};mobilePress=F;nxArmInspect(F);
    };
    const ${down};const ${up};const onClick=${clickSource};
    return {down:p,up:onPointerUp,click:onClick,close:()=>runInspectAction('close'),
      mode:value=>{mode=value;},cancel:()=>{nxPhysical?.held.clear();cancelMobilePress();},
      state:()=>({open:inspectOpen,opens,closes})};
  `)(...Object.values(deps));
  return {...api,tick:async ms=>{now+=ms;for(const [id,t]of [...timers])if(t.at<=now){timers.delete(id);t.fn();}await drain();}};
}
const point={pointerId:1,clientX:950,clientY:50};
const closePoint={pointerId:1,clientX:920,clientY:745};
async function openingPress(h,mode) {
  h.mode(mode);
  if(mode==='tap') for(let i=0;i<2;i++) {
    await h.down(point);await h.up(point);await h.click(point);await h.tick(100);
  }
  await h.down(point);
  if(mode==='hold')await h.tick(550);
  assert.equal(h.state().open,true,'entry must actually open the inspector');
}
async function nextClick(h,pos=point) {
  await h.down(pos);await h.up(pos);await h.click(pos);
}

for(const mode of ['button','hold','tap']) {
  test(`${mode}: opening release is ignored on first open and reopen, next click closes immediately`,async()=>{
    const h=harness();
    for(let i=0;i<2;i++) {
      await openingPress(h,mode);
      // A long pause must not turn the opening gesture into a background click.
      await h.tick(1500);await h.up(point);await h.click(point);
      assert.equal(h.state().open,true,'opening release must not close');
      await nextClick(h);
      assert.equal(h.state().open,false,'next click must close without a timeout');
    }
    assert.equal(h.state().opens,2);assert.equal(h.state().closes,2);
  });
  test(`${mode}: opening click over close is ignored; next close button click works`,async()=>{
    const h=harness();await openingPress(h,mode);
    await h.up(closePoint);await h.click(closePoint);
    assert.equal(h.state().open,true);
    await nextClick(h,closePoint);assert.equal(h.state().open,false);
  });
}

test('a cancelled or missing opening click never swallows the next real click',async()=>{
  for(const cancel of [false,true]) {
    const h=harness();await openingPress(h,'button');
    if(cancel)h.cancel();else await h.up(point);
    await nextClick(h);assert.equal(h.state().open,false);
  }
});

test('opening-click regression check rejects removing gesture ownership',async()=>{
  const broken=click.replace('if (nxPhysical && nxPhysical === nxInspectOpeningPointer) return;', '/* opening gesture guard removed */');
  assert.notEqual(broken,click,'the tested bundle must include the guard');
  const h=harness(broken);await openingPress(h,'button');await h.tick(1500);
  await h.up(point);await h.click(point);
  assert.equal(h.state().open,false,'control mutation must reproduce immediate close');
});
