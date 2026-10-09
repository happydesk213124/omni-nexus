import test from 'node:test';
import assert from 'node:assert/strict';
import {createStreamSignalScanner} from '../.test-build/stream-signal.mjs';
import {findStreamSignal} from '../.test-build/message-body.mjs';

test('every split of keywords, thought tags and image delimiters matches the full projection',()=>{
  const examples=[
    'First narrative is long enough. image/start\nSTATUS',
    '<Thoughts>image/start [[imgstart]]</Thoughts>\nFirst narrative is long enough. image/start',
    '<think><Thoughts>hidden [[imgstart]]</Thoughts>still hidden</think>\nFirst narrative [[imgstart]]',
    'First\n\n  narrative\n[[imgstart]]',
    'First<think>secret\nsecret</think>second\n[[imgstart]]',
    '[[@inray::image/start::image.webp]]\nBody\n[[imgstart]]',
    '{{#asset::inxbake_image/start}}\nBody\n[[imgstart]]',
    '<think>never closed image/start [[imgstart]]',
    'Body <thi',
  ];
  for(const raw of examples)for(let split=1;split<=raw.length;split++) {
    const scanner=createStreamSignalScanner(),keys=['image/start'];
    const prefix=raw.slice(0,split),expected=findStreamSignal(prefix,keys);
    assert.deepEqual(scanner.scan(prefix,keys),expected,JSON.stringify(prefix));
    // Once a signal is found the real runtime starts a job; it never rescans that reply.
    if(!expected)assert.deepEqual(scanner.scan(raw,keys),findStreamSignal(raw,keys),JSON.stringify(raw));
  }
});

test('incremental scans visit new prose once and do not project the growing body without a signal',()=>{
  const scanner=createStreamSignalScanner();let raw='';
  for(let n=0;n<1000;n++){raw+='A growing narrative without a signal.\n';assert.equal(scanner.scan(raw,['image/start']),null);}
  assert.equal(scanner.scannedCharacters,raw.length);
  assert.equal(scanner.fullScans,0);
  assert.deepEqual(scanner.scan(raw+'image/start',['image/start']),{text:raw.trim(),signal:'image/start'});
  assert.equal(scanner.fullScans,1);
});

test('replacement, edited prefixes and changed keywords rebuild scanner state',()=>{
  const scanner=createStreamSignalScanner();
  assert.equal(scanner.scan('<think>hidden',[]),null);
  assert.deepEqual(scanner.scan('New body image/start',['image/start']),{text:'New body',signal:'image/start'});
  assert.equal(scanner.scan('Other body without a keyword',['image/start']),null);
  assert.deepEqual(scanner.scan('Other body without a keyword',['without']),{text:'Other body',signal:'without'});
});

test('a short signal in an incomplete image token cannot mask a later valid body signal',()=>{
  const scanner=createStreamSignalScanner(),keys=['image/start'];
  const raw='short [[@inray::image/start::file.webp';
  assert.deepEqual(scanner.scan(raw,keys),findStreamSignal(raw,keys));
  const completed=raw+']]\nA narrative that is long enough to generate an image. [[imgstart]]';
  assert.deepEqual(scanner.scan(completed,keys),findStreamSignal(completed,keys));
});
