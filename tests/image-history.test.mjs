import test from 'node:test';
import assert from 'node:assert/strict';
import { appendBakeRevision, bakeTokenForCard, proseForHash } from '../.test-build/chat-bake.mjs';
import { historyDisplayRegexScript, framedAssetDisplayRegexScript, inrayDisplayRegexScript, chatImageFrameStyle } from '../.test-build/inray-display.mjs';
import { nextImageRevision } from '../.test-build/image-history.mjs';
import { comfyPromptPair } from '../.test-build/nai-to-comfy.mjs';
import { insertCharacterPlaceholders } from '../.test-build/character-placeholders.mjs';
import { composeCharacterCaptionTags } from '../.test-build/character-tags.mjs';
import { shotAssetName, idFromShotAssetName, castFromShotAssetName, sessionFromShotAssetName } from '../.test-build/shot-assets.mjs';
const size = { width:832, height:1216 };
const token = id => bakeTokenForCard(id, 'inxshot_' + id + '.srisu_hash.cabcd.webp', size);
const display = body => [historyDisplayRegexScript(), framedAssetDisplayRegexScript(), inrayDisplayRegexScript()]
  .reduce((text, rule)=>text.replace(new RegExp(rule.in, rule.flag),rule.out), body);

test('rerolls retain hash, original assets and one selected image; pin survives rendering', () => {
  const root = '53c49a72-7167-4537-9a96-d5002399f97e';
  let body = 'prose\n[[@inrayspinner::job_3::832::1216]]' + token(root);
  body = appendBakeRevision(body, root, root + '_r1', 'inxshot_' + root + '_r1.webp', size);
  body = appendBakeRevision(body, root + '_r1', root + '_r2', 'inxshot_' + root + '_r2.webp', size);
  assert.ok(body.includes(token(root)));
  assert.match(body, /1216_r1\]\]/);
  assert.equal((display(body).match(/data-inray-bake="1"/g) || []).length,1);
  assert.match(display(body), new RegExp('data-inlay-inline-shot="' + root + '_r2"'));
  body = appendBakeRevision(body, root + '_r2', root + '_r1', 'inxshot_' + root + '_r1.webp', size, true);
  assert.match(body, /1216_r1_pin\]\]$/);
  assert.match(display(body), new RegExp('data-inlay-inline-shot="' + root + '_r1"'));
  assert.equal((display(body).match(/data-inray-bake="1"/g) || []).length,1);
  assert.equal(proseForHash(body), 'prose');
  assert.equal(nextImageRevision(root + '_s4', 'r', [root,root+'_r1',root+'_r2',root+'_s4'] ),root+'_r3');
  assert.equal(nextImageRevision(root + '_r1','s',[root+'_s1',root+'_s3']),root+'_s4');
});

test('adjacent unrelated slots are preserved when a family is appended or displayed', () => {
  let body = token('first') + token('second');
  body = appendBakeRevision(body,'first','first_r1','inxshot_first_r1.webp',size);
  assert.ok(body.endsWith(token('second')));
  assert.equal((display(body).match(/data-inray-bake="1"/g)||[]).length,2);
});

test('studio save replaces only the last selected token and preserves preceding rerolls', () => {
  const body=token('root') + token('root_r1') + token('root_r2');
  const selected=appendBakeRevision(body,'root_r1','root_s1','inxshot_root_s1.webp',size,false,true);
  assert.ok(selected.includes(token('root')));assert.ok(selected.includes(token('root_r1')));
  assert.equal((selected.match(/root_s1::/g)||[]).length,1);
  assert.doesNotMatch(selected,/root_r2::/);
  assert.equal((display(selected).match(/data-inray-bake="1"/g)||[]).length,1);
  assert.match(display(selected),/data-inlay-inline-shot="root_s1"/);
});

test('Comfy moves negative weights and appends requested characters in original order', () => {
  const caps = [{prompt:'red hair, -2::blonde hair::',uc:'hat'},{prompt:'boy',uc:'glasses'}];
  const inserted = insertCharacterPlaceholders('style, @ch2@, landscape, @ch1@','bad',caps,true);
  assert.equal(inserted.main,'style, landscape, red hair, -2::blonde hair::, boy');
  assert.equal(inserted.neg,'bad, hat, glasses');
  assert.deepEqual(comfyPromptPair(inserted.main,inserted.neg),{positive:'style, landscape, red hair, boy',negative:'bad, hat, glasses, (blonde hair:2)'});
  assert.deepEqual(comfyPromptPair('{red hair, -1.5::blonde hair::}', '-2::watermark::'),{positive:'(red hair)',negative:'(watermark:2), (blonde hair:1.5)'});
  assert.equal(comfyPromptPair('red hair','{-2::watermark::}').negative,'((watermark:2))');
  const partial = insertCharacterPlaceholders('style, @ch1@','',caps,true);
  assert.equal(partial.captions[0].prompt,'');assert.equal(partial.captions[1].prompt,'boy');
});

test('height and age toggles independently suppress injected fields and preserve saved values', () => {
  const character = {name:'Minji',gender:'girl',appearance:'girl, blue hair',height:'170',age:24};
  assert.match(composeCharacterCaptionTags(character,{}),/170cm, tall, 24 years old/);
  const noHeight = composeCharacterCaptionTags(character,{}, {character_height:false});
  assert.doesNotMatch(noHeight,/170cm|tall/);assert.match(noHeight,/24 years old/);
  const noAge = composeCharacterCaptionTags(character,{}, {character_age:false});
  assert.match(noAge,/170cm/);assert.doesNotMatch(noAge,/years old/);
  assert.equal(character.height,'170');assert.equal(character.age,24);
});

test('frame scaling uses the same message width for portrait, landscape and square', () => {
  for (const [width,height] of [[832,1216],[1216,832],[1024,1024]]) {
    for (const scale of [25,50,100,150,200]) {
      const frame=chatImageFrameStyle(String(width),String(height),scale);
      assert.ok(frame.includes(`width:min(${Math.min(100,scale)}%,var(--inray-desktop-width,100%));height:auto;max-width:100%;max-height:none`));
      assert.ok(frame.includes(`aspect-ratio:${width}/${height}`));
    }
  }
});

test('revision suffix follows the existing filename hashes and parses back to the revision id', () => {
  const original = shotAssetName('uuid','webp','risu_hash',['abcd','1234']);
  const revised = shotAssetName('uuid_r2','webp','risu_hash',['abcd','1234']);
  assert.equal(revised,original.replace('.webp','_r2.webp'));
  assert.equal(idFromShotAssetName(revised),'uuid_r2');
  assert.deepEqual(castFromShotAssetName(revised),['abcd','1234']);
  assert.equal(sessionFromShotAssetName(revised),'risu_hash');
});
