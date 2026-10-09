import {build} from 'esbuild';
import assert from 'node:assert/strict';
const output=await build({entryPoints:['src/domain/prompt/stream-signal.ts','src/domain/prompt/message-body.ts'],bundle:true,write:false,format:'esm',outdir:'unused'});
const modules=await Promise.all(output.outputFiles.map(file=>import('data:text/javascript;base64,'+Buffer.from(file.text).toString('base64'))));
const {createStreamSignalScanner}=modules.find(module=>module.createStreamSignalScanner);
const {findStreamSignal}=modules.find(module=>module.findStreamSignal);
const chunk='The characters continue their conversation in the garden.\n'.repeat(9);
const snapshots=Array.from({length:240},(_,i)=>chunk.repeat(i+1));
const keys=['image/start','RP-Guide'];
const measure=(incremental)=>{
  const scanner=createStreamSignalScanner();let chars=0;
  const at=performance.now();
  for(const text of snapshots){
    assert.equal(incremental?scanner.scan(text,keys):findStreamSignal(text,keys),null);
    chars+=text.length;
  }
  return {ms:performance.now()-at,characters:incremental?scanner.scannedCharacters:chars,fullScans:incremental?scanner.fullScans:snapshots.length};
};
for(let i=0;i<3;i++){measure(false);measure(true);}
const before=[],after=[];
for(let i=0;i<7;i++){before.push(measure(false));after.push(measure(true));}
const median=rows=>rows.sort((a,b)=>a.ms-b.ms)[3];
const old=median(before),next=median(after);
assert.equal(next.characters,snapshots.at(-1).length);
assert.equal(next.fullScans,0);
console.log(JSON.stringify({updates:snapshots.length,finalCharacters:snapshots.at(-1).length,
  before:{...old,ms:+old.ms.toFixed(2)},after:{...next,ms:+next.ms.toFixed(2)},
  elapsedReductionPercent:+((1-next.ms/old.ms)*100).toFixed(1)},null,2));
