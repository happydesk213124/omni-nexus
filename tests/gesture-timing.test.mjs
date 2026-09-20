import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../dist/omninexus.js',import.meta.url),'utf8');
function section(a,b){const start=source.indexOf(a),end=source.indexOf(b,start);assert.ok(start>=0&&end>start);return source.slice(start,end);}
const down=section('p = f => {','    }, resolvePointerDown = async')+'}';
const arm=section('      const nxArmInspect = (F) => {','      // Msg chips:');
const up=section('onPointerUp = async (f) => {','      if (t.uiOpen || t._hostChromeBlocked)')+'}';
const cancel=section('onPointerCancel = () => {','    }, m = async')+'}';
const drain=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};

function harness(armSource=arm){
  let now=0,id=0,release;
  const timers=new Map(),opened=[];
  let gate=Promise.resolve();
  const deps={Date:{now:()=>now},setTimeout:(fn,ms)=>{timers.set(++id,{fn,at:now+ms});return id;},clearTimeout:id=>timers.delete(id),
    wait:()=>gate,nxInspectAllowed:()=>true,nxAssetNameOf:async()=>'',nxOpenAssetInspect:async card=>opened.push(card.id)};
  const api=new Function(...Object.keys(deps),`
    let nxPhysical=null,nxPointerWork=Promise.resolve(),mobilePress=null,pointerGesture=null,pinClick=null,pendingSheetHit=null;
    const t={},PRESS_MS=550;
    const cancelMobilePress=()=>{if(mobilePress?.timer)clearTimeout(mobilePress.timer);mobilePress=null;};
    const resolvePointerDown=async(f,physical)=>{
      await wait();const F={card:{id:'a'},thumb:{}};mobilePress=F;
      ${armSource}
      nxArmInspect(F);
    };
    const ${down};const ${up};const ${cancel};
    return {down:p,up:onPointerUp,cancel:onPointerCancel};
  `)(...Object.values(deps));
  return {...api,opened,pause:()=>{gate=new Promise(r=>release=r);},release:()=>release(),tick:async ms=>{now+=ms;for(const [id,v]of [...timers])if(v.at<=now){timers.delete(id);v.fn();}await drain();}};
}

test('release before SafeDOM hit resolution never arms a phantom long press',async()=>{
  const h=harness();h.pause();
  const down=h.down({pointerId:1,clientX:10,clientY:10});
  const up=h.up({pointerId:1});
  await h.tick(900);h.release();await Promise.all([down,up]);await h.tick(900);
  assert.deepEqual(h.opened,[]);
});
test('a held pointer opens once at 550ms; cancel prevents it',async()=>{
  const h=harness();await h.down({pointerId:1,clientX:10,clientY:10});
  await h.tick(549);assert.deepEqual(h.opened,[]);
  await h.tick(1);assert.deepEqual(h.opened,['a']);
  await h.up({pointerId:1});await h.tick(1000);assert.deepEqual(h.opened,['a']);
  await h.down({pointerId:2,clientX:10,clientY:10});h.cancel();await h.tick(1000);assert.deepEqual(h.opened,['a']);
});
test('late-hit regression test rejects removing physical pointer guards',async()=>{
  const broken=arm.replaceAll('physical.cancelled || !physical.held.size || physical!==nxPhysical || ','');
  assert.notEqual(broken,arm);
  const h=harness(broken);h.pause();const down=h.down({pointerId:1}),up=h.up({pointerId:1});
  h.release();await Promise.all([down,up]);await h.tick(900);
  assert.notDeepEqual(h.opened,[],'the control mutation must reproduce the phantom hold');
});
