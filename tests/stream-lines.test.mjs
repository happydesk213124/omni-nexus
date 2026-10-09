import test from 'node:test';
import assert from 'node:assert/strict';
import { createStreamLineBatcher } from '../.test-build/stream-lines.mjs';
const lines = n => Array.from({length:n}, (_,i)=>`Narrative paragraph number ${i+1}.`).join('\n');

test('25 completed lines reserve two global ranges and discard the short tail',()=>{
  const batcher=createStreamLineBatcher();
  assert.equal(batcher.scan(lines(10),10,[]).batches.length,0,'last line is still being written');
  const first=batcher.scan(lines(10)+'\n',10,[]).batches;
  assert.deepEqual(first.map(b=>[b.start,b.end]),[[1,10]]);
  assert.equal(batcher.scan(lines(15)+'\n',10,[]).batches.length,0);
  const second=batcher.scan(lines(25)+'\n',10,[]).batches;
  assert.deepEqual(second.map(b=>[b.start,b.end]),[[11,20]]);
  assert.equal(second[0].text,lines(20),'prior lines stay available as context');
  assert.equal(batcher.scan(lines(25),10,[],true).batches.length,0);
});
test('short replies use the 80-percent threshold and generate only once on completion',()=>{
  for(const count of [1,7,8,9,10]) {
    const batcher=createStreamLineBatcher();
    assert.equal(batcher.scan(lines(count),10,[]).batches.length,0);
    assert.deepEqual(batcher.scan(lines(count),10,[],true).batches.map(b=>[b.start,b.end]),count>=8?[[1,count]]:[]);
    assert.equal(batcher.scan(lines(count),10,[],true).batches.length,0);
  }
});

test('final tails after full batches use 80 percent of the configured size, rounded up',()=>{
  for(const [size,tail,accepted] of [[10,7,false],[10,8,true],[30,23,false],[30,24,true],[7,5,false],[7,6,true]]) {
    const batcher=createStreamLineBatcher(),total=size*2+tail;
    assert.deepEqual(batcher.scan(lines(total)+'\n',size,[]).batches.map(b=>[b.start,b.end]),[[1,size],[size+1,size*2]]);
    const final=batcher.scan(lines(total),size,[],true).batches;
    assert.deepEqual(final.map(b=>[b.start,b.end]),accepted?[[size*2+1,total]]:[]);
    if(accepted)assert.equal(final[0].text,lines(total),'the tail keeps cumulative context and global L numbers');
    assert.equal(batcher.scan(lines(total),size,[],true).batches.length,0,'final output cannot pay for the tail twice');
  }
});
test('replacement resets ownership; split thought tags and blank lines never consume L numbers',()=>{
  const batcher=createStreamLineBatcher();
  batcher.scan('<Thou',2,[]);
  assert.equal(batcher.scan('<Thoughts>\nsecret\nsecret again\n',2,[]).batches.length,0);
  const text='<Thoughts>\nsecret\nsecret again\n</Thoughts>\n\n'+lines(2)+'\n';
  assert.deepEqual(batcher.scan(text,2,[]).batches.map(b=>[b.start,b.end,b.text]),[[1,2,lines(2)]]);
  const replaced=batcher.scan('New first paragraph.\nNew second paragraph.\n',2,[]);
  assert.equal(replaced.reset,true);assert.deepEqual(replaced.batches.map(b=>[b.start,b.end]),[[1,2]]);
});
test('keyword/marker terminates prose before status lines, without another range',()=>{
  for(const marker of ['RP-Guide','[[imgstart]]']) {
    const batcher=createStreamLineBatcher();
    const text=lines(2)+'\n'+marker+'\n'+lines(10)+'\n';
    assert.deepEqual(batcher.scan(text,2,['RP-Guide']).batches.map(b=>[b.start,b.end]),[[1,2]]);
    assert.equal(batcher.scan(text,2,['RP-Guide'],true).batches.length,0);
  }
});
