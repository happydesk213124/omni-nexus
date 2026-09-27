import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync('vite.config.ts','utf8');
const start=source.indexOf('  function nxPlayImageDoneSoundOnce(jobId) {');
const end=source.indexOf('  function nxPrepareImageDoneAudio()',start);
assert.ok(start>=0 && end>start);
const soundSource=source.slice(start,end);

function harness(type='ding',enabled=true,code=soundSource) {
  const notes=[],contexts=[];
  class AudioContext {
    constructor(){this.state='running';this.currentTime=1;this.destination={};contexts.push(this);}
    createOscillator(){
      const note={frequencies:[],ramps:[]};notes.push(note);
      return {
        set type(value){note.type=value;},
        frequency:{setValueAtTime:(...args)=>note.frequencies.push(args)},
        connect:()=>{},disconnect:()=>{note.oscillatorDisconnected=true;},
        start:time=>{note.start=time;},
        stop(time){note.stop=time;note.end=()=>this.onended();},
      };
    }
    createGain(){const note=notes.at(-1);return {gain:{setValueAtTime:()=>{},exponentialRampToValueAtTime:(...args)=>note.ramps.push(args)},connect:()=>{},disconnect:()=>{note.gainDisconnected=true;}};}
    async resume(){this.state='running';}
  }
  const t={backendSettings:{card:{image_done_sound:enabled,image_done_sound_type:type}}};
  const play=new Function('t','globalThis',code+';return nxPlayImageDoneSoundOnce;')(t,{AudioContext});
  return {t,play,notes,contexts};
}

test('completion sound variants are distinct, bounded, once per job, and release audio nodes',()=>{
  const signatures=[];
  for(const type of ['ding','soft','bell','loud']) {
    const h=harness(type);h.play('job1');
    assert.ok(h.notes.length>0);const count=h.notes.length;
    const volume=Math.max(...h.notes.flatMap(n=>n.ramps.map(r=>r[0])));
    assert.ok(volume>0 && volume<=0.25);
    if(type==='soft')assert.ok(volume<0.12);
    if(type==='loud')assert.ok(volume>0.12);
    signatures.push(JSON.stringify(h.notes));
    h.play('job1');assert.equal(h.notes.length,count);
    h.play('job2');assert.equal(h.notes.length,count*2);assert.equal(h.contexts.length,1);
    for(const note of h.notes){assert.ok(note.stop>note.start);assert.ok(note.stop-note.start<1);note.end();assert.equal(note.oscillatorDisconnected,true);assert.equal(note.gainDisconnected,true);}
  }
  assert.equal(new Set(signatures).size,4);
  const disabled=harness('loud',false);disabled.play('job1');assert.equal(disabled.contexts.length,0);
});

test('old enabled settings keep ding and suspended audio resumes before playback',async()=>{
  const h=harness();delete h.t.backendSettings.card.image_done_sound_type;
  h.play('job1');assert.deepEqual(h.notes[0].frequencies,[[880,1],[1174.66,1.11]]);
  h.contexts[0].state='suspended';h.play('job2');assert.equal(h.notes.length,1);
  await Promise.resolve();assert.equal(h.notes.length,2);
});

test('sound regression guard detects removal of the enabled check',()=>{
  const needle='if (t.backendSettings?.card?.image_done_sound !== true) return;';
  assert.ok(soundSource.includes(needle));
  const broken=harness('ding',false,soundSource.replace(needle,''));broken.play('job');
  assert.throws(()=>assert.equal(broken.notes.length,0),assert.AssertionError);
});
