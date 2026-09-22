import test from 'node:test';
import assert from 'node:assert/strict';
import {analysisBody,projectMessageBody,findStreamSignal,insertAtAnalysisLine} from '../.test-build/message-body.mjs';

test('closed, unclosed, nested and chunk-split thoughts never provide image signals',()=>{
  for(const tag of ['Thoughts','think','THINK']) {
    const input=`<${tag}>secret RP-Guide [[imgstart]]\nmore</${tag}>\nfirst\nsecond\n[[imgstart]]\nstatus`;
    assert.deepEqual(findStreamSignal(input,['RP-Guide']),{text:'first\nsecond',signal:'[[imgstart]]'});
    assert.equal(findStreamSignal(`<${tag}>secret [[imgstart]]`,[]),null);
  }
  assert.equal(analysisBody('<think><think>inner</think>outer</think>body'), 'body');
  for(const tail of ['<','<t','<thi','<think','<thought','<Thoughts attribute="'])assert.equal(analysisBody('body'+tail),'body');
  assert.equal(analysisBody('body OMNI_IMGSTART_SENTINEL_8a17'),'body OMNI_IMGSTART_SENTINEL_8a17');
});
test('earliest body signal wins and everything after it is omitted',()=>{
  assert.deepEqual(findStreamSignal('one\ntwo RP-guide\n[[imgstart]] status',['RP-Guide']),{text:'one\ntwo',signal:'RP-Guide'});
  assert.deepEqual(findStreamSignal('one\n[[imgstart]]\nRP-guide',['RP-Guide']),{text:'one',signal:'[[imgstart]]'});
  assert.equal(findStreamSignal('one [[imgsta',[]),null);
  assert.equal(findStreamSignal('one\ntwo',[]),null);
});
test('analysis line numbers project back to original nonempty lines',()=>{
  const projected=projectMessageBody('<Thoughts>\nsecret\n</Thoughts>\n\nfirst\n[[imgstart]]\nsecond');
  assert.equal(projected.text,'first\nsecond');assert.deepEqual(projected.sourceLines,[4,6]);
  assert.deepEqual(projectMessageBody('<think>secret</think>first\nsecond').sourceLines,[1,2]);
  const raw='<Thoughts>\nsecret\n</Thoughts>first\n<p>second</p>\n[[imgstart]]';
  assert.equal(insertAtAnalysisLine(raw,1,'before','SLOT'),raw.replace('</Thoughts>first','</Thoughts>SLOT\nfirst'));
  assert.equal(insertAtAnalysisLine(raw,2,'before','SLOT'),raw.replace('<p>','SLOT\n<p>'));
});
